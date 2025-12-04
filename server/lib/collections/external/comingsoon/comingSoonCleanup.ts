import type PlexAPI from '@server/api/plexapi';
import RadarrAPI from '@server/api/servarr/radarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import { getRepository } from '@server/datasource';
import { ComingSoonItem } from '@server/entity/ComingSoonItem';
import type { LibraryItemsCache } from '@server/lib/collections/core/CollectionUtilities';
import type { ComingSoonSourceData } from '@server/lib/collections/core/types';
import type { CollectionConfig } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

/**
 * Clean up Coming Soon placeholders:
 * 1. Items that now have real files in Radarr/Sonarr (released items)
 * 2. Items no longer in source data (orphaned items)
 * 3. Items that have been placeholders for 180+ days (stale items)
 *
 * Released items are tracked for configured window (default: 7 days) with "RELEASED X DAYS AGO" overlays,
 * then original posters are restored and database records are removed.
 *
 * Orphaned and stale items are immediately removed (file + database record).
 */
export async function cleanupReleasedPlaceholders(
  config: CollectionConfig,
  plexClient: PlexAPI,
  libraryCache?: LibraryItemsCache,
  sourceData?: ComingSoonSourceData[]
): Promise<void> {
  let repository;
  let placeholders;

  try {
    repository = getRepository(ComingSoonItem);
    placeholders = await repository.find({ where: { configId: config.id } });
  } catch (error) {
    // If table doesn't exist yet (first run), skip cleanup
    logger.debug('Skipping placeholder cleanup - table not initialized yet', {
      label: 'Coming Soon Collections',
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  if (placeholders.length === 0) {
    return;
  }

  logger.info('Checking Coming Soon placeholders for cleanup', {
    label: 'Coming Soon Collections',
    configName: config.name,
    count: placeholders.length,
  });

  const settings = getSettings();
  let removedCount = 0;

  for (const placeholder of placeholders) {
    try {
      let hasRealFile = false;

      // Check if real file now exists
      if (
        placeholder.source === 'radarr' ||
        placeholder.source === 'trakt' ||
        placeholder.source === 'tmdb'
      ) {
        if (
          placeholder.mediaType === 'movie' &&
          settings.radarr &&
          settings.radarr.length > 0
        ) {
          for (const radarrInstance of settings.radarr) {
            const radarrClient = new RadarrAPI({
              url: `${radarrInstance.useSsl ? 'https' : 'http'}://${
                radarrInstance.hostname
              }:${radarrInstance.port}${radarrInstance.baseUrl || ''}/api/v3`,
              apiKey: radarrInstance.apiKey,
            });

            const movies = await radarrClient.getMovies();
            const movie = movies.find((m) => m.tmdbId === placeholder.tmdbId);

            if (movie && movie.hasFile) {
              hasRealFile = true;
              logger.info('Found real file for Coming Soon placeholder', {
                label: 'Coming Soon Collections',
                title: placeholder.title,
                radarrInstance: radarrInstance.name,
              });
              break;
            }
          }
        }
      }

      if (
        placeholder.source === 'sonarr' ||
        placeholder.source === 'trakt' ||
        placeholder.source === 'tmdb'
      ) {
        if (
          placeholder.mediaType === 'tv' &&
          settings.sonarr &&
          settings.sonarr.length > 0
        ) {
          for (const sonarrInstance of settings.sonarr) {
            const sonarrClient = new SonarrAPI({
              url: `${sonarrInstance.useSsl ? 'https' : 'http'}://${
                sonarrInstance.hostname
              }:${sonarrInstance.port}${sonarrInstance.baseUrl || ''}/api/v3`,
              apiKey: sonarrInstance.apiKey,
            });

            const allSeries = await sonarrClient.getSeries();
            const series = allSeries.find(
              (s) => s.tvdbId === placeholder.tvdbId
            );

            if (series && series.statistics?.episodeFileCount > 0) {
              hasRealFile = true;
              logger.info('Found real file for Coming Soon placeholder', {
                label: 'Coming Soon Collections',
                title: placeholder.title,
                sonarrInstance: sonarrInstance.name,
              });
              break;
            }
          }
        }
      }

      if (hasRealFile) {
        // FIX #2: Verify the real file actually exists in Plex before cleanup
        let realItemInPlex = false;
        let realItemRatingKey: string | undefined;

        if (libraryCache) {
          // Use cached library data to verify the real item exists in Plex
          const allLibraries = Object.values(libraryCache);
          for (const library of allLibraries) {
            const item = library.find((i) => {
              // Extract tmdbId from Guid array
              const tmdbGuid = i.Guid?.find((guid) =>
                guid.id.startsWith('tmdb://')
              );
              const tmdbMatch = tmdbGuid?.id.match(/tmdb:\/\/(\d+)/);
              const itemTmdbId = tmdbMatch ? parseInt(tmdbMatch[1], 10) : null;

              if (placeholder.mediaType === 'movie') {
                return itemTmdbId === placeholder.tmdbId;
              }

              // For TV shows, also check TVDB
              const tvdbGuid = i.Guid?.find((guid) =>
                guid.id.startsWith('tvdb://')
              );
              const tvdbMatch = tvdbGuid?.id.match(/tvdb:\/\/(\d+)/);
              const itemTvdbId = tvdbMatch ? parseInt(tvdbMatch[1], 10) : null;

              return (
                itemTmdbId === placeholder.tmdbId ||
                itemTvdbId === placeholder.tvdbId
              );
            });

            if (item) {
              realItemInPlex = true;
              realItemRatingKey = item.ratingKey;
              break;
            }
          }
        } else {
          // No library cache available - assume item is in Plex if Radarr/Sonarr says hasFile
          // This is safe because the placeholder will get cleaned up on next sync when cache is available
          logger.debug(
            'Library cache not available - deferring cleanup verification',
            {
              label: 'Coming Soon Collections',
              title: placeholder.title,
            }
          );
          continue;
        }

        if (!realItemInPlex) {
          logger.info(
            'Real file exists in Radarr/Sonarr but not yet in Plex - skipping cleanup',
            {
              label: 'Coming Soon Collections',
              title: placeholder.title,
            }
          );
          continue; // Skip cleanup until Plex has scanned the file
        }

        // Mark as released if not already marked
        if (!placeholder.releasedAt) {
          placeholder.releasedAt = new Date();
          placeholder.plexRatingKey = realItemRatingKey; // Store rating key for overlay updates
          placeholder.isPlaceholder = false; // Item now exists in Plex, no longer a placeholder
          await repository.save(placeholder);

          logger.info('Marked Coming Soon item as released', {
            label: 'Coming Soon Collections',
            title: placeholder.title,
            releasedAt: placeholder.releasedAt,
          });
        }

        // Remove placeholder file (but keep database record for 7-day tracking)
        // Only try to remove if this was an actual placeholder file (not a regular item)
        if (placeholder.placeholderPath) {
          const { removePlaceholder } = await import(
            '@server/lib/comingsoon/placeholderManager'
          );

          try {
            await removePlaceholder(
              placeholder.placeholderPath,
              placeholder.mediaType
            );
            logger.info('Removed placeholder file for released item', {
              label: 'Coming Soon Collections',
              title: placeholder.title,
            });
          } catch (error) {
            // If placeholder already removed, that's okay
            if (error instanceof Error && !error.message.includes('ENOENT')) {
              logger.warn('Failed to remove placeholder file', {
                label: 'Coming Soon Collections',
                title: placeholder.title,
                error: error.message,
              });
            }
          }
        } else {
          logger.debug(
            'Item was not a placeholder file, no file cleanup needed',
            {
              label: 'Coming Soon Collections',
              title: placeholder.title,
              mediaType: placeholder.mediaType,
            }
          );
        }

        removedCount++;
      } else {
        // If already marked as released, check if it's been more than configured days since RELEASE DATE
        if (placeholder.releasedAt && placeholder.releaseDate) {
          const { calculateDaysSince } = await import(
            '@server/utils/dateHelpers'
          );
          const releasedWindowDays = config.comingSoonReleasedDays || 7;
          // Calculate days since the actual release date, not when file was detected
          const daysSinceReleaseDate = calculateDaysSince(
            placeholder.releaseDate
          );

          if (daysSinceReleaseDate > releasedWindowDays) {
            // More than configured window since release date - restore original poster and remove from database
            if (placeholder.plexRatingKey) {
              try {
                const TmdbAPI = (await import('@server/api/themoviedb'))
                  .default;
                const tmdbClient = new TmdbAPI();

                let posterUrl: string | undefined;
                if (placeholder.mediaType === 'movie') {
                  const movieDetails = await tmdbClient.getMovie({
                    movieId: placeholder.tmdbId,
                  });
                  posterUrl = movieDetails.poster_path
                    ? `https://image.tmdb.org/t/p/original${movieDetails.poster_path}`
                    : undefined;
                } else {
                  const showDetails = await tmdbClient.getTvShow({
                    tvId: placeholder.tmdbId,
                  });
                  posterUrl = showDetails.poster_path
                    ? `https://image.tmdb.org/t/p/original${showDetails.poster_path}`
                    : undefined;
                }

                if (posterUrl) {
                  await plexClient.uploadPosterFromUrl(
                    placeholder.plexRatingKey,
                    posterUrl
                  );
                  logger.info(
                    `Reset poster to original after ${releasedWindowDays}-day window from release date`,
                    {
                      label: 'Coming Soon Collections',
                      title: placeholder.title,
                      daysSinceReleaseDate,
                      releaseDate: placeholder.releaseDate,
                      releasedWindowDays,
                    }
                  );
                }
              } catch (error) {
                logger.warn('Failed to reset poster to original', {
                  label: 'Coming Soon Collections',
                  title: placeholder.title,
                  ratingKey: placeholder.plexRatingKey,
                  error: error instanceof Error ? error.message : String(error),
                });
              }
            }

            // Remove from database
            await repository.remove(placeholder);
            removedCount++;

            logger.info(
              `Removed released item after ${releasedWindowDays}-day window from release date`,
              {
                label: 'Coming Soon Collections',
                title: placeholder.title,
                daysSinceReleaseDate,
                releaseDate: placeholder.releaseDate,
                releasedWindowDays,
              }
            );
          }
        }
      }
    } catch (error) {
      logger.error('Error checking placeholder for cleanup', {
        label: 'Coming Soon Collections',
        title: placeholder.title,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Check for orphaned items (no longer in source data) and stale items (too old)
  if (sourceData && sourceData.length > 0) {
    const sourceTmdbIds = new Set(sourceData.map((item) => item.tmdbId));
    const STALE_THRESHOLD_DAYS = 180; // 6 months
    let orphanedCount = 0;
    let staleCount = 0;

    for (const placeholder of placeholders) {
      try {
        // Skip items that were already processed for release cleanup above
        if (placeholder.releasedAt) {
          continue;
        }

        const isOrphaned = !sourceTmdbIds.has(placeholder.tmdbId);
        const isStale =
          placeholder.createdAt &&
          Date.now() - placeholder.createdAt.getTime() >
            STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;

        // For orphaned items, check if they now have a real file (like returning shows that downloaded)
        if (isOrphaned && !isStale) {
          let hasRealFile = false;

          // Check if real file now exists (same logic as released items section)
          if (
            placeholder.source === 'radarr' ||
            placeholder.source === 'trakt' ||
            placeholder.source === 'tmdb'
          ) {
            if (
              placeholder.mediaType === 'movie' &&
              settings.radarr &&
              settings.radarr.length > 0
            ) {
              for (const radarrInstance of settings.radarr) {
                const radarrClient = new RadarrAPI({
                  url: `${radarrInstance.useSsl ? 'https' : 'http'}://${
                    radarrInstance.hostname
                  }:${radarrInstance.port}${
                    radarrInstance.baseUrl || ''
                  }/api/v3`,
                  apiKey: radarrInstance.apiKey,
                });

                const movies = await radarrClient.getMovies();
                const movie = movies.find(
                  (m) => m.tmdbId === placeholder.tmdbId
                );

                if (movie && movie.hasFile) {
                  hasRealFile = true;
                  break;
                }
              }
            }
          }

          if (
            placeholder.source === 'sonarr' ||
            placeholder.source === 'trakt' ||
            placeholder.source === 'tmdb'
          ) {
            if (
              placeholder.mediaType === 'tv' &&
              settings.sonarr &&
              settings.sonarr.length > 0
            ) {
              for (const sonarrInstance of settings.sonarr) {
                const sonarrClient = new SonarrAPI({
                  url: `${sonarrInstance.useSsl ? 'https' : 'http'}://${
                    sonarrInstance.hostname
                  }:${sonarrInstance.port}${
                    sonarrInstance.baseUrl || ''
                  }/api/v3`,
                  apiKey: sonarrInstance.apiKey,
                });

                const allSeries = await sonarrClient.getSeries();
                const series = allSeries.find(
                  (s) => s.tvdbId === placeholder.tvdbId
                );

                if (series && series.statistics?.episodeFileCount > 0) {
                  hasRealFile = true;
                  break;
                }
              }
            }
          }

          // If orphaned item now has a real file, mark as released instead of removing
          if (hasRealFile) {
            placeholder.releasedAt = new Date();
            placeholder.isPlaceholder = false; // Item now exists in Plex, no longer a placeholder
            await repository.save(placeholder);

            logger.info(
              'Marked orphaned Coming Soon item as released (has real file now)',
              {
                label: 'Coming Soon Collections',
                title: placeholder.title,
                releasedAt: placeholder.releasedAt,
              }
            );

            // Will be handled by released items cleanup logic (respects configured window)
            continue;
          }
        }

        if (isOrphaned || isStale) {
          const reason = isOrphaned
            ? 'no longer in source data'
            : `stale (${STALE_THRESHOLD_DAYS}+ days old)`;

          logger.info('Removing orphaned/stale Coming Soon placeholder', {
            label: 'Coming Soon Collections',
            title: placeholder.title,
            reason,
            age: placeholder.createdAt
              ? Math.floor(
                  (Date.now() - placeholder.createdAt.getTime()) /
                    (24 * 60 * 60 * 1000)
                )
              : 'unknown',
            source: placeholder.source,
          });

          // Remove placeholder file if this was an actual placeholder
          if (placeholder.placeholderPath) {
            const { removePlaceholder } = await import(
              '@server/lib/comingsoon/placeholderManager'
            );
            try {
              await removePlaceholder(
                placeholder.placeholderPath,
                placeholder.mediaType
              );
              logger.debug('Removed placeholder file', {
                label: 'Coming Soon Collections',
                path: placeholder.placeholderPath,
              });
            } catch (error) {
              // If file already deleted, that's okay
              if (error instanceof Error && !error.message.includes('ENOENT')) {
                logger.warn('Failed to remove placeholder file', {
                  label: 'Coming Soon Collections',
                  path: placeholder.placeholderPath,
                  error: error.message,
                });
              }
            }
          }

          // Remove placeholder file if this was an actual placeholder
          let fileRemovalSucceeded = false;
          if (placeholder.placeholderPath) {
            const { removePlaceholder } = await import(
              '@server/lib/comingsoon/placeholderManager'
            );
            try {
              await removePlaceholder(
                placeholder.placeholderPath,
                placeholder.mediaType
              );
              fileRemovalSucceeded = true;
              logger.info('Removed placeholder file', {
                label: 'Coming Soon Collections',
                title: placeholder.title,
                path: placeholder.placeholderPath,
              });
            } catch (error) {
              // File deletion failed - keep database record
              logger.error(
                'Failed to remove placeholder file - keeping database record',
                {
                  label: 'Coming Soon Collections',
                  title: placeholder.title,
                  path: placeholder.placeholderPath,
                  error: error instanceof Error ? error.message : String(error),
                }
              );
              // Don't remove from database if file removal failed
              continue;
            }
          } else {
            // No placeholder file to remove (item may have been manually added to Plex)
            logger.debug(
              'No placeholder file path - item was not a placeholder',
              {
                label: 'Coming Soon Collections',
                title: placeholder.title,
              }
            );
            fileRemovalSucceeded = true; // Safe to remove from database
          }

          // Only proceed with database/poster cleanup if file was successfully removed (or no file existed)
          if (fileRemovalSucceeded) {
            // Reset poster to original TMDB poster (for items with overlays)
            if (placeholder.plexRatingKey) {
              try {
                const TmdbAPI = (await import('@server/api/themoviedb'))
                  .default;
                const tmdbClient = new TmdbAPI();

                let posterUrl: string | undefined;
                if (placeholder.mediaType === 'movie') {
                  const movieDetails = await tmdbClient.getMovie({
                    movieId: placeholder.tmdbId,
                  });
                  posterUrl = movieDetails.poster_path
                    ? `https://image.tmdb.org/t/p/original${movieDetails.poster_path}`
                    : undefined;
                } else {
                  const showDetails = await tmdbClient.getTvShow({
                    tvId: placeholder.tmdbId,
                  });
                  posterUrl = showDetails.poster_path
                    ? `https://image.tmdb.org/t/p/original${showDetails.poster_path}`
                    : undefined;
                }

                if (posterUrl) {
                  await plexClient.uploadPosterFromUrl(
                    placeholder.plexRatingKey,
                    posterUrl
                  );
                  logger.info(
                    'Reset poster to original TMDB poster for orphaned item',
                    {
                      label: 'Coming Soon Collections',
                      title: placeholder.title,
                      ratingKey: placeholder.plexRatingKey,
                    }
                  );
                }
              } catch (error) {
                logger.warn('Failed to reset poster to original', {
                  label: 'Coming Soon Collections',
                  title: placeholder.title,
                  ratingKey: placeholder.plexRatingKey,
                  error: error instanceof Error ? error.message : String(error),
                });
              }
            }

            // Remove from database only after successful file removal
            await repository.remove(placeholder);
            removedCount++;

            if (isOrphaned) orphanedCount++;
            if (isStale) staleCount++;

            logger.info('Removed Coming Soon placeholder from database', {
              label: 'Coming Soon Collections',
              title: placeholder.title,
              reason,
            });
          }
        }
      } catch (error) {
        logger.error('Error removing orphaned/stale placeholder', {
          label: 'Coming Soon Collections',
          title: placeholder.title,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (orphanedCount > 0 || staleCount > 0) {
      logger.info('Orphaned/stale placeholder cleanup summary', {
        label: 'Coming Soon Collections',
        configName: config.name,
        orphaned: orphanedCount,
        stale: staleCount,
        total: orphanedCount + staleCount,
      });
    }
  }

  if (removedCount > 0) {
    logger.info('Coming Soon cleanup completed', {
      label: 'Coming Soon Collections',
      configName: config.name,
      removed: removedCount,
    });
  }
}
