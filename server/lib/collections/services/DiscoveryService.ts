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
  /**
   * Discover all available Plex hubs and convert them to hub configurations
   *
   * @param plexClient - Plex API client
   * @param updateSettings - If true, automatically adds discovered configs to settings
   */
  public async discoverAllHubs(
    plexClient: PlexAPI,
    updateSettings = false
  ): Promise<DiscoveryResult> {
    logger.info('Starting hub discovery process', {
      label: 'Hub Discovery',
      updateSettings,
    });
    const startTime = Date.now();

    const libraries = await plexClient.getLibraries();
    logger.info('Libraries loaded for discovery', {
      label: 'Hub Discovery',
      libraryCount: libraries.length,
      libraryNames: libraries.map((l) => `${l.title} (${l.type})`),
    });

    const discoveredHubConfigs: DiscoveredHubConfig[] = []; // Only built-in Plex hubs
    const discoveredPreExistingConfigs: DiscoveredPreExistingConfig[] = []; // Pre-existing collections

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

    // STEP 1: Discover all Plex collections first (source of truth for accurate titles)
    const allCollections = await this.discoverAllCollectionsFirst(
      plexClient,
      libraries,
      collectionConfigs,
      discoveredPreExistingConfigs,
      existingPreExistingKeys,
      existingCollectionKeys
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
      allCollections
    );

    // STEP 4: Promote collections that should be visible but aren't in hub management
    await this.promoteCollectionsThatShouldBeVisible(plexClient, libraries);

    // STEP 5: Report on collections removed from hub management
    this.reportRemovedFromHubManagement();

    // STEP 3: Sync configs with Plex collections to fix any out-of-sync rating keys/labels
    logger.info('Starting config sync process to fix out-of-sync collections', {
      label: 'Discovery Service',
      configsToCheck: collectionConfigs.length,
    });

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

      // Add discovered pre-existing configs to settings
      if (discoveredPreExistingConfigs.length > 0) {
        const existingPreExistingConfigs =
          settings.plex.preExistingCollectionConfigs || [];
        const newPreExistingConfigs = [...existingPreExistingConfigs];

        for (const discoveredPreExisting of discoveredPreExistingConfigs) {
          // Add isActive: true to make it a complete PreExistingCollectionConfig
          const finalConfig = { ...discoveredPreExisting, isActive: true };
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

      // Save settings if any configs were added
      if (
        discoveredHubConfigs.length > 0 ||
        discoveredPreExistingConfigs.length > 0
      ) {
        settings.save();
        logger.info(
          `Discovery updated settings: ${discoveredHubConfigs.length} hubs, ${discoveredPreExistingConfigs.length} pre-existing collections added`,
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

    // Import the utility function
    const { findCollectionByConfigId } = await import(
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
          config.subtype
        );

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
      `Validation complete: ${missingCollections.length} missing collections, ${missingHubs.length} missing hubs, ${missingPreExisting.length} missing pre-existing`,
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
    allCollections: PlexCollection[]
  ): Promise<void> {
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
              home: index,
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
              logger.debug(
                `Skipping Agregarr collection from hub discovery: ${hubConfig.name}`,
                {
                  label: 'Discovery Service',
                  ratingKey: parsedHub.ratingKey,
                  libraryId: library.key,
                }
              );
            } else {
              // Check if this is an Overseerr user collection by finding it in allCollections
              const collectionWithLabels = allCollections.find(
                (c: PlexCollection) => c.ratingKey === parsedHub.ratingKey
              );

              if (
                collectionWithLabels &&
                this.isAgregarrManagedCollection(collectionWithLabels)
              ) {
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
                  existingPreExisting.sortOrderHome = hubConfig.sortOrderHome;
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
                  // Pre-existing collection found in hub management - mark as promoted and restore position
                  const wasPromoted = existingPreExisting.isPromotedToHub;
                  (
                    existingPreExisting as PreExistingCollectionConfig & {
                      isPromotedToHub: boolean;
                    }
                  ).isPromotedToHub = true;
                  // Restore sortOrderHome to discovered hub position
                  existingPreExisting.sortOrderHome = hubConfig.sortOrderHome;

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
                } else if (
                  !existingPreExistingKeys.has(preExistingKey) &&
                  !existingCollectionKeys.has(collectionKey)
                ) {
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
    // Also reset sortOrderHome to 0 since they're no longer in hub management
    settings.plex.preExistingCollectionConfigs = preExistingConfigs.map(
      (config) => {
        if (config.isPromotedToHub === true) {
          resetCount++;
          return {
            ...config,
            isPromotedToHub: false,
            sortOrderHome: 0, // Reset to void since no longer in hub management
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
   * Report on pre-existing collections that were removed from hub management
   * These collections still exist in Plex but are no longer promoted to hubs
   */
  private reportRemovedFromHubManagement(): void {
    const settings = getSettings();
    const preExistingConfigs = settings.plex.preExistingCollectionConfigs || [];

    const removedFromHubs = preExistingConfigs.filter(
      (config) => config.isPromotedToHub === false
    );

    if (removedFromHubs.length > 0) {
      logger.info(
        `Detected ${removedFromHubs.length} pre-existing collections removed from hub management`,
        {
          label: 'Discovery Service',
          removedCount: removedFromHubs.length,
          removedCollections: removedFromHubs.map((config) => ({
            name: config.name,
            libraryId: config.libraryId,
            ratingKey: config.collectionRatingKey,
          })),
        }
      );

      // These collections will now be handled via DELETE instead of visibility updates
      removedFromHubs.forEach((config) => {
        logger.debug(
          `Collection "${config.name}" is no longer promoted to hub - will be removed from hub management on next sync`,
          {
            label: 'Discovery Service',
            collectionId: config.id,
            libraryId: config.libraryId,
            ratingKey: config.collectionRatingKey,
          }
        );
      });
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
    existingCollectionKeys: Set<string>
  ): Promise<PlexCollection[]> {
    let allCollections: PlexCollection[] = [];

    try {
      allCollections = await plexClient.getAllCollections();

      // Add ALL collections - this is the source of truth for accurate titles
      for (const collection of allCollections) {
        const libraryId = String(collection.libraryKey);
        const library = libraries.find((lib) => lib.key === libraryId);

        if (!library) continue;

        // Check if this is an Agregarr collection or pre-existing
        const matchingCollectionConfig = collectionConfigs.find(
          (config) =>
            config.collectionRatingKey === collection.ratingKey &&
            config.libraryId === libraryId
        );

        if (matchingCollectionConfig) {
          // This is an Agregarr-created collection - skip it (already managed)
          logger.debug(
            `Skipping Agregarr collection from collections discovery: ${collection.title}`,
            {
              label: 'Discovery Service',
              ratingKey: collection.ratingKey,
              libraryId,
            }
          );
        } else if (this.isAgregarrManagedCollection(collection)) {
          // This is any Agregarr-managed collection - skip it (should not be imported as pre-existing)
          logger.debug(
            `Skipping Agregarr-managed collection from collections discovery: ${collection.title}`,
            {
              label: 'Discovery Service',
              ratingKey: collection.ratingKey,
              libraryId,
              labels: collection.labels,
            }
          );
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

          // Don't add if it exists as pre-existing config OR as collection config
          if (
            !existingPreExistingKeys.has(preExistingKey) &&
            !existingCollectionKeys.has(collectionKey)
          ) {
            // Pre-existing collections keep their actual Plex visibility settings
            discoveredPreExistingConfigs.push(collectionConfig);
          }
        }
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
          const hubIdentifier = `custom.collection.${library.key}.${config.collectionRatingKey}`;

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
                type,
              }
            );

            try {
              // Promote collection to hub management
              if (config.collectionRatingKey) {
                await plexClient.promoteCollectionToHub(
                  config.collectionRatingKey,
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
}

// Create and export singleton instance
export const discoveryService = new DiscoveryService();
export default discoveryService;
