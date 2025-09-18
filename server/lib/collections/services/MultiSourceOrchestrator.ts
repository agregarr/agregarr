import type PlexAPI from '@server/api/plexapi';
import type { LibraryItemsCache } from '@server/lib/collections/core/CollectionUtilities';
import type {
  CollectionItem,
  CollectionSyncOptions,
  PlexCollection,
} from '@server/lib/collections/core/types';
import { CollectionSyncErrorType } from '@server/lib/collections/core/types';
// getCollectionMediaType removed - using items[0]?.type instead
import type { BaseCollectionSync } from '@server/lib/collections/core/BaseCollectionSync';
import {
  createCollectionLabel,
  createSyncError,
  getCollectionSyncCounter,
  getMediaTypeFromLibrary,
  handleRateLimit,
  incrementCollectionSyncCounter,
  parseConfigIdFromLabel,
  updateConfigWithRatingKey,
  validateAndSanitizeItems,
  validateCollectionItems,
} from '@server/lib/collections/core/CollectionUtilities';
import { ImdbCollectionSync } from '@server/lib/collections/external/imdb';
import { LetterboxdCollectionSync } from '@server/lib/collections/external/letterboxd';
import { MDBListCollectionSync } from '@server/lib/collections/external/mdblist';
import { OverseerrCollectionSync } from '@server/lib/collections/external/overseerrSync';
import { TautulliCollectionSync } from '@server/lib/collections/external/tautulli';
import { TmdbCollectionSync } from '@server/lib/collections/external/tmdb';
import { TraktCollectionSync } from '@server/lib/collections/external/trakt';
import { TimeRestrictionUtils } from '@server/lib/collections/utils/TimeRestrictionUtils';
import type { CollectionItemWithPoster } from '@server/lib/posterGeneration';
import { generatePoster, getPosterPath } from '@server/lib/posterStorage';
import type {
  CollectionConfig,
  MultiSourceCollectionConfig,
  SourceDefinition,
} from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

// Interfaces for better type safety
interface CollectionVisibilityConfig {
  usersHome: boolean;
  serverOwnerHome: boolean;
  libraryRecommended: boolean;
  isActive?: boolean;
}

interface CollectionUpdateOptions {
  collectionName: string;
  mediaType: 'movie' | 'tv';
  visibilityConfig: CollectionVisibilityConfig;
  customLabel: string;
  sortOrderLibrary?: number;
  isLibraryPromoted?: boolean;
  totalCollectionsInLibrary?: number;
  customPoster?: string | Record<string, string>;
  processedCollectionKeys?: Set<string>;
  libraryKey: string;
  config: MultiSourceCollectionConfig;
}

interface MetadataUpdateOptions {
  customLabel: string;
  visibilityConfig: CollectionVisibilityConfig;
  sortOrderLibrary?: number;
  isLibraryPromoted?: boolean;
  customPoster?: string | Record<string, string>;
  config: MultiSourceCollectionConfig;
}

/**
 * MultiSourceOrchestrator - Orchestrates multi-source collections by combining items from multiple sources
 *
 * Implements the Orchestrator Method:
 * 1. Creates temporary single-source configs from each source definition
 * 2. Uses existing sync services' public methods to fetch and map items
 * 3. Combines items according to the specified mode
 * 4. Creates/updates collection directly in Plex
 *
 * This approach reuses all existing sync logic while keeping multi-source as a separate concern.
 */
export class MultiSourceOrchestrator {
  private syncServices = new Map<string, BaseCollectionSync>();

  constructor() {
    // Initialize sync services lazily to avoid circular dependencies
  }

  /**
   * Process a multi-source collection configuration
   */
  async processMultiSourceCollection(
    config: MultiSourceCollectionConfig,
    plexClient: PlexAPI,
    allCollections: PlexCollection[],
    processedCollectionKeys?: Set<string>,
    libraryCache?: LibraryItemsCache,
    options?: CollectionSyncOptions
  ): Promise<{ created: number; updated: number }> {
    try {
      // 1. Time Restrictions - check if collection should be active
      const timeRestrictionResult =
        TimeRestrictionUtils.evaluateTimeRestriction(config.timeRestriction);
      const removeFromPlexWhenInactive =
        config.timeRestriction?.removeFromPlexWhenInactive ?? false;

      // If collection is inactive and should be removed, handle removal
      if (!timeRestrictionResult.isActive && removeFromPlexWhenInactive) {
        logger.debug(
          `Skipping multi-source collection ${config.name} - time restriction not met and set to remove from Plex (${timeRestrictionResult.reason})`,
          {
            label: 'Multi-Source Orchestrator',
            configId: config.id,
            reason: timeRestrictionResult.reason,
            nextActivation: timeRestrictionResult.nextActivation,
          }
        );

        await this.handleInactiveCollection(
          config,
          plexClient,
          allCollections,
          processedCollectionKeys
        );
        return { created: 0, updated: 0 };
      }

      logger.info(`Processing multi-source collection: ${config.name}`, {
        label: 'Multi-Source Orchestrator',
        configId: config.id,
        sourceCount: config.sources.length,
        combineMode: config.combineMode,
        isActive: timeRestrictionResult.isActive,
      });

      // Increment sync counter for cycle_lists mode
      if (config.combineMode === 'cycle_lists') {
        const newCounter = incrementCollectionSyncCounter(config.id);

        logger.debug(
          `Incremented sync counter for cycle collection: ${config.name}`,
          {
            label: 'Multi-Source Orchestrator',
            configId: config.id,
            syncCounter: newCounter,
          }
        );
      }

      const itemGroups: CollectionItem[][] = [];

      // Fetch items from each source
      for (let i = 0; i < config.sources.length; i++) {
        const source = config.sources[i];

        try {
          // Apply rate limiting between source fetches
          if (i > 0) {
            await handleRateLimit(1, 'Multi-Source');
          }

          const items = await this.fetchItemsFromSource(
            source,
            config,
            plexClient,
            libraryCache,
            options
          );
          if (items.length > 0) {
            itemGroups.push(items);
            logger.debug(
              `Fetched ${items.length} items from source ${source.id}`,
              {
                label: 'Multi-Source Orchestrator',
                configId: config.id,
                sourceId: source.id,
                sourceType: source.type,
                itemCount: items.length,
              }
            );
          }
        } catch (error) {
          logger.error(`Failed to fetch from source ${source.id}:`, {
            label: 'Multi-Source Orchestrator',
            configId: config.id,
            sourceId: source.id,
            sourceType: source.type,
            error: error instanceof Error ? error.message : String(error),
          });
          // Continue with other sources
        }
      }

      // Combine items according to mode
      const combinedItems = this.combineItems(
        itemGroups,
        config.combineMode,
        config
      );

      // 3. Validation & Filtering - use standard pipeline utilities
      const { validItems, invalidItems, validationErrors } =
        validateAndSanitizeItems(combinedItems);

      if (invalidItems.length > 0) {
        logger.debug(
          `Filtered ${invalidItems.length} invalid items from multi-source collection: ${config.name}`,
          {
            label: 'Multi-Source Orchestrator',
            configId: config.id,
            validationErrors: validationErrors.slice(0, 5), // Show first 5 errors
          }
        );
      }

      // Apply maxItems limit if specified
      const finalItems =
        config.maxItems && config.maxItems > 0
          ? validItems.slice(0, config.maxItems)
          : validItems;

      if (finalItems.length === 0) {
        logger.warn(
          `No valid items found from any source for multi-source collection: ${config.name}`,
          {
            label: 'Multi-Source Orchestrator',
            configId: config.id,
            sourceCount: config.sources.length,
            originalItems: combinedItems.length,
            validItems: validItems.length,
            invalidItems: invalidItems.length,
          }
        );
        return { created: 0, updated: 0 };
      }

      logger.info(
        `Processed ${itemGroups.flat().length} items into ${
          finalItems.length
        } final items for multi-source collection`,
        {
          label: 'Multi-Source Orchestrator',
          configId: config.id,
          originalCount: itemGroups.flat().length,
          combinedCount: combinedItems.length,
          validCount: validItems.length,
          finalCount: finalItems.length,
          combineMode: config.combineMode,
          maxItems: config.maxItems,
        }
      );

      // Create/update collection directly in Plex
      return await this.createOrUpdatePlexCollection(
        finalItems,
        config,
        plexClient,
        allCollections,
        processedCollectionKeys
      );
    } catch (error) {
      // 4. Error Handling - use standard pipeline utilities
      const syncError = createSyncError(
        CollectionSyncErrorType.COLLECTION_ERROR,
        `Failed to process multi-source collection ${config.name}`,
        { configId: config.id, configName: config.name },
        error instanceof Error ? error : new Error(String(error))
      );

      logger.error(syncError.message, {
        label: 'Multi-Source Orchestrator',
        configId: config.id,
        error: syncError.details,
      });

      // Call error callback if provided
      if (options?.onError) {
        options.onError(syncError);
      }

      return { created: 0, updated: 0 };
    }
  }

  /**
   * Fetch items from a single source within a multi-source configuration
   */
  private async fetchItemsFromSource(
    source: SourceDefinition,
    parentConfig: MultiSourceCollectionConfig,
    plexClient: PlexAPI,
    libraryCache?: LibraryItemsCache,
    options?: CollectionSyncOptions
  ): Promise<CollectionItem[]> {
    // Create temporary single-source config
    const tempConfig = this.createTempConfig(source, parentConfig);

    // Get appropriate sync service
    const syncService = this.getSyncService(source.type);

    // Use sync service's internal methods to fetch items
    try {
      const sourceData = await syncService.fetchSourceData(
        tempConfig,
        options,
        libraryCache
      );
      const mappedResult = await syncService.mapSourceDataToItems(
        sourceData,
        tempConfig,
        plexClient,
        libraryCache
      );
      const { items } = syncService.applyFilteringToMappedItems(
        mappedResult,
        tempConfig
      );

      logger.debug(
        `Successfully fetched ${items.length} items from ${source.type}`,
        {
          label: 'Multi-Source Orchestrator',
          sourceId: source.id,
          sourceType: source.type,
          itemCount: items.length,
        }
      );

      return items;
    } catch (error) {
      logger.error(`Failed to fetch items from ${source.type}:`, {
        label: 'Multi-Source Orchestrator',
        sourceId: source.id,
        sourceType: source.type,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Create a temporary single-source config from a source definition
   */
  private createTempConfig(
    source: SourceDefinition,
    parentConfig: MultiSourceCollectionConfig
  ): CollectionConfig {
    const tempConfig: CollectionConfig = {
      ...parentConfig,
      id: `${parentConfig.id}-${source.id}`,
      type: source.type,
      subtype: source.subtype || '', // Ensure subtype is always string
      template: parentConfig.template || '', // Ensure template is always string
      maxItems: parentConfig.maxItems ?? 50, // Ensure maxItems is always number
      isActive: parentConfig.isActive ?? true, // Ensure isActive is always boolean
      timePeriod: source.timePeriod,
      customDays: source.customDays,
      minimumPlays: source.minimumPlays,
      // Map source-specific fields based on type
      ...(source.type === 'trakt' &&
        source.customUrl && {
          traktCustomListUrl: source.customUrl,
        }),
      ...(source.type === 'tmdb' &&
        source.customUrl && {
          tmdbCustomListUrl: source.customUrl,
        }),
      ...(source.type === 'imdb' &&
        source.customUrl && {
          imdbCustomListUrl: source.customUrl,
        }),
      ...(source.type === 'letterboxd' &&
        source.customUrl && {
          letterboxdCustomListUrl: source.customUrl,
        }),
      // Remove multi-source specific fields
      sources: undefined,
      combineMode: undefined,
    };

    return tempConfig as CollectionConfig;
  }

  /**
   * Get or create sync service for the specified source type
   */
  private getSyncService(sourceType: string): BaseCollectionSync {
    if (!this.syncServices.has(sourceType)) {
      switch (sourceType) {
        case 'trakt':
          this.syncServices.set(sourceType, new TraktCollectionSync());
          break;
        case 'mdblist':
          this.syncServices.set(sourceType, new MDBListCollectionSync());
          break;
        case 'tmdb':
          this.syncServices.set(sourceType, new TmdbCollectionSync());
          break;
        case 'imdb':
          this.syncServices.set(sourceType, new ImdbCollectionSync());
          break;
        case 'letterboxd':
          this.syncServices.set(sourceType, new LetterboxdCollectionSync());
          break;
        case 'tautulli':
          this.syncServices.set(sourceType, new TautulliCollectionSync());
          break;
        case 'overseerr':
          this.syncServices.set(sourceType, new OverseerrCollectionSync());
          break;
        default:
          throw new Error(`Unknown source type: ${sourceType}`);
      }
    }
    const service = this.syncServices.get(sourceType);
    if (!service) {
      throw new Error(`Failed to initialize sync service for ${sourceType}`);
    }
    return service;
  }

  /**
   * Combine items from multiple sources according to the specified mode
   */
  private combineItems(
    itemGroups: CollectionItem[][],
    combineMode: 'interleaved' | 'list_order' | 'randomised' | 'cycle_lists',
    parentConfig: MultiSourceCollectionConfig
  ): CollectionItem[] {
    switch (combineMode) {
      case 'interleaved':
        // Take 1st item from each source, then 2nd from each, etc.
        return this.interleaveItems(itemGroups);

      case 'list_order':
        // All items from source 1, then all from source 2, etc.
        return this.concatenateItems(itemGroups);

      case 'randomised': {
        // Shuffle all items randomly using Fisher-Yates
        const allItems = itemGroups.flat();
        const uniqueItems = this.removeDuplicates(allItems);
        return this.shuffleArray([...uniqueItems]);
      }

      case 'cycle_lists':
        // Only one source active at a time, rotates each sync
        return this.cycleListsItems(itemGroups, parentConfig.id);

      default:
        return this.concatenateItems(itemGroups);
    }
  }

  /**
   * Remove duplicates from items array by ratingKey
   */
  private removeDuplicates(items: CollectionItem[]): CollectionItem[] {
    return items.reduce((acc, item) => {
      const existing = acc.find(
        (existingItem) => existingItem.ratingKey === item.ratingKey
      );
      if (!existing) {
        acc.push(item);
      }
      return acc;
    }, [] as CollectionItem[]);
  }

  /**
   * Interleave items: 1st from each source, then 2nd from each, etc.
   */
  private interleaveItems(itemGroups: CollectionItem[][]): CollectionItem[] {
    const result: CollectionItem[] = [];
    const maxLength = Math.max(...itemGroups.map((group) => group.length));

    for (let i = 0; i < maxLength; i++) {
      for (const group of itemGroups) {
        if (i < group.length) {
          result.push(group[i]);
        }
      }
    }

    return this.removeDuplicates(result);
  }

  /**
   * Concatenate items: all from source 1, then all from source 2, etc.
   */
  private concatenateItems(itemGroups: CollectionItem[][]): CollectionItem[] {
    const allItems = itemGroups.flat();
    return this.removeDuplicates(allItems);
  }

  /**
   * Cycle lists: only show one source at a time, rotate on each sync execution
   */
  private cycleListsItems(
    itemGroups: CollectionItem[][],
    configId: string
  ): CollectionItem[] {
    if (itemGroups.length === 0) return [];

    // Get current sync counter for this collection
    const syncCounter = getCollectionSyncCounter(configId);

    // Select source based on sync iteration count
    const selectedIndex = syncCounter % itemGroups.length;

    logger.debug(`Cycle lists selection for ${configId}`, {
      label: 'Multi-Source Orchestrator',
      configId,
      syncCounter,
      selectedIndex,
      totalSources: itemGroups.length,
    });

    return itemGroups[selectedIndex] || [];
  }

  /**
   * Shuffle array using Fisher-Yates algorithm
   */
  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /**
   * Create or update collection using standard utilities (same pattern as BaseCollectionSync)
   */
  private async createOrUpdatePlexCollection(
    items: CollectionItem[],
    config: MultiSourceCollectionConfig,
    plexClient: PlexAPI,
    allCollections: PlexCollection[],
    processedCollectionKeys?: Set<string>
  ): Promise<{ created: number; updated: number }> {
    const mediaType = getMediaTypeFromLibrary(config.libraryId);
    const customLabel = createCollectionLabel(
      'multi-source' as 'overseerr',
      config.id
    );

    // Use standard collection creation/update pipeline
    return await this.createOrUpdateCollectionStandardized(
      plexClient,
      allCollections,
      items,
      {
        collectionName: config.name,
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
        totalCollectionsInLibrary: undefined, // Not applicable for multi-source
        customPoster: config.customPoster,
        processedCollectionKeys,
        libraryKey: config.libraryId,
        config,
      }
    );
  }

  /**
   * Standard collection creation/update pipeline (extracted from BaseCollectionSync)
   */
  private async createOrUpdateCollectionStandardized(
    plexClient: PlexAPI,
    allCollections: PlexCollection[],
    items: CollectionItem[],
    options: CollectionUpdateOptions
  ): Promise<{ created: number; updated: number }> {
    const { collectionName, mediaType } = options;

    // Validate items first
    const validation = validateCollectionItems(items);
    if (validation.valid.length === 0) {
      logger.warn(
        `No valid items for multi-source collection ${collectionName}`,
        {
          label: 'Multi-Source Orchestrator',
          totalItems: items.length,
          errors: validation.errors.slice(0, 5),
        }
      );
      return { created: 0, updated: 0 };
    }

    const validItems = validation.valid;
    const plexItems = validItems.map((item) => ({
      ratingKey: item.ratingKey,
      title: item.title,
    }));

    if (plexItems.length === 0) {
      return { created: 0, updated: 0 };
    }

    // Find existing collection using proper matching logic
    const existingCollection = this.findExistingMultiSourceCollection(
      options.config.id,
      collectionName,
      options.libraryKey,
      allCollections
    );

    let collectionRatingKey: string;
    let created = 0;
    let updated = 0;

    if (existingCollection) {
      // UPDATE PATH
      logger.info(
        `Updating existing multi-source collection: ${collectionName}`,
        {
          label: 'Multi-Source Orchestrator',
          configId: options.config.id,
          collectionRatingKey: existingCollection.ratingKey,
          itemCount: plexItems.length,
        }
      );

      collectionRatingKey = existingCollection.ratingKey;
      await plexClient.updateCollectionContents(collectionRatingKey, plexItems);
      updated = 1;
    } else {
      // CREATE PATH
      logger.info(`Creating new multi-source collection: ${collectionName}`, {
        label: 'Multi-Source Orchestrator',
        configId: options.config.id,
        libraryId: options.libraryKey,
        itemCount: plexItems.length,
        mediaType,
      });

      const newCollectionRatingKey = await plexClient.createEmptyCollection(
        collectionName,
        options.libraryKey,
        mediaType
      );

      if (!newCollectionRatingKey) {
        throw new Error(`Failed to create collection ${collectionName}`);
      }

      collectionRatingKey = newCollectionRatingKey;
      await plexClient.addItemsToCollection(collectionRatingKey, plexItems);
      created = 1;
    }

    // UNIFIED PIPELINE: Apply consistent metadata and settings

    // 1. Set collection to custom sort order
    await plexClient.updateCollectionContentSort(collectionRatingKey, 'custom');

    // 2. Arrange items in source order
    if (plexItems.length > 1) {
      try {
        await plexClient.arrangeCollectionItemsInOrder(
          collectionRatingKey,
          plexItems
        );
      } catch (error) {
        logger.warn(
          `Failed to arrange items in multi-source collection ${collectionName}`,
          {
            label: 'Multi-Source Orchestrator',
            error: error instanceof Error ? error.message : String(error),
          }
        );
      }
    }

    // 3. Apply metadata (labels, visibility, etc.)
    await this.updateCollectionMetadataStandardized(
      plexClient,
      collectionRatingKey,
      options,
      items // Pass items for poster generation
    );

    // 4. Track processed collection
    if (options.processedCollectionKeys) {
      options.processedCollectionKeys.add(collectionRatingKey);
    }

    // 5. Update config with rating key
    updateConfigWithRatingKey(
      options.config.id,
      collectionRatingKey,
      options.libraryKey
    );

    return { created, updated };
  }

  /**
   * Apply metadata and visibility settings using standard pattern
   */
  private async updateCollectionMetadataStandardized(
    plexClient: PlexAPI,
    collectionRatingKey: string,
    options: MetadataUpdateOptions,
    items: CollectionItem[]
  ): Promise<void> {
    // 1. Add proper Agregarr label (replaces any existing Agregarr labels)
    await plexClient.addLabelToCollection(
      collectionRatingKey,
      options.customLabel
    );

    // 2. Update visibility settings
    const visibilityConfig = options.visibilityConfig;
    if (visibilityConfig) {
      const hasAnyVisibility =
        visibilityConfig.usersHome ||
        visibilityConfig.serverOwnerHome ||
        visibilityConfig.libraryRecommended;

      if (hasAnyVisibility) {
        await plexClient.updateCollectionVisibility(
          collectionRatingKey,
          visibilityConfig.libraryRecommended, // recommended
          visibilityConfig.serverOwnerHome, // home
          visibilityConfig.usersHome // shared
        );
      }
    }

    // 3. Apply sortTitle for promoted collections and reordering
    if (options.sortOrderLibrary !== undefined) {
      await this.updateSortTitle(
        plexClient,
        collectionRatingKey,
        options.config.name,
        options.config
      );
    }

    // 4. Generate poster if autoPoster is enabled
    if (options.config.autoPoster !== false) {
      await this.generateMultiSourcePoster(
        options.config,
        collectionRatingKey,
        plexClient,
        items // Pass actual items for poster generation
      );
    }

    logger.debug(`Applied standardized metadata to multi-source collection`, {
      label: 'Multi-Source Orchestrator',
      configId: options.config.id,
      collectionRatingKey,
      customLabel: options.customLabel,
      visibilityConfig: options.visibilityConfig,
    });
  }

  /**
   * Find existing multi-source collection using proper matching logic
   * Returns the actual collection object (not just boolean like findCollectionByConfigId)
   */
  private findExistingMultiSourceCollection(
    configId: string,
    collectionName: string,
    libraryKey: string,
    allCollections: PlexCollection[]
  ): PlexCollection | null {
    // 1. Try to find by Agregarr label first (most reliable)
    for (const collection of allCollections) {
      // Must be in same library
      if (
        collection.libraryKey &&
        String(collection.libraryKey) !== String(libraryKey)
      ) {
        continue;
      }

      if (collection.labels) {
        const hasMatchingLabel = collection.labels.some((label) => {
          const labelText =
            typeof label === 'string'
              ? label
              : (label as { tag: string }).tag || '';
          const parsedConfigId = parseConfigIdFromLabel(labelText);
          return parsedConfigId === configId;
        });

        if (hasMatchingLabel) {
          logger.debug(`Found multi-source collection by label: ${configId}`, {
            label: 'Multi-Source Orchestrator',
            configId,
            collectionTitle: collection.title,
            collectionRatingKey: collection.ratingKey,
          });
          return collection;
        }
      }
    }

    // 2. Fallback to exact name matching (less reliable)
    const nameMatch = allCollections.find(
      (collection) =>
        collection.title === collectionName &&
        collection.libraryKey === libraryKey
    );

    if (nameMatch) {
      logger.debug(`Found multi-source collection by name: ${collectionName}`, {
        label: 'Multi-Source Orchestrator',
        configId,
        collectionTitle: nameMatch.title,
        collectionRatingKey: nameMatch.ratingKey,
      });
      return nameMatch;
    }

    logger.debug(
      `No existing multi-source collection found for: ${collectionName}`,
      {
        label: 'Multi-Source Orchestrator',
        configId,
        searchCriteria: { name: collectionName, libraryKey },
      }
    );

    return null;
  }

  /**
   * Generate poster for multi-source collection if autoPoster is enabled
   */
  private async generateMultiSourcePoster(
    config: MultiSourceCollectionConfig,
    collectionRatingKey: string,
    plexClient: PlexAPI,
    items: CollectionItem[]
  ): Promise<void> {
    // Check if autoPoster is enabled (default to true for multi-source)
    const shouldGeneratePoster = config.autoPoster ?? true;
    if (!shouldGeneratePoster) {
      return;
    }

    try {
      // Determine media type from items or config
      const mediaType = items[0]?.type || config.mediaType || 'movie';

      // Convert collection items to poster items format
      const posterItems: CollectionItemWithPoster[] = items
        .slice(0, 4)
        .map((item) => ({
          title: item.title,
          type: item.type as 'movie' | 'tv',
          tmdbId: item.tmdbId,
          year: item.year,
        }));

      // Generate the poster using multi-source type
      const posterFilename = await generatePoster(
        {
          collectionName: config.name,
          collectionType: 'multi-source', // Use our new color scheme
          mediaType,
          items: posterItems,
          autoPosterTemplate: config.autoPosterTemplate, // Use configured template or default
        },
        `Multi-Source: ${config.name}`,
        config.id
      );

      if (posterFilename) {
        // Get the full poster path
        const posterPath = getPosterPath(posterFilename);

        // Apply the poster to the collection
        await plexClient.updateCollectionPoster(
          collectionRatingKey,
          posterPath
        );

        logger.info(
          `Generated and applied poster for multi-source collection: ${config.name}`,
          {
            label: 'Multi-Source Orchestrator',
            configId: config.id,
            collectionRatingKey,
            posterFilename,
          }
        );
      }
    } catch (error) {
      logger.error(
        `Failed to generate poster for multi-source collection: ${config.name}`,
        {
          label: 'Multi-Source Orchestrator',
          configId: config.id,
          collectionRatingKey,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      // Don't throw - poster generation failure shouldn't break collection sync
    }
  }

  /**
   * Handle inactive multi-source collection (remove from Plex when time-restricted)
   */
  private async handleInactiveCollection(
    config: MultiSourceCollectionConfig,
    plexClient: PlexAPI,
    allCollections: PlexCollection[],
    processedCollectionKeys?: Set<string>
  ): Promise<void> {
    // Find existing collection
    const existingCollection = allCollections.find(
      (c) => c.title === config.name && c.libraryKey === config.libraryId
    );

    if (existingCollection) {
      logger.info(
        `Removing inactive multi-source collection from Plex: ${config.name}`,
        {
          label: 'Multi-Source Orchestrator',
          configId: config.id,
          collectionRatingKey: existingCollection.ratingKey,
        }
      );

      // Remove the collection from Plex
      await plexClient.deleteCollection(existingCollection.ratingKey);

      // Track as processed to prevent cleanup service from trying to delete it again
      if (processedCollectionKeys) {
        processedCollectionKeys.add(existingCollection.ratingKey);
      }
    } else {
      logger.debug(
        `No existing collection found to remove for inactive multi-source collection: ${config.name}`,
        {
          label: 'Multi-Source Orchestrator',
          configId: config.id,
        }
      );
    }
  }

  /**
   * Update collection sortTitle for promoted collections and reordering
   * Based on BaseCollectionSync sortTitle logic
   */
  private async updateSortTitle(
    plexClient: PlexAPI,
    collectionRatingKey: string,
    collectionName: string,
    config: MultiSourceCollectionConfig
  ): Promise<void> {
    // Only update sortTitle if we have sortOrderLibrary defined
    if (config.sortOrderLibrary === undefined) {
      return;
    }

    try {
      const settings = getSettings();
      const allConfigs = settings.plex.collectionConfigs || [];

      // Find this config in the settings to check everLibraryPromoted status
      const matchingConfig = allConfigs.find((c) => c.id === config.id);

      // Only update sortTitle if everLibraryPromoted is not explicitly false
      if (matchingConfig?.everLibraryPromoted === false) {
        return;
      }

      let sortTitle: string;
      const isLibraryPromoted = config.isLibraryPromoted || false;
      const sortOrderLibrary = config.sortOrderLibrary;

      if (isLibraryPromoted && sortOrderLibrary > 0) {
        // Promoted: Set exclamation marks based on sort order
        const sameLibraryConfigs = allConfigs.filter((c) => {
          const configLibraryId = Array.isArray(c.libraryId)
            ? c.libraryId[0]
            : c.libraryId;
          return (
            configLibraryId === config.libraryId &&
            c.sortOrderLibrary !== undefined &&
            c.isLibraryPromoted === true
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
        // Demoted: Reset to natural title
        sortTitle = collectionName;
      }

      // Update the sortTitle in Plex
      await plexClient.updateCollectionSortTitle(
        collectionRatingKey,
        sortTitle
      );

      logger.debug(
        `Updated sortTitle for multi-source collection: ${collectionName} -> ${sortTitle}`,
        {
          label: 'Multi-Source Orchestrator',
          configId: config.id,
          collectionRatingKey,
          sortTitle,
          isLibraryPromoted,
          sortOrderLibrary,
        }
      );
    } catch (error) {
      logger.error(
        `Failed to update sortTitle for multi-source collection: ${collectionName}`,
        {
          label: 'Multi-Source Orchestrator',
          configId: config.id,
          collectionRatingKey,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      // Don't throw - sortTitle update failure shouldn't break collection sync
    }
  }
}
