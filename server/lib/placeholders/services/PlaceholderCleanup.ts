import type PlexAPI from '@server/api/plexapi';
import { getRepository } from '@server/datasource';
import { ComingSoonItem } from '@server/entity/ComingSoonItem';
import type { LibraryItemsCache } from '@server/lib/collections/core/CollectionUtilities';
import type { CollectionConfig } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import fs from 'fs/promises';
import path from 'path';
import { Like, Not } from 'typeorm';
import { getReleasedDays } from './PlaceholderCreation';

/**
 * Helper function to clean up a placeholder when real content is detected
 * Deletes the placeholder file and ALL database records for this TMDB ID across all collections
 */
export async function cleanupPlaceholderForRealContent(
  tmdbId: number,
  placeholderPath: string,
  mediaType: 'movie' | 'tv'
): Promise<void> {
  const { removePlaceholder } = await import(
    '@server/lib/placeholders/placeholderManager'
  );
  const repository = getRepository(ComingSoonItem);

  try {
    // Delete the placeholder file
    await removePlaceholder(placeholderPath, mediaType);

    logger.info('Deleted placeholder file - real content detected', {
      label: 'PlaceholderService',
      tmdbId,
      mediaType,
      placeholderPath,
    });

    // Delete ALL database records for this TMDB ID (across all collections)
    const allRecords = await repository.find({
      where: { tmdbId },
    });

    if (allRecords.length > 0) {
      await repository.delete({ tmdbId });

      logger.info(
        'Deleted placeholder database records across all collections',
        {
          label: 'PlaceholderService',
          tmdbId,
          recordsDeleted: allRecords.length,
          collections: allRecords.map((r) => r.configId),
        }
      );
    }
  } catch (error) {
    logger.error('Failed to clean up placeholder for real content', {
      label: 'PlaceholderService',
      tmdbId,
      mediaType,
      placeholderPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle placeholder operations based on createPlaceholdersForMissing setting
 * - If enabled: runs cleanup (released items, orphaned items, stale items)
 * - If disabled: deletes all placeholder records for the config
 * Files will be cleaned up later by orphaned file cleanup
 */
export async function handlePlaceholderCleanup(
  config: CollectionConfig,
  plexClient: PlexAPI,
  libraryCache?: LibraryItemsCache,
  sourceTmdbIds?: Set<number>
): Promise<void> {
  logger.debug('handlePlaceholderCleanup called', {
    label: 'PlaceholderService',
    configId: config.id,
    configName: config.name,
    createPlaceholdersForMissing: config.createPlaceholdersForMissing,
    willDeleteAll: !config.createPlaceholdersForMissing,
  });

  if (config.createPlaceholdersForMissing) {
    // Setting enabled - run normal cleanup
    await cleanupPlaceholdersForConfig(
      config,
      plexClient,
      libraryCache,
      sourceTmdbIds
    );
  } else {
    // Setting disabled - delete all placeholders for this config
    await deleteAllPlaceholdersForConfig(config.id);
  }
}

/**
 * Delete all placeholder records for a config when createPlaceholdersForMissing is disabled
 * Files will be cleaned up later by orphaned file cleanup
 */
export async function deleteAllPlaceholdersForConfig(
  configId: string
): Promise<void> {
  try {
    const repository = getRepository(ComingSoonItem);

    // Find all placeholders for this config (including multi-source sub-configs)
    const placeholders = await repository.find({
      where: [
        { configId },
        { configId: Like(`${configId}-source-%`) }, // Multi-source sub-collections
      ],
    });

    if (placeholders.length === 0) {
      return;
    }

    logger.info(
      `Deleting ${placeholders.length} placeholder records for config with createPlaceholdersForMissing disabled`,
      {
        label: 'PlaceholderService',
        configId,
        count: placeholders.length,
      }
    );

    await repository.remove(placeholders);

    logger.info('Placeholder records deleted successfully', {
      label: 'PlaceholderService',
      configId,
      removed: placeholders.length,
    });
  } catch (error) {
    logger.error('Failed to delete placeholder records for config', {
      label: 'PlaceholderService',
      configId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Cleanup orphaned placeholder DB records where the collection no longer exists
 * This runs during full sync to clean up records from deleted collections
 */
export async function cleanupOrphanedPlaceholderRecords(): Promise<void> {
  try {
    const repository = getRepository(ComingSoonItem);
    const settings = getSettings();

    // Get all active collection config IDs
    const activeConfigs = settings.plex.collectionConfigs || [];
    const activeConfigIds = new Set(activeConfigs.map((c) => c.id));

    // Get all placeholder records
    const allRecords = await repository.find();

    logger.debug('Starting orphaned placeholder record cleanup', {
      label: 'PlaceholderService',
      totalRecords: allRecords.length,
      activeConfigCount: activeConfigs.length,
      sampleConfigIds: allRecords.slice(0, 5).map((r) => r.configId),
    });

    if (allRecords.length === 0) {
      logger.debug('No placeholder records in database', {
        label: 'PlaceholderService',
      });
      return;
    }

    // Find orphaned records
    const orphanedRecords = allRecords.filter((record) => {
      // Check if configId exists in active configs
      if (activeConfigIds.has(record.configId)) {
        return false;
      }

      // For multi-source sub-collections (e.g., "33079-source-1762115269335")
      // Check if the parent config exists
      const match = record.configId.match(/^(\d+)-source-/);
      if (match) {
        const parentId = match[1];
        logger.debug('Checking multi-source placeholder record', {
          label: 'PlaceholderService',
          recordConfigId: record.configId,
          extractedParentId: parentId,
          parentExists: activeConfigIds.has(parentId),
          activeConfigIds: Array.from(activeConfigIds),
        });
        if (activeConfigIds.has(parentId)) {
          return false; // Parent exists, keep record
        }
      } else if (record.configId.includes('-source-')) {
        // Log if we have a source ID but regex didn't match
        logger.warn('Multi-source configId did not match regex pattern', {
          label: 'PlaceholderService',
          recordConfigId: record.configId,
          regexPattern: '/^(\\d+)-source-/',
        });
      }

      return true; // No matching config found - orphaned
    });

    if (orphanedRecords.length === 0) {
      logger.debug('No orphaned placeholder records found', {
        label: 'PlaceholderService',
        totalRecords: allRecords.length,
      });
      return;
    }

    logger.info(
      `Found ${orphanedRecords.length} orphaned placeholder records to clean up`,
      {
        label: 'PlaceholderService',
        orphanedCount: orphanedRecords.length,
        totalRecords: allRecords.length,
      }
    );

    // Delete orphaned records (files will be cleaned up separately)
    await repository.remove(orphanedRecords);

    logger.info('Orphaned placeholder records cleaned up', {
      label: 'PlaceholderService',
      removed: orphanedRecords.length,
    });
  } catch (error) {
    logger.error('Failed to cleanup orphaned placeholder records', {
      label: 'PlaceholderService',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Cleanup orphaned placeholder files where no DB records reference them
 * This runs after record cleanup to remove files that are no longer tracked
 * @returns Number of files removed
 */
export async function cleanupOrphanedPlaceholderFiles(): Promise<number> {
  try {
    const repository = getRepository(ComingSoonItem);
    const settings = getSettings();
    const { getPlaceholderRootFolder } = await import(
      '@server/lib/placeholders/helpers/placeholderPathHelpers'
    );

    // Get all library-specific placeholder folders
    const libraryPaths: {
      path: string;
      type: 'movie' | 'tv';
      libraryKey: string;
    }[] = [];

    for (const library of settings.plex.libraries) {
      if (library.type !== 'movie' && library.type !== 'show') continue;

      const mediaType: 'movie' | 'tv' =
        library.type === 'movie' ? 'movie' : 'tv';
      const placeholderPath = getPlaceholderRootFolder(library.key, mediaType);
      if (placeholderPath) {
        libraryPaths.push({
          path: placeholderPath,
          type: mediaType,
          libraryKey: library.key,
        });
      }
    }

    if (libraryPaths.length === 0) {
      logger.debug(
        'No placeholder library paths configured, skipping file cleanup',
        {
          label: 'PlaceholderService',
        }
      );
      return 0;
    }

    // Get all placeholder file paths from database
    const allRecords = await repository.find();

    logger.debug('Starting orphaned placeholder file cleanup', {
      label: 'PlaceholderService',
      totalRecordsInDatabase: allRecords.length,
      samplePaths: allRecords.slice(0, 5).map((r) => r.placeholderPath),
    });

    const trackedPaths = new Set(allRecords.map((r) => r.placeholderPath));

    let filesRemoved = 0;

    // Scan each library's placeholder folder for orphaned files
    for (const libraryInfo of libraryPaths) {
      try {
        if (libraryInfo.type === 'movie') {
          // Scan movie library for orphaned files
          const movieFolders = await fs.readdir(libraryInfo.path);

          for (const folder of movieFolders) {
            const folderPath = path.join(libraryInfo.path, folder);

            try {
              const stats = await fs.stat(folderPath);
              if (!stats.isDirectory()) continue;

              const files = await fs.readdir(folderPath);
              for (const file of files) {
                // Check if this is a placeholder file (contains edition-Trailer)
                if (!file.includes('{edition-Trailer}')) continue;

                const filePath = path.join(folderPath, file);
                const relativePath = path.join(folder, file);

                // Check if any DB record references this file
                if (!trackedPaths.has(relativePath)) {
                  // Orphaned file - delete it
                  try {
                    const { removePlaceholder } = await import(
                      '@server/lib/placeholders/placeholderManager'
                    );
                    await removePlaceholder(filePath, 'movie');
                    filesRemoved++;
                    logger.info('Removed orphaned placeholder file', {
                      label: 'PlaceholderService',
                      path: relativePath,
                      mediaType: 'movie',
                      libraryKey: libraryInfo.libraryKey,
                    });
                  } catch (error) {
                    logger.warn('Failed to remove orphaned placeholder file', {
                      label: 'PlaceholderService',
                      path: relativePath,
                      error:
                        error instanceof Error ? error.message : String(error),
                    });
                  }
                }
              }
            } catch (error) {
              // Folder access error, skip
              continue;
            }
          }
        } else if (libraryInfo.type === 'tv') {
          // Scan TV library for orphaned files
          const showFolders = await fs.readdir(libraryInfo.path);

          for (const showFolder of showFolders) {
            const showPath = path.join(libraryInfo.path, showFolder);

            try {
              const stats = await fs.stat(showPath);
              if (!stats.isDirectory()) continue;

              const seasonFolders = await fs.readdir(showPath);
              for (const seasonFolder of seasonFolders) {
                if (seasonFolder !== 'Season 00') continue; // Only check Season 00

                const seasonPath = path.join(showPath, seasonFolder);
                const seasonStats = await fs.stat(seasonPath);
                if (!seasonStats.isDirectory()) continue;

                const files = await fs.readdir(seasonPath);
                for (const file of files) {
                  // Check if this is a placeholder file (S00E00.Trailer.mp4)
                  if (file !== 'S00E00.Trailer.mp4') continue;

                  const filePath = path.join(seasonPath, file);
                  const relativePath = path.join(
                    showFolder,
                    seasonFolder,
                    file
                  );

                  // Check if any DB record references this file
                  if (!trackedPaths.has(relativePath)) {
                    // Orphaned file - delete it
                    try {
                      const { removePlaceholder } = await import(
                        '@server/lib/placeholders/placeholderManager'
                      );
                      await removePlaceholder(filePath, 'tv');
                      filesRemoved++;
                      logger.info('Removed orphaned placeholder file', {
                        label: 'PlaceholderService',
                        path: relativePath,
                        mediaType: 'tv',
                        libraryKey: libraryInfo.libraryKey,
                      });
                    } catch (error) {
                      logger.warn(
                        'Failed to remove orphaned placeholder file',
                        {
                          label: 'PlaceholderService',
                          path: relativePath,
                          error:
                            error instanceof Error
                              ? error.message
                              : String(error),
                        }
                      );
                    }
                  }
                }
              }
            } catch (error) {
              // Folder access error, skip
              continue;
            }
          }
        }
      } catch (error) {
        logger.warn('Failed to scan library for orphaned files', {
          label: 'PlaceholderService',
          path: libraryInfo.path,
          libraryKey: libraryInfo.libraryKey,
          mediaType: libraryInfo.type,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (filesRemoved > 0) {
      logger.info('Orphaned placeholder files cleaned up', {
        label: 'PlaceholderService',
        filesRemoved,
      });
    }

    return filesRemoved;
  } catch (error) {
    logger.error('Failed to cleanup orphaned placeholder files', {
      label: 'PlaceholderService',
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

/**
 * Clean up placeholders for a collection:
 * 1. Items with real content detected in Plex (via discovery system)
 * 2. Items no longer in source data (orphaned items)
 * 3. Items that have been placeholders for 7+ days (stale items)
 *
 * Released items are tracked for configured window (placeholderReleasedDays, default: 7 days),
 * then database records are removed and overlay system automatically updates posters.
 *
 * Works for ANY collection type that creates placeholders.
 *
 * @param config - Collection configuration
 * @param plexClient - Plex API client
 * @param libraryCache - Optional cached library items for verification
 * @param sourceTmdbIds - Optional set of tmdbIds from current source for orphan detection
 */
export async function cleanupPlaceholdersForConfig(
  config: CollectionConfig,
  plexClient: PlexAPI,
  libraryCache?: LibraryItemsCache,
  sourceTmdbIds?: Set<number>
): Promise<void> {
  let repository;
  let placeholders;

  try {
    repository = getRepository(ComingSoonItem);
    // Find placeholders for this config (including multi-source sub-configs)
    placeholders = await repository.find({
      where: [
        { configId: config.id },
        { configId: Like(`${config.id}-source-%`) }, // Multi-source sub-collections
      ],
    });
  } catch (error) {
    // If table doesn't exist yet (first run), skip cleanup
    logger.debug('Skipping placeholder cleanup - table not initialized yet', {
      label: 'PlaceholderService',
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  if (placeholders.length === 0) {
    return;
  }

  logger.info('Checking placeholders for cleanup', {
    label: 'PlaceholderService',
    configName: config.name,
    count: placeholders.length,
  });

  let removedCount = 0;

  // NOTE: Title fixing and real content cleanup now happens globally during discovery
  // This function only handles collection-specific orphaned/stale item cleanup

  // Get released window from general config (not Coming Soon specific!)
  const releasedWindowDays = getReleasedDays(config);

  // Check for orphaned items (not in source) and stale items (too old)
  if (sourceTmdbIds && sourceTmdbIds.size > 0) {
    const STALE_THRESHOLD_DAYS = 7; // 7 days
    let orphanedCount = 0;
    let staleCount = 0;

    for (const placeholder of placeholders) {
      try {
        // No need to skip items - we process all orphaned items

        const isOrphaned = !sourceTmdbIds.has(placeholder.tmdbId);
        const isStale =
          placeholder.createdAt &&
          Date.now() - placeholder.createdAt.getTime() >
            STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;

        // For orphaned items, check if past configured window
        if (isOrphaned && !isStale) {
          // This handles items that fall off source lists (e.g., Trakt Trending)
          // Keep them for placeholderReleasedDays from:
          // - Release date (if released) - so users see "recently released" items
          // - Creation date (if not released yet) - so users see upcoming items

          // Fetch release date from TMDB to determine window start
          const { placeholderContextService } = await import(
            '@server/lib/placeholders/services/PlaceholderContextService'
          );
          const context = await placeholderContextService.getPlaceholderContext(
            placeholder
          );

          let windowStartDate: Date = placeholder.createdAt;
          let windowType = 'creation';

          if (context.releaseDate) {
            // Check if release date is in the past (item has been released)
            const { isDateInFuture } = await import(
              '@server/utils/dateHelpers'
            );

            if (!isDateInFuture(context.releaseDate)) {
              // Item has been released - use release date as window start
              // Parse ISO date string (YYYY-MM-DD) as UTC midnight
              const dateOnly = context.releaseDate.split('T')[0];
              windowStartDate = new Date(dateOnly + 'T00:00:00.000Z');
              windowType = 'release';
            }
          }

          const daysSinceWindowStart = Math.floor(
            (Date.now() - windowStartDate.getTime()) / (24 * 60 * 60 * 1000)
          );

          if (daysSinceWindowStart > releasedWindowDays) {
            const reason = `orphaned (${daysSinceWindowStart} days since ${windowType}, window: ${releasedWindowDays} days)`;

            logger.info('Removing orphaned placeholder past window', {
              label: 'PlaceholderService',
              title: placeholder.title,
              source: placeholder.source,
              reason,
              windowType,
              daysSinceWindowStart,
              releasedWindowDays,
              releaseDate: context.releaseDate,
            });

            // Remove placeholder file if it exists
            let fileRemovalSucceeded = false;
            if (placeholder.placeholderPath) {
              const { removePlaceholder } = await import(
                '@server/lib/placeholders/placeholderManager'
              );
              const { getPlaceholderRootFolder } = await import(
                '@server/lib/placeholders/helpers/placeholderPathHelpers'
              );
              const libraryPath = getPlaceholderRootFolder(
                config.libraryId,
                placeholder.mediaType
              );

              if (!libraryPath) {
                logger.error(
                  'Library path not configured - cannot remove placeholder file',
                  {
                    label: 'PlaceholderService',
                    title: placeholder.title,
                    mediaType: placeholder.mediaType,
                    libraryId: config.libraryId,
                  }
                );
                continue;
              }

              // Construct full path from relative path
              const fullPath = path.join(
                libraryPath,
                placeholder.placeholderPath
              );

              // Check if any OTHER collection still needs this file
              const otherCollectionRecords = await repository.find({
                where: {
                  placeholderPath: placeholder.placeholderPath,
                  configId: Not(config.id),
                },
              });

              if (otherCollectionRecords.length > 0) {
                // Other collections still use this file - don't delete it
                fileRemovalSucceeded = true;
                logger.info(
                  'Placeholder file past window shared with other collections - keeping file',
                  {
                    label: 'PlaceholderService',
                    title: placeholder.title,
                    otherCollections: otherCollectionRecords.length,
                  }
                );
              } else {
                // No other collections use this file - safe to delete
                try {
                  await removePlaceholder(fullPath, placeholder.mediaType);
                  fileRemovalSucceeded = true;
                  logger.info('Removed placeholder file', {
                    label: 'PlaceholderService',
                    title: placeholder.title,
                    path: fullPath,
                  });
                } catch (error) {
                  // If file doesn't exist (ENOENT), treat as successful removal
                  const isFileNotFound =
                    error instanceof Error &&
                    'code' in error &&
                    error.code === 'ENOENT';

                  if (isFileNotFound) {
                    fileRemovalSucceeded = true;
                    logger.info(
                      'Placeholder file already removed - cleaning up database record',
                      {
                        label: 'PlaceholderService',
                        title: placeholder.title,
                        path: fullPath,
                      }
                    );
                  } else {
                    logger.error(
                      'Failed to remove placeholder file - keeping database record',
                      {
                        label: 'PlaceholderService',
                        title: placeholder.title,
                        path: fullPath,
                        error:
                          error instanceof Error
                            ? error.message
                            : String(error),
                      }
                    );
                    continue;
                  }
                }
              }
            } else {
              fileRemovalSucceeded = true; // No file to remove
            }

            // Remove from database if file removal succeeded
            if (fileRemovalSucceeded) {
              await repository.remove(placeholder);
              removedCount++;
              orphanedCount++;

              logger.info('Removed placeholder from database', {
                label: 'PlaceholderService',
                title: placeholder.title,
                source: placeholder.source,
                reason,
              });
            }
          }
        }

        // Stale items (7+ days old) - always remove
        if (isStale) {
          const reason = `stale (${STALE_THRESHOLD_DAYS}+ days old)`;

          logger.info('Removing stale placeholder', {
            label: 'PlaceholderService',
            title: placeholder.title,
            source: placeholder.source,
            reason,
            age: placeholder.createdAt
              ? Math.floor(
                  (Date.now() - placeholder.createdAt.getTime()) /
                    (24 * 60 * 60 * 1000)
                )
              : 'unknown',
          });

          // Remove placeholder file if it exists
          let fileRemovalSucceeded = false;
          if (placeholder.placeholderPath) {
            const { removePlaceholder } = await import(
              '@server/lib/placeholders/placeholderManager'
            );
            const { getPlaceholderRootFolder } = await import(
              '@server/lib/placeholders/helpers/placeholderPathHelpers'
            );
            const libraryPath = getPlaceholderRootFolder(
              config.libraryId,
              placeholder.mediaType
            );

            if (!libraryPath) {
              logger.error(
                'Library path not configured - cannot remove placeholder file',
                {
                  label: 'PlaceholderService',
                  title: placeholder.title,
                  mediaType: placeholder.mediaType,
                  libraryId: config.libraryId,
                }
              );
              continue;
            }

            // Construct full path from relative path
            const fullPath = path.join(
              libraryPath,
              placeholder.placeholderPath
            );

            // Check if any OTHER collection still needs this file
            const otherCollectionRecords = await repository.find({
              where: {
                placeholderPath: placeholder.placeholderPath,
                configId: Not(config.id),
              },
            });

            if (otherCollectionRecords.length > 0) {
              // Other collections still use this file - don't delete it
              fileRemovalSucceeded = true;
              logger.info(
                'Stale placeholder file shared with other collections - keeping file',
                {
                  label: 'PlaceholderService',
                  title: placeholder.title,
                  otherCollections: otherCollectionRecords.length,
                }
              );
            } else {
              // No other collections use this file - safe to delete
              try {
                await removePlaceholder(fullPath, placeholder.mediaType);
                fileRemovalSucceeded = true;
                logger.info('Removed placeholder file', {
                  label: 'PlaceholderService',
                  title: placeholder.title,
                  path: fullPath,
                });
              } catch (error) {
                // If file doesn't exist (ENOENT), treat as successful removal
                const isFileNotFound =
                  error instanceof Error &&
                  'code' in error &&
                  error.code === 'ENOENT';

                if (isFileNotFound) {
                  fileRemovalSucceeded = true;
                  logger.info(
                    'Placeholder file already removed - cleaning up database record',
                    {
                      label: 'PlaceholderService',
                      title: placeholder.title,
                      path: fullPath,
                    }
                  );
                } else {
                  logger.error(
                    'Failed to remove placeholder file - keeping database record',
                    {
                      label: 'PlaceholderService',
                      title: placeholder.title,
                      path: fullPath,
                      error:
                        error instanceof Error ? error.message : String(error),
                    }
                  );
                  continue;
                }
              }
            }
          } else {
            fileRemovalSucceeded = true; // No file to remove
          }

          // Remove from database if file removal succeeded
          if (fileRemovalSucceeded) {
            await repository.remove(placeholder);
            removedCount++;
            staleCount++;

            logger.info('Removed placeholder from database', {
              label: 'PlaceholderService',
              title: placeholder.title,
              source: placeholder.source,
              reason,
            });
          }
        }
      } catch (error) {
        logger.error('Error removing stale placeholder', {
          label: 'PlaceholderService',
          title: placeholder.title,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (orphanedCount > 0 || staleCount > 0) {
      logger.info('Orphaned/stale placeholder cleanup summary', {
        label: 'PlaceholderService',
        configName: config.name,
        orphaned: orphanedCount,
        stale: staleCount,
        total: orphanedCount + staleCount,
      });
    }
  }

  if (removedCount > 0) {
    logger.info('Placeholder cleanup completed', {
      label: 'PlaceholderService',
      configName: config.name,
      removed: removedCount,
    });
  }
}
