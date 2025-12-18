import { getRepository } from '@server/datasource';
import { OverlayLibraryConfig } from '@server/entity/OverlayLibraryConfig';
import logger from '@server/logger';

/**
 * Job for applying overlay templates to configured Plex libraries
 */
class OverlayApplication {
  public running = false;
  private cancelled = false;

  // Progress tracking
  private currentStage = '';
  private totalLibraries = 0;
  private processedLibraries = 0;

  public get status() {
    return {
      running: this.running,
      cancelled: this.cancelled,
      currentStage: this.currentStage,
      totalLibraries: this.totalLibraries,
      processedLibraries: this.processedLibraries,
      progress:
        this.totalLibraries > 0
          ? Math.round((this.processedLibraries / this.totalLibraries) * 100)
          : 0,
    };
  }

  private setStage(stage: string): void {
    this.currentStage = stage;
    logger.info(stage, { label: 'Overlay Application' });
  }

  private updateProgress(processed: number, total: number): void {
    this.processedLibraries = processed;
    this.totalLibraries = total;
    logger.info(
      `Overlay application progress: ${processed}/${total} libraries`,
      {
        label: 'Overlay Application',
        processed,
        total,
        progress: Math.round((processed / total) * 100),
      }
    );
  }

  public cancel(): void {
    this.cancelled = true;
    logger.info('Overlay application cancellation requested', {
      label: 'Overlay Application',
    });
  }

  public async run(): Promise<void> {
    if (this.running) {
      logger.warn('Overlay application is already running', {
        label: 'Overlay Application',
      });
      return;
    }

    // Safety check: don't run if base poster download is in progress
    const { plexBasePosterDownloadJob } = await import(
      '@server/lib/overlays/PlexBasePosterDownloadJob'
    );
    if (plexBasePosterDownloadJob.running) {
      throw new Error(
        'Cannot run overlay application while base posters are being downloaded. ' +
          'Please wait for the download to complete.'
      );
    }

    // Wait for Overlays Quick Sync to complete if running
    const overlaysQuickSync = (await import('@server/lib/overlaysQuickSync'))
      .default;
    if (overlaysQuickSync.status.running) {
      logger.info(
        'Overlays Quick Sync is currently running, waiting for completion...',
        {
          label: 'Overlay Application',
        }
      );
      while (overlaysQuickSync.status.running) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    // Wait for any per-library overlay syncs to complete
    const { overlayLibraryService } = await import(
      '@server/lib/overlays/OverlayLibraryService'
    );
    let runningLibraries = overlayLibraryService.getAllRunningLibraries();
    if (runningLibraries.length > 0) {
      logger.info(
        'Per-library overlay syncs are currently running, waiting for completion...',
        {
          label: 'Overlay Application',
          runningLibraries: runningLibraries.map((l) => l.libraryName),
        }
      );
      while (runningLibraries.length > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        runningLibraries = overlayLibraryService.getAllRunningLibraries();
      }
      logger.info('Per-library overlay syncs completed, starting full sync', {
        label: 'Overlay Application',
      });
    }

    this.running = true;
    this.cancelled = false;
    this.currentStage = '';
    this.totalLibraries = 0;
    this.processedLibraries = 0;

    try {
      logger.info('Starting overlay application job', {
        label: 'Overlay Application',
      });

      this.setStage('Loading library configurations...');

      // Get all library configurations with enabled overlays
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
          label: 'Overlay Application',
        });
        return;
      }

      this.totalLibraries = activeConfigs.length;
      logger.info('Found libraries with overlays configured', {
        label: 'Overlay Application',
        libraryCount: activeConfigs.length,
      });

      // Process each library
      let processed = 0;

      for (const config of activeConfigs) {
        if (this.cancelled) {
          logger.info('Overlay application cancelled by user', {
            label: 'Overlay Application',
          });
          break;
        }

        try {
          this.setStage(
            `Applying overlays to library: ${config.libraryName}...`
          );

          await overlayLibraryService.applyOverlaysToLibrary(
            config.libraryId,
            () => this.cancelled
          );

          processed++;
          this.updateProgress(processed, this.totalLibraries);
        } catch (error) {
          logger.error('Failed to apply overlays to library', {
            label: 'Overlay Application',
            libraryId: config.libraryId,
            libraryName: config.libraryName,
            error: error instanceof Error ? error.message : String(error),
          });
          // Continue with next library even if one fails
          processed++;
          this.updateProgress(processed, this.totalLibraries);
        }
      }

      if (this.cancelled) {
        logger.info('Overlay application job cancelled', {
          label: 'Overlay Application',
          processedLibraries: processed,
          totalLibraries: this.totalLibraries,
        });
      } else {
        logger.info('Overlay application job completed', {
          label: 'Overlay Application',
          processedLibraries: processed,
          totalLibraries: this.totalLibraries,
        });
      }
    } catch (error) {
      logger.error('Overlay application job failed', {
        label: 'Overlay Application',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      this.running = false;
      this.cancelled = false;
      this.currentStage = '';
    }
  }
}

const overlayApplication = new OverlayApplication();
export default overlayApplication;
