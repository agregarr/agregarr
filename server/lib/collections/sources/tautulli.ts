import type PlexAPI from '@server/api/plexapi';
import TautulliAPI from '@server/api/tautulli';
import { BaseCollectionSync } from '@server/lib/collections/core/BaseCollectionSync';
import {
  getCollectionMediaType,
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
  TautulliSourceData,
  TautulliTemplateContext,
} from '@server/lib/collections/core/types';
import { CollectionSyncErrorType } from '@server/lib/collections/core/types';
import type { CollectionConfig } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

interface TautulliCollectionItem extends CollectionItem {
  totalPlays: number;
}

// TautulliSourceData interface is now imported from types.ts

/**
 * New Tautulli Collection Sync implementation using the base class
 *
 * This implementation uses the shared foundation utilities and follows
 * the standardized pipeline while maintaining identical functionality
 * to the original TautulliCollectionSync class.
 */
export class TautulliCollectionSync extends BaseCollectionSync<'tautulli'> {
  constructor() {
    super('tautulli');
  }

  /**
   * Validate that Tautulli is properly configured
   */
  protected async validateConfiguration(): Promise<void> {
    const settings = getSettings();
    if (!settings.tautulli.apiKey || !settings.tautulli.hostname) {
      throw this.createSyncError(
        CollectionSyncErrorType.CONFIGURATION_ERROR,
        'Tautulli not configured - missing API key or hostname'
      );
    }

    // Test connection by getting the client
    await this.getTautulliClient();
  }

  /**
   * Process a single Tautulli collection configuration
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
      if (!this.isValidTautulliConfig(config)) {
        throw this.createSyncError(
          CollectionSyncErrorType.CONFIGURATION_ERROR,
          `Invalid Tautulli configuration: ${config.name}`
        );
      }

      // Since configs are now library-specific, always use the standard flow
      const sourceData = await this.fetchSourceData(
        config,
        options,
        libraryCache
      );
      const mappedResult = await this.mapSourceDataToItems(
        sourceData,
        config,
        plexClient
      );
      const { items, mappingStats, filteringStats } =
        await this.applyFilteringToMappedItems(mappedResult, config);

      if (items.length === 0) {
        logger.warn('No items to create collection from', {
          label: 'Tautulli Collections',
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
      throw this.createSyncError(
        CollectionSyncErrorType.COLLECTION_ERROR,
        `Failed to process Tautulli collection ${config.name}`,
        { configId: config.id, configName: config.name },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Create template context for Tautulli collections
   */
  protected async createTemplateContext(
    config: CollectionConfig,
    mediaType: 'movie' | 'tv'
  ): Promise<TautulliTemplateContext> {
    const timeRangeDays = this.getTimeRangeDays(config);
    const statType = (config.tautulliStatType || 'plays') as
      | 'plays'
      | 'duration'
      | 'users';
    const subtype = this.getSubtypeFromConfig(config);

    return {
      ...this.templateEngine.getDefaultContext(),
      mediaType,
      days: timeRangeDays,
      customdays: timeRangeDays,
      statType,
      subtype,
    } as TautulliTemplateContext;
  }

  /**
   * Fetch data from Tautulli API
   */
  public async fetchSourceData(
    config: CollectionConfig,
    options?: CollectionSyncOptions,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Used in mapSourceDataToItems via processConfiguration
    libraryCache?: LibraryItemsCache
  ): Promise<TautulliSourceData[]> {
    const tautulli = await this.getTautulliClient();
    const timeRangeDays = this.getTimeRangeDays(config);
    const statType = config.tautulliStatType || 'plays';
    const collectionType = this.getCollectionTypeFromSubtype(config);

    // For single media type processing, use the specified mediaType
    const mediaType = getCollectionMediaType(config);

    if (options?.apiTimeout) {
      // Note: TautulliAPI doesn't currently support timeout, but we could extend it
      logger.debug(`API timeout set to ${options.apiTimeout}ms`, {
        label: 'Tautulli Collections',
      });
    }

    if (!mediaType) {
      throw new Error('Media type is required for Tautulli collection sync');
    }

    const tautulliStats = await tautulli.getContent(
      mediaType,
      timeRangeDays,
      statType,
      collectionType,
      9999
    );

    // Convert TautulliHomeStatRow[] to TautulliSourceData[] - the old code worked directly with the raw data
    return tautulliStats as TautulliSourceData[];
  }

  /**
   * Extract TMDB ID from Plex GUID array
   */
  private extractTmdbIdFromGuids(guids: { id: string }[]): number | undefined {
    for (const guid of guids) {
      const tmdbMatch = guid.id.match(/tmdb:\/\/(\d+)/);
      if (tmdbMatch) {
        return parseInt(tmdbMatch[1], 10);
      }
    }
    return undefined;
  }

  /**
   * Map Tautulli source data to standardized collection items with TMDB IDs from Plex
   */
  public async mapSourceDataToItems(
    sourceData: TautulliSourceData[],
    config: CollectionConfig,
    plexClient?: PlexAPI
  ): Promise<{
    items: TautulliCollectionItem[];
    missingItems?: MissingItem[];
    stats?: FilteringStats;
  }> {
    const isMostWatched = config.subtype?.startsWith('most_watched') ?? false;
    const minimumPlays = config.minimumPlays ?? 3;
    // If no config provided, accept all media types
    const mediaType = config ? getCollectionMediaType(config) : null;

    // Debug logging to see what we got from Tautulli
    logger.debug('Tautulli source data received', {
      label: 'Tautulli Collections',
      configName: config.name,
      sourceDataCount: sourceData.length,
      sampleItems: sourceData.slice(0, 3).map((item) => ({
        title: item.title || item.grandparent_title,
        total_plays: item.total_plays,
        plays: item.plays,
        rating_key: item.rating_key,
        grandparent_rating_key: item.grandparent_rating_key,
        media_type: item.media_type,
        tmdb_id: item.tmdb_id,
        year: item.year,
      })),
    });

    // Track filtered items by reason for summary logging
    const filteredByReason: {
      insufficientViewers: string[];
      missingRatingKey: string[];
      unsupportedMediaType: string[];
      mediaTypeMismatch: string[];
    } = {
      insufficientViewers: [],
      missingRatingKey: [],
      unsupportedMediaType: [],
      mediaTypeMismatch: [],
    };

    const filteredItems = sourceData.filter((item) => {
      const hasRatingKey = !!item.rating_key;

      // For most_popular stat types, use users_watched field for unique viewer count
      // For most_watched stat types, users_watched is empty so skip this filter
      const uniqueViewers =
        typeof item.users_watched === 'number'
          ? item.users_watched
          : parseInt(item.users_watched?.toString() || '0', 10) || 0;

      // Map Tautulli API media types to our internal types
      // Note: Tautulli uses "episode" to refer to TV shows in stats
      let itemMediaType: 'movie' | 'tv' | null = null;
      if (item.media_type === 'movie') {
        itemMediaType = 'movie';
      } else if (item.media_type === 'episode') {
        itemMediaType = 'tv'; // Tautulli calls TV shows "episode" in stats
      } else if (item.media_type === 'show') {
        itemMediaType = 'tv';
      }

      const passesViewerFilter = isMostWatched || uniqueViewers >= minimumPlays;

      const passesFilter =
        passesViewerFilter &&
        hasRatingKey &&
        itemMediaType !== null &&
        (!mediaType || itemMediaType === mediaType);

      if (!passesFilter) {
        const title = item.title || 'Unknown Title';

        // Track which reason(s) caused filtering
        if (!passesViewerFilter) {
          filteredByReason.insufficientViewers.push(title);
        }
        if (!hasRatingKey) {
          filteredByReason.missingRatingKey.push(title);
        }
        if (itemMediaType === null) {
          filteredByReason.unsupportedMediaType.push(title);
        }
        if (mediaType && itemMediaType !== mediaType) {
          filteredByReason.mediaTypeMismatch.push(title);
        }
      }

      return passesFilter;
    });

    // Log filtering summary grouped by reason
    Object.entries(filteredByReason).forEach(([reason, titles]) => {
      if (titles.length > 0) {
        const reasonMessages = {
          insufficientViewers: `Items filtered due to less than ${minimumPlays} unique viewers`,
          missingRatingKey: 'Items filtered due to missing rating key',
          unsupportedMediaType: 'Items filtered due to unsupported media type',
          mediaTypeMismatch: `Items filtered due to media type mismatch (expected: ${mediaType})`,
        };

        logger.info(reasonMessages[reason as keyof typeof reasonMessages], {
          label: 'Tautulli Collections',
          configName: config.name,
          count: titles.length,
          titles: titles.slice(0, 10), // Limit to first 10 titles to prevent log spam
          ...(titles.length > 10 && { additionalCount: titles.length - 10 }),
        });
      }
    });

    // Note: maxItems limit is now applied later in the BaseCollectionSync filtering stage

    // First create basic mapped items
    const basicMappedItems: TautulliCollectionItem[] = filteredItems
      .map((item) => {
        const ratingKey = item.rating_key?.toString() || '';
        const title = item.title || 'Unknown';
        const mediaType: 'movie' | 'tv' =
          item.media_type === 'episode' || item.media_type === 'show'
            ? 'tv'
            : 'movie';

        return {
          ratingKey,
          title,
          totalPlays: item.total_plays || 0,
          type: mediaType,
          tmdbId: item.tmdb_id,
          year: item.year,
        };
      })
      .filter((item) => item.ratingKey && item.title !== 'Unknown');

    // If we have a Plex client, fetch TMDB IDs for items that don't have them
    const mappedItems: TautulliCollectionItem[] = [];
    for (const item of basicMappedItems) {
      let tmdbId = item.tmdbId;

      // If no TMDB ID and we have Plex client, try to get it from Plex metadata
      if (!tmdbId && plexClient && item.ratingKey) {
        try {
          const plexMetadata = await plexClient.getMetadata(item.ratingKey);
          if (plexMetadata.Guid && plexMetadata.Guid.length > 0) {
            tmdbId = this.extractTmdbIdFromGuids(plexMetadata.Guid);
            logger.debug(`Extracted TMDB ID from Plex for ${item.title}`, {
              ratingKey: item.ratingKey,
              tmdbId,
            });
          }
        } catch (error) {
          logger.debug(`Failed to get Plex metadata for ${item.title}`, {
            ratingKey: item.ratingKey,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      mappedItems.push({
        ...item,
        tmdbId,
      });
    }

    const stats = this.createFilteringStats(
      sourceData.length,
      mappedItems.length,
      {
        'insufficient plays': sourceData.length - filteredItems.length,
        'missing rating key': filteredItems.length - mappedItems.length,
      }
    );

    return {
      items: mappedItems,
      stats,
      missingItems: [],
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
    processedCollectionKeys?: Set<string>,
    missingItems?: MissingItem[]
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
        processedCollectionKeys,
        undefined,
        missingItems
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
        `Failed to create Tautulli collection ${collectionName}`,
        { collectionName, itemCount: items.length },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  // Private helper methods

  /**
   * Get Tautulli API client with current settings
   */
  private async getTautulliClient(): Promise<TautulliAPI> {
    const settings = getSettings();
    // Create fresh client with current settings
    return new TautulliAPI(settings.tautulli);
  }

  private isValidTautulliConfig(config: CollectionConfig): boolean {
    return (
      config.type === 'tautulli' &&
      (config.subtype?.startsWith('most_popular') ||
        config.subtype?.startsWith('most_watched')) === true
    );
  }

  private getTimeRangeDays(config: CollectionConfig): number {
    // New implementation only supports modern customDays config
    return config.customDays && config.customDays > 0 ? config.customDays : 30;
  }

  private getSubtypeFromConfig(config: CollectionConfig): string {
    return config.subtype || 'most_popular';
  }

  private getCollectionTypeFromSubtype(
    config: CollectionConfig
  ): 'most_popular' | 'most_watched' {
    if (config.subtype?.startsWith('most_watched')) {
      return 'most_watched';
    }
    return 'most_popular';
  }

  /**
   * Process 'both' media types with separate API calls
   */
  private async processBothMediaTypesWithSeparateAPICalls(
    config: CollectionConfig,
    plexClient: PlexAPI,
    allCollections: PlexCollection[],
    processedCollectionKeys?: Set<string>
  ): Promise<SyncResult> {
    let totalCreated = 0;
    let totalUpdated = 0;

    const tautulli = await this.getTautulliClient();
    const timeRangeDays = this.getTimeRangeDays(config);
    const statType = config.tautulliStatType || 'plays';
    const collectionType = this.getCollectionTypeFromSubtype(config);

    // Process Movies
    try {
      const movieSourceData = await tautulli.getContent(
        'movie',
        timeRangeDays,
        statType,
        collectionType,
        9999
      );

      const movieMappedResult = await this.mapSourceDataToItems(
        movieSourceData,
        config,
        plexClient
      );
      const {
        items: movieItems,
        missingItems: movieMissingItems,
        mappingStats: movieMappingStats,
        filteringStats: movieFilteringStats,
      } = await this.applyFilteringToMappedItems(movieMappedResult, config);

      if (movieItems.length > 0) {
        const movieCollectionName = await this.generateCollectionNameWithCustom(
          config,
          'movie'
        );
        const movieResult = await this.createCollection(
          movieItems,
          'movie',
          movieCollectionName,
          plexClient,
          allCollections,
          config,
          processedCollectionKeys,
          movieMissingItems
        );

        totalCreated += movieResult.created;
        totalUpdated += movieResult.updated;

        // Log movie processing stats
        if (movieMappingStats && movieMappingStats.removed > 0) {
          logger.info(
            `Tautulli movie collection processed: ${movieItems.length} final items (${movieMappingStats.removed} items filtered out from ${movieMappingStats.original} total)`,
            {
              label: 'Tautulli Collections',
              configName: config.name,
              mediaType: 'movie',
              finalItems: movieItems.length,
              originalCount: movieMappingStats.original,
              removedCount: movieMappingStats.removed,
            }
          );
        }
      } else {
        logger.warn('No movie items to create collection from', {
          label: 'Tautulli Collections',
          configName: config.name,
          originalStatsCount: movieMappingStats?.original || 0,
          filteredCount: movieFilteringStats?.filtered || 0,
          removedCount:
            (movieMappingStats?.removed || 0) +
            (movieFilteringStats?.removed || 0),
        });
      }
    } catch (error) {
      logger.error(`Failed to process movie collection for ${config.name}`, {
        label: 'Tautulli Collections',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    // Process TV Shows
    try {
      const tvSourceData = await tautulli.getContent(
        'tv',
        timeRangeDays,
        statType,
        collectionType,
        9999
      );

      const tvMappedResult = await this.mapSourceDataToItems(
        tvSourceData,
        config,
        plexClient
      );
      const {
        items: tvItems,
        missingItems: tvMissingItems,
        mappingStats: tvMappingStats,
        filteringStats: tvFilteringStats,
      } = await this.applyFilteringToMappedItems(tvMappedResult, config);

      if (tvItems.length > 0) {
        const tvCollectionName = await this.generateCollectionNameWithCustom(
          config,
          'tv'
        );
        const tvResult = await this.createCollection(
          tvItems,
          'tv',
          tvCollectionName,
          plexClient,
          allCollections,
          config,
          processedCollectionKeys,
          tvMissingItems
        );

        totalCreated += tvResult.created;
        totalUpdated += tvResult.updated;

        // Log TV processing stats
        if (tvMappingStats && tvMappingStats.removed > 0) {
          logger.info(
            `Tautulli TV collection processed: ${tvItems.length} final items (${tvMappingStats.removed} items filtered out from ${tvMappingStats.original} total)`,
            {
              label: 'Tautulli Collections',
              configName: config.name,
              mediaType: 'tv',
              finalItems: tvItems.length,
              originalCount: tvMappingStats.original,
              removedCount: tvMappingStats.removed,
            }
          );
        }
      } else {
        logger.warn('No TV items to create collection from', {
          label: 'Tautulli Collections',
          configName: config.name,
          originalStatsCount: tvMappingStats?.original || 0,
          filteredCount: tvFilteringStats?.filtered || 0,
          removedCount:
            (tvMappingStats?.removed || 0) + (tvFilteringStats?.removed || 0),
        });
      }
    } catch (error) {
      logger.error(`Failed to process TV collection for ${config.name}`, {
        label: 'Tautulli Collections',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    return { created: totalCreated, updated: totalUpdated };
  }
}

// Export the new implementation
export default TautulliCollectionSync;
