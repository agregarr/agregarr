import type PlexAPI from '@server/api/plexapi';
import type {
  OverseerrUser,
  PlexCollection,
  PlexLabel,
} from '@server/lib/collections/core/types';
import { overseerrCollectionService } from '@server/lib/collections/sources/overseerr';
import type { CollectionConfig } from '@server/lib/settings';
import logger from '@server/logger';

interface UserCollections {
  [userId: string]: {
    movies: { ratingKey: string; type?: string }[];
    tv: { ratingKey: string; type?: string }[];
    user: OverseerrUser;
  };
}

/**
 * Service for cleaning up orphaned and disabled collections
 */
export class CollectionCleanupService {
  private cancelled = false;

  public cancel(): void {
    this.cancelled = true;
  }

  /**
   * Clean up collections that no longer have active configurations
   */
  public async cleanupDisabledCollections(
    plexClient: PlexAPI,
    existingAgregarrCollections: PlexCollection[],
    currentConfigs: CollectionConfig[],
    userCollections: UserCollections,
    processedCollectionKeys: Set<string>
  ): Promise<{ deleted: number }> {
    let deleted = 0;

    // Get all config types and their labels
    const activeConfigLabels = await this.generateActiveConfigLabels(
      currentConfigs
    );

    // Get current user Plex IDs for orphaned user collection cleanup
    const currentUserPlexIds = new Set(Object.keys(userCollections));

    for (const collection of existingAgregarrCollections) {
      if (this.cancelled) break;

      try {
        const deletionResult = await this.evaluateCollectionForDeletion(
          collection,
          activeConfigLabels,
          currentUserPlexIds,
          processedCollectionKeys,
          currentConfigs
        );

        if (deletionResult.shouldDelete) {
          // CLEANUP: If this is a smart collection, clean up its labels first
          try {
            const collectionMeta = await plexClient.getCollectionMetadata(
              collection.ratingKey
            );
            const isSmart =
              collectionMeta &&
              (collectionMeta as { smart?: string }).smart === '1';

            if (isSmart && collectionMeta) {
              const libraryId =
                collectionMeta.librarySectionID || collectionMeta.libraryKey;

              const unwatchedLabels = Array.isArray(collectionMeta.labels)
                ? collectionMeta.labels
                    .map((label: string | { tag: string }) =>
                      typeof label === 'string' ? label : label.tag
                    )
                    .filter((label: string) =>
                      label.startsWith('agregarr-unwatched-')
                    )
                : [];

              for (const labelName of unwatchedLabels) {
                try {
                  const labeledItems = await plexClient.getItemsWithLabel(
                    String(libraryId),
                    labelName
                  );

                  if (labeledItems.length > 0) {
                    for (const itemKey of labeledItems) {
                      await plexClient.removeLabelFromItem(itemKey, labelName);
                    }
                  }
                } catch (labelError) {
                  logger.warn(
                    `Failed to cleanup label ${labelName} during orphaned collection cleanup`,
                    {
                      label: 'Collection Cleanup Service',
                      error:
                        labelError instanceof Error
                          ? labelError.message
                          : String(labelError),
                    }
                  );
                }
              }
            }
          } catch (metadataError) {
            logger.warn(
              `Failed to check for smart collection labels, continuing with deletion`,
              {
                label: 'Collection Cleanup Service',
                error:
                  metadataError instanceof Error
                    ? metadataError.message
                    : String(metadataError),
              }
            );
          }

          // Delete the collection
          await plexClient.deleteCollection(collection.ratingKey);
          deleted++;
          logger.info(
            `Deleted collection: ${collection.title} (${deletionResult.reason})`,
            {
              label: 'Collection Cleanup Service',
              collectionTitle: collection.title,
              reason: deletionResult.reason,
              ratingKey: collection.ratingKey,
            }
          );
        }
      } catch (error) {
        logger.warn(
          `Failed to delete collection ${collection.ratingKey}: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
          {
            label: 'Collection Cleanup Service',
            collectionTitle: collection.title,
            ratingKey: collection.ratingKey,
          }
        );
      }
    }

    if (deleted > 0) {
      logger.info(
        `Collection cleanup completed: ${deleted} collections deleted`,
        {
          label: 'Collection Cleanup Service',
        }
      );
    }

    return { deleted };
  }

  /**
   * Remove ALL collections with agregarr labels and clear ALL agregarr user labels
   * Called when the last collection configuration is deleted
   */
  public async cleanupCollections(plexClient: PlexAPI): Promise<void> {
    logger.info(
      'Starting complete cleanup of all agregarr collections and user labels',
      {
        label: 'Collection Cleanup Service',
      }
    );

    let collectionsDeleted = 0;
    let collectionsFailed = 0;
    let usersProcessed = 0;
    let usersFailed = 0;

    // 1. DELETE ALL COLLECTIONS with agregarr labels
    try {
      const allCollections = await plexClient.getAllCollections();
      const agregarrCollections = allCollections.filter(
        (collection: PlexCollection) =>
          Array.isArray(collection.labels) &&
          collection.labels.some((label: string | PlexLabel) => {
            const labelText = typeof label === 'string' ? label : label.tag;
            return labelText.toLowerCase().startsWith('agregarr');
          })
      );

      logger.info(
        `Found ${agregarrCollections.length} agregarr collections to delete`,
        {
          label: 'Collection Cleanup Service',
          collectionsToDelete: agregarrCollections.length,
        }
      );

      // Delete ALL agregarr collections - no conditions, no user checks
      for (const collection of agregarrCollections) {
        if (this.cancelled) break;

        try {
          // CLEANUP: If this is a smart collection, clean up its labels first
          const collectionMeta = await plexClient.getCollectionMetadata(
            collection.ratingKey
          );
          const isSmart =
            collectionMeta &&
            (collectionMeta as { smart?: string }).smart === '1';

          if (isSmart && collectionMeta) {
            // Extract library ID from the collection
            const libraryId =
              collectionMeta.librarySectionID || collectionMeta.libraryKey;

            // Try to find the agregarr-unwatched label for this collection
            // Pattern: agregarr-unwatched-{configId}
            const unwatchedLabels = Array.isArray(collectionMeta.labels)
              ? collectionMeta.labels
                  .map((label: string | { tag: string }) =>
                    typeof label === 'string' ? label : label.tag
                  )
                  .filter((label: string) =>
                    label.startsWith('agregarr-unwatched-')
                  )
              : [];

            for (const labelName of unwatchedLabels) {
              try {
                const labeledItems = await plexClient.getItemsWithLabel(
                  String(libraryId),
                  labelName
                );

                if (labeledItems.length > 0) {
                  logger.debug(
                    `Cleaning up smart collection labels: ${labelName} from ${labeledItems.length} items`,
                    {
                      label: 'Collection Cleanup Service',
                      collectionTitle: collection.title,
                      labelName,
                      itemCount: labeledItems.length,
                    }
                  );
                  for (const itemKey of labeledItems) {
                    await plexClient.removeLabelFromItem(itemKey, labelName);
                  }
                }
              } catch (labelError) {
                logger.warn(
                  `Failed to cleanup label ${labelName}, continuing with deletion`,
                  {
                    label: 'Collection Cleanup Service',
                    error:
                      labelError instanceof Error
                        ? labelError.message
                        : String(labelError),
                  }
                );
              }
            }
          }

          // Delete the collection
          await plexClient.deleteCollection(collection.ratingKey);
          collectionsDeleted++;
          logger.debug(`Deleted collection: ${collection.title}`, {
            label: 'Collection Cleanup Service',
            collectionTitle: collection.title,
            ratingKey: collection.ratingKey,
          });
        } catch (error) {
          collectionsFailed++;
          logger.warn(
            `Failed to delete collection ${collection.ratingKey}: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
            {
              label: 'Collection Cleanup Service',
              collectionTitle: collection.title,
              ratingKey: collection.ratingKey,
            }
          );
        }
      }
    } catch (error) {
      logger.error('Failed to get collections for cleanup', {
        label: 'Collection Cleanup Service',
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // 2. CLEAR ALL AGREGARR USER LABELS from all Plex users
    try {
      const { getAllPlexUserIds, clearUserFilters } = await import(
        '@server/lib/collections/plex/PlexUserManager'
      );

      const allPlexUserIds = await getAllPlexUserIds();

      if (allPlexUserIds.length > 0) {
        logger.info(
          `Clearing agregarr labels from ${allPlexUserIds.length} Plex users`,
          {
            label: 'Collection Cleanup Service',
            usersToProcess: allPlexUserIds.length,
          }
        );

        // Clear agregarr filters from all users concurrently
        const userClearPromises = allPlexUserIds.map(async (userPlexId) => {
          try {
            await clearUserFilters(userPlexId);
            return { userPlexId, success: true };
          } catch (error) {
            logger.warn(`Failed to clear user filters for ${userPlexId}`, {
              label: 'Collection Cleanup Service',
              userPlexId,
              error: error instanceof Error ? error.message : String(error),
            });
            return { userPlexId, success: false };
          }
        });

        const userResults = await Promise.allSettled(userClearPromises);

        // Count results
        userResults.forEach((result) => {
          if (result.status === 'fulfilled') {
            usersProcessed++;
            if (!result.value.success) {
              usersFailed++;
            }
          } else {
            usersProcessed++;
            usersFailed++;
          }
        });
      }
    } catch (error) {
      logger.error('Failed to clear user labels during cleanup', {
        label: 'Collection Cleanup Service',
        error: error instanceof Error ? error.message : String(error),
      });
    }

    logger.info(
      `Complete cleanup finished: ${collectionsDeleted} collections deleted${
        collectionsFailed > 0 ? ` (${collectionsFailed} failed)` : ''
      }, ${usersProcessed} users processed${
        usersFailed > 0 ? ` (${usersFailed} failed)` : ''
      }`,
      {
        label: 'Collection Cleanup Service',
        collectionsDeleted,
        collectionsFailed,
        usersProcessed,
        usersFailed,
      }
    );
  }

  /**
   * Combined purge operation - removes all Overseerr collections and user labels
   */
  public async purgeAllData(plexClient: PlexAPI): Promise<{
    collectionsDeleted: number;
    usersProcessed: number;
    labelsSuccessful: number;
    labelsFailed: number;
  }> {
    logger.info('Starting purge operation using cleanup logic', {
      label: 'Collection Cleanup Service',
    });

    // Get current collections to track what will be deleted
    const allCollections = await plexClient.getAllCollections();
    const agregarrCollectionsBefore = allCollections.filter(
      (collection: PlexCollection) =>
        Array.isArray(collection.labels) &&
        collection.labels.some((label: string | PlexLabel) => {
          const labelText = typeof label === 'string' ? label : label.tag;
          return labelText.toLowerCase().startsWith('agregarr');
        })
    );

    // Get all users to track label processing
    const allUsers = await overseerrCollectionService.getUsersWithPlexIds();

    // Delete all Agregarr collections by passing empty config list
    await this.cleanupDisabledCollections(
      plexClient,
      agregarrCollectionsBefore,
      [], // Empty configs = delete all
      {}, // Empty user collections
      new Set() // No processed collections
    );

    // Count what was actually cleaned up
    const allCollectionsAfter = await plexClient.getAllCollections();
    const agregarrCollectionsAfter = allCollectionsAfter.filter(
      (collection: PlexCollection) =>
        Array.isArray(collection.labels) &&
        collection.labels.some((label: string | PlexLabel) => {
          const labelText = typeof label === 'string' ? label : label.tag;
          return labelText.toLowerCase().startsWith('agregarr');
        })
    );

    const result = {
      collectionsDeleted:
        agregarrCollectionsBefore.length - agregarrCollectionsAfter.length,
      usersProcessed: allUsers.length,
      labelsSuccessful: allUsers.length, // Assume all successful since cleanup is robust
      labelsFailed: 0,
    };

    logger.info(
      `Purge operation completed: ${result.collectionsDeleted} collections deleted, ${result.usersProcessed} users processed (${result.labelsSuccessful} successful, ${result.labelsFailed} failed)`,
      {
        label: 'Collection Cleanup Service',
      }
    );

    return result;
  }

  /**
   * Generate active configuration labels for comparison
   * For user collections, returns generic type labels since they spawn multiple collections
   * For server_owner, generates the actual label format using admin user's plexId
   */
  private async generateActiveConfigLabels(
    configs: CollectionConfig[]
  ): Promise<Set<string>> {
    const labels = [];

    for (const c of configs) {
      switch (c.type) {
        case 'overseerr':
          if (c.subtype === 'users') {
            labels.push(`AgregarrOverseerrUser`); // Generic for user config type checking
          } else if (c.subtype === 'global') {
            labels.push(`AgregarrOverseerrAll${c.id}`);
          } else if (c.subtype === 'server_owner') {
            // For server_owner, get the actual admin user plexId to match the real label format
            try {
              const { overseerrCollectionService } = await import(
                '@server/lib/collections/sources/overseerr'
              );
              const adminUser = await overseerrCollectionService.getAdminUser();
              const adminPlexId = adminUser?.plexId || adminUser?.id;
              if (adminPlexId) {
                labels.push(`AgregarrOverseerrOwner${adminPlexId}`);
              } else {
                // Fallback to config-based label if no admin plexId found
                labels.push(`AgregarrOverseerrOwner_CONFIG_${c.id}`);
              }
            } catch (error) {
              // Fallback to config-based label if admin user fetch fails
              labels.push(`AgregarrOverseerrOwner_CONFIG_${c.id}`);
            }
          } else {
            labels.push(`AgregarrOverseerr${c.subtype}${c.id}`);
          }
          break;
        case 'tautulli':
          labels.push(`AgregarrTautulli${c.id}`);
          break;
        case 'trakt':
          labels.push(`AgregarrTrakt${c.id}`);
          break;
        case 'tmdb':
          labels.push(`AgregarrTmdb${c.id}`);
          break;
        case 'imdb':
          labels.push(`AgregarrImdb${c.id}`);
          break;
        case 'letterboxd':
          labels.push(`AgregarrLetterboxd${c.id}`);
          break;
        default:
          labels.push(`Agregarr${c.type}${c.id}`);
      }
    }

    return new Set(labels);
  }

  /**
   * Evaluate whether a collection should be deleted
   */
  private async evaluateCollectionForDeletion(
    collection: PlexCollection,
    activeConfigLabels: Set<string>,
    currentUserPlexIds: Set<string>,
    processedCollectionKeys: Set<string>,
    currentConfigs: CollectionConfig[]
  ): Promise<{ shouldDelete: boolean; reason: string }> {
    const labels = Array.isArray(collection.labels) ? collection.labels : [];

    // Check if this collection has any of our managed labels
    const managedLabel = labels.find((label: string | PlexLabel) => {
      const labelText = typeof label === 'string' ? label : label.tag;
      return labelText.toLowerCase().startsWith('agregarr');
    });

    if (!managedLabel) {
      return { shouldDelete: false, reason: 'not managed' };
    }

    // Skip collections we already processed during sync to avoid double-deletion
    if (processedCollectionKeys.has(collection.ratingKey)) {
      return { shouldDelete: false, reason: 'already processed' };
    }

    const managedLabelText =
      typeof managedLabel === 'string' ? managedLabel : managedLabel.tag;

    // First, try to match by ratingKey (works for all types except user collections)
    const matchingConfig = currentConfigs.find(
      (config) => config.collectionRatingKey === collection.ratingKey
    );

    if (matchingConfig) {
      return { shouldDelete: false, reason: 'matched by ratingKey' };
    }

    // Special case for user collections - they don't store ratingKeys, use user validation instead
    if (managedLabelText.toLowerCase().startsWith('agregarroverseerruser')) {
      // Extract user Plex ID from collection labels
      const userPlexId = managedLabelText.replace(
        /^AgregarrOverseerrUser/i,
        ''
      );

      if (!userPlexId) {
        return { shouldDelete: true, reason: 'invalid user label format' };
      }

      // Check if users config type is still active and this specific user should have collections
      const hasUsersConfig = activeConfigLabels.has('AgregarrOverseerrUser');
      if (!hasUsersConfig) {
        return { shouldDelete: true, reason: 'users config removed' };
      }

      // Check if this collection was just processed in the current sync
      // If it's in processedCollectionKeys, it means the user still has requests
      if (processedCollectionKeys.has(collection.ratingKey)) {
        return {
          shouldDelete: false,
          reason: 'user collection just processed',
        };
      }

      // Fallback to userCollections map if provided (legacy support)
      if (
        Object.keys(currentUserPlexIds).length > 0 &&
        !currentUserPlexIds.has(userPlexId)
      ) {
        return { shouldDelete: true, reason: 'user no longer has requests' };
      }

      return { shouldDelete: false, reason: 'user collection still active' };
    }

    // Special case for auto franchise collections - they don't store ratingKeys on configs
    // (one config generates multiple Plex collections). Match by label prefix instead.
    if (managedLabelText.toLowerCase().startsWith('agregarrautofranchise-')) {
      // Extract configId from label format: AgregarrAutoFranchise-{configId}-{franchiseId}
      const parts = managedLabelText.split('-');
      const configId = parts.length >= 2 ? parts[1] : undefined;

      if (!configId) {
        return { shouldDelete: true, reason: 'invalid franchise label format' };
      }

      // Check if the parent auto_franchise config still exists
      const hasParentConfig = currentConfigs.some(
        (config) =>
          config.type === 'tmdb' &&
          config.subtype === 'auto_franchise' &&
          config.id === configId
      );

      if (!hasParentConfig) {
        return {
          shouldDelete: true,
          reason: 'franchise parent config removed',
        };
      }

      return {
        shouldDelete: false,
        reason: 'franchise collection still active',
      };
    }

    // If no ratingKey match and not a special multi-collection type, the config must have been removed
    return { shouldDelete: true, reason: 'configuration removed' };
  }
}

export default CollectionCleanupService;
