import PlexAPI from '@server/api/plexapi';
import { extractErrorMessage } from '@server/lib/collections/core/CollectionUtilities';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { CollectionCleanupService } from './collections/services/CollectionCleanupService';
import { collectionSyncService } from './collections/services/CollectionSyncService';

// MAIN COLLECTIONS SYNC SERVICE

class CollectionsSync {
  public running = false;
  private cancelled = false;
  private cleanupService = new CollectionCleanupService();

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
   * Initialize a Plex client with admin token and current settings
   * Uses local admin user for Plex token (direct Plex integration)
   * @returns PlexAPI instance configured with admin token
   * @throws Error if admin user or token not found
   */
  private async getPlexClient(): Promise<PlexAPI> {
    // Get Plex token from LOCAL admin user (not external Overseerr)
    const { getAdminUser } = await import(
      '@server/lib/collections/core/CollectionUtilities'
    );
    const localAdmin = await getAdminUser();

    if (!localAdmin?.plexToken) {
      throw new Error('No local admin Plex token found');
    }

    const settings = getSettings().load();
    return new PlexAPI({
      plexToken: localAdmin.plexToken,
      plexSettings: settings.plex,
    });
  }

  /**
   * Refresh external service data for template variables
   * Updates admin Plex info and external Overseerr settings
   */
  private async refreshExternalData(plexClient: PlexAPI): Promise<void> {
    const settings = getSettings();

    try {
      // Refresh admin Plex user info if we have an admin
      const { getAdminUser } = await import(
        '@server/lib/collections/core/CollectionUtilities'
      );
      const localAdmin = await getAdminUser();

      if (localAdmin?.plexId && localAdmin.plexToken) {
        try {
          const plexTitle = await plexClient.getPlexUserTitle(
            localAdmin.plexId.toString()
          );
          if (plexTitle) {
            settings.updateAdminPlexInfo(
              localAdmin.plexUsername || undefined,
              plexTitle
            );
            logger.debug('Refreshed admin Plex info for template variables', {
              label: 'Collections Sync',
              username: localAdmin.plexUsername,
              title: plexTitle,
            });
          }
        } catch (error) {
          logger.warn('Failed to refresh admin Plex user info', {
            label: 'Collections Sync',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Refresh external Overseerr settings if configured
      if (settings.overseerr?.hostname && settings.overseerr?.apiKey) {
        try {
          const { overseerrCollectionService } = await import(
            '@server/lib/collections/external/overseerr'
          );
          const overseerrSettings =
            await overseerrCollectionService.getOverseerrSettings();

          if (overseerrSettings) {
            settings.updateExternalOverseerrInfo(
              overseerrSettings.applicationUrl,
              overseerrSettings.applicationTitle
            );
            logger.debug(
              'Refreshed external Overseerr settings for template variables',
              {
                label: 'Collections Sync',
                applicationTitle: overseerrSettings.applicationTitle,
                applicationUrl: overseerrSettings.applicationUrl,
              }
            );
          }
        } catch (error) {
          logger.warn('Failed to refresh external Overseerr settings', {
            label: 'Collections Sync',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch (error) {
      logger.warn('Failed to refresh external data for template variables', {
        label: 'Collections Sync',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  public async run(): Promise<void> {
    const settings = getSettings();

    // Check collection configs and process any that exist

    if (this.running) {
      logger.info(
        'Collections sync already running - cancelling current sync and starting fresh',
        {
          label: 'Collections Sync',
        }
      );

      // Cancel current sync and wait a moment for it to finish current user
      this.cancel();

      // Wait for current sync to finish gracefully
      let waitCount = 0;
      while (this.running && waitCount < 50) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        waitCount++;
      }

      if (this.running) {
        logger.warn('Previous sync did not stop gracefully, forcing restart', {
          label: 'Collections Sync',
        });
        this.running = false;
        this.cancelled = false;
      }
    }

    // Validate Plex configuration
    if (!settings.plex.ip || !settings.plex.machineId) {
      logger.error(
        'Plex server configuration incomplete. Please check Plex settings.',
        { label: 'Collections Sync' }
      );
      return;
    }

    // Get admin user for Plex token
    // Check local admin user for Plex token (not external Overseerr)
    const { getAdminUser } = await import(
      '@server/lib/collections/core/CollectionUtilities'
    );
    const localAdmin = await getAdminUser();

    if (!localAdmin?.plexToken) {
      logger.warn(
        'Collections sync skipped. No local admin Plex token found.',
        {
          label: 'Collections Sync',
        }
      );
      return;
    }

    this.running = true;
    this.cancelled = false;

    const startTime = Date.now();

    try {
      // Initialize Plex client
      const plexClient = await this.getPlexClient();

      // Test connection
      const isConnected = await plexClient.getStatus();
      if (!isConnected) {
        throw new Error('Could not connect to Plex server');
      }

      // Refresh external service data for template variables
      await this.refreshExternalData(plexClient);

      // Perform the sync operations using our new service
      const syncResult = await collectionSyncService.syncAllConfigurations(
        plexClient
      );

      // Sync hub visibility settings
      const { HubSyncService } = await import(
        './collections/plex/HubSyncService'
      );
      const hubSyncService = new HubSyncService();
      await hubSyncService.syncHubVisibility(plexClient);

      // Sync pre-existing collection sortTitles based on promotion status
      await hubSyncService.syncPreExistingCollectionSortTitles(plexClient);

      // Sync unified ordering (collections + hubs)
      await hubSyncService.syncUnifiedOrdering(plexClient);

      // Clean up orphaned collections after sync completes
      logger.info('Starting post-sync cleanup of orphaned collections', {
        label: 'Collections Sync',
      });

      try {
        const settings = getSettings();
        const collectionConfigs = settings.plex.collectionConfigs || [];

        // Get all collections to find agregarr-managed ones
        const allCollections = await plexClient.getAllCollections();
        const agregarrCollections = allCollections.filter(
          (collection) =>
            Array.isArray(collection.labels) &&
            collection.labels.some((label) => {
              const labelText =
                typeof label === 'string'
                  ? label
                  : (label as { tag: string }).tag;
              return labelText.toLowerCase().startsWith('agregarr');
            })
        );

        if (agregarrCollections.length > 0) {
          const cleanupResult =
            await this.cleanupService.cleanupDisabledCollections(
              plexClient,
              agregarrCollections,
              collectionConfigs,
              {}, // userCollections - handled internally by cleanup logic
              syncResult.processedCollectionKeys // Pass the collections that were just processed
            );

          if (cleanupResult.deleted > 0) {
            logger.info(
              `Post-sync cleanup completed: ${cleanupResult.deleted} orphaned collections removed`,
              {
                label: 'Collections Sync',
              }
            );
          } else {
            logger.debug(
              'Post-sync cleanup completed: no orphaned collections found',
              {
                label: 'Collections Sync',
              }
            );
          }
        }
      } catch (error) {
        logger.warn(
          'Post-sync cleanup failed - continuing with sync completion',
          {
            label: 'Collections Sync',
            error: error instanceof Error ? error.message : String(error),
          }
        );
      }

      const duration = Date.now() - startTime;

      logger.info('Collections sync completed successfully', {
        label: 'Collections Sync',
        duration: `${Math.round(duration / 1000)}s`,
        durationMs: duration,
      });
    } catch (error) {
      const errorMessage = extractErrorMessage(error);
      logger.error(`Collections sync failed: ${errorMessage}.`, {
        label: 'Collections Sync',
      });
    } finally {
      this.running = false;
      this.cancelled = false;
    }
  }

  /**
   * Remove collections for items that are no longer requested
   * Delegates to CollectionCleanupService
   */
  public async cleanupCollections(): Promise<void> {
    const plexClient = await this.getPlexClient();
    await this.cleanupService.cleanupCollections(plexClient);
  }

  /**
   * Combined purge operation - removes all collections and user labels
   * Delegates to CollectionCleanupService
   */
  public async purgeAllData(): Promise<{
    collectionsDeleted: number;
    usersProcessed: number;
    labelsSuccessful: number;
    labelsFailed: number;
  }> {
    const plexClient = await this.getPlexClient();
    return await this.cleanupService.purgeAllData(plexClient);
  }
}

// Create single instance and export it
const collectionsSync = new CollectionsSync();
export default collectionsSync;
