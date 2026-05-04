import type PlexAPI from '@server/api/plexapi';
import { extractErrorMessage } from '@server/lib/collections/core/CollectionUtilities';
import type {
  CollectionConfig,
  PlexHubConfig,
  PreExistingCollectionConfig,
} from '@server/lib/settings';
import { CollectionType, getSettings } from '@server/lib/settings';
import logger from '@server/logger';

/**
 * Helper function to determine if a collection should be promoted to hub management
 * This replicates the logic from HubSyncService.calculateIsPromotedToHub
 */
function shouldCollectionBePromotedToHub(
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
    // This is a PreExistingCollectionConfig - check if it has any visibility
    const preExistingConfig = config as PreExistingCollectionConfig;
    if (preExistingConfig.isActive) {
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

  // Default: not promoted
  return false;
}

/**
 * Unified ordering service for collections and hubs
 * Handles conversion between UI ordering and Plex identifiers
 */

export interface OrderingItem {
  id: number | string;
  type: 'collection' | 'hub';
  libraryId: string;
  collectionRatingKey?: string; // For collections
  hubIdentifier?: string; // For hubs (e.g., "movie.recentlyadded")
  sortOrder: number;
}

export interface PlexOrderingItem {
  identifier: string; // Plex identifier for reordering
  libraryId: string;
  sortOrder: number;
}

/**
 * Convert UI ordering items to Plex identifiers for reordering API
 */
export function convertUIOrderingToPlexIdentifiers(
  orderingItems: OrderingItem[]
): PlexOrderingItem[] {
  const plexItems: PlexOrderingItem[] = [];

  for (const item of orderingItems) {
    let identifier: string;

    if (item.type === 'hub') {
      // Hub: handle both built-in hubs and raw rating keys
      if (!item.hubIdentifier) {
        logger.warn(`Hub item ${item.id} missing hubIdentifier, skipping`, {
          label: 'Unified Ordering',
        });
        continue;
      }

      // Check if this is a raw rating key (just numbers) that needs conversion
      if (/^\d+$/.test(item.hubIdentifier)) {
        // Raw rating key for non-promoted collection - convert to proper format
        identifier = `custom.collection.${item.libraryId}.${item.hubIdentifier}`;
        logger.debug(
          `Converting raw rating key to proper format: ${item.hubIdentifier} -> ${identifier}`,
          {
            label: 'Unified Ordering',
            hubId: item.id,
            libraryId: item.libraryId,
          }
        );
      } else {
        // Built-in hub identifier - use directly (e.g., "movie.recentlyadded")
        identifier = item.hubIdentifier;
      }
    } else {
      // Collection: use custom collection format "custom.collection.{libraryId}.{collectionRatingKey}"
      if (!item.collectionRatingKey) {
        logger.warn(
          `Collection item ${item.id} missing collectionRatingKey, skipping`,
          {
            label: 'Unified Ordering',
          }
        );
        continue;
      }
      identifier = `custom.collection.${item.libraryId}.${item.collectionRatingKey}`;
    }

    plexItems.push({
      identifier,
      libraryId: item.libraryId,
      sortOrder: item.sortOrder,
    });
  }

  return plexItems;
}

/**
 * Apply unified ordering to Plex libraries
 * NOTE: This assumes all collections are already promoted and configured properly
 * Discovery and promotion should happen in a separate phase before calling this
 */
export async function applyUnifiedOrderingToPlex(
  plexClient: PlexAPI,
  orderingItems: OrderingItem[]
): Promise<void> {
  try {
    // Convert UI ordering to Plex identifiers
    const plexItems = convertUIOrderingToPlexIdentifiers(orderingItems);

    // Get and increment sync counter for alternating positioning methods
    const settings = getSettings();
    const currentSyncCounter = settings.main.syncCounter || 0;
    const nextSyncCounter = currentSyncCounter + 1;

    // Update sync counter in settings for next sync
    settings.main.syncCounter = nextSyncCounter;
    await settings.save();

    logger.info(
      `Applying unified ordering with sync counter: ${nextSyncCounter} (method: ${
        nextSyncCounter % 2 === 0 ? 'reverse-anchor' : 'sequential'
      })`,
      {
        label: 'Unified Ordering Service',
        syncCounter: nextSyncCounter,
        positioningMethod:
          nextSyncCounter % 2 === 0 ? 'reverse-anchor' : 'sequential',
      }
    );

    // Group by library for efficient processing
    const itemsByLibrary = new Map<string, PlexOrderingItem[]>();

    for (const item of plexItems) {
      if (!itemsByLibrary.has(item.libraryId)) {
        itemsByLibrary.set(item.libraryId, []);
      }
      const libraryItems = itemsByLibrary.get(item.libraryId);
      if (libraryItems) {
        libraryItems.push(item);
      }
    }

    // Process each library
    for (const [libraryId, libraryItems] of itemsByLibrary) {
      // Sort items by their desired order
      const sortedItems = libraryItems.sort(
        (a, b) => a.sortOrder - b.sortOrder
      );

      // Extract identifiers in the desired order
      const orderedIdentifiers = sortedItems.map((item) => item.identifier);

      // Determine library type from hub identifiers
      const libraryType = sortedItems.some(
        (item) =>
          item.identifier.startsWith('tv.') ||
          item.identifier.startsWith('show.')
      )
        ? 'show'
        : 'movie';

      // DEBUG: Log the ordering array being sent to Plex
      logger.info('ORDERING DEBUG: Array being sent to PlexAPI reorderHubs', {
        label: 'Unified Ordering Service',
        libraryId,
        libraryType,
        orderedIdentifiers,
        sortedItemsDebug: sortedItems.map((item, index) => ({
          index,
          sortOrder: item.sortOrder,
          identifier: item.identifier,
          libraryId: item.libraryId,
        })),
      });

      // Apply ordering using Plex hub reordering API with precision convergence recovery
      try {
        await plexClient.reorderHubs(
          libraryId,
          orderedIdentifiers,
          undefined,
          libraryType,
          nextSyncCounter
        );
      } catch (error: unknown) {
        // Check if this is a precision convergence error
        const convergenceError = error as Error & {
          isPrecisionConvergence?: boolean;
          sectionId?: string;
          moveCount?: number;
          repromoCount?: number;
        };

        if (
          convergenceError.isPrecisionConvergence &&
          convergenceError.sectionId === libraryId
        ) {
          logger.warn(
            `Precision convergence detected in library ${libraryId} after unpromote/re-promote recovery attempts failed, initiating reset and rebuild as fallback`,
            {
              label: 'Unified Ordering Service',
              libraryId,
              libraryType,
              moveCount: convergenceError.moveCount,
              repromoCount: convergenceError.repromoCount || 0,
              action: 'reset_and_rebuild',
              note: 'This should be rare - unpromote/re-promote recovery handles most convergence cases',
            }
          );

          // Reset the library hub management (clears all positioning)
          await plexClient.resetLibraryHubManagement(libraryId);

          // Wait a moment for Plex to process the reset
          await new Promise((resolve) => setTimeout(resolve, 1000));

          // Rebuild: Run normal sync process to achieve the same end state
          await rebuildLibraryHubManagement(
            plexClient,
            libraryId,
            libraryType,
            orderedIdentifiers
          );

          logger.info(
            `Successfully recovered from precision convergence in library ${libraryId}`,
            {
              label: 'Unified Ordering Service',
              libraryId,
              libraryType,
              action: 'recovery_completed',
            }
          );
        } else {
          // Re-throw non-convergence errors
          throw error;
        }
      }
    }

    // Successfully applied unified ordering
  } catch (error) {
    logger.error(
      `Failed to apply unified ordering: ${extractErrorMessage(error)}`,
      {
        label: 'Unified Ordering',
        error: extractErrorMessage(error),
      }
    );
    throw error;
  }
}

/**
 * Rebuild hub management for a specific library after reset
 * Key optimization: Promote collections in the DESIRED ORDER so they get sequential fresh spacing
 * Then only need to move default hubs into position
 */
async function rebuildLibraryHubManagement(
  plexClient: PlexAPI,
  libraryId: string,
  libraryType: 'movie' | 'show',
  orderedIdentifiers: string[]
): Promise<void> {
  try {
    logger.info(`Starting hub management rebuild for library ${libraryId}`, {
      label: 'Unified Ordering Service',
      libraryId,
      libraryType,
      identifierCount: orderedIdentifiers.length,
    });

    // Get settings to determine what needs to be rebuilt
    const settings = getSettings();
    const collectionConfigs = settings.plex.collectionConfigs || [];
    const preExistingCollectionConfigs =
      settings.plex.preExistingCollectionConfigs || [];

    // Build a map of rating key -> config for quick lookup.
    // Multi-collection configs (e.g. seerr/users) store all their keys in collectionRatingKeys[].
    const configsByRatingKey = new Map<
      string,
      CollectionConfig | PreExistingCollectionConfig
    >();
    for (const config of collectionConfigs) {
      if (config.libraryId !== libraryId) continue;
      if (config.collectionRatingKey) {
        configsByRatingKey.set(config.collectionRatingKey, config);
      }
      if (config.collectionRatingKeys) {
        for (const ratingKey of config.collectionRatingKeys) {
          configsByRatingKey.set(ratingKey, config);
        }
      }
    }
    for (const config of preExistingCollectionConfigs) {
      if (config.collectionRatingKey && config.libraryId === libraryId) {
        configsByRatingKey.set(config.collectionRatingKey, config);
      }
    }

    // Helper to extract rating key from identifier
    const extractRatingKey = (identifier: string): string | null => {
      if (!identifier.startsWith('custom.collection.')) {
        return null;
      }
      const parts = identifier.split('.');
      return parts.length >= 4 ? parts[3] : null;
    };

    // Step 1: Re-promote collections IN DESIRED ORDER
    // This gives them sequential fresh 1000-unit spacing automatically
    const defaultHubIdentifiers: string[] = [];
    let promotedCount = 0;

    for (const identifier of orderedIdentifiers) {
      const ratingKey = extractRatingKey(identifier);

      if (ratingKey) {
        // This is a custom collection - promote it
        const config = configsByRatingKey.get(ratingKey);
        if (config) {
          const shouldBePromoted = shouldCollectionBePromotedToHub(config);
          if (shouldBePromoted) {
            try {
              await plexClient.promoteCollectionToHub(ratingKey, libraryId);
              promotedCount++;
              logger.debug(
                `Re-promoted collection ${config.name} in order position ${promotedCount}`,
                {
                  label: 'Unified Ordering Service',
                  collectionName: config.name,
                  libraryId,
                  orderPosition: promotedCount,
                }
              );
            } catch (error) {
              logger.warn(
                `Failed to re-promote collection ${
                  config.name
                } to hub: ${extractErrorMessage(error)}`,
                {
                  label: 'Unified Ordering Service',
                  collectionName: config.name,
                  libraryId,
                }
              );
            }
          }
        } else {
          logger.debug(
            `No config found for rating key ${ratingKey} in library ${libraryId}, skipping re-promotion`,
            {
              label: 'Unified Ordering Service',
              libraryId,
              ratingKey,
            }
          );
        }
      } else {
        // This is a default hub - track it for positioning later
        defaultHubIdentifiers.push(identifier);
      }
    }

    logger.info(
      `Promoted ${promotedCount} collections in desired order with fresh spacing`,
      {
        label: 'Unified Ordering Service',
        libraryId,
        promotedCount,
        defaultHubsToPosition: defaultHubIdentifiers.length,
      }
    );

    // Step 2: Set visibility settings for each hub
    const { HubSyncService } = await import('./HubSyncService');
    const hubSyncService = new HubSyncService();
    await hubSyncService.syncHubVisibility(plexClient);

    // Step 3: Wait for Plex to process the hub setup
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Step 4: Position default hubs only
    // Collections are already in the right order from sequential promotion
    if (defaultHubIdentifiers.length > 0) {
      logger.info(
        `Positioning ${defaultHubIdentifiers.length} default hubs around collections`,
        {
          label: 'Unified Ordering Service',
          libraryId,
          defaultHubs: defaultHubIdentifiers,
        }
      );

      // Position each default hub
      for (const defaultHub of defaultHubIdentifiers) {
        // Find where this hub should be in the desired order
        const desiredIndex = orderedIdentifiers.indexOf(defaultHub);
        if (desiredIndex === -1) continue;

        // Find what should come before it in the desired order
        const predecessorIdentifier =
          desiredIndex > 0 ? orderedIdentifiers[desiredIndex - 1] : null;

        if (predecessorIdentifier) {
          // Move this default hub after its predecessor
          try {
            await plexClient.moveHub(
              libraryId,
              defaultHub,
              predecessorIdentifier
            );
            logger.debug(
              `Positioned default hub ${defaultHub} after ${predecessorIdentifier}`,
              {
                label: 'Unified Ordering Service',
                libraryId,
                hubId: defaultHub,
                afterId: predecessorIdentifier,
              }
            );
          } catch (error) {
            logger.warn(
              `Failed to position default hub ${defaultHub}: ${extractErrorMessage(
                error
              )}`,
              {
                label: 'Unified Ordering Service',
                libraryId,
                hubId: defaultHub,
              }
            );
          }
        } else {
          // This is the first item - position after the anchor
          const anchor =
            libraryType === 'show' ? 'tv.ondeck' : 'movie.inprogress';
          try {
            await plexClient.moveHub(libraryId, defaultHub, anchor);
            logger.debug(
              `Positioned default hub ${defaultHub} as first item after anchor ${anchor}`,
              {
                label: 'Unified Ordering Service',
                libraryId,
                hubId: defaultHub,
                anchor,
              }
            );
          } catch (error) {
            logger.warn(
              `Failed to position default hub ${defaultHub} as first item: ${extractErrorMessage(
                error
              )}`,
              {
                label: 'Unified Ordering Service',
                libraryId,
                hubId: defaultHub,
              }
            );
          }
        }
      }
    }

    logger.info(`Hub management rebuild completed for library ${libraryId}`, {
      label: 'Unified Ordering Service',
      libraryId,
      result: 'rebuild_successful',
      collectionsPromoted: promotedCount,
      defaultHubsPositioned: defaultHubIdentifiers.length,
    });
  } catch (error) {
    logger.error(
      `Failed to rebuild hub management for library ${libraryId}: ${extractErrorMessage(
        error
      )}`,
      {
        label: 'Unified Ordering Service',
        libraryId,
        error: extractErrorMessage(error),
      }
    );
    throw error;
  }
}

/**
 * Generate placeholder collection identifier for collections not yet created
 * Format: "placeholder.collection.{configId}"
 */
export function generatePlaceholderCollectionIdentifier(
  configId: number | string
): string {
  return `placeholder.collection.${configId}`;
}

/**
 * Check if an identifier is a placeholder
 */
export function isPlaceholderIdentifier(identifier: string): boolean {
  return identifier.startsWith('placeholder.collection.');
}

/**
 * Extract config ID from placeholder identifier
 */
export function extractConfigIdFromPlaceholder(identifier: string): string {
  return identifier.replace('placeholder.collection.', '');
}
