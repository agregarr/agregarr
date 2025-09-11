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
  SyncResult,
  TraktSourceData,
  TraktTemplateContext,
} from '@server/lib/collections/core/types';
import { CollectionSyncErrorType } from '@server/lib/collections/core/types';
import { RandomListManager } from '@server/lib/collections/utils/RandomListManager';
import type { CollectionConfig } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

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
export class TraktCollectionSync extends BaseCollectionSync {
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
    if (!settings.trakt.apiKey) {
      throw this.createSyncError(
        CollectionSyncErrorType.CONFIGURATION_ERROR,
        'Trakt API key not configured'
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
        this.applyFilteringToMappedItems(mappedResult, config);

      // Handle auto-requests for missing items
      if (missingItems && missingItems.length > 0) {
        await this.handleAutoRequests(missingItems, config);
      }

      if (items.length === 0) {
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
        items,
        config,
        plexClient,
        allCollections,
        processedCollectionKeys,
        undefined, // userInfo
        libraryCache
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
    const apiKey = settings.trakt.apiKey;
    if (!apiKey) {
      throw this.createSyncError(
        CollectionSyncErrorType.CONFIGURATION_ERROR,
        'Trakt API key not configured'
      );
    }
    const traktClient = this.getTraktClient(apiKey);
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
            const movieData = await traktClient.getTrending(
              'movies',
              config.maxItems
            );
            traktData.push(...movieData);
          }
          if (mediaType === 'tv') {
            const showData = await traktClient.getTrending(
              'shows',
              config.maxItems
            );
            traktData.push(...showData);
          }
          break;

        case 'popular':
          if (mediaType === 'movie') {
            const movieData = await traktClient.getPopular(
              'movies',
              config.maxItems
            );
            traktData.push(...movieData);
          }
          if (mediaType === 'tv') {
            const showData = await traktClient.getPopular(
              'shows',
              config.maxItems
            );
            traktData.push(...showData);
          }
          break;

        case 'played': {
          const period = this.getPeriodFromConfig(config);
          if (mediaType === 'movie') {
            const movieData = await traktClient.getPlayed(
              'movies',
              period,
              config.maxItems
            );
            traktData.push(...movieData);
          }
          if (mediaType === 'tv') {
            const showData = await traktClient.getPlayed(
              'shows',
              period,
              config.maxItems
            );
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
              config.maxItems
            );
            traktData.push(...movieData);
          }
          if (mediaType === 'tv') {
            const showData = await traktClient.getWatched(
              'shows',
              period,
              config.maxItems
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
              config.maxItems
            );
            traktData.push(...movieData);
          }
          if (mediaType === 'tv') {
            const showData = await traktClient.getCollected(
              'shows',
              period,
              config.maxItems
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
              config.maxItems
            );
            traktData.push(...movieData);
          }
          if (mediaType === 'tv') {
            const showData = await traktClient.getFavorited(
              'shows',
              period,
              config.maxItems
            );
            traktData.push(...showData);
          }
          break;
        }

        case 'boxoffice':
          // Box office is movies only
          if (mediaType === 'movie') {
            const movieData = await traktClient.getBoxOffice(config.maxItems);
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
          let customListData = await traktClient.getCustomList(
            cleanUrl,
            config.maxItems
          );

          // Smart promotion: Convert episodes/seasons to their parent shows, and include full movies/shows
          customListData = customListData
            .map((item): TraktListResponse => {
              // If it's an episode or season, promote it to the parent show
              if (item.episode && item.episode.show) {
                return {
                  ...item,
                  type: 'show' as const,
                  show: item.episode.show,
                  movie: undefined, // Clear any movie data
                  episode: undefined, // Clear episode data to avoid confusion
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

          // Apply ordering modifications
          customListData = this.applyOrderingOptions(customListData, config);

          traktData.push(...customListData);
          break;
        }

        case 'random': {
          // Get a random URL from RandomListManager with media type validation
          const randomResult = await RandomListManager.getRandomUrlWithTitle(
            'trakt',
            config.maxItems,
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
          let randomListData = await traktClient.getCustomList(
            cleanUrl,
            config.maxItems
          );

          // Smart promotion: Convert episodes/seasons to their parent shows, and include full movies/shows
          randomListData = randomListData
            .map((item): TraktListResponse => {
              // If it's an episode or season, promote it to the parent show
              if (item.episode && item.episode.show) {
                return {
                  ...item,
                  type: 'show' as const,
                  show: item.episode.show,
                  movie: undefined, // Clear any movie data
                  episode: undefined, // Clear episode data to avoid confusion
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

          // Apply ordering modifications
          randomListData = this.applyOrderingOptions(randomListData, config);

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
    const missingItems: MissingItem[] = [];

    // Extract all TMDB IDs and prepare lookup data
    const traktLookups: {
      tmdbId: number;
      mediaType: 'movie' | 'tv';
      title: string;
      originalPosition: number;
    }[] = [];

    for (let index = 0; index < sourceData.length; index++) {
      const item = sourceData[index];
      try {
        // Handle both formats: wrapped ({movie: {...}, show: {...}}) and raw ({title: ..., ids: ...})
        let mediaItem;
        let itemMediaType: 'movie' | 'tv';

        if ('movie' in item && item.movie) {
          // Wrapped format with movie
          mediaItem = item.movie;
          itemMediaType = 'movie';
        } else if ('show' in item && item.show) {
          // Wrapped format with show
          mediaItem = item.show;
          itemMediaType = 'tv';
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
        traktLookups.push({
          tmdbId,
          mediaType: itemMediaType,
          title: mediaItem.title,
          originalPosition: index + 1, // 1-based position
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
    let plexLookup: Map<
      string,
      { ratingKey: string; title: string; libraryKey: string }
    > = new Map();

    if (plexClient) {
      // Pass target library ID to limit search scope to only the collection's target library
      const targetLibraryId = Array.isArray(config.libraryId)
        ? config.libraryId[0]
        : config.libraryId;
      plexLookup = await findPlexItemsByTmdbIds(
        plexClient,
        traktLookups,
        targetLibraryId,
        libraryCache // OPTIMIZATION: Pass library cache to avoid repeated API calls
      );
    } else {
      logger.warn('No Plex client provided to mapSourceDataToItems', {
        label: 'Trakt Collections',
      });
    }

    // Process items using the Plex lookup map
    for (const lookup of traktLookups) {
      const key = `${lookup.tmdbId}-${lookup.mediaType}`;
      const plexItem = plexLookup.get(key);

      if (plexItem) {
        mappedItems.push({
          ratingKey: plexItem.ratingKey,
          title: lookup.title,
          type: lookup.mediaType,
          tmdbId: lookup.tmdbId,
          metadata: {
            libraryKey: plexItem.libraryKey,
          },
        });
      } else {
        // Item exists in Trakt but not in Plex
        missingItems.push({
          tmdbId: lookup.tmdbId,
          mediaType: lookup.mediaType,
          title: lookup.title,
          originalPosition: lookup.originalPosition,
        });
      }
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

  /**
   * Apply ordering options (reverse, randomize) to data array
   */
  private applyOrderingOptions<T>(data: T[], config: CollectionConfig): T[] {
    let processedData = [...data];

    const shouldReverse = config.reverseOrder ?? false;
    const shouldRandomize = config.randomizeOrder ?? false;

    // Mutual exclusion: randomize takes precedence over reverse
    if (shouldRandomize) {
      // Fisher-Yates shuffle algorithm for true randomization
      for (let i = processedData.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [processedData[i], processedData[j]] = [
          processedData[j],
          processedData[i],
        ];
      }

      logger.debug(`Applied randomization to ${processedData.length} items`, {
        label: 'Trakt Collections',
        collection: config.name,
      });
    } else if (shouldReverse) {
      processedData = processedData.reverse();

      logger.debug(`Applied reverse order to ${processedData.length} items`, {
        label: 'Trakt Collections',
        collection: config.name,
      });
    }

    return processedData;
  }

  private getTraktClient(apiKey: string): TraktAPI {
    if (!this.traktClients.has(apiKey)) {
      this.traktClients.set(apiKey, new TraktAPI(apiKey));
    }
    const client = this.traktClients.get(apiKey);
    if (!client) {
      throw new Error(`Failed to get Trakt client for API key`);
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
