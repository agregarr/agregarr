import type PlexAPI from '@server/api/plexapi';
import TraktAPI, { type TraktListResponse } from '@server/api/trakt';
import { BaseCollectionSync } from '@server/lib/collections/core/BaseCollectionSync';
import {
  findPlexItemsByTmdbIds,
  getCollectionMediaType,
  processMissingItemsWithMode,
  type LibraryItemsCache,
} from '@server/lib/collections/core/CollectionUtilities';
import type {
  CollectionItem,
  CollectionOperationResult,
  CollectionSyncOptions,
  FilteringStats,
  MissingItem,
  PlexCollection,
  PlexLookupResult,
  SyncResult,
  TraktSourceData,
  TraktTemplateContext,
} from '@server/lib/collections/core/types';
import { CollectionSyncErrorType } from '@server/lib/collections/core/types';
import { RandomListManager } from '@server/lib/collections/utils/RandomListManager';
import type { CollectionConfig } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import {
  buildTraktRedirectUri,
  persistTraktTokens,
} from '@server/utils/traktAuth';

interface TraktCollectionItem extends CollectionItem {
  tmdbId: number;
}

// TraktSourceData interface is now imported from types.ts

/**
 * New Trakt Collection Sync implementation using the base class
 *
 * Handles multiple Trakt API types (trending, popular, watched, custom lists)
 * with auto-request functionality and comprehensive error handling.
 */
export class TraktCollectionSync extends BaseCollectionSync<'trakt'> {
  private traktClients: Map<string, TraktAPI> = new Map();
  private dynamicRandomTitle: string | null = null;

  constructor() {
    super('trakt');
  }

  /**
   * Validate that Trakt API is properly configured
   */
  protected async validateConfiguration(): Promise<void> {
    const settings = getSettings();
    if (!settings.trakt.clientId && !settings.trakt.apiKey) {
      throw this.createSyncError(
        CollectionSyncErrorType.CONFIGURATION_ERROR,
        'Trakt client ID not configured'
      );
    }
  }

  /**
   * Process a single Trakt collection configuration
   */
  protected async processConfiguration(
    config: CollectionConfig,
    plexClient: PlexAPI,
    allCollections: PlexCollection[],
    processedCollectionKeys?: Set<string>,
    libraryCache?: LibraryItemsCache,
    options?: CollectionSyncOptions
  ): Promise<SyncResult> {
    try {
      // Validate configuration
      if (!this.isValidTraktConfig(config)) {
        throw this.createSyncError(
          CollectionSyncErrorType.CONFIGURATION_ERROR,
          `Invalid Trakt configuration: ${config.name}`
        );
      }

      // Fetch data from Trakt API
      const sourceData = await this.fetchSourceData(
        config,
        options,
        libraryCache
      );

      // Map to standardized format
      const mappedResult = await this.mapSourceDataToItems(
        sourceData,
        config,
        plexClient,
        libraryCache // OPTIMIZATION: Pass library cache to eliminate repeated API calls
      );

      // Apply filtering safety net (validation, deduplication, maxItems safety check)
      const { items, missingItems, mappingStats, filteringStats } =
        await this.applyFilteringToMappedItems(mappedResult, config);

      // Handle placeholder cleanup and process missing items
      const placeholderItems = await this.handlePlaceholdersAndMissingItems(
        items,
        missingItems,
        config,
        plexClient,
        libraryCache,
        missingItems && missingItems.length > 0
          ? () => this.handleAutoRequests(missingItems, config)
          : undefined
      );

      // Add placeholder items to the collection
      let finalItems = items;
      if (placeholderItems.length > 0) {
        finalItems = [...items, ...placeholderItems];
      }

      if (finalItems.length === 0) {
        logger.warn('No items to create collection from', {
          label: 'Trakt Collections',
          configName: config.name,
          originalStatsCount: mappingStats?.original || 0,
          mappedCount: mappingStats?.filtered || 0,
          filteredCount: filteringStats?.filtered || 0,
          removedCount:
            (mappingStats?.removed || 0) + (filteringStats?.removed || 0),
        });
        return { created: 0, updated: 0 };
      }

      // Use the new media type processing strategy
      return await this.processWithMediaTypeStrategy(
        finalItems,
        config,
        plexClient,
        allCollections,
        processedCollectionKeys,
        undefined, // userInfo
        libraryCache,
        missingItems
      );
    } catch (error) {
      // Log detailed error information before rethrowing
      logger.error(`Detailed Trakt collection error for "${config.name}"`, {
        label: 'trakt Collections',
        configId: config.id,
        configName: config.name,
        subtype: config.subtype,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        errorType:
          error instanceof Error ? error.constructor.name : typeof error,
        fullError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
        errorProperties: Object.getOwnPropertyNames(error),
      });

      throw this.createSyncError(
        CollectionSyncErrorType.COLLECTION_ERROR,
        `Failed to process Trakt collection ${config.name}`,
        { configId: config.id, configName: config.name },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  public async generateCollectionNameWithCustom(
    config: CollectionConfig,
    mediaType: 'movie' | 'tv',
    libraryCache?: LibraryItemsCache
  ): Promise<string> {
    // Handle DYNAMIC_RANDOM_TITLE using stored title from fetchSourceData
    if (config.template === 'DYNAMIC_RANDOM_TITLE' && this.dynamicRandomTitle) {
      return this.dynamicRandomTitle;
    }

    // Fall back to base implementation for other templates
    return super.generateCollectionNameWithCustom(
      config,
      mediaType,
      libraryCache
    );
  }

  /**
   * Create template context for Trakt collections
   */
  protected async createTemplateContext(
    config: CollectionConfig,
    mediaType: 'movie' | 'tv'
  ): Promise<TraktTemplateContext> {
    const statType = this.getStatTypeFromSubtype(config.subtype);

    return this.templateEngine.createTraktContext(
      mediaType,
      statType || 'trending'
    ) as TraktTemplateContext;
  }

  /**
   * Fetch data from Trakt API
   */
  public async fetchSourceData(
    config: CollectionConfig,
    options?: CollectionSyncOptions,
    libraryCache?: LibraryItemsCache
  ): Promise<TraktSourceData[]> {
    const settings = getSettings();
    const clientId = settings.trakt.clientId || settings.trakt.apiKey;
    if (!clientId) {
      throw this.createSyncError(
        CollectionSyncErrorType.CONFIGURATION_ERROR,
        'Trakt client ID not configured'
      );
    }
    const traktClient = this.getTraktClient(
      clientId,
      settings.trakt.accessToken
    );
    const statType = this.getStatTypeFromSubtype(config.subtype);

    const traktData: TraktSourceData[] = [];

    if (options?.apiTimeout) {
      logger.debug(`API timeout set to ${options.apiTimeout}ms`, {
        label: 'Trakt Collections',
      });
    }

    const mediaType = getCollectionMediaType(config);

    try {
      switch (statType) {
        case 'trending':
          if (mediaType === 'movie') {
            const movieData = await traktClient.getTrending('movies', 9999);
            traktData.push(...movieData);
          }
          if (mediaType === 'tv') {
            const showData = await traktClient.getTrending('shows', 9999);
            traktData.push(...showData);
          }
          break;

        case 'popular':
          if (mediaType === 'movie') {
            const movieData = await traktClient.getPopular('movies', 9999);
            traktData.push(...movieData);
          }
          if (mediaType === 'tv') {
            const showData = await traktClient.getPopular('shows', 9999);
            traktData.push(...showData);
          }
          break;

        case 'played': {
          const period = this.getPeriodFromConfig(config);
          if (mediaType === 'movie') {
            const movieData = await traktClient.getPlayed(
              'movies',
              period,
              9999
            );
            traktData.push(...movieData);
          }
          if (mediaType === 'tv') {
            const showData = await traktClient.getPlayed('shows', period, 9999);
            traktData.push(...showData);
          }
          break;
        }

        case 'watched': {
          const period = this.getPeriodFromConfig(config);
          if (mediaType === 'movie') {
            const movieData = await traktClient.getWatched(
              'movies',
              period,
              9999
            );
            traktData.push(...movieData);
          }
          if (mediaType === 'tv') {
            const showData = await traktClient.getWatched(
              'shows',
              period,
              9999
            );
            traktData.push(...showData);
          }
          break;
        }

        case 'collected': {
          const period = this.getPeriodFromConfig(config);
          if (mediaType === 'movie') {
            const movieData = await traktClient.getCollected(
              'movies',
              period,
              9999
            );
            traktData.push(...movieData);
          }
          if (mediaType === 'tv') {
            const showData = await traktClient.getCollected(
              'shows',
              period,
              9999
            );
            traktData.push(...showData);
          }
          break;
        }

        case 'favorited': {
          const period = this.getPeriodFromConfig(config);
          if (mediaType === 'movie') {
            const movieData = await traktClient.getFavorited(
              'movies',
              period,
              9999
            );
            traktData.push(...movieData);
          }
          if (mediaType === 'tv') {
            const showData = await traktClient.getFavorited(
              'shows',
              period,
              9999
            );
            traktData.push(...showData);
          }
          break;
        }

        case 'recommendations': {
          if (!settings.trakt.accessToken) {
            throw this.createSyncError(
              CollectionSyncErrorType.CONFIGURATION_ERROR,
              'Trakt access token is required for recommendations'
            );
          }

          const recommendations = await traktClient.getRecommendations(
            mediaType === 'tv' ? 'shows' : 'movies',
            {
              ignoreCollected: false,
              ignoreWatchlisted: false,
              limit: 100,
            }
          );

          traktData.push(...recommendations);
          break;
        }

        case 'watchlist': {
          if (!settings.trakt.accessToken) {
            throw this.createSyncError(
              CollectionSyncErrorType.CONFIGURATION_ERROR,
              'Trakt access token is required for watchlist'
            );
          }

          const watchlistData = await traktClient.getWatchlist(
            mediaType === 'tv' ? 'shows' : 'movies',
            9999
          );

          traktData.push(...watchlistData);
          break;
        }

        case 'boxoffice':
          // Box office is movies only
          if (mediaType === 'movie') {
            const movieData = await traktClient.getBoxOffice(9999);
            traktData.push(...movieData);
          }
          break;

        case 'custom': {
          if (!config.traktCustomListUrl) {
            throw this.createSyncError(
              CollectionSyncErrorType.CONFIGURATION_ERROR,
              'Custom Trakt list URL is required for custom list collections'
            );
          }

          // Strip query parameters from URL before calling Trakt API
          const cleanUrl =
            config.traktCustomListUrl?.split('?')[0] ||
            config.traktCustomListUrl;
          let customListData = await traktClient.getCustomList(cleanUrl, 9999);

          // Handle episodes, seasons, movies and shows
          customListData = customListData
            .map((item): TraktListResponse => {
              // If it's an episode, preserve episode info and convert to show
              if (item.episode && item.episode.show) {
                return {
                  ...item,
                  type: 'show' as const,
                  show: item.episode.show,
                  movie: undefined, // Clear any movie data
                  // Keep episode data for later extraction
                };
              }
              if (item.season && item.season.show) {
                return {
                  ...item,
                  type: 'show' as const,
                  show: item.season.show,
                  movie: undefined, // Clear any movie data
                  season: undefined, // Clear season data to avoid confusion
                };
              }
              // Return movies and shows as-is
              return item;
            })
            .filter((item) => {
              // Only include items that now have proper movie or show data with TMDB IDs
              const hasValidMovie =
                item.movie && item.movie.ids && item.movie.ids.tmdb;
              const hasValidShow =
                item.show && item.show.ids && item.show.ids.tmdb;
              return hasValidMovie || hasValidShow;
            });

          // Filter by media type (now always specific to library)
          const targetType = mediaType === 'movie' ? 'movie' : 'show';
          customListData = customListData.filter(
            (item) =>
              (item.movie && targetType === 'movie') ||
              (item.show && targetType === 'show')
          );

          traktData.push(...customListData);
          break;
        }

        case 'random': {
          // Get a random URL from RandomListManager with media type validation
          const randomResult = await RandomListManager.getRandomUrlWithTitle(
            'trakt',
            9999,
            mediaType,
            libraryCache
          );
          if (!randomResult) {
            throw this.createSyncError(
              CollectionSyncErrorType.CONFIGURATION_ERROR,
              `No random Trakt lists available with ${mediaType} content`
            );
          }

          const { url: randomUrl, title: listTitle } = randomResult;

          // Store the dynamic title for use in generateCollectionNameWithCustom
          if (config.template === 'DYNAMIC_RANDOM_TITLE') {
            this.dynamicRandomTitle = listTitle;
            this.updateCollectionConfigField(config.id, { name: listTitle });
          }

          logger.info(`Using random Trakt list: ${randomUrl}`, {
            label: 'Trakt Collections',
            collection: config.name,
            randomUrl,
            listTitle,
          });

          // Use the random URL like a custom list
          const cleanUrl = randomUrl.split('?')[0];
          let randomListData = await traktClient.getCustomList(cleanUrl, 9999);

          // Handle episodes, seasons, movies and shows
          randomListData = randomListData
            .map((item): TraktListResponse => {
              // If it's an episode, preserve episode info and convert to show
              if (item.episode && item.episode.show) {
                return {
                  ...item,
                  type: 'show' as const,
                  show: item.episode.show,
                  movie: undefined, // Clear any movie data
                  // Keep episode data for later extraction
                };
              }

              if (item.season && item.season.show) {
                return {
                  ...item,
                  type: 'show' as const,
                  show: item.season.show,
                  movie: undefined, // Clear any movie data
                  season: undefined, // Clear season data to avoid confusion
                };
              }

              // Return movies and shows as-is
              return item;
            })
            .filter((item) => item.movie || item.show); // Only keep items with movie or show data

          // Filter by media type (now always specific to library)
          const targetType = mediaType === 'movie' ? 'movie' : 'show';
          randomListData = randomListData.filter(
            (item) =>
              (item.movie && targetType === 'movie') ||
              (item.show && targetType === 'show')
          );

          traktData.push(...randomListData);
          break;
        }

        default:
          throw this.createSyncError(
            CollectionSyncErrorType.API_ERROR,
            `Unknown Trakt stat type: ${statType} (from subtype: ${config.subtype})`
          );
      }

      return traktData;
    } catch (error) {
      throw this.createSyncError(
        CollectionSyncErrorType.API_ERROR,
        `Failed to fetch data from Trakt API`,
        { statType, mediaType },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Map Trakt source data to standardized collection items
   */
  public async mapSourceDataToItems(
    sourceData: TraktSourceData[],
    config: CollectionConfig,
    plexClient?: PlexAPI,
    libraryCache?: LibraryItemsCache
  ): Promise<{
    items: TraktCollectionItem[];
    missingItems?: MissingItem[];
    stats?: FilteringStats;
  }> {
    const mappedItems: TraktCollectionItem[] = [];
    let missingItems: MissingItem[] = [];

    // Calculate target library ID for both collection creation and duplicate detection
    const targetLibraryId = Array.isArray(config.libraryId)
      ? config.libraryId[0]
      : config.libraryId;

    // Extract all TMDB IDs and prepare lookup data
    const traktLookups: {
      tmdbId: number;
      showTmdbId?: number; // For episodes: the parent show's TMDB ID
      mediaType: 'movie' | 'tv';
      title: string;
      year?: number;
      originalPosition: number;
      episodeInfo?: {
        season: number;
        episode: number;
        episodeTitle?: string;
      };
    }[] = [];

    for (let index = 0; index < sourceData.length; index++) {
      const item = sourceData[index];
      try {
        // Handle both formats: wrapped ({movie: {...}, show: {...}}) and raw ({title: ..., ids: ...})
        let mediaItem;
        let itemMediaType: 'movie' | 'tv';
        let episodeInfo:
          | { season: number; episode: number; episodeTitle?: string }
          | undefined;

        if ('movie' in item && item.movie) {
          // Wrapped format with movie
          mediaItem = item.movie;
          itemMediaType = 'movie';
        } else if ('show' in item && item.show) {
          // Wrapped format with show (could be from episode promotion)

          // Check if this was originally an episode
          if (item.episode) {
            // For episodes, use the episode data and TMDB ID, not the show's
            mediaItem = item.episode;
            itemMediaType = 'tv';
            episodeInfo = {
              season: item.episode.season,
              episode: item.episode.number,
              episodeTitle: item.episode.title,
            };
          } else {
            // For actual shows, use the show data
            mediaItem = item.show;
            itemMediaType = 'tv';
          }
        } else if ('ids' in item && item.ids) {
          // Raw format - item has direct properties
          mediaItem = item;
          itemMediaType = getCollectionMediaType(config); // Use config to determine type
        } else {
          // No valid data
          continue;
        }

        if (!mediaItem.ids?.tmdb) {
          continue;
        }

        const tmdbId = mediaItem.ids.tmdb;

        // For episodes, also capture the show's TMDB ID for two-pass lookup
        let showTmdbId: number | undefined;
        if (episodeInfo && 'show' in item && item.show?.ids?.tmdb) {
          showTmdbId = item.show.ids.tmdb;
        }

        traktLookups.push({
          tmdbId,
          showTmdbId,
          mediaType: itemMediaType,
          title: mediaItem.title,
          year: 'year' in mediaItem ? mediaItem.year : undefined,
          originalPosition: index + 1, // 1-based position
          episodeInfo,
        });
      } catch (error) {
        logger.warn(`Failed to process Trakt item: ${error}`, {
          label: 'Trakt Collections',
        });
      }
    }

    logger.info(
      `Extracted ${traktLookups.length} TMDB IDs from ${sourceData.length} Trakt items`,
      {
        label: 'Trakt Collections',
        sampleIds: traktLookups.slice(0, 5).map((l) => ({
          tmdbId: l.tmdbId,
          title: l.title,
          mediaType: l.mediaType,
        })),
      }
    );

    if (traktLookups.length === 0) {
      const stats = this.createFilteringStats(sourceData.length, 0, {
        'invalid data': sourceData.length,
      });
      return { items: mappedItems, missingItems, stats };
    }

    // Use direct Plex queries instead of Media table
    let plexLookup: Map<string, PlexLookupResult> = new Map();

    if (plexClient) {
      // First, do library-scoped search for collection creation
      plexLookup = await findPlexItemsByTmdbIds(
        plexClient,
        traktLookups,
        targetLibraryId,
        libraryCache, // OPTIMIZATION: Pass library cache to avoid repeated API calls
        false // Library-scoped search for collection creation
      );
    } else {
      logger.warn('No Plex client provided to mapSourceDataToItems', {
        label: 'Trakt Collections',
      });
    }

    // Process items using the Plex lookup map
    for (const lookup of traktLookups) {
      // Use simple TMDB+mediaType key since episodes have unique TMDB IDs
      const key = `${lookup.tmdbId}-${lookup.mediaType}`;

      const plexItem = plexLookup.get(key);

      if (plexItem) {
        const mappedItem = {
          ratingKey: plexItem.ratingKey,
          title: plexItem.title, // Use Plex title (episode title) instead of lookup title (show title)
          type: lookup.mediaType,
          tmdbId: lookup.tmdbId,
          tvdbId: plexItem.tvdbId,
          addedAt: plexItem.addedAt,
          releaseDate: plexItem.releaseDate,
          metadata: {
            libraryKey: plexItem.libraryKey,
            showTmdbId: lookup.showTmdbId, // Preserve show TMDB ID for episodes
            originalPosition: lookup.originalPosition, // CRITICAL: Preserve source order for multi-source interleaving
          },
          episodeInfo: lookup.episodeInfo,
        };

        mappedItems.push(mappedItem);
      } else {
        // Item exists in Trakt but not in Plex
        // Skip episodes from missing items (as per plan)
        if (!lookup.episodeInfo) {
          missingItems.push({
            tmdbId: lookup.tmdbId,
            mediaType: lookup.mediaType,
            title: lookup.title,
            year: lookup.year,
            originalPosition: lookup.originalPosition,
            source: this.source,
          });
        } else {
          logger.debug(
            `Skipping episode ${lookup.title} S${lookup.episodeInfo.season}E${lookup.episodeInfo.episode} from missing items`,
            { label: 'Trakt Collections' }
          );
        }
      }
    }

    // Second pass: Check if "missing" items exist in other libraries to prevent duplicate downloads
    if (missingItems.length > 0 && plexClient) {
      logger.debug(
        `Checking ${missingItems.length} missing items across all libraries for duplicate prevention`,
        {
          label: 'Trakt Collections',
          collection: config.name,
          targetLibrary: targetLibraryId,
        }
      );

      const missingLookups = missingItems.map((item) => ({
        tmdbId: item.tmdbId,
        mediaType: item.mediaType,
        title: item.title,
        originalPosition: item.originalPosition,
      }));

      const globalPlexLookup = await findPlexItemsByTmdbIds(
        plexClient,
        missingLookups,
        targetLibraryId,
        libraryCache,
        true // Global search for duplicate detection
      );

      // Filter out items that exist in other libraries
      const trulyMissingItems = missingItems.filter((item) => {
        const key = `${item.tmdbId}-${item.mediaType}`;
        const foundInOtherLibrary = globalPlexLookup.has(key);

        if (foundInOtherLibrary) {
          const foundItem = globalPlexLookup.get(key);
          if (foundItem) {
            logger.debug(
              `Item "${item.title}" found in library ${foundItem.libraryKey} - not marking as missing`,
              {
                label: 'Trakt Collections',
                tmdbId: item.tmdbId,
                targetLibrary: targetLibraryId,
                foundInLibrary: foundItem.libraryKey,
              }
            );
            return false; // Don't include in missing items
          }
        }
        return true; // Truly missing
      });

      // Update missing items list
      missingItems = trulyMissingItems;
    }

    const stats = this.createFilteringStats(
      sourceData.length,
      mappedItems.length,
      {
        'missing from plex': missingItems.length,
        'invalid data': sourceData.length - traktLookups.length,
      }
    );

    return {
      items: mappedItems,
      missingItems,
      stats,
    };
  }

  /**
   * Create collection in Plex
   */
  protected async createCollection(
    items: CollectionItem[],
    mediaType: 'movie' | 'tv',
    collectionName: string,
    plexClient: PlexAPI,
    allCollections: PlexCollection[],
    config: CollectionConfig,
    processedCollectionKeys?: Set<string>
  ): Promise<CollectionOperationResult> {
    try {
      // Use the new standardized approach via BaseCollectionSync
      const result = await this.createOrUpdateCollectionStandardized(
        items,
        collectionName,
        mediaType,
        config,
        plexClient,
        allCollections,
        processedCollectionKeys
      );

      // Update config with rating key if we got one
      this.updateConfigWithRatingKey(config, result.collectionRatingKey);

      return {
        created: result.created,
        updated: result.updated,
        collectionRatingKey: result.collectionRatingKey,
        itemCount: result.itemCount || items.length,
        stats: result.stats,
      };
    } catch (error) {
      throw this.createSyncError(
        CollectionSyncErrorType.COLLECTION_ERROR,
        `Failed to create Trakt collection ${collectionName}`,
        { collectionName, itemCount: items.length },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  // Private helper methods

  private getTraktClient(clientId: string, accessToken?: string): TraktAPI {
    const settings = getSettings();
    const cacheKey = `${clientId}:${accessToken || ''}:${
      settings.trakt.refreshToken || ''
    }`;
    if (!this.traktClients.has(cacheKey)) {
      this.traktClients.set(
        cacheKey,
        new TraktAPI({
          clientId,
          accessToken,
          clientSecret: settings.trakt.clientSecret,
          refreshToken: settings.trakt.refreshToken,
          tokenExpiresAt: settings.trakt.tokenExpiresAt,
          redirectUri: buildTraktRedirectUri(settings),
          onTokenRefreshed: (tokens) => persistTraktTokens(settings, tokens),
        })
      );
    }
    const client = this.traktClients.get(cacheKey);
    if (!client) {
      throw new Error(`Failed to get Trakt client for client ID`);
    }
    return client;
  }

  private isValidTraktConfig(config: CollectionConfig): boolean {
    if (config.type !== 'trakt' || !config.subtype) {
      return false;
    }

    // Valid current subtypes
    const validSubtypes = [
      'trending',
      'popular',
      'played_daily',
      'played_weekly',
      'played_monthly',
      'played_all',
      'watched_daily',
      'watched_weekly',
      'watched_monthly',
      'watched_all',
      'collected_daily',
      'collected_weekly',
      'collected_monthly',
      'collected_all',
      'favorited_daily',
      'favorited_weekly',
      'favorited_monthly',
      'favorited_all',
      'boxoffice',
      'recommendations',
      'watchlist',
      'custom',
      'random',
    ];

    // Check if it's a valid current subtype
    if (validSubtypes.includes(config.subtype)) {
      return true;
    }

    // Legacy support for old subtypes - these should still work
    const legacyValidPrefixes = [
      'trending_',
      'popular_',
      'most_watched_',
      'most_played_',
    ];

    return legacyValidPrefixes.some((prefix) =>
      (config.subtype || '').startsWith(prefix)
    );
  }

  private getStatTypeFromSubtype(subtype: string | undefined): string {
    if (!subtype) return 'trending';

    // Map subtypes to their corresponding API endpoints
    switch (subtype) {
      case 'trending':
        return 'trending';
      case 'popular':
        return 'popular';
      case 'played_daily':
      case 'played_weekly':
      case 'played_monthly':
      case 'played_all':
        return 'played';
      case 'watched_daily':
      case 'watched_weekly':
      case 'watched_monthly':
      case 'watched_all':
        return 'watched';
      case 'collected_daily':
      case 'collected_weekly':
      case 'collected_monthly':
      case 'collected_all':
        return 'collected';
      case 'favorited_daily':
      case 'favorited_weekly':
      case 'favorited_monthly':
      case 'favorited_all':
        return 'favorited';
      case 'boxoffice':
        return 'boxoffice';
      case 'recommendations':
        return 'recommendations';
      case 'watchlist':
        return 'watchlist';
      case 'custom':
        return 'custom';
      case 'random':
        return 'random';

      // Extract stat type from old subtype format
      default:
        if (subtype.startsWith('most_watched_')) {
          return 'watched';
        }
        // Extract first part of subtype (e.g., "trending_7_days" -> "trending")
        return subtype.split('_')[0];
    }
  }

  private getPeriodFromConfig(
    config: CollectionConfig
  ): 'daily' | 'weekly' | 'monthly' | 'all' {
    // Check for explicit period configuration first (future enhancement)
    if (config.timePeriod) {
      return config.timePeriod as 'daily' | 'weekly' | 'monthly' | 'all';
    }

    // Extract period from new subtype format
    if (config.subtype?.endsWith('_daily')) {
      return 'daily';
    }
    if (config.subtype?.endsWith('_weekly')) {
      return 'weekly';
    }
    if (config.subtype?.endsWith('_monthly')) {
      return 'monthly';
    }
    if (config.subtype?.endsWith('_all')) {
      return 'all';
    }

    // Derive period from legacy subtype format
    if (config.subtype?.includes('day')) {
      return 'daily';
    }
    if (config.subtype?.includes('month')) {
      return 'monthly';
    }

    // Default to weekly
    return 'weekly';
  }

  private async handleAutoRequests(
    missingItems: MissingItem[],
    config: CollectionConfig
  ): Promise<void> {
    // Use the unified download service (routes to Overseerr or direct *arr based on config)
    await processMissingItemsWithMode(missingItems, config, 'trakt');
  }
}

export default TraktCollectionSync;
