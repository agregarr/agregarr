import type PlexAPI from '@server/api/plexapi';
import { extractErrorMessage } from '@server/lib/collections/core/CollectionUtilities';
import type {
  CollectionConfig,
  PlexHubConfig,
  PreExistingCollectionConfig,
} from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import {
  applyUnifiedOrderingToPlex,
  type OrderingItem,
} from './UnifiedOrderingService';

// Plex hub interface for API responses
interface PlexHub {
  identifier: string;
  title: string;
  recommendationsVisibility?: 'all' | 'none';
  homeVisibility?: 'all' | 'none' | 'admin';
  promotedToRecommended?: boolean;
  promotedToOwnHome?: boolean;
  promotedToSharedHome?: boolean;
  deletable?: boolean;
}

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

      // Process collection configs that have rating keys
      if (collectionConfigs.length > 0) {
        onProgress?.(
          `Syncing visibility for ${collectionConfigs.length} collections...`
        );
        await this.syncLibraryCollections(plexClient, collectionConfigs);
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
   * Sync unified ordering for collections and hubs together
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

      const settings = getSettings();
      const collectionConfigs = settings.plex.collectionConfigs || [];
      const hubConfigs = settings.plex.hubConfigs || [];
      const preExistingCollectionConfigs =
        settings.plex.preExistingCollectionConfigs || [];

      logger.debug('Unified ordering config counts:', {
        label: 'Hub Sync Service',
        collectionConfigs: collectionConfigs.length,
        hubConfigs: hubConfigs.length,
        preExistingCollectionConfigs: preExistingCollectionConfigs.length,
      });

      // Build unified ordering items for each library
      onProgress?.('Building collection ordering list...');
      const orderingItemsByLibrary = new Map<string, OrderingItem[]>();

      // Add collection configs to ordering
      this.addCollectionOrderingItems(
        collectionConfigs,
        orderingItemsByLibrary
      );

      // Add hub configs to ordering
      this.addHubOrderingItems(hubConfigs, orderingItemsByLibrary);
      this.addPreExistingOrderingItems(
        preExistingCollectionConfigs,
        orderingItemsByLibrary
      );

      // Apply unified ordering to each library
      const libraryCount = orderingItemsByLibrary.size;
      onProgress?.(`Applying ordering to ${libraryCount} libraries...`);
      await this.applyOrderingToLibraries(
        plexClient,
        orderingItemsByLibrary,
        onProgress
      );

      // Unified ordering sync completed
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
        // Convert our visibility config to Plex format
        const plexVisibility = this.convertToPlexVisibility(hubConfig);

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
      homeVisibility:
        hubConfig.visibilityConfig?.usersHome ||
        hubConfig.visibilityConfig?.serverOwnerHome
          ? 'all'
          : 'none',
      recommendationsVisibility: hubConfig.visibilityConfig?.libraryRecommended
        ? 'all'
        : 'none',
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
      homeVisibility:
        collectionConfig.visibilityConfig?.usersHome ||
        collectionConfig.visibilityConfig?.serverOwnerHome
          ? 'all'
          : 'none',
      recommendationsVisibility: collectionConfig.visibilityConfig
        ?.libraryRecommended
        ? 'all'
        : 'none',
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
      const hubIdentifier = `custom.collection.${collectionConfig.libraryId}.${collectionConfig.collectionRatingKey}`;

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
        // Convert collection visibility config to Plex format
        const plexVisibility =
          this.convertCollectionToPlexVisibility(collectionConfig);

        await plexClient.updateHubVisibility(
          collectionConfig.libraryId,
          hubIdentifier,
          plexVisibility
        );

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
        // Convert pre-existing collection visibility config to Plex format
        const plexVisibility = {
          promotedToOwnHome:
            preExistingConfig.visibilityConfig?.serverOwnerHome || false,
          promotedToSharedHome:
            preExistingConfig.visibilityConfig?.usersHome || false,
          promotedToRecommended:
            preExistingConfig.visibilityConfig?.libraryRecommended || false,
          homeVisibility:
            preExistingConfig.visibilityConfig?.usersHome ||
            preExistingConfig.visibilityConfig?.serverOwnerHome
              ? 'all'
              : 'none',
          recommendationsVisibility: preExistingConfig.visibilityConfig
            ?.libraryRecommended
            ? 'all'
            : 'none',
        };

        await plexClient.updateHubVisibility(
          preExistingConfig.libraryId,
          hubIdentifier,
          plexVisibility
        );

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
    for (const config of collectionConfigs) {
      const libraryId = config.libraryId;

      if (!orderingItemsByLibrary.has(libraryId)) {
        orderingItemsByLibrary.set(libraryId, []);
      }

      // For collections, we need the collectionRatingKey to create proper Plex identifiers
      const ratingKeyForLibrary = config.collectionRatingKey;

      // If we have a rating key for this library, include it in ordering
      if (ratingKeyForLibrary) {
        const libraryOrderingItems = orderingItemsByLibrary.get(libraryId);
        if (libraryOrderingItems) {
          libraryOrderingItems.push({
            id: config.id,
            type: 'collection',
            libraryId,
            collectionRatingKey: ratingKeyForLibrary,
            sortOrder: config.sortOrderHome || 0,
          });
        }
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
    // Group hub configs by library and use UI order
    const hubConfigsByLibrary = this.groupHubConfigsByLibrary(hubConfigs);

    // Process hubs by library using the same logic as hub ordering
    for (const [libraryId, libraryHubConfigs] of hubConfigsByLibrary) {
      // Sort hub configs by their sortOrderHome (this is our UI order for home/recommended)
      const sortedHubConfigs = [...libraryHubConfigs].sort(
        (a, b) => (a.sortOrderHome || 0) - (b.sortOrderHome || 0)
      );

      // Add hubs to ordering in UI order
      if (!orderingItemsByLibrary.has(libraryId)) {
        orderingItemsByLibrary.set(libraryId, []);
      }

      const libraryOrderingItems = orderingItemsByLibrary.get(libraryId);
      if (libraryOrderingItems) {
        sortedHubConfigs.forEach((hubConfig) => {
          // Only include hubs that have at least one of the main visibility settings enabled
          const hasMainVisibility =
            hubConfig.visibilityConfig.usersHome ||
            hubConfig.visibilityConfig.serverOwnerHome ||
            hubConfig.visibilityConfig.libraryRecommended;

          if (!hasMainVisibility) {
            return;
          }

          // Skip malformed hub identifiers created by UI for duplicate handling
          if (this.isValidHubIdentifier(hubConfig.hubIdentifier)) {
            libraryOrderingItems.push({
              id: hubConfig.id,
              type: 'hub',
              libraryId: hubConfig.libraryId,
              hubIdentifier: hubConfig.hubIdentifier,
              sortOrder: hubConfig.sortOrderHome || 0,
            });
          } else {
            logger.warn(
              `Skipping malformed hub identifier: ${hubConfig.hubIdentifier}`,
              {
                label: 'Hub Sync Service',
                hubId: hubConfig.id,
                libraryId: hubConfig.libraryId,
              }
            );
          }
        });
      }
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
        (a, b) => (a.sortOrderHome || 0) - (b.sortOrderHome || 0)
      );

      // Add pre-existing collections to ordering in UI order
      if (!orderingItemsByLibrary.has(libraryId)) {
        orderingItemsByLibrary.set(libraryId, []);
      }

      const libraryOrderingItems = orderingItemsByLibrary.get(libraryId);
      if (libraryOrderingItems) {
        sortedConfigs.forEach((config) => {
          // Only include collections that have at least one of the main visibility settings enabled
          const hasMainVisibility =
            config.visibilityConfig.usersHome ||
            config.visibilityConfig.serverOwnerHome ||
            config.visibilityConfig.libraryRecommended;

          if (!hasMainVisibility) {
            return;
          }

          // Use collection rating key as identifier for pre-existing collections
          libraryOrderingItems.push({
            id: config.id,
            type: 'collection',
            libraryId: config.libraryId,
            collectionRatingKey: config.collectionRatingKey,
            sortOrder: config.sortOrderHome || 0,
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
        // Get all available hubs from Plex for this library to include inactive ones
        const allPlexHubs = await plexClient.getHubManagement(libraryId);
        const availableHubs = allPlexHubs.MediaContainer.Hub;

        // Get current hub identifiers that are already managed
        const managedHubIdentifiers = orderingItems
          .filter((item) => item.type === 'hub')
          .map((item) => item.hubIdentifier);

        // Find ALL unmanaged hubs (both visible and invisible) to add at the end
        const unmanagedHubs = availableHubs.filter((hub: PlexHub) => {
          const isNotManaged = !managedHubIdentifiers.includes(hub.identifier);
          const isBuiltIn = !hub.identifier?.startsWith('custom.collection.');
          return isNotManaged && isBuiltIn;
        });

        // Normalize sort orders for managed items to ensure sequential ordering (0,1,2,...)
        const normalizedOrderingItems = orderingItems
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((item, index) => ({ ...item, sortOrder: index }));

        // Add unmanaged hubs to ordering items (at the bottom with sequential sort orders)
        const unmanagedHubOrderingItems = unmanagedHubs.map(
          (hub: PlexHub, index: number) => ({
            id: `unmanaged-${hub.identifier}`,
            type: 'hub' as const,
            libraryId,
            hubIdentifier: hub.identifier,
            sortOrder: normalizedOrderingItems.length + index,
          })
        );

        // Combine normalized managed items with unmanaged hubs
        const completeOrderingItems = [
          ...normalizedOrderingItems,
          ...unmanagedHubOrderingItems,
        ];

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

        // Only update sortTitle if sortOrderLibrary is defined
        if (config.sortOrderLibrary === undefined) {
          continue;
        }

        let sortTitle: string;

        if (config.isLibraryPromoted && config.sortOrderLibrary > 0) {
          // Promoted pre-existing collections get exclamation marks
          const sameLibraryConfigs = preExistingConfigs.filter(
            (c) =>
              c.libraryId === config.libraryId &&
              c.sortOrderLibrary !== undefined &&
              c.isLibraryPromoted === true
          );

          if (sameLibraryConfigs.length > 0) {
            const sortOrders = sameLibraryConfigs
              .map((c) => c.sortOrderLibrary)
              .filter((order): order is number => order !== undefined);
            const maxSortOrder = Math.max(...sortOrders);
            const exclamationCount = maxSortOrder - config.sortOrderLibrary + 2;
            const exclamationPrefix = '!'.repeat(exclamationCount);
            sortTitle = `${exclamationPrefix}${config.name}`;
          } else {
            sortTitle = `!!${config.name}`;
          }
        } else {
          // A-Z pre-existing collections use natural title for alphabetical sorting
          sortTitle = config.name;
        }

        try {
          await plexClient.updateCollectionSortTitle(
            config.collectionRatingKey,
            sortTitle
          );

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
}

export default HubSyncService;
