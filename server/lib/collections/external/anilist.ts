import {
  getFeedsFirstPage,
  getPopularAnime,
  getTopRatedAnime,
  getTrendingAnime,
  getUserCustomLists,
  searchAnime,
  type AniListCustomList,
  type AniListMedia,
} from '@server/api/anilist';
import {
  ensureAnimeIdsLoaded,
  getAllValues,
  getFirstValue,
  lookupByAniList,
  lookupByMal,
} from '@server/api/animeIds';
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
  CollectionSyncOptions,
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
  Guid?: PlexGuid[]; // Capital G to match actual Plex API response
}

export class AnilistCollectionSync extends BaseCollectionSync<'anilist'> {
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

      // Fetch source data from AniList (with libraryCache for early matching)
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

      // Apply filtering safety net (validation, deduplication, maxItems safety check)
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
                  'anilist'
                );
              } catch (e) {
                logger.debug('Failed to process missing items for AniList', {
                  label: 'AniList Collections',
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

      // If no items were mapped, log a warning and return early
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

  /**
   * Count how many items from the provided media array would match items in the library.
   * This is a lightweight version of the full mapping logic used for early termination checks.
   * Deduplicates by ratingKey to match the final preview behavior.
   */
  private countMatchedItems(
    media: AniListMedia[],
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
    },
    mediaType: 'movie' | 'tv'
  ): number {
    const seenRatingKeys = new Set<string>();

    for (const m of media) {
      const anilistId = m?.id;
      let matchedRatingKey: string | undefined;

      // Check PlexAniBridge mapping first
      if (anilistId) {
        let map = lookupByAniList(anilistId);
        if (!map && m?.idMal) {
          try {
            const malId = Number(m.idMal);
            if (!Number.isNaN(malId)) {
              map = lookupByMal(malId);
            }
          } catch (e) {
            // ignore
          }
        }

        if (map) {
          const tmdbShow =
            map.tmdb_show_id != null ? String(map.tmdb_show_id) : undefined;
          // tmdb_movie_id can be array - take first value
          const tmdbMovieFirst = getFirstValue(map.tmdb_movie_id);
          const tmdbMovie =
            tmdbMovieFirst != null ? String(tmdbMovieFirst) : undefined;
          const tvdb = map.tvdb_id != null ? String(map.tvdb_id) : undefined;
          // imdb_id can be array - take first value and lowercase
          const imdbFirst = getFirstValue(map.imdb_id);
          const imdb = imdbFirst?.toLowerCase();

          // Check if any of these IDs exist in library and get ratingKey
          if (mediaType === 'tv') {
            if (tvdb && libraryIndex.tvdb.has(tvdb)) {
              matchedRatingKey = libraryIndex.tvdb.get(tvdb)?.ratingKey;
            } else if (tmdbShow && libraryIndex.tmdb.has(tmdbShow)) {
              matchedRatingKey = libraryIndex.tmdb.get(tmdbShow)?.ratingKey;
            } else if (imdb && libraryIndex.imdb.has(imdb)) {
              matchedRatingKey = libraryIndex.imdb.get(imdb)?.ratingKey;
            }
          }

          if (!matchedRatingKey) {
            const tryTmdbIds = [tmdbMovie, tmdbShow].filter(
              Boolean
            ) as string[];
            for (const tid of tryTmdbIds) {
              if (libraryIndex.tmdb.has(tid)) {
                matchedRatingKey = libraryIndex.tmdb.get(tid)?.ratingKey;
                break;
              }
            }
          }
        }
      }

      if (!matchedRatingKey) {
        // Check external links (TMDb/IMDb)
        const tmdbId = this.extractTmdbId(m?.externalLinks ?? undefined);
        if (tmdbId && libraryIndex.tmdb.has(tmdbId)) {
          matchedRatingKey = libraryIndex.tmdb.get(tmdbId)?.ratingKey;
        } else {
          const imdbId = this.extractImdbId(m?.externalLinks ?? undefined);
          if (imdbId && libraryIndex.imdb.has(imdbId)) {
            matchedRatingKey = libraryIndex.imdb.get(imdbId)?.ratingKey;
          }
        }
      }

      // Only count if we haven't seen this ratingKey before (deduplication)
      if (matchedRatingKey && !seenRatingKeys.has(matchedRatingKey)) {
        seenRatingKeys.add(matchedRatingKey);
      }
    }

    return seenRatingKeys.size;
  }

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
        const guidsField = plexItem.Guid; // Capital G!

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
              // Add all available IDs from PlexAniBridge mapping
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
              // tmdb_movie_id can be array - add all values
              const tmdbMovieIds = getAllValues(map.tmdb_movie_id);
              for (const mid of tmdbMovieIds) {
                tmdb.set(String(mid), {
                  ratingKey: it.ratingKey,
                  title: it.title,
                  libraryKey: libKey,
                });
              }
              // imdb_id can be array - add all values
              const imdbIds = getAllValues(map.imdb_id);
              for (const iid of imdbIds) {
                imdb.set(iid.toLowerCase(), {
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
    config: CollectionConfig,
    options?: CollectionSyncOptions,
    libraryCache?: LibraryItemsCache
  ): Promise<CollectionSourceData[]> {
    // Ensure anime IDs are loaded for mapping (needed for preview which bypasses processConfiguration)
    await ensureAnimeIdsLoaded();

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

    // Build format filters based on target media type
    const formatFilters =
      mediaType === 'movie'
        ? { format: 'MOVIE' }
        : { formatIn: ['TV', 'TV_SHORT', 'ONA', 'OVA', 'SPECIAL'] };

    // Build library index for early matching checks (if library cache provided)
    // Filter to target library FIRST, same as mapSourceDataToItems does!
    let libraryIndex: {
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
    } | null = null;
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

      libraryIndex = this.buildProviderIndex(cacheToUse);
    }

    // Paginate through results with rate limiting and early matching checks
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
      const maxItems = config.maxItems || 9999;

      while (hasNextPage && currentPage <= maxPages && allMedia.length < 9999) {
        const { Page } = await fetchPage(currentPage, perPage);
        if (!Page?.media || Page.media.length === 0) break;

        allMedia.push(...Page.media);
        hasNextPage = Page.pageInfo?.hasNextPage ?? false;
        currentPage++;

        // Check every 2 pages if we have enough matched items
        if (libraryIndex && currentPage % 2 === 0) {
          const matchedCount = this.countMatchedItems(
            allMedia,
            libraryIndex,
            mediaType
          );

          logger.debug(
            `AniList early matching check: ${matchedCount} matched items from ${allMedia.length} fetched (target: ${maxItems})`,
            {
              label: 'AniList Collections',
              configName: config.name,
              matchedCount,
              fetchedCount: allMedia.length,
              maxItems,
              currentPage: currentPage - 1,
            }
          );

          // If we have enough matched items to satisfy maxItems, stop fetching
          if (matchedCount >= maxItems) {
            logger.info(
              `AniList early termination: Found ${matchedCount} matched items (target: ${maxItems}) after ${
                currentPage - 1
              } pages`,
              {
                label: 'AniList Collections',
                configName: config.name,
                matchedCount,
                maxItems,
                pagesFetched: currentPage - 1,
              }
            );
            break;
          }
        }
      }

      return allMedia;
    };

    if (subtype === 'popular') {
      const allMedia = await paginateResults((page, perPage) =>
        getPopularAnime(page, perPage, false, formatFilters)
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
        getTopRatedAnime(page, perPage, false, formatFilters)
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
        // parse patterns like /user/{username}/animelist/{ListName} or /search/anime?params
        try {
          const u = new URL(customUrl);
          const parts = u.pathname.split('/').filter(Boolean);

          // Handle search URLs: /search/anime?genres=Comedy&sort=TRENDING_DESC or /search/anime/top-100
          if (parts[0] === 'search' && parts[1] === 'anime') {
            const searchParams: Parameters<typeof searchAnime>[2] = {};

            // Handle path-based shortcuts (e.g., /search/anime/top-100, /search/anime/this-season)
            if (parts[2]) {
              const shortcut = parts[2].toLowerCase();
              const now = new Date();
              const currentMonth = now.getMonth() + 1; // 1-12
              const currentYear = now.getFullYear();

              // Helper to get current season
              const getCurrentSeason = (): string => {
                if (currentMonth >= 1 && currentMonth <= 3) return 'WINTER';
                if (currentMonth >= 4 && currentMonth <= 6) return 'SPRING';
                if (currentMonth >= 7 && currentMonth <= 9) return 'SUMMER';
                return 'FALL';
              };

              // Helper to get next season
              const getNextSeason = (): { season: string; year: number } => {
                const currentSeason = getCurrentSeason();
                if (currentSeason === 'WINTER')
                  return { season: 'SPRING', year: currentYear };
                if (currentSeason === 'SPRING')
                  return { season: 'SUMMER', year: currentYear };
                if (currentSeason === 'SUMMER')
                  return { season: 'FALL', year: currentYear };
                return { season: 'WINTER', year: currentYear + 1 };
              };

              switch (shortcut) {
                case 'trending':
                  searchParams.sort = 'TRENDING_DESC';
                  break;
                case 'this-season':
                  searchParams.season = getCurrentSeason();
                  searchParams.seasonYear = currentYear;
                  searchParams.sort = 'POPULARITY_DESC';
                  break;
                case 'next-season': {
                  const next = getNextSeason();
                  searchParams.season = next.season;
                  searchParams.seasonYear = next.year;
                  searchParams.sort = 'POPULARITY_DESC';
                  break;
                }
                case 'popular':
                  searchParams.sort = 'POPULARITY_DESC';
                  break;
                case 'top-100':
                  searchParams.sort = 'SCORE_DESC';
                  break;
              }
            }

            // Parse query parameters from URL (these override path-based shortcuts)
            const genresParam = u.searchParams.get('genres');
            if (genresParam) {
              searchParams.genres = genresParam.split(',');
            }
            const tagsParam = u.searchParams.get('tags');
            if (tagsParam) {
              searchParams.tags = tagsParam.split(',');
            }
            const seasonParam = u.searchParams.get('season');
            if (seasonParam) {
              searchParams.season = seasonParam.toUpperCase();
            }
            const seasonYearParam = u.searchParams.get('seasonYear');
            if (seasonYearParam) {
              searchParams.seasonYear = parseInt(seasonYearParam);
            }
            const yearParam = u.searchParams.get('year');
            if (yearParam) {
              searchParams.year = parseInt(yearParam);
            }
            const sortParam = u.searchParams.get('sort');
            if (sortParam) {
              searchParams.sort = sortParam.toUpperCase();
            }
            const formatParam = u.searchParams.get('format');
            if (formatParam) {
              searchParams.format = formatParam.toUpperCase();
            }
            const statusParam = u.searchParams.get('airing status');
            if (statusParam) {
              searchParams.status = statusParam.toUpperCase();
            }
            const streamingParam = u.searchParams.get('streaming on');
            if (streamingParam) {
              searchParams.licensedById = parseInt(streamingParam);
            }
            const countryParam = u.searchParams.get('country of origin');
            if (countryParam) {
              searchParams.countryOfOrigin = countryParam.toUpperCase();
            }
            const sourceParam = u.searchParams.get('source material');
            if (sourceParam) {
              searchParams.source = sourceParam.toUpperCase();
            }
            const searchParam = u.searchParams.get('search');
            if (searchParam) {
              searchParams.search = searchParam;
            }
            if (u.searchParams.get('doujin')) {
              searchParams.isLicensed = u.searchParams.get('doujin') === 'true';
            }

            // Handle year range (appears as two separate parameters)
            const yearRanges = u.searchParams.getAll('year range');
            if (yearRanges.length >= 2) {
              searchParams.startDateGreater = parseInt(yearRanges[0]) * 10000; // Convert year to FuzzyDateInt (YYYYMMDD)
              searchParams.startDateLesser = parseInt(yearRanges[1]) * 10000;
            }

            // Handle episodes range (appears as two separate parameters)
            const episodesRanges = u.searchParams.getAll('episodes');
            if (episodesRanges.length >= 2) {
              searchParams.episodes_greater = parseInt(episodesRanges[0]);
              searchParams.episodes_lesser = parseInt(episodesRanges[1]);
            }

            // Handle duration range (appears as two separate parameters)
            const durationRanges = u.searchParams.getAll('duration');
            if (durationRanges.length >= 2) {
              searchParams.duration_greater = parseInt(durationRanges[0]);
              searchParams.duration_lesser = parseInt(durationRanges[1]);
            }

            // Apply format filters based on collection media type (only if not already specified)
            if (!searchParams.format && !searchParams.formatIn) {
              if (mediaType === 'movie') {
                searchParams.format = 'MOVIE';
              } else {
                searchParams.formatIn = [
                  'TV',
                  'TV_SHORT',
                  'ONA',
                  'OVA',
                  'SPECIAL',
                ];
              }
            }

            // Fetch with pagination (same pattern as trending/popular)
            const allMedia = await paginateResults((page, perPage) =>
              searchAnime(page, perPage, searchParams)
            );
            return adapt(allMedia);
          }

          // Handle user list URLs: /user/{username}/animelist/{ListName}
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
          logger.error('Failed to parse AniList custom URL', {
            label: 'AniList Collections',
            url: customUrl,
            error: e instanceof Error ? e.message : String(e),
            stack: e instanceof Error ? e.stack : undefined,
          });
        }
      }

      return [];
    }

    // default: trending
    const allMedia = await paginateResults((page, perPage) =>
      getTrendingAnime(page, perPage, false, formatFilters)
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

      // --- A) PlexAniBridge mapping first ---
      if (anilistId) {
        let map = lookupByAniList(anilistId);
        // If no entry for this AniList id, but AniList provides idMal, try MAL fallback
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
          // If PlexAniBridge row exists but lacks tvdb_id, try MAL->PlexAniBridge augmentation
          if (map.tvdb_id == null && raw?.idMal) {
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
          // tmdb_movie_id can be number or number[] - take first value
          const tmdbMovieFirst = getFirstValue(row.tmdb_movie_id);
          const tmdbMovie =
            tmdbMovieFirst != null ? String(tmdbMovieFirst) : undefined;
          const tvdb = row.tvdb_id != null ? String(row.tvdb_id) : undefined;
          // imdb_id can be string or string[] - take first value and lowercase
          const imdbFirst = getFirstValue(row.imdb_id);
          const imdb = imdbFirst?.toLowerCase();

          // Preferred path depending on configured mediaType: prefer TVDB for shows
          if (mediaType === 'tv') {
            if (tvdb && tvdbIdx.has(tvdb)) {
              const hit = tvdbIdx.get(tvdb);
              if (hit) {
                items.push({
                  ratingKey: hit.ratingKey,
                  title: hit.title,
                  type: 'tv',
                  tmdbId: tmdbShow ? Number(tmdbShow) : undefined,
                  posterUrl:
                    raw?.coverImage?.extraLarge ||
                    raw?.coverImage?.large ||
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
                  posterUrl:
                    raw?.coverImage?.extraLarge ||
                    raw?.coverImage?.large ||
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
                  tmdbId: tmdbShow ? Number(tmdbShow) : undefined,
                  posterUrl:
                    raw?.coverImage?.extraLarge ||
                    raw?.coverImage?.large ||
                    undefined,
                  metadata: {
                    libraryKey: hit.libraryKey,
                    originalPosition: i + 1,
                  },
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
                  metadata: {
                    libraryKey: normalizedLibraryId,
                    originalPosition: i + 1,
                  },
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
        }
      }

      if (matched) continue;

      // --- B) Fallback to AniList externalLinks (TMDb/IMDb) ---
      const tmdbIdFromLink = this.extractTmdbId(
        raw?.externalLinks ?? undefined
      );
      if (tmdbIdFromLink && tmdbIdx.has(tmdbIdFromLink)) {
        const hit = tmdbIdx.get(tmdbIdFromLink);
        if (hit) {
          items.push({
            ratingKey: hit.ratingKey,
            title: hit.title,
            type: mediaType,
            posterUrl:
              raw?.coverImage?.extraLarge ||
              raw?.coverImage?.large ||
              undefined,
            metadata: { libraryKey: hit.libraryKey, originalPosition: i + 1 },
          });
          continue;
        }
      }
      const imdbIdFromLink = this.extractImdbId(
        raw?.externalLinks ?? undefined
      );
      if (imdbIdFromLink && imdbIdx.has(imdbIdFromLink)) {
        const hit = imdbIdx.get(imdbIdFromLink);
        if (hit) {
          items.push({
            ratingKey: hit.ratingKey,
            title: hit.title,
            type: mediaType,
            posterUrl:
              raw?.coverImage?.extraLarge ||
              raw?.coverImage?.large ||
              undefined,
            metadata: { libraryKey: hit.libraryKey, originalPosition: i + 1 },
          });
          continue;
        }
      }
      if (plexClient && (tmdbIdFromLink || imdbIdFromLink)) {
        const direct =
          (tmdbIdFromLink &&
            (await this.plexLookupByGuid(
              plexClient,
              'tmdb',
              tmdbIdFromLink,
              mediaType
            ))) ||
          (imdbIdFromLink &&
            (await this.plexLookupByGuid(
              plexClient,
              'imdb',
              imdbIdFromLink,
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
            metadata: {
              libraryKey: normalizedLibraryId,
              originalPosition: i + 1,
            },
          });
          continue;
        }
      }

      // --- C) No match found - try to get TMDB ID for auto-request ---
      // Try to get TMDB ID from anime mapping or external links
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
          // PRIORITY 1: Check if PlexAniBridge mapping has TMDB IDs directly (instant, free)
          if (mediaType === 'tv' && map.tmdb_show_id) {
            tmdbId = Number(map.tmdb_show_id);
          } else if (mediaType === 'movie' && map.tmdb_movie_id) {
            tmdbId = Number(map.tmdb_movie_id);
          }

          // PRIORITY 2: Only if PlexAniBridge doesn't have TMDB ID, try TVDB → TMDB API lookup
          const tvdb = map.tvdb_id != null ? String(map.tvdb_id) : undefined;
          if (tvdb) {
            tvdbId = parseInt(tvdb); // Save TVDB ID for Sonarr
          }
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

      // Add to missing if we have either TMDB ID or TVDB ID
      // TMDB ID preferred for Overseerr/Radarr, TVDB ID works for Sonarr
      if (tmdbId > 0 || tvdbId) {
        missing.push({
          tmdbId: tmdbId > 0 ? tmdbId : 0, // Use 0 if no TMDB ID (Sonarr will use TVDB)
          tvdbId,
          mediaType: itemMediaType,
          title: displayTitle,
          originalPosition: i + 1,
          source: this.source,
        });
      }
    }

    return { items, missingItems: missing };
  }
}

export default AnilistCollectionSync;
