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

  // Progress tracking
  private currentStage = '';
  private totalCollections = 0;
  private processedCollections = 0;

  public get status() {
    return {
      running: this.running,
      cancelled: this.cancelled,
      currentStage: this.currentStage,
      totalCollections: this.totalCollections,
      processedCollections: this.processedCollections,
      progress:
        this.totalCollections > 0
          ? Math.round(
              (this.processedCollections / this.totalCollections) * 100
            )
          : 0,
    };
  }

  public setStage(stage: string, total = 0, processed = 0): void {
    this.currentStage = stage;
    this.totalCollections = total;
    this.processedCollections = processed;
    logger.debug(
      `Sync stage: ${stage}${total > 0 ? ` (${processed}/${total})` : ''}`,
      {
        label: 'Collections Sync',
        stage,
        total,
        processed,
      }
    );
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
    // Check if discovery is running to prevent race conditions
    const { discoveryService } = await import(
      '@server/lib/collections/services/DiscoveryService'
    );
    if (discoveryService.status.running) {
      throw new Error(
        'Discovery is currently running. Please wait for discovery to complete before starting sync.'
      );
    }

    // Set running state immediately for UI feedback
    this.running = true;
    this.cancelled = false;
    this.setStage('Starting sync...');

    const settings = getSettings();

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

    const startTime = Date.now();

    try {
      // Initialize Plex client
      this.setStage('Connecting to Plex server...');
      const plexClient = await this.getPlexClient();

      // Test connection
      const isConnected = await plexClient.getStatus();
      if (!isConnected) {
        throw new Error('Could not connect to Plex server');
      }

      // Refresh external service data for template variables
      this.setStage('Refreshing external data...');
      await this.refreshExternalData(plexClient);

      // Get collection count for progress tracking - only count actual agregarr collections
      const settings = getSettings();
      const agregarrCollections = settings.plex.collectionConfigs || [];
      this.setStage('Processing collections...', agregarrCollections.length, 0);

      // Perform the sync operations using our new service
      const syncResult = await collectionSyncService.syncAllConfigurations(
        plexClient,
        (processed: number, currentAction?: string) => {
          if (currentAction) {
            // Show detailed action for current collection
            this.setStage(currentAction, agregarrCollections.length, processed);
          } else {
            // Show general progress
            this.setStage(
              'Processing collections...',
              agregarrCollections.length,
              processed
            );
          }
        }
      );

      // Sync hub visibility settings
      this.setStage('Syncing hub visibility settings...');
      const { HubSyncService } = await import(
        './collections/plex/HubSyncService'
      );
      const hubSyncService = new HubSyncService();
      await hubSyncService.syncHubVisibility(plexClient, (stage: string) => {
        this.setStage(stage);
      });

      // Sync pre-existing collection sortTitles based on promotion status
      this.setStage('Updating collection sort titles...');
      await hubSyncService.syncPreExistingCollectionSortTitles(plexClient);

      // Sync unified ordering (collections + hubs)
      this.setStage('Applying collection ordering to Plex...');
      await hubSyncService.syncUnifiedOrdering(plexClient, (stage: string) => {
        this.setStage(stage);
      });

      // Clean up orphaned collections after sync completes
      this.setStage('Cleaning up orphaned collections...');
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

      // Mark global sync as completed successfully
      this.setStage('Sync completed successfully');
      settings.setGlobalSyncComplete();
    } catch (error) {
      const errorMessage = extractErrorMessage(error);
      logger.error(`Collections sync failed: ${errorMessage}.`, {
        label: 'Collections Sync',
      });

      // Mark global sync error
      settings.setGlobalSyncError(errorMessage);
    } finally {
      this.running = false;
      this.cancelled = false;
      // Reset progress tracking
      this.currentStage = '';
      this.totalCollections = 0;
      this.processedCollections = 0;
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
