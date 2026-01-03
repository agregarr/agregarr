import PlexAPI from '@server/api/plexapi';
import { getRepository } from '@server/datasource';
import { OverlayLibraryConfig } from '@server/entity/OverlayLibraryConfig';
import logger from '@server/logger';
import { sanitizeForFilename } from '@server/utils/fileSystemHelpers';
import fs from 'fs/promises';
import path from 'path';

const BASE_POSTERS_DIR = path.join(
  process.cwd(),
  'config',
  'plex-base-posters'
);

/**
 * Service for managing local poster folder structure
 * Handles folder generation and population from Plex posters
 */
class LocalPosterFolderService {
  public running = false;
  private cancelled = false;

  // Progress tracking per library
  private libraryProgress: {
    [libraryId: string]: {
      libraryName: string;
      current: number;
      total: number;
      failed: number;
      skipped: number; // Items without TMDB ID
    };
  } = {};

  public get status() {
    const libraries = Object.values(this.libraryProgress);
    const totalCurrent = libraries.reduce((sum, lib) => sum + lib.current, 0);
    const totalItems = libraries.reduce((sum, lib) => sum + lib.total, 0);
    const totalFailed = libraries.reduce((sum, lib) => sum + lib.failed, 0);
    const totalSkipped = libraries.reduce((sum, lib) => sum + lib.skipped, 0);

    return {
      running: this.running,
      cancelled: this.cancelled,
      libraries: this.libraryProgress,
      overallProgress: {
        current: totalCurrent,
        total: totalItems,
        failed: totalFailed,
        skipped: totalSkipped,
        percentage:
          totalItems > 0 ? Math.round((totalCurrent / totalItems) * 100) : 0,
      },
    };
  }

  public cancel(): void {
    this.cancelled = true;
    logger.info('Local poster folder operation cancellation requested', {
      label: 'LocalPosterFolderService',
    });
  }

  /**
   * Build local poster folder path (same logic as PlexBasePosterManager)
   */
  private buildLocalPosterPath(
    libraryId: string,
    libraryName: string,
    itemTitle: string,
    itemYear: number | undefined,
    tmdbId: number
  ): string {
    const safeName = sanitizeForFilename(libraryName);
    const safeTitle = sanitizeForFilename(itemTitle);

    const yearPart = itemYear ? ` (${itemYear})` : '';
    const folderName = `${safeTitle}${yearPart} tmdb-${tmdbId}`;

    return path.join(BASE_POSTERS_DIR, `${safeName}-${libraryId}`, folderName);
  }

  /**
   * Extract TMDB ID from item GUIDs
   */
  private extractTmdbId(item: { Guid?: { id: string }[] }): number | null {
    if (!item.Guid) {
      return null;
    }

    const tmdbGuid = item.Guid.find((g) => g.id?.includes('tmdb://'));
    if (!tmdbGuid) {
      return null;
    }

    const match = tmdbGuid.id.match(/tmdb:\/\/(\d+)/);
    if (!match) {
      return null;
    }

    return parseInt(match[1]);
  }

  /**
   * Generate empty folder structure for a single library
   */
  async generateFolderStructureForLibrary(
    plexApi: PlexAPI,
    libraryId: string,
    libraryName: string
  ): Promise {
    logger.info('Generating folder structure for library', {
      label: 'LocalPosterFolderService',
      libraryId,
      libraryName,
    });

    const libraryContents = await plexApi.getLibraryContents(libraryId);
    const items = libraryContents.items;
    const stats = { created: 0, skipped: 0, failed: 0 };

    // Initialize progress tracking
    if (!this.libraryProgress[libraryId]) {
      this.libraryProgress[libraryId] = {
        libraryName,
        current: 0,
        total: items.length,
        failed: 0,
        skipped: 0,
      };
    }

    for (const item of items) {
      if (this.cancelled) {
        logger.info('Folder generation cancelled', {
          label: 'LocalPosterFolderService',
        });
        break;
      }

      const tmdbId = this.extractTmdbId(item);

      if (!tmdbId) {
        logger.debug('No TMDB ID found for item, skipping', {
          label: 'LocalPosterFolderService',
          itemTitle: item.title,
          ratingKey: item.ratingKey,
        });
        stats.skipped++;
        this.libraryProgress[libraryId].skipped++;
        this.libraryProgress[libraryId].current++;
        continue;
      }

      try {
        const folderPath = this.buildLocalPosterPath(
          libraryId,
          libraryName,
          item.title,
          item.year,
          tmdbId
        );

        // Check if folder already exists
        try {
          await fs.access(folderPath);
          // Folder exists, skip
          logger.debug('Folder already exists, skipping', {
            label: 'LocalPosterFolderService',
            folderPath,
          });
          stats.skipped++;
          this.libraryProgress[libraryId].skipped++;
        } catch {
          // Folder doesn't exist, create it
          await fs.mkdir(folderPath, { recursive: true });
          stats.created++;
          logger.debug('Created folder', {
            label: 'LocalPosterFolderService',
            folderPath,
          });
        }
      } catch (error) {
        logger.error('Failed to create folder', {
          label: 'LocalPosterFolderService',
          itemTitle: item.title,
          error: error instanceof Error ? error.message : String(error),
        });
        stats.failed++;
        this.libraryProgress[libraryId].failed++;
      }

      this.libraryProgress[libraryId].current++;
    }

    logger.info('Folder generation complete for library', {
      label: 'LocalPosterFolderService',
      libraryId,
      ...stats,
    });

    return stats;
  }

  /**
   * Generate empty folder structure for all configured libraries
   */
  async generateFolderStructureForAllLibraries(): Promise {
    if (this.running) {
      logger.warn('Folder generation already running', {
        label: 'LocalPosterFolderService',
      });
      return;
    }

    this.running = true;
    this.cancelled = false;
    this.libraryProgress = {};

    try {
      logger.info('Starting folder structure generation for all libraries', {
        label: 'LocalPosterFolderService',
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
          label: 'LocalPosterFolderService',
        });
        return;
      }

      for (const config of configs) {
        if (this.cancelled) {
          break;
        }

        await this.generateFolderStructureForLibrary(
          plexApi,
          config.libraryId,
          config.libraryName
        );
      }

      logger.info('Folder structure generation complete', {
        label: 'LocalPosterFolderService',
        status: this.status.overallProgress,
      });
    } catch (error) {
      logger.error('Folder structure generation failed', {
        label: 'LocalPosterFolderService',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      this.running = false;
    }
  }

  /**
   * Populate local folders with Plex posters for a single library
   */
  async populateFromPlexForLibrary(
    plexApi: PlexAPI,
    libraryId: string,
    libraryName: string
  ): Promise {
    logger.info('Populating folders with Plex posters for library', {
      label: 'LocalPosterFolderService',
      libraryId,
      libraryName,
    });

    const libraryContents = await plexApi.getLibraryContents(libraryId);
    const items = libraryContents.items;
    const stats = { downloaded: 0, skipped: 0, failed: 0 };

    // Initialize progress tracking
    if (!this.libraryProgress[libraryId]) {
      this.libraryProgress[libraryId] = {
        libraryName,
        current: 0,
        total: items.length,
        failed: 0,
        skipped: 0,
      };
    }

    for (const item of items) {
      if (this.cancelled) {
        logger.info('Plex poster population cancelled', {
          label: 'LocalPosterFolderService',
        });
        break;
      }

      const tmdbId = this.extractTmdbId(item);

      if (!tmdbId) {
        logger.debug('No TMDB ID found for item, skipping', {
          label: 'LocalPosterFolderService',
          itemTitle: item.title,
          ratingKey: item.ratingKey,
        });
        stats.skipped++;
        this.libraryProgress[libraryId].skipped++;
        this.libraryProgress[libraryId].current++;
        continue;
      }

      try {
        // Get current poster URL from Plex
        const currentPlexPosterUrl = await plexApi.getCurrentPosterUrl(
          item.ratingKey
        );

        if (!currentPlexPosterUrl) {
          logger.debug('No poster URL for item, skipping', {
            label: 'LocalPosterFolderService',
            itemTitle: item.title,
            ratingKey: item.ratingKey,
          });
          stats.skipped++;
          this.libraryProgress[libraryId].skipped++;
          this.libraryProgress[libraryId].current++;
          continue;
        }

        // Build folder path
        const folderPath = this.buildLocalPosterPath(
          libraryId,
          libraryName,
          item.title,
          item.year,
          tmdbId
        );

        // Create folder if it doesn't exist
        await fs.mkdir(folderPath, { recursive: true });

        // Check if poster already exists
        const posterPath = path.join(folderPath, 'poster.jpg');
        try {
          await fs.access(posterPath);
          // File exists, skip
          logger.debug('Poster already exists, skipping', {
            label: 'LocalPosterFolderService',
            posterPath,
          });
          stats.skipped++;
          this.libraryProgress[libraryId].skipped++;
        } catch {
          // Download and save poster directly from Plex
          const axios = (await import('axios')).default;
          const { getSettings } = await import('@server/lib/settings');

          let downloadPath = currentPlexPosterUrl;

          // If URL is relative, build full URL
          if (!downloadPath.startsWith('http')) {
            const settings = getSettings();
            const baseUrl = `${settings.plex.useSsl ? 'https' : 'http'}://${
              settings.plex.ip
            }:${settings.plex.port}`;
            downloadPath = `${baseUrl}${currentPlexPosterUrl}?X-Plex-Token=${plexApi['plexToken']}`;
          }

          const response = await axios.get(downloadPath, {
            responseType: 'arraybuffer',
            timeout: 30000,
            maxContentLength: 50 * 1024 * 1024,
            validateStatus: (status) => status === 200,
          });

          // Validate content type is an image
          const contentType = response.headers['content-type'] || '';
          if (!contentType.startsWith('image/')) {
            throw new Error(`Invalid content type: ${contentType}`);
          }

          const posterBuffer = Buffer.from(response.data);
          if (posterBuffer.length > 50 * 1024 * 1024) {
            throw new Error(`Poster too large: ${posterBuffer.length} bytes`);
          }

          await fs.writeFile(posterPath, posterBuffer);

          stats.downloaded++;
          logger.debug('Downloaded and saved Plex poster', {
            label: 'LocalPosterFolderService',
            posterPath,
          });
        }
      } catch (error) {
        logger.error('Failed to populate folder with Plex poster', {
          label: 'LocalPosterFolderService',
          itemTitle: item.title,
          error: error instanceof Error ? error.message : String(error),
        });
        stats.failed++;
        this.libraryProgress[libraryId].failed++;
      }

      this.libraryProgress[libraryId].current++;
    }

    logger.info('Plex poster population complete for library', {
      label: 'LocalPosterFolderService',
      libraryId,
      ...stats,
    });

    return stats;
  }

  /**
   * Populate local folders with Plex posters for all configured libraries
   */
  async populateFromPlexForAllLibraries(): Promise {
    if (this.running) {
      logger.warn('Plex poster population already running', {
        label: 'LocalPosterFolderService',
      });
      return;
    }

    this.running = true;
    this.cancelled = false;
    this.libraryProgress = {};

    try {
      logger.info('Starting Plex poster population for all libraries', {
        label: 'LocalPosterFolderService',
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
          label: 'LocalPosterFolderService',
        });
        return;
      }

      for (const config of configs) {
        if (this.cancelled) {
          break;
        }

        await this.populateFromPlexForLibrary(
          plexApi,
          config.libraryId,
          config.libraryName
        );
      }

      logger.info('Plex poster population complete', {
        label: 'LocalPosterFolderService',
        status: this.status.overallProgress,
      });
    } catch (error) {
      logger.error('Plex poster population failed', {
        label: 'LocalPosterFolderService',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      this.running = false;
    }
  }
}

// Singleton instance
export const localPosterFolderService = new LocalPosterFolderService();
