import type PlexAPI from '@server/api/plexapi';
import { extractErrorMessage } from '@server/lib/collections/core/CollectionUtilities';
import { TimeRestrictionUtils } from '@server/lib/collections/utils/TimeRestrictionUtils';
import type { CollectionItemWithPoster } from '@server/lib/posterGeneration';
import type {
  CollectionConfig,
  PlexHubConfig,
  PreExistingCollectionConfig,
} from '@server/lib/settings';
import { CollectionType, getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import {
  applyUnifiedOrderingToPlex,
  type OrderingItem,
} from './UnifiedOrderingService';

/**
 * Service for managing Plex hub visibility and ordering
 */
export class HubSyncService {
  private cancelled = false;

  public cancel(): void {
    this.cancelled = true;
  }

  /**
   * Sync Plex hub visibility settings to match our configuration
   */
  public async syncHubVisibility(
    plexClient: PlexAPI,
    onProgress?: (stage: string) => void
  ): Promise<void> {
    if (this.cancelled) return;

    try {
      const settings = getSettings();
      const hubConfigs = settings.plex.hubConfigs || [];
      const collectionConfigs = settings.plex.collectionConfigs || [];
      const preExistingCollectionConfigs =
        settings.plex.preExistingCollectionConfigs || [];

      // Check if we have any configs to process
      if (
        hubConfigs.length === 0 &&
        collectionConfigs.length === 0 &&
        preExistingCollectionConfigs.length === 0
      ) {
        onProgress?.('No collections to sync - skipping hub visibility');
        logger.info(
          'No hub, collection, or pre-existing collection configurations found, skipping hub sync',
          {
            label: 'Hub Sync Service',
          }
        );
        return;
      }

      // Starting hub visibility sync
      onProgress?.(`Syncing visibility for ${hubConfigs.length} hubs...`);

      // Group hub configs by library for efficient processing
      const hubConfigsByLibrary = this.groupHubConfigsByLibrary(hubConfigs);

      let processedLibraries = 0;
      const totalLibraries = hubConfigsByLibrary.size;

      // Process hub configs for each library
      for (const [libraryId, libraryHubConfigs] of hubConfigsByLibrary) {
        if (this.cancelled) return;

        try {
          processedLibraries++;
          onProgress?.(
            `Syncing library ${processedLibraries}/${totalLibraries} hubs...`
          );
          await this.syncLibraryHubs(plexClient, libraryId, libraryHubConfigs);
        } catch (error) {
          logger.error(
            `Failed to process hubs for library ${libraryId}: ${extractErrorMessage(
              error
            )}`,
            {
              label: 'Hub Sync Service',
              libraryId,
              error: extractErrorMessage(error),
            }
          );
        }
      }

      // Process collection configs that have rating keys and are not removed from Plex when inactive
      const activeCollectionConfigs = collectionConfigs.filter(
        (config) =>
          config.isActive || !config.timeRestriction?.removeFromPlexWhenInactive
      );

      if (activeCollectionConfigs.length > 0) {
        onProgress?.(
          `Syncing visibility for ${activeCollectionConfigs.length} collections...`
        );
        await this.syncLibraryCollections(plexClient, activeCollectionConfigs);
      }

      // Process pre-existing collection configs that have rating keys
      if (preExistingCollectionConfigs.length > 0) {
        onProgress?.(
          `Syncing visibility for ${preExistingCollectionConfigs.length} pre-existing collections...`
        );
        await this.syncPreExistingCollections(
          plexClient,
          preExistingCollectionConfigs
        );
      }

      // Hub visibility sync completed silently
    } catch (error) {
      logger.error(
        `Hub visibility sync failed: ${extractErrorMessage(error)}`,
        {
          label: 'Hub Sync Service',
          error: extractErrorMessage(error),
        }
      );
      // Don't throw - we don't want hub sync failures to break collection sync
    }
  }

  /**
   * Sync unified ordering for collections and hubs together with discovery and cleanup
   */
  public async syncUnifiedOrdering(
    plexClient: PlexAPI,
    onProgress?: (stage: string) => void
  ): Promise<void> {
    if (this.cancelled) return;

    try {
      logger.info('Starting unified ordering sync', {
        label: 'Hub Sync Service',
      });

      // Step 1: Discover new items and update configs (but no deletions yet)
      onProgress?.('Discovering and updating configurations...');
      const { DiscoveryService } = await import(
        '@server/lib/collections/services/DiscoveryService'
      );
      const discoveryService = new DiscoveryService();
      await discoveryService.discoverAllHubs(plexClient, true, true); // updateSettings = true, skipSyncCheck = true (called from main sync)

      // Step 2: Get refreshed configs (now including newly discovered items)
      const settings = getSettings();
      const collectionConfigs = settings.plex.collectionConfigs || [];
      const hubConfigs = settings.plex.hubConfigs || [];
      const preExistingCollectionConfigs =
        settings.plex.preExistingCollectionConfigs || [];

      // Step 3: Filter out inactive items with removeFromPlexWhenInactive (already processed by syncHubVisibility)
      const activeCollectionConfigs = collectionConfigs.filter(
        (config) =>
          config.isActive || !config.timeRestriction?.removeFromPlexWhenInactive
      );
      const activeHubConfigs = hubConfigs.filter(
        (config) =>
          config.isActive || !config.timeRestriction?.removeFromPlexWhenInactive
      );
      const activePreExistingConfigs = preExistingCollectionConfigs.filter(
        (config) =>
          config.isActive || !config.timeRestriction?.removeFromPlexWhenInactive
      );

      // Step 4: Filter out only Overseerr individual user collections with no visibility (all false)
      // Other types (default hubs, pre-existing, server_owner, global, etc.) should remain in reordering
      const visibleCollectionConfigs = activeCollectionConfigs.filter(
        (config) => {
          // Only apply visibility filtering to Overseerr individual user collections
          if (config.type === 'overseerr' && config.subtype === 'users') {
            const hasAnyVisibility =
              config.visibilityConfig?.usersHome ||
              config.visibilityConfig?.serverOwnerHome ||
              config.visibilityConfig?.libraryRecommended;
            return hasAnyVisibility;
          }
          // All other collection types pass through (including server_owner, global, etc.)
          return true;
        }
      );

      // Hubs and pre-existing collections always pass through - no visibility filtering needed
      const visibleHubConfigs = activeHubConfigs;
      const visiblePreExistingConfigs = activePreExistingConfigs;

      logger.debug('Unified ordering config counts:', {
        label: 'Hub Sync Service',
        collectionConfigs: visibleCollectionConfigs.length,
        hubConfigs: visibleHubConfigs.length,
        preExistingCollectionConfigs: visiblePreExistingConfigs.length,
      });

      // Step 4: Build unified ordering items for each library using existing methods
      onProgress?.('Building collection ordering list...');
      const orderingItemsByLibrary = new Map<string, OrderingItem[]>();

      // Add collection configs to ordering
      this.addCollectionOrderingItems(
        visibleCollectionConfigs,
        orderingItemsByLibrary
      );

      // Add hub configs to ordering
      this.addHubOrderingItems(visibleHubConfigs, orderingItemsByLibrary);

      this.addPreExistingOrderingItems(
        visiblePreExistingConfigs,
        orderingItemsByLibrary
      );

      // Step 5: Apply unified ordering to each library with cleanup
      const libraryCount = orderingItemsByLibrary.size;
      onProgress?.(`Applying ordering to ${libraryCount} libraries...`);
      await this.applyOrderingToLibraries(
        plexClient,
        orderingItemsByLibrary,
        onProgress
      );
    } catch (error) {
      logger.error(
        `Unified ordering sync failed: ${extractErrorMessage(error)}`,
        {
          label: 'Hub Sync Service',
          error: extractErrorMessage(error),
        }
      );
      // Don't throw - we don't want ordering sync failures to break collection sync
    }
  }

  /**
   * Group hub configurations by library
   */
  private groupHubConfigsByLibrary(
    hubConfigs: PlexHubConfig[]
  ): Map<string, PlexHubConfig[]> {
    const hubConfigsByLibrary = new Map<string, PlexHubConfig[]>();

    for (const hubConfig of hubConfigs) {
      if (!hubConfigsByLibrary.has(hubConfig.libraryId)) {
        hubConfigsByLibrary.set(hubConfig.libraryId, []);
      }
      const libraryHubConfigs = hubConfigsByLibrary.get(hubConfig.libraryId);
      if (libraryHubConfigs) {
        libraryHubConfigs.push(hubConfig);
      }
    }

    return hubConfigsByLibrary;
  }

  /**
   * Sync hubs for a specific library
   */
  private async syncLibraryHubs(
    plexClient: PlexAPI,
    libraryId: string,
    libraryHubConfigs: PlexHubConfig[]
  ): Promise<void> {
    // Update visibility for each hub in this library
    for (const hubConfig of libraryHubConfigs) {
      if (this.cancelled) return;

      // Skip malformed hub identifiers
      if (!this.isValidHubIdentifier(hubConfig.hubIdentifier)) {
        logger.debug(
          `Skipping visibility update for malformed hub identifier: ${hubConfig.hubIdentifier}`,
          {
            label: 'Hub Sync Service',
            hubId: hubConfig.id,
            libraryId,
          }
        );
        continue;
      }

      try {
        // Evaluate time restrictions and get effective visibility config
        const effectiveVisibilityConfig = this.evaluateAndUpdateTimeRestriction(
          hubConfig,
          'hub'
        );

        // Convert effective visibility config to Plex format
        const plexVisibility = {
          promotedToOwnHome:
            effectiveVisibilityConfig?.serverOwnerHome || false,
          promotedToSharedHome: effectiveVisibilityConfig?.usersHome || false,
          promotedToRecommended:
            effectiveVisibilityConfig?.libraryRecommended || false,
        };

        await plexClient.updateHubVisibility(
          libraryId,
          hubConfig.hubIdentifier,
          plexVisibility
        );

        // Mark hub as successfully synced
        const settings = getSettings();
        settings.markCollectionSynced(hubConfig.id, 'hub');
      } catch (error) {
        logger.error(
          `Failed to update visibility for hub ${
            hubConfig.hubIdentifier
          }: ${extractErrorMessage(error)}`,
          {
            label: 'Hub Sync Service',
            hubIdentifier: hubConfig.hubIdentifier,
            libraryId,
            error: extractErrorMessage(error),
          }
        );
      }
    }
  }

  /**
   * Convert our visibility config to Plex format
   */
  private convertToPlexVisibility(hubConfig: PlexHubConfig) {
    return {
      promotedToOwnHome: hubConfig.visibilityConfig?.serverOwnerHome || false,
      promotedToSharedHome: hubConfig.visibilityConfig?.usersHome || false,
      promotedToRecommended:
        hubConfig.visibilityConfig?.libraryRecommended || false,
    };
  }

  /**
   * Convert collection config visibility to Plex format
   */
  private convertCollectionToPlexVisibility(
    collectionConfig: CollectionConfig
  ) {
    return {
      promotedToOwnHome:
        collectionConfig.visibilityConfig?.serverOwnerHome || false,
      promotedToSharedHome:
        collectionConfig.visibilityConfig?.usersHome || false,
      promotedToRecommended:
        collectionConfig.visibilityConfig?.libraryRecommended || false,
    };
  }

  /**
   * Sync collection configs that have rating keys
   */
  private async syncLibraryCollections(
    plexClient: PlexAPI,
    collectionConfigs: CollectionConfig[]
  ): Promise<void> {
    for (const collectionConfig of collectionConfigs) {
      if (this.cancelled) return;

      // Only process collections that have rating keys (i.e., have been created in Plex)
      if (!collectionConfig.collectionRatingKey) {
        continue;
      }

      // Generate the proper custom collection hub identifier
      const collectionRatingKey = collectionConfig.collectionRatingKey;
      const hubIdentifier = `custom.collection.${collectionConfig.libraryId}.${collectionRatingKey}`;

      // Skip malformed hub identifiers
      if (!this.isValidHubIdentifier(hubIdentifier)) {
        logger.warn(
          `Skipping collection with invalid hub identifier: ${hubIdentifier}`,
          {
            label: 'Hub Sync Service',
            collectionId: collectionConfig.id,
            libraryId: collectionConfig.libraryId,
          }
        );
        continue;
      }

      try {
        // Calculate current promotion status
        const shouldBePromotedToHub =
          this.calculateIsPromotedToHub(collectionConfig);
        // For regular collections, we assume they were promoted if they have a collectionRatingKey (exist in Plex)
        const wasPromotedToHub = !!collectionConfig.collectionRatingKey;

        if (shouldBePromotedToHub) {
          // Collection should be in hub management - update visibility
          const plexVisibility =
            this.convertCollectionToPlexVisibility(collectionConfig);

          await plexClient.updateHubVisibility(
            collectionConfig.libraryId,
            hubIdentifier,
            plexVisibility
          );

          logger.debug(
            `Updated hub visibility for collection ${collectionConfig.name}`,
            {
              label: 'Hub Sync Service',
              collectionId: collectionConfig.id,
              hubIdentifier,
              plexVisibility,
            }
          );
        } else if (wasPromotedToHub) {
          // Collection was previously promoted but should NOT be in hub management anymore - delete from hubs
          await plexClient.deleteHubItem(
            collectionConfig.libraryId,
            hubIdentifier
          );

          logger.debug(
            `Deleted collection from hub management: ${collectionConfig.name}`,
            {
              label: 'Hub Sync Service',
              collectionId: collectionConfig.id,
              hubIdentifier,
              reason: 'was promoted but should no longer be promoted',
            }
          );
        } else {
          // Collection was never promoted and shouldn't be - skip deletion attempt
          logger.debug(
            `Skipping collection (never promoted to hubs): ${collectionConfig.name}`,
            {
              label: 'Hub Sync Service',
              collectionId: collectionConfig.id,
              hubIdentifier,
              wasPromotedToHub,
              shouldBePromotedToHub,
            }
          );
        }

        // Note: Collection sync status is already handled in CollectionSyncService
        // This is just visibility sync, so we don't update sync status here
      } catch (error) {
        logger.error(
          `Failed to update visibility for collection ${
            collectionConfig.name
          }: ${extractErrorMessage(error)}`,
          {
            label: 'Hub Sync Service',
            collectionId: collectionConfig.id,
            hubIdentifier,
            libraryId: collectionConfig.libraryId,
            error: extractErrorMessage(error),
          }
        );
      }
    }
  }

  /**
   * Sync pre-existing collection configs that have rating keys
   */
  private async syncPreExistingCollections(
    plexClient: PlexAPI,
    preExistingCollectionConfigs: PreExistingCollectionConfig[]
  ): Promise<void> {
    for (const preExistingConfig of preExistingCollectionConfigs) {
      if (this.cancelled) return;

      // Only process collections that have rating keys (i.e., exist in Plex)
      if (!preExistingConfig.collectionRatingKey) {
        continue;
      }

      // Generate the proper custom collection hub identifier
      const hubIdentifier = `custom.collection.${preExistingConfig.libraryId}.${preExistingConfig.collectionRatingKey}`;

      // Skip malformed hub identifiers
      if (!this.isValidHubIdentifier(hubIdentifier)) {
        logger.warn(
          `Skipping pre-existing collection with invalid hub identifier: ${hubIdentifier}`,
          {
            label: 'Hub Sync Service',
            collectionId: preExistingConfig.id,
            libraryId: preExistingConfig.libraryId,
          }
        );
        continue;
      }

      try {
        // Calculate current promotion status
        const shouldBePromotedToHub =
          this.calculateIsPromotedToHub(preExistingConfig);

        if (shouldBePromotedToHub) {
          // Collection should be in hub management - update visibility
          // Evaluate time restrictions and get effective visibility config
          const effectiveVisibilityConfig =
            this.evaluateAndUpdateTimeRestriction(
              preExistingConfig,
              'preExisting'
            );

          // Convert effective visibility config to Plex format
          const plexVisibility = {
            promotedToOwnHome:
              effectiveVisibilityConfig?.serverOwnerHome || false,
            promotedToSharedHome: effectiveVisibilityConfig?.usersHome || false,
            promotedToRecommended:
              effectiveVisibilityConfig?.libraryRecommended || false,
          };

          await plexClient.updateHubVisibility(
            preExistingConfig.libraryId,
            hubIdentifier,
            plexVisibility
          );

          logger.debug(
            `Updated hub visibility for pre-existing collection ${preExistingConfig.name}`,
            {
              label: 'Hub Sync Service',
              collectionId: preExistingConfig.id,
              hubIdentifier,
              plexVisibility,
            }
          );
        } else {
          // Pre-existing collections are NEVER deleted from hub management
          // Just hide them by setting all visibility to false
          const hideVisibility = {
            promotedToOwnHome: false,
            promotedToSharedHome: false,
            promotedToRecommended: false,
          };

          await plexClient.updateHubVisibility(
            preExistingConfig.libraryId,
            hubIdentifier,
            hideVisibility
          );

          logger.debug(
            `Hidden pre-existing collection (not deleted): ${preExistingConfig.name}`,
            {
              label: 'Hub Sync Service',
              collectionId: preExistingConfig.id,
              hubIdentifier,
              reason:
                'no visibility configured, hidden but preserved in hub management',
            }
          );
        }

        // Auto-generate poster if enabled (similar to CollectionConfig)
        // Default to false for pre-existing collections (they usually have their own posters)
        const shouldGeneratePoster = preExistingConfig.autoPoster ?? false;
        if (shouldGeneratePoster && preExistingConfig.collectionRatingKey) {
          try {
            const { generatePoster } = await import(
              '@server/lib/posterStorage'
            );

            // Use the collection name from Plex
            const collectionName = preExistingConfig.name;

            // Fetch collection items from Plex for content grid
            let posterItems: CollectionItemWithPoster[] | undefined;

            try {
              // Get template to determine how many items we need
              let maxItems = 12; // Default fallback

              if (preExistingConfig.autoPosterTemplate) {
                const { getRepository } = await import('@server/datasource');
                const { PosterTemplate } = await import(
                  '@server/entity/PosterTemplate'
                );
                const templateRepository = getRepository(PosterTemplate);

                const template = await templateRepository.findOne({
                  where: {
                    id: preExistingConfig.autoPosterTemplate,
                    isActive: true,
                  },
                });

                if (template) {
                  const templateData = template.getTemplateData();

                  // Calculate grid size from template
                  if (templateData.elements) {
                    const contentGridElements = templateData.elements.filter(
                      (el) => el.type === 'content-grid'
                    );
                    if (contentGridElements.length > 0) {
                      maxItems = contentGridElements.reduce(
                        (total, element) => {
                          const props = element.properties as {
                            columns?: number;
                            rows?: number;
                          };
                          return (
                            total + (props.columns || 2) * (props.rows || 2)
                          );
                        },
                        0
                      );
                    }
                  }
                }
              }

              // Fetch collection items from Plex for content grid
              // Works for both regular and smart collections - just returns current children
              const plexItems = await plexClient.getCollectionItemsWithMetadata(
                preExistingConfig.collectionRatingKey
              );

              logger.debug(
                `Fetched ${
                  plexItems?.length || 0
                } items from pre-existing collection: ${collectionName}`,
                {
                  label: 'Hub Sync Service',
                  collectionId: preExistingConfig.id,
                  itemCount: plexItems?.length || 0,
                }
              );

              // Convert Plex metadata to poster format
              if (plexItems && plexItems.length > 0) {
                // Helper function to extract TMDB ID from guids
                const extractTmdbId = (
                  guids?: { id: string }[]
                ): number | undefined => {
                  if (!guids || guids.length === 0) return undefined;
                  const tmdbGuid = guids.find((g) =>
                    g.id.startsWith('tmdb://')
                  );
                  if (!tmdbGuid) return undefined;
                  const idMatch = tmdbGuid.id.match(/tmdb:\/\/(\d+)/);
                  return idMatch ? parseInt(idMatch[1], 10) : undefined;
                };

                posterItems = plexItems.slice(0, maxItems).map((item) => ({
                  title: item.title || 'Unknown',
                  type: item.type === 'movie' ? 'movie' : 'tv',
                  tmdbId: extractTmdbId(item.Guid),
                  year: undefined, // PlexMetadata doesn't include year field
                  posterUrl: undefined, // Will be fetched by poster generation
                  metadata: {
                    libraryKey: preExistingConfig.libraryId,
                  },
                }));
              }
            } catch (itemsError) {
              logger.warn(
                `Failed to fetch collection items for poster generation: ${preExistingConfig.name}`,
                {
                  label: 'Hub Sync Service',
                  collectionId: preExistingConfig.id,
                  error:
                    itemsError instanceof Error
                      ? itemsError.message
                      : String(itemsError),
                }
              );
              // Continue with empty items - will generate template-only poster
            }

            // Generate poster using the template system
            const posterFilename = await generatePoster(
              {
                collectionName,
                collectionType: 'pre_existing', // Use pre_existing as the collection type
                mediaType: preExistingConfig.mediaType,
                items: posterItems,
                autoPosterTemplate: preExistingConfig.autoPosterTemplate,
              },
              `Auto-generated: ${collectionName}`,
              preExistingConfig.id
            );

            if (posterFilename) {
              // Get poster path and apply to Plex collection
              const { getPosterPath } = await import(
                '@server/lib/posterStorage'
              );
              const posterPath = getPosterPath(posterFilename);
              await plexClient.updateCollectionPoster(
                preExistingConfig.collectionRatingKey,
                posterPath
              );

              // Get the full Plex poster URL from the collection to complete the workflow
              const plexPosterUrl = await plexClient.getCurrentPosterUrl(
                preExistingConfig.collectionRatingKey
              );

              if (plexPosterUrl) {
                // Complete the workflow: re-download, store hash-only, cleanup temp file
                const { completeAutoGeneratedPosterWorkflow } = await import(
                  '@server/lib/posterStorage'
                );
                await completeAutoGeneratedPosterWorkflow(
                  posterFilename,
                  plexPosterUrl,
                  preExistingConfig.id,
                  `Auto-generated: ${collectionName}`
                );
              }

              logger.info(
                `Successfully generated and applied poster for pre-existing collection: ${collectionName}`,
                {
                  label: 'Hub Sync Service',
                  collectionId: preExistingConfig.id,
                  posterFilename,
                  plexPosterUrl,
                }
              );
            }
          } catch (error) {
            logger.error(
              `Failed to generate auto-poster for pre-existing collection ${
                preExistingConfig.name
              }: ${extractErrorMessage(error)}`,
              {
                label: 'Hub Sync Service',
                collectionId: preExistingConfig.id,
                error: extractErrorMessage(error),
              }
            );
            // Don't fail the sync if poster generation fails
          }
        }

        // Mark pre-existing collection as successfully synced
        const settings = getSettings();
        settings.markCollectionSynced(preExistingConfig.id, 'preExisting');
      } catch (error) {
        logger.error(
          `Failed to update visibility for pre-existing collection ${
            preExistingConfig.name
          }: ${extractErrorMessage(error)}`,
          {
            label: 'Hub Sync Service',
            collectionId: preExistingConfig.id,
            hubIdentifier,
            libraryId: preExistingConfig.libraryId,
            error: extractErrorMessage(error),
          }
        );
      }
    }
  }

  /**
   * Add collection configurations to ordering items
   */
  private addCollectionOrderingItems(
    collectionConfigs: CollectionConfig[],
    orderingItemsByLibrary: Map<string, OrderingItem[]>
  ): void {
    // Group collections by library first
    const configsByLibrary = new Map<string, CollectionConfig[]>();
    collectionConfigs.forEach((config) => {
      if (!configsByLibrary.has(config.libraryId)) {
        configsByLibrary.set(config.libraryId, []);
      }
      configsByLibrary.get(config.libraryId)?.push(config);
    });

    // Sort by sortOrderHome within each library (matching other methods)
    for (const [libraryId, libraryConfigs] of configsByLibrary) {
      const sortedConfigs = [...libraryConfigs].sort(
        (a, b) =>
          (a.sortOrderHome !== undefined ? a.sortOrderHome : 1) -
          (b.sortOrderHome !== undefined ? b.sortOrderHome : 1)
      );

      if (!orderingItemsByLibrary.has(libraryId)) {
        orderingItemsByLibrary.set(libraryId, []);
      }

      const libraryOrderingItems = orderingItemsByLibrary.get(libraryId);
      if (libraryOrderingItems) {
        sortedConfigs.forEach((config) => {
          // Skip missing collections - they don't exist in Plex
          if (config.missing) {
            logger.debug(`Skipping missing collection from Plex reordering`, {
              label: 'Hub Sync Service',
              collectionId: config.id,
              collectionName: config.name,
              ratingKey: config.collectionRatingKey,
              libraryId,
              reason: 'collection marked as missing',
            });
            return;
          }

          // Only include collections that have some visibility - items with zero visibility don't exist in Plex
          const hasAnyVisibility =
            config.visibilityConfig?.usersHome ||
            config.visibilityConfig?.serverOwnerHome ||
            config.visibilityConfig?.libraryRecommended;

          if (!hasAnyVisibility) {
            logger.debug(
              `Skipping collection with no visibility from Plex reordering`,
              {
                label: 'Hub Sync Service',
                collectionId: config.id,
                libraryId,
              }
            );
            return;
          }

          // Only include collections that are calculated as promoted to hubs
          const isPromotedToHub = this.calculateIsPromotedToHub(config);
          if (!isPromotedToHub) {
            return;
          }

          // For collections, we need the collectionRatingKey to create proper Plex identifiers
          const collectionRatingKey = config.collectionRatingKey;

          // If we have a rating key for this library, include it in ordering
          if (collectionRatingKey) {
            libraryOrderingItems.push({
              id: config.id,
              type: 'collection',
              libraryId,
              collectionRatingKey,
              sortOrder:
                config.sortOrderHome !== undefined ? config.sortOrderHome : 1,
            });
          }
        });
      }
    }
  }

  /**
   * Add hub configurations to ordering items
   */
  private addHubOrderingItems(
    hubConfigs: PlexHubConfig[],
    orderingItemsByLibrary: Map<string, OrderingItem[]>
  ): void {
    // Track hub processing for summary logging
    let hubsProcessed = 0;
    let hubsSkippedNoVisibility = 0;
    let hubsSkippedMalformed = 0;
    const librariesProcessed = new Set<string>();

    // Group hub configs by library and use UI order
    const hubConfigsByLibrary = this.groupHubConfigsByLibrary(hubConfigs);

    // Process hubs by library using the same logic as hub ordering
    for (const [libraryId, libraryHubConfigs] of hubConfigsByLibrary) {
      librariesProcessed.add(libraryId);
      // Sort hub configs by their sortOrderHome (this is our UI order for home/recommended)
      const sortedHubConfigs = [...libraryHubConfigs].sort(
        (a, b) =>
          (a.sortOrderHome !== undefined ? a.sortOrderHome : 1) -
          (b.sortOrderHome !== undefined ? b.sortOrderHome : 1)
      );

      // Add hubs to ordering in UI order
      if (!orderingItemsByLibrary.has(libraryId)) {
        orderingItemsByLibrary.set(libraryId, []);
      }

      const libraryOrderingItems = orderingItemsByLibrary.get(libraryId);
      if (libraryOrderingItems) {
        sortedHubConfigs.forEach((hubConfig) => {
          // Skip missing hubs - they don't exist in Plex
          if (hubConfig.missing) {
            logger.debug(`Skipping missing hub from Plex reordering`, {
              label: 'Hub Sync Service',
              hubId: hubConfig.id,
              hubName: hubConfig.name,
              hubIdentifier: hubConfig.hubIdentifier,
              libraryId: hubConfig.libraryId,
              reason: 'hub marked as missing',
            });
            hubsSkippedMalformed++;
            return;
          }

          // Only include hubs that have some visibility - items with zero visibility don't exist in Plex
          const hasAnyVisibility =
            hubConfig.visibilityConfig?.usersHome ||
            hubConfig.visibilityConfig?.serverOwnerHome ||
            hubConfig.visibilityConfig?.libraryRecommended;

          if (!hasAnyVisibility) {
            hubsSkippedNoVisibility++;
            return;
          }

          // Skip malformed hub identifiers created by UI for duplicate handling
          if (this.isValidHubIdentifier(hubConfig.hubIdentifier)) {
            libraryOrderingItems.push({
              id: hubConfig.id,
              type: 'hub',
              libraryId: hubConfig.libraryId,
              hubIdentifier: hubConfig.hubIdentifier,
              sortOrder: hubConfig.sortOrderHome,
            });
            hubsProcessed++;
          } else {
            hubsSkippedMalformed++;
          }
        });
      }
    }

    // Log comprehensive hub processing summary
    if (
      hubsProcessed > 0 ||
      hubsSkippedNoVisibility > 0 ||
      hubsSkippedMalformed > 0
    ) {
      logger.info(
        `Hub reordering: ${hubsProcessed} hubs processed, ${hubsSkippedNoVisibility} skipped (no visibility), ${hubsSkippedMalformed} skipped (malformed) across ${librariesProcessed.size} libraries`,
        {
          label: 'Hub Sync Service',
          hubsProcessed,
          hubsSkippedNoVisibility,
          hubsSkippedMalformed,
          librariesCount: librariesProcessed.size,
        }
      );
    }
  }

  /**
   * Add pre-existing collection configurations to ordering items
   */
  private addPreExistingOrderingItems(
    preExistingConfigs: PreExistingCollectionConfig[],
    orderingItemsByLibrary: Map<string, OrderingItem[]>
  ): void {
    // Group pre-existing configs by library and use UI order
    const configsByLibrary = new Map<string, PreExistingCollectionConfig[]>();
    preExistingConfigs.forEach((config) => {
      if (!configsByLibrary.has(config.libraryId)) {
        configsByLibrary.set(config.libraryId, []);
      }
      configsByLibrary.get(config.libraryId)?.push(config);
    });

    // Process pre-existing collections by library
    for (const [libraryId, libraryConfigs] of configsByLibrary) {
      // Sort configs by their sortOrderHome (this is our UI order for home/recommended)
      const sortedConfigs = [...libraryConfigs].sort(
        (a, b) =>
          (a.sortOrderHome !== undefined ? a.sortOrderHome : 1) -
          (b.sortOrderHome !== undefined ? b.sortOrderHome : 1)
      );

      // Add pre-existing collections to ordering in UI order
      if (!orderingItemsByLibrary.has(libraryId)) {
        orderingItemsByLibrary.set(libraryId, []);
      }

      const libraryOrderingItems = orderingItemsByLibrary.get(libraryId);
      if (libraryOrderingItems) {
        sortedConfigs.forEach((config) => {
          // Skip missing pre-existing collections - they don't exist in Plex
          if (config.missing) {
            logger.debug(
              `Skipping missing pre-existing collection from Plex reordering`,
              {
                label: 'Hub Sync Service',
                collectionId: config.id,
                collectionName: config.name,
                ratingKey: config.collectionRatingKey,
                libraryId: config.libraryId,
                reason: 'collection marked as missing',
              }
            );
            return;
          }

          // Only include pre-existing collections that have some visibility - items with zero visibility don't exist in Plex
          const hasAnyVisibility =
            config.visibilityConfig?.usersHome ||
            config.visibilityConfig?.serverOwnerHome ||
            config.visibilityConfig?.libraryRecommended;

          if (!hasAnyVisibility) {
            logger.debug(
              `Skipping pre-existing collection with no visibility from Plex reordering`,
              {
                label: 'Hub Sync Service',
                collectionId: config.id,
                collectionName: config.name,
                ratingKey: config.collectionRatingKey,
                libraryId: config.libraryId,
              }
            );
            return;
          }

          // Only include pre-existing collections that are calculated as promoted to hubs
          const isPromotedToHub = this.calculateIsPromotedToHub(config);
          if (!isPromotedToHub) {
            logger.debug(
              `Excluding pre-existing collection from reordering: ${config.name} (not promoted to hub)`,
              {
                label: 'Hub Sync Service',
                collectionId: config.id,
                libraryId: config.libraryId,
                ratingKey: config.collectionRatingKey,
                isPromotedToHub,
              }
            );
            return;
          }

          // Use collection rating key as identifier for pre-existing collections
          libraryOrderingItems.push({
            id: config.id,
            type: 'collection',
            libraryId: config.libraryId,
            collectionRatingKey: config.collectionRatingKey,
            sortOrder:
              config.sortOrderHome !== undefined ? config.sortOrderHome : 1,
          });
        });
      }
    }
  }

  /**
   * Check if hub identifier is valid for Plex API calls
   * Filters out UI-generated malformed identifiers like those with _unlinked_ suffixes
   */
  private isValidHubIdentifier(hubIdentifier: string): boolean {
    // Skip hub identifiers that contain _unlinked_ (created by UI for duplicate handling)
    if (hubIdentifier.includes('_unlinked_')) {
      return false;
    }

    // Allow valid Plex hub identifiers including:
    // - Standard format: "movie.recentlyadded", "tv.toprated"
    // - Multi-part format: "recent.library.playlists", "movie.by.actor.or.director"
    // - Custom collections: "custom.collection.1.36004"
    return /^[a-z0-9]+(\.[a-z0-9]+)+$/i.test(hubIdentifier);
  }

  /**
   * Apply unified ordering to each library
   */
  private async applyOrderingToLibraries(
    plexClient: PlexAPI,
    orderingItemsByLibrary: Map<string, OrderingItem[]>,
    onProgress?: (stage: string) => void
  ): Promise<void> {
    let processedLibraries = 0;
    const totalLibraries = Array.from(orderingItemsByLibrary.values()).filter(
      (items) => items.length > 0
    ).length;

    for (const [libraryId, orderingItems] of orderingItemsByLibrary) {
      if (orderingItems.length === 0) {
        continue;
      }

      try {
        processedLibraries++;
        onProgress?.(
          `Ordering library ${processedLibraries}/${totalLibraries} collections...`
        );
        // All items should already be discovered and configured by DiscoveryService
        // No need to find "unmanaged" items - everything should be managed by now

        // DEBUG: Log items before sorting for library "1"
        if (libraryId === '1') {
          logger.debug('Items before sorting and compacting:', {
            label: 'Hub Sync Service - SORT DEBUG',
            libraryId,
            items: orderingItems.map((item) => ({
              id: item.id,
              type: item.type,
              sortOrder: item.sortOrder,
              collectionRatingKey: item.collectionRatingKey,
              hubIdentifier: item.hubIdentifier,
            })),
          });
        }

        // Separate void items (sortOrder = 0) from regular items
        const regularItems = orderingItems.filter(
          (item) => item.sortOrder && item.sortOrder > 0
        );
        const voidItems = orderingItems.filter(
          (item) => !item.sortOrder || item.sortOrder === 0
        );

        // Sort regular items by their sortOrder
        const sortedRegularItems = regularItems.sort(
          (a, b) => a.sortOrder - b.sortOrder
        );

        // Combine: regular items first, then void items at the end
        const sortedItems = [...sortedRegularItems, ...voidItems];

        // Compact sortOrder values to remove gaps left by filtered inactive items
        // This preserves the relative ordering while ensuring sequential values (1,2,3,4...)
        // Void items get assigned sequential positions at the end
        const managedOrderingItems = sortedItems.map((item, index) => ({
          ...item,
          sortOrder: index + 1,
        }));

        // Use only the managed items - discovery should have found everything we need
        const completeOrderingItems = managedOrderingItems;

        // Get library type for anchor positioning
        const settings = getSettings();
        const library = settings.plex.libraries.find(
          (lib) => lib.key === libraryId
        );
        if (!library) {
          throw new Error(`Library ${libraryId} not found in settings`);
        }

        // Applying unified ordering for library
        await applyUnifiedOrderingToPlex(plexClient, completeOrderingItems);
      } catch (error) {
        logger.error(
          `Failed to apply ordering for library ${libraryId}: ${extractErrorMessage(
            error
          )}`,
          {
            label: 'Hub Sync Service',
            libraryId,
            error: extractErrorMessage(error),
          }
        );
      }
    }
  }

  /**
   * Sync pre-existing collection sortTitles based on isLibraryPromoted status
   * Only updates sortTitle when collections are in promoted state
   */
  public async syncPreExistingCollectionSortTitles(
    plexClient: PlexAPI
  ): Promise<void> {
    if (this.cancelled) return;

    try {
      const settings = getSettings();
      const preExistingConfigs =
        settings.plex.preExistingCollectionConfigs || [];

      for (const config of preExistingConfigs) {
        if (this.cancelled) return;

        // Skip configs without rating keys
        if (!config.collectionRatingKey) {
          continue;
        }

        // Only update sortTitle if everLibraryPromoted is not explicitly false
        if (config.everLibraryPromoted === false) {
          // If everLibraryPromoted is explicitly false: DO NOT touch sortTitle at all
          continue;
        }

        let sortTitle: string;
        const updateConfig: Partial<PreExistingCollectionConfig> = {};

        if (config.isLibraryPromoted && config.sortOrderLibrary > 0) {
          // Promoted: Set exclamation marks
          const sameLibraryPreExisting = preExistingConfigs.filter(
            (c) =>
              c.libraryId === config.libraryId &&
              c.sortOrderLibrary !== undefined &&
              c.isLibraryPromoted === true
          );

          const collectionConfigs = settings.plex.collectionConfigs || [];
          const sameLibraryCollections = collectionConfigs.filter(
            (c) =>
              c.libraryId === config.libraryId &&
              c.sortOrderLibrary !== undefined &&
              c.isLibraryPromoted === true
          );

          const combinedSortOrders = [
            ...sameLibraryPreExisting.map((c) => c.sortOrderLibrary),
            ...sameLibraryCollections.map((c) => c.sortOrderLibrary),
          ].filter((order): order is number => order !== undefined);

          if (combinedSortOrders.length > 0) {
            const maxSortOrder = Math.max(...combinedSortOrders);
            const exclamationCount = maxSortOrder - config.sortOrderLibrary + 2;
            const exclamationPrefix = '!'.repeat(exclamationCount);
            sortTitle = `${exclamationPrefix}${config.name}`;
          } else {
            sortTitle = `!!${config.name}`;
          }
        } else {
          // Demoted: Reset to natural title and mark as cleaned
          sortTitle = config.name;
          // After reset, set everLibraryPromoted back to false
          updateConfig.everLibraryPromoted = false;
        }

        try {
          await plexClient.updateCollectionSortTitle(
            config.collectionRatingKey,
            sortTitle
          );

          // Update config if everLibraryPromoted needs to be reset
          if (updateConfig.everLibraryPromoted !== undefined) {
            this.updatePreExistingConfigField(config.id, updateConfig);
          }

          logger.debug(
            `Updated sortTitle for pre-existing collection ${config.name}: ${sortTitle}`,
            {
              label: 'Hub Sync Service',
              collectionId: config.id,
              collectionName: config.name,
              isLibraryPromoted: config.isLibraryPromoted,
              sortOrderLibrary: config.sortOrderLibrary,
            }
          );
        } catch (error) {
          logger.error(
            `Failed to update sortTitle for pre-existing collection ${
              config.name
            }: ${extractErrorMessage(error)}`,
            {
              label: 'Hub Sync Service',
              collectionId: config.id,
              collectionName: config.name,
              collectionRatingKey: config.collectionRatingKey,
              error: extractErrorMessage(error),
            }
          );
        }
      }
    } catch (error) {
      logger.error(
        `Failed to sync pre-existing collection sortTitles: ${extractErrorMessage(
          error
        )}`,
        {
          label: 'Hub Sync Service',
          error: extractErrorMessage(error),
        }
      );
    }
  }

  /**
   * Evaluate time restrictions and update isActive status for hubs/pre-existing collections
   * Returns the effective visibility config to use (main or inactive)
   */
  private evaluateAndUpdateTimeRestriction<
    T extends PlexHubConfig | PreExistingCollectionConfig
  >(config: T, configType: 'hub' | 'preExisting'): T['visibilityConfig'] {
    // Evaluate time restrictions
    const timeRestrictionResult = TimeRestrictionUtils.evaluateTimeRestriction(
      config.timeRestriction
    );

    // Update isActive status if it has changed
    if (config.isActive !== timeRestrictionResult.isActive) {
      this.updateConfigActiveStatus(
        config.id,
        timeRestrictionResult.isActive,
        configType
      );
    }

    // For hubs and pre-existing collections, removeFromPlexWhenInactive is always false (safety)
    // They can only use visibility changes, never deletion
    if (!timeRestrictionResult.isActive) {
      // Collection is inactive - use inactive visibility settings
      const inactiveVisibilityConfig = config.timeRestriction
        ?.inactiveVisibilityConfig ?? {
        usersHome: false,
        serverOwnerHome: false,
        libraryRecommended: true, // Default: still appears in library tab when inactive
      };

      logger.debug(
        `Using inactive visibility settings for ${configType}: ${config.name} - time restriction not met (${timeRestrictionResult.reason})`,
        {
          label: 'Hub Sync Service',
          configType,
          configId: config.id,
          reason: timeRestrictionResult.reason,
          nextActivation: timeRestrictionResult.nextActivation,
          inactiveVisibility: inactiveVisibilityConfig,
        }
      );

      return inactiveVisibilityConfig;
    } else {
      // Collection is active - use normal visibility settings
      return config.visibilityConfig;
    }
  }

  /**
   * Update isActive status for hub or pre-existing collection config
   */
  private updateConfigActiveStatus(
    configId: string,
    isActive: boolean,
    configType: 'hub' | 'preExisting'
  ): void {
    try {
      const settings = getSettings();

      if (configType === 'hub') {
        const hubConfigs = settings.plex.hubConfigs || [];
        const configIndex = hubConfigs.findIndex((c) => c.id === configId);
        if (configIndex !== -1) {
          hubConfigs[configIndex] = { ...hubConfigs[configIndex], isActive };
          settings.plex.hubConfigs = hubConfigs;
        }
      } else if (configType === 'preExisting') {
        const preExistingConfigs =
          settings.plex.preExistingCollectionConfigs || [];
        const configIndex = preExistingConfigs.findIndex(
          (c) => c.id === configId
        );
        if (configIndex !== -1) {
          preExistingConfigs[configIndex] = {
            ...preExistingConfigs[configIndex],
            isActive,
          };
          settings.plex.preExistingCollectionConfigs = preExistingConfigs;
        }
      }

      settings.save();

      logger.debug(
        `Updated ${configType} isActive status: ${configId} -> ${isActive}`,
        {
          label: 'Hub Sync Service',
          configType,
          configId,
          isActive,
        }
      );
    } catch (error) {
      logger.error(
        `Failed to update ${configType} isActive status for ${configId}`,
        {
          label: 'Hub Sync Service',
          configType,
          configId,
          error: extractErrorMessage(error),
        }
      );
    }
  }

  /**
   * Calculate isPromotedToHub status for a collection config
   * This is a calculated field based on visibility settings and collection state
   */
  private calculateIsPromotedToHub(
    config: CollectionConfig | PlexHubConfig | PreExistingCollectionConfig
  ): boolean {
    // Default Plex hubs are always promoted (can't be deleted)
    if (
      'collectionType' in config &&
      config.collectionType === CollectionType.DEFAULT_PLEX_HUB
    ) {
      return true;
    }

    // For Agregarr collections, calculate based on current state and visibility
    if ('type' in config) {
      // This is a CollectionConfig
      const collectionConfig = config as CollectionConfig;

      if (collectionConfig.isActive) {
        // Active collections: base on current visibility settings
        return !!(
          collectionConfig.visibilityConfig?.usersHome ||
          collectionConfig.visibilityConfig?.serverOwnerHome ||
          collectionConfig.visibilityConfig?.libraryRecommended
        );
      } else {
        // Inactive collections: check time restriction settings
        const timeRestriction = collectionConfig.timeRestriction;

        if (timeRestriction?.removeFromPlexWhenInactive) {
          // Remove entirely when inactive = DELETE from hub management
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

    // For pre-existing collections, calculate based on visibility config like regular collections
    if ('visibilityConfig' in config && !('type' in config)) {
      // This is a PreExistingCollectionConfig
      const preExistingConfig = config as PreExistingCollectionConfig;

      if (preExistingConfig.isActive) {
        // Active pre-existing collections: base on current visibility settings
        return !!(
          preExistingConfig.visibilityConfig?.usersHome ||
          preExistingConfig.visibilityConfig?.serverOwnerHome ||
          preExistingConfig.visibilityConfig?.libraryRecommended
        );
      } else {
        // Inactive pre-existing collections: check time restriction settings
        const timeRestriction = preExistingConfig.timeRestriction;

        if (timeRestriction?.removeFromPlexWhenInactive) {
          // Remove entirely when inactive = DELETE from hub management
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

    // For other hub types, preserve their discovered value
    // This maintains the user's existing Plex setup
    return config.isPromotedToHub !== false; // Default to true if undefined
  }

  /**
   * Update specific fields of a pre-existing collection config
   */
  private updatePreExistingConfigField(
    configId: string,
    updateConfig: Partial<PreExistingCollectionConfig>
  ): void {
    try {
      const settings = getSettings();
      const preExistingConfigs =
        settings.plex.preExistingCollectionConfigs || [];
      const configIndex = preExistingConfigs.findIndex(
        (c) => c.id === configId
      );

      if (configIndex !== -1) {
        preExistingConfigs[configIndex] = {
          ...preExistingConfigs[configIndex],
          ...updateConfig,
        };
        settings.plex.preExistingCollectionConfigs = preExistingConfigs;
        settings.save();

        logger.debug(
          `Updated pre-existing collection config fields: ${configId}`,
          {
            label: 'Hub Sync Service',
            configId,
            updatedFields: Object.keys(updateConfig),
          }
        );
      }
    } catch (error) {
      logger.error(
        `Failed to update pre-existing collection config fields for ${configId}`,
        {
          label: 'Hub Sync Service',
          configId,
          error: extractErrorMessage(error),
        }
      );
    }
  }
}

export default HubSyncService;
