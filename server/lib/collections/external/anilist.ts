import {
  getFeedsFirstPage,
  getPopularAnime,
  getTopRatedAnime,
  getTrendingAnime,
  getUserCustomLists,
  type AniListCustomList,
  type AniListMedia,
} from '@server/api/anilist';
import {
  ensureAnimeIdsLoaded,
  lookupByAniList,
  lookupByMal,
} from '@server/api/animeIds';
import type PlexAPI from '@server/api/plexapi';
import TheMovieDb from '@server/api/themoviedb';
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
      const { items, missingItems } = this.applyFilteringToMappedItems(
        mapped,
        config
      );

      // Handle auto-requests for missing items using the unified download service
      if (missingItems && missingItems.length > 0) {
        try {
          await processMissingItemsWithMode(missingItems, config, 'anilist');
        } catch (e) {
          logger.debug('Failed to process missing items for AniList', {
            label: 'AniList Collections',
            error: String(e),
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
    const subtype = (config.subtype as string) || 'trending';
    const context = this.templateEngine.createAnilistContext(
      mediaType,
      subtype
    );

    // Add unique identifier based on config name to ensure each collection gets its own name
    // This prevents multiple AniList collections with the same subtype from conflicting
    const configName = config.name || `AniList-${config.id}`;

    return {
      ...context,
      configName,
    };
  }

  // ---- Helpers for ID matching ----
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
          // Common forms:
          //   tmdb://12345
          //   com.plexapp.agents.themoviedb://12345?lang=en
          //   tvdb://12345
          //   com.plexapp.agents.thetvdb://12345?lang=en
          //   imdb://tt1234567
          //   com.plexapp.agents.imdb://tt1234567?lang=en
          //   com.plexapp.agents.myanimelist://12345 (anime-specific)

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

  private extractImdbId(links?: { site?: string; url?: string | null }[]) {
    const imdb = links?.find(
      (l) =>
        (l.site || '').toUpperCase() === 'IMDB' ||
        /imdb\.com/i.test(l.url || '')
    );
    if (!imdb?.url) return undefined;
    const m = imdb.url.match(/(tt\d{6,})/i);
    return m ? m[1].toLowerCase() : undefined;
  }

  private extractTmdbId(links?: { site?: string; url?: string | null }[]) {
    const tmdb = links?.find(
      (l) =>
        (l.site || '').toUpperCase().includes('TMDB') ||
        /themoviedb\.org/i.test(l.url || '')
    );
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
      // PlexAPI may have optional methods for GUID lookups
      const plexClientWithMethods = plexClient as PlexAPI & {
        findItemByGuid?: (
          guid: string,
          mediaType: string
        ) => Promise<{ ratingKey: string; title: string } | null>;
        findByGuid?: (
          guid: string,
          mediaType: string
        ) => Promise<{ ratingKey: string; title: string } | null>;
      };
      const fn =
        plexClientWithMethods?.findItemByGuid ||
        plexClientWithMethods?.findByGuid;
      if (typeof fn === 'function') {
        const hit = await fn.call(plexClient, guid, mediaType);
        if (hit?.ratingKey) {
          return { ratingKey: hit.ratingKey, title: hit.title || '' };
        }
      }
    } catch (e) {
      logger.debug('Plex GUID lookup failed', {
        provider,
        id,
        mediaType,
        error: String(e),
      });
    }
    return null;
  }

  // ---- Fetch ----
  public async fetchSourceData(
    config: CollectionConfig
  ): Promise<CollectionSourceData[]> {
    const rawSubtype = (config.subtype || 'trending').toString();
    const subtype = rawSubtype.toLowerCase();
    const perPage = 50; // AniList API maximum per page

    // Get media type from config (this already returns 'movie' | 'tv')
    const mediaType = getCollectionMediaType(config);

    const tvFormats = ['TV', 'TV_SHORT', 'ONA', 'OVA', 'SPECIAL'] as const;

    const bestTitleFromMedia = (m: AniListMedia): string =>
      (
        m?.title?.english ||
        m?.title?.romaji ||
        m?.title?.native ||
        ''
      ).toString();

    const adapt = (arr: AniListMedia[]): CollectionSourceData[] =>
      arr.map((m) => ({
        title: bestTitleFromMedia(m),
        anilistId: m?.id,
        raw: m,
      }));

    // Paginate through results like other services (fetch up to 9999 items)
    const paginateResults = async (
      fetchPage: (
        page: number,
        perPage: number
      ) => Promise<{
        Page: {
          media: AniListMedia[];
          pageInfo: { hasNextPage?: boolean | null };
        };
      }>
    ): Promise<AniListMedia[]> => {
      const allMedia: AniListMedia[] = [];
      let currentPage = 1;
      let hasNextPage = true;
      const maxPages = 200; // Safety limit (200 pages × 50 = 10,000 items)

      while (hasNextPage && currentPage <= maxPages && allMedia.length < 9999) {
        const { Page } = await fetchPage(currentPage, perPage);
        if (!Page?.media || Page.media.length === 0) break;

        allMedia.push(...Page.media);
        hasNextPage = Page.pageInfo?.hasNextPage ?? false;
        currentPage++;
      }

      return allMedia;
    };

    if (subtype === 'popular') {
      const allMedia = await paginateResults((page, perPage) =>
        getPopularAnime(page, perPage, false, {})
      );
      if (allMedia.length === 0) {
        const feeds = await getFeedsFirstPage(perPage, false);
        return adapt(feeds.popular ?? []);
      }
      return adapt(allMedia);
    }

    if (
      subtype === 'top' ||
      subtype === 'top_rated' ||
      subtype === 'toprated'
    ) {
      const allMedia = await paginateResults((page, perPage) =>
        getTopRatedAnime(page, perPage, false, {})
      );
      if (allMedia.length === 0) {
        const feeds = await getFeedsFirstPage(perPage, false);
        return adapt(feeds.topRated ?? []);
      }
      return adapt(allMedia);
    }

    // support both `custom:` and legacy `custom` with custom URL in config
    if (subtype.startsWith('custom:') || subtype === 'custom') {
      // If explicit spec provided (custom:username/list)
      if (subtype.startsWith('custom:')) {
        const spec = rawSubtype.slice('custom:'.length);
        const [userName, maybeList] = spec.split('/');
        if (!userName) return [];
        const lists = await getUserCustomLists(userName, 'ANIME');
        const picked: AniListCustomList[] = maybeList
          ? lists.filter(
              (l) => l.name.toLowerCase() === maybeList.toLowerCase()
            )
          : lists;
        let medias: AniListMedia[] = picked.flatMap(
          (l) => l.entries?.map((e) => e.media) ?? []
        );
        medias =
          mediaType === 'movie'
            ? medias.filter((m) => m?.format === 'MOVIE')
            : medias.filter(
                (m) =>
                  m?.format &&
                  tvFormats.includes(m.format as (typeof tvFormats)[number])
              );
        return adapt(medias.slice(0, perPage));
      }

      // Legacy support: use config.anilistCustomListUrl when subtype === 'custom'
      const customUrl = config.anilistCustomListUrl;
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
            const picked: AniListCustomList[] = maybeList
              ? lists.filter(
                  (l) => l.name.toLowerCase() === maybeList.toLowerCase()
                )
              : lists;
            let medias: AniListMedia[] = picked.flatMap(
              (l) => l.entries?.map((e) => e.media) ?? []
            );
            medias =
              mediaType === 'movie'
                ? medias.filter((m) => m?.format === 'MOVIE')
                : medias.filter(
                    (m) =>
                      m?.format &&
                      tvFormats.includes(m.format as (typeof tvFormats)[number])
                  );
            return adapt(medias.slice(0, perPage));
          }
        } catch (e) {
          logger.debug('Failed to parse AniList custom URL', {
            label: 'AniList Collections',
            url: customUrl,
            error: String(e),
          });
        }
      }

      return [];
    }

    // default: trending
    const allMedia = await paginateResults((page, perPage) =>
      getTrendingAnime(page, perPage, false, {})
    );
    if (allMedia.length === 0) {
      const feeds = await getFeedsFirstPage(perPage, false);
      return adapt(feeds.trending ?? []);
    }
    return adapt(allMedia);
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

    // Normalize library ID to string for metadata (used by plexLookupByGuid fallbacks)
    const normalizedLibraryId: string = targetLibraryId as string;

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
    // Get media type from config (this already returns 'movie' | 'tv')
    const mediaType = getCollectionMediaType(config);

    // exact-title fallback index (last resort)
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
      // TypeScript narrows this to AniListSourceData since we know this is anilist collection
      if (!('raw' in entry) || !('anilistId' in entry)) continue;

      const raw = entry.raw as AniListMedia;
      const anilistId = entry.anilistId ?? raw?.id;

      const displayTitle =
        raw?.title?.english ||
        raw?.title?.romaji ||
        raw?.title?.native ||
        entry.title ||
        'Unknown';

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

          const tmdbShow =
            row.tmdb_show_id != null ? String(row.tmdb_show_id) : undefined;
          const tmdbMovie =
            row.tmdb_movie_id != null ? String(row.tmdb_movie_id) : undefined;
          const tvdb = row.tvdb_id != null ? String(row.tvdb_id) : undefined;
          const imdb = row.imdb_id?.toLowerCase();

          // Preferred path depending on configured mediaType: prefer TVDB for shows
          if (mediaType === 'tv') {
            if (tvdb && tvdbIdx.has(tvdb)) {
              const hit = tvdbIdx.get(tvdb);
              if (hit) {
                items.push({
                  ratingKey: hit.ratingKey,
                  title: hit.title,
                  type: 'tv',
                  posterUrl:
                    raw?.coverImage?.extraLarge ||
                    raw?.coverImage?.large ||
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
                    raw?.coverImage?.extraLarge ||
                    raw?.coverImage?.large ||
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
                    raw?.coverImage?.extraLarge ||
                    raw?.coverImage?.large ||
                    undefined,
                  metadata: { libraryKey: hit.libraryKey },
                });
                matched = true;
              }
            } else if (plexClient && (tvdb || tmdbShow || imdb)) {
              const direct =
                (tvdb &&
                  (await this.plexLookupByGuid(
                    plexClient,
                    'tvdb',
                    tvdb,
                    'tv'
                  ))) ||
                (tmdbShow &&
                  (await this.plexLookupByGuid(
                    plexClient,
                    'tmdb',
                    tmdbShow,
                    'tv'
                  ))) ||
                (imdb &&
                  (await this.plexLookupByGuid(
                    plexClient,
                    'imdb',
                    imdb,
                    'tv'
                  )));
              if (direct) {
                items.push({
                  ratingKey: direct.ratingKey,
                  title: direct.title || displayTitle,
                  type: 'tv',
                  posterUrl:
                    raw?.coverImage?.extraLarge ||
                    raw?.coverImage?.large ||
                    undefined,
                  metadata: { libraryKey: normalizedLibraryId },
                });
                matched = true;
              }
            }
          }

          // If still not matched, try either TMDb id (movie or show) as a cross-check
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
                      raw?.coverImage?.extraLarge ||
                      raw?.coverImage?.large ||
                      undefined,
                    metadata: { libraryKey: hit.libraryKey },
                  });
                  matched = true;
                  break;
                }
              }
              if (plexClient) {
                const directTv = await this.plexLookupByGuid(
                  plexClient,
                  'tmdb',
                  tid,
                  'tv'
                );
                if (directTv) {
                  items.push({
                    ratingKey: directTv.ratingKey,
                    title: directTv.title || displayTitle,
                    type: 'tv',
                    tmdbId: Number(tid),
                    posterUrl:
                      raw?.coverImage?.extraLarge ||
                      raw?.coverImage?.large ||
                      undefined,
                    metadata: { libraryKey: normalizedLibraryId },
                  });
                  matched = true;
                  break;
                }
                const directMovie = await this.plexLookupByGuid(
                  plexClient,
                  'tmdb',
                  tid,
                  'movie'
                );
                if (directMovie) {
                  items.push({
                    ratingKey: directMovie.ratingKey,
                    title: directMovie.title || displayTitle,
                    type: 'movie',
                    tmdbId: Number(tid),
                    posterUrl:
                      raw?.coverImage?.extraLarge ||
                      raw?.coverImage?.large ||
                      undefined,
                    metadata: { libraryKey: normalizedLibraryId },
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
              const resp = await tmdb.getByExternalId({
                externalId: parseInt(tvdb),
                type: 'tvdb',
              });
              const titleFromTvdb =
                resp?.tv_results?.[0]?.name ||
                resp?.tv_results?.[0]?.original_name ||
                resp?.movie_results?.[0]?.title;
              if (titleFromTvdb) {
                const normTitle = titleFromTvdb
                  .toLowerCase()
                  .trim()
                  .replace(/\s+\(\d{4}\)$/, '');
                const tHit = titleLookup.get(normTitle);
                if (tHit) {
                  items.push({
                    ratingKey: tHit.ratingKey,
                    title: tHit.title,
                    type: mediaType,
                    posterUrl:
                      raw?.coverImage?.extraLarge ||
                      raw?.coverImage?.large ||
                      undefined,
                    metadata: { libraryKey: tHit.libraryKey },
                  });
                  matched = true;
                }
                // If still not matched, try plexClient.search if available
                const plexClientWithSearch = plexClient as PlexAPI & {
                  search?: (
                    title: string,
                    mediaType: string
                  ) => Promise<{ ratingKey: string; title: string }[]>;
                };
                if (
                  !matched &&
                  plexClientWithSearch.search &&
                  typeof plexClientWithSearch.search === 'function'
                ) {
                  try {
                    const searchRes = await plexClientWithSearch.search(
                      titleFromTvdb,
                      mediaType
                    );
                    if (
                      Array.isArray(searchRes) &&
                      searchRes.length > 0 &&
                      searchRes[0].ratingKey
                    ) {
                      items.push({
                        ratingKey: searchRes[0].ratingKey,
                        title: searchRes[0].title || titleFromTvdb,
                        type: mediaType,
                        posterUrl:
                          raw?.coverImage?.extraLarge ||
                          raw?.coverImage?.large ||
                          undefined,
                        metadata: { libraryKey: normalizedLibraryId },
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
      const tmdbId = this.extractTmdbId(raw?.externalLinks ?? undefined);
      if (tmdbId && tmdbIdx.has(tmdbId)) {
        const hit = tmdbIdx.get(tmdbId);
        if (hit) {
          items.push({
            ratingKey: hit.ratingKey,
            title: hit.title,
            type: mediaType,
            posterUrl:
              raw?.coverImage?.extraLarge ||
              raw?.coverImage?.large ||
              undefined,
            metadata: { libraryKey: hit.libraryKey },
          });
          continue;
        }
      }
      const imdbId = this.extractImdbId(raw?.externalLinks ?? undefined);
      if (imdbId && imdbIdx.has(imdbId)) {
        const hit = imdbIdx.get(imdbId);
        if (hit) {
          items.push({
            ratingKey: hit.ratingKey,
            title: hit.title,
            type: mediaType,
            posterUrl:
              raw?.coverImage?.extraLarge ||
              raw?.coverImage?.large ||
              undefined,
            metadata: { libraryKey: hit.libraryKey },
          });
          continue;
        }
      }
      if (plexClient && (tmdbId || imdbId)) {
        const direct =
          (tmdbId &&
            (await this.plexLookupByGuid(
              plexClient,
              'tmdb',
              tmdbId,
              mediaType
            ))) ||
          (imdbId &&
            (await this.plexLookupByGuid(
              plexClient,
              'imdb',
              imdbId,
              mediaType
            )));
        if (direct) {
          items.push({
            ratingKey: direct.ratingKey,
            title: direct.title || displayTitle,
            type: mediaType,
            posterUrl:
              raw?.coverImage?.extraLarge ||
              raw?.coverImage?.large ||
              undefined,
            metadata: { libraryKey: normalizedLibraryId },
          });
          continue;
        }
      }

      // --- C) LAST RESORT: exact title fallback (kept for rare edge cases) ---
      const candidates: string[] = [];
      if (raw?.title?.english) candidates.push(raw.title.english);
      if (raw?.title?.romaji) candidates.push(raw.title.romaji);
      if (raw?.title?.native) candidates.push(raw.title.native);
      if (entry.title) candidates.push(entry.title);
      if (Array.isArray(raw?.synonyms)) {
        for (const s of raw.synonyms) {
          if (s) candidates.push(s);
        }
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
            raw?.coverImage?.extraLarge || raw?.coverImage?.large || undefined,
          metadata: { libraryKey: titleHit.libraryKey },
        });
      } else {
        // Try to get TVDB and TMDB IDs from anime mapping or external links
        let tmdbId = 0;
        let tvdbId: number | undefined;

        if (anilistId) {
          let map = lookupByAniList(anilistId);
          if (!map && raw?.idMal) {
            const malId = Number(raw.idMal);
            if (!Number.isNaN(malId)) {
              map = lookupByMal(malId);
            }
          }
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

        // Fallback to external links if no mapping found
        if (tmdbId === 0) {
          const tmdbIdStr = this.extractTmdbId(raw?.externalLinks ?? undefined);
          if (tmdbIdStr) {
            tmdbId = Number(tmdbIdStr) || 0;
          }
        }

        // Use anime's actual format to determine mediaType (not collection-level mediaType)
        // AniList formats: MOVIE → 'movie', TV/TV_SHORT/ONA/OVA/SPECIAL → 'tv'
        const itemMediaType: 'movie' | 'tv' =
          raw?.format === 'MOVIE' ? 'movie' : 'tv';

        // If no TMDB ID found, try searching TMDB by title and year as fallback
        if (tmdbId === 0 && raw) {
          try {
            const TheMovieDb = (await import('@server/api/themoviedb')).default;
            const tmdb = new TheMovieDb();

            // Use startDate.year if available
            const year = raw.startDate?.year || undefined;

            // Prefer English title, fall back to romaji
            const searchTitle =
              raw.title?.english || raw.title?.romaji || displayTitle;

            // Search TMDB based on media type
            if (itemMediaType === 'movie') {
              const searchResults = await tmdb.searchMovies({
                query: searchTitle,
                year,
              });
              if (searchResults.results && searchResults.results.length > 0) {
                tmdbId = searchResults.results[0].id;
              }
            } else {
              const searchResults = await tmdb.searchTvShows({
                query: searchTitle,
                year,
              });
              if (searchResults.results && searchResults.results.length > 0) {
                tmdbId = searchResults.results[0].id;
              }
            }
          } catch (e) {
            // TMDB search failed, continue with tmdbId = 0
            logger.debug(`TMDB search failed for ${displayTitle}`, {
              label: 'Anilist Collections',
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
}

export default AnilistCollectionSync;
