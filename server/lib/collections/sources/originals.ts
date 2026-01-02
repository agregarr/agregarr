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
  CollectionSyncOptions,
  FilteringStats,
  MissingItem,
  OriginalsTemplateContext,
  PlexCollection,
  SyncResult,
} from '@server/lib/collections/core/types';
import { CollectionSyncErrorType } from '@server/lib/collections/core/types';
import type { CollectionConfig } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

interface OriginalsSourceData {
  item: MDBListMovie | MDBListShow;
  mediaType: 'movie' | 'tv';
}

interface OriginalsCollectionItem extends CollectionItem {
  tmdbId: number;
}

/**
 * Originals Collection Sync - Kometa's curated streaming platform originals lists
 *
 * Uses MDBList to fetch pre-curated lists of streaming platform originals.
 * Much faster and more reliable than web scraping.
 */
export class OriginalsCollectionSync extends BaseCollectionSync<'originals'> {
  private mdblistClients: Map<string, MDBListAPI> = new Map();

  // Map provider subtypes to Kometa's MDBList URLs
  private static readonly PROVIDER_MDBLIST_URLS: Record<string, string> = {
    apple_originals: 'https://mdblist.com/lists/k0meta/appletv-originals',
    disney_originals: 'https://mdblist.com/lists/k0meta/disney-originals',
    hbomax_originals: 'https://mdblist.com/lists/k0meta/hbomax-originals',
    hulu_originals: 'https://mdblist.com/lists/k0meta/hulu-originals',
    netflix_originals: 'https://mdblist.com/lists/k0meta/netflix-originals',
    paramount_originals: 'https://mdblist.com/lists/k0meta/paramount-originals',
    peacock_originals: 'https://mdblist.com/lists/k0meta/peacock-originals',
    amazon_originals: 'https://mdblist.com/lists/k0meta/amazon-originals',
    discovery_originals: 'https://mdblist.com/lists/k0meta/discovery-movies',
  };

  constructor() {
    super('originals');
  }

  /**
   * Get available streaming provider options for Originals collections
   * Based on Kometa's curated MDBList collections
   */
  public static getProviderOptions(): { value: string; label: string }[] {
    return [
      { value: 'netflix_originals', label: 'Netflix Originals' },
      { value: 'amazon_originals', label: 'Amazon Originals' },
      { value: 'disney_originals', label: 'Disney+ Originals' },
      { value: 'hbomax_originals', label: 'HBO Max Originals' },
      { value: 'paramount_originals', label: 'Paramount+ Originals' },
      { value: 'hulu_originals', label: 'Hulu Originals' },
      { value: 'peacock_originals', label: 'Peacock Originals' },
      { value: 'apple_originals', label: 'Apple TV+ Originals' },
      { value: 'discovery_originals', label: 'Discovery+ Movies' },
    ];
  }

  /**
   * Validate that MDBList API is properly configured
   */
  protected async validateConfiguration(): Promise<void> {
    const settings = getSettings();
    if (!settings.mdblist.apiKey) {
      throw this.createSyncError(
        CollectionSyncErrorType.CONFIGURATION_ERROR,
        'MDBList API key not configured (required for Originals collections)'
      );
    }
  }

  /**
   * Process a single Originals collection configuration
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
      if (!this.isValidOriginalsConfig(config)) {
        throw this.createSyncError(
          CollectionSyncErrorType.CONFIGURATION_ERROR,
          `Invalid Originals configuration: ${config.name}`
        );
      }

      // Fetch data from MDBList via Kometa's curated lists
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

      // Apply filtering safety net
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
          label: 'Originals Collections',
          configName: config.name,
          originalStatsCount: mappingStats?.original || 0,
          mappedCount: mappingStats?.filtered || 0,
          filteredCount: filteringStats?.filtered || 0,
          removedCount:
            (mappingStats?.removed || 0) + (filteringStats?.removed || 0),
        });
        return { created: 0, updated: 0 };
      }

      // Use the media type processing strategy
      return await this.processWithMediaTypeStrategy(
        finalItems,
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
        `Failed to process Originals collection ${config.name}`,
        { configId: config.id, configName: config.name },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Create template context for Originals collections
   */
  protected async createTemplateContext(
    config: CollectionConfig,
    mediaType: 'movie' | 'tv'
  ): Promise<OriginalsTemplateContext> {
    // Extract platform name from subtype (e.g., "netflix_originals" -> "netflix")
    const platformName = (config.subtype || '').replace(/_originals$/, '');

    return this.templateEngine.createOriginalsContext(
      mediaType,
      platformName
    ) as OriginalsTemplateContext;
  }

  /**
   * Fetch data from MDBList using Kometa's curated originals lists
   */
  public async fetchSourceData(
    config: CollectionConfig,
    options?: CollectionSyncOptions,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    libraryCache?: LibraryItemsCache
  ): Promise<OriginalsSourceData[]> {
    try {
      const settings = getSettings();
      const apiKey = settings.mdblist.apiKey;
      if (!apiKey) {
        throw this.createSyncError(
          CollectionSyncErrorType.CONFIGURATION_ERROR,
          'MDBList API key not configured'
        );
      }

      const mdblistClient = this.getMDBListClient(apiKey);

      // Get the MDBList URL for this provider
      const mdblistUrl =
        OriginalsCollectionSync.PROVIDER_MDBLIST_URLS[config.subtype || ''];

      if (!mdblistUrl) {
        throw this.createSyncError(
          CollectionSyncErrorType.CONFIGURATION_ERROR,
          `Unknown originals provider: ${config.subtype}`
        );
      }

      const platformName = (config.subtype || '').replace(/_originals$/, '');

      logger.info(`Fetching Originals data from Kometa's MDBList`, {
        label: 'Originals Collections',
        configName: config.name,
        platform: platformName,
        mdblistUrl,
      });

      if (options?.apiTimeout) {
        logger.debug(`API timeout set to ${options.apiTimeout}ms`, {
          label: 'Originals Collections',
        });
      }

      const mediaType = getCollectionMediaType(config);

      // Fetch from MDBList with pagination (MDBList has max 500 items per request)
      const allMovies: MDBListMovie[] = [];
      const allShows: MDBListShow[] = [];
      const pageSize = 500; // MDBList's maximum
      let offset = 0;
      let hasMore = true;

      logger.debug('Starting paginated fetch from MDBList', {
        label: 'Originals Collections',
        configName: config.name,
        pageSize,
      });

      while (hasMore) {
        const pageData: MDBListResponse = await mdblistClient.getCustomList(
          mdblistUrl,
          {
            limit: pageSize,
            offset,
            sort: 'released',
            order: 'desc',
          }
        );

        allMovies.push(...pageData.movies);
        allShows.push(...pageData.shows);

        const itemsInPage = pageData.movies.length + pageData.shows.length;
        logger.debug(`Fetched page at offset ${offset}`, {
          label: 'Originals Collections',
          configName: config.name,
          offset,
          itemsInPage,
          totalMovies: allMovies.length,
          totalShows: allShows.length,
        });

        // If we got less than pageSize items, we've reached the end
        hasMore = itemsInPage === pageSize;
        offset += pageSize;

        // Safety: prevent infinite loops
        if (offset > 10000) {
          logger.warn(
            'Reached safety limit of 10000 items, stopping pagination',
            {
              label: 'Originals Collections',
              configName: config.name,
            }
          );
          break;
        }
      }

      logger.info(
        `Fetched all items from MDBList (${allMovies.length} movies, ${allShows.length} shows)`,
        {
          label: 'Originals Collections',
          configName: config.name,
          totalMovies: allMovies.length,
          totalShows: allShows.length,
          totalItems: allMovies.length + allShows.length,
        }
      );

      const originalsData: OriginalsSourceData[] = [];

      // Convert to standardized format based on media type
      if (mediaType === 'movie') {
        originalsData.push(
          ...allMovies.map((item) => ({
            item,
            mediaType: 'movie' as const,
          }))
        );
      } else if (mediaType === 'tv') {
        originalsData.push(
          ...allShows.map((item) => ({
            item,
            mediaType: 'tv' as const,
          }))
        );
      } else {
        // 'both' - include both movies and shows
        originalsData.push(
          ...allMovies.map((item) => ({
            item,
            mediaType: 'movie' as const,
          })),
          ...allShows.map((item) => ({
            item,
            mediaType: 'tv' as const,
          }))
        );
      }

      logger.info(
        `Successfully fetched ${originalsData.length} items from Kometa's ${platformName} originals list`,
        {
          label: 'Originals Collections',
          configName: config.name,
          platform: platformName,
          itemCount: originalsData.length,
        }
      );

      return originalsData;
    } catch (error) {
      throw this.createSyncError(
        CollectionSyncErrorType.API_ERROR,
        `Failed to fetch data from MDBList`,
        { subtype: config.subtype },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Map Originals source data to standardized collection items
   */
  public async mapSourceDataToItems(
    sourceData: OriginalsSourceData[],
    config: CollectionConfig,
    plexClient?: PlexAPI,
    libraryCache?: LibraryItemsCache
  ): Promise<{
    items: OriginalsCollectionItem[];
    missingItems?: MissingItem[];
    stats?: FilteringStats;
  }> {
    const mappedItems: OriginalsCollectionItem[] = [];
    const missingItems: MissingItem[] = [];

    // Extract all TMDB IDs and prepare lookup data
    const originalsLookups: {
      tmdbId: number;
      mediaType: 'movie' | 'tv';
      title: string;
      year?: number;
      originalPosition: number;
    }[] = [];

    for (let index = 0; index < sourceData.length; index++) {
      const sourceItem = sourceData[index];
      try {
        const item = sourceItem.item;

        if (!item.id) {
          continue;
        }

        // Convert mediatype from 'show' to 'tv' for consistency
        const itemMediaType = item.mediatype === 'show' ? 'tv' : item.mediatype;

        originalsLookups.push({
          tmdbId: item.id,
          mediaType: itemMediaType as 'movie' | 'tv',
          title: item.title,
          year: item.release_year,
          originalPosition: index + 1, // 1-based position
        });
      } catch (error) {
        logger.warn(`Failed to process Originals item: ${error}`, {
          label: 'Originals Collections',
        });
      }
    }

    logger.info(
      `Extracted ${originalsLookups.length} TMDB IDs from ${sourceData.length} Originals items`,
      {
        label: 'Originals Collections',
        configName: config.name,
        extracted: originalsLookups.length,
        total: sourceData.length,
      }
    );

    // Use the existing Plex search with TMDB IDs
    if (originalsLookups.length > 0 && plexClient) {
      const targetLibraryId = Array.isArray(config.libraryId)
        ? config.libraryId[0]
        : config.libraryId;

      const plexLookup = await findPlexItemsByTmdbIds(
        plexClient,
        originalsLookups,
        targetLibraryId,
        libraryCache,
        false // Library-scoped search for collection creation
      );

      // Process items using the Plex lookup map
      for (const lookup of originalsLookups) {
        const key = `${lookup.tmdbId}-${lookup.mediaType}`;
        const plexItem = plexLookup.get(key);

        if (plexItem) {
          mappedItems.push({
            ratingKey: plexItem.ratingKey,
            title: lookup.title,
            type: lookup.mediaType,
            tmdbId: lookup.tmdbId,
            year: lookup.year,
            metadata: {
              libraryKey: plexItem.libraryKey,
              tmdbId: lookup.tmdbId,
            },
          });
        } else {
          // Item exists in MDBList but not in Plex
          missingItems.push({
            tmdbId: lookup.tmdbId,
            mediaType: lookup.mediaType,
            title: lookup.title,
            year: lookup.year,
            originalPosition: lookup.originalPosition,
            source: this.source,
          });
        }
      }
    }

    const stats = this.createFilteringStats(
      sourceData.length,
      mappedItems.length,
      {
        'missing from plex': missingItems.length,
      }
    );

    logger.info(`Originals mapping completed`, {
      label: 'Originals Collections',
      configName: config.name,
      found: mappedItems.length,
      missing: missingItems.length,
      total: sourceData.length,
    });

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
  ) {
    try {
      // Use the standardized approach via BaseCollectionSync
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
        `Failed to create Originals collection ${collectionName}`,
        { collectionName, itemCount: items.length },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  // Private helper methods

  /**
   * Get or create an MDBList client for the given API key
   */
  private getMDBListClient(apiKey: string): MDBListAPI {
    if (!this.mdblistClients.has(apiKey)) {
      this.mdblistClients.set(apiKey, new MDBListAPI(apiKey));
    }
    const client = this.mdblistClients.get(apiKey);
    if (!client) {
      throw new Error('Failed to get MDBList client');
    }
    return client;
  }

  /**
   * Validate if a configuration is a valid Originals config
   */
  private isValidOriginalsConfig(config: CollectionConfig): boolean {
    if (config.type !== 'originals' || !config.subtype) {
      return false;
    }

    // Check if the subtype maps to a known MDBList URL
    return config.subtype in OriginalsCollectionSync.PROVIDER_MDBLIST_URLS;
  }

  /**
   * Override autoPoster generation for originals with platform-specific branding
   */
  protected async generateAutoPoster(
    collectionName: string,
    config: CollectionConfig,
    collectionRatingKey: string,
    plexClient: PlexAPI,
    items?: CollectionItem[]
  ): Promise<void> {
    // Extract platform name from subtype (e.g., "netflix_originals" -> "netflix")
    const platformName = this.extractPlatformNameFromSubtype(
      config.subtype || ''
    );

    // Call base implementation with platform-specific override
    await super.generateAutoPoster(
      collectionName,
      config,
      collectionRatingKey,
      plexClient,
      items,
      undefined, // No userInfo for originals
      {
        collectionTypeOverride: platformName, // Use platform name for branding
      }
    );
  }

  /**
   * Extract clean platform name from subtype for branding
   */
  private extractPlatformNameFromSubtype(subtype: string): string {
    // Remove "_originals" suffix and normalize to match poster generation system
    const platformName = subtype.replace(/_originals$/, '');

    // Map to actual logo filenames and color schemes
    const platformMap: Record<string, string> = {
      apple: 'apple-tv',
      amazon: 'amazon-prime',
      hbomax: 'max',
    };

    return platformMap[platformName] || platformName;
  }

  /**
   * Handle auto-requests for missing items
   */
  private async handleAutoRequests(
    missingItems: MissingItem[],
    config: CollectionConfig
  ): Promise<void> {
    // Use the unified download service
    await processMissingItemsWithMode(missingItems, config, 'originals');
  }
}

export default OriginalsCollectionSync;
