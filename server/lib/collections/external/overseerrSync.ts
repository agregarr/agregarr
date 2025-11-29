import type PlexAPI from '@server/api/plexapi';
import { BaseCollectionSync } from '@server/lib/collections/core/BaseCollectionSync';
import {
  getCollectionMediaType,
  type LibraryItemsCache,
} from '@server/lib/collections/core/CollectionUtilities';
import type {
  CollectionItem,
  CollectionOperationResult,
  CollectionSyncError,
  CollectionSyncOptions,
  FilteringStats,
  MissingItem,
  OverseerrMediaRequest,
  OverseerrTemplateContext,
  OverseerrUser,
  PlexCollection,
  PlexLabel,
  SyncResult,
  UserCollections,
} from '@server/lib/collections/core/types';
import { CollectionSyncErrorType } from '@server/lib/collections/core/types';
import type { CollectionConfig } from '@server/lib/settings';
import logger from '@server/logger';
import { overseerrCollectionService } from './overseerr';

interface OverseerrCollectionItem extends CollectionItem {
  requestId: number;
  userId: number;
  createdAt: string;
}

interface OverseerrUserCollections {
  user: OverseerrUser;
  movies: OverseerrCollectionItem[];
  tv: OverseerrCollectionItem[];
}

interface UserCollectionsMap {
  [userId: number]: OverseerrUserCollections;
}

/**
 * New Overseerr Collection Sync implementation using the base class
 *
 * Handles three types of Overseerr collections:
 * - 'users': Individual collections per user based on their requests
 * - 'global': Single collection with all requests
 * - 'server_owner': Collection for server owner's requests only
 */
export class OverseerrCollectionSync extends BaseCollectionSync {
  constructor() {
    super('overseerr');
  }

  /**
   * Get the maximum items limit for a collection config
   */
  private getMaxItems(config: CollectionConfig): number {
    return config.maxItems && config.maxItems > 0 ? config.maxItems : 9999;
  }

  /**
   * Process collections with shared requests data for performance optimization
   * Fetches requests once and shares across all Overseerr collections
   */
  public async processCollectionsWithSharedData(
    collectionConfigs: CollectionConfig[],
    sharedRequests: OverseerrMediaRequest[],
    plexClient: PlexAPI,
    allCollections: PlexCollection[],
    processedCollectionKeys?: Set<string>,
    libraryCache?: LibraryItemsCache,
    options?: CollectionSyncOptions
  ): Promise<SyncResult> {
    const startTime = Date.now();
    let created = 0;
    let updated = 0;
    const errors: CollectionSyncError[] = [];

    // Filter configs for this source
    const sourceConfigs = this.filterConfigsForSource(collectionConfigs);

    if (sourceConfigs.length === 0) {
      return { created: 0, updated: 0 };
    }

    try {
      // Validate source is properly configured
      await this.validateConfiguration();

      // Process each configuration using shared data
      for (let i = 0; i < sourceConfigs.length; i++) {
        const config = sourceConfigs[i];

        try {
          // Fetch and map data once - no filtering yet (filtering happens per-user or per-collection type)
          const requests = await this.fetchSourceData(
            config,
            options,
            libraryCache
          );
          const { items: allItems } = await this.mapSourceDataToItems(
            requests,
            config
          );

          let result: SyncResult;
          switch (config.subtype) {
            case 'users':
              result = await this.processUserCollections(
                allItems as OverseerrCollectionItem[],
                config,
                plexClient,
                allCollections,
                processedCollectionKeys,
                options
              );
              break;

            case 'global':
              result = await this.processGlobalCollection(
                allItems,
                config,
                plexClient,
                allCollections,
                processedCollectionKeys
              );
              break;

            case 'server_owner':
              result = await this.processServerOwnerCollection(
                allItems,
                config,
                plexClient,
                allCollections,
                processedCollectionKeys
              );
              break;

            default:
              throw this.createSyncError(
                CollectionSyncErrorType.CONFIGURATION_ERROR,
                `Unsupported Overseerr subtype: ${config.subtype}`
              );
          }

          created += result.created;
          updated += result.updated;
        } catch (error) {
          const syncError = this.createSyncError(
            CollectionSyncErrorType.COLLECTION_ERROR,
            `Failed to process configuration ${config.name}`,
            { configId: config.id, configName: config.name },
            error instanceof Error ? error : new Error(String(error))
          );

          errors.push(syncError);

          if (options?.onError) {
            options.onError(syncError);
          }

          logger.error(syncError.message, {
            label: `${this.source} Collections`,
            ...syncError.details,
          });
        }
      }

      // Log summary if any changes were made
      if (created > 0 || updated > 0) {
        logger.info(
          `${this.source} collection processing: ${created} created, ${updated} updated`,
          {
            label: `${this.source} Collections`,
            processingTime: Date.now() - startTime,
          }
        );
      }

      return {
        created,
        updated,
        details: {
          processingTime: Date.now() - startTime,
          errors: errors.length,
        },
      };
    } catch (error) {
      const syncError = this.createSyncError(
        CollectionSyncErrorType.CONFIGURATION_ERROR,
        `Failed to process ${this.source} collections`,
        {},
        error instanceof Error ? error : new Error(String(error))
      );

      logger.error(syncError.message, {
        label: `${this.source} Collections`,
        error: syncError.details,
      });

      return { created: 0, updated: 0, error: syncError.message };
    }
  }

  /**
   * Validate that Overseerr collections can be processed
   */
  protected async validateConfiguration(): Promise<void> {
    // Test if we can get basic data from the service layer
    try {
      await overseerrCollectionService.getAdminUser();
    } catch (error) {
      throw this.createSyncError(
        CollectionSyncErrorType.DATABASE_ERROR,
        'Cannot access Overseerr data for collections (check connection if using external mode)'
      );
    }
  }

  /**
   * Process a single Overseerr collection configuration (required by base class)
   * Uses efficient single data fetch pattern
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
      if (!this.isValidOverseerrConfig(config)) {
        throw this.createSyncError(
          CollectionSyncErrorType.CONFIGURATION_ERROR,
          `Invalid Overseerr configuration: ${config.name}`
        );
      }

      // Fetch and map data once for this configuration
      const requests = await this.fetchSourceData(
        config,
        options,
        libraryCache
      );
      const { items: allItems } = await this.mapSourceDataToItems(
        requests,
        config
      );

      // Process based on subtype using pre-fetched data
      switch (config.subtype) {
        case 'users':
          return await this.processUserCollections(
            allItems as OverseerrCollectionItem[],
            config,
            plexClient,
            allCollections,
            processedCollectionKeys,
            options
          );

        case 'global':
          return await this.processGlobalCollection(
            allItems,
            config,
            plexClient,
            allCollections,
            processedCollectionKeys
          );

        case 'server_owner':
          return await this.processServerOwnerCollection(
            allItems,
            config,
            plexClient,
            allCollections,
            processedCollectionKeys
          );

        default:
          throw this.createSyncError(
            CollectionSyncErrorType.CONFIGURATION_ERROR,
            `Unsupported Overseerr subtype: ${config.subtype}`
          );
      }
    } catch (error) {
      throw this.createSyncError(
        CollectionSyncErrorType.COLLECTION_ERROR,
        `Failed to process Overseerr collection ${config.name}`,
        { configId: config.id, configName: config.name },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Create template context for Overseerr collections
   */
  protected async createTemplateContext(
    config: CollectionConfig,
    mediaType: 'movie' | 'tv'
  ): Promise<OverseerrTemplateContext> {
    // For server_owner collections, get the actual server owner user data
    if (config.subtype === 'server_owner') {
      const serverOwner = await this.getServerOwnerUser();
      if (serverOwner) {
        return this.templateEngine.createEnhancedOverseerrContext(
          mediaType,
          {
            displayName: serverOwner.displayName || undefined,
            username: serverOwner.username || undefined,
            plexUsername: serverOwner.plexUsername || undefined,
            plexTitle: serverOwner.plexTitle || undefined,
            email: serverOwner.email || undefined,
            plexId: serverOwner.plexId || undefined,
            id: serverOwner.id || undefined,
          },
          undefined,
          true
        ) as Promise<OverseerrTemplateContext>;
      }
    }

    return this.templateEngine.createEnhancedOverseerrContext(
      mediaType,
      { displayName: 'User', username: 'user' } // Default user context
    ) as Promise<OverseerrTemplateContext>;
  }

  /**
   * Fetch data from service layer (approved requests)
   * For performance, this should be called once and shared across all Overseerr collections
   */
  public async fetchSourceData(
    config: CollectionConfig,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Required by interface, not used in data fetching phase
    options?: CollectionSyncOptions,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Used in mapSourceDataToItems via processConfiguration
    libraryCache?: LibraryItemsCache
  ): Promise<OverseerrMediaRequest[]> {
    // Get all requests from service layer - Plex availability determines inclusion
    let requests = await overseerrCollectionService.getCollectionRequests();

    // Apply filtering similar to the old database query
    requests = requests.filter((request) => {
      // Only requests with media and user data
      if (!request.media || !request.requestedBy) return false;

      // Exclude Trakt service users from Overseerr collections
      if (
        request.requestedBy &&
        typeof request.requestedBy === 'object' &&
        'email' in request.requestedBy
      ) {
        const email = request.requestedBy.email;
        if (
          email &&
          email.includes('@') &&
          email.includes('traktcollections')
        ) {
          return false;
        }
      }

      // Check for valid rating keys
      const hasValidRatingKey = request.is4k
        ? request.media.ratingKey4k &&
          request.media.ratingKey4k !== '' &&
          request.media.ratingKey4k !== 'null' &&
          request.media.ratingKey4k !== 'undefined'
        : request.media.ratingKey &&
          request.media.ratingKey !== '' &&
          request.media.ratingKey !== 'null' &&
          request.media.ratingKey !== 'undefined';

      if (!hasValidRatingKey) return false;

      return true;
    });

    // Apply user filter for server_owner subtype
    if (config.subtype === 'server_owner') {
      const adminUser = await this.getServerOwnerUser();

      if (adminUser) {
        requests = requests.filter(
          (request) =>
            request.requestedBy && request.requestedBy.id === adminUser.id
        );
      } else {
        logger.warn('No server owner found for server_owner collection', {
          label: 'Overseerr Collections',
          configName: config.name,
        });
        return [];
      }
    }

    // Apply user filter for users subtype - exclude admin user from individual user collections
    if (config.subtype === 'users') {
      const adminUser = await this.getServerOwnerUser();

      if (adminUser) {
        requests = requests.filter(
          (request) =>
            request.requestedBy && request.requestedBy.id !== adminUser.id
        );
      }
    }

    // Requests are already sorted newest first by the service layer
    // No need to sort again here - this eliminates duplicate sorting

    return requests;
  }

  /**
   * Map OverseerrMediaRequest data to standardized collection items
   */
  public async mapSourceDataToItems(
    sourceData: OverseerrMediaRequest[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    config: CollectionConfig
  ): Promise<{
    items: OverseerrCollectionItem[];
    missingItems?: MissingItem[];
    stats?: FilteringStats;
  }> {
    const mappedItems: OverseerrCollectionItem[] = [];

    for (const request of sourceData) {
      const ratingKey = request.is4k
        ? request.media?.ratingKey4k
        : request.media?.ratingKey;

      if (!ratingKey || !request.requestedBy) continue;

      mappedItems.push({
        ratingKey: ratingKey.toString(),
        title: request.media?.title || 'Unknown',
        type: request.type as 'movie' | 'tv',
        requestId: request.id,
        userId: request.requestedBy.id,
        tmdbId: request.media?.tmdbId,
        createdAt: request.createdAt,
      });
    }

    // Don't limit here - apply limits later during collection creation
    const stats = this.createFilteringStats(
      sourceData.length,
      mappedItems.length,
      {
        'missing rating key or user': sourceData.length - mappedItems.length,
      }
    );

    return {
      items: mappedItems,
      stats,
      // Overseerr doesn't have missing items (all items are already available)
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
    userOverride?: OverseerrUser
  ): Promise<CollectionOperationResult> {
    try {
      // Use userOverride for user collections, otherwise create context based on subtype
      const userContext =
        userOverride || (await this.createUserContextForSubtype(config));
      if (!userContext) {
        throw new Error(
          `Unable to create user context for subtype: ${config.subtype}`
        );
      }
      const customLabel = this.createLabelForSubtype(config, userContext);
      const libraryKey = this.getLibraryKeyFromConfig(config);

      // SMART COLLECTION PATH: Skip base collection entirely when showUnwatchedOnly is enabled
      if (config.showUnwatchedOnly) {
        // Create label-based smart collection directly without wasteful base collection
        const result = await this.handleUserSmartCollectionCreation(
          plexClient,
          items,
          collectionName,
          mediaType,
          libraryKey,
          config,
          userContext,
          customLabel,
          allCollections
        );

        return {
          created: result.created,
          updated: result.updated,
          collectionRatingKey: result.collectionRatingKey,
          itemCount: items.length,
          stats: undefined,
        };
      }

      // REGULAR COLLECTION PATH: Create/update base collection normally
      const result = await this.createOrUpdateCollectionStandardized(
        items,
        collectionName,
        mediaType,
        config,
        plexClient,
        allCollections,
        processedCollectionKeys,
        {
          userId: userContext?.plexId || userContext?.id,
          customLabel,
        }
      );

      // Handle smart collection cleanup if user disabled showUnwatchedOnly
      if (result.collectionRatingKey && config.showUnwatchedOnly === false) {
        await this.handleUserSmartCollectionCleanup(
          plexClient,
          config,
          userContext
        );
      }

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
        `Failed to create Overseerr collection ${collectionName}`,
        { collectionName, itemCount: items.length },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  // Private methods for handling different subtypes

  private async processUserCollections(
    allItems: OverseerrCollectionItem[],
    config: CollectionConfig,
    plexClient: PlexAPI,
    allCollections: PlexCollection[],
    processedCollectionKeys?: Set<string>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    options?: CollectionSyncOptions
  ): Promise<SyncResult> {
    // Group by user first
    const userCollectionsMap = await this.groupItemsByUser(allItems);

    let totalCreated = 0;
    let totalUpdated = 0;

    // Process each user's collections
    for (const [, userCollections] of Object.entries(userCollectionsMap)) {
      try {
        const result = await this.processUserCollection(
          userCollections,
          config,
          plexClient,
          allCollections,
          processedCollectionKeys
        );

        totalCreated += result.created;
        totalUpdated += result.updated;
      } catch (error) {
        logger.error(
          `Failed to process collection for user ${userCollections.user.displayName}: ${error}`,
          {
            label: 'Overseerr Collections',
            userId: userCollections.user.id,
            userName: userCollections.user.displayName,
          }
        );
      }
    }

    return { created: totalCreated, updated: totalUpdated };
  }

  private async processGlobalCollection(
    allItems: CollectionItem[],
    config: CollectionConfig,
    plexClient: PlexAPI,
    allCollections: PlexCollection[],
    processedCollectionKeys?: Set<string>
  ): Promise<SyncResult> {
    if (allItems.length === 0) {
      logger.warn('No items for global collection', {
        label: 'Overseerr Collections',
        configName: config.name,
      });
      return { created: 0, updated: 0 };
    }

    // Simple direct approach: filter by media type, apply ordering options, apply maxItems, create collection
    const mediaType = getCollectionMediaType(config);
    const mediaItems = allItems.filter((item) => item.type === mediaType);

    if (mediaItems.length === 0) {
      logger.warn(`No ${mediaType} items for global collection`, {
        label: 'Overseerr Collections',
        configName: config.name,
        mediaType,
      });
      return { created: 0, updated: 0 };
    }

    // Apply maxItems limit
    const limitedItems = mediaItems.slice(0, this.getMaxItems(config));

    // Process template for global collections
    const collectionName = await this.createGlobalCollectionName(
      config,
      mediaType,
      plexClient
    );

    const result = await this.createCollection(
      limitedItems,
      mediaType,
      collectionName,
      plexClient,
      allCollections,
      config,
      processedCollectionKeys
    );

    return { created: result.created, updated: result.updated };
  }

  private async processServerOwnerCollection(
    allItems: CollectionItem[],
    config: CollectionConfig,
    plexClient: PlexAPI,
    allCollections: PlexCollection[],
    processedCollectionKeys?: Set<string>
  ): Promise<SyncResult> {
    if (allItems.length === 0) {
      logger.warn('No items for server owner collection', {
        label: 'Overseerr Collections',
        configName: config.name,
      });
      return { created: 0, updated: 0 };
    }

    // Simple direct approach: filter by media type, apply maxItems, create collection
    const mediaType = getCollectionMediaType(config);
    const mediaItems = allItems.filter((item) => item.type === mediaType);

    if (mediaItems.length === 0) {
      logger.warn(`No ${mediaType} items for server owner collection`, {
        label: 'Overseerr Collections',
        configName: config.name,
        mediaType,
      });
      return { created: 0, updated: 0 };
    }

    // Apply maxItems limit
    const limitedItems = mediaItems.slice(0, this.getMaxItems(config));

    const serverOwner = await this.getServerOwnerUser();
    if (!serverOwner) {
      logger.error('Server owner not found for server owner collection', {
        label: 'Overseerr Collections',
        configName: config.name,
      });
      return { created: 0, updated: 0 };
    }

    // Process template for server owner collections
    const collectionName = await this.createServerOwnerCollectionName(
      serverOwner,
      config,
      mediaType,
      plexClient
    );

    const result = await this.createCollection(
      limitedItems,
      mediaType,
      collectionName,
      plexClient,
      allCollections,
      config,
      processedCollectionKeys,
      serverOwner
    );

    // Update config with rating key for server_owner collections (for cleanup matching)
    if (result.collectionRatingKey) {
      this.updateConfigWithRatingKey(config, result.collectionRatingKey);
    }

    return { created: result.created, updated: result.updated };
  }

  private async processUserCollection(
    userCollections: UserCollections,
    config: CollectionConfig,
    plexClient: PlexAPI,
    allCollections: PlexCollection[],
    processedCollectionKeys?: Set<string>
  ): Promise<SyncResult> {
    let totalCreated = 0;
    let totalUpdated = 0;

    // Get the media type for this collection and filter accordingly
    const collectionMediaType = getCollectionMediaType(config);
    const allItems = [...userCollections.movies, ...userCollections.tv];

    // Sort combined items by createdAt to preserve chronological order
    allItems.sort((a, b) => {
      const dateA = new Date(
        (a as OverseerrCollectionItem).createdAt
      ).getTime();
      const dateB = new Date(
        (b as OverseerrCollectionItem).createdAt
      ).getTime();
      return dateB - dateA; // Descending (newest first)
    });

    const mediaItems = allItems.filter(
      (item) => item.type === collectionMediaType
    );

    if (mediaItems.length === 0) {
      return { created: 0, updated: 0 };
    }

    // Apply maxItems
    const limitedItems = mediaItems.slice(0, this.getMaxItems(config));

    // Process the collection (simple, direct approach)
    if (limitedItems.length > 0) {
      const collectionName = await this.createUserCollectionName(
        userCollections.user,
        config,
        collectionMediaType,
        plexClient
      );
      const result = await this.createCollection(
        limitedItems,
        collectionMediaType,
        collectionName,
        plexClient,
        allCollections,
        config,
        processedCollectionKeys,
        userCollections.user // Pass the real user for user collections
      );

      totalCreated += result.created;
      totalUpdated += result.updated;

      // Apply sort title to user collection if needed (not handled by base class since no collectionRatingKey in config)
      if (result.collectionRatingKey && !config.showUnwatchedOnly) {
        await this.applyUserCollectionSortTitle(
          result.collectionRatingKey,
          collectionName,
          config,
          plexClient
        );
      }
    }

    return { created: totalCreated, updated: totalUpdated };
  }

  // Helper methods

  /**
   * Apply sort title to user collection (handles promoted collections with exclamation marks)
   * This is needed because user collections don't have collectionRatingKey stored in config,
   * so BaseCollectionSync.updateCollectionMetadata can't find the matching config
   */
  private async applyUserCollectionSortTitle(
    collectionRatingKey: string,
    collectionName: string,
    config: CollectionConfig,
    plexClient: PlexAPI
  ): Promise<void> {
    const sortOrderLibrary = config.sortOrderLibrary;
    const isLibraryPromoted = config.isLibraryPromoted;

    if (sortOrderLibrary === undefined) {
      return; // No sort order configured
    }

    let sortTitle: string;

    // Treat sortOrderLibrary > 0 as promoted even if isLibraryPromoted is undefined
    if (isLibraryPromoted !== false && sortOrderLibrary > 0) {
      // Promoted: Calculate exclamation marks based on other promoted collections in same library
      const { getSettings } = await import('@server/lib/settings');
      const settings = getSettings();
      const allConfigs = settings.plex.collectionConfigs || [];
      const libraryKey = this.getLibraryKeyFromConfig(config);

      const sameLibraryConfigs = allConfigs.filter((c: CollectionConfig) => {
        const configLibraryId = Array.isArray(c.libraryId)
          ? c.libraryId[0]
          : c.libraryId;
        return (
          configLibraryId === libraryKey &&
          c.sortOrderLibrary !== undefined &&
          c.isLibraryPromoted === true
        );
      });

      if (sameLibraryConfigs.length > 0) {
        const sortOrders = sameLibraryConfigs
          .map((c: CollectionConfig) => c.sortOrderLibrary)
          .filter((order): order is number => order !== undefined);
        const maxSortOrder = Math.max(...sortOrders);
        const exclamationCount = maxSortOrder - sortOrderLibrary + 2;
        const exclamationPrefix = '!'.repeat(exclamationCount);
        sortTitle = `${exclamationPrefix}${collectionName}`;
      } else {
        sortTitle = `!!${collectionName}`;
      }
    } else {
      // Not promoted: Use natural title
      sortTitle = collectionName;
    }

    await plexClient.updateCollectionSortTitle(collectionRatingKey, sortTitle);

    logger.debug(`Applied sort title to user collection: ${sortTitle}`, {
      label: 'Overseerr User Collection',
      collectionName,
      collectionRatingKey,
      isLibraryPromoted,
      sortOrderLibrary,
    });
  }

  private isValidOverseerrConfig(config: CollectionConfig): boolean {
    return (
      config.type === 'overseerr' &&
      ['users', 'global', 'server_owner'].includes(config.subtype || '')
    );
  }

  /**
   * Get library key from config (helper method)
   */
  private getLibraryKeyFromConfig(config: CollectionConfig): string {
    // For array-type libraryId, use the first library
    const libraryId = Array.isArray(config.libraryId)
      ? config.libraryId[0]
      : config.libraryId;
    return libraryId || '';
  }

  /**
   * Handle smart collection creation for user collections using label-based identification
   */
  private async handleUserSmartCollectionCreation(
    plexClient: PlexAPI,
    items: CollectionItem[],
    collectionName: string,
    mediaType: 'movie' | 'tv',
    libraryKey: string,
    config: CollectionConfig,
    userContext: OverseerrUser,
    customLabel: string,
    allCollections: PlexCollection[]
  ): Promise<{
    created: number;
    updated: number;
    collectionRatingKey?: string;
  }> {
    try {
      const userId = userContext?.plexId || userContext?.id;
      if (!userId) {
        logger.warn('No user ID available for smart collection creation', {
          label: 'Overseerr User Smart Collection Creation',
          collectionName,
        });
        return { created: 0, updated: 0 };
      }

      // Generate unique label name for this user's collection items
      const itemLabelName = `agregarr-unwatched-${config.id}-${userId}`;
      const smartLabel = customLabel; // Use same label as base collection would have used

      logger.debug(
        `Setting up label-based smart collection for user "${collectionName}"`,
        {
          label: 'Overseerr User Smart Collection Creation',
          collectionName,
          itemLabelName,
          userId,
        }
      );

      // Convert items to rating keys
      const itemRatingKeys = items.map((item) => item.ratingKey);

      if (itemRatingKeys.length === 0) {
        logger.warn(
          `No items provided for user ${userId}, skipping smart collection`,
          {
            label: 'Overseerr User Smart Collection Creation',
            collectionName,
            userId,
          }
        );
        return { created: 0, updated: 0 };
      }

      logger.info(
        `Labeling ${itemRatingKeys.length} items for user smart collection`,
        {
          label: 'Overseerr User Smart Collection Creation',
          collectionName,
          itemLabelName,
          itemCount: itemRatingKeys.length,
          userId,
        }
      );

      // Add label to all collection items
      for (const itemKey of itemRatingKeys) {
        try {
          await plexClient.addLabelToItem(itemKey, itemLabelName);
        } catch (error) {
          logger.warn(
            `Failed to add label to item ${itemKey}, item may have been deleted from Plex, or item may already have label`,
            {
              label: 'Overseerr User Smart Collection Creation',
              itemKey,
              labelName: itemLabelName,
              error: error instanceof Error ? error.message : String(error),
            }
          );
          // Continue with other items even if one fails
        }
      }

      // CLEANUP: Remove labels from items that are no longer in the collection
      try {
        const currentlyLabeledItems = await plexClient.getItemsWithLabel(
          libraryKey,
          itemLabelName
        );

        const itemsToUnlabel = currentlyLabeledItems.filter(
          (labeledItemKey) => !itemRatingKeys.includes(labeledItemKey)
        );

        if (itemsToUnlabel.length > 0) {
          logger.info(
            `Removing label from ${itemsToUnlabel.length} items no longer in user collection`,
            {
              label: 'Overseerr User Smart Collection Creation',
              collectionName,
              itemLabelName,
              itemsToUnlabel: itemsToUnlabel.length,
              userId,
            }
          );
          for (const itemKey of itemsToUnlabel) {
            await plexClient.removeLabelFromItem(itemKey, itemLabelName);
          }
        }
      } catch (error) {
        logger.warn(
          `Failed to cleanup labels from removed items in user collection`,
          {
            label: 'Overseerr User Smart Collection Creation',
            collectionName,
            userId,
            error: error instanceof Error ? error.message : String(error),
          }
        );
      }

      // MIGRATION: Check for old dual-collection system (dash-prefixed base + smart collection)
      // Match by label first, then fall back to name matching (like BaseCollectionSync)
      let oldDashPrefixedBase: PlexCollection | null = null;
      let oldRegularCollection: PlexCollection | null = null;
      let existingSmartCollection: PlexCollection | null = null;

      // First pass: Find by label (most reliable)
      for (const collection of allCollections) {
        if (collection.libraryKey !== libraryKey) continue;

        const hasMatchingLabel = collection.labels?.some(
          (label: string | PlexLabel) => {
            const labelText = typeof label === 'string' ? label : label.tag;
            return labelText === smartLabel;
          }
        );

        if (hasMatchingLabel) {
          const isSmart = collection.smart === '1';

          if (isSmart) {
            existingSmartCollection = collection;
          } else if (collection.title.startsWith('-')) {
            oldDashPrefixedBase = collection;
          } else {
            // Regular collection (user switching from regular to smart mode)
            oldRegularCollection = collection;
          }
        }
      }

      // Second pass: Fallback to name matching if no label match (orphaned collections)
      if (
        !existingSmartCollection &&
        !oldDashPrefixedBase &&
        !oldRegularCollection
      ) {
        for (const collection of allCollections) {
          if (collection.libraryKey !== libraryKey) continue;

          // Check for orphaned agregarr collections by name
          const hasAgregarrLabel = collection.labels?.some(
            (label: string | PlexLabel) => {
              const labelText = typeof label === 'string' ? label : label.tag;
              return labelText.toLowerCase().startsWith('agregarr');
            }
          );

          if (hasAgregarrLabel) {
            const isSmart = collection.smart === '1';

            if (isSmart && collection.title === collectionName) {
              existingSmartCollection = collection;
              logger.info(
                `Found orphaned smart collection by name: "${collection.title}" - will update label`,
                {
                  label: 'Overseerr User Smart Collection Migration',
                  collectionTitle: collection.title,
                  ratingKey: collection.ratingKey,
                  userId,
                }
              );
            } else if (!isSmart && collection.title === `-${collectionName}`) {
              oldDashPrefixedBase = collection;
              logger.info(
                `Found orphaned dash-prefixed base collection by name: "${collection.title}" - will delete`,
                {
                  label: 'Overseerr User Smart Collection Migration',
                  collectionTitle: collection.title,
                  ratingKey: collection.ratingKey,
                  userId,
                }
              );
            } else if (!isSmart && collection.title === collectionName) {
              oldRegularCollection = collection;
              logger.info(
                `Found orphaned regular collection by name: "${collection.title}" - will delete`,
                {
                  label: 'Overseerr User Smart Collection Migration',
                  collectionTitle: collection.title,
                  ratingKey: collection.ratingKey,
                  userId,
                }
              );
            }
          }
        }
      }

      // Delete old dash-prefixed base collection if found
      if (oldDashPrefixedBase) {
        logger.info(
          `Deleting old dash-prefixed base collection: ${oldDashPrefixedBase.title}`,
          {
            label: 'Overseerr User Smart Collection Migration',
            collectionName,
            oldBaseRatingKey: oldDashPrefixedBase.ratingKey,
            userId,
          }
        );
        try {
          await plexClient.deleteCollection(oldDashPrefixedBase.ratingKey);
        } catch (error) {
          logger.warn(
            `Failed to delete old base collection, continuing migration`,
            {
              label: 'Overseerr User Smart Collection Migration',
              error: error instanceof Error ? error.message : String(error),
            }
          );
        }
      }

      // Delete old regular collection if found (user switching from regular to smart mode)
      if (oldRegularCollection) {
        logger.info(
          `Deleting old regular collection (switching to smart mode): ${oldRegularCollection.title}`,
          {
            label: 'Overseerr User Smart Collection Migration',
            collectionName,
            oldRegularRatingKey: oldRegularCollection.ratingKey,
            userId,
          }
        );
        try {
          await plexClient.deleteCollection(oldRegularCollection.ratingKey);
        } catch (error) {
          logger.warn(
            `Failed to delete old regular collection, continuing migration`,
            {
              label: 'Overseerr User Smart Collection Migration',
              error: error instanceof Error ? error.message : String(error),
            }
          );
        }
      }

      let smartCollectionRatingKey = '';
      let created = 0;
      let updated = 0;

      if (existingSmartCollection) {
        // Smart collection exists, update its filter and sort option
        smartCollectionRatingKey = existingSmartCollection.ratingKey;
        logger.debug(
          `Found existing smart collection: ${existingSmartCollection.title}`,
          {
            label: 'Overseerr User Smart Collection Creation',
            smartCollectionRatingKey,
            userId,
          }
        );

        // Update smart collection to use label-based filter
        const sortOption = config.smartCollectionSort?.value || 'titleSort';
        try {
          await plexClient.updateLabelBasedSmartCollectionUri(
            smartCollectionRatingKey,
            libraryKey,
            itemLabelName,
            mediaType,
            sortOption
          );
          updated = 1;
        } catch (error) {
          // Smart collection update failed (likely broken/invalid) - delete and recreate
          logger.warn(
            `Failed to update existing smart collection, will delete and recreate`,
            {
              label: 'Overseerr User Smart Collection Creation',
              smartCollectionRatingKey,
              userId,
              error: error instanceof Error ? error.message : String(error),
            }
          );

          // Delete the broken smart collection
          await plexClient.deleteSmartCollection(smartCollectionRatingKey);

          // Clear the variable so we recreate it below
          smartCollectionRatingKey = '';
        }
      }

      if (!existingSmartCollection || !smartCollectionRatingKey) {
        // Create new label-based smart collection
        const sortOption = config.smartCollectionSort?.value || 'titleSort';
        const createdSmartCollectionRatingKey =
          await plexClient.createLabelBasedSmartCollection(
            collectionName, // Smart collection gets the original user-friendly name
            libraryKey,
            itemLabelName, // Filter by label instead of base collection
            mediaType,
            sortOption,
            smartLabel // Add Agregarr management label
          );

        if (!createdSmartCollectionRatingKey) {
          logger.error(
            `Failed to create label-based smart collection for user collection "${collectionName}"`,
            {
              label: 'Overseerr User Smart Collection Creation',
              collectionName,
              userId,
              libraryKey,
              mediaType,
            }
          );
          return { created: 0, updated: 0 };
        }

        smartCollectionRatingKey = createdSmartCollectionRatingKey;
        created = 1;

        logger.info(
          `Created label-based smart collection for user collection "${collectionName}"`,
          {
            label: 'Overseerr User Smart Collection Creation',
            collectionName,
            userId,
            smartCollectionRatingKey,
            smartLabel,
            itemLabelName,
            sortOption,
          }
        );
      }

      // Apply metadata to smart collection (sort title, visibility, poster)
      // Replicate what updateCollectionMetadata does in BaseCollectionSync
      if (smartCollectionRatingKey) {
        // Calculate and apply sort title (handles promotion with exclamation marks)
        const sortOrderLibrary = config.sortOrderLibrary;
        const isLibraryPromoted = config.isLibraryPromoted;

        if (sortOrderLibrary !== undefined) {
          let sortTitle: string;

          // Treat sortOrderLibrary > 0 as promoted even if isLibraryPromoted is undefined
          if (isLibraryPromoted !== false && sortOrderLibrary > 0) {
            // Promoted: Calculate exclamation marks based on other promoted collections in same library
            const { getSettings } = await import('@server/lib/settings');
            const settings = getSettings();
            const allConfigs = settings.plex.collectionConfigs || [];
            const sameLibraryConfigs = allConfigs.filter(
              (c: CollectionConfig) => {
                const configLibraryId = Array.isArray(c.libraryId)
                  ? c.libraryId[0]
                  : c.libraryId;
                return (
                  configLibraryId === libraryKey &&
                  c.sortOrderLibrary !== undefined &&
                  c.isLibraryPromoted === true
                );
              }
            );

            if (sameLibraryConfigs.length > 0) {
              const sortOrders = sameLibraryConfigs
                .map((c: CollectionConfig) => c.sortOrderLibrary)
                .filter((order): order is number => order !== undefined);
              const maxSortOrder = Math.max(...sortOrders);
              const exclamationCount = maxSortOrder - sortOrderLibrary + 2;
              const exclamationPrefix = '!'.repeat(exclamationCount);
              sortTitle = `${exclamationPrefix}${collectionName}`;
            } else {
              sortTitle = `!!${collectionName}`;
            }
          } else {
            // Not promoted: Use natural title
            sortTitle = collectionName;
          }

          await plexClient.updateCollectionSortTitle(
            smartCollectionRatingKey,
            sortTitle
          );
        }

        // Apply visibility settings to smart collection
        const visibilityConfig = config.visibilityConfig || {};
        const hasAnyVisibility =
          visibilityConfig.usersHome ||
          visibilityConfig.serverOwnerHome ||
          visibilityConfig.libraryRecommended;

        if (hasAnyVisibility) {
          await plexClient.updateCollectionVisibility(
            smartCollectionRatingKey,
            visibilityConfig.libraryRecommended ?? true,
            visibilityConfig.serverOwnerHome ?? false,
            visibilityConfig.usersHome ?? true
          );
        }
      }

      logger.info(`User smart collection ready`, {
        label: 'Overseerr User Smart Collection Creation',
        collectionName,
        userId,
        smartCollectionRatingKey,
        smartLabel,
        created,
        updated,
      });

      return {
        created,
        updated,
        collectionRatingKey: smartCollectionRatingKey,
      };
    } catch (error) {
      logger.error(
        `Error creating smart collection for user collection "${collectionName}"`,
        {
          label: 'Overseerr User Smart Collection Creation',
          collectionName,
          userId: userContext?.plexId || userContext?.id,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      // Return failure instead of throwing
      return { created: 0, updated: 0 };
    }
  }

  /**
   * Handle smart collection cleanup for user collections using label-based identification
   */
  private async handleUserSmartCollectionCleanup(
    plexClient: PlexAPI,
    config: CollectionConfig,
    userContext: OverseerrUser
  ): Promise<void> {
    const userId = userContext?.plexId || userContext?.id;
    if (!userId) return;

    try {
      // Find smart collection by same label as base collection (must have smart=1 property AND in correct library)
      const smartLabel = this.createLabelForSubtype(config, userContext);
      const libraryKey = this.getLibraryKeyFromConfig(config);

      const allCollections = await plexClient.getAllCollections();
      const smartCollection = allCollections.find(
        (collection: PlexCollection) => {
          const isSmart = collection.smart === '1';
          const hasMatchingLabel = collection.labels?.some(
            (label: string | PlexLabel) => {
              const labelText = typeof label === 'string' ? label : label.tag;
              return labelText === smartLabel;
            }
          );
          const inCorrectLibrary = collection.libraryKey === libraryKey;
          return isSmart && hasMatchingLabel && inCorrectLibrary;
        }
      );

      if (!smartCollection) {
        logger.debug(`No smart collection found for cleanup`, {
          label: 'Overseerr User Smart Collection Cleanup',
          userId,
          smartLabel,
        });
        return;
      }

      logger.info(
        `Cleaning up smart collection for user: ${smartCollection.title}`,
        {
          label: 'Overseerr User Smart Collection Cleanup',
          userId,
          smartCollectionRatingKey: smartCollection.ratingKey,
          smartLabel,
        }
      );

      // NEW APPROACH: Clean up item labels
      const itemLabelName = `agregarr-unwatched-${config.id}-${userId}`;
      const libraryId = this.getLibraryKeyFromConfig(config);

      try {
        const labeledItems = await plexClient.getItemsWithLabel(
          libraryId,
          itemLabelName
        );

        if (labeledItems.length > 0) {
          logger.info(
            `Removing label "${itemLabelName}" from ${labeledItems.length} items`,
            {
              label: 'Overseerr User Smart Collection Cleanup',
              userId,
              itemLabelName,
              itemCount: labeledItems.length,
            }
          );
          for (const itemKey of labeledItems) {
            await plexClient.removeLabelFromItem(itemKey, itemLabelName);
          }
        }
      } catch (error) {
        logger.warn(
          `Failed to cleanup labels during smart collection cleanup`,
          {
            label: 'Overseerr User Smart Collection Cleanup',
            userId,
            itemLabelName,
            error: error instanceof Error ? error.message : String(error),
          }
        );
      }

      // Delete the smart collection
      await plexClient.deleteSmartCollection(smartCollection.ratingKey);

      logger.info(`Successfully cleaned up smart collection for user`, {
        label: 'Overseerr User Smart Collection Cleanup',
        userId,
        collectionTitle: smartCollection.title,
      });
    } catch (error) {
      logger.error(`Error cleaning up smart collection for user`, {
        label: 'Overseerr User Smart Collection Cleanup',
        userId,
        configName: config.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async groupItemsByUser(
    items: OverseerrCollectionItem[]
  ): Promise<UserCollectionsMap> {
    const userCollectionsMap: UserCollectionsMap = {};

    // Get users from service layer (will handle both internal and external modes)
    const allUsers = await overseerrCollectionService.getUsersWithPlexIds();

    // Create map for efficient lookup
    const usersById = new Map(allUsers.map((user) => [user.id, user]));

    for (const item of items) {
      if (!userCollectionsMap[item.userId]) {
        const user = usersById.get(item.userId);
        if (!user) {
          // Skip items for users that don't exist
          continue;
        }

        userCollectionsMap[item.userId] = {
          user: user,
          movies: [],
          tv: [],
        };
      }

      const userCollections = userCollectionsMap[item.userId];
      if (item.type === 'movie') {
        userCollections.movies.push(item);
      } else {
        userCollections.tv.push(item);
      }
    }

    return userCollectionsMap;
  }

  private async createUserCollectionName(
    user: OverseerrUser,
    config: CollectionConfig,
    mediaType: 'movie' | 'tv',
    plexClient?: PlexAPI,
    isServerOwner?: boolean
  ): Promise<string> {
    const context = await this.templateEngine.createEnhancedOverseerrContext(
      mediaType,
      {
        displayName: user.displayName || undefined,
        username: user.username || undefined,
        plexUsername: user.plexUsername || undefined,
        plexTitle: user.plexTitle || undefined,
        email: user.email || undefined,
        plexId: user.plexId || undefined,
        id: user.id || undefined,
      },
      plexClient,
      isServerOwner
    );

    // Use custom templates only if template is set to 'custom', otherwise use main template
    const template = (() => {
      if (config.template === 'custom') {
        return mediaType === 'movie'
          ? config.customMovieTemplate || config.name
          : config.customTVTemplate || config.name;
      }
      return config.template || config.name;
    })();

    return this.templateEngine.processTemplate(template, context);
  }

  private async createServerOwnerCollectionName(
    user: OverseerrUser,
    config: CollectionConfig,
    mediaType: 'movie' | 'tv',
    plexClient?: PlexAPI
  ): Promise<string> {
    // Same logic as user collections - server owner is just a special user
    return this.createUserCollectionName(
      user,
      config,
      mediaType,
      plexClient,
      true
    );
  }

  private async createGlobalCollectionName(
    config: CollectionConfig,
    mediaType: 'movie' | 'tv',
    plexClient?: PlexAPI
  ): Promise<string> {
    // Create context for global collections using enhanced Overseerr context with external settings
    const context = await this.templateEngine.createEnhancedOverseerrContext(
      mediaType,
      {
        displayName: 'Everyone',
        username: 'global',
        plexUsername: 'Everyone',
        plexTitle: 'Everyone',
      },
      plexClient
    );

    // Use custom templates only if template is set to 'custom', otherwise use main template
    const template = (() => {
      if (config.template === 'custom') {
        return mediaType === 'movie'
          ? config.customMovieTemplate || config.name
          : config.customTVTemplate || config.name;
      }
      return config.template || config.name;
    })();

    return this.templateEngine.processTemplate(template, context);
  }

  private async createUserContextForSubtype(
    config: CollectionConfig
  ): Promise<OverseerrUser | null> {
    switch (config.subtype) {
      case 'global':
        return {
          id: -1,
          plexId: undefined,
          plexTitle: 'Everyone',
          displayName: 'Everyone',
          username: 'global',
          email: 'global@overseerr',
          permissions: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

      case 'server_owner': {
        // For server owner, get the actual admin user with real plexId
        const serverOwner = await this.getServerOwnerUser();
        if (serverOwner) {
          return serverOwner;
        }
        // Fallback if admin user not found
        return {
          id: 1,
          plexId: undefined,
          displayName: 'Server Owner',
          username: 'admin',
          email: 'admin@overseerr',
          permissions: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }

      case 'users':
      default:
        // For user collections, this will be overridden with actual user data
        return {
          id: 0,
          displayName: 'User',
          username: 'user',
          email: 'user@overseerr',
          permissions: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
    }
  }

  private createLabelForSubtype(
    config: CollectionConfig,
    user: OverseerrUser
  ): string {
    switch (config.subtype) {
      case 'global':
        return `AgregarrOverseerrAll${config.id}`;
      case 'server_owner':
        return `AgregarrOverseerrOwner${user.plexId || user.id}`;
      case 'users':
        return `AgregarrOverseerrUser${user.plexId || user.id}`;
      default:
        return `AgregarrOverseerrAll${config.id}`;
    }
  }

  private async getServerOwnerUser(): Promise<OverseerrUser | null> {
    // Get admin user from service layer (already has all necessary fields)
    return await overseerrCollectionService.getAdminUser();
  }
}

// Export the new implementation
export default OverseerrCollectionSync;
