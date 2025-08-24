import type PlexAPI from '@server/api/plexapi';
import type { ServiceUserManager } from '@server/lib/collections/services/ServiceUserManager';
import { serviceUserManager } from '@server/lib/collections/services/ServiceUserManager';
import type { TemplateEngine } from '@server/lib/collections/utils/TemplateEngine';
import { templateEngine } from '@server/lib/collections/utils/TemplateEngine';
import { TimeRestrictionUtils } from '@server/lib/collections/utils/TimeRestrictionUtils';
import type { CollectionConfig } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import {
  createCollectionLabel,
  createSyncError,
  getCollectionMediaType,
  handleRateLimit,
  logCollectionProcessingResults,
  sanitizeCollectionName,
  updateConfigWithRatingKey,
  validateAndSanitizeItems,
  validateCollectionItems,
  validateRequiredFields,
  type LibraryItemsCache,
} from './CollectionUtilities';
import type {
  AutoRequestConfig,
  AutoRequestResult,
  CollectionItem,
  CollectionOperationResult,
  CollectionSource,
  CollectionSourceData,
  CollectionSyncError,
  CollectionSyncInterface,
  CollectionSyncOptions,
  CollectionVisibilityConfig,
  FilteringStats,
  MissingItem,
  PlexCollection,
  PlexLabel,
  SourceTemplateContext,
  SyncResult,
  TimeRestrictionResult,
} from './types';
import { CollectionSyncErrorType } from './types';

// Simple result type - replaces over-engineered MediaTypeStrategies
interface MediaProcessingResult {
  created: number;
  updated: number;
  itemCount: number;
  collectionKeys: string[];
  error?: string;
}
// CollectionUpdateStrategy removed - logic moved inline below
import type { PlexCollectionItem } from '@server/api/plexapi';

// Types moved from CollectionUpdateStrategy.ts
interface CollectionUpdateOptions {
  collectionName: string;
  mediaType: 'movie' | 'tv';
  visibilityConfig: CollectionVisibilityConfig;
  customLabel: string;
  sortOrderLibrary?: number;
  isLibraryPromoted?: boolean;
  totalCollectionsInLibrary?: number;
  customPoster?: string;
  processedCollectionKeys?: Set<string>;
  libraryKey: string;
}

interface CollectionUpdateResult {
  created: number;
  updated: number;
  collectionRatingKey?: string;
  itemCount: number;
  updateStats?: {
    added: number;
    removed: number;
    reordered: boolean;
  };
}

/**
 * Abstract base class for all collection sync implementations
 *
 * Provides common functionality and enforces a consistent pipeline across
 * all collection sync sources (Overseerr, Tautulli, Trakt).
 */
export abstract class BaseCollectionSync implements CollectionSyncInterface {
  protected templateEngine: TemplateEngine;
  protected serviceUserManager: ServiceUserManager;
  protected source: CollectionSource;

  constructor(source: CollectionSource) {
    this.templateEngine = templateEngine;
    this.serviceUserManager = serviceUserManager;
    this.source = source;
  }

  /**
   * Main entry point for processing collections
   * Implements the common pipeline that all sources follow
   */
  public async processCollections(
    collectionConfigs: CollectionConfig[],
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

      // Process each configuration
      for (let i = 0; i < sourceConfigs.length; i++) {
        const config = sourceConfigs[i];

        try {
          // Check time restrictions and determine effective visibility
          const timeRestrictionResult = this.evaluateTimeRestriction(config);
          const removeFromPlexWhenInactive =
            config.timeRestriction?.removeFromPlexWhenInactive ?? false;

          // Update isActive status in the config if it has changed
          if (config.isActive !== timeRestrictionResult.isActive) {
            this.updateConfigActiveStatus(
              config.id,
              timeRestrictionResult.isActive
            );
          }

          // Determine the effective configuration to use
          let effectiveConfig = config;

          if (!timeRestrictionResult.isActive && !removeFromPlexWhenInactive) {
            // Collection is inactive but should use inactive visibility settings
            const inactiveVisibilityConfig = config.timeRestriction
              ?.inactiveVisibilityConfig ?? {
              usersHome: false,
              serverOwnerHome: false,
              libraryRecommended: true,
            };

            logger.debug(
              `Processing collection ${config.name} with inactive visibility settings - time restriction not met (${timeRestrictionResult.reason})`,
              {
                label: `${this.source} Collections`,
                configId: config.id,
                reason: timeRestrictionResult.reason,
                nextActivation: timeRestrictionResult.nextActivation,
                inactiveVisibility: inactiveVisibilityConfig,
              }
            );

            // Override visibility config for inactive collections
            effectiveConfig = {
              ...config,
              visibilityConfig: inactiveVisibilityConfig,
            };
          } else if (
            !timeRestrictionResult.isActive &&
            removeFromPlexWhenInactive
          ) {
            // Collection is inactive and should be removed completely - skip processing
            logger.debug(
              `Skipping collection ${config.name} - time restriction not met and set to remove from Plex (${timeRestrictionResult.reason})`,
              {
                label: `${this.source} Collections`,
                configId: config.id,
                reason: timeRestrictionResult.reason,
                nextActivation: timeRestrictionResult.nextActivation,
              }
            );

            // If collection is time-restricted and inactive, try to remove it from Plex
            await this.handleInactiveCollection(
              config,
              plexClient,
              allCollections,
              processedCollectionKeys
            );
            continue;
          }

          // Process individual configuration (using effective config with potentially overridden visibility)
          const result = await this.processConfiguration(
            effectiveConfig,
            plexClient,
            allCollections,
            processedCollectionKeys,
            libraryCache, // OPTIMIZATION: Pass library cache to eliminate repeated API calls
            options
          );

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

      // Collection processing completed silently
      if (created > 0 || updated > 0) {
        // Processing completed with changes
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
   * Filter collection configurations for this specific source
   */
  protected filterConfigsForSource(
    configs: CollectionConfig[]
  ): CollectionConfig[] {
    return configs.filter((config) => config.type === this.source);
  }

  /**
   * Create a standardized sync error
   */
  protected createSyncError(
    type: CollectionSyncErrorType,
    message: string,
    context: Record<string, unknown> = {},
    originalError?: Error
  ): CollectionSyncError {
    return createSyncError(type, message, context, originalError, this.source);
  }

  /**
   * Generate collection name using template engine
   */
  protected async generateCollectionName(
    config: CollectionConfig,
    mediaType: 'movie' | 'tv',
    customTemplate?: string
  ): Promise<string> {
    let templateToUse = customTemplate || config.template || config.name;

    // Handle custom template selection - use the config template or name
    if (templateToUse === 'custom') {
      templateToUse = config.template || config.name;
    }

    const context = await this.createTemplateContext(config, mediaType);

    return this.templateEngine.processTemplate(templateToUse, context);
  }

  /**
   * Generate collection names with custom templates for movies/TV
   */
  public async generateCollectionNameWithCustom(
    config: CollectionConfig,
    mediaType: 'movie' | 'tv'
  ): Promise<string> {
    const context = await this.createTemplateContext(config, mediaType);

    // Use custom templates if available, otherwise fall back to main template
    const template =
      mediaType === 'movie'
        ? config.customMovieTemplate || config.template || config.name
        : config.customTVTemplate || config.template || config.name;

    return this.templateEngine.processTemplate(template, context);
  }

  /**
   * Process missing items with auto-request functionality
   */
  protected async processAutoRequests(
    missingItems: MissingItem[],
    config: AutoRequestConfig & { id: number; name: string }
  ): Promise<AutoRequestResult> {
    if (!config.searchMissingMovies && !config.searchMissingTV) {
      return {
        autoApproved: 0,
        manualApproval: 0,
        alreadyRequested: 0,
        skipped: 0,
        total: 0,
      };
    }

    try {
      // This would be implemented by subclasses that support auto-requests
      // For now, return empty result
      return {
        autoApproved: 0,
        manualApproval: 0,
        alreadyRequested: 0,
        skipped: 0,
        total: missingItems.length,
      };
    } catch (error) {
      logger.error(
        `Failed to process auto-requests for ${config.name}: ${error}`,
        {
          label: `${this.source} Collections`,
        }
      );

      return {
        autoApproved: 0,
        manualApproval: 0,
        alreadyRequested: 0,
        skipped: 0,
        total: 0,
      };
    }
  }

  /**
   * Create filtering statistics
   */
  protected createFilteringStats(
    original: number,
    filtered: number,
    removalReasons?: Record<string, number>
  ): FilteringStats {
    return {
      original,
      filtered,
      removed: original - filtered,
      removalReasons,
    };
  }

  /**
   * Update collection config with Plex rating key after collection operation
   */
  protected updateConfigWithRatingKey(
    config: CollectionConfig,
    collectionRatingKey?: string
  ): void {
    if (collectionRatingKey && config.id) {
      // Extract library ID from config for multi-library support
      // Handle both single string and array formats
      const libraryId = Array.isArray(config.libraryId)
        ? config.libraryId[0]
        : config.libraryId;
      updateConfigWithRatingKey(config.id, collectionRatingKey, libraryId);
    }
  }

  /**
   * Validate and sanitize collection items before processing
   */
  protected validateAndSanitizeItems(items: CollectionItem[]): {
    validItems: CollectionItem[];
    invalidItems: unknown[];
    validationErrors: string[];
  } {
    return validateAndSanitizeItems(items, this.source);
  }

  /**
   * Apply common filtering safety net (validation, deduplication, maxItems safety check)
   */
  protected applyCommonFiltering(
    items: CollectionItem[],
    config: CollectionConfig
  ): {
    filteredItems: CollectionItem[];
    stats: FilteringStats;
  } {
    const originalCount = items.length;
    const removalReasons: Record<string, number> = {};

    // Remove invalid items (simple validation)
    const validItems = items.filter((item) => {
      if (!item?.ratingKey || !item?.title) {
        removalReasons.invalid = (removalReasons.invalid || 0) + 1;
        return false;
      }
      return true;
    });

    // Remove duplicates based on ratingKey
    const uniqueItems = validItems.reduce((acc, item) => {
      const existing = acc.find(
        (existing) => existing.ratingKey === item.ratingKey
      );
      if (existing) {
        removalReasons.duplicates = (removalReasons.duplicates || 0) + 1;
        return acc;
      }
      return [...acc, item];
    }, [] as CollectionItem[]);

    // Apply maxItems safety check (most collection types should already be limited efficiently)
    let finalItems = uniqueItems;
    if (
      config.maxItems &&
      config.maxItems > 0 &&
      uniqueItems.length > config.maxItems
    ) {
      finalItems = uniqueItems.slice(0, config.maxItems);
      removalReasons.safetyMaxItemsLimit = uniqueItems.length - config.maxItems;
    }

    return {
      filteredItems: finalItems,
      stats: this.createFilteringStats(
        originalCount,
        finalItems.length,
        removalReasons
      ),
    };
  }

  /**
   * Log collection processing results with standardized format
   */
  protected logProcessingResults(
    config: CollectionConfig,
    result: CollectionOperationResult,
    processingTime: number,
    additionalContext?: Record<string, unknown>
  ): void {
    logCollectionProcessingResults(
      config.name,
      result,
      processingTime,
      this.source,
      config.id,
      additionalContext
    );
  }

  /**
   * Handle rate limiting with exponential backoff
   */
  protected async handleRateLimit(
    attempt: number,
    maxAttempts?: number
  ): Promise<void> {
    return handleRateLimit(attempt, this.source, maxAttempts);
  }

  /**
   * Create collection name with fallbacks and sanitization
   */
  protected async createSanitizedCollectionName(
    config: CollectionConfig,
    mediaType: 'movie' | 'tv',
    fallbackName?: string
  ): Promise<string> {
    try {
      const rawName = await this.generateCollectionName(config, mediaType);
      return sanitizeCollectionName(rawName);
    } catch (error) {
      logger.warn(
        `Failed to generate collection name for ${config.name}, using fallback`,
        {
          label: `${this.source} Collections`,
          configId: config.id,
          error: error instanceof Error ? error.message : String(error),
        }
      );

      const fallback =
        fallbackName || config.name || `${this.source} Collection`;
      return sanitizeCollectionName(fallback);
    }
  }

  /**
   * Validate configuration with detailed error reporting
   */
  protected validateConfigurationDetailed(
    config: CollectionConfig,
    requiredFields: string[]
  ): void {
    const missingFields = validateRequiredFields(
      config as unknown as Record<string, unknown>,
      requiredFields
    );

    if (missingFields.length > 0) {
      throw this.createSyncError(
        CollectionSyncErrorType.CONFIGURATION_ERROR,
        `Configuration validation failed for ${config.name}`,
        {
          configId: config.id,
          missingFields,
          providedFields: Object.keys(config),
        }
      );
    }
  }

  /**
   * Standardized collection creation/update using incremental approach
   * This is the ONLY method that should be used for collection updates
   */
  public async createOrUpdateCollectionStandardized(
    items: CollectionItem[],
    collectionName: string,
    mediaType: 'movie' | 'tv',
    config: CollectionConfig,
    plexClient: PlexAPI,
    allCollections: PlexCollection[],
    processedCollectionKeys?: Set<string>,
    userInfo?: { userId?: number | string; customLabel?: string }
  ): Promise<CollectionOperationResult> {
    // Support user-specific collections for services like Overseerr
    const customLabel =
      userInfo?.customLabel ||
      createCollectionLabel(
        this.source,
        config.id,
        userInfo?.userId ? Number(userInfo.userId) : undefined
      );

    // Simplified collection update logic (moved from CollectionUpdateStrategy)
    const updateResult = await this.createOrUpdateCollection(
      plexClient,
      allCollections,
      items,
      {
        collectionName,
        mediaType,
        visibilityConfig: {
          usersHome: config.visibilityConfig?.usersHome ?? true,
          serverOwnerHome: config.visibilityConfig?.serverOwnerHome ?? false,
          libraryRecommended:
            config.visibilityConfig?.libraryRecommended ?? true,
          isActive: config.isActive,
        },
        customLabel,
        sortOrderLibrary: config.sortOrderLibrary,
        isLibraryPromoted: config.isLibraryPromoted,
        totalCollectionsInLibrary: (
          config as CollectionConfig & { _totalCollectionsInLibrary?: number }
        )._totalCollectionsInLibrary,
        customPoster: config.customPoster,
        processedCollectionKeys,
        libraryKey: config.libraryId,
      }
    );

    // Update config with rating key if collection was created/updated
    // Skip for Overseerr user collections (they're dynamically generated from base config)
    const isOverseerrUsersCollection =
      config.type === 'overseerr' && config.subtype === 'users';
    if (updateResult.collectionRatingKey && !isOverseerrUsersCollection) {
      this.updateConfigWithRatingKey(config, updateResult.collectionRatingKey);
    }

    return {
      created: updateResult.created,
      updated: updateResult.updated,
      collectionRatingKey: updateResult.collectionRatingKey,
      itemCount: updateResult.itemCount,
      stats: updateResult.updateStats,
    };
  }

  /**
   * Unified create or update collection method
   * Simple, predictable pipeline for all collection operations
   */
  private async createOrUpdateCollection(
    plexClient: PlexAPI,
    allCollections: PlexCollection[],
    items: CollectionItem[],
    options: CollectionUpdateOptions
  ): Promise<CollectionUpdateResult> {
    const { collectionName, mediaType, customLabel } = options;

    // Validate items first
    const validation = validateCollectionItems(items);
    if (validation.valid.length === 0) {
      logger.warn(`No valid items for collection ${collectionName}`, {
        label: 'Collection Update',
        totalItems: items.length,
        errors: validation.errors.slice(0, 5),
      });
      return { created: 0, updated: 0, itemCount: 0 };
    }

    const validItems = validation.valid;
    const libraryKey = options.libraryKey;

    // Filter items to only include those from the target library
    const libraryFilteredItems = this.filterItemsByLibrary(
      validItems,
      libraryKey
    );

    if (libraryFilteredItems.length === 0) {
      logger.warn(
        `No items found in target library ${libraryKey} for collection ${collectionName}`,
        {
          label: 'Collection Update',
          totalItems: validItems.length,
          targetLibrary: libraryKey,
          mediaType,
        }
      );
      return { created: 0, updated: 0, itemCount: 0 };
    }

    const plexItems = await this.getValidPlexItems(
      plexClient,
      libraryFilteredItems
    );
    if (plexItems.length === 0) {
      return { created: 0, updated: 0, itemCount: 0 };
    }

    // Check for existing collection
    const existingCollection = await this.findExistingCollection(
      plexClient,
      customLabel,
      libraryKey
    );

    let collectionRatingKey: string;
    let created = 0;
    let updated = 0;

    if (existingCollection) {
      // UPDATE PATH: Collection exists
      collectionRatingKey = existingCollection.ratingKey;

      // Smart update: add new items, remove old ones
      await plexClient.updateCollectionContents(collectionRatingKey, plexItems);
      updated = 1;
    } else {
      // CREATE PATH: New collection
      // Always use simple empty collection creation (more predictable)
      const newCollectionRatingKey = await plexClient.createEmptyCollection(
        collectionName,
        libraryKey,
        mediaType
      );

      if (!newCollectionRatingKey) {
        throw new Error(`Failed to create collection ${collectionName}`);
      }

      collectionRatingKey = newCollectionRatingKey;

      // Add all items to the new collection
      await plexClient.addItemsToCollection(collectionRatingKey, plexItems);
      created = 1;
    }

    // UNIFIED PIPELINE: Always apply these steps for consistent behavior

    // 1. Set collection to custom sort first (tells Plex to respect manual arrangement)
    await plexClient.updateCollectionContentSort(collectionRatingKey, 'custom');

    // 2. Arrange items in source order (both create and update)
    if (plexItems.length > 1) {
      try {
        await plexClient.arrangeCollectionItemsInOrder(
          collectionRatingKey,
          plexItems
        );
      } catch (error) {
        // Non-critical - collection still works
        logger.warn(`Failed to arrange items in collection ${collectionName}`, {
          label: 'Collection Update',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // 3. Apply other metadata (title, visibility, poster, etc.)
    await this.updateCollectionMetadata(
      plexClient,
      collectionRatingKey,
      options
    );

    // 4. Track processed collection
    if (options.processedCollectionKeys) {
      options.processedCollectionKeys.add(collectionRatingKey);
    }

    return {
      created,
      updated,
      collectionRatingKey,
      itemCount: plexItems.length,
    };
  }

  /**
   * Filter items to only include those from the specified library
   * This prevents cross-library collection issues in Plex
   */
  private filterItemsByLibrary(
    items: CollectionItem[],
    targetLibraryKey: string
  ): CollectionItem[] {
    return items.filter((item) => {
      // Check if item has library information
      if (
        item.metadata &&
        typeof item.metadata === 'object' &&
        item.metadata.libraryKey
      ) {
        return item.metadata.libraryKey === targetLibraryKey;
      }

      // For items without library metadata, include them (they'll be filtered out later if invalid)
      return true;
    });
  }

  /**
   * Helper methods for collection management
   */
  private async findTargetLibrary(
    plexClient: PlexAPI,
    mediaType: 'movie' | 'tv'
  ): Promise<string> {
    const libraries = await plexClient.getLibraries();
    // Map mediaType to Plex library type: 'tv' -> 'show', 'movie' -> 'movie'
    const plexLibraryType = mediaType === 'tv' ? 'show' : 'movie';
    const targetLibrary = libraries.find((lib) => lib.type === plexLibraryType);

    if (!targetLibrary) {
      throw new Error(`No ${mediaType} library found`);
    }

    return targetLibrary.key;
  }

  private async findExistingCollection(
    plexClient: PlexAPI,
    customLabel: string,
    libraryKey: string
  ): Promise<PlexCollection | null> {
    try {
      // Get collections only from the specific library where we would create new collections
      interface PlexClientWithQuery {
        plexClient: {
          query<T>(path: string): Promise<T>;
        };
      }
      const clientWithQuery = plexClient as unknown as PlexClientWithQuery;
      const response = await clientWithQuery.plexClient.query<{
        MediaContainer?: { Metadata?: PlexCollection[] };
      }>(`/library/sections/${libraryKey}/collections`);
      const collections = response.MediaContainer?.Metadata || [];

      // OPTIMIZATION: Fetch all collection metadata concurrently instead of sequentially
      // This eliminates the N×API-call bottleneck when searching for existing collections
      logger.debug(
        `Searching for collection with label "${customLabel}" among ${collections.length} collections (concurrent fetch)`,
        {
          label: 'Base Collection Sync',
          customLabel,
          collectionsToSearch: collections.length,
          libraryKey,
        }
      );

      if (collections.length === 0) {
        return null;
      }

      // Create concurrent metadata fetch promises for all collections
      const metadataPromises = collections.map(async (collection) => {
        try {
          const detailedCollection = await plexClient.getCollectionMetadata(
            collection.ratingKey
          );
          const labels = detailedCollection?.labels || [];

          return {
            collection,
            labels,
            found: labels.includes(customLabel),
            error: null,
          };
        } catch (error) {
          logger.debug(
            `Failed to get metadata for collection ${collection.ratingKey}`,
            {
              label: 'Base Collection Sync',
              collectionRatingKey: collection.ratingKey,
              collectionTitle: collection.title,
              error: error instanceof Error ? error.message : String(error),
            }
          );
          return {
            collection,
            labels: [],
            found: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      });

      // Wait for all metadata fetches to complete
      const metadataResults = await Promise.allSettled(metadataPromises);

      // Find the first collection that matches the label
      for (let i = 0; i < metadataResults.length; i++) {
        const result = metadataResults[i];

        if (result.status === 'fulfilled' && result.value.found) {
          const matchedCollection = result.value;

          logger.debug(
            `Found existing collection with label "${customLabel}": ${matchedCollection.collection.title}`,
            {
              label: 'Base Collection Sync',
              foundCollection: matchedCollection.collection.title,
              ratingKey: matchedCollection.collection.ratingKey,
              labels: matchedCollection.labels,
            }
          );

          return {
            ratingKey: matchedCollection.collection.ratingKey,
            title: matchedCollection.collection.title,
            labels: matchedCollection.labels,
            type: matchedCollection.collection.type || 'collection',
          };
        }
      }

      logger.debug(
        `No existing collection found with label "${customLabel}" in library ${libraryKey}`,
        {
          label: 'Base Collection Sync',
          customLabel,
          libraryKey,
          searchedCollections: collections.length,
        }
      );

      return null;
    } catch (error) {
      logger.error(
        `Error finding existing collection in library ${libraryKey}`,
        {
          label: 'Collection Search',
          libraryKey,
          customLabel,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return null;
    }
  }

  private async getValidPlexItems(
    plexClient: PlexAPI,
    items: CollectionItem[]
  ): Promise<PlexCollectionItem[]> {
    return items.map((item) => ({
      ratingKey: item.ratingKey,
      title: item.title || 'Unknown Title',
    }));
  }

  private async updateCollectionMetadata(
    plexClient: PlexAPI,
    collectionRatingKey: string,
    options: CollectionUpdateOptions
  ): Promise<void> {
    const {
      customLabel,
      visibilityConfig,
      sortOrderLibrary,
      isLibraryPromoted,
      customPoster,
      collectionName,
    } = options;

    // Add collection label
    await plexClient.addLabelToCollection(collectionRatingKey, customLabel);

    // Update collection title to reflect any template changes
    if (collectionName) {
      await plexClient.updateCollectionTitle(
        collectionRatingKey,
        collectionName
      );
    }

    // Update sort title if needed
    if (sortOrderLibrary !== undefined) {
      let sortTitle: string;

      if (isLibraryPromoted && sortOrderLibrary > 0) {
        // Promoted collections get exclamation marks for manual positioning
        const settings = getSettings();
        const allConfigs = settings.plex.collectionConfigs || [];
        const sameLibraryConfigs = allConfigs.filter((config) => {
          const configLibraryId = Array.isArray(config.libraryId)
            ? config.libraryId[0]
            : config.libraryId;
          return (
            configLibraryId === options.libraryKey &&
            config.sortOrderLibrary !== undefined &&
            config.isLibraryPromoted === true
          );
        });

        if (sameLibraryConfigs.length > 0) {
          const sortOrders = sameLibraryConfigs
            .map((c) => c.sortOrderLibrary)
            .filter((order): order is number => order !== undefined);
          const maxSortOrder = Math.max(...sortOrders);
          const exclamationCount = maxSortOrder - sortOrderLibrary + 2;
          const exclamationPrefix = '!'.repeat(exclamationCount);
          sortTitle = `${exclamationPrefix}${collectionName}`;
        } else {
          sortTitle = `!!${collectionName}`;
        }
      } else {
        // A-Z collections use natural title for alphabetical sorting
        sortTitle = collectionName;
      }

      await plexClient.updateCollectionSortTitle(
        collectionRatingKey,
        sortTitle
      );
    }

    // Update visibility settings
    if (visibilityConfig) {
      await plexClient.updateCollectionVisibility(
        collectionRatingKey,
        visibilityConfig.libraryRecommended, // recommended (promotedToRecommended)
        visibilityConfig.serverOwnerHome, // home (promotedToOwnHome)
        visibilityConfig.usersHome // shared (promotedToSharedHome)
      );
    }

    // Update poster if provided
    if (customPoster) {
      await plexClient.updateCollectionPoster(
        collectionRatingKey,
        customPoster
      );
    }
  }

  /**
   * Update the isActive status for a collection config
   */
  private updateConfigActiveStatus(configId: string, isActive: boolean): void {
    try {
      const settings = getSettings();
      const collectionConfigs = settings.plex.collectionConfigs || [];

      const configIndex = collectionConfigs.findIndex((c) => c.id === configId);
      if (configIndex === -1) {
        logger.warn(
          `Config ${configId} not found when updating active status`,
          {
            label: `${this.source} Collections`,
            configId,
            isActive,
          }
        );
        return;
      }

      // Update the config
      const updatedConfig = { ...collectionConfigs[configIndex], isActive };
      collectionConfigs[configIndex] = updatedConfig;

      // Save the updated settings
      settings.plex.collectionConfigs = collectionConfigs;
      settings.save();

      logger.debug(
        `Updated collection ${configId} active status to ${isActive}`,
        {
          label: `${this.source} Collections`,
          configId,
          isActive,
        }
      );
    } catch (error) {
      logger.error(`Failed to update active status for config ${configId}`, {
        label: `${this.source} Collections`,
        configId,
        isActive,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Abstract methods that must be implemented by subclasses

  /**
   * Validate that the source is properly configured
   * (e.g., API keys are present, services are reachable)
   */
  protected abstract validateConfiguration(): Promise<void>;

  /**
   * Process a single collection configuration
   * @param config - Collection configuration
   * @param plexClient - Plex API client
   * @param allCollections - All existing Plex collections
   * @param processedCollectionKeys - Set to track processed collection keys
   * @param libraryCache - Pre-fetched library items cache for optimization
   * @param options - Additional sync options
   */
  protected abstract processConfiguration(
    config: CollectionConfig,
    plexClient: PlexAPI,
    allCollections: PlexCollection[],
    processedCollectionKeys?: Set<string>,
    libraryCache?: LibraryItemsCache,
    options?: CollectionSyncOptions
  ): Promise<SyncResult>;

  /**
   * Create template context specific to this source
   */
  protected abstract createTemplateContext(
    config: CollectionConfig,
    mediaType: 'movie' | 'tv'
  ): Promise<SourceTemplateContext>;

  /**
   * Fetch data from the external source (Trakt API, Tautulli API, etc.)
   */
  protected abstract fetchSourceData(
    config: CollectionConfig,
    options?: CollectionSyncOptions
  ): Promise<CollectionSourceData[]>;

  /**
   * Map source data to standardized CollectionItem format
   * @param sourceData - Raw data from external source
   * @param config - Collection configuration
   * @param plexClient - Optional Plex API client for lookups
   * @param libraryCache - Optional pre-fetched library items cache for performance optimization
   */
  protected abstract mapSourceDataToItems(
    sourceData: CollectionSourceData[],
    config: CollectionConfig,
    plexClient?: PlexAPI,
    libraryCache?: LibraryItemsCache
  ): Promise<{
    items: CollectionItem[];
    missingItems?: MissingItem[];
    stats?: FilteringStats;
  }>;

  /**
   * Create collection in Plex using the standardized pipeline
   */
  protected abstract createCollection(
    items: CollectionItem[],
    mediaType: 'movie' | 'tv',
    collectionName: string,
    plexClient: PlexAPI,
    allCollections: PlexCollection[],
    config: CollectionConfig,
    processedCollectionKeys?: Set<string>
  ): Promise<CollectionOperationResult>;

  /**
   * Apply filtering safety net to already-mapped items (validation, deduplication, maxItems safety check)
   * Use this after calling your specific mapSourceDataToItems implementation.
   */
  protected applyFilteringToMappedItems(
    mappedResult: {
      items: CollectionItem[];
      missingItems?: MissingItem[];
      stats?: FilteringStats;
    },
    config: CollectionConfig
  ): {
    items: CollectionItem[];
    missingItems?: MissingItem[];
    mappingStats?: FilteringStats;
    filteringStats?: FilteringStats;
  } {
    // Apply common filtering (duplicates, maxItems limit, etc.)
    const { filteredItems: items, stats: filteringStats } =
      this.applyCommonFiltering(mappedResult.items, config);

    return {
      items,
      missingItems: mappedResult.missingItems,
      mappingStats: mappedResult.stats,
      filteringStats,
    };
  }

  /**
   * Evaluate time restrictions for a collection configuration
   *
   * @param config - Collection configuration to evaluate
   * @returns TimeRestrictionResult indicating if collection should be active
   */
  protected evaluateTimeRestriction(
    config: CollectionConfig
  ): TimeRestrictionResult {
    return TimeRestrictionUtils.evaluateTimeRestriction(config.timeRestriction);
  }

  /**
   * Handle collections that are currently inactive due to time restrictions
   * This removes the collection from Plex if it exists
   *
   * @param config - Collection configuration
   * @param plexClient - Plex API client
   * @param allCollections - All collections from Plex
   * @param processedCollectionKeys - Set to track processed collection keys
   */
  protected async handleInactiveCollection(
    config: CollectionConfig,
    plexClient: PlexAPI,
    allCollections: PlexCollection[],
    processedCollectionKeys?: Set<string>
  ): Promise<void> {
    try {
      // Generate the collection label that would be used for this config
      const collectionLabel = createCollectionLabel(this.source, config.id);

      // Find existing collections with this label
      const existingCollections = allCollections.filter((collection) =>
        collection.labels?.some((label: string | PlexLabel) =>
          typeof label === 'string'
            ? label === collectionLabel
            : label.tag === collectionLabel
        )
      );

      // This method is only called when removeFromPlexWhenInactive is true
      // So we only need the original deletion behavior
      for (const collection of existingCollections) {
        try {
          logger.info(
            `Removing time-restricted collection: ${collection.title}`,
            {
              label: `${this.source} Collections`,
              configId: config.id,
              configName: config.name,
              collectionId: collection.ratingKey,
            }
          );

          // Remove the collection from Plex
          await plexClient.deleteCollection(collection.ratingKey);

          // Mark as processed to avoid conflicts
          if (processedCollectionKeys) {
            processedCollectionKeys.add(collection.ratingKey);
          }
        } catch (error) {
          logger.warn(
            `Failed to remove time-restricted collection ${collection.title}: ${error}`,
            {
              label: `${this.source} Collections`,
              configId: config.id,
              error: error instanceof Error ? error.message : 'Unknown error',
            }
          );
        }
      }
    } catch (error) {
      logger.warn(
        `Failed to handle inactive collection for ${config.name}: ${error}`,
        {
          label: `${this.source} Collections`,
          configId: config.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );
    }
  }

  /**
   * Process collections with simple media type handling
   * Replaces over-engineered strategy pattern with straightforward if/else logic
   */
  protected async processWithMediaTypeStrategy(
    items: CollectionItem[],
    config: CollectionConfig,
    plexClient: PlexAPI,
    allCollections: PlexCollection[],
    processedCollectionKeys?: Set<string>,
    userInfo?: { userId?: number | string; customLabel?: string }
  ): Promise<MediaProcessingResult> {
    const mediaType = getCollectionMediaType(config);

    try {
      // Simple single media type processing - 'both' was over-engineered
      // Each collection is tied to a specific library (movie OR tv), not both
      return await this.processSingleMediaType(
        items,
        config,
        mediaType,
        plexClient,
        allCollections,
        processedCollectionKeys,
        userInfo
      );
    } catch (error) {
      logger.error(`Media type processing failed`, {
        label: `${this.source} Collections`,
        configName: config.name,
        mediaType,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        created: 0,
        updated: 0,
        itemCount: 0,
        collectionKeys: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Process single media type collections (movie OR tv)
   */
  private async processSingleMediaType(
    items: CollectionItem[],
    config: CollectionConfig,
    mediaType: 'movie' | 'tv',
    plexClient: PlexAPI,
    allCollections: PlexCollection[],
    processedCollectionKeys?: Set<string>,
    userInfo?: { userId?: number | string; customLabel?: string }
  ): Promise<MediaProcessingResult> {
    // Filter items by the specified media type
    const filteredItems = items.filter((item) => item.type === mediaType);

    if (filteredItems.length === 0) {
      logger.debug(`No ${mediaType} items found for collection`, {
        label: `${this.source} Collections`,
        configName: config.name,
        mediaType,
        totalItems: items.length,
      });

      return {
        created: 0,
        updated: 0,
        itemCount: 0,
        collectionKeys: [],
      };
    }

    const collectionName =
      (await this.generateCollectionNameWithCustom?.(config, mediaType)) ||
      config.template ||
      config.name;

    const result = await this.createOrUpdateCollectionStandardized(
      filteredItems,
      collectionName,
      mediaType,
      config,
      plexClient,
      allCollections,
      processedCollectionKeys,
      userInfo
    );

    return {
      created: result.created || 0,
      updated: result.updated || 0,
      itemCount: result.itemCount || 0,
      collectionKeys: result.collectionRatingKey
        ? [result.collectionRatingKey]
        : [],
      error: result.error,
    };
  }
}

export default BaseCollectionSync;
