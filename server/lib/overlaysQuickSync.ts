import PlexAPI, { type PlexLibraryItem } from '@server/api/plexapi';
import { getRepository } from '@server/datasource';
import { MediaItemMetadata } from '@server/entity/MediaItemMetadata';
import { OverlayLibraryConfig } from '@server/entity/OverlayLibraryConfig';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

/**
 * Overlays Quick Sync Job
 * Efficiently applies overlays to recently added items without full library scan
 *
 * Process:
 * 1. Get items recently added to Plex (since last run)
 * 2. Filter to items NOT in MediaItemMetadata (haven't had overlays applied)
 * 3. Apply overlays using existing overlay service
 * 4. Update last run timestamp
 */
class OverlaysQuickSync {
  public running = false;
  private cancelled = false;
  private currentStage = '';

  /**
   * Get current status for UI display
   */
  public get status() {
    return {
      running: this.running,
      cancelled: this.cancelled,
      currentStage: this.currentStage,
    };
  }

  /**
   * Cancel the currently running job
   */
  public cancel(): void {
    this.cancelled = true;
    logger.info('Overlays Quick Sync cancellation requested', {
      label: 'Overlays Quick Sync',
    });
  }

  /**
   * Set current stage for progress tracking
   */
  private setStage(stage: string): void {
    this.currentStage = stage;
    logger.debug(stage, { label: 'Overlays Quick Sync' });
  }

  /**
   * Get Plex client with admin token
   */
  private async getPlexClient(): Promise<PlexAPI> {
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
   * Main job execution
   */
  public async run(): Promise<void> {
    if (this.running) {
      logger.warn('Overlays Quick Sync is already running', {
        label: 'Overlays Quick Sync',
      });
      return;
    }

    this.running = true;
    this.cancelled = false;
    this.currentStage = '';

    const startTime = Date.now();
    let librariesProcessed = 0;
    let itemsProcessed = 0;

    try {
      logger.info('Starting Overlays Quick Sync', {
        label: 'Overlays Quick Sync',
      });

      // Safety check: don't run if base poster download is in progress
      const { plexBasePosterDownloadJob } = await import(
        '@server/lib/overlays/PlexBasePosterDownloadJob'
      );
      if (plexBasePosterDownloadJob.running) {
        logger.info(
          'Base poster download is currently running, skipping Overlays Quick Sync',
          {
            label: 'Overlays Quick Sync',
          }
        );
        return;
      }

      // Skip if full overlay application is running to prevent conflicts
      const overlayApplication = (
        await import('@server/lib/overlayApplication')
      ).default;
      if (overlayApplication.status.running) {
        logger.info(
          'Full Overlay Application is currently running, skipping Quick Sync',
          {
            label: 'Overlays Quick Sync',
          }
        );
        return;
      }

      // Get last run timestamp (or default to 24 hours ago)
      const settings = getSettings();
      const lastRunStr = settings.main.lastOverlaysQuickSyncAt;
      const cutoffTime = lastRunStr
        ? new Date(lastRunStr).getTime()
        : Date.now() - 24 * 60 * 60 * 1000; // 24 hours default

      logger.info('Checking for items added since last run', {
        label: 'Overlays Quick Sync',
        cutoffTime: new Date(cutoffTime).toISOString(),
        isFirstRun: !lastRunStr,
      });

      // Get libraries with overlay configs
      this.setStage('Loading overlay configurations...');
      const configRepository = getRepository(OverlayLibraryConfig);
      const configs = await configRepository.find();

      // Filter to only configs that have enabled overlays
      const activeConfigs = configs.filter(
        (config) =>
          config.enabledOverlays &&
          config.enabledOverlays.some((o) => o.enabled)
      );

      if (activeConfigs.length === 0) {
        logger.info('No libraries with enabled overlays found', {
          label: 'Overlays Quick Sync',
        });
        return;
      }

      logger.info('Found libraries with overlays configured', {
        label: 'Overlays Quick Sync',
        libraryCount: activeConfigs.length,
      });

      // Get Plex client
      this.setStage('Connecting to Plex...');
      const plexClient = await this.getPlexClient();

      // Test connection
      const isConnected = await plexClient.getStatus();
      if (!isConnected) {
        throw new Error('Could not connect to Plex server');
      }

      // Use settings for library lookups

      // Process each library
      for (const config of activeConfigs) {
        if (this.cancelled) {
          logger.info('Overlays Quick Sync cancelled by user', {
            label: 'Overlays Quick Sync',
          });
          break;
        }

        try {
          const library = settings.plex.libraries.find(
            (l) => l.key === config.libraryId
          );

          if (!library) {
            logger.warn('Library not found for overlay config', {
              label: 'Overlays Quick Sync',
              libraryId: config.libraryId,
              libraryName: config.libraryName,
            });
            continue;
          }

          this.setStage(`Applying overlays to library: ${library.name}...`);

          // Get recently added items
          const mediaType = library.type === 'show' ? 'show' : 'movie';
          const recentItems = await plexClient.getRecentlyAdded(
            library.key,
            { addedAt: cutoffTime },
            mediaType
          );

          if (!recentItems || recentItems.length === 0) {
            logger.debug('No recently added items in library', {
              label: 'Overlays Quick Sync',
              libraryName: library.name,
              libraryKey: library.key,
            });
            continue;
          }

          logger.info('Found recently added items', {
            label: 'Overlays Quick Sync',
            libraryName: library.name,
            itemCount: recentItems.length,
          });

          // Filter to items needing overlays
          const itemsNeedingOverlays = await this.filterNewItems(recentItems);

          if (itemsNeedingOverlays.length === 0) {
            logger.debug('No new items needing overlays', {
              label: 'Overlays Quick Sync',
              libraryName: library.name,
            });
            continue;
          }

          logger.info('Applying overlays to new items', {
            label: 'Overlays Quick Sync',
            libraryName: library.name,
            itemCount: itemsNeedingOverlays.length,
          });

          // Apply overlays using existing service
          const { overlayLibraryService } = await import(
            '@server/lib/overlays/OverlayLibraryService'
          );

          await overlayLibraryService.applyOverlaysToCollectionItems(
            itemsNeedingOverlays,
            library.key
          );

          librariesProcessed++;
          itemsProcessed += itemsNeedingOverlays.length;
        } catch (error) {
          logger.error('Failed to apply overlays to library', {
            label: 'Overlays Quick Sync',
            libraryId: config.libraryId,
            libraryName: config.libraryName,
            error: error instanceof Error ? error.message : String(error),
          });
          // Continue with next library
        }
      }

      // Update last run timestamp
      settings.main.lastOverlaysQuickSyncAt = new Date().toISOString();
      settings.save();

      const duration = Date.now() - startTime;
      logger.info('Overlays Quick Sync completed', {
        label: 'Overlays Quick Sync',
        duration: `${Math.round(duration / 1000)}s`,
        librariesProcessed,
        itemsProcessed,
      });

      this.setStage('Quick sync completed');
    } catch (error) {
      logger.error('Overlays Quick Sync failed', {
        label: 'Overlays Quick Sync',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      this.running = false;
      this.cancelled = false;
      this.currentStage = '';
    }
  }

  /**
   * Filter recent items to only those NOT in MediaItemMetadata
   * These are items that haven't had overlays applied yet
   */
  private async filterNewItems(items: PlexLibraryItem[]): Promise<string[]> {
    const repository = getRepository(MediaItemMetadata);
    const ratingKeys = items.map((item) => item.ratingKey);

    // Batch query for existing metadata
    const existing = await repository
      .createQueryBuilder()
      .select('plexItemRatingKey')
      .where('plexItemRatingKey IN (:...ratingKeys)', { ratingKeys })
      .getMany();

    const existingKeys = new Set(existing.map((e) => e.plexItemRatingKey));

    // Return items NOT in metadata (need overlays)
    const newItems = items
      .filter((item) => !existingKeys.has(item.ratingKey))
      .map((item) => item.ratingKey);

    logger.debug('Filtered items for overlay application', {
      label: 'Overlays Quick Sync',
      totalItems: items.length,
      existingItems: existingKeys.size,
      newItems: newItems.length,
    });

    return newItems;
  }
}

// Export singleton instance
const overlaysQuickSync = new OverlaysQuickSync();
export default overlaysQuickSync;
