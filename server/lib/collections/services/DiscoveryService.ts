import type PlexAPI from '@server/api/plexapi';
import type { PlexLibrary } from '@server/api/plexapi';
import type { PlexCollection } from '@server/lib/collections/core/types';
import {
  categorizeDiscoveredItem,
  createHubConfigFromDiscovery,
  createPreExistingConfigFromDiscovery,
  logDiscoveryResult,
  parseHubIdentifier,
} from '@server/lib/collections/utils/HubIdentifierUtils';
import type {
  CollectionConfig,
  PlexHubConfig,
  PreExistingCollectionConfig,
} from '@server/lib/settings';
import { CollectionType, getSettings } from '@server/lib/settings';
import logger from '@server/logger';

// Type for hub configs during discovery (before isActive is set server-side)
type DiscoveredHubConfig = Omit<PlexHubConfig, 'isActive'>;

// Type for pre-existing collection configs during discovery (before isActive is set server-side)
type DiscoveredPreExistingConfig = Omit<
  PreExistingCollectionConfig,
  'isActive'
>;

interface DiscoveryResult {
  success: boolean;
  discoveredHubConfigs: DiscoveredHubConfig[];
  discoveredPreExistingConfigs: DiscoveredPreExistingConfig[];
  totalHubsFound: number;
  totalPreExistingCollectionsFound: number;
  totalActualCollections: number;
  // Validation results for existing collections
  validationResults: {
    collectionsValidated: number;
    hubsValidated: number;
    preExistingValidated: number;
    missingCollections: string[]; // IDs of missing collections
    missingHubs: string[]; // IDs of missing hubs
    missingPreExisting: string[]; // IDs of missing pre-existing
  };
}

/**
 * Service for discovering Plex hubs, libraries, and collections
 * Extracts the complex discovery logic from route handlers
 */
export class DiscoveryService {
  private running = false;
  private cancelled = false;

  public get status() {
    return {
      running: this.running,
      cancelled: this.cancelled,
    };
  }

  public cancel(): void {
    this.cancelled = true;
  }

  /**
   * Discover all available Plex hubs and convert them to hub configurations
   *
   * @param plexClient - Plex API client
   * @param updateSettings - If true, automatically adds discovered configs to settings
   * @param skipSyncCheck - If true, skips the sync lock check (used when called from within main sync)
   */
  public async discoverAllHubs(
    plexClient: PlexAPI,
    updateSettings = false,
    skipSyncCheck = false
  ): Promise<DiscoveryResult> {
    if (this.running) {
      throw new Error(
        'Discovery is already running. Please wait for the current discovery to complete.'
      );
    }

    // Check if collections sync is running to prevent race conditions
    // Skip this check if we're being called from within the main sync
    if (!skipSyncCheck) {
      const collectionsSync = await import('@server/lib/collectionsSync');
      if (collectionsSync.default.running) {
        throw new Error(
          'Collections sync is currently running. Please wait for sync to complete before starting discovery.'
        );
      }
    }

    this.running = true;
    this.cancelled = false;

    try {
      logger.info('Starting hub discovery process', {
        label: 'Hub Discovery',
        updateSettings,
      });
      const startTime = Date.now();

      const allLibraries = await plexClient.getLibraries();
      // Filter to only movie and show libraries - we don't manage music, photo, or other library types
      const libraries = allLibraries.filter(
        (library) => library.type === 'movie' || library.type === 'show'
      );

      logger.info('Libraries loaded for discovery', {
        label: 'Hub Discovery',
        totalLibraryCount: allLibraries.length,
        filteredLibraryCount: libraries.length,
        libraryNames: libraries.map((l) => `${l.title} (${l.type})`),
      });

      const discoveredHubConfigs: DiscoveredHubConfig[] = []; // Only built-in Plex hubs
      const discoveredPreExistingConfigs: DiscoveredPreExistingConfig[] = []; // Pre-existing collections
      const enhancedExistingConfigs: PreExistingCollectionConfig[] = []; // Existing configs that were enhanced with hub data

      // Get existing configs to check for duplicates
      const settings = getSettings();
      let collectionConfigs = settings.plex.collectionConfigs || [];
      const existingHubConfigs = settings.plex.hubConfigs || [];
      const existingPreExistingConfigs =
        settings.plex.preExistingCollectionConfigs || [];

      // Create sets for fast duplicate detection using proper field combinations
      const existingHubKeys = new Set(
        existingHubConfigs.map((hub) => `${hub.libraryId}:${hub.hubIdentifier}`)
      );
      const existingPreExistingKeys = new Set(
        existingPreExistingConfigs.map(
          (config) => `${config.libraryId}:${config.collectionRatingKey}`
        )
      );
      const existingCollectionKeys = new Set(
        collectionConfigs
          .map((config) =>
            config.collectionRatingKey
              ? `${config.libraryId}:${config.collectionRatingKey}`
              : null
          )
          .filter(Boolean) as string[]
      );

      // Additional set for ALL collection IDs (including unsynced) - use label-based detection
      const existingCollectionIds = new Set(
        collectionConfigs.map((config) => `${config.libraryId}:${config.id}`)
      );

      // STEP 1: Discover all Plex collections first (source of truth for accurate titles)
      const allCollections = await this.discoverAllCollectionsFirst(
        plexClient,
        libraries,
        collectionConfigs,
        discoveredPreExistingConfigs,
        existingPreExistingKeys,
        existingCollectionKeys,
        existingCollectionIds
      );

      // STEP 2: Reset promotion status for existing pre-existing collections before hub discovery
      // This ensures we detect when users manually remove collections from hub management
      await this.resetPreExistingPromotionStatus();

      // STEP 3: Discover hubs and enhance pre-existing collections with hub data
      await this.discoverHubsAndEnhance(
        plexClient,
        libraries,
        collectionConfigs,
        discoveredHubConfigs,
        discoveredPreExistingConfigs,
        existingHubKeys,
        existingPreExistingKeys,
        existingCollectionKeys,
        existingCollectionIds,
        allCollections,
        enhancedExistingConfigs
      );

      // STEP 4: Promote collections that should be visible but aren't in hub management
      await this.promoteCollectionsThatShouldBeVisible(plexClient, libraries);

      // STEP 5: Sync configs with Plex collections to fix any out-of-sync rating keys/labels
      logger.info(
        'Starting config sync process to fix out-of-sync collections',
        {
          label: 'Discovery Service',
          configsToCheck: collectionConfigs.length,
        }
      );

      const { syncConfigsWithPlexCollections } = await import(
        '@server/lib/collections/core/CollectionUtilities'
      );

      const syncResults = await syncConfigsWithPlexCollections(
        plexClient,
        collectionConfigs.map((config) => ({
          id: config.id,
          name: config.name,
          collectionRatingKey: config.collectionRatingKey,
          libraryId: config.libraryId,
          source: config.type || 'unknown', // Use type as source
        })),
        allCollections
      );

      // Apply synced rating keys to actual settings and save
      if (syncResults.syncedConfigs.length > 0) {
        // Update the actual collection configs with new rating keys
        for (const syncedConfig of syncResults.syncedConfigs) {
          const actualConfig = settings.plex.collectionConfigs?.find(
            (config) => config.id === syncedConfig.configId
          );
          if (actualConfig) {
            // Update the rating key on the mutable config object
            Object.assign(actualConfig, {
              collectionRatingKey: syncedConfig.newRatingKey,
            });
            logger.debug(
              `Updated config ${syncedConfig.configId} with new rating key`,
              {
                label: 'Discovery Service',
                configId: syncedConfig.configId,
                newRatingKey: syncedConfig.newRatingKey,
              }
            );
          }
        }

        settings.save();

        // Reload the updated collection configs from settings so validation uses correct rating keys
        collectionConfigs = settings.plex.collectionConfigs || [];

        logger.info(
          `Config sync completed - updated ${syncResults.syncedConfigs.length} configs`,
          {
            label: 'Discovery Service',
            syncedConfigs: syncResults.syncedConfigs.map((s) => s.configId),
            updatedPlexLabels: syncResults.updatedPlexLabels.length,
            errors: syncResults.errors.length,
          }
        );

        if (syncResults.errors.length > 0) {
          logger.warn('Config sync encountered some errors', {
            label: 'Discovery Service',
            errors: syncResults.errors,
          });
        }
      }

      // STEP 4: Validate existing collections for missing items
      const validationResults = await this.validateExistingCollections(
        plexClient,
        libraries,
        collectionConfigs,
        existingHubConfigs,
        existingPreExistingConfigs,
        allCollections
      );

      // STEP 4: Update settings with discovered configs if requested
      if (updateSettings) {
        // Add discovered hub configs to settings
        if (discoveredHubConfigs.length > 0) {
          const existingHubConfigs = settings.plex.hubConfigs || [];
          const newHubConfigs = [...existingHubConfigs];

          for (const discoveredHub of discoveredHubConfigs) {
            // Add isActive: true to make it a complete PlexHubConfig
            newHubConfigs.push({ ...discoveredHub, isActive: true });
          }

          settings.plex.hubConfigs = newHubConfigs;
          logger.debug(
            `Added ${discoveredHubConfigs.length} new hub configs to settings`,
            {
              label: 'Discovery Service',
            }
          );
        }

        // Add discovered pre-existing configs to settings while preserving missing flags
        if (discoveredPreExistingConfigs.length > 0) {
          const existingPreExistingConfigs =
            settings.plex.preExistingCollectionConfigs || [];

          // Create map of existing configs with their missing flags
          const existingConfigsMap = new Map(
            existingPreExistingConfigs.map((config) => [config.id, config])
          );

          const newPreExistingConfigs = [...existingPreExistingConfigs];

          for (const discoveredPreExisting of discoveredPreExistingConfigs) {
            // Preserve missing flag if config already exists
            const existingConfig = existingConfigsMap.get(
              discoveredPreExisting.id
            );
            const finalConfig = {
              ...discoveredPreExisting,
              isActive: true,
              ...(existingConfig?.missing !== undefined && {
                missing: existingConfig.missing,
              }),
            };
            newPreExistingConfigs.push(finalConfig);
          }

          settings.plex.preExistingCollectionConfigs = newPreExistingConfigs;
          logger.debug(
            `Added ${discoveredPreExistingConfigs.length} new pre-existing configs to settings`,
            {
              label: 'Discovery Service',
            }
          );
        }

        // Update existing pre-existing configs that were enhanced with hub data
        if (enhancedExistingConfigs.length > 0) {
          const currentPreExistingConfigs =
            settings.plex.preExistingCollectionConfigs || [];

          // Replace enhanced configs in the current array
          for (const enhancedConfig of enhancedExistingConfigs) {
            const existingIndex = currentPreExistingConfigs.findIndex(
              (config) =>
                config.collectionRatingKey ===
                  enhancedConfig.collectionRatingKey &&
                config.libraryId === enhancedConfig.libraryId
            );

            if (existingIndex !== -1) {
              // Preserve missing flag when updating with enhanced data
              const existingMissing =
                currentPreExistingConfigs[existingIndex].missing;
              currentPreExistingConfigs[existingIndex] = {
                ...enhancedConfig,
                ...(existingMissing !== undefined && {
                  missing: existingMissing,
                }),
              };
            }
          }

          settings.plex.preExistingCollectionConfigs =
            currentPreExistingConfigs;
          logger.debug(
            `Updated ${enhancedExistingConfigs.length} existing pre-existing configs with hub enhancement data`,
            {
              label: 'Discovery Service',
              enhancedConfigs: enhancedExistingConfigs.map((c) => ({
                name: c.name,
                ratingKey: c.collectionRatingKey,
                libraryId: c.libraryId,
                newSortOrder: c.sortOrderHome,
                isPromoted: c.isPromotedToHub,
              })),
            }
          );
        }

        // Save settings if any configs were added or updated
        if (
          discoveredHubConfigs.length > 0 ||
          discoveredPreExistingConfigs.length > 0 ||
          enhancedExistingConfigs.length > 0
        ) {
          settings.save();
          logger.info(
            `Discovery updated settings: ${discoveredHubConfigs.length} hubs, ${discoveredPreExistingConfigs.length} pre-existing collections added, ${enhancedExistingConfigs.length} existing collections updated`,
            {
              label: 'Discovery Service',
            }
          );

          // Auto-reorder libraries to fix any gaps/duplicates created by direct sort order assignments
          const { autoReorderLibrary } = await import('@server/routes/reorder');
          const librariesToReorder = new Set<string>();

          // Collect all libraries that need reordering
          discoveredHubConfigs.forEach((config) =>
            librariesToReorder.add(config.libraryId)
          );
          discoveredPreExistingConfigs.forEach((config) =>
            librariesToReorder.add(config.libraryId)
          );
          enhancedExistingConfigs.forEach((config) =>
            librariesToReorder.add(config.libraryId)
          );

          // Auto-reorder each library for both home and library contexts
          for (const libraryId of librariesToReorder) {
            try {
              await autoReorderLibrary(libraryId, 'home');
              await autoReorderLibrary(libraryId, 'library');
              logger.debug(
                `Auto-reordered library ${libraryId} after discovery`,
                {
                  label: 'Discovery Service',
                }
              );
            } catch (error) {
              logger.warn(
                `Failed to auto-reorder library ${libraryId} after discovery`,
                {
                  label: 'Discovery Service',
                  error: error instanceof Error ? error.message : String(error),
                }
              );
            }
          }
        }
      }

      logger.info('Hub discovery process completed', {
        label: 'Hub Discovery',
        totalTime: Date.now() - startTime,
        discoveredHubs: discoveredHubConfigs.length,
        discoveredPreExisting: discoveredPreExistingConfigs.length,
        totalCollections: allCollections.length,
        settingsUpdated: updateSettings,
      });

      return {
        success: true,
        discoveredHubConfigs,
        discoveredPreExistingConfigs,
        totalHubsFound: discoveredHubConfigs.length,
        totalPreExistingCollectionsFound: discoveredPreExistingConfigs.length,
        totalActualCollections: allCollections.length,
        validationResults,
      };
    } finally {
      this.running = false;
    }
  }

  /**
   * Validate existing collections against current Plex state
   * Returns validation results indicating which collections are missing
   */
  private async validateExistingCollections(
    plexClient: PlexAPI,
    libraries: PlexLibrary[],
    collectionConfigs: CollectionConfig[],
    existingHubConfigs: PlexHubConfig[],
    existingPreExistingConfigs: PreExistingCollectionConfig[],
    allCollections: PlexCollection[]
  ): Promise<{
    collectionsValidated: number;
    hubsValidated: number;
    preExistingValidated: number;
    missingCollections: string[];
    missingHubs: string[];
    missingPreExisting: string[];
  }> {
    const missingCollections: string[] = [];
    const missingHubs: string[] = [];
    const missingPreExisting: string[] = [];

    // Create sets of existing Plex items for fast lookup
    const existingCollectionRatingKeys = new Set(
      allCollections.map((c) => c.ratingKey)
    );

    // Import the utility functions
    const { findCollectionByConfigId, parseConfigIdFromLabel } = await import(
      '@server/lib/collections/core/CollectionUtilities'
    );

    // Debug: Log sample of collections with labels for troubleshooting
    const collectionsWithLabels = allCollections.filter(
      (c) => c.labels && c.labels.length > 0
    );
    if (collectionsWithLabels.length > 0) {
      logger.debug(`Sample collections with labels (first 3):`, {
        label: 'Discovery Service - Validation Debug',
        sample: collectionsWithLabels.slice(0, 3).map((c) => ({
          ratingKey: c.ratingKey,
          title: c.title,
          labels: c.labels?.map((l) => (typeof l === 'string' ? l : l.tag)),
        })),
        totalWithLabels: collectionsWithLabels.length,
        totalCollections: allCollections.length,
      });
    }

    // Track found collections for summary logging
    let foundByRatingKey = 0;
    let foundByLabel = 0;
    let foundByName = 0;

    // Validate Agregarr-created collections
    for (const config of collectionConfigs) {
      // Skip missing item check if collection is inactive AND set to be removed from Plex when inactive
      const shouldSkipMissingCheck =
        !config.isActive && config.timeRestriction?.removeFromPlexWhenInactive;

      if (!shouldSkipMissingCheck) {
        // Use enhanced matching that checks both ratingKey and label fallback
        const collectionExists = findCollectionByConfigId(
          config.id,
          config.collectionRatingKey,
          allCollections,
          config.type,
          config.subtype,
          config.name,
          config.libraryId
        );

        if (collectionExists) {
          // Count how it was found for summary - check in order of priority
          if (
            config.collectionRatingKey &&
            allCollections.some(
              (c) => c.ratingKey === config.collectionRatingKey
            )
          ) {
            foundByRatingKey++;
          } else {
            // Check if found by label matching
            const foundByLabelMatch = allCollections.some((collection) => {
              if (!collection.labels) return false;
              return collection.labels.some((label) => {
                const labelText = typeof label === 'string' ? label : label.tag;
                const parsedConfigId = parseConfigIdFromLabel(labelText);
                return parsedConfigId === config.id;
              });
            });

            if (foundByLabelMatch) {
              foundByLabel++;
            } else {
              // Must have been found by name matching
              foundByName++;
            }
          }
        }

        if (!collectionExists) {
          // Debug logging to understand what's happening
          const collectionInPlex = config.collectionRatingKey
            ? allCollections.find(
                (c) => c.ratingKey === config.collectionRatingKey
              )
            : null;

          logger.debug(`Collection matching debug for "${config.name}"`, {
            label: 'Discovery Service - Validation',
            configId: config.id,
            configRatingKey: config.collectionRatingKey,
            libraryId: config.libraryId,
            foundInPlex: !!collectionInPlex,
            plexLabels: collectionInPlex?.labels,
            totalPlexCollections: allCollections.length,
          });

          missingCollections.push(config.id);
          logger.warn(`Missing Agregarr collection detected: ${config.name}`, {
            label: 'Discovery Service - Validation',
            configId: config.id,
            ratingKey: config.collectionRatingKey,
            libraryId: config.libraryId,
          });
        }
      }
    }

    // Validate pre-existing collections
    for (const config of existingPreExistingConfigs) {
      if (!existingCollectionRatingKeys.has(config.collectionRatingKey)) {
        missingPreExisting.push(config.id);
        logger.warn(
          `Missing pre-existing collection detected: ${config.name}`,
          {
            label: 'Discovery Service - Validation',
            configId: config.id,
            ratingKey: config.collectionRatingKey,
            libraryId: config.libraryId,
          }
        );
      }
    }

    // Validate default Plex hubs
    for (const library of libraries) {
      try {
        const hubsResponse = await plexClient.getHubManagement(library.key);
        const existingHubIdentifiers = new Set(
          hubsResponse.MediaContainer.Hub.map(
            (hub: { identifier: string }) => hub.identifier
          )
        );

        // Check hubs for this library
        const libraryHubConfigs = existingHubConfigs.filter(
          (h) => h.libraryId === library.key
        );
        for (const config of libraryHubConfigs) {
          if (!existingHubIdentifiers.has(config.hubIdentifier)) {
            missingHubs.push(config.id);
            logger.warn(`Missing default hub detected: ${config.name}`, {
              label: 'Discovery Service - Validation',
              configId: config.id,
              hubIdentifier: config.hubIdentifier,
              libraryId: config.libraryId,
            });
          }
        }
      } catch (error) {
        logger.warn(`Failed to validate hubs for library ${library.title}`, {
          label: 'Discovery Service - Validation',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info(
      `Validation complete: ${
        foundByRatingKey + foundByLabel + foundByName
      } collections found (${foundByRatingKey} by ratingKey, ${foundByLabel} by label, ${foundByName} by name), ${
        missingCollections.length
      } missing collections, ${missingHubs.length} missing hubs, ${
        missingPreExisting.length
      } missing pre-existing`,
      {
        label: 'Discovery Service - Validation',
      }
    );

    // Update settings with missing flags
    const settings = getSettings();

    // Update collection configs with missing flags
    if (settings.plex.collectionConfigs) {
      settings.plex.collectionConfigs = settings.plex.collectionConfigs.map(
        (config) => ({
          ...config,
          missing: missingCollections.includes(config.id),
        })
      );
    }

    // Update hub configs with missing flags
    if (settings.plex.hubConfigs) {
      settings.plex.hubConfigs = settings.plex.hubConfigs.map((config) => ({
        ...config,
        missing: missingHubs.includes(config.id),
      }));
    }

    // Update pre-existing configs with missing flags
    if (settings.plex.preExistingCollectionConfigs) {
      settings.plex.preExistingCollectionConfigs =
        settings.plex.preExistingCollectionConfigs.map((config) => ({
          ...config,
          missing: missingPreExisting.includes(config.id),
        }));
    }

    logger.debug('Updated settings with missing flags', {
      label: 'Discovery Service - Validation',
      missingCollections: missingCollections.length,
      missingHubs: missingHubs.length,
      missingPreExisting: missingPreExisting.length,
    });

    return {
      collectionsValidated: collectionConfigs.length,
      hubsValidated: existingHubConfigs.length,
      preExistingValidated: existingPreExistingConfigs.length,
      missingCollections,
      missingHubs,
      missingPreExisting,
    };
  }

  /**
   * Discover hubs and enhance pre-existing collections with hub data (sort order, promotion settings)
   */
  private async discoverHubsAndEnhance(
    plexClient: PlexAPI,
    libraries: PlexLibrary[],
    collectionConfigs: CollectionConfig[],
    discoveredHubConfigs: DiscoveredHubConfig[],
    discoveredPreExistingConfigs: DiscoveredPreExistingConfig[],
    existingHubKeys: Set<string>,
    existingPreExistingKeys: Set<string>,
    existingCollectionKeys: Set<string>,
    existingCollectionIds: Set<string>,
    allCollections: PlexCollection[],
    enhancedExistingConfigs: PreExistingCollectionConfig[]
  ): Promise<void> {
    // Counters for summary logging
    let skippedAgregarrCollections = 0;
    let processedHubs = 0;
    let processedPreExisting = 0;

    for (const library of libraries) {
      logger.debug('Discovering hubs for library', {
        label: 'Hub Discovery',
        libraryName: library.title,
        libraryId: library.key,
        libraryType: library.type,
      });

      try {
        const hubsResponse = await plexClient.getHubManagement(library.key);
        const hubs = hubsResponse.MediaContainer.Hub;

        logger.debug('Hubs fetched for library', {
          label: 'Hub Discovery',
          libraryName: library.title,
          hubCount: hubs?.length || 0,
        });

        for (const [index, hub] of hubs.entries()) {
          const typedHub: {
            identifier: string;
            title: string;
            promotedToSharedHome?: boolean;
            promotedToOwnHome?: boolean;
            promotedToRecommended?: boolean;
          } = hub;
          // Parse hub identifier using centralized utility
          const parsedHub = parseHubIdentifier(
            typedHub.identifier,
            library.key
          );

          // Find collection labels for enhanced matching
          const collectionWithLabels = parsedHub.ratingKey
            ? allCollections.find((c) => c.ratingKey === parsedHub.ratingKey)
            : undefined;

          // Categorize the hub using centralized logic
          const categorization = categorizeDiscoveredItem(
            parsedHub,
            collectionConfigs,
            library.key,
            collectionWithLabels?.labels
          );

          // Calculate correct sortOrderHome based on neighbors in Plex hub list
          let calculatedHomeSortOrder = index; // Default fallback

          // Helper function to find sortOrderHome for a hub identifier
          const findSortOrderForHub = (
            hubIdentifier: string
          ): number | null => {
            const parsed = parseHubIdentifier(hubIdentifier, library.key);

            // Check all config types for this library
            const settings = getSettings();
            const allConfigs = [
              ...collectionConfigs.filter((c) =>
                Array.isArray(c.libraryId)
                  ? c.libraryId.includes(library.key)
                  : c.libraryId === library.key
              ),
              ...(settings.plex.hubConfigs || []).filter(
                (h) => h.libraryId === library.key
              ),
              ...(settings.plex.preExistingCollectionConfigs || []).filter(
                (p) => p.libraryId === library.key
              ),
            ];

            const matchingConfig = allConfigs.find((config) => {
              if ('hubIdentifier' in config && parsed.hubIdentifier) {
                return config.hubIdentifier === parsed.hubIdentifier;
              } else if ('collectionRatingKey' in config && parsed.ratingKey) {
                return config.collectionRatingKey === parsed.ratingKey;
              }
              return false;
            });

            return matchingConfig?.sortOrderHome || null;
          };

          // Find previous and next neighbors with valid sortOrderHome values
          let beforeSortOrder: number | null = null;
          let afterSortOrder: number | null = null;

          // Look backwards for previous neighbor
          for (let i = index - 1; i >= 0; i--) {
            const neighborHub = hubs[i];
            const neighborSortOrder = findSortOrderForHub(
              neighborHub.identifier
            );
            if (neighborSortOrder && neighborSortOrder > 0) {
              beforeSortOrder = neighborSortOrder;
              break;
            }
          }

          // Look forwards for next neighbor
          for (let i = index + 1; i < hubs.length; i++) {
            const neighborHub = hubs[i];
            const neighborSortOrder = findSortOrderForHub(
              neighborHub.identifier
            );
            if (neighborSortOrder && neighborSortOrder > 0) {
              afterSortOrder = neighborSortOrder;
              break;
            }
          }

          // Calculate insertion point between neighbors
          if (beforeSortOrder !== null && afterSortOrder !== null) {
            // Insert between two existing items
            calculatedHomeSortOrder = (beforeSortOrder + afterSortOrder) / 2;
          } else if (beforeSortOrder !== null) {
            // Insert after the last item
            calculatedHomeSortOrder = beforeSortOrder + 1;
          } else if (afterSortOrder !== null) {
            // Insert before the first item
            calculatedHomeSortOrder = Math.max(0.5, afterSortOrder - 0.5);
          } else {
            // No existing neighbors found, use position-based fallback
            calculatedHomeSortOrder = index + 1;
          }

          logger.debug(
            `Calculated sortOrderHome for newly promoted collection`,
            {
              label: 'Hub Discovery - Neighbor Positioning',
              hubTitle: typedHub.title,
              plexPosition: index,
              beforeSortOrder,
              afterSortOrder,
              calculatedHomeSortOrder,
            }
          );

          // Create hub config using centralized function
          const hubConfig = createHubConfigFromDiscovery(
            parsedHub,
            {
              title: typedHub.title,
              promotedToSharedHome: typedHub.promotedToSharedHome,
              promotedToOwnHome: typedHub.promotedToOwnHome,
              promotedToRecommended: typedHub.promotedToRecommended,
            },
            library,
            {
              library:
                categorization.collectionType ===
                CollectionType.DEFAULT_PLEX_HUB
                  ? 0
                  : index, // Default hubs always get 0 (void) for library ordering
              home: calculatedHomeSortOrder,
            },
            categorization
          );

          // Log discovery result using centralized logging
          logDiscoveryResult(
            categorization,
            { title: typedHub.title, identifier: typedHub.identifier },
            parsedHub,
            logger,
            collectionConfigs
          );

          // Check for duplicates before adding to discovery results using proper field combinations
          const hubKey = `${hubConfig.libraryId}:${hubConfig.hubIdentifier}`;

          // Separate built-in hubs from collections based on whether they have rating keys
          if (hubConfig.collectionType === CollectionType.DEFAULT_PLEX_HUB) {
            // Built-in Plex hub (no rating key) - check against existing hub configs
            if (!existingHubKeys.has(hubKey)) {
              discoveredHubConfigs.push(hubConfig);
              processedHubs++;
            }
          } else if (parsedHub.ratingKey) {
            // This has a rating key - check if it's an Agregarr collection or pre-existing
            const matchingCollectionConfig = collectionConfigs.find(
              (config) =>
                config.collectionRatingKey === parsedHub.ratingKey &&
                config.libraryId === library.key
            );

            if (matchingCollectionConfig) {
              // This is an Agregarr-created collection that's been promoted to hub - skip it
              // (it's already managed via collectionConfigs, promotion status is calculated)
              skippedAgregarrCollections++;
            } else {
              // Check if this is an Overseerr user collection by finding it in allCollections
              const collectionWithLabels = allCollections.find(
                (c: PlexCollection) => c.ratingKey === parsedHub.ratingKey
              );

              if (
                collectionWithLabels &&
                this.isAgregarrManagedCollection(collectionWithLabels)
              ) {
                // Skip smart collections - they are managed separately and shouldn't be deleted here
                const isSmartCollection = collectionWithLabels.smart === '1';

                // Skip base collections for smart collections (they have dash prefix titles)
                const isBaseCollectionForSmart =
                  collectionWithLabels.title?.startsWith('-');

                if (isSmartCollection || isBaseCollectionForSmart) {
                  // Skip - these are part of the smart collection system
                  continue;
                }

                // This is an Agregarr-managed collection - check visibility
                const hasVisibility =
                  hub.promotedToSharedHome ||
                  hub.promotedToOwnHome ||
                  hub.promotedToRecommended;

                if (!hasVisibility) {
                  // Delete Agregarr-managed collection with no visibility
                  try {
                    logger.debug(
                      'Deleting Agregarr-managed collection with no visibility',
                      {
                        label: 'Discovery Service - Cleanup',
                        libraryId: library.key,
                        hubIdentifier: hub.identifier,
                        ratingKey: parsedHub.ratingKey,
                        title: hub.title,
                      }
                    );
                    await plexClient.deleteHubItem(library.key, hub.identifier);
                    logger.info(
                      `Deleted Agregarr-managed collection: ${hub.title}`,
                      {
                        label: 'Discovery Service - Cleanup',
                        libraryId: library.key,
                        ratingKey: parsedHub.ratingKey,
                      }
                    );
                  } catch (error) {
                    logger.warn(
                      'Failed to delete Agregarr-managed collection',
                      {
                        label: 'Discovery Service - Cleanup',
                        libraryId: library.key,
                        hubIdentifier: hub.identifier,
                        title: hub.title,
                        error:
                          error instanceof Error
                            ? error.message
                            : String(error),
                      }
                    );
                  }
                } else {
                  // Has visibility - skip from discovery but leave in Plex
                  logger.debug(
                    `Skipping visible Agregarr-managed collection from hub discovery: ${hubConfig.name}`,
                    {
                      label: 'Discovery Service',
                      ratingKey: parsedHub.ratingKey,
                      libraryId: library.key,
                      labels: collectionWithLabels.labels,
                    }
                  );
                }
              } else {
                // This is a pre-existing collection - enhance existing entry or add new one
                const preExistingKey = `${hubConfig.libraryId}:${parsedHub.ratingKey}`;
                const collectionKey = `${hubConfig.libraryId}:${parsedHub.ratingKey}`;

                // Check if we already discovered this collection in step 1
                const existingPreExisting = discoveredPreExistingConfigs.find(
                  (config) =>
                    config.collectionRatingKey === parsedHub.ratingKey &&
                    config.libraryId === library.key
                );

                if (existingPreExisting) {
                  // Enhance existing collection with hub promotion data
                  // Note: DO NOT overwrite sortOrderLibrary - collections have separate library ordering from hub ordering
                  // PRESERVE user's manual sortOrderHome positioning - only set if not already configured
                  if (
                    existingPreExisting.sortOrderHome === 0 ||
                    existingPreExisting.sortOrderHome === undefined
                  ) {
                    existingPreExisting.sortOrderHome = hubConfig.sortOrderHome;
                  }
                  if (hub.promotedToSharedHome !== undefined) {
                    existingPreExisting.visibilityConfig.usersHome =
                      hub.promotedToSharedHome;
                  }
                  if (hub.promotedToOwnHome !== undefined) {
                    existingPreExisting.visibilityConfig.serverOwnerHome =
                      hub.promotedToOwnHome;
                  }
                  if (hub.promotedToRecommended !== undefined) {
                    existingPreExisting.visibilityConfig.libraryRecommended =
                      hub.promotedToRecommended;
                  }
                  // Pre-existing collection found in hub management - mark as promoted
                  const wasPromoted = existingPreExisting.isPromotedToHub;
                  (
                    existingPreExisting as PreExistingCollectionConfig & {
                      isPromotedToHub: boolean;
                    }
                  ).isPromotedToHub = true;
                  // PRESERVE user's manual positioning - only set hub position if not manually configured
                  if (
                    existingPreExisting.sortOrderHome === 0 ||
                    existingPreExisting.sortOrderHome === undefined
                  ) {
                    existingPreExisting.sortOrderHome = hubConfig.sortOrderHome;
                  }

                  logger.debug(
                    `Enhanced pre-existing collection "${existingPreExisting.name}" with hub promotion data`,
                    {
                      label: 'Discovery Service',
                      wasPromoted,
                      nowPromoted: true,
                      statusChanged: wasPromoted === false,
                      ratingKey: parsedHub.ratingKey,
                      libraryId: library.key,
                    }
                  );
                } else {
                  // Check if this is an existing pre-existing config in settings that needs updating
                  const settings = getSettings();
                  const existingConfigFromSettings =
                    settings.plex.preExistingCollectionConfigs?.find(
                      (config) =>
                        config.collectionRatingKey === parsedHub.ratingKey &&
                        config.libraryId === library.key
                    );

                  if (existingConfigFromSettings) {
                    // Create a copy and enhance with hub promotion data
                    const enhancedConfig: PreExistingCollectionConfig = {
                      ...existingConfigFromSettings,
                      // PRESERVE user's manual sortOrderHome positioning - only set if not already configured
                      sortOrderHome:
                        existingConfigFromSettings.sortOrderHome === 0 ||
                        existingConfigFromSettings.sortOrderHome === undefined
                          ? hubConfig.sortOrderHome
                          : existingConfigFromSettings.sortOrderHome,
                      visibilityConfig: {
                        ...existingConfigFromSettings.visibilityConfig,
                        ...(hub.promotedToSharedHome !== undefined && {
                          usersHome: hub.promotedToSharedHome,
                        }),
                        ...(hub.promotedToOwnHome !== undefined && {
                          serverOwnerHome: hub.promotedToOwnHome,
                        }),
                        ...(hub.promotedToRecommended !== undefined && {
                          libraryRecommended: hub.promotedToRecommended,
                        }),
                      },
                      isPromotedToHub: true,
                    };

                    // Track this enhanced config
                    enhancedExistingConfigs.push(enhancedConfig);

                    logger.debug(
                      `Enhanced existing pre-existing collection "${enhancedConfig.name}" with hub promotion data`,
                      {
                        label: 'Discovery Service',
                        wasPromoted: (
                          existingConfigFromSettings as PreExistingCollectionConfig & {
                            isPromotedToHub?: boolean;
                          }
                        ).isPromotedToHub,
                        nowPromoted: true,
                        statusChanged: !(
                          existingConfigFromSettings as PreExistingCollectionConfig & {
                            isPromotedToHub?: boolean;
                          }
                        ).isPromotedToHub,
                        ratingKey: parsedHub.ratingKey,
                        libraryId: library.key,
                        newSortOrder: hubConfig.sortOrderHome,
                        oldSortOrder: existingConfigFromSettings.sortOrderHome,
                      }
                    );
                  }
                }

                // Check if this collection has a label indicating it belongs to an existing Agregarr collection
                const hasMatchingCollectionId = collectionWithLabels
                  ? this.checkCollectionForExistingId(
                      collectionWithLabels,
                      library.key,
                      existingCollectionIds
                    )
                  : false;

                if (
                  !existingPreExisting &&
                  !existingPreExistingKeys.has(preExistingKey) &&
                  !existingCollectionKeys.has(collectionKey) &&
                  !hasMatchingCollectionId
                ) {
                  // Check if we already enhanced this config from settings
                  const alreadyEnhanced = enhancedExistingConfigs.some(
                    (config) =>
                      config.collectionRatingKey === parsedHub.ratingKey &&
                      config.libraryId === library.key
                  );

                  if (!alreadyEnhanced) {
                    // This collection wasn't found in step 1 (maybe only exists as promoted hub) - create proper pre-existing config
                    const preExistingConfig =
                      createPreExistingConfigFromDiscovery(
                        parsedHub.ratingKey,
                        {
                          title: hub.title, // Use hub title as fallback
                          // No titleSort available from hub API
                          promotedToSharedHome: hub.promotedToSharedHome,
                          promotedToOwnHome: hub.promotedToOwnHome,
                          promotedToRecommended: hub.promotedToRecommended,
                        },
                        library,
                        {
                          library: hubConfig.sortOrderLibrary,
                          home: hubConfig.sortOrderHome,
                        }
                      );
                    // Pre-existing collection discovered in hub management - set initial promotion status
                    (
                      preExistingConfig as PreExistingCollectionConfig & {
                        isPromotedToHub: boolean;
                      }
                    ).isPromotedToHub = true;
                    discoveredPreExistingConfigs.push(preExistingConfig);
                    processedPreExisting++;
                  }
                }
              }
            }
          }
        }
      } catch (error) {
        logger.warn(`Failed to discover hubs for library ${library.title}`, {
          label: 'Discovery Service',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Summary logging for hub discovery operations
    if (
      skippedAgregarrCollections > 0 ||
      processedHubs > 0 ||
      processedPreExisting > 0
    ) {
      logger.info('Hub discovery completed', {
        label: 'Hub Discovery',
        summary: `Processed ${processedHubs} hubs, ${processedPreExisting} pre-existing collections, skipped ${skippedAgregarrCollections} Agregarr collections`,
        processedHubs,
        processedPreExisting,
        skippedAgregarrCollections,
      });
    }
  }

  /**
   * Reset promotion status for all existing pre-existing collections
   * This ensures we can detect when users manually remove collections from hub management
   */
  private async resetPreExistingPromotionStatus(): Promise<void> {
    const settings = getSettings();
    const preExistingConfigs = settings.plex.preExistingCollectionConfigs || [];

    let resetCount = 0;

    // Reset all existing pre-existing collections to isPromotedToHub: false
    // They will be set back to true during hub discovery if they're still in hub management
    // PRESERVE user configurations (sortOrderHome and visibility settings) to maintain manual reordering
    settings.plex.preExistingCollectionConfigs = preExistingConfigs.map(
      (config) => {
        if (config.isPromotedToHub === true) {
          resetCount++;
          return {
            ...config,
            isPromotedToHub: false, // Reset only this flag for external change detection
            // PRESERVE user configurations:
            // - sortOrderHome: preserve manual positioning
            // - visibilityConfig: preserve user visibility settings
          };
        }
        return config;
      }
    );

    // Save settings if any changes were made
    if (resetCount > 0) {
      settings.save();
      logger.debug(
        `Reset promotion status for ${resetCount} pre-existing collections before hub discovery`,
        {
          label: 'Discovery Service',
          resetCount,
        }
      );

      // Auto-reorder libraries to fix gaps created by resetting sortOrderHome to 0
      const { autoReorderLibrary } = await import('@server/routes/reorder');
      const librariesToReorder = new Set<string>();

      // Collect all libraries that had collections reset
      preExistingConfigs.forEach((config) => {
        if (config.isPromotedToHub === true) {
          librariesToReorder.add(config.libraryId);
        }
      });

      // Auto-reorder each library for home context (where sortOrderHome was reset)
      for (const libraryId of librariesToReorder) {
        try {
          await autoReorderLibrary(libraryId, 'home');
          logger.debug(
            `Auto-reordered library ${libraryId} after promotion reset`,
            {
              label: 'Discovery Service',
            }
          );
        } catch (error) {
          logger.warn(
            `Failed to auto-reorder library ${libraryId} after promotion reset`,
            {
              label: 'Discovery Service',
              error: error instanceof Error ? error.message : String(error),
            }
          );
        }
      }
    }
  }

  /**
   * Discover all Plex collections first (source of truth for titles)
   */
  private async discoverAllCollectionsFirst(
    plexClient: PlexAPI,
    libraries: PlexLibrary[],
    collectionConfigs: CollectionConfig[],
    discoveredPreExistingConfigs: DiscoveredPreExistingConfig[],
    existingPreExistingKeys: Set<string>,
    existingCollectionKeys: Set<string>,
    existingCollectionIds: Set<string>
  ): Promise<PlexCollection[]> {
    let allCollections: PlexCollection[] = [];
    const posterDiscoveryStats = {
      successful: 0,
      failed: 0,
      agregarrSkipped: 0,
      managedSkipped: 0,
    };

    try {
      allCollections = await plexClient.getAllCollections();

      // Add ALL collections - this is the source of truth for accurate titles
      for (const collection of allCollections) {
        const libraryId = String(collection.libraryKey);
        const library = libraries.find((lib) => lib.key === libraryId);

        if (!library) continue;

        // Discover and store poster for this collection
        const posterResult = await this.discoverCollectionPoster(
          plexClient,
          collection,
          libraryId,
          library.title
        );

        // Track detailed poster discovery statistics
        if (posterResult.success) {
          posterDiscoveryStats.successful++;
        } else {
          posterDiscoveryStats.failed++;
        }

        // Check if this is an Agregarr collection or pre-existing
        const matchingCollectionConfig = collectionConfigs.find(
          (config) =>
            config.collectionRatingKey === collection.ratingKey &&
            config.libraryId === libraryId
        );

        if (matchingCollectionConfig) {
          // This is an Agregarr-created collection - skip it (already managed)
          posterDiscoveryStats.agregarrSkipped++;
        } else if (this.isAgregarrManagedCollection(collection)) {
          // This is any Agregarr-managed collection - skip it (should not be imported as pre-existing)
          posterDiscoveryStats.managedSkipped++;
        } else {
          // Check if this is an existing pre-existing collection that needs title update
          const settings = getSettings();
          const existingPreExisting =
            settings.plex.preExistingCollectionConfigs?.find(
              (config) =>
                config.collectionRatingKey === collection.ratingKey &&
                config.libraryId === libraryId
            );

          if (
            existingPreExisting &&
            existingPreExisting.name !== collection.title
          ) {
            // Update existing pre-existing collection title
            const oldTitle = existingPreExisting.name;
            existingPreExisting.name = collection.title;
            settings.save();

            logger.info(
              `Updated pre-existing collection title: "${oldTitle}" -> "${collection.title}"`,
              {
                label: 'Discovery Service',
                configId: existingPreExisting.id,
                ratingKey: collection.ratingKey,
                libraryId,
                oldTitle,
                newTitle: collection.title,
              }
            );
          }

          // This is a pre-existing collection (not created by Agregarr)
          const collectionConfig = createPreExistingConfigFromDiscovery(
            collection.ratingKey,
            {
              title: collection.title, // Use accurate collection title from collections API
              titleSort:
                typeof collection.titleSort === 'string'
                  ? collection.titleSort
                  : undefined, // Pass titleSort for proper library ordering
              // Collections discovered from collections API start with no visibility promotion
              promotedToSharedHome: false,
              promotedToOwnHome: false,
              promotedToRecommended: false,
            },
            library,
            {
              library: discoveredPreExistingConfigs.filter(
                (c) => c.libraryId === libraryId
              ).length,
              home: discoveredPreExistingConfigs.length,
            }
          );

          // Pre-existing collection discovered in collections API only - set initial promotion status
          (
            collectionConfig as PreExistingCollectionConfig & {
              isPromotedToHub: boolean;
            }
          ).isPromotedToHub = false;

          // Check for duplicates before adding to discovery results
          const preExistingKey = `${collectionConfig.libraryId}:${collectionConfig.collectionRatingKey}`;
          const collectionKey = `${collectionConfig.libraryId}:${collectionConfig.collectionRatingKey}`;

          // Check if this collection has a label indicating it belongs to an existing Agregarr collection
          const hasMatchingCollectionId = this.checkCollectionForExistingId(
            collection,
            libraryId,
            existingCollectionIds
          );

          // Don't add if it exists as pre-existing config OR as collection config OR matches existing Agregarr collection ID
          if (
            !existingPreExistingKeys.has(preExistingKey) &&
            !existingCollectionKeys.has(collectionKey) &&
            !hasMatchingCollectionId
          ) {
            // Pre-existing collections keep their actual Plex visibility settings
            discoveredPreExistingConfigs.push(collectionConfig);
          }
        }
      }

      // Log comprehensive poster discovery statistics
      const totalProcessed =
        posterDiscoveryStats.successful + posterDiscoveryStats.failed;
      const totalSkipped =
        posterDiscoveryStats.agregarrSkipped +
        posterDiscoveryStats.managedSkipped;

      if (totalProcessed > 0 || totalSkipped > 0) {
        logger.info(
          `Poster discovery completed: ${posterDiscoveryStats.successful} stored, ${posterDiscoveryStats.failed} failed, ${totalSkipped} skipped (${posterDiscoveryStats.agregarrSkipped} Agregarr, ${posterDiscoveryStats.managedSkipped} managed)`,
          {
            label: 'Poster Discovery',
            successful: posterDiscoveryStats.successful,
            failed: posterDiscoveryStats.failed,
            agregarrSkipped: posterDiscoveryStats.agregarrSkipped,
            managedSkipped: posterDiscoveryStats.managedSkipped,
            totalProcessed,
            totalSkipped,
          }
        );
      }
    } catch (error) {
      logger.warn('Failed to discover Plex collections', {
        label: 'Discovery Service',
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return allCollections;
  }

  /**
   * Get libraries with hubs information
   */
  public async getAllLibraryHubs(plexClient: PlexAPI) {
    return await plexClient.getAllLibraryHubs();
  }

  /**
   * Get hubs for a specific library section
   */
  public async getLibraryHubs(plexClient: PlexAPI, sectionId: string) {
    return await plexClient.getLibraryHubs(sectionId);
  }

  /**
   * Get hub management interface for a library section
   */
  public async getHubManagement(plexClient: PlexAPI, sectionId: string) {
    return await plexClient.getHubManagement(sectionId);
  }

  /**
   * Get hub management system status and capabilities
   */
  public async getSystemStatus(plexClient?: PlexAPI): Promise<{
    enabled: boolean;
    plexConnected: boolean;
    libraryCount: number;
    capabilities: {
      hubReordering: boolean;
      visibilityControl: boolean;
      builtInHubManagement: boolean;
      collectionHubManagement: boolean;
    };
  }> {
    const settings = getSettings();
    const { getAdminUser } = await import(
      '@server/lib/collections/core/CollectionUtilities'
    );
    const admin = await getAdminUser();

    const status = {
      enabled: !!(
        admin?.plexToken &&
        settings.plex.ip &&
        settings.plex.machineId
      ),
      plexConnected: false,
      libraryCount: 0,
      capabilities: {
        hubReordering: true,
        visibilityControl: true,
        builtInHubManagement: true,
        collectionHubManagement: true,
      },
    };

    if (status.enabled && plexClient) {
      try {
        const plexStatus = await plexClient.getStatus();
        status.plexConnected = !!plexStatus;

        if (status.plexConnected) {
          const libraries = await plexClient.getLibraries();
          status.libraryCount = libraries.length;
        }
      } catch (error) {
        logger.warn(
          'Failed to connect to Plex for hub management status check',
          {
            label: 'Discovery Service',
            error: error instanceof Error ? error.message : String(error),
          }
        );
      }
    }

    return status;
  }

  /**
   * Check if a collection is an Overseerr user collection that should be filtered from discovery
   * Only filters collections created by Overseerr "users" subtype (individual user collections)
   */
  private isOverseerrUserCollection(collection: PlexCollection): boolean {
    return (
      collection.labels?.some(
        (label) =>
          typeof label === 'string' &&
          label.match(/^AgregarrOverseerrUser\d+$/i)
      ) || false
    );
  }

  /**
   * Check if a collection is managed by Agregarr and should be filtered from discovery
   * This includes any collection with Agregarr labels (not just Overseerr user collections)
   */
  private isAgregarrManagedCollection(collection: PlexCollection): boolean {
    return (
      collection.labels?.some((label) => {
        const labelText =
          typeof label === 'string' ? label : (label as { tag: string }).tag;
        return labelText.toLowerCase().startsWith('agregarr');
      }) || false
    );
  }

  /**
   * Promote collections that should be visible but aren't currently in hub management
   * This is the proper place for promotion logic - during discovery, not during ordering
   */
  private async promoteCollectionsThatShouldBeVisible(
    plexClient: PlexAPI,
    libraries: PlexLibrary[]
  ): Promise<void> {
    const settings = getSettings();
    const collectionConfigs = settings.plex.collectionConfigs || [];
    const preExistingConfigs = settings.plex.preExistingCollectionConfigs || [];

    logger.info(
      'Checking for collections that need promotion to hub management',
      {
        label: 'Discovery Service - Promotion',
        collectionConfigs: collectionConfigs.length,
        preExistingConfigs: preExistingConfigs.length,
      }
    );

    for (const library of libraries) {
      try {
        // Get current hub list from Plex
        const hubListResponse = await plexClient.getHubManagement(library.key);
        const existingHubIdentifiers = new Set(
          hubListResponse.MediaContainer.Hub.map((hub) => hub.identifier)
        );

        // Check user-created collections for this library
        const libraryCollections = collectionConfigs.filter(
          (config) =>
            (Array.isArray(config.libraryId)
              ? config.libraryId.includes(library.key)
              : config.libraryId === library.key) && config.collectionRatingKey
        );

        // Check pre-existing collections for this library
        const libraryPreExisting = preExistingConfigs.filter(
          (config) =>
            config.libraryId === library.key && config.collectionRatingKey
        );

        // Process both types of collections
        const allLibraryCollections = [
          ...libraryCollections.map((c) => ({
            type: 'collection' as const,
            config: c,
          })),
          ...libraryPreExisting.map((c) => ({
            type: 'preexisting' as const,
            config: c,
          })),
        ];

        for (const { type, config } of allLibraryCollections) {
          // Use smart collection rating key if it exists (for collections with showUnwatchedOnly enabled)
          const targetRatingKey =
            (config as CollectionConfig).smartCollectionRatingKey ||
            config.collectionRatingKey;
          const hubIdentifier = `custom.collection.${library.key}.${targetRatingKey}`;

          // Skip if already in hub management
          if (existingHubIdentifiers.has(hubIdentifier)) {
            continue;
          }

          // Check if this collection should be promoted based on visibility settings
          const shouldPromote = this.shouldCollectionBePromoted(config);

          if (shouldPromote) {
            logger.info(
              `Collection should be visible but not in hub management - promoting: ${config.name}`,
              {
                label: 'Discovery Service - Promotion',
                configId: config.id,
                libraryId: library.key,
                collectionRatingKey: config.collectionRatingKey,
                smartCollectionRatingKey: (config as CollectionConfig)
                  .smartCollectionRatingKey,
                targetRatingKey,
                type,
              }
            );

            try {
              // Promote collection to hub management (use target rating key - smart if exists, otherwise base)
              if (targetRatingKey) {
                await plexClient.promoteCollectionToHub(
                  targetRatingKey,
                  library.key
                );
              }

              // Set visibility settings
              const visibilityConfig =
                this.getCollectionVisibilityConfig(config);
              if (visibilityConfig) {
                await plexClient.updateHubVisibility(
                  library.key,
                  hubIdentifier,
                  visibilityConfig
                );
              }

              logger.debug(`Successfully promoted collection: ${config.name}`, {
                label: 'Discovery Service - Promotion',
                configId: config.id,
                hubIdentifier,
              });
            } catch (error) {
              logger.error(`Failed to promote collection: ${config.name}`, {
                label: 'Discovery Service - Promotion',
                configId: config.id,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }
      } catch (error) {
        logger.error(
          `Failed to check promotions for library ${library.title}`,
          {
            label: 'Discovery Service - Promotion',
            libraryId: library.key,
            error: error instanceof Error ? error.message : String(error),
          }
        );
      }
    }
  }

  /**
   * Check if a collection should be promoted to hub management based on its full configuration
   * This includes checking active status, time restrictions, and removeFromPlexWhenInactive
   */
  private shouldCollectionBePromoted(
    config: CollectionConfig | PreExistingCollectionConfig
  ): boolean {
    // Use the same comprehensive logic as HubSyncService
    if (config.isActive) {
      // Active collections: base on current visibility settings
      return !!(
        config.visibilityConfig?.usersHome ||
        config.visibilityConfig?.serverOwnerHome ||
        config.visibilityConfig?.libraryRecommended
      );
    } else {
      // Inactive collections: check time restriction settings
      const timeRestriction = config.timeRestriction;
      if (timeRestriction?.removeFromPlexWhenInactive) {
        // Remove entirely when inactive = should NOT be promoted
        return false;
      } else {
        // Use inactive visibility settings
        const inactiveConfig = timeRestriction?.inactiveVisibilityConfig;
        if (inactiveConfig) {
          return !!(
            inactiveConfig.usersHome ||
            inactiveConfig.serverOwnerHome ||
            inactiveConfig.libraryRecommended
          );
        } else {
          // Default inactive behavior: still visible in library recommended
          return true;
        }
      }
    }
  }

  /**
   * Get the visibility config for Plex hub management
   */
  private getCollectionVisibilityConfig(config: {
    visibilityConfig?: {
      usersHome?: boolean;
      serverOwnerHome?: boolean;
      libraryRecommended?: boolean;
    };
  }): {
    promotedToOwnHome: boolean;
    promotedToSharedHome: boolean;
    promotedToRecommended: boolean;
  } | null {
    if (!config.visibilityConfig) return null;

    return {
      promotedToOwnHome: config.visibilityConfig.serverOwnerHome || false,
      promotedToSharedHome: config.visibilityConfig.usersHome || false,
      promotedToRecommended:
        config.visibilityConfig.libraryRecommended || false,
    };
  }

  /**
   * Discover and store poster for a collection
   * Downloads the current poster from Plex and stores it for reuse
   * @returns object with success status and failure reason
   */
  private async discoverCollectionPoster(
    plexClient: PlexAPI,
    collection: PlexCollection,
    libraryId: string,
    libraryName: string
  ): Promise<{ success: boolean; reason?: string }> {
    try {
      // Get the current poster URL from Plex
      const posterUrl = await plexClient.getCurrentPosterUrl(
        collection.ratingKey
      );

      if (!posterUrl) {
        return { success: false, reason: 'no-poster' };
      }

      // Download and save the poster
      const { downloadAndSavePoster } = await import(
        '@server/lib/posterStorage'
      );
      const filename = await downloadAndSavePoster(
        posterUrl,
        `${collection.title} (${libraryName})`
      );

      if (filename) {
        // Link this poster to collection configs that match this collection
        await this.linkPosterToConfigs(collection, libraryId, filename);
        return { success: true };
      } else {
        // Since downloadAndSavePoster returns null, we can't determine specific reason here
        // The detailed error logging happens inside posterStorage.ts
        return { success: false, reason: 'download-failed' };
      }
    } catch (error) {
      return { success: false, reason: 'error' };
    }
  }

  /**
   * Link discovered poster to matching collection configs
   * Sets the discovered poster as the customPoster for Agregarr collections and pre-existing collections
   * that don't already have a poster configured. Default hubs are excluded as they can't have custom posters.
   */
  private async linkPosterToConfigs(
    collection: PlexCollection,
    libraryId: string,
    posterFilename: string
  ): Promise<void> {
    try {
      const settings = getSettings();
      let updated = false;

      // Check user-created Agregarr collection configs
      const collectionConfigs = settings.plex.collectionConfigs || [];
      for (const config of collectionConfigs) {
        // Use robust matching: rating key + library OR label matching
        const ratingKeyMatches =
          config.collectionRatingKey === collection.ratingKey;
        const libraryMatches = config.libraryId === libraryId;

        let configMatches = false;

        // Method 1: Rating key match (if both exist and library matches)
        if (ratingKeyMatches && libraryMatches && config.collectionRatingKey) {
          configMatches = true;
          logger.debug(`Poster config match by rating key: ${config.name}`, {
            label: 'Poster Discovery',
            configId: config.id,
            ratingKey: config.collectionRatingKey,
          });
        }

        // Method 2: Label-based matching (fallback for corrupted rating keys)
        if (!configMatches && libraryMatches && collection.labels) {
          const { parseConfigIdFromLabel } = await import(
            '@server/lib/collections/core/CollectionUtilities'
          );

          const hasMatchingLabel = collection.labels.some((label) => {
            const labelText = typeof label === 'string' ? label : label.tag;
            const parsedConfigId = parseConfigIdFromLabel(labelText);
            return parsedConfigId === config.id;
          });

          if (hasMatchingLabel) {
            configMatches = true;
            logger.debug(`Poster config match by label: ${config.name}`, {
              label: 'Poster Discovery',
              configId: config.id,
              collectionRatingKey: collection.ratingKey,
            });
          }
        }

        if (
          configMatches &&
          !config.customPoster // Only set if no poster is already configured
        ) {
          // Type-safe modification of collection config
          const mutableConfig = config as CollectionConfig & {
            customPoster?: string;
          };
          mutableConfig.customPoster = posterFilename;
          updated = true;
          logger.info(
            `Linked discovered poster to Agregarr collection config: ${config.name}`,
            {
              label: 'Poster Discovery',
              configId: config.id,
              posterFilename,
            }
          );
        }
      }

      // Check pre-existing collection configs (non-Agregarr collections)
      const preExistingConfigs =
        settings.plex.preExistingCollectionConfigs || [];
      for (const config of preExistingConfigs) {
        // Use robust matching: rating key + library OR label matching
        const ratingKeyMatches =
          config.collectionRatingKey === collection.ratingKey;
        const libraryMatches = config.libraryId === libraryId;

        let configMatches = false;

        // Method 1: Rating key match (if both exist and library matches)
        if (ratingKeyMatches && libraryMatches && config.collectionRatingKey) {
          configMatches = true;
          logger.debug(
            `Poster config match by rating key (pre-existing): ${config.name}`,
            {
              label: 'Poster Discovery',
              configId: config.id,
              ratingKey: config.collectionRatingKey,
            }
          );
        }

        // Method 2: Label-based matching (fallback for corrupted rating keys)
        if (!configMatches && libraryMatches && collection.labels) {
          const { parseConfigIdFromLabel } = await import(
            '@server/lib/collections/core/CollectionUtilities'
          );

          const hasMatchingLabel = collection.labels.some((label) => {
            const labelText = typeof label === 'string' ? label : label.tag;
            const parsedConfigId = parseConfigIdFromLabel(labelText);
            return parsedConfigId === config.id;
          });

          if (hasMatchingLabel) {
            configMatches = true;
            logger.debug(
              `Poster config match by label (pre-existing): ${config.name}`,
              {
                label: 'Poster Discovery',
                configId: config.id,
                collectionRatingKey: collection.ratingKey,
              }
            );
          }
        }

        if (
          configMatches &&
          !config.customPoster // Only set if no poster is already configured
        ) {
          // Type-safe modification of pre-existing config
          const mutableConfig = config as PreExistingCollectionConfig & {
            customPoster?: string;
          };
          mutableConfig.customPoster = posterFilename;
          updated = true;
          logger.info(
            `Linked discovered poster to pre-existing collection config: ${config.name}`,
            {
              label: 'Poster Discovery',
              configId: config.id,
              posterFilename,
            }
          );
        }
      }

      // Save settings if any configs were updated
      if (updated) {
        settings.save();
        logger.debug(
          `Saved settings with linked poster for collection: ${collection.title}`,
          {
            label: 'Poster Discovery',
            ratingKey: collection.ratingKey,
            posterFilename,
          }
        );
      }
    } catch (error) {
      logger.error(
        `Error linking poster to configs for collection: ${collection.title}`,
        {
          label: 'Poster Discovery',
          ratingKey: collection.ratingKey,
          posterFilename,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  /**
   * Check if a Plex collection has a label indicating it belongs to an existing Agregarr collection
   * This prevents duplicate detection gaps for unsynced collections
   */
  private checkCollectionForExistingId(
    collection: PlexCollection,
    libraryId: string,
    existingCollectionIds: Set<string>
  ): boolean {
    if (!collection.labels || collection.labels.length === 0) {
      return false;
    }

    // Parse collection IDs from labels
    for (const label of collection.labels) {
      const labelText = typeof label === 'string' ? label : label.tag;

      // Look for Agregarr labels with config IDs
      if (labelText.toLowerCase().startsWith('agregarr')) {
        // Extract potential config ID from label
        const configIdMatch = labelText.match(/agregarr[^0-9]*(\d+)/i);
        if (configIdMatch) {
          const configId = configIdMatch[1];
          const libraryIdKey = `${libraryId}:${configId}`;

          if (existingCollectionIds.has(libraryIdKey)) {
            logger.debug('Found existing Agregarr collection via label match', {
              label: 'Discovery Service - Duplicate Detection',
              collectionName: collection.title,
              libraryId,
              configId,
              labelText,
            });
            return true;
          }
        }
      }
    }

    return false;
  }
}

// Create and export singleton instance
export const discoveryService = new DiscoveryService();
export default discoveryService;
