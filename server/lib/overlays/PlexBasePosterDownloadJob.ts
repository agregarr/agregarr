import PlexAPI from '@server/api/plexapi';
import { getRepository } from '@server/datasource';
import { OverlayLibraryConfig } from '@server/entity/OverlayLibraryConfig';
import logger from '@server/logger';
import { plexBasePosterManager } from './PlexBasePosterManager';

class PlexBasePosterDownloadJob {
  public running = false;
  private cancelled = false;

  // Progress tracking per library
  private libraryProgress: {
    [libraryId: string]: {
      libraryName: string;
      current: number;
      total: number;
      failed: number;
    };
  } = {};

  public get status() {
    const libraries = Object.values(this.libraryProgress);
    const totalCurrent = libraries.reduce((sum, lib) => sum + lib.current, 0);
    const totalItems = libraries.reduce((sum, lib) => sum + lib.total, 0);
    const totalFailed = libraries.reduce((sum, lib) => sum + lib.failed, 0);

    return {
      running: this.running,
      cancelled: this.cancelled,
      libraries: this.libraryProgress,
      overallProgress: {
        current: totalCurrent,
        total: totalItems,
        failed: totalFailed,
        percentage:
          totalItems > 0 ? Math.round((totalCurrent / totalItems) * 100) : 0,
      },
    };
  }

  public cancel(): void {
    this.cancelled = true;
    logger.info('Base poster download job cancellation requested', {
      label: 'PlexBasePosterDownloadJob',
    });
  }

  public async run(): Promise<void> {
    if (this.running) {
      logger.warn('Base poster download job already running', {
        label: 'PlexBasePosterDownloadJob',
      });
      return;
    }

    this.running = true;
    this.cancelled = false;
    this.libraryProgress = {};

    try {
      logger.info('Starting base poster download job', {
        label: 'PlexBasePosterDownloadJob',
      });

      // Get admin user
      const { getAdminUser } = await import(
        '@server/lib/collections/core/CollectionUtilities'
      );
      const admin = await getAdminUser();
      if (!admin) {
        throw new Error('No admin user found');
      }

      const plexApi = new PlexAPI({ plexToken: admin.plexToken });

      // Get all library configs
      const configRepository = getRepository(OverlayLibraryConfig);
      const configs = await configRepository.find();

      if (configs.length === 0) {
        logger.info('No library configurations found', {
          label: 'PlexBasePosterDownloadJob',
        });
        return;
      }

      // Move orphaned files before downloading new ones
      logger.info('Checking for orphaned base posters', {
        label: 'PlexBasePosterDownloadJob',
      });

      const orphanCount = await plexBasePosterManager.moveOrphanedPosters(
        plexApi,
        configs.map((c) => c.libraryId)
      );

      if (orphanCount > 0) {
        logger.info('Moved orphaned base posters', {
          label: 'PlexBasePosterDownloadJob',
          orphanCount,
        });
      }

      // Download posters for each library
      for (const config of configs) {
        if (this.cancelled) {
          logger.info('Base poster download job cancelled', {
            label: 'PlexBasePosterDownloadJob',
          });
          break;
        }

        logger.info('Downloading base posters for library', {
          label: 'PlexBasePosterDownloadJob',
          libraryId: config.libraryId,
          libraryName: config.libraryName,
        });

        // Initialize progress tracking
        this.libraryProgress[config.libraryId] = {
          libraryName: config.libraryName,
          current: 0,
          total: 0,
          failed: 0,
        };

        try {
          const result =
            await plexBasePosterManager.downloadAllBasePosterForLibrary(
              plexApi,
              config.libraryId,
              (current, total, failed) => {
                this.libraryProgress[config.libraryId] = {
                  libraryName: config.libraryName,
                  current,
                  total,
                  failed,
                };
              }
            );

          logger.info('Completed library base poster download', {
            label: 'PlexBasePosterDownloadJob',
            libraryId: config.libraryId,
            libraryName: config.libraryName,
            success: result.success,
            failed: result.failed,
          });
        } catch (error) {
          logger.error('Failed to download base posters for library', {
            label: 'PlexBasePosterDownloadJob',
            libraryId: config.libraryId,
            libraryName: config.libraryName,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      logger.info('Base poster download job completed', {
        label: 'PlexBasePosterDownloadJob',
      });
    } catch (error) {
      logger.error('Base poster download job failed', {
        label: 'PlexBasePosterDownloadJob',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      this.running = false;
      this.cancelled = false;
    }
  }
}

export const plexBasePosterDownloadJob = new PlexBasePosterDownloadJob();
