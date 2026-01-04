import type PlexAPI from '@server/api/plexapi';
import type { LibraryItemsCache } from '@server/lib/collections/core/CollectionUtilities';
import type {
  CollectionItem,
  CollectionSource,
  CollectionSyncOptions,
  MissingItem,
  PlexCollection,
} from '@server/lib/collections/core/types';
import { CollectionSyncErrorType } from '@server/lib/collections/core/types';
// getCollectionMediaType removed - using items[0]?.type instead
import type { BaseCollectionSync } from '@server/lib/collections/core/BaseCollectionSync';
import {
  applyCollectionExclusions,
  createCollectionLabel,
  createSyncError,
  getCollectionSyncCounter,
  getMediaTypeFromLibrary,
  handleRateLimit,
  incrementCollectionSyncCounter,
  parseConfigIdFromLabel,
  processMissingItemsWithMode,
  updateConfigWithRatingKey,
  validateAndSanitizeItems,
  validateCollectionItems,
} from '@server/lib/collections/core/CollectionUtilities';
import { AnilistCollectionSync } from '@server/lib/collections/sources/anilist';
import { ComingSoonCollectionSync } from '@server/lib/collections/sources/comingsoon';
import { ImdbCollectionSync } from '@server/lib/collections/sources/imdb';
import { LetterboxdCollectionSync } from '@server/lib/collections/sources/letterboxd';
import { MDBListCollectionSync } from '@server/lib/collections/sources/mdblist';
import { MyAnimeListCollectionSync } from '@server/lib/collections/sources/myanimelist';
import { NetworksCollectionSync } from '@server/lib/collections/sources/networks';
import { OriginalsCollectionSync } from '@server/lib/collections/sources/originals';
import { OverseerrCollectionSync } from '@server/lib/collections/sources/overseerrSync';
import RadarrTagCollectionSync from '@server/lib/collections/sources/radarr';
import SonarrTagCollectionSync from '@server/lib/collections/sources/sonarr';
import { TautulliCollectionSync } from '@server/lib/collections/sources/tautulli';
import { TmdbCollectionSync } from '@server/lib/collections/sources/tmdb';
import { TraktCollectionSync } from '@server/lib/collections/sources/trakt';
import { TimeRestrictionUtils } from '@server/lib/collections/utils/TimeRestrictionUtils';
import type { CollectionItemWithPoster } from '@server/lib/posterGeneration';
import { generatePoster } from '@server/lib/posterStorage';
import type {
  CollectionConfig,
  MultiSourceCollectionConfig,
  SourceDefinition,
} from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import {
  buildTraktRedirectUri,
  persistTraktTokens,
} from '@server/utils/traktAuth';

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
  private syncServices = new Map<
    string,
    BaseCollectionSync<CollectionSource>
  >();
  private dynamicCycleTitle: string | null = null;

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
    let configForSync: MultiSourceCollectionConfig = config;
    let collectionNameForSync = config.name;

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
        sourceCount: config.sources?.length ?? 0,
        combineMode: config.combineMode,
        isActive: timeRestrictionResult.isActive,
      });

      // Validate sources array is not empty (prevents division by zero in cycle_lists mode)
      if (!config.sources || config.sources.length === 0) {
        logger.error(
          `Multi-source collection ${config.name} has no sources configured`,
          {
            label: 'Multi-Source Orchestrator',
            configId: config.id,
            combineMode: config.combineMode,
          }
        );
        return { created: 0, updated: 0 };
      }

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
      const missingItemGroups: MissingItem[][] = [];

      // For cycle_lists mode, only fetch from the active source
      // For other modes, fetch from all sources
      const sourcesToFetch =
        config.combineMode === 'cycle_lists'
          ? [
              config.sources[
                getCollectionSyncCounter(config.id) % config.sources.length
              ],
            ]
          : config.sources;

      logger.debug(
        `Fetching from ${sourcesToFetch.length} source(s) for ${config.combineMode} mode`,
        {
          label: 'Multi-Source Orchestrator',
          configId: config.id,
          combineMode: config.combineMode,
          totalSources: config.sources.length,
          fetchingSources: sourcesToFetch.length,
        }
      );

      // Handle DYNAMIC_CYCLE_TITLE for cycle_lists mode
      if (
        config.combineMode === 'cycle_lists' &&
        config.template === 'DYNAMIC_CYCLE_TITLE' &&
        sourcesToFetch.length === 1
      ) {
        const activeSource = sourcesToFetch[0];
        this.dynamicCycleTitle = await this.extractTitleFromSource(
          activeSource
        );

        if (this.dynamicCycleTitle) {
          const previousName = config.name;
          collectionNameForSync = this.dynamicCycleTitle;
          configForSync = {
            ...config,
            name: this.dynamicCycleTitle,
          } as MultiSourceCollectionConfig;

          // Persist updated name for subsequent syncs
          this.updateCollectionConfigField(config.id, {
            name: this.dynamicCycleTitle,
          });

          logger.info(
            `Dynamic cycle title set for collection ${previousName}: ${this.dynamicCycleTitle}`,
            {
              label: 'Multi-Source Orchestrator',
              configId: config.id,
              sourceId: activeSource.id,
              sourceType: activeSource.type,
              sourceSubtype: activeSource.subtype,
              dynamicTitle: this.dynamicCycleTitle,
            }
          );
        }
      }

      // Fetch items from sources
      for (let i = 0; i < sourcesToFetch.length; i++) {
        const source = sourcesToFetch[i];

        try {
          // Apply rate limiting between source fetches
          if (i > 0) {
            await handleRateLimit(1, 'Multi-Source');
          }

          const { items, missingItems } = await this.fetchItemsFromSource(
            source,
            config,
            plexClient,
            libraryCache,
            options
          );
          if (items.length > 0) {
            itemGroups.push(items);
          }
          if (missingItems && missingItems.length > 0) {
            missingItemGroups.push(missingItems);
          }
          logger.debug(
            `Fetched ${items.length} items from source ${source.id}`,
            {
              label: 'Multi-Source Orchestrator',
              configId: config.id,
              sourceId: source.id,
              sourceType: source.type,
              itemCount: items.length,
              missingItemCount: missingItems?.length || 0,
            }
          );
        } catch (error) {
          // Proper error serialization - handle CollectionSyncError objects
          let errorMessage: string;
          const errorDetails: Record<string, unknown> = {};

          if (error instanceof Error) {
            errorMessage = error.message;
            if (error.stack) {
              errorDetails.stack = error.stack;
            }
          } else if (
            typeof error === 'object' &&
            error !== null &&
            'message' in error
          ) {
            // CollectionSyncError or similar structured error
            const structuredError = error as {
              message: string;
              type?: string;
              details?: Record<string, unknown>;
              originalError?: Error;
            };
            errorMessage = structuredError.message;
            if (structuredError.type) {
              errorDetails.errorType = structuredError.type;
            }
            if (structuredError.details) {
              errorDetails.errorDetails = structuredError.details;
            }
            if (structuredError.originalError) {
              errorDetails.originalError =
                structuredError.originalError.message;
              errorDetails.originalStack = structuredError.originalError.stack;
            }
          } else {
            errorMessage = String(error);
          }

          logger.error(`Failed to fetch from source ${source.id}:`, {
            label: 'Multi-Source Orchestrator',
            configId: config.id,
            sourceId: source.id,
            sourceType: source.type,
            error: errorMessage,
            ...errorDetails,
          });
          // Continue with other sources
        }
      }

      // Combine items according to mode
      const combinedItems = this.combineItems(
        itemGroups,
        config.combineMode,
        configForSync
      );

      // 3. Validation & Filtering - use standard pipeline utilities
      const { validItems, invalidItems, validationErrors } =
        validateAndSanitizeItems(combinedItems);

      if (invalidItems.length > 0) {
        logger.debug(
          `Filtered ${invalidItems.length} invalid items from multi-source collection: ${collectionNameForSync}`,
          {
            label: 'Multi-Source Orchestrator',
            configId: config.id,
            validationErrors: validationErrors.slice(0, 5), // Show first 5 errors
          }
        );
      }

      // Apply collection mutual exclusion if configured
      const itemsAfterExclusion = await applyCollectionExclusions(
        validItems,
        configForSync,
        plexClient,
        'multi-source'
      );

      // Apply maxItems limit if specified
      const finalItems =
        config.maxItems && config.maxItems > 0
          ? itemsAfterExclusion.slice(0, config.maxItems)
          : itemsAfterExclusion;

      if (finalItems.length === 0) {
        logger.warn(
          `No valid items found from any source for multi-source collection: ${collectionNameForSync}`,
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

      // Handle placeholder cleanup for multi-source collection
      // If createPlaceholdersForMissing enabled: cleans up released/orphaned/stale items
      // If createPlaceholdersForMissing disabled: deletes all placeholder records
      try {
        // Collect all tmdbIds from ALL sources (both items that exist in Plex and missing items)
        const allSourceTmdbIds = new Set<number>();

        // Add tmdbIds from items that exist in Plex
        for (const item of combinedItems) {
          if (item.tmdbId !== undefined) {
            allSourceTmdbIds.add(item.tmdbId);
          }
        }

        // Add tmdbIds from missing items across all sources
        for (const missingGroup of missingItemGroups) {
          for (const missingItem of missingGroup) {
            allSourceTmdbIds.add(missingItem.tmdbId);
          }
        }

        logger.debug(
          `Running placeholder handling for multi-source collection: ${collectionNameForSync}`,
          {
            label: 'Multi-Source Orchestrator',
            configId: config.id,
            sourceTmdbIdCount: allSourceTmdbIds.size,
            createPlaceholdersForMissing: config.createPlaceholdersForMissing,
          }
        );

        // Import helper function that handles both enabled/disabled cases
        const { handlePlaceholderCleanup } = await import(
          '@server/lib/placeholders/services/PlaceholderCleanup'
        );

        // Run cleanup or deletion based on setting
        await handlePlaceholderCleanup(
          configForSync as unknown as CollectionConfig,
          plexClient,
          libraryCache,
          allSourceTmdbIds
        );

        logger.debug(
          'Placeholder handling completed for multi-source collection',
          {
            label: 'Multi-Source Orchestrator',
            configId: config.id,
          }
        );
      } catch (cleanupError) {
        logger.error(
          `Failed to handle placeholders for multi-source collection: ${collectionNameForSync}`,
          {
            label: 'Multi-Source Orchestrator',
            configId: config.id,
            error:
              cleanupError instanceof Error
                ? cleanupError.message
                : String(cleanupError),
          }
        );
        // Don't throw - cleanup failure shouldn't break collection sync
      }

      // Create/update collection directly in Plex
      const result = await this.createOrUpdatePlexCollection(
        finalItems,
        configForSync,
        plexClient,
        allCollections,
        processedCollectionKeys
      );

      // Process missing items if enabled
      logger.debug(
        `Missing items check for multi-source collection: ${collectionNameForSync}`,
        {
          label: 'Multi-Source Orchestrator',
          configId: config.id,
          missingItemGroupsCount: missingItemGroups.length,
          totalMissingItems: missingItemGroups.flat().length,
          searchMissingMovies: config.searchMissingMovies,
          searchMissingTV: config.searchMissingTV,
          downloadMode: config.downloadMode,
        }
      );

      if (
        missingItemGroups.length > 0 &&
        (config.searchMissingMovies || config.searchMissingTV)
      ) {
        // Combine missing items based on combine mode
        const combinedMissingItems = this.combineMissingItems(
          missingItemGroups,
          config.combineMode,
          configForSync
        );

        if (combinedMissingItems.length > 0) {
          logger.info(
            `Processing ${combinedMissingItems.length} missing items for multi-source collection: ${collectionNameForSync}`,
            {
              label: 'Multi-Source Orchestrator',
              configId: config.id,
              missingItemCount: combinedMissingItems.length,
            }
          );

          try {
            // Cast to CollectionConfig to include missing items fields
            await processMissingItemsWithMode(
              combinedMissingItems,
              configForSync as unknown as CollectionConfig,
              'multi-source'
            );
          } catch (error) {
            logger.error(
              `Failed to process missing items for multi-source collection: ${collectionNameForSync}`,
              {
                label: 'Multi-Source Orchestrator',
                configId: config.id,
                error: error instanceof Error ? error.message : String(error),
              }
            );
          }
        } else {
          logger.debug(
            `No missing items after combination for multi-source collection: ${collectionNameForSync}`,
            {
              label: 'Multi-Source Orchestrator',
              configId: config.id,
            }
          );
        }
      } else {
        logger.debug(
          `Skipping missing items processing for multi-source collection: ${collectionNameForSync}`,
          {
            label: 'Multi-Source Orchestrator',
            configId: config.id,
            reason:
              missingItemGroups.length === 0
                ? 'No missing items found'
                : 'Search missing items not enabled',
          }
        );
      }

      return result;
    } catch (error) {
      const safeName =
        typeof collectionNameForSync === 'string'
          ? collectionNameForSync
          : config.name;

      // 4. Error Handling - use standard pipeline utilities
      const syncError = createSyncError(
        CollectionSyncErrorType.COLLECTION_ERROR,
        `Failed to process multi-source collection ${safeName}`,
        { configId: config.id, configName: safeName },
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
  ): Promise<{ items: CollectionItem[]; missingItems?: MissingItem[] }> {
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

      const { items, missingItems } =
        await syncService.applyFilteringToMappedItems(mappedResult, tempConfig);

      // Note: Overlays for Coming Soon items are applied by the overlay sync job
      // The collection sync only handles collection membership and placeholder creation

      // Handle placeholder creation for missing items using unified flow
      // This respects the createPlaceholdersForMissing checkbox on the parent config
      if (
        parentConfig.createPlaceholdersForMissing &&
        missingItems &&
        missingItems.length > 0
      ) {
        logger.info(
          `Creating placeholders for ${missingItems.length} missing items from ${source.type}`,
          {
            label: 'Multi-Source Orchestrator',
            sourceId: source.id,
            sourceType: source.type,
            missingCount: missingItems.length,
          }
        );

        try {
          // Use PlaceholderCreation service for unified placeholder creation
          // This works for any source type, not just Coming Soon
          const { processPlaceholdersForMissingItems } = await import(
            '@server/lib/placeholders/services/PlaceholderCreation'
          );

          const newPlaceholderItems = await processPlaceholdersForMissingItems(
            missingItems,
            tempConfig,
            plexClient
          );

          // Add the newly created placeholders to the items array
          items.push(...newPlaceholderItems);

          logger.info('Placeholder creation completed', {
            label: 'Multi-Source Orchestrator',
            sourceId: source.id,
            sourceType: source.type,
            createdCount: newPlaceholderItems.length,
            totalItemsNow: items.length,
          });
        } catch (error) {
          logger.error('Failed to create placeholders in multi-source', {
            label: 'Multi-Source Orchestrator',
            sourceId: source.id,
            sourceType: source.type,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Note: We no longer add "released" items for Coming Soon
      // When real content is detected, placeholder is deleted immediately
      // Real items appear naturally if still in the source list

      logger.debug(
        `Successfully fetched ${items.length} items from ${source.type}`,
        {
          label: 'Multi-Source Orchestrator',
          sourceId: source.id,
          sourceType: source.type,
          itemCount: items.length,
          missingItemCount: missingItems?.length || 0,
        }
      );

      return { items, missingItems };
    } catch (error) {
      // Proper error serialization - handle CollectionSyncError objects
      let errorMessage: string;
      const errorDetails: Record<string, unknown> = {};

      if (error instanceof Error) {
        errorMessage = error.message;
        if (error.stack) {
          errorDetails.stack = error.stack;
        }
      } else if (
        typeof error === 'object' &&
        error !== null &&
        'message' in error
      ) {
        // CollectionSyncError or similar structured error
        const structuredError = error as {
          message: string;
          type?: string;
          details?: Record<string, unknown>;
          originalError?: Error;
        };
        errorMessage = structuredError.message;
        if (structuredError.type) {
          errorDetails.errorType = structuredError.type;
        }
        if (structuredError.details) {
          errorDetails.errorDetails = structuredError.details;
        }
        if (structuredError.originalError) {
          errorDetails.originalError = structuredError.originalError.message;
          errorDetails.originalStack = structuredError.originalError.stack;
        }
      } else {
        errorMessage = String(error);
      }

      logger.error(`Failed to fetch items from ${source.type}:`, {
        label: 'Multi-Source Orchestrator',
        sourceId: source.id,
        sourceType: source.type,
        error: errorMessage,
        ...errorDetails,
      });
      return { items: [] };
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
          tmdbCustomCollectionUrl: source.customUrl,
        }),
      ...(source.type === 'imdb' &&
        source.customUrl && {
          imdbCustomListUrl: source.customUrl,
        }),
      ...(source.type === 'letterboxd' &&
        source.customUrl && {
          letterboxdCustomListUrl: source.customUrl,
        }),
      ...(source.type === 'anilist' &&
        source.customUrl && {
          anilistCustomListUrl: source.customUrl,
        }),
      ...(source.type === 'radarrtag' && {
        radarrInstanceId:
          source.radarrTagServerId !== undefined
            ? Number(source.radarrTagServerId)
            : undefined,
        radarrTagId:
          source.radarrTagId !== undefined
            ? Number(source.radarrTagId)
            : undefined,
      }),
      ...(source.type === 'sonarrtag' && {
        sonarrInstanceId:
          source.sonarrTagServerId !== undefined
            ? Number(source.sonarrTagServerId)
            : undefined,
        sonarrTagId:
          source.sonarrTagId !== undefined
            ? Number(source.sonarrTagId)
            : undefined,
      }),
      ...(source.type === 'networks' && {
        networksCountry: source.networksCountry,
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
  private getSyncService(
    sourceType: string
  ): BaseCollectionSync<CollectionSource> {
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
        case 'networks':
          this.syncServices.set(sourceType, new NetworksCollectionSync());
          break;
        case 'originals':
          this.syncServices.set(sourceType, new OriginalsCollectionSync());
          break;
        case 'anilist':
          this.syncServices.set(sourceType, new AnilistCollectionSync());
          break;
        case 'myanimelist':
          this.syncServices.set(sourceType, new MyAnimeListCollectionSync());
          break;
        case 'radarrtag':
          this.syncServices.set(sourceType, new RadarrTagCollectionSync());
          break;
        case 'sonarrtag':
          this.syncServices.set(sourceType, new SonarrTagCollectionSync());
          break;
        case 'comingsoon':
          this.syncServices.set(sourceType, new ComingSoonCollectionSync());
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
   * Special cases:
   * - If ALL sources are Coming Soon: default to release date sorting, but allow cycle_lists and randomised
   * - If SOME sources are Coming Soon: sort those sources by release date, then combine using normal mode
   */
  private combineItems(
    itemGroups: CollectionItem[][],
    combineMode: 'interleaved' | 'list_order' | 'randomised' | 'cycle_lists',
    parentConfig: MultiSourceCollectionConfig
  ): CollectionItem[] {
    const sources = parentConfig.sources || [];

    // Check if ALL sources are Coming Soon
    const allSourcesComingSoon =
      sources.length > 0 &&
      sources.every((source) => source.type === 'comingsoon');

    if (allSourcesComingSoon) {
      // All sources are Coming Soon
      // Allow cycle_lists and randomised modes, otherwise sort by release date
      // Note: 360-day filtering already applied by Coming Soon source's applyCommonFiltering
      if (combineMode === 'cycle_lists') {
        // Sort each Coming Soon source by release date, then cycle between them
        const sortedItemGroups = itemGroups.map((group) =>
          this.sortComingSoonByReleaseDate(group)
        );
        return this.cycleListsItems(sortedItemGroups, parentConfig.id);
      } else if (combineMode === 'randomised') {
        // Flatten, remove duplicates, then shuffle (already filtered by source)
        const allItems = itemGroups.flat();
        const uniqueItems = this.removeDuplicates(allItems);
        return this.shuffleArray([...uniqueItems]);
      } else {
        // Default: flatten and sort by release date (for interleaved, list_order, or any other mode)
        const allItems = itemGroups.flat();
        const uniqueItems = this.removeDuplicates(allItems);
        return this.sortComingSoonByReleaseDate(uniqueItems);
      }
    }

    // Check if SOME sources are Coming Soon
    const someSourcesComingSoon = sources.some(
      (source) => source.type === 'comingsoon'
    );

    if (someSourcesComingSoon) {
      // Sort Coming Soon source groups by release date before combining
      const sortedItemGroups = itemGroups.map((group, index) => {
        const source = sources[index];
        if (source?.type === 'comingsoon') {
          return this.sortComingSoonByReleaseDate(group);
        }
        return group;
      });
      itemGroups = sortedItemGroups;
    }

    // Normal multi-source combine modes (with Coming Soon sources pre-sorted if applicable)
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
   * Combine missing items from multiple sources according to the specified mode
   * For cycle_lists mode, we only fetched from one source, so just return that
   * For other modes, combines all missing items and removes duplicates
   */
  private combineMissingItems(
    missingItemGroups: MissingItem[][],
    combineMode: 'interleaved' | 'list_order' | 'randomised' | 'cycle_lists',
    parentConfig: MultiSourceCollectionConfig
  ): MissingItem[] {
    if (missingItemGroups.length === 0) return [];

    switch (combineMode) {
      case 'cycle_lists': {
        // For cycle_lists, we only fetched from the active source
        // So missingItemGroups should have exactly 1 array
        const missingItems = missingItemGroups[0] || [];

        logger.debug(`Cycle lists missing items from active source`, {
          label: 'Multi-Source Orchestrator',
          configId: parentConfig.id,
          missingItemCount: missingItems.length,
        });

        return missingItems;
      }

      case 'interleaved':
      case 'list_order':
      case 'randomised':
      default: {
        // For all other modes, combine ALL missing items from ALL sources
        const allMissingItems = missingItemGroups.flat();

        // Remove duplicates based on tmdbId and mediaType
        const uniqueMissingItems = allMissingItems.reduce(
          (acc, item) => {
            const key = `${item.tmdbId}-${item.mediaType}`;
            if (!acc.seen.has(key)) {
              acc.seen.add(key);
              acc.items.push(item);
            }
            return acc;
          },
          { seen: new Set<string>(), items: [] as MissingItem[] }
        ).items;

        logger.debug(
          `Combined missing items from ${missingItemGroups.length} sources`,
          {
            label: 'Multi-Source Orchestrator',
            configId: parentConfig.id,
            combineMode,
            totalMissingItems: allMissingItems.length,
            uniqueMissingItems: uniqueMissingItems.length,
          }
        );

        return uniqueMissingItems;
      }
    }
  }

  /**
   * Check if an existing collection needs to be recreated due to type mismatch
   * This handles cases like cycle_lists mode switching between shows and episodes
   */
  private async shouldRecreateCollection(
    plexClient: PlexAPI,
    collectionRatingKey: string,
    currentContainsEpisodes: boolean,
    mediaType: 'movie' | 'tv'
  ): Promise<boolean> {
    // Only need to check TV collections (movies can't have episode content)
    if (mediaType !== 'tv') {
      return false;
    }

    try {
      // Get current collection items to analyze their type
      const currentItemRatingKeys = await plexClient.getCollectionItems(
        collectionRatingKey
      );

      // For empty collections, we need to check the collection's inherent type
      // Unfortunately, Plex doesn't directly expose this, but we can infer it by
      // attempting a test operation or checking collection metadata
      if (currentItemRatingKeys.length === 0) {
        // For empty collections, we'll be conservative and recreate if we suspect a mismatch
        // This is better than failing to add items due to type incompatibility
        logger.debug(
          `Empty collection found - will recreate to ensure correct type`,
          {
            label: 'Multi-Source Orchestrator',
            collectionRatingKey,
            currentContainsEpisodes,
          }
        );
        return true; // Always recreate empty collections to be safe
      }

      // Sample first few items to determine current collection type
      const sampleSize = Math.min(currentItemRatingKeys.length, 3);
      let existingContainsEpisodes = false;

      for (let i = 0; i < sampleSize; i++) {
        try {
          const itemDetails = await plexClient.getMetadata(
            currentItemRatingKeys[i]
          );
          // Check if item is an episode (type === 'episode' or has parentRatingKey indicating it's a child item)
          if (itemDetails?.type === 'episode' || itemDetails?.parentRatingKey) {
            existingContainsEpisodes = true;
            break;
          }
        } catch (error) {
          // If we can't get item details, skip this check
          logger.debug(
            `Could not check item type for recreation decision: ${error}`,
            {
              label: 'Multi-Source Orchestrator',
              itemRatingKey: currentItemRatingKeys[i],
            }
          );
        }
      }

      // Return true if there's a type mismatch
      const needsRecreation =
        existingContainsEpisodes !== currentContainsEpisodes;

      if (needsRecreation) {
        logger.debug(`Collection type mismatch detected`, {
          label: 'Multi-Source Orchestrator',
          collectionRatingKey,
          existingContainsEpisodes,
          currentContainsEpisodes,
        });
      }

      return needsRecreation;
    } catch (error) {
      logger.warn(
        `Could not determine if collection needs recreation: ${error}`,
        {
          label: 'Multi-Source Orchestrator',
          collectionRatingKey,
        }
      );
      // If we can't determine, err on the side of recreating to avoid update failures
      return true;
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
   * Sort Coming Soon items by release date (closest first)
   * Items without dates are placed at the end
   *
   * Note: This uses releaseDateSortValue from the item's metadata which is
   * set by the Coming Soon collection sync based on the same priority logic
   * as banner display (Digital > Physical > Theatrical > Generic)
   *
   * Note: 360-day filtering is already applied by the Coming Soon source's applyCommonFiltering
   */
  private sortComingSoonByReleaseDate(
    items: CollectionItem[]
  ): CollectionItem[] {
    logger.debug('Sorting Coming Soon items by release date', {
      label: 'Multi-Source Orchestrator',
      itemCount: items.length,
      sampleItems: items.slice(0, 3).map((item) => ({
        title: item.title,
        tmdbId: item.tmdbId,
        releaseDateSortValue: (
          item as CollectionItem & { releaseDateSortValue?: string }
        ).releaseDateSortValue,
      })),
    });

    const sorted = [...items].sort((a, b) => {
      // Try to get release date from item metadata
      // Coming Soon items should have releaseDateSortValue set during sync
      const dateA = (a as CollectionItem & { releaseDateSortValue?: string })
        .releaseDateSortValue;
      const dateB = (b as CollectionItem & { releaseDateSortValue?: string })
        .releaseDateSortValue;

      // Items without dates go to the end
      if (!dateA && !dateB) return 0;
      if (!dateA) return 1;
      if (!dateB) return -1;

      // Sort by closest date first
      return new Date(dateA).getTime() - new Date(dateB).getTime();
    });

    logger.debug('Coming Soon items sorted by release date', {
      label: 'Multi-Source Orchestrator',
      sortedSample: sorted.slice(0, 3).map((item) => ({
        title: item.title,
        releaseDate: (
          item as CollectionItem & { releaseDateSortValue?: string }
        ).releaseDateSortValue,
      })),
    });

    return sorted;
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

    logger.debug(`PlexItems order before sending to Plex`, {
      label: 'Multi-Source Orchestrator',
      collectionName,
      itemCount: plexItems.length,
      first5Items: plexItems.slice(0, 5).map((item) => ({
        ratingKey: item.ratingKey,
        title: item.title,
      })),
    });

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

    // BRANCH: Create EITHER smart collection OR regular collection
    const shouldCreateSmartCollection =
      options.config.showUnwatchedOnly ?? false;

    let collectionRatingKey: string | undefined;
    let created = 0;
    let updated = 0;

    if (shouldCreateSmartCollection) {
      // PATH A: Create label-based smart collection
      const labelName = `agregarr-unwatched-${options.config.id}`;
      const itemRatingKeys = plexItems.map((item) => item.ratingKey);

      logger.info(
        `Creating label-based smart collection for multi-source with ${itemRatingKeys.length} labeled items`,
        {
          label: 'Multi-Source Orchestrator',
          configId: options.config.id,
          collectionName,
          labelName,
          itemCount: itemRatingKeys.length,
        }
      );

      // Label all items (new and existing)
      for (const itemKey of itemRatingKeys) {
        await plexClient.addLabelToItem(itemKey, labelName);
      }

      // CLEANUP: Remove labels from items that are no longer in the collection
      try {
        const currentlyLabeledItems = await plexClient.getItemsWithLabel(
          options.libraryKey,
          labelName
        );

        const itemsToUnlabel = currentlyLabeledItems.filter(
          (labeledItemKey) => !itemRatingKeys.includes(labeledItemKey)
        );

        if (itemsToUnlabel.length > 0) {
          logger.info(
            `Removing label from ${itemsToUnlabel.length} items no longer in multi-source collection`,
            {
              label: 'Multi-Source Orchestrator',
              collectionName,
              labelName,
              itemsToUnlabel: itemsToUnlabel.length,
            }
          );
          for (const itemKey of itemsToUnlabel) {
            await plexClient.removeLabelFromItem(itemKey, labelName);
          }
        }
      } catch (error) {
        logger.warn(
          `Failed to cleanup labels from removed items in multi-source collection`,
          {
            label: 'Multi-Source Orchestrator',
            collectionName,
            error: error instanceof Error ? error.message : String(error),
          }
        );
      }

      // MIGRATION: Check for old dual-collection system (base + smart collection)
      if (options.config.smartCollectionRatingKey) {
        logger.info(
          `Detected old dual-collection system for multi-source - migrating to label-based system`,
          {
            label: 'Multi-Source Migration',
            collectionName,
            oldSmartCollectionRatingKey:
              options.config.smartCollectionRatingKey,
            oldBaseCollectionRatingKey: options.config.collectionRatingKey,
          }
        );

        const oldSmartCollection = await plexClient.getCollectionMetadataSafe(
          options.config.smartCollectionRatingKey
        );

        if (oldSmartCollection) {
          // Delete old dash-prefixed base collection if it exists
          if (options.config.collectionRatingKey) {
            try {
              const oldBaseCollection =
                await plexClient.getCollectionMetadataSafe(
                  options.config.collectionRatingKey
                );
              if (
                oldBaseCollection &&
                oldBaseCollection.title.startsWith('-')
              ) {
                logger.info(
                  `Deleting old dash-prefixed base collection: ${oldBaseCollection.title}`,
                  {
                    label: 'Multi-Source Migration',
                    baseCollectionRatingKey: options.config.collectionRatingKey,
                  }
                );
                await plexClient.deleteCollection(
                  options.config.collectionRatingKey
                );
              }
            } catch (error) {
              logger.warn(
                `Failed to delete old base collection, continuing migration`,
                {
                  label: 'Multi-Source Migration',
                  error: error instanceof Error ? error.message : String(error),
                }
              );
            }
          }

          // Update the old smart collection to use new label-based filters
          collectionRatingKey = options.config.smartCollectionRatingKey;
          await plexClient.updateLabelBasedSmartCollectionUri(
            collectionRatingKey,
            options.libraryKey,
            labelName,
            mediaType,
            options.config.smartCollectionSort?.value,
            options.config.maxItems
          );

          // Migrate config
          if (collectionRatingKey) {
            this.updateMultiSourceConfigWithRatingKey(
              options.config,
              collectionRatingKey
            );
          }
          this.clearMultiSourceSmartCollectionRatingKey(options.config);

          logger.info(
            `Successfully migrated multi-source dual-collection to label-based system`,
            {
              label: 'Multi-Source Migration',
              collectionName,
              migratedRatingKey: collectionRatingKey,
            }
          );

          updated = 1;
        } else {
          logger.warn(
            `Old smart collection not found for multi-source, will create new label-based collection`,
            {
              label: 'Multi-Source Migration',
              oldSmartCollectionRatingKey:
                options.config.smartCollectionRatingKey,
            }
          );
          this.clearMultiSourceSmartCollectionRatingKey(options.config);
          collectionRatingKey = undefined;
        }
      }

      // Check if smart collection already exists (skip if we just migrated)
      if (!collectionRatingKey && existingCollection) {
        // Check if it's actually a smart collection
        const collectionMeta = await plexClient.getCollectionMetadata(
          existingCollection.ratingKey
        );
        const isSmart =
          collectionMeta &&
          (collectionMeta as { smart?: string }).smart === '1';

        if (isSmart) {
          // Update existing smart collection
          collectionRatingKey = existingCollection.ratingKey;
          await plexClient.updateLabelBasedSmartCollectionUri(
            collectionRatingKey,
            options.libraryKey,
            labelName,
            mediaType,
            options.config.smartCollectionSort?.value,
            options.config.maxItems
          );
          updated = 1;
        } else {
          // MIGRATION: Old system had a regular collection, delete it
          logger.info(
            `Migrating multi-source from old system - deleting regular collection`,
            {
              label: 'Multi-Source Migration',
              collectionName,
              oldCollectionRatingKey: existingCollection.ratingKey,
            }
          );
          await plexClient.deleteCollection(existingCollection.ratingKey);
          collectionRatingKey = undefined; // Force creation below
        }
      }

      if (!collectionRatingKey) {
        // Create new smart collection
        const customLabel = `agregarr-multisource-${options.config.id}`;
        const newSmartCollectionRatingKey =
          await plexClient.createLabelBasedSmartCollection(
            collectionName,
            options.libraryKey,
            labelName,
            mediaType,
            options.config.smartCollectionSort?.value,
            customLabel,
            options.config.maxItems
          );

        if (!newSmartCollectionRatingKey) {
          throw new Error(
            `Failed to create smart collection ${collectionName}`
          );
        }

        collectionRatingKey = newSmartCollectionRatingKey;
        created = 1;
      }
    } else {
      // PATH B: Create regular collection

      // MIGRATION: If existing collection is a smart collection, delete it
      if (existingCollection) {
        const collectionMeta = await plexClient.getCollectionMetadata(
          existingCollection.ratingKey
        );
        const isSmart =
          collectionMeta &&
          (collectionMeta as { smart?: string }).smart === '1';

        if (isSmart) {
          logger.info(
            `User disabled showUnwatchedOnly - migrating multi-source from smart to regular collection`,
            {
              label: 'Multi-Source Migration',
              collectionName,
              collectionRatingKey: existingCollection.ratingKey,
            }
          );

          // Clean up: remove labels from items and delete smart collection
          const labelName = `agregarr-unwatched-${options.config.id}`;
          const labeledItems = await plexClient.getItemsWithLabel(
            options.libraryKey,
            labelName
          );
          if (labeledItems.length > 0) {
            for (const itemKey of labeledItems) {
              await plexClient.removeLabelFromItem(itemKey, labelName);
            }
          }
          await plexClient.deleteCollection(existingCollection.ratingKey);

          // Force creation of regular collection below
          collectionRatingKey = undefined;
        } else {
          // UPDATE PATH: Collection exists (and is regular collection)
          // Check if we need to recreate the collection due to type mismatch
          const currentContainsEpisodes = validItems.some(
            (item) => item.episodeInfo
          );

          // Check the existing collection type by attempting to get its details
          // We'll detect mismatch by checking if update would fail
          const needsRecreation = await this.shouldRecreateCollection(
            plexClient,
            existingCollection.ratingKey,
            currentContainsEpisodes,
            mediaType
          );

          if (needsRecreation) {
            logger.info(
              `Collection type mismatch detected - recreating multi-source collection: ${collectionName}`,
              {
                label: 'Multi-Source Orchestrator',
                configId: options.config.id,
                oldCollectionRatingKey: existingCollection.ratingKey,
                currentContainsEpisodes,
                mediaType,
              }
            );

            // Delete existing collection
            await plexClient.deleteCollection(existingCollection.ratingKey);

            // Create new collection with correct type
            const newCollectionRatingKey =
              await plexClient.createEmptyCollection(
                collectionName,
                options.libraryKey,
                mediaType,
                currentContainsEpisodes
              );

            if (!newCollectionRatingKey) {
              throw new Error(
                `Failed to recreate collection ${collectionName}`
              );
            }

            collectionRatingKey = newCollectionRatingKey;
            await plexClient.updateCollectionContents(
              collectionRatingKey,
              plexItems
            );
            created = 1;
          } else {
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
            await plexClient.updateCollectionContents(
              collectionRatingKey,
              plexItems
            );
            updated = 1;
          }
        }
      }

      if (!collectionRatingKey) {
        // CREATE PATH
        const containsEpisodes = validItems.some((item) => item.episodeInfo);

        logger.info(`Creating new multi-source collection: ${collectionName}`, {
          label: 'Multi-Source Orchestrator',
          configId: options.config.id,
          libraryId: options.libraryKey,
          itemCount: plexItems.length,
          mediaType,
          containsEpisodes,
        });

        const newCollectionRatingKey = await plexClient.createEmptyCollection(
          collectionName,
          options.libraryKey,
          mediaType,
          containsEpisodes
        );

        if (!newCollectionRatingKey) {
          throw new Error(`Failed to create collection ${collectionName}`);
        }

        collectionRatingKey = newCollectionRatingKey;
        await plexClient.addItemsToCollection(collectionRatingKey, plexItems);
        created = 1;
      }

      // For regular collections: Set custom sort and arrange items
      await plexClient.updateCollectionContentSort(
        collectionRatingKey,
        'custom'
      );

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
    }

    // Ensure we have a collection rating key
    if (!collectionRatingKey) {
      throw new Error(`Failed to create or find collection ${collectionName}`);
    }

    // Apply metadata to the collection
    await this.updateCollectionMetadataStandardized(
      plexClient,
      collectionRatingKey,
      options,
      items
    );

    // Track processed collection
    if (options.processedCollectionKeys) {
      options.processedCollectionKeys.add(collectionRatingKey);
    }

    // Update config with rating key
    updateConfigWithRatingKey(
      options.config.id,
      collectionRatingKey,
      options.libraryKey
    );

    // Apply overlays if enabled for this collection
    if (options.config.applyOverlaysDuringSync && collectionRatingKey) {
      try {
        logger.info(
          'Applying overlays to multi-source collection items after sync',
          {
            label: 'Multi-Source Orchestrator',
            collectionName,
            configId: options.config.id,
            collectionRatingKey,
          }
        );

        const { overlayLibraryService } = await import(
          '@server/lib/overlays/OverlayLibraryService'
        );

        // Get item rating keys from this specific collection
        const itemRatingKeys = await plexClient.getCollectionItems(
          collectionRatingKey
        );

        if (itemRatingKeys && itemRatingKeys.length > 0) {
          logger.info('Applying overlays to collection items', {
            label: 'Multi-Source Orchestrator',
            collectionName,
            itemCount: itemRatingKeys.length,
          });

          // Apply overlays only to collection items
          await overlayLibraryService.applyOverlaysToCollectionItems(
            itemRatingKeys,
            options.libraryKey
          );
        }
      } catch (overlayError) {
        logger.error('Failed to apply overlays after multi-source sync', {
          label: 'Multi-Source Orchestrator',
          collectionName,
          error:
            overlayError instanceof Error
              ? overlayError.message
              : String(overlayError),
        });
        // Don't fail the sync if overlay application fails
      }
    }

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

    // 5. Update wallpaper/art if enabled and provided
    const customWallpaper = options.config?.customWallpaper;
    const enableCustomWallpaper =
      options.config?.enableCustomWallpaper ?? false;
    if (enableCustomWallpaper && customWallpaper) {
      let wallpaperFilename: string | undefined;

      if (typeof customWallpaper === 'string') {
        // Legacy single wallpaper
        wallpaperFilename = customWallpaper;
      } else {
        // Per-library wallpaper mapping - get wallpaper for current library
        wallpaperFilename = customWallpaper[options.config.libraryId];
      }

      if (wallpaperFilename) {
        try {
          // Get full path to wallpaper file
          const { getWallpaperPath } = await import(
            '@server/lib/wallpaperStorage'
          );
          const wallpaperPath = getWallpaperPath(wallpaperFilename);

          // Check if wallpaper needs reapplication using metadata tracking
          const metadataService = (
            await import('@server/lib/metadata/MetadataTrackingService')
          ).default;

          let shouldUploadWallpaper = true;

          try {
            const currentArtUrl = await plexClient.getCurrentArtUrl(
              collectionRatingKey
            );

            const shouldReapply = await metadataService.shouldReapplyWallpaper(
              collectionRatingKey,
              wallpaperFilename,
              currentArtUrl
            );

            if (!shouldReapply) {
              logger.info('Wallpaper unchanged, skipping reupload', {
                label: 'Multi-Source Orchestrator',
                collectionName: options.config.name,
                wallpaperFilename,
              });
              shouldUploadWallpaper = false;
            }
          } catch (metaError) {
            logger.warn('Metadata check failed, proceeding with upload', {
              label: 'MetadataTracking',
              error:
                metaError instanceof Error
                  ? metaError.message
                  : String(metaError),
            });
            // Fall through to upload
          }

          if (shouldUploadWallpaper) {
            await plexClient.uploadArtFromFile(
              collectionRatingKey,
              wallpaperPath
            );
            await plexClient.lockArt(collectionRatingKey);

            // Get new Plex art URL after upload and record metadata
            try {
              const newArtUrl = await plexClient.getCurrentArtUrl(
                collectionRatingKey
              );

              if (newArtUrl) {
                await metadataService.recordWallpaperApplication(
                  collectionRatingKey,
                  wallpaperFilename,
                  newArtUrl,
                  {
                    configId: options.config?.id,
                    libraryKey: options.config.libraryId,
                  }
                );
              }
            } catch (metaError) {
              logger.error(
                'Failed to record wallpaper metadata, upload succeeded',
                {
                  label: 'MetadataTracking',
                  error:
                    metaError instanceof Error
                      ? metaError.message
                      : String(metaError),
                }
              );
            }
          }

          logger.debug(
            `Successfully uploaded wallpaper for multi-source collection ${options.config.name}`,
            {
              label: 'Multi-Source Orchestrator',
              collectionRatingKey,
              wallpaperFilename,
            }
          );
        } catch (error) {
          logger.warn(
            `Failed to upload wallpaper for multi-source collection ${options.config.name}`,
            {
              label: 'Multi-Source Orchestrator',
              collectionRatingKey,
              wallpaperFilename,
              error: error instanceof Error ? error.message : String(error),
            }
          );
          // Don't fail the entire collection sync if wallpaper upload fails
        }
      }
    }

    // 6. Update summary if enabled and provided
    const customSummary = options.config?.customSummary;
    const enableCustomSummary = options.config?.enableCustomSummary ?? false;
    if (enableCustomSummary && customSummary) {
      try {
        await plexClient.updateSummary(collectionRatingKey, customSummary);
        logger.debug(
          `Successfully updated summary for multi-source collection ${options.config.name}`,
          {
            label: 'Multi-Source Orchestrator',
            collectionRatingKey,
          }
        );
      } catch (error) {
        logger.warn(
          `Failed to update summary for multi-source collection ${options.config.name}`,
          {
            label: 'Multi-Source Orchestrator',
            collectionRatingKey,
            error: error instanceof Error ? error.message : String(error),
          }
        );
        // Don't fail the entire collection sync if summary update fails
      }
    }

    // 7. Update theme if enabled and provided
    const customTheme = options.config?.customTheme;
    const enableCustomTheme = options.config?.enableCustomTheme ?? false;
    if (enableCustomTheme && customTheme) {
      let themeFilename: string | undefined;

      if (typeof customTheme === 'string') {
        // Legacy single theme
        themeFilename = customTheme;
      } else {
        // Per-library theme mapping - get theme for current library
        themeFilename = customTheme[options.config.libraryId];
      }

      if (themeFilename) {
        try {
          // Get full path to theme file
          const { getThemePath } = await import('@server/lib/themeStorage');
          const themePath = getThemePath(themeFilename);

          // Check if theme needs reapplication using metadata tracking
          const metadataService = (
            await import('@server/lib/metadata/MetadataTrackingService')
          ).default;

          let shouldUploadTheme = true;

          try {
            const currentThemeUrl = await plexClient.getCurrentThemeUrl(
              collectionRatingKey
            );

            const shouldReapply = await metadataService.shouldReapplyTheme(
              collectionRatingKey,
              themeFilename,
              currentThemeUrl
            );

            if (!shouldReapply) {
              logger.info('Theme unchanged, skipping reupload', {
                label: 'Multi-Source Orchestrator',
                collectionName: options.config.name,
                themeFilename,
              });
              shouldUploadTheme = false;
            }
          } catch (metaError) {
            logger.warn('Metadata check failed, proceeding with upload', {
              label: 'MetadataTracking',
              error:
                metaError instanceof Error
                  ? metaError.message
                  : String(metaError),
            });
            // Fall through to upload
          }

          if (shouldUploadTheme) {
            await plexClient.uploadThemeFromFile(
              collectionRatingKey,
              themePath
            );
            await plexClient.lockTheme(collectionRatingKey);

            // Get new Plex theme URL after upload and record metadata
            try {
              const newThemeUrl = await plexClient.getCurrentThemeUrl(
                collectionRatingKey
              );

              if (newThemeUrl) {
                await metadataService.recordThemeApplication(
                  collectionRatingKey,
                  themeFilename,
                  newThemeUrl,
                  {
                    configId: options.config?.id,
                    libraryKey: options.config.libraryId,
                  }
                );
              }
            } catch (metaError) {
              logger.error(
                'Failed to record theme metadata, upload succeeded',
                {
                  label: 'MetadataTracking',
                  error:
                    metaError instanceof Error
                      ? metaError.message
                      : String(metaError),
                }
              );
            }
          }

          logger.debug(
            `Successfully uploaded theme for multi-source collection ${options.config.name}`,
            {
              label: 'Multi-Source Orchestrator',
              collectionRatingKey,
              themeFilename,
            }
          );
        } catch (error) {
          logger.warn(
            `Failed to upload theme for multi-source collection ${options.config.name}`,
            {
              label: 'Multi-Source Orchestrator',
              collectionRatingKey,
              themeFilename,
              error: error instanceof Error ? error.message : String(error),
            }
          );
          // Don't fail the entire collection sync if theme upload fails
        }
      }
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

      // For cycle_lists mode, use the active source's type for the poster
      // For other modes, use 'multi-source' type
      let collectionType = 'multi-source';
      let activeSource = null;
      if (config.combineMode === 'cycle_lists') {
        // Get the active source
        const activeSourceIndex =
          getCollectionSyncCounter(config.id) % config.sources.length;
        activeSource = config.sources[activeSourceIndex];
        if (activeSource) {
          collectionType = activeSource.type;

          // For networks sources, extract the specific platform name from subtype
          // (e.g., "netflix_top_10" -> "netflix") for correct logo and colors
          if (
            activeSource.type === 'networks' &&
            activeSource.subtype &&
            activeSource.subtype.endsWith('_top_10')
          ) {
            const platformName = activeSource.subtype
              .replace(/_top_10$/, '') // Remove "_top_10" suffix
              .replace(/_/g, '-'); // Convert underscores to hyphens for logo compatibility
            collectionType = platformName;

            logger.debug(
              `Using platform-specific type for Networks source in cycle_lists mode`,
              {
                label: 'Multi-Source Orchestrator',
                configId: config.id,
                originalType: activeSource.type,
                subtype: activeSource.subtype,
                resolvedPlatform: platformName,
              }
            );
          }
        }
      }

      // Extract dynamic platform logo for network sources
      let dynamicPlatformLogo: string | undefined;
      if (
        collectionType !== 'multi-source' &&
        activeSource?.type === 'networks' &&
        items.length > 0
      ) {
        const firstItem = items[0];
        if (
          firstItem.metadata?.platformLogo &&
          typeof firstItem.metadata.platformLogo === 'object' &&
          'spriteUrl' in firstItem.metadata.platformLogo &&
          'position' in firstItem.metadata.platformLogo
        ) {
          try {
            // Extract platform name from active source subtype
            const platformName = activeSource.subtype
              ? activeSource.subtype.replace(/_top_10$/, '').replace(/_/g, '-')
              : 'unknown';

            logger.debug(
              `Extracting dynamic platform logo for cycle_lists mode`,
              {
                label: 'Multi-Source Orchestrator',
                configId: config.id,
                platform: platformName,
                spriteUrl: firstItem.metadata.platformLogo.spriteUrl,
                position: firstItem.metadata.platformLogo.position,
              }
            );

            // Use NetworksCollectionSync to extract the logo
            const networksSync = this.getSyncService(
              'networks'
            ) as NetworksCollectionSync;
            dynamicPlatformLogo =
              await networksSync.extractPlatformLogoFromSprite(
                firstItem.metadata.platformLogo.spriteUrl as string,
                firstItem.metadata.platformLogo.position as string,
                platformName
              );

            logger.info(
              `Successfully extracted dynamic platform logo for multi-source collection`,
              {
                label: 'Multi-Source Orchestrator',
                configId: config.id,
                platform: platformName,
                logoPath: dynamicPlatformLogo,
              }
            );
          } catch (logoError) {
            logger.warn(
              `Failed to extract dynamic platform logo, will use static logo`,
              {
                label: 'Multi-Source Orchestrator',
                configId: config.id,
                error:
                  logoError instanceof Error
                    ? logoError.message
                    : String(logoError),
              }
            );
          }
        }
      }

      // Convert collection items to poster items format (same logic as BaseCollectionSync)
      const posterItems: CollectionItemWithPoster[] = items
        .slice(0, 100) // Reasonable upper limit for performance
        .map((item) => ({
          title: item.title,
          type: item.type as 'movie' | 'tv',
          tmdbId: item.tmdbId,
          year: item.year,
          episodeInfo: item.episodeInfo, // Essential for episode poster generation
          metadata: item.metadata, // Contains showTmdbId for episodes
        }));

      // Generate the poster using source-specific type for cycle_lists, multi-source for others
      const posterFilename = await generatePoster(
        {
          collectionName: config.name,
          collectionType: collectionType as
            | 'overseerr'
            | 'tautulli'
            | 'trakt'
            | 'tmdb'
            | 'imdb'
            | 'letterboxd'
            | 'anilist'
            | 'myanimelist'
            | 'mdblist'
            | 'networks'
            | 'originals'
            | 'multi-source',
          mediaType,
          items: posterItems,
          autoPosterTemplate: config.autoPosterTemplate, // Use configured template or default
          ...(dynamicPlatformLogo && { dynamicLogo: dynamicPlatformLogo }), // Pass dynamic logo if available
        },
        `${
          config.combineMode === 'cycle_lists'
            ? collectionType.charAt(0).toUpperCase() + collectionType.slice(1)
            : 'Multi-Source'
        }: ${config.name}`,
        config.id
      );

      if (posterFilename) {
        // posterFilename is now a full path to temp file
        const posterTempPath = posterFilename;

        // Apply the poster to the collection
        await plexClient.updateCollectionPoster(
          collectionRatingKey,
          posterTempPath
        );

        // Clean up temp poster file after successful upload
        try {
          const fs = await import('fs');
          const pathUtil = await import('path');
          if (fs.existsSync(posterTempPath)) {
            await fs.promises.unlink(posterTempPath);
            logger.debug(
              `Deleted temp poster file after upload: ${pathUtil.basename(
                posterTempPath
              )}`,
              {
                label: 'Multi-Source Orchestrator',
                configId: config.id,
              }
            );
          }
        } catch (cleanupError) {
          logger.warn(`Failed to delete temp poster file`, {
            label: 'Multi-Source Orchestrator',
            configId: config.id,
            error:
              cleanupError instanceof Error
                ? cleanupError.message
                : String(cleanupError),
          });
        }

        logger.info(
          `Generated and applied poster for multi-source collection: ${config.name}`,
          {
            label: 'Multi-Source Orchestrator',
            configId: config.id,
            collectionRatingKey,
            collectionType,
            combineMode: config.combineMode,
            usedDynamicLogo: !!dynamicPlatformLogo,
          }
        );
      }

      // Clean up the temporary dynamic logo file if created
      if (dynamicPlatformLogo) {
        try {
          const fs = await import('fs');
          if (fs.existsSync(dynamicPlatformLogo)) {
            await fs.promises.unlink(dynamicPlatformLogo);
            logger.debug(
              `Cleaned up temporary dynamic logo file: ${dynamicPlatformLogo}`,
              {
                label: 'Multi-Source Orchestrator',
                configId: config.id,
              }
            );
          }
        } catch (cleanupError) {
          logger.warn(
            `Failed to cleanup dynamic logo file: ${dynamicPlatformLogo}`,
            {
              label: 'Multi-Source Orchestrator',
              configId: config.id,
              error:
                cleanupError instanceof Error
                  ? cleanupError.message
                  : String(cleanupError),
            }
          );
        }
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

      // Also remove from hub management to prevent stale hub entries
      const hubIdentifier = `custom.collection.${config.libraryId}.${existingCollection.ratingKey}`;

      try {
        await plexClient.deleteHubItem(config.libraryId, hubIdentifier);
        logger.debug(
          `Removed multi-source collection from hub management: ${config.name}`,
          {
            label: 'Multi-Source Orchestrator',
            configId: config.id,
            hubIdentifier,
          }
        );
      } catch (error) {
        // Log as warning - hub item may already be deleted or never existed
        logger.warn(
          `Could not remove from hub management (may already be deleted): ${config.name}`,
          {
            label: 'Multi-Source Orchestrator',
            configId: config.id,
            hubIdentifier,
            error: error instanceof Error ? error.message : 'Unknown error',
          }
        );
      }

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

  /**
   * Extract title from a source for DYNAMIC_CYCLE_TITLE
   * For preset lists, use the subtype label
   * For custom lists, fetch the title from the API
   */
  private async extractTitleFromSource(
    source: SourceDefinition
  ): Promise<string | null> {
    try {
      // For custom lists, fetch the title from the API using same logic as fetch-title endpoint
      if (source.subtype === 'custom' && source.customUrl) {
        return await this.fetchCustomListTitle(source);
      }

      // For preset lists, use the subtype label (first option in dropdown)
      return this.getPresetTitleForSource(source);
    } catch (error) {
      logger.error(`Failed to extract title from source:`, {
        label: 'Multi-Source Orchestrator',
        sourceId: source.id,
        sourceType: source.type,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Fetch custom list title using API clients directly
   * Based on the /api/v1/collections/fetch-title endpoint logic
   */
  private async fetchCustomListTitle(
    source: SourceDefinition
  ): Promise<string | null> {
    if (!source.customUrl) return null;

    try {
      switch (source.type) {
        case 'trakt': {
          const TraktAPI = (await import('@server/api/trakt')).default;
          const settings = getSettings();

          const clientId = settings.trakt.clientId || settings.trakt.apiKey;
          const redirectUri = buildTraktRedirectUri(settings);

          if (!clientId) {
            logger.warn('Trakt client ID not configured for title fetch', {
              label: 'Multi-Source Orchestrator',
            });
            return null;
          }

          const traktClient = new TraktAPI({
            clientId,
            accessToken: settings.trakt.accessToken,
            clientSecret: settings.trakt.clientSecret,
            refreshToken: settings.trakt.refreshToken,
            tokenExpiresAt: settings.trakt.tokenExpiresAt,
            redirectUri,
            onTokenRefreshed: (tokens) => persistTraktTokens(settings, tokens),
          });
          const listMetadata = await traktClient.getListMetadata(
            source.customUrl
          );
          return listMetadata.name || 'Trakt List';
        }

        case 'tmdb': {
          const TheMovieDb = (await import('@server/api/themoviedb')).default;
          const tmdbClient = new TheMovieDb();

          // Check if it's a collection URL
          const collectionMatch = source.customUrl.match(
            /themoviedb\.org\/collection\/(\d+)/
          );
          // Check if it's a list URL
          const listMatch = source.customUrl.match(
            /themoviedb\.org\/list\/(\d+)/
          );

          if (collectionMatch) {
            const collectionId = parseInt(collectionMatch[1]);
            const collection = await tmdbClient.getCollection({ collectionId });
            return collection.name;
          } else if (listMatch) {
            const listId = listMatch[1];
            const list = await tmdbClient.getList({ listId });
            return list.name;
          }
          return null;
        }

        case 'imdb': {
          // Scrape title from IMDb HTML page
          const axios = (await import('axios')).default;
          const response = await axios.get(source.customUrl, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
            timeout: 10000,
          });

          const titleMatch = response.data.match(/<title>([^<]+)<\/title>/i);
          if (titleMatch) {
            let extractedTitle = titleMatch[1].replace(' - IMDb', '').trim();
            // Decode HTML entities
            extractedTitle = extractedTitle
              .replace(/&lrm;/g, '')
              .replace(/&rlm;/g, '')
              .replace(/&bull;/g, '•')
              .replace(/&ndash;/g, '–')
              .replace(/&mdash;/g, '—')
              .replace(/&hellip;/g, '…')
              .replace(/&quot;/g, '"')
              .replace(/&#0?39;/g, "'")
              .replace(/&#x27;/g, "'")
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>');
            return extractedTitle;
          }
          return 'IMDb List';
        }

        case 'letterboxd': {
          // Scrape title from Letterboxd HTML page
          const axios = (await import('axios')).default;
          const response = await axios.get(source.customUrl, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
            timeout: 10000,
          });

          const titleMatch = response.data.match(/<title>([^<]+)<\/title>/i);
          if (titleMatch) {
            let rawTitle = titleMatch[1];
            // Decode HTML entities
            rawTitle = rawTitle
              .replace(/&lrm;/g, '')
              .replace(/&rlm;/g, '')
              .replace(/&bull;/g, '•')
              .replace(/&ndash;/g, '–')
              .replace(/&mdash;/g, '—')
              .replace(/&hellip;/g, '…')
              .replace(/&quot;/g, '"')
              .replace(/&#0?39;/g, "'")
              .replace(/&#x27;/g, "'")
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>');

            // Extract list name
            const patterns = [
              /^(.*?),\s*a\s+list\s+of\s+films?\s+by/i,
              /^(.*?)\s*•\s*Letterboxd/i,
              /^(.*?)\s*-\s*Letterboxd/i,
              /^(.*?)\s*\|\s*Letterboxd/i,
            ];

            for (const pattern of patterns) {
              const match = rawTitle.match(pattern);
              if (match && match[1]) {
                return match[1].trim();
              }
            }

            // Fallback cleanup
            return rawTitle
              .replace(/\s*•\s*Letterboxd.*$/i, '')
              .replace(/\s*-\s*Letterboxd.*$/i, '')
              .replace(/\s*\|\s*Letterboxd.*$/i, '')
              .trim();
          }
          return 'Letterboxd List';
        }

        case 'anilist': {
          // Scrape title from AniList HTML page
          const axios = (await import('axios')).default;
          const response = await axios.get(source.customUrl, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
            timeout: 10000,
          });

          const titleMatch = response.data.match(/<title>([^<]+)<\/title>/i);
          if (titleMatch) {
            let extractedTitle = titleMatch[1].trim();
            // Remove " · AniList" suffix
            extractedTitle = extractedTitle
              .replace(/\s*·\s*AniList.*$/i, '')
              .replace(/\s*-\s*AniList.*$/i, '')
              .trim();
            return extractedTitle;
          }
          return 'AniList List';
        }

        case 'mdblist': {
          const MDBListAPI = (await import('@server/api/mdblist')).default;
          const settings = getSettings();

          if (!settings.mdblist.apiKey) {
            logger.warn('MDBList API key not configured for title fetch', {
              label: 'Multi-Source Orchestrator',
            });
            return null;
          }

          const mdblistClient = new MDBListAPI(settings.mdblist.apiKey);
          const parsedUrl = mdblistClient.parseListUrl(source.customUrl);

          if (!parsedUrl) {
            return 'MDBList List';
          }

          // Try to get list title from metadata
          if (
            parsedUrl.type === 'user' &&
            parsedUrl.username &&
            parsedUrl.listName
          ) {
            try {
              // Try getting lists by username first
              const userLists = await mdblistClient.getUserListsByUsername(
                parsedUrl.username
              );

              const targetList = userLists.find(
                (list) =>
                  list.slug === parsedUrl.listName ||
                  list.name.toLowerCase().replace(/\s+/g, '-') ===
                    parsedUrl.listName
              );

              if (targetList) {
                return targetList.name;
              }
            } catch (error) {
              // Try getting own lists as fallback
              try {
                const ownLists = await mdblistClient.getUserLists();
                const targetList = ownLists.find(
                  (list) =>
                    list.slug === parsedUrl.listName ||
                    list.name.toLowerCase().replace(/\s+/g, '-') ===
                      parsedUrl.listName
                );

                if (targetList) {
                  return targetList.name;
                }
              } catch (ownListsError) {
                // Both failed, use fallback
              }
            }
          }

          return 'MDBList List';
        }

        default:
          logger.warn(
            `Custom list title fetching not supported for ${source.type}`,
            {
              label: 'Multi-Source Orchestrator',
              sourceType: source.type,
            }
          );
          return null;
      }
    } catch (error) {
      logger.error(`Failed to fetch custom list title for ${source.type}`, {
        label: 'Multi-Source Orchestrator',
        sourceType: source.type,
        customUrl: source.customUrl,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Get preset title for a source based on its type and subtype
   * This uses the same logic as the frontend dropdown labels
   */
  private getPresetTitleForSource(source: SourceDefinition): string {
    const type = source.type;
    const subtype = source.subtype;

    // Map subtypes to their human-readable titles (first option in dropdown)
    const titleMappings: Record<
      string,
      Record<string, string | ((source: SourceDefinition) => string)>
    > = {
      trakt: {
        trending: 'Trending Now',
        popular: 'Popular',
        played: 'Most Played',
        watched: 'Most Watched',
        collected: 'Most Collected',
        favorited: 'Most Favorited',
        boxoffice: 'Box Office',
        recommendations: 'Recommendations',
      },
      tmdb: {
        trending_day: 'Trending Today',
        trending_week: 'Trending This Week',
        popular: 'Popular',
        top_rated: 'Top Rated',
      },
      imdb: {
        top_250: 'Top 250',
        popular: 'Popular (Meter)',
        boxoffice: 'Box Office',
      },
      letterboxd: {
        random: 'Random Letterboxd Collection',
      },
      overseerr: {
        users: 'Individual Users Requests',
        server_owner: 'Server Owner Requests',
        global: 'All Requests',
      },
      tautulli: {
        most_popular_plays: (src) =>
          `Most Popular (by Play Count)${
            src.customDays ? ` - ${src.customDays} Days` : ''
          }`,
        most_popular_duration: (src) =>
          `Most Popular (by Watch Duration)${
            src.customDays ? ` - ${src.customDays} Days` : ''
          }`,
      },
      networks: {},
      originals: {
        netflix_originals: 'Netflix Originals',
        amazon_originals: 'Amazon Originals',
        disney_originals: 'Disney+ Originals',
        hbomax_originals: 'HBO Max Originals',
        paramount_originals: 'Paramount+ Originals',
        hulu_originals: 'Hulu Originals',
        peacock_originals: 'Peacock Originals',
        apple_originals: 'Apple TV+ Originals',
        discovery_originals: 'Discovery+ Movies',
      },
      anilist: {
        trending: 'Trending Anime',
        popular: 'Popular Anime',
        top_rated: 'Top Rated Anime',
      },
      myanimelist: {
        all: 'Top Anime Series',
        airing: 'Top Airing Anime',
        tv: 'Top Anime TV Series',
        movie: 'Top Anime Movies',
        ova: 'Top OVA Series',
        special: 'Top Anime Specials',
      },
      mdblist: {
        user_lists: 'My Personal List',
        top_lists: 'Top Lists Collection',
      },
      radarrtag: {
        tag: 'Radarr Tag Collection',
      },
      sonarrtag: {
        tag: 'Sonarr Tag Collection',
      },
      comingsoon: {
        monitored: 'Coming Soon',
        trakt_anticipated: 'Coming Soon',
      },
    };

    // Handle Networks dynamically based on platform
    if (type === 'networks' && subtype) {
      const platformName = subtype
        .split('_')[0] // Take first part before underscore
        .split('-') // Split on dashes
        .map((word) => {
          if (word.toLowerCase() === 'tv') {
            return 'TV';
          }
          return word.charAt(0).toUpperCase() + word.slice(1);
        })
        .join(' ');
      return `Popular on ${platformName}`;
    }

    const typeMapping = titleMappings[type] || {};
    const titleOrFunc = typeMapping[subtype];

    if (typeof titleOrFunc === 'function') {
      return titleOrFunc(source);
    } else if (titleOrFunc) {
      return titleOrFunc;
    }

    // Fallback: capitalize subtype
    return subtype
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Update collection config field in settings
   * Based on BaseCollectionSync.updateCollectionConfigField
   */
  private updateCollectionConfigField(
    configId: string,
    updateConfig: Partial<MultiSourceCollectionConfig>
  ): void {
    try {
      const settings = getSettings();
      const collectionConfigs = settings.plex.collectionConfigs || [];
      const configIndex = collectionConfigs.findIndex((c) => c.id === configId);

      if (configIndex !== -1) {
        collectionConfigs[configIndex] = {
          ...collectionConfigs[configIndex],
          ...updateConfig,
        };
        settings.plex.collectionConfigs = collectionConfigs;
        settings.save();

        logger.debug(
          `Updated multi-source collection config fields: ${configId}`,
          {
            label: 'Multi-Source Orchestrator',
            configId,
            updatedFields: Object.keys(updateConfig),
          }
        );
      }
    } catch (error) {
      logger.error(
        `Failed to update multi-source collection config fields for ${configId}`,
        {
          label: 'Multi-Source Orchestrator',
          configId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  /**
   * Update multi-source config with rating key
   */
  private updateMultiSourceConfigWithRatingKey(
    config: MultiSourceCollectionConfig,
    collectionRatingKey: string
  ): void {
    if (collectionRatingKey && config.id) {
      const libraryId = Array.isArray(config.libraryId)
        ? config.libraryId[0]
        : config.libraryId;
      updateConfigWithRatingKey(config.id, collectionRatingKey, libraryId);
    }
  }

  /**
   * Clear the legacy smartCollectionRatingKey field from multi-source config
   */
  private clearMultiSourceSmartCollectionRatingKey(
    config: MultiSourceCollectionConfig
  ): void {
    try {
      const settings = getSettings();
      const collectionConfigs = settings.plex.collectionConfigs || [];
      const configIndex = collectionConfigs.findIndex(
        (c: { id: string }) => c.id === config.id
      );

      if (configIndex !== -1) {
        const updatedConfig = {
          ...collectionConfigs[configIndex],
        };

        // Remove the legacy field
        delete (updatedConfig as { smartCollectionRatingKey?: string })
          .smartCollectionRatingKey;

        collectionConfigs[configIndex] = updatedConfig;
        settings.plex.collectionConfigs = collectionConfigs;
        settings.save();

        logger.debug(
          `Cleared legacy smartCollectionRatingKey from multi-source config ${config.id}`,
          {
            label: 'Multi-Source Orchestrator',
            configId: config.id,
          }
        );
      }
    } catch (error) {
      logger.error(
        `Failed to clear smartCollectionRatingKey from multi-source config ${config.id}`,
        {
          label: 'Multi-Source Orchestrator',
          configId: config.id,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }
}
