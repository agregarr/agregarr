import type PlexAPI from '@server/api/plexapi';
import { BaseCollectionSync } from '@server/lib/collections/core/BaseCollectionSync';
import { getTrendingAnime, getPopularAnime, getTopRatedAnime, getUserCustomLists, getFeedsFirstPage } from '@server/api/anilist';
import { processMissingItemsWithMode } from '@server/lib/collections/core/CollectionUtilities';
import type { LibraryItemsCache } from '@server/lib/collections/core/CollectionUtilities';
import { getCollectionMediaType } from '@server/lib/collections/core/CollectionUtilities';
import type { CollectionItem, MissingItem, PlexCollection, SyncResult, CollectionSourceData, CollectionOperationResult } from '@server/lib/collections/core/types';
import type { CollectionConfig } from '@server/lib/settings';
import { CollectionSyncErrorType } from '@server/lib/collections/core/types';
import logger from '@server/logger';
import { ensureAnimeIdsLoaded, lookupByAniList, lookupByMal, animeIdsLoadedCount } from '@server/api/animeIds';
import type { AnimeIdsRow } from '@server/api/animeIds';
import TheMovieDb from '@server/api/themoviedb';

export class AnilistCollectionSync extends BaseCollectionSync {
  constructor() {
    super('anilist');
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
    // Use the standardized collection creation pipeline
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
    // AniList is public; nothing to validate here
    return;
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

      // Fetch source data from AniList
      const sourceData = await this.fetchSourceData(config);

      // Map source data to collection items
      const mapped = await this.mapSourceDataToItems(
        sourceData,
        config,
        plexClient,
        libraryCache
      );

      // Apply filtering safety net (validation, deduplication, maxItems safety check)
      const { items, missingItems, mappingStats, filteringStats } =
        this.applyFilteringToMappedItems(mapped, config);

      // Handle auto-requests for missing items using the unified download service
      if (missingItems && missingItems.length > 0) {
        try {
          await processMissingItemsWithMode(missingItems, config, 'anilist');
        } catch (e) {
          logger.debug('Failed to process missing items for AniList', {
            label: 'AniList Collections',
            error: String(e)
          });
        }
      }

      // If no items were mapped, log a warning and return early
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
      logger.error('AniList collection processing failed', {
        label: 'AniList Collections',
        configName: config.name,
        configId: config.id,
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name,
        } : error,
      });
      return { created: 0, updated: 0 };
    }
  }

  protected async createTemplateContext(
    config: CollectionConfig,
    mediaType: 'movie' | 'tv'
  ) {
    const subtype = (config.subtype as string) || 'trending';
    const context = this.templateEngine.createAnilistContext(mediaType, subtype) as any;

    // Add unique identifier based on config name to ensure each collection gets its own name
    // This prevents multiple AniList collections with the same subtype from conflicting
    const configName = config.name || `AniList-${config.id}`;
    context.configName = configName;

    return context;
  }

  // ---- Helpers for ID matching ----
  private buildProviderIndex(libraryCache?: LibraryItemsCache) {
    const imdb = new Map<string, { ratingKey: string; title: string }>();
    const tmdb = new Map<string, { ratingKey: string; title: string }>();
    const tvdb = new Map<string, { ratingKey: string; title: string }>();

    if (!libraryCache) return { imdb, tmdb, tvdb };

    const extractGuidString = (g: any): string | null =>
      typeof g === 'string' ? g : (g && typeof g.id === 'string' ? g.id : null);

    const take = (guid: string | null) => (guid ? [guid] : []);

    for (const libKey of Object.keys(libraryCache)) {
      for (const it of libraryCache[libKey] || []) {
        const guidField = (it as any).guid;  // string or object or undefined
        const guidsField = (it as any).guids; // array of strings or objects

        const allGuidStrings: string[] = [
          ...take(extractGuidString(guidField)),
          ...(Array.isArray(guidsField) ? guidsField.map(extractGuidString).filter(Boolean) as string[] : []),
        ];

        for (const g of allGuidStrings) {
          // Common forms:
          //   tmdb://12345
          //   com.plexapp.agents.themoviedb://12345?lang=en
          //   tvdb://12345
          //   com.plexapp.agents.thetvdb://12345?lang=en
          //   imdb://tt1234567
          //   com.plexapp.agents.imdb://tt1234567?lang=en

          const mTmdb = g.match(/(?:^|agents\.themoviedb:\/\/|tmdb:\/\/)(\d+)\b/i);
          if (mTmdb) tmdb.set(mTmdb[1], { ratingKey: it.ratingKey, title: it.title });

          const mImdb = g.match(/(?:^|agents\.imdb:\/\/|imdb:\/\/)(tt\d{6,})\b/i);
          if (mImdb) imdb.set(mImdb[1].toLowerCase(), { ratingKey: it.ratingKey, title: it.title });

          const mTvdb = g.match(/(?:^|agents\.thetvdb:\/\/|tvdb:\/\/)(\d+)\b/i);
          if (mTvdb) tvdb.set(mTvdb[1], { ratingKey: it.ratingKey, title: it.title });
        }
      }
    }
    
    return { imdb, tmdb, tvdb };
  }

  private extractImdbId(links?: { site?: string; url?: string | null }[]) {
    const imdb = links?.find(l => (l.site || '').toUpperCase() === 'IMDB' || /imdb\.com/i.test(l.url || ''));
    if (!imdb?.url) return undefined;
    const m = imdb.url.match(/(tt\d{6,})/i);
    return m ? m[1].toLowerCase() : undefined;
  }

  private extractTmdbId(links?: { site?: string; url?: string | null }[]) {
    const tmdb = links?.find(l => (l.site || '').toUpperCase().includes('TMDB') || /themoviedb\.org/i.test(l.url || ''));
    if (!tmdb?.url) return undefined;
    const m = tmdb.url.match(/\/(?:tv|movie)\/(\d+)/i);
    return m ? m[1] : undefined;
  }

  // Try a direct Plex lookup by GUID if available on your PlexAPI
  private async plexLookupByGuid(
    plexClient: PlexAPI | undefined,
    provider: 'tmdb' | 'imdb' | 'tvdb',
    id: string,
    mediaType: 'movie' | 'tv'
  ): Promise<{ ratingKey: string; title: string } | null> {
    const guid = provider === 'imdb' ? `imdb://${id}` : `${provider}://${id}`;
    try {
      const fn = (plexClient as any)?.findItemByGuid || (plexClient as any)?.findByGuid;
      if (typeof fn === 'function') {
        const hit = await fn.call(plexClient, guid, mediaType);
        if (hit?.ratingKey) {
          return { ratingKey: hit.ratingKey, title: hit.title || '' };
        }
      }
    } catch (e) {
      logger.debug('Plex GUID lookup failed', { provider, id, mediaType, error: String(e) });
    }
    return null;
  }

  // ---- Fetch ----
  protected async fetchSourceData(config: CollectionConfig): Promise<CollectionSourceData[]> {
    const rawSubtype = (config.subtype || 'trending').toString();
    const subtype = rawSubtype.toLowerCase();
    const perPage = Math.min(config.maxItems || 20, 50);

    // Get media type from config (this already returns 'movie' | 'tv')
    const mediaType = getCollectionMediaType(config);

    const tvFormats = ['TV', 'TV_SHORT', 'ONA', 'OVA', 'SPECIAL'] as const;

    const filters =
      mediaType === 'movie'
        ? { format: 'MOVIE' as const, formatIn: null }
        : { format: null, formatIn: [...tvFormats] as unknown as string[] };

    const bestTitleFromMedia = (m: any): string =>
      (m?.title?.english || m?.title?.romaji || m?.title?.native || (typeof m?.title === 'string' ? m.title : '') || '').toString();

    const adapt = (arr: any[]): CollectionSourceData[] =>
      arr.map((m) => ({ title: bestTitleFromMedia(m), anilistId: m?.id, raw: m } as unknown as CollectionSourceData));

    if (subtype === 'popular') {
      // Try without filters first (simpler query like trending)
      const { Page } = await getPopularAnime(1, perPage, false, {});
      // fallback to feeds if AniList returns empty
      if (!Page?.media || Page.media.length === 0) {
        const feeds = await getFeedsFirstPage(perPage, false);
        return adapt(feeds.popular ?? []);
      }
      return adapt(Page?.media ?? []);
    }

    if (subtype === 'top' || subtype === 'top_rated' || subtype === 'toprated') {
      // Try without filters first (simpler query like trending)
      const { Page } = await getTopRatedAnime(1, perPage, false, {});
      if (!Page?.media || Page.media.length === 0) {
        const feeds = await getFeedsFirstPage(perPage, false);
        return adapt(feeds.topRated ?? []);
      }
      return adapt(Page?.media ?? []);
    }

    // support both `custom:` and legacy `custom` with custom URL in config
    if (subtype.startsWith('custom:') || subtype === 'custom') {
      // If explicit spec provided (custom:username/list)
      if (subtype.startsWith('custom:')) {
        const spec = rawSubtype.slice('custom:'.length);
        const [userName, maybeList] = spec.split('/');
        if (!userName) return [];
        const lists = await getUserCustomLists(userName, 'ANIME');
        const picked = maybeList ? lists.filter((l: any) => l.name.toLowerCase() === maybeList.toLowerCase()) : lists;
        let medias = picked.flatMap((l: any) => l.entries?.map((e: any) => e.media) ?? []);
        medias = mediaType === 'movie' ? medias.filter((m: any) => m?.format === 'MOVIE') : medias.filter((m: any) => tvFormats.includes((m?.format as any) || ''));
        return adapt(medias.slice(0, perPage));
      }

      // Legacy support: use config.anilistCustomListUrl when subtype === 'custom'
      const customUrl = (config as any).anilistCustomListUrl || (config as any).anilistCustomUrl;
      if (typeof customUrl === 'string' && customUrl.length > 0) {
        // parse patterns like /user/{username}/animelist/{ListName}
        try {
          const u = new URL(customUrl);
          const parts = u.pathname.split('/').filter(Boolean);
          // Expecting ['user', username, 'animelist', maybeList]
          if (parts[0] === 'user' && parts[1]) {
            const userName = parts[1];
            const maybeList = parts[3];
            const lists = await getUserCustomLists(userName, 'ANIME');
            const picked = maybeList ? lists.filter((l: any) => l.name.toLowerCase() === maybeList.toLowerCase()) : lists;
            let medias = picked.flatMap((l: any) => l.entries?.map((e: any) => e.media) ?? []);
            medias = mediaType === 'movie' ? medias.filter((m: any) => m?.format === 'MOVIE') : medias.filter((m: any) => tvFormats.includes((m?.format as any) || ''));
            return adapt(medias.slice(0, perPage));
          }
        } catch (e) {
          logger.debug('Failed to parse AniList custom URL', { label: 'AniList Collections', url: customUrl, error: String(e) });
        }
      }

      return [];
    }

    // default: trending
    // Try without filters first (simpler query like your Insomnia test)
    const { Page } = await getTrendingAnime(1, perPage, false, {});
    if (!Page?.media || Page.media.length === 0) {
      const feeds = await getFeedsFirstPage(perPage, false);
      return adapt(feeds.trending ?? []);
    }
    return adapt(Page?.media ?? []);
  }

  // ---- Map ----
  protected async mapSourceDataToItems(
    sourceData: CollectionSourceData[],
    config: CollectionConfig,
    plexClient?: PlexAPI,
    libraryCache?: LibraryItemsCache
  ): Promise<{ items: CollectionItem[]; missingItems?: MissingItem[] }> {
    const items: CollectionItem[] = [];
    const missing: MissingItem[] = [];

    // Normalize library ID to string for metadata
    const normalizedLibraryId: string = Array.isArray(config.libraryId) 
      ? config.libraryId[0] 
      : config.libraryId as string;

    const { imdb: imdbIdx, tmdb: tmdbIdx, tvdb: tvdbIdx } = this.buildProviderIndex(libraryCache);
    // Get media type from config (this already returns 'movie' | 'tv')
    const mediaType = getCollectionMediaType(config);

    // exact-title fallback index (last resort)
    const titleLookup = new Map<string, { ratingKey: string; title: string }>();
    if (libraryCache) {
      for (const libKey of Object.keys(libraryCache)) {
        for (const it of libraryCache[libKey] || []) {
          const base = (it.title || '').toLowerCase().trim();
          if (base) titleLookup.set(base, { ratingKey: it.ratingKey, title: it.title });
          const simplified = base.replace(/\s+\(\d{4}\)$/, '');
          if (simplified && simplified !== base) titleLookup.set(simplified, { ratingKey: it.ratingKey, title: it.title });
        }
      }
    }

    for (let i = 0; i < sourceData.length; i++) {
      const entry = sourceData[i];
      const raw: any = (entry as any).raw ?? entry;
      const anilistId: number | undefined = (entry as any).anilistId ?? raw?.id;

      const displayTitle =
        raw?.title?.english || raw?.title?.romaji || raw?.title?.native || (entry as any).title || 'Unknown';

      let matched = false;

      // --- A) Kometa mapping first ---
      if (anilistId) {
        let map = lookupByAniList(anilistId);
        // If Kometa has no entry for this AniList id, but AniList provides idMal, try MAL -> Kometa fallback
        if (!map && raw?.idMal) {
          try {
            const malId = Number(raw.idMal);
            if (!Number.isNaN(malId)) {
              map = lookupByMal(malId);
            }
          } catch (e) {
            // ignore
          }
        }

        if (map) {
          // If Kometa row exists but lacks tvdb_id, try MAL->Kometa augmentation
          if ((map.tvdb_id == null || map.tvdb_id === '') && raw?.idMal) {
            try {
              const malId = Number(raw.idMal);
              if (!Number.isNaN(malId)) {
                const malMap = lookupByMal(malId);
                if (malMap && map) {
                  // merge missing fields from malMap
                  map = { ...map, ...malMap };
                }
              }
            } catch (e) {
              // ignore
            }
          }

          // Narrow to a non-optional local so TypeScript won't lose the narrowed type across awaits
          const row = map;

          const tmdbShow = row.tmdb_show_id != null ? String(row.tmdb_show_id) : undefined;
          const tmdbMovie = row.tmdb_movie_id != null ? String(row.tmdb_movie_id) : undefined;
          const tvdb = row.tvdb_id != null ? String(row.tvdb_id) : undefined;
          const imdb = row.imdb_id?.toLowerCase();

          // Preferred path depending on configured mediaType: prefer TVDB for shows
          if (mediaType === 'tv') {
            if (tvdb && tvdbIdx.has(tvdb)) {
              const hit = tvdbIdx.get(tvdb)!;
              items.push({ 
                ratingKey: hit.ratingKey, 
                title: hit.title, 
                type: 'tv',
                metadata: { libraryKey: normalizedLibraryId }
              });
              matched = true;
            } else if (tmdbShow && tmdbIdx.has(tmdbShow)) {
              const hit = tmdbIdx.get(tmdbShow)!;
              items.push({ 
                ratingKey: hit.ratingKey, 
                title: hit.title, 
                type: 'tv', 
                tmdbId: Number(tmdbShow),
                metadata: { libraryKey: normalizedLibraryId }
              });
              matched = true;
            } else if (imdb && imdbIdx.has(imdb)) {
              const hit = imdbIdx.get(imdb)!;
              items.push({ 
                ratingKey: hit.ratingKey, 
                title: hit.title, 
                type: 'tv',
                metadata: { libraryKey: normalizedLibraryId }
              });
              matched = true;
            } else if (plexClient && (tvdb || tmdbShow || imdb)) {
              const direct =
                (tvdb && await this.plexLookupByGuid(plexClient, 'tvdb', tvdb, 'tv')) ||
                (tmdbShow && await this.plexLookupByGuid(plexClient, 'tmdb', tmdbShow, 'tv')) ||
                (imdb && await this.plexLookupByGuid(plexClient, 'imdb', imdb, 'tv'));
              if (direct) {
                items.push({ 
                  ratingKey: direct.ratingKey, 
                  title: direct.title || displayTitle, 
                  type: 'tv',
                  metadata: { libraryKey: normalizedLibraryId }
                });
                matched = true;
              }
            }
          }

          // If still not matched, try either TMDb id (movie or show) as a cross-check
          if (!matched) {
            const tryTmdbIds = [tmdbMovie, tmdbShow].filter(Boolean) as string[];
            for (const tid of tryTmdbIds) {
              if (tmdbIdx.has(tid)) {
                const hit = tmdbIdx.get(tid)!;
                const chosenType: 'movie' | 'tv' = mediaType === 'tv' ? 'tv' : 'movie';
                items.push({ 
                  ratingKey: hit.ratingKey, 
                  title: hit.title, 
                  type: chosenType, 
                  tmdbId: Number(tid),
                  metadata: { libraryKey: normalizedLibraryId }
                });
                matched = true;
                break;
              }
              if (plexClient) {
                const directTv = await this.plexLookupByGuid(plexClient, 'tmdb', tid, 'tv');
                if (directTv) {
                  items.push({ 
                    ratingKey: directTv.ratingKey, 
                    title: directTv.title || displayTitle, 
                    type: 'tv', 
                    tmdbId: Number(tid),
                    metadata: { libraryKey: normalizedLibraryId }
                  });
                  matched = true;
                  break;
                }
                const directMovie = await this.plexLookupByGuid(plexClient, 'tmdb', tid, 'movie');
                if (directMovie) {
                  items.push({ 
                    ratingKey: directMovie.ratingKey, 
                    title: directMovie.title || displayTitle, 
                    type: 'movie', 
                    tmdbId: Number(tid),
                    metadata: { libraryKey: normalizedLibraryId }
                  });
                  matched = true;
                  break;
                }
              }
            }
          }
          // If still not matched and we have a tvdb id, try to get a canonical title via TMDB (using tvdb external lookup)
          if (!matched && tvdb) {
            try {
              const tmdb = new TheMovieDb();
              const resp = await tmdb.getByExternalId({ externalId: parseInt(tvdb), type: 'tvdb' });
              const titleFromTvdb = resp?.tv_results?.[0]?.name || resp?.tv_results?.[0]?.original_name || resp?.movie_results?.[0]?.title;
              if (titleFromTvdb) {
                const normTitle = titleFromTvdb.toLowerCase().trim().replace(/\s+\(\d{4}\)$/, '');
                const tHit = titleLookup.get(normTitle);
                if (tHit) {
                  items.push({ 
                    ratingKey: tHit.ratingKey, 
                    title: tHit.title, 
                    type: mediaType,
                    metadata: { libraryKey: normalizedLibraryId }
                  });
                  matched = true;
                }
                // If still not matched, try plexClient.search if available
                if (!matched && plexClient && typeof (plexClient as any).search === 'function') {
                  try {
                    const searchRes = await (plexClient as any).search(titleFromTvdb, mediaType);
                    if (Array.isArray(searchRes) && searchRes.length > 0 && searchRes[0].ratingKey) {
                      items.push({ 
                        ratingKey: searchRes[0].ratingKey, 
                        title: searchRes[0].title || titleFromTvdb, 
                        type: mediaType,
                        metadata: { libraryKey: normalizedLibraryId }
                      });
                      matched = true;
                    }
                  } catch (e) {
                    // pass
                  }
                }
              }
            } catch (e) {
              // ignore TMDB lookup failures
            }
          }
        }
      }

      if (matched) continue;

      // --- B) Fallback to AniList externalLinks (TMDb/IMDb) ---
      const tmdbId = this.extractTmdbId(raw?.externalLinks);
      if (tmdbId && tmdbIdx.has(tmdbId)) {
        const hit = tmdbIdx.get(tmdbId)!;
        items.push({ 
          ratingKey: hit.ratingKey, 
          title: hit.title, 
          type: mediaType,
          metadata: { libraryKey: normalizedLibraryId }
        });
        continue;
      }
      const imdbId = this.extractImdbId(raw?.externalLinks);
      if (imdbId && imdbIdx.has(imdbId)) {
        const hit = imdbIdx.get(imdbId)!;
        items.push({ 
          ratingKey: hit.ratingKey, 
          title: hit.title, 
          type: mediaType,
          metadata: { libraryKey: normalizedLibraryId }
        });
        continue;
      }
      if (plexClient && (tmdbId || imdbId)) {
        const direct =
          (tmdbId && await this.plexLookupByGuid(plexClient, 'tmdb', tmdbId, mediaType)) ||
          (imdbId && await this.plexLookupByGuid(plexClient, 'imdb', imdbId, mediaType));
        if (direct) {
          items.push({ 
            ratingKey: direct.ratingKey, 
            title: direct.title || displayTitle, 
            type: mediaType,
            metadata: { libraryKey: normalizedLibraryId }
          });
          continue;
        }
      }

      // --- C) LAST RESORT: exact title fallback (kept for rare edge cases) ---
      const candidates: string[] = [];
      if (raw?.title?.english) candidates.push(raw.title.english);
      if (raw?.title?.romaji) candidates.push(raw.title.romaji);
      if (raw?.title?.native) candidates.push(raw.title.native);
      if (typeof (entry as any).title === 'string') candidates.push((entry as any).title);
      if (Array.isArray(raw?.synonyms)) for (const s of raw.synonyms) if (s) candidates.push(s);

      const norm = (s: string) => s.toLowerCase().trim().replace(/\s+\(\d{4}\)$/, '');
      let titleHit: { ratingKey: string; title: string } | undefined;
      for (const name of candidates) {
        const hit = titleLookup.get(norm(name));
        if (hit) { titleHit = hit; break; }
      }
      if (titleHit) {
        items.push({ 
          ratingKey: titleHit.ratingKey, 
          title: titleHit.title, 
          type: mediaType,
          metadata: { libraryKey: normalizedLibraryId }
        });
      } else {
        missing.push({
          tmdbId: 0,
          mediaType,
          title: displayTitle,
          originalPosition: i + 1,
          anilistId: anilistId,
        } as MissingItem);
      }
    }

    return { items, missingItems: missing };
  }
}

export default AnilistCollectionSync;
