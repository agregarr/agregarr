import MDBListAPI, {
  type MDBListMovie,
  type MDBListResponse,
  type MDBListShow,
} from '@server/api/mdblist';
import type PlexAPI from '@server/api/plexapi';
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
  MDBListSourceData,
  MDBListTemplateContext,
  MissingItem,
  PlexCollection,
  SyncResult,
} from '@server/lib/collections/core/types';
import { CollectionSyncErrorType } from '@server/lib/collections/core/types';
import type { CollectionConfig } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

interface MDBListCollectionItem extends CollectionItem {
  tmdbId: number;
}

/**
 * MDBList Collection Sync implementation using the base class
 *
 * Handles MDBList API types (user lists, top lists, custom lists)
 * with auto-request functionality and comprehensive error handling.
 */
export class MDBListCollectionSync extends BaseCollectionSync {
  private mdblistClients: Map<string, MDBListAPI> = new Map();

  constructor() {
    super('mdblist');
  }

  /**
   * Validate that MDBList API is properly configured
   */
  protected async validateConfiguration(): Promise<void> {
    const settings = getSettings();
    if (!settings.mdblist.apiKey) {
      throw this.createSyncError(
        CollectionSyncErrorType.CONFIGURATION_ERROR,
        'MDBList API key not configured'
      );
    }
  }

  /**
   * Process a single MDBList collection configuration
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
      if (!this.isValidMDBListConfig(config)) {
        throw this.createSyncError(
          CollectionSyncErrorType.CONFIGURATION_ERROR,
          `Invalid MDBList configuration: ${config.name}`
        );
      }

      // Fetch data from MDBList API
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
        libraryCache
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
          label: 'MDBList Collections',
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
      logger.error(`Detailed MDBList collection error for "${config.name}"`, {
        label: 'MDBList Collections',
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
        `Failed to process MDBList collection ${config.name}`,
        { configId: config.id, configName: config.name },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Create template context for MDBList collections
   */
  protected async createTemplateContext(
    config: CollectionConfig,
    mediaType: 'movie' | 'tv'
  ): Promise<MDBListTemplateContext> {
    return this.templateEngine.createMDBListContext(
      mediaType,
      'custom'
    ) as MDBListTemplateContext;
  }

  /**
   * Fetch data from MDBList API
   */
  public async fetchSourceData(
    config: CollectionConfig,
    options?: CollectionSyncOptions,
    libraryCache?: LibraryItemsCache // eslint-disable-line @typescript-eslint/no-unused-vars
  ): Promise<MDBListSourceData[]> {
    const settings = getSettings();
    const apiKey = settings.mdblist.apiKey;
    if (!apiKey) {
      throw this.createSyncError(
        CollectionSyncErrorType.CONFIGURATION_ERROR,
        'MDBList API key not configured'
      );
    }
    const mdblistClient = this.getMDBListClient(apiKey);
    const listType = this.getListTypeFromSubtype(config.subtype);

    const mdblistData: MDBListSourceData[] = [];

    if (options?.apiTimeout) {
      logger.debug(`API timeout set to ${options.apiTimeout}ms`, {
        label: 'MDBList Collections',
      });
    }

    const mediaType = getCollectionMediaType(config);

    try {
      if (listType !== 'custom') {
        throw this.createSyncError(
          CollectionSyncErrorType.CONFIGURATION_ERROR,
          `MDBList only supports custom lists. Invalid subtype: ${config.subtype}`
        );
      }

      if (!config.mdblistCustomListUrl) {
        throw this.createSyncError(
          CollectionSyncErrorType.CONFIGURATION_ERROR,
          'Custom MDBList list URL is required'
        );
      }

      // Strip query parameters from URL before calling MDBList API
      const cleanUrl =
        config.mdblistCustomListUrl?.split('?')[0] ||
        config.mdblistCustomListUrl;

      const customListData: MDBListResponse = await mdblistClient.getCustomList(
        cleanUrl,
        {
          limit: 9999,
        }
      );

      // Convert to standardized format
      const targetItems: (MDBListMovie | MDBListShow)[] =
        mediaType === 'movie' ? customListData.movies : customListData.shows;

      mdblistData.push(...targetItems.map((item) => ({ item, mediaType })));

      return mdblistData;
    } catch (error) {
      throw this.createSyncError(
        CollectionSyncErrorType.API_ERROR,
        `Failed to fetch data from MDBList API`,
        { listType, mediaType },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Map MDBList source data to standardized collection items
   */
  public async mapSourceDataToItems(
    sourceData: MDBListSourceData[],
    config: CollectionConfig,
    plexClient?: PlexAPI,
    libraryCache?: LibraryItemsCache
  ): Promise<{
    items: MDBListCollectionItem[];
    missingItems?: MissingItem[];
    stats?: FilteringStats;
  }> {
    const mappedItems: MDBListCollectionItem[] = [];
    const missingItems: MissingItem[] = [];

    // Extract all TMDB IDs and prepare lookup data
    const mdblistLookups: {
      tmdbId: number;
      mediaType: 'movie' | 'tv';
      title: string;
      year?: number;
      originalPosition: number;
    }[] = [];

    for (let index = 0; index < sourceData.length; index++) {
      const sourceItem = sourceData[index];
      try {
        // MDBList items have id (which is TMDB ID), title, and mediatype
        const item = sourceItem.item;

        if (!item.id) {
          continue;
        }

        // Convert mediatype from 'show' to 'tv' for consistency
        const itemMediaType = item.mediatype === 'show' ? 'tv' : item.mediatype;

        mdblistLookups.push({
          tmdbId: item.id,
          mediaType: itemMediaType as 'movie' | 'tv',
          title: item.title,
          year: item.release_year,
          originalPosition: index + 1, // 1-based position
        });
      } catch (error) {
        logger.warn(`Failed to process MDBList item: ${error}`, {
          label: 'MDBList Collections',
        });
      }
    }

    logger.info(
      `Extracted ${mdblistLookups.length} TMDB IDs from ${sourceData.length} MDBList items`,
      {
        label: 'MDBList Collections',
        sampleIds: mdblistLookups.slice(0, 5).map((l) => ({
          tmdbId: l.tmdbId,
          title: l.title,
          mediaType: l.mediaType,
        })),
      }
    );

    if (mdblistLookups.length === 0) {
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
        mdblistLookups,
        targetLibraryId,
        libraryCache,
        false // Library-scoped search for collection creation
      );
    } else {
      logger.warn('No Plex client provided to mapSourceDataToItems', {
        label: 'MDBList Collections',
      });
    }

    // Process items using the Plex lookup map
    for (const lookup of mdblistLookups) {
      const key = `${lookup.tmdbId}-${lookup.mediaType}`;

      const plexItem = plexLookup.get(key);

      if (plexItem) {
        const mappedItem = {
          ratingKey: plexItem.ratingKey,
          title: plexItem.title,
          type: lookup.mediaType,
          tmdbId: lookup.tmdbId,
          metadata: {
            libraryKey: plexItem.libraryKey,
          },
        };

        mappedItems.push(mappedItem);
      } else {
        // Item exists in MDBList but not in Plex
        missingItems.push({
          tmdbId: lookup.tmdbId,
          mediaType: lookup.mediaType,
          title: lookup.title,
          year: lookup.year,
          originalPosition: lookup.originalPosition,
        });
      }
    }

    const stats = this.createFilteringStats(
      sourceData.length,
      mappedItems.length,
      {
        'missing from plex': missingItems.length,
        'invalid data': sourceData.length - mdblistLookups.length,
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
        `Failed to create MDBList collection ${collectionName}`,
        { collectionName, itemCount: items.length },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  // Private helper methods

  private getMDBListClient(apiKey: string): MDBListAPI {
    if (!this.mdblistClients.has(apiKey)) {
      this.mdblistClients.set(apiKey, new MDBListAPI(apiKey));
    }
    const client = this.mdblistClients.get(apiKey);
    if (!client) {
      throw new Error(`Failed to get MDBList client for API key`);
    }
    return client;
  }

  private isValidMDBListConfig(config: CollectionConfig): boolean {
    if (config.type !== 'mdblist' || !config.subtype) {
      return false;
    }

    // Only custom lists are supported
    return config.subtype === 'custom';
  }

  private getListTypeFromSubtype(subtype: string | undefined): string {
    if (!subtype) return 'custom';

    // Only custom lists are supported
    return subtype === 'custom' ? 'custom' : 'custom';
  }

  private async handleAutoRequests(
    missingItems: MissingItem[],
    config: CollectionConfig
  ): Promise<void> {
    // Use the unified download service (routes to Overseerr or direct *arr based on config)
    await processMissingItemsWithMode(missingItems, config, 'mdblist');
  }
}

export default MDBListCollectionSync;
