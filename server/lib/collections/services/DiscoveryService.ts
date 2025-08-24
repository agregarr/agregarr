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
   * This is the main discovery method that was previously 161 lines in the route handler
   */
  public async discoverAllHubs(plexClient: PlexAPI): Promise<DiscoveryResult> {
    const libraries = await plexClient.getLibraries();
    const discoveredHubConfigs: DiscoveredHubConfig[] = []; // Only built-in Plex hubs
    const discoveredPreExistingConfigs: DiscoveredPreExistingConfig[] = []; // Pre-existing collections

    // Get existing configs to check for duplicates
    const settings = getSettings();
    const collectionConfigs = settings.plex.collectionConfigs || [];
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

    // STEP 2: Discover hubs and enhance pre-existing collections with hub data
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

    // STEP 3: Validate existing collections for missing items
    const validationResults = await this.validateExistingCollections(
      plexClient,
      libraries,
      collectionConfigs,
      existingHubConfigs,
      existingPreExistingConfigs,
      allCollections
    );

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

    // Validate Agregarr-created collections
    for (const config of collectionConfigs) {
      if (
        config.collectionRatingKey &&
        !existingCollectionRatingKeys.has(config.collectionRatingKey)
      ) {
        missingCollections.push(config.id);
        logger.warn(`Missing Agregarr collection detected: ${config.name}`, {
          label: 'Discovery Service - Validation',
          configId: config.id,
          ratingKey: config.collectionRatingKey,
          libraryId: config.libraryId,
        });
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
      try {
        const hubsResponse = await plexClient.getHubManagement(library.key);
        const hubs = hubsResponse.MediaContainer.Hub;

        hubs.forEach(
          (
            hub: {
              identifier: string;
              title: string;
              promotedToSharedHome?: boolean;
              promotedToOwnHome?: boolean;
              promotedToRecommended?: boolean;
            },
            index: number
          ) => {
            // Parse hub identifier using centralized utility
            const parsedHub = parseHubIdentifier(hub.identifier, library.key);

            // Categorize the hub using centralized logic
            const categorization = categorizeDiscoveredItem(
              parsedHub,
              collectionConfigs,
              library.key
            );

            // Create hub config using centralized function
            const hubConfig = createHubConfigFromDiscovery(
              parsedHub,
              {
                title: hub.title,
                promotedToSharedHome: hub.promotedToSharedHome,
                promotedToOwnHome: hub.promotedToOwnHome,
                promotedToRecommended: hub.promotedToRecommended,
              },
              library,
              {
                library: index,
                home: index,
              },
              categorization
            );

            // Log discovery result using centralized logging
            logDiscoveryResult(
              categorization,
              { title: hub.title, identifier: hub.identifier },
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
                // (it's already managed via collectionConfigs)
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
                  this.isOverseerrUserCollection(collectionWithLabels)
                ) {
                  // This is an Overseerr user collection promoted to hub - skip it
                  logger.debug(
                    `Skipping Overseerr user collection from hub discovery: ${hubConfig.name}`,
                    {
                      label: 'Discovery Service',
                      ratingKey: parsedHub.ratingKey,
                      libraryId: library.key,
                      labels: collectionWithLabels.labels,
                    }
                  );
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
                    logger.debug(
                      `Enhanced pre-existing collection "${existingPreExisting.name}" with hub promotion data`,
                      {
                        label: 'Discovery Service',
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
                    discoveredPreExistingConfigs.push(preExistingConfig);
                  }
                }
              }
            }
          }
        );
      } catch (error) {
        logger.warn(`Failed to discover hubs for library ${library.title}`, {
          label: 'Discovery Service',
          error: error instanceof Error ? error.message : String(error),
        });
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
        } else if (this.isOverseerrUserCollection(collection)) {
          // This is an Overseerr user collection - skip it (should not be imported as pre-existing)
          logger.debug(
            `Skipping Overseerr user collection from collections discovery: ${collection.title}`,
            {
              label: 'Discovery Service',
              ratingKey: collection.ratingKey,
              libraryId,
              labels: collection.labels,
            }
          );
        } else {
          // This is a pre-existing collection (not created by Agregarr)
          const collectionConfig = createPreExistingConfigFromDiscovery(
            collection.ratingKey,
            {
              title: collection.title, // Use accurate collection title from collections API
              titleSort:
                typeof collection.titleSort === 'string'
                  ? collection.titleSort
                  : undefined, // Pass titleSort for proper library ordering
              // Promotion settings will be enhanced from hub discovery
            },
            library,
            {
              library: discoveredPreExistingConfigs.filter(
                (c) => c.libraryId === libraryId
              ).length,
              home: discoveredPreExistingConfigs.length,
            }
          );

          // Check for duplicates before adding to discovery results
          const preExistingKey = `${collectionConfig.libraryId}:${collection.ratingKey}`;
          const collectionKey = `${collectionConfig.libraryId}:${collection.ratingKey}`;

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
}

// Create and export singleton instance
export const discoveryService = new DiscoveryService();
export default discoveryService;
