import {
  ensureAnimeIdsLoaded,
  getFirstValue,
  lookupByMal,
} from '@server/api/animeIds';
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
import {
  buildProviderIndex,
  type ProviderIndex,
} from '@server/lib/collections/utils/AnimeProviderIndex';
import type { CollectionConfig } from '@server/lib/settings';
import logger from '@server/logger';

export class MyAnimeListCollectionSync extends BaseCollectionSync<'myanimelist'> {
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

      // Fetch source data from MAL (with libraryCache for early matching)
      const sourceData = await this.fetchSourceData(
        config,
        undefined,
        libraryCache
      );

      // Map source data to collection items
      const mapped = await this.mapSourceDataToItems(
        sourceData,
        config,
        plexClient,
        libraryCache
      );

      // Apply filtering safety net
      const { items, missingItems } = await this.applyFilteringToMappedItems(
        mapped,
        config
      );

      // Handle placeholder cleanup and process missing items
      const placeholderItems = await this.handlePlaceholdersAndMissingItems(
        items,
        missingItems,
        config,
        plexClient,
        libraryCache,
        missingItems && missingItems.length > 0
          ? async () => {
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
          : undefined
      );

      // Add placeholder items to the collection
      let finalItems = items;
      if (placeholderItems.length > 0) {
        finalItems = [...items, ...placeholderItems];
      }

      // If no items were mapped, return early
      if (finalItems.length === 0) {
        return { created: 0, updated: 0 };
      }

      // Process collection using media type strategy
      const result = await this.processWithMediaTypeStrategy(
        finalItems,
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
    config: CollectionConfig,
    options?: { apiTimeout?: number },
    libraryCache?: LibraryItemsCache
  ): Promise<CollectionSourceData[]> {
    const rankingType = (config.subtype as MALRankingType) || 'all';
    const perPage = 500; // MAL API maximum per request
    const maxItems = config.maxItems || 9999;
    const mediaType = getCollectionMediaType(config);

    // Build library index for early matching checks (if library cache provided)
    // Filter to target library FIRST, same as mapSourceDataToItems does!
    let libraryIndex: ProviderIndex | null = null;
    if (libraryCache) {
      const targetLibraryId = Array.isArray(config.libraryId)
        ? config.libraryId[0]
        : config.libraryId;

      const filteredCache: LibraryItemsCache = {};
      if (targetLibraryId && libraryCache[targetLibraryId]) {
        filteredCache[targetLibraryId] = libraryCache[targetLibraryId];
      }

      const cacheToUse =
        Object.keys(filteredCache).length > 0 ? filteredCache : libraryCache;

      libraryIndex = buildProviderIndex(cacheToUse);
    }

    // Paginate through results with rate limiting and early matching checks
    const allData: CollectionSourceData[] = [];
    let offset = 0;
    const maxRequests = 20; // Safety limit (20 requests × 500 = 10,000 items)

    for (let i = 0; i < maxRequests && allData.length < 9999; i++) {
      const response = await getRankedAnime(rankingType, perPage, offset);

      if (!response.data || response.data.length === 0) break;

      // Filter results to match target media type
      const filteredData = response.data.filter((item) => {
        const itemMediaType = item.node.media_type;
        if (mediaType === 'movie') {
          return itemMediaType === 'movie';
        } else {
          // For TV libraries, include tv, ova, ona, special (exclude movie and music)
          return (
            itemMediaType === 'tv' ||
            itemMediaType === 'ova' ||
            itemMediaType === 'ona' ||
            itemMediaType === 'special'
          );
        }
      });

      const pageData = filteredData.map((item) => ({
        title: item.node.title,
        malId: item.node.id,
        rank: item.ranking.rank,
        raw: item.node,
      }));

      allData.push(...pageData);
      offset += perPage;

      // Check every 2 requests (1000 items) if we have enough matched items
      if (libraryIndex && (i + 1) % 2 === 0) {
        const matchedCount = this.countMatchedItems(allData, libraryIndex);

        logger.debug(
          `MAL early matching check: ${matchedCount} matched items from ${allData.length} fetched (target: ${maxItems})`,
          {
            label: 'MyAnimeList Collections',
            configName: config.name,
            matchedCount,
            fetchedCount: allData.length,
            maxItems,
            currentRequest: i + 1,
          }
        );

        // If we have enough matched items to satisfy maxItems, stop fetching
        if (matchedCount >= maxItems) {
          logger.info(
            `MAL early termination: Found ${matchedCount} matched items (target: ${maxItems}) after ${
              i + 1
            } requests`,
            {
              label: 'MyAnimeList Collections',
              configName: config.name,
              matchedCount,
              maxItems,
              requestsFetched: i + 1,
            }
          );
          break;
        }
      }

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
    } = buildProviderIndex(cacheToUse);
    const mediaType = getCollectionMediaType(config);

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
          // tmdb_movie_id can be number or number[] - take first value
          const tmdbMovieFirst = getFirstValue(map.tmdb_movie_id);
          const tmdbMovie =
            tmdbMovieFirst != null ? String(tmdbMovieFirst) : undefined;
          const tvdb = map.tvdb_id != null ? String(map.tvdb_id) : undefined;
          // imdb_id can be string or string[] - take first value and lowercase
          const imdbFirst = getFirstValue(map.imdb_id);
          const imdb = imdbFirst?.toLowerCase();

          // Prefer TVDB for TV shows
          if (mediaType === 'tv') {
            if (tvdb && tvdbIdx.has(tvdb)) {
              const hit = tvdbIdx.get(tvdb);
              if (hit) {
                items.push({
                  ratingKey: hit.ratingKey,
                  title: hit.title,
                  type: 'tv',
                  tvdbId: hit.tvdbId,
                  posterUrl:
                    raw?.main_picture?.large ||
                    raw?.main_picture?.medium ||
                    undefined,
                  metadata: {
                    libraryKey: hit.libraryKey,
                    originalPosition: i + 1,
                  },
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
                  tvdbId: hit.tvdbId,
                  posterUrl:
                    raw?.main_picture?.large ||
                    raw?.main_picture?.medium ||
                    undefined,
                  metadata: {
                    libraryKey: hit.libraryKey,
                    originalPosition: i + 1,
                  },
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
                  tvdbId: hit.tvdbId,
                  posterUrl:
                    raw?.main_picture?.large ||
                    raw?.main_picture?.medium ||
                    undefined,
                  metadata: {
                    libraryKey: hit.libraryKey,
                    originalPosition: i + 1,
                  },
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
                    tvdbId: hit.tvdbId,
                    posterUrl:
                      raw?.main_picture?.large ||
                      raw?.main_picture?.medium ||
                      undefined,
                    metadata: {
                      libraryKey: hit.libraryKey,
                      originalPosition: i + 1,
                    },
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

      // No match found - try to get TMDB ID for auto-request
      // Try to get TMDB ID from anime mapping
      let tmdbId = 0;

      if (malId) {
        const map = lookupByMal(malId);
        if (map) {
          // PRIORITY 1: Check if PlexAniBridge mapping has TMDB IDs directly (instant, free)
          if (mediaType === 'tv' && map.tmdb_show_id) {
            tmdbId = Number(map.tmdb_show_id);
          } else if (mediaType === 'movie' && map.tmdb_movie_id) {
            tmdbId = Number(map.tmdb_movie_id);
          }

          // PRIORITY 2: Only if PlexAniBridge doesn't have TMDB ID, try TVDB → TMDB API lookup
          const tvdb = map.tvdb_id != null ? String(map.tvdb_id) : undefined;
          if (tmdbId === 0 && tvdb) {
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
        }
      }

      // Use anime's actual media_type to determine mediaType (not collection-level mediaType)
      // MAL media_type: 'movie' → movie, 'tv'|'ova'|'special'|'ona'|'music' → tv
      const itemMediaType: 'movie' | 'tv' =
        raw?.media_type === 'movie' ? 'movie' : 'tv';

      // Only add to missing if we have a valid TMDB ID
      // For anime, we ONLY send TMDB ID to Overseerr (no TVDB, to avoid extra TMDB API calls)
      if (tmdbId > 0) {
        missing.push({
          tmdbId,
          mediaType: itemMediaType,
          title: displayTitle,
          originalPosition: i + 1,
          source: this.source,
        });
      }
    }

    return { items, missingItems: missing };
  }

  /**
   * Count how many items from the provided source data would match items in the library.
   * This is a lightweight version of the full mapping logic used for early termination checks.
   */
  private countMatchedItems(
    sourceData: CollectionSourceData[],
    libraryIndex: {
      imdb: Map<
        string,
        { ratingKey: string; title: string; libraryKey: string }
      >;
      tmdb: Map<
        string,
        { ratingKey: string; title: string; libraryKey: string }
      >;
      tvdb: Map<
        string,
        { ratingKey: string; title: string; libraryKey: string }
      >;
    }
  ): number {
    let matchedCount = 0;

    for (const entry of sourceData) {
      if (!('raw' in entry) || !('malId' in entry)) continue;

      const malId = entry.malId;
      let matched = false;

      // Check Kometa mapping
      if (malId) {
        const map = lookupByMal(malId);
        if (map) {
          const tmdbShow =
            map.tmdb_show_id != null ? String(map.tmdb_show_id) : undefined;
          // tmdb_movie_id can be number or number[] - take first value
          const tmdbMovieFirst = getFirstValue(map.tmdb_movie_id);
          const tmdbMovie =
            tmdbMovieFirst != null ? String(tmdbMovieFirst) : undefined;
          const tvdb = map.tvdb_id != null ? String(map.tvdb_id) : undefined;
          // imdb_id can be string or string[] - take first value and lowercase
          const imdbFirst = getFirstValue(map.imdb_id);
          const imdb = imdbFirst?.toLowerCase();

          // Check if any of these IDs exist in library
          if (tvdb && libraryIndex.tvdb.has(tvdb)) matched = true;
          else if (tmdbShow && libraryIndex.tmdb.has(tmdbShow)) matched = true;
          else if (tmdbMovie && libraryIndex.tmdb.has(tmdbMovie))
            matched = true;
          else if (imdb && libraryIndex.imdb.has(imdb)) matched = true;
        }
      }

      if (matched) matchedCount++;
    }

    return matchedCount;
  }
}

export default MyAnimeListCollectionSync;
