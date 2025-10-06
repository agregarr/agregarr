import { ensureAnimeIdsLoaded, lookupByMal } from '@server/api/animeIds';
import {
  getRankedAnime,
  type MALAnime,
  type MALRankingType,
} from '@server/api/myanimelist';
import type PlexAPI from '@server/api/plexapi';
import { BaseCollectionSync } from '@server/lib/collections/core/BaseCollectionSync';
import type { LibraryItemsCache } from '@server/lib/collections/core/CollectionUtilities';
import {
  getCollectionMediaType,
  processMissingItemsWithMode,
} from '@server/lib/collections/core/CollectionUtilities';
import type {
  CollectionItem,
  CollectionOperationResult,
  CollectionSourceData,
  MissingItem,
  PlexCollection,
  SyncResult,
} from '@server/lib/collections/core/types';
import type { CollectionConfig } from '@server/lib/settings';
import logger from '@server/logger';

// Type definitions for Plex library items and guid structures
interface PlexGuid {
  id: string;
}

interface PlexLibraryItem {
  ratingKey: string;
  title: string;
  guid?: string | PlexGuid;
  guids?: (string | PlexGuid)[];
}

export class MyAnimeListCollectionSync extends BaseCollectionSync {
  constructor() {
    super('myanimelist');
  }

  protected async createCollection(
    items: CollectionItem[],
    mediaType: 'movie' | 'tv',
    collectionName: string,
    plexClient: PlexAPI,
    allCollections: PlexCollection[],
    config: CollectionConfig,
    processedCollectionKeys?: Set<string>
  ): Promise<CollectionOperationResult> {
    return await this.createOrUpdateCollectionStandardized(
      items,
      collectionName,
      mediaType,
      config,
      plexClient,
      allCollections,
      processedCollectionKeys
    );
  }

  protected async validateConfiguration(): Promise<void> {
    // MAL API key is required - check in settings
    const settings = await import('@server/lib/settings').then((m) =>
      m.getSettings()
    );
    if (!settings.myanimelist?.apiKey) {
      throw new Error('MyAnimeList API key is not configured');
    }
  }

  protected async processConfiguration(
    config: CollectionConfig,
    plexClient: PlexAPI,
    allCollections: PlexCollection[],
    processedCollectionKeys?: Set<string>,
    libraryCache?: LibraryItemsCache
  ): Promise<SyncResult> {
    try {
      // Ensure anime IDs are loaded for mapping
      await ensureAnimeIdsLoaded();

      // Fetch source data from MAL
      const sourceData = await this.fetchSourceData(config);

      // Map source data to collection items
      const mapped = await this.mapSourceDataToItems(
        sourceData,
        config,
        plexClient,
        libraryCache
      );

      // Apply filtering safety net
      const { items, missingItems } = this.applyFilteringToMappedItems(
        mapped,
        config
      );

      // Handle auto-requests for missing items
      if (missingItems && missingItems.length > 0) {
        try {
          await processMissingItemsWithMode(
            missingItems,
            config,
            'myanimelist'
          );
        } catch (e) {
          logger.debug('Failed to process missing items for MAL', {
            label: 'MyAnimeList Collections',
            error: String(e),
          });
        }
      }

      // If no items were mapped, return early
      if (!items || items.length === 0) {
        return { created: 0, updated: 0 };
      }

      // Process collection using media type strategy
      const result = await this.processWithMediaTypeStrategy(
        items,
        config,
        plexClient,
        allCollections,
        processedCollectionKeys
      );

      return result;
    } catch (error) {
      logger.error('MyAnimeList collection processing failed', {
        label: 'MyAnimeList Collections',
        configName: config.name,
        configId: config.id,
        error:
          error instanceof Error
            ? {
                message: error.message,
                stack: error.stack,
                name: error.name,
              }
            : error,
      });
      return { created: 0, updated: 0 };
    }
  }

  protected async createTemplateContext(
    config: CollectionConfig,
    mediaType: 'movie' | 'tv'
  ) {
    const rankingType = (config.subtype as MALRankingType) || 'all';
    const context = this.templateEngine.createMyAnimeListContext(
      mediaType,
      rankingType
    );

    const configName = config.name || `MAL-${config.id}`;

    return {
      ...context,
      configName,
    };
  }

  // ---- Fetch ----
  public async fetchSourceData(
    config: CollectionConfig
  ): Promise<CollectionSourceData[]> {
    const rankingType = (config.subtype as MALRankingType) || 'all';
    const perPage = 500; // MAL API maximum per request

    // Paginate through results like other services (fetch up to 9999 items)
    const allData: CollectionSourceData[] = [];
    let offset = 0;
    const maxRequests = 20; // Safety limit (20 requests × 500 = 10,000 items)

    for (let i = 0; i < maxRequests && allData.length < 9999; i++) {
      const response = await getRankedAnime(rankingType, perPage, offset);

      if (!response.data || response.data.length === 0) break;

      const pageData = response.data.map((item) => ({
        title: item.node.title,
        malId: item.node.id,
        rank: item.ranking.rank,
        raw: item.node,
      }));

      allData.push(...pageData);
      offset += perPage;

      // If we got less than perPage, we've hit the end
      if (response.data.length < perPage) break;
    }

    return allData;
  }

  // ---- Map ----
  public async mapSourceDataToItems(
    sourceData: CollectionSourceData[],
    config: CollectionConfig,
    plexClient?: PlexAPI,
    libraryCache?: LibraryItemsCache
  ): Promise<{ items: CollectionItem[]; missingItems?: MissingItem[] }> {
    const items: CollectionItem[] = [];
    const missing: MissingItem[] = [];

    // Filter library cache to only include target library (like Trakt does)
    const targetLibraryId = Array.isArray(config.libraryId)
      ? config.libraryId[0]
      : config.libraryId;

    const filteredCache: LibraryItemsCache = {};
    if (libraryCache && targetLibraryId) {
      if (libraryCache[targetLibraryId]) {
        filteredCache[targetLibraryId] = libraryCache[targetLibraryId];
      }
    }

    // Use filtered cache (target library only) if available, otherwise use full cache
    const cacheToUse =
      Object.keys(filteredCache).length > 0 ? filteredCache : libraryCache;

    const {
      imdb: imdbIdx,
      tmdb: tmdbIdx,
      tvdb: tvdbIdx,
    } = this.buildProviderIndex(cacheToUse);
    const mediaType = getCollectionMediaType(config);

    // Title fallback index (last resort)
    const titleLookup = new Map<
      string,
      { ratingKey: string; title: string; libraryKey: string }
    >();
    if (cacheToUse) {
      for (const libKey of Object.keys(cacheToUse)) {
        for (const it of cacheToUse[libKey] || []) {
          const base = (it.title || '').toLowerCase().trim();
          if (base)
            titleLookup.set(base, {
              ratingKey: it.ratingKey,
              title: it.title,
              libraryKey: libKey,
            });
          const simplified = base.replace(/\s+\(\d{4}\)$/, '');
          if (simplified && simplified !== base)
            titleLookup.set(simplified, {
              ratingKey: it.ratingKey,
              title: it.title,
              libraryKey: libKey,
            });
        }
      }
    }

    for (let i = 0; i < sourceData.length; i++) {
      const entry = sourceData[i];
      if (!('raw' in entry) || !('malId' in entry)) continue;

      const raw = entry.raw as MALAnime;
      const malId = entry.malId;
      const displayTitle = raw.title || entry.title || 'Unknown';

      let matched = false;

      // Try Kometa mapping first (MAL ID -> TVDB/TMDB/IMDB)
      if (malId) {
        const map = lookupByMal(malId);

        if (map) {
          const tmdbShow =
            map.tmdb_show_id != null ? String(map.tmdb_show_id) : undefined;
          const tmdbMovie =
            map.tmdb_movie_id != null ? String(map.tmdb_movie_id) : undefined;
          const tvdb = map.tvdb_id != null ? String(map.tvdb_id) : undefined;
          const imdb = map.imdb_id?.toLowerCase();

          // Prefer TVDB for TV shows
          if (mediaType === 'tv') {
            if (tvdb && tvdbIdx.has(tvdb)) {
              const hit = tvdbIdx.get(tvdb);
              if (hit) {
                items.push({
                  ratingKey: hit.ratingKey,
                  title: hit.title,
                  type: 'tv',
                  posterUrl:
                    raw?.main_picture?.large ||
                    raw?.main_picture?.medium ||
                    undefined,
                  metadata: { libraryKey: hit.libraryKey },
                });
                matched = true;
              }
            } else if (tmdbShow && tmdbIdx.has(tmdbShow)) {
              const hit = tmdbIdx.get(tmdbShow);
              if (hit) {
                items.push({
                  ratingKey: hit.ratingKey,
                  title: hit.title,
                  type: 'tv',
                  tmdbId: Number(tmdbShow),
                  posterUrl:
                    raw?.main_picture?.large ||
                    raw?.main_picture?.medium ||
                    undefined,
                  metadata: { libraryKey: hit.libraryKey },
                });
                matched = true;
              }
            } else if (imdb && imdbIdx.has(imdb)) {
              const hit = imdbIdx.get(imdb);
              if (hit) {
                items.push({
                  ratingKey: hit.ratingKey,
                  title: hit.title,
                  type: 'tv',
                  posterUrl:
                    raw?.main_picture?.large ||
                    raw?.main_picture?.medium ||
                    undefined,
                  metadata: { libraryKey: hit.libraryKey },
                });
                matched = true;
              }
            }
          }

          // Try TMDb IDs (movie or show)
          if (!matched) {
            const tryTmdbIds = [tmdbMovie, tmdbShow].filter(
              Boolean
            ) as string[];
            for (const tid of tryTmdbIds) {
              if (tmdbIdx.has(tid)) {
                const hit = tmdbIdx.get(tid);
                if (hit) {
                  const chosenType: 'movie' | 'tv' =
                    mediaType === 'tv' ? 'tv' : 'movie';
                  items.push({
                    ratingKey: hit.ratingKey,
                    title: hit.title,
                    type: chosenType,
                    tmdbId: Number(tid),
                    posterUrl:
                      raw?.main_picture?.large ||
                      raw?.main_picture?.medium ||
                      undefined,
                    metadata: { libraryKey: hit.libraryKey },
                  });
                  matched = true;
                  break;
                }
              }
            }
          }
        }
      }

      if (matched) continue;

      // Last resort: title matching
      const candidates: string[] = [];
      if (raw.title) candidates.push(raw.title);
      if (raw.alternative_titles?.en)
        candidates.push(raw.alternative_titles.en);
      if (raw.alternative_titles?.ja)
        candidates.push(raw.alternative_titles.ja);
      if (raw.alternative_titles?.synonyms) {
        candidates.push(...raw.alternative_titles.synonyms);
      }

      const norm = (s: string) =>
        s
          .toLowerCase()
          .trim()
          .replace(/\s+\(\d{4}\)$/, '');
      let titleHit:
        | { ratingKey: string; title: string; libraryKey: string }
        | undefined;
      for (const name of candidates) {
        const hit = titleLookup.get(norm(name));
        if (hit) {
          titleHit = hit;
          break;
        }
      }

      if (titleHit) {
        items.push({
          ratingKey: titleHit.ratingKey,
          title: titleHit.title,
          type: mediaType,
          posterUrl:
            raw?.main_picture?.large || raw?.main_picture?.medium || undefined,
          metadata: { libraryKey: titleHit.libraryKey },
        });
      } else {
        // Try to get TVDB and TMDB IDs from anime mapping
        let tmdbId = 0;
        let tvdbId: number | undefined;

        if (malId) {
          const map = lookupByMal(malId);
          if (map) {
            // Get TVDB ID directly from Kometa mapping (preferred for anime)
            const tvdb = map.tvdb_id != null ? String(map.tvdb_id) : undefined;
            if (tvdb) {
              tvdbId = parseInt(tvdb);

              // Also try to get TMDB ID for services that need it
              try {
                const TheMovieDb = (await import('@server/api/themoviedb'))
                  .default;
                const tmdb = new TheMovieDb();
                const resp = await tmdb.getByExternalId({
                  externalId: parseInt(tvdb),
                  type: 'tvdb',
                });
                const tvResult = resp?.tv_results?.[0];
                const movieResult = resp?.movie_results?.[0];
                if (mediaType === 'tv' && tvResult?.id) {
                  tmdbId = tvResult.id;
                } else if (mediaType === 'movie' && movieResult?.id) {
                  tmdbId = movieResult.id;
                } else if (tvResult?.id) {
                  tmdbId = tvResult.id;
                } else if (movieResult?.id) {
                  tmdbId = movieResult.id;
                }
              } catch (e) {
                // TVDB → TMDB lookup failed, continue with TVDB only
              }
            }

            // Fallback: check if Kometa has direct TMDB IDs
            if (tmdbId === 0) {
              if (mediaType === 'tv' && map.tmdb_show_id) {
                tmdbId = Number(map.tmdb_show_id);
              } else if (mediaType === 'movie' && map.tmdb_movie_id) {
                tmdbId = Number(map.tmdb_movie_id);
              }
            }
          }
        }

        // Use anime's actual media_type to determine mediaType (not collection-level mediaType)
        // MAL media_type: 'movie' → movie, 'tv'|'ova'|'special'|'ona'|'music' → tv
        const itemMediaType: 'movie' | 'tv' =
          raw?.media_type === 'movie' ? 'movie' : 'tv';

        // If no TMDB ID found, try searching TMDB by title and year as fallback
        if (tmdbId === 0 && raw) {
          try {
            const TheMovieDb = (await import('@server/api/themoviedb')).default;
            const tmdb = new TheMovieDb();

            // Extract year from start_date (format: "2021-01-15")
            const year = raw.start_date
              ? parseInt(raw.start_date.split('-')[0])
              : undefined;

            // Search TMDB based on media type
            if (itemMediaType === 'movie') {
              const searchResults = await tmdb.searchMovies({
                query: displayTitle,
                year,
              });
              if (searchResults.results && searchResults.results.length > 0) {
                tmdbId = searchResults.results[0].id;
              }
            } else {
              const searchResults = await tmdb.searchTvShows({
                query: displayTitle,
                year,
              });
              if (searchResults.results && searchResults.results.length > 0) {
                tmdbId = searchResults.results[0].id;
              }
            }
          } catch (e) {
            // TMDB search failed, continue with tmdbId = 0
            logger.debug(`TMDB search failed for ${displayTitle}`, {
              label: 'MyAnimeList Collections',
              error: String(e),
            });
          }
        }

        // Only add to missing if we have a valid TMDB ID
        if (tmdbId > 0) {
          missing.push({
            tmdbId,
            tvdbId,
            mediaType: itemMediaType,
            title: displayTitle,
            originalPosition: i + 1,
          });
        }
      }
    }

    return { items, missingItems: missing };
  }

  // Helper to build provider index from library cache
  private buildProviderIndex(libraryCache?: LibraryItemsCache) {
    const imdb = new Map<
      string,
      { ratingKey: string; title: string; libraryKey: string }
    >();
    const tmdb = new Map<
      string,
      { ratingKey: string; title: string; libraryKey: string }
    >();
    const tvdb = new Map<
      string,
      { ratingKey: string; title: string; libraryKey: string }
    >();

    if (!libraryCache) return { imdb, tmdb, tvdb };

    const extractGuidString = (
      g: string | PlexGuid | undefined
    ): string | null =>
      typeof g === 'string' ? g : g && typeof g.id === 'string' ? g.id : null;

    const take = (guid: string | null) => (guid ? [guid] : []);

    for (const libKey of Object.keys(libraryCache)) {
      for (const it of libraryCache[libKey] || []) {
        const plexItem = it as PlexLibraryItem;
        const guidField = plexItem.guid;
        const guidsField = plexItem.guids;

        const allGuidStrings: string[] = [
          ...take(extractGuidString(guidField)),
          ...(Array.isArray(guidsField)
            ? (guidsField.map(extractGuidString).filter(Boolean) as string[])
            : []),
        ];

        for (const g of allGuidStrings) {
          const mTmdb = g.match(
            /(?:^|agents\.themoviedb:\/\/|tmdb:\/\/)(\d+)\b/i
          );
          if (mTmdb)
            tmdb.set(mTmdb[1], {
              ratingKey: it.ratingKey,
              title: it.title,
              libraryKey: libKey,
            });

          const mImdb = g.match(
            /(?:^|agents\.imdb:\/\/|imdb:\/\/)(tt\d{6,})\b/i
          );
          if (mImdb)
            imdb.set(mImdb[1].toLowerCase(), {
              ratingKey: it.ratingKey,
              title: it.title,
              libraryKey: libKey,
            });

          const mTvdb = g.match(/(?:^|agents\.thetvdb:\/\/|tvdb:\/\/)(\d+)\b/i);
          if (mTvdb)
            tvdb.set(mTvdb[1], {
              ratingKey: it.ratingKey,
              title: it.title,
              libraryKey: libKey,
            });

          // MyAnimeList Agent: com.plexapp.agents.myanimelist://{mal_id}
          const mMalAgent = g.match(/myanimelist:\/\/(\d+)/i);
          if (mMalAgent) {
            const malId = parseInt(mMalAgent[1]);
            const map = lookupByMal(malId);
            if (map) {
              // Add all available IDs from Kometa mapping
              if (map.tvdb_id) {
                tvdb.set(String(map.tvdb_id), {
                  ratingKey: it.ratingKey,
                  title: it.title,
                  libraryKey: libKey,
                });
              }
              if (map.tmdb_show_id) {
                tmdb.set(String(map.tmdb_show_id), {
                  ratingKey: it.ratingKey,
                  title: it.title,
                  libraryKey: libKey,
                });
              }
              if (map.tmdb_movie_id) {
                tmdb.set(String(map.tmdb_movie_id), {
                  ratingKey: it.ratingKey,
                  title: it.title,
                  libraryKey: libKey,
                });
              }
              if (map.imdb_id) {
                imdb.set(map.imdb_id.toLowerCase(), {
                  ratingKey: it.ratingKey,
                  title: it.title,
                  libraryKey: libKey,
                });
              }
            }
          }
        }
      }
    }

    return { imdb, tmdb, tvdb };
  }
}

export default MyAnimeListCollectionSync;
