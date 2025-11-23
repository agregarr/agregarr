/**
 * PlaceholderService - Centralized service for creating placeholders for missing items
 *
 * This service provides a unified API for creating placeholder files in Plex for items
 * that are not yet available. Works for any collection type with createPlaceholdersForMissing enabled.
 */

import type PlexAPI from '@server/api/plexapi';
import { getRepository } from '@server/datasource';
import { ComingSoonItem } from '@server/entity/ComingSoonItem';
import {
  findPlexItemsByTitle,
  findPlexItemsByTmdbIds,
} from '@server/lib/collections/core/CollectionUtilities';
import type {
  CollectionItem,
  ComingSoonSourceData,
  MissingItem,
  PlaceholderSourceData,
} from '@server/lib/collections/core/types';
import type { OverlayItemInput } from '@server/lib/overlays/OverlayLibraryService';
import type { CollectionConfig } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

// Re-export cleanup functions (these are still in comingsoon folder)
export { cleanupReleasedPlaceholders } from '@server/lib/collections/external/comingsoon/comingSoonCleanup';

/**
 * Convert MissingItem array to PlaceholderSourceData array
 * This allows any collection type to provide placeholder metadata
 */
function missingItemsToPlaceholderSourceData(
  missingItems: MissingItem[],
  requireReleaseDates = false
): PlaceholderSourceData[] {
  return missingItems
    .filter((item) => {
      // For normal collections, include all items
      if (!requireReleaseDates) {
        return true;
      }

      // For Coming Soon collections, only include items with release date info
      const hasReleaseDateInfo = !!(
        item.releaseDate ||
        item.digitalRelease ||
        item.physicalRelease ||
        item.airDate
      );
      return hasReleaseDateInfo;
    })
    .map((item) => ({
      tmdbId: item.tmdbId,
      tvdbId: item.tvdbId,
      title: item.title,
      year: item.year,
      releaseDate: item.releaseDate,
      digitalRelease: item.digitalRelease,
      physicalRelease: item.physicalRelease,
      inCinemas: item.inCinemas,
      airDate: item.airDate,
      mediaType: item.mediaType,
      source: item.source || 'tmdb',
      monitored: item.monitored ?? false,
      isEstimatedDate: item.isEstimatedDate,
      seasonNumber: item.seasonNumber,
      episodeNumber: item.episodeNumber,
      // These will be calculated during placeholder creation
      releaseDateSortValue: undefined,
      releaseType: undefined,
      hasFile: false,
      isReturning: false,
    }));
}

/**
 * Get effective released days from config (with backward compatibility)
 */
export function getReleasedDays(config: CollectionConfig): number {
  return config.placeholderReleasedDays || config.comingSoonReleasedDays || 7;
}

/**
 * Get effective days ahead from config (with backward compatibility)
 */
export function getDaysAhead(config: CollectionConfig): number {
  return config.placeholderDaysAhead || config.comingSoonDays || 360;
}

/**
 * Check if a collection config has placeholder creation enabled
 */
export function isPlaceholderCreationEnabled(
  config: CollectionConfig
): boolean {
  return config.createPlaceholdersForMissing === true;
}

/**
 * Create a single placeholder file without scanning or applying overlays
 * Returns the path to the created file
 */
async function createPlaceholderFile(
  sourceItem: ComingSoonSourceData
): Promise<string> {
  const { downloadTrailer } = await import(
    '@server/lib/comingsoon/trailerDownload'
  );
  const { createPlaceholder } = await import(
    '@server/lib/comingsoon/placeholderManager'
  );

  // 1. Download trailer
  const trailerPath = await downloadTrailer(
    sourceItem.title,
    sourceItem.year,
    sourceItem.mediaType
  );

  // 2. Get library path from placeholder root folder settings
  const settings = getSettings();
  let libraryPath: string | undefined;

  if (sourceItem.mediaType === 'movie') {
    libraryPath = settings.main.placeholderMovieRootFolder;

    if (!libraryPath) {
      throw new Error(
        `Placeholder movie root folder not configured. Please set it in Settings > Downloads.`
      );
    }

    logger.debug(
      'Using configured movie root folder for placeholder creation',
      {
        label: 'PlaceholderService',
        rootFolder: libraryPath,
      }
    );
  } else if (sourceItem.mediaType === 'tv') {
    libraryPath = settings.main.placeholderTVRootFolder;

    if (!libraryPath) {
      throw new Error(
        `Placeholder TV root folder not configured. Please set it in Settings > Downloads.`
      );
    }

    logger.debug('Using configured TV root folder for placeholder creation', {
      label: 'PlaceholderService',
      rootFolder: libraryPath,
    });
  }

  if (!libraryPath) {
    throw new Error(`Could not determine library path for ${sourceItem.title}`);
  }

  // 3. Create placeholder file in library
  const result = await createPlaceholder({
    tmdbId: sourceItem.tmdbId,
    tvdbId: sourceItem.tvdbId,
    title: sourceItem.title,
    year: sourceItem.year,
    mediaType: sourceItem.mediaType,
    libraryPath,
    trailerPath,
  });

  return result.placeholderPath;
}

/**
 * Remove placeholders that Plex failed to match to TMDB metadata
 */
async function removeUnmatchedPlaceholders(
  placeholders: {
    sourceItem: ComingSoonSourceData;
    placeholderPath: string;
  }[],
  config: CollectionConfig,
  plexClient: PlexAPI
): Promise<void> {
  const { removePlaceholder } = await import(
    '@server/lib/comingsoon/placeholderManager'
  );

  if (placeholders.length === 0) {
    return;
  }

  let removedCount = 0;

  for (const { sourceItem, placeholderPath } of placeholders) {
    try {
      await removePlaceholder(placeholderPath, sourceItem.mediaType);
      removedCount += 1;

      logger.warn('Removed placeholder that Plex could not match', {
        label: 'PlaceholderService',
        title: sourceItem.title,
        tmdbId: sourceItem.tmdbId,
        mediaType: sourceItem.mediaType,
        placeholderPath,
      });
    } catch (error) {
      logger.error('Failed to remove unmatched placeholder', {
        label: 'PlaceholderService',
        title: sourceItem.title,
        tmdbId: sourceItem.tmdbId,
        placeholderPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (removedCount > 0) {
    logger.info('Triggering Plex scan to clean up unmatched placeholders', {
      label: 'PlaceholderService',
      libraryId: config.libraryId,
      removedCount,
    });

    try {
      await plexClient.scanLibrary(config.libraryId);
    } catch (error) {
      logger.warn(
        'Failed to trigger cleanup scan after removing unmatched placeholders',
        {
          label: 'PlaceholderService',
          libraryId: config.libraryId,
          removedCount,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }
}

/**
 * Handle unmatched placeholders - search by title and cleanup if truly unmatched
 * This is a fallback for when Plex doesn't match items with TMDB metadata
 * Optimized: Deletes all unmatched files immediately and triggers ONE cleanup scan at the end
 */
async function handleUnmatchedPlaceholders(
  unmatchedItems: ComingSoonSourceData[],
  config: CollectionConfig,
  plexClient: PlexAPI,
  discovered: Map<number, { ratingKey: string; title: string }>,
  excludedUnmatched: Set<number>,
  placeholderPathMap: Map<number, string>
): Promise<void> {
  const { removePlaceholder } = await import(
    '@server/lib/comingsoon/placeholderManager'
  );

  logger.info('Attempting title-based search for unmatched items', {
    label: 'PlaceholderService',
    unmatchedCount: unmatchedItems.length,
  });

  const filesToDelete: {
    path: string;
    mediaType: 'movie' | 'tv';
    title: string;
    tmdbId: number;
  }[] = [];

  // First pass: Check all items and collect files to delete
  for (const item of unmatchedItems) {
    try {
      // Search Plex by title
      const titleMatches = await findPlexItemsByTitle(
        plexClient,
        item.title,
        item.year,
        config.libraryId,
        item.mediaType
      );

      if (titleMatches.length === 0) {
        // Not found in Plex at all - likely still scanning or failed to create
        logger.debug('No title matches found in Plex', {
          label: 'PlaceholderService',
          title: item.title,
          year: item.year,
          tmdbId: item.tmdbId,
        });
        continue;
      }

      // Check if any matches are unmatched in Plex (no TMDB guid)
      const unmatchedInPlex = titleMatches.filter(
        (match) => !match.hasTmdbGuid
      );

      if (unmatchedInPlex.length > 0) {
        // Found the placeholder in Plex, but it's unmatched - schedule for deletion
        const match = unmatchedInPlex[0];
        const placeholderPath = placeholderPathMap.get(item.tmdbId);

        if (!placeholderPath) {
          logger.warn('No placeholder path found for unmatched item', {
            label: 'PlaceholderService',
            title: item.title,
            tmdbId: item.tmdbId,
          });
          continue;
        }

        logger.warn(
          'Placeholder found in Plex but unmatched (no TMDB guid) - scheduling for deletion',
          {
            label: 'PlaceholderService',
            title: item.title,
            year: item.year,
            tmdbId: item.tmdbId,
            plexTitle: match.title,
            plexYear: match.year,
            placeholderPath,
          }
        );

        filesToDelete.push({
          path: placeholderPath,
          mediaType: item.mediaType,
          title: item.title,
          tmdbId: item.tmdbId,
        });
      } else if (titleMatches.length > 0) {
        // Found matched items - this is the "late match" case
        const match = titleMatches[0];
        logger.info(
          'Found item by title with TMDB guid - adding to discovered (late match)',
          {
            label: 'PlaceholderService',
            title: item.title,
            tmdbId: item.tmdbId,
            plexTitle: match.title,
            ratingKey: match.ratingKey,
          }
        );

        // Add to discovered map
        discovered.set(item.tmdbId, {
          ratingKey: match.ratingKey,
          title: match.title,
        });
      }
    } catch (error) {
      logger.error('Error during title-based search for unmatched item', {
        label: 'PlaceholderService',
        title: item.title,
        tmdbId: item.tmdbId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Second pass: Delete all unmatched files immediately
  if (filesToDelete.length > 0) {
    logger.info(
      `Deleting ${filesToDelete.length} unmatched placeholder files`,
      {
        label: 'PlaceholderService',
        fileCount: filesToDelete.length,
      }
    );

    let deletedCount = 0;
    for (const file of filesToDelete) {
      try {
        await removePlaceholder(file.path, file.mediaType);
        excludedUnmatched.add(file.tmdbId);
        deletedCount++;
        logger.debug('Deleted unmatched placeholder file', {
          label: 'PlaceholderService',
          title: file.title,
          path: file.path,
        });
      } catch (deleteError) {
        logger.error('Failed to delete unmatched placeholder file', {
          label: 'PlaceholderService',
          title: file.title,
          path: file.path,
          error:
            deleteError instanceof Error
              ? deleteError.message
              : String(deleteError),
        });
      }
    }

    // Trigger ONE cleanup scan after all deletions
    if (deletedCount > 0) {
      logger.info(
        `Triggering single cleanup scan after deleting ${deletedCount} unmatched placeholders`,
        {
          label: 'PlaceholderService',
          libraryId: config.libraryId,
          deletedCount,
        }
      );

      try {
        await plexClient.scanLibrary(config.libraryId);
      } catch (error) {
        logger.error('Failed to trigger cleanup scan after deletions', {
          label: 'PlaceholderService',
          libraryId: config.libraryId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  logger.info('Title-based fallback search completed', {
    label: 'PlaceholderService',
    totalProcessed: unmatchedItems.length,
    filesDeleted: filesToDelete.length,
    lateMatches: discovered.size,
    excluded: excludedUnmatched.size,
  });
}

/**
 * Wait for Plex to discover multiple items after a library scan
 */
async function waitForPlexDiscovery(
  placeholders: {
    sourceItem: ComingSoonSourceData;
    placeholderPath: string;
  }[],
  config: CollectionConfig,
  plexClient: PlexAPI
): Promise<Map<number, { ratingKey: string; title: string }>> {
  const sourceItems = placeholders.map((p) => p.sourceItem);
  const discovered = new Map<number, { ratingKey: string; title: string }>();
  const excludedUnmatched = new Set<number>(); // Track items found by title but unmatched
  const maxAttempts = 30; // 30 attempts * 10 seconds = 5 minutes max
  const pollInterval = 10000; // 10 seconds

  // Build a map of tmdbId -> placeholderPath for cleanup
  const placeholderPathMap = new Map<number, string>();
  for (const { sourceItem, placeholderPath } of placeholders) {
    placeholderPathMap.set(sourceItem.tmdbId, placeholderPath);
  }

  // Track when items stop appearing
  let itemsStartedAppearing = false;
  let consecutiveNoDiscovery = 0; // Count of consecutive polls with no new discoveries
  const minTimeBeforeFallback = 60000; // 60 seconds (6 attempts) - optimized for faster detection
  const waitCyclesAfterStop = 1; // Wait 1 more cycle after items stop - reduced wait time

  logger.info('Polling Plex for placeholder discovery', {
    label: 'PlaceholderService',
    itemCount: sourceItems.length,
  });

  // Wait 10 seconds before first check to give Plex auto-detection a chance to work
  await new Promise((resolve) => setTimeout(resolve, 10000));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const previousSize = discovered.size;

    // Build lookup array for items we haven't found yet (excluding already excluded unmatched items)
    const stillMissing = sourceItems.filter(
      (item) =>
        !discovered.has(item.tmdbId) && !excludedUnmatched.has(item.tmdbId)
    );

    if (stillMissing.length === 0) {
      logger.info('All placeholders discovered by Plex', {
        label: 'PlaceholderService',
        attempt,
        totalItems: sourceItems.length,
        excludedUnmatched: excludedUnmatched.size,
      });
      break;
    }

    const tmdbLookups = stillMissing.map((item) => ({
      tmdbId: item.tmdbId,
      mediaType: item.mediaType,
      title: item.title,
    }));

    // Check if Plex has discovered the items by TMDB ID
    const itemMap = await findPlexItemsByTmdbIds(
      plexClient,
      tmdbLookups,
      config.libraryId
    );

    logger.debug('Poll attempt results', {
      label: 'PlaceholderService',
      attempt,
      itemMapSize: itemMap.size,
      itemMapKeys: Array.from(itemMap.keys()),
      lookingFor: stillMissing.map((i) => ({
        tmdbId: i.tmdbId,
        title: i.title,
      })),
    });

    // Add newly discovered items
    for (const item of stillMissing) {
      // The key format is: tmdbId-mediaType (e.g., "66732-tv")
      const tmdbKey = `${item.tmdbId}-${item.mediaType}`;
      const plexItem = itemMap.get(tmdbKey);
      if (plexItem) {
        discovered.set(item.tmdbId, plexItem);
        logger.debug('Plex discovered placeholder', {
          label: 'PlaceholderService',
          title: item.title,
          attempt,
        });
      } else {
        logger.debug('Item not found in map', {
          label: 'PlaceholderService',
          title: item.title,
          tmdbKey,
          attempt,
        });
      }
    }

    // Track discovery progress
    if (discovered.size > previousSize) {
      // New items were discovered
      if (!itemsStartedAppearing) {
        itemsStartedAppearing = true;
        logger.info('Items started appearing in Plex', {
          label: 'PlaceholderService',
          attempt,
          elapsed: attempt * 10,
        });
      }
      consecutiveNoDiscovery = 0; // Reset counter
    } else if (itemsStartedAppearing) {
      // No new items found, and items had started appearing before
      consecutiveNoDiscovery++;
      logger.debug('No new discoveries this cycle', {
        label: 'PlaceholderService',
        attempt,
        consecutiveNoDiscovery,
      });
    }

    // Check if all found or need to continue
    if (discovered.size === sourceItems.length) {
      logger.info('All placeholders discovered by Plex', {
        label: 'PlaceholderService',
        attempt,
        totalItems: sourceItems.length,
      });
      break;
    }

    // Title-based fallback logic
    // After items have been appearing for at least 60 seconds (6 attempts)
    // AND items have stopped appearing for 1 consecutive cycle (10 seconds)
    const elapsedTime = attempt * pollInterval;
    const shouldAttemptFallback =
      itemsStartedAppearing &&
      elapsedTime >= minTimeBeforeFallback &&
      consecutiveNoDiscovery >= waitCyclesAfterStop;

    if (shouldAttemptFallback && stillMissing.length > 0) {
      logger.info(
        'Items stopped appearing - attempting title-based fallback search and cleanup for unmatched placeholders',
        {
          label: 'PlaceholderService',
          attempt,
          elapsed: elapsedTime / 1000,
          stillMissingCount: stillMissing.length,
          consecutiveNoDiscovery,
        }
      );

      // Attempt title-based search and immediate cleanup for unmatched items
      await handleUnmatchedPlaceholders(
        stillMissing,
        config,
        plexClient,
        discovered,
        excludedUnmatched,
        placeholderPathMap
      );

      // After fallback, break immediately - remaining items won't match
      logger.info('Title-based fallback completed - ending discovery', {
        label: 'PlaceholderService',
        attempt,
        totalItems: sourceItems.length,
        discovered: discovered.size,
        excludedUnmatched: excludedUnmatched.size,
        remainingUnmatched: stillMissing.length - excludedUnmatched.size,
      });
      break;
    }

    // Wait before next check (except on last attempt)
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
  }

  if (discovered.size + excludedUnmatched.size < sourceItems.length) {
    logger.warn('Some placeholders were not resolved by Plex after polling', {
      label: 'PlaceholderService',
      totalItems: sourceItems.length,
      discovered: discovered.size,
      excludedUnmatched: excludedUnmatched.size,
      missing: sourceItems.length - discovered.size - excludedUnmatched.size,
    });
  }

  return discovered;
}

/**
 * Create placeholders for missing items
 * Strategy: Create ALL files first, then trigger ONE scan, then apply overlays
 * Returns the discovered placeholder items as CollectionItems
 */
async function createPlaceholders(
  missingItems: MissingItem[],
  sourceData: ComingSoonSourceData[],
  config: CollectionConfig,
  plexClient: PlexAPI
): Promise<CollectionItem[]> {
  if (missingItems.length === 0) {
    return [];
  }

  logger.info('Creating placeholders for missing items', {
    label: 'PlaceholderService',
    count: missingItems.length,
  });

  const sourceMap = new Map(sourceData.map((s) => [s.tmdbId, s]));

  // Step 0: Pre-filter items - only create placeholders for items with posters available
  const TmdbAPI = (await import('@server/api/themoviedb')).default;
  const tmdbClient = new TmdbAPI();
  const itemsWithPosters: MissingItem[] = [];

  logger.info('Checking TMDB for poster availability', {
    label: 'PlaceholderService',
    count: missingItems.length,
  });

  for (const missingItem of missingItems) {
    const sourceItem = sourceMap.get(missingItem.tmdbId);
    if (!sourceItem) {
      continue;
    }

    try {
      let hasPoster = false;

      if (sourceItem.mediaType === 'movie') {
        const movieDetails = await tmdbClient.getMovie({
          movieId: sourceItem.tmdbId,
        });
        hasPoster = !!movieDetails.poster_path;
      } else {
        const showDetails = await tmdbClient.getTvShow({
          tvId: sourceItem.tmdbId,
        });
        hasPoster = !!showDetails.poster_path;
      }

      if (hasPoster) {
        itemsWithPosters.push(missingItem);
      } else {
        logger.info('Skipping placeholder creation - no poster available', {
          label: 'PlaceholderService',
          title: sourceItem.title,
          tmdbId: sourceItem.tmdbId,
          mediaType: sourceItem.mediaType,
        });
      }
    } catch (error) {
      logger.warn('Failed to check poster availability, skipping item', {
        label: 'PlaceholderService',
        title: sourceItem.title,
        tmdbId: sourceItem.tmdbId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (itemsWithPosters.length === 0) {
    logger.info(
      'No items with posters available, skipping placeholder creation',
      {
        label: 'PlaceholderService',
        originalCount: missingItems.length,
      }
    );
    return [];
  }

  logger.info('Creating placeholders for items with posters', {
    label: 'PlaceholderService',
    count: itemsWithPosters.length,
    skipped: missingItems.length - itemsWithPosters.length,
  });

  // Step 1: Create ALL placeholder files (without scanning/overlays)
  const createdPlaceholders: {
    sourceItem: ComingSoonSourceData;
    placeholderPath: string;
  }[] = [];

  for (const missingItem of itemsWithPosters) {
    const sourceItem = sourceMap.get(missingItem.tmdbId);
    if (!sourceItem) {
      continue;
    }

    try {
      const placeholderPath = await createPlaceholderFile(sourceItem);

      createdPlaceholders.push({ sourceItem, placeholderPath });

      logger.info('Created placeholder file', {
        label: 'PlaceholderService',
        title: sourceItem.title,
        path: placeholderPath,
      });
    } catch (error) {
      logger.error('Failed to create placeholder file', {
        label: 'PlaceholderService',
        title: sourceItem.title,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (createdPlaceholders.length === 0) {
    logger.warn('No placeholder files were created', {
      label: 'PlaceholderService',
    });
    return [];
  }

  // Step 2: Trigger ONE Plex library scan for all files
  logger.info('Triggering Plex library scan for all placeholders', {
    label: 'PlaceholderService',
    libraryId: config.libraryId,
    fileCount: createdPlaceholders.length,
  });

  await plexClient.scanLibrary(config.libraryId);

  // Step 3: Poll for ALL items to be discovered
  const discoveredItemsMap = await waitForPlexDiscovery(
    createdPlaceholders,
    config,
    plexClient
  );

  const matchedPlaceholders = createdPlaceholders.filter((placeholder) =>
    discoveredItemsMap.has(placeholder.sourceItem.tmdbId)
  );
  const unmatchedPlaceholders = createdPlaceholders.filter(
    (placeholder) => !discoveredItemsMap.has(placeholder.sourceItem.tmdbId)
  );

  if (unmatchedPlaceholders.length > 0) {
    await removeUnmatchedPlaceholders(
      unmatchedPlaceholders,
      config,
      plexClient
    );
  }

  // Step 4: Apply overlays to discovered items using the unified overlay system
  if (matchedPlaceholders.length > 0) {
    const { overlayLibraryService } = await import(
      '@server/lib/overlays/OverlayLibraryService'
    );

    // Build overlay items with Coming Soon context overrides
    const overlayItems: OverlayItemInput[] = [];

    for (const { sourceItem } of matchedPlaceholders) {
      const plexItem = discoveredItemsMap.get(sourceItem.tmdbId);
      if (!plexItem) continue;

      // Calculate days until release
      const releaseDate = sourceItem.releaseDate || sourceItem.airDate;
      const daysUntilRelease = releaseDate
        ? Math.ceil(
            (new Date(releaseDate).getTime() - Date.now()) /
              (1000 * 60 * 60 * 24)
          )
        : undefined;

      overlayItems.push({
        ratingKey: plexItem.ratingKey,
        contextOverrides: {
          // Coming Soon specific fields
          releaseDate,
          daysUntilRelease,
          seasonNumber: sourceItem.seasonNumber,
          episodeNumber: sourceItem.episodeNumber,
          isMonitored: sourceItem.monitored,
          downloaded: sourceItem.hasFile,
          itemType: 'placeholder',
          mediaType: sourceItem.mediaType === 'movie' ? 'movie' : 'show',
        },
      });
    }

    if (overlayItems.length > 0) {
      await overlayLibraryService.applyOverlaysToCollectionItems(
        overlayItems,
        config.libraryId
      );
    }
  } else {
    logger.warn('No placeholders matched in Plex after creation', {
      label: 'PlaceholderService',
      count: createdPlaceholders.length,
    });
  }

  // Step 5: Set metadata markers and save to database for cleanup tracking
  const repository = getRepository(ComingSoonItem);

  for (const { sourceItem, placeholderPath } of matchedPlaceholders) {
    const plexItem = discoveredItemsMap.get(sourceItem.tmdbId);
    if (!plexItem) continue;

    try {
      // Set metadata markers for Recently Added filtering
      if (sourceItem.mediaType === 'tv') {
        // For TV shows: Need to set title on the episode (S00E00)
        const seasons = await plexClient.getChildrenMetadata(
          plexItem.ratingKey
        );

        if (seasons && seasons.length > 0) {
          const season00 = seasons.find((season) => season.index === 0);

          if (season00) {
            const episodesData = await plexClient.getChildrenMetadata(
              season00.ratingKey
            );
            if (episodesData && episodesData.length > 0) {
              const episode = episodesData[0];
              await plexClient.updateItemTitle(
                episode.ratingKey,
                'Trailer (Placeholder)'
              );
              logger.debug('Set placeholder episode title', {
                label: 'PlaceholderService',
                title: sourceItem.title,
                episodeRatingKey: episode.ratingKey,
              });
            } else {
              logger.warn(
                'No episodes found in Season 00 - cannot set placeholder title',
                {
                  label: 'PlaceholderService',
                  title: sourceItem.title,
                  season00RatingKey: season00.ratingKey,
                }
              );
            }
          } else {
            logger.warn('Season 00 not found - cannot set placeholder title', {
              label: 'PlaceholderService',
              title: sourceItem.title,
              availableSeasons: seasons.map((s) => s.index),
            });
          }
        } else {
          logger.warn(
            'No seasons found for show - cannot set placeholder title',
            {
              label: 'PlaceholderService',
              title: sourceItem.title,
              ratingKey: plexItem.ratingKey,
            }
          );
        }
      } else if (sourceItem.mediaType === 'movie') {
        // For movies: Add label to the movie item
        await plexClient.addLabelToItem(
          plexItem.ratingKey,
          'trailer-placeholder'
        );
        logger.debug('Added placeholder label to movie', {
          label: 'PlaceholderService',
          title: sourceItem.title,
          ratingKey: plexItem.ratingKey,
        });
      }

      // Save placeholder to database for cleanup tracking
      const placeholderRecord = repository.create({
        configId: config.id,
        mediaType: sourceItem.mediaType,
        tmdbId: sourceItem.tmdbId,
        tvdbId: sourceItem.tvdbId,
        title: sourceItem.title,
        year: sourceItem.year,
        releaseDate: sourceItem.releaseDate,
        isEstimatedDate: sourceItem.isEstimatedDate || false,
        seasonNumber: sourceItem.seasonNumber,
        source: sourceItem.source,
        placeholderPath: placeholderPath,
        plexRatingKey: plexItem.ratingKey,
      });

      await repository.save(placeholderRecord);

      logger.debug('Saved placeholder to database', {
        label: 'PlaceholderService',
        title: sourceItem.title,
      });
    } catch (error) {
      logger.error('Failed to set metadata markers for placeholder', {
        label: 'PlaceholderService',
        title: sourceItem.title,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Step 6: Convert discovered items to CollectionItem format
  // Create a map of tmdbId -> originalPosition to preserve source order
  const positionMap = new Map<number, number>(
    missingItems
      .filter((item) => item.originalPosition !== undefined)
      .map((item) => [item.tmdbId, item.originalPosition as number])
  );

  const collectionItems: CollectionItem[] = [];
  for (const [tmdbId, plexItem] of discoveredItemsMap) {
    const sourceItem = sourceMap.get(tmdbId);
    if (sourceItem) {
      collectionItems.push({
        ratingKey: plexItem.ratingKey,
        title: plexItem.title,
        type: sourceItem.mediaType,
        tmdbId: tmdbId,
      });
    }
  }

  // Sort by original position to preserve source list order
  // This ensures placeholder items appear in the same order as they were in the source
  // Items without originalPosition will appear at the end
  if (positionMap.size > 0) {
    collectionItems.sort((a, b) => {
      // Get positions, handling undefined tmdbId
      const posA =
        a.tmdbId !== undefined ? positionMap.get(a.tmdbId) : undefined;
      const posB =
        b.tmdbId !== undefined ? positionMap.get(b.tmdbId) : undefined;

      // Items without position go to the end
      if (posA === undefined && posB === undefined) return 0;
      if (posA === undefined) return 1;
      if (posB === undefined) return -1;

      return posA - posB;
    });
  }

  logger.info('Returning discovered placeholder items in source order', {
    label: 'PlaceholderService',
    itemCount: collectionItems.length,
  });

  return collectionItems;
}

/**
 * Process missing items as placeholders for a collection
 * This is the main entry point for any collection type wanting to create placeholders
 */
export async function processPlaceholdersForMissingItems(
  missingItems: MissingItem[],
  config: CollectionConfig,
  plexClient: PlexAPI
): Promise<CollectionItem[]> {
  if (!isPlaceholderCreationEnabled(config)) {
    return [];
  }

  if (missingItems.length === 0) {
    return [];
  }

  // For normal collections (not Coming Soon), create placeholders for ALL missing items
  // For Coming Soon collections, only create placeholders for items with release dates
  const isComingSoonCollection = config.type === 'comingsoon';

  // Convert missing items to placeholder source data
  const sourceData = missingItemsToPlaceholderSourceData(
    missingItems,
    isComingSoonCollection // Only require release dates for Coming Soon collections
  );

  if (sourceData.length === 0) {
    const message = isComingSoonCollection
      ? 'No missing items have sufficient release date metadata for placeholder creation'
      : 'No missing items to create placeholders for';

    logger.info(message, {
      label: 'PlaceholderService',
      configName: config.name,
      originalCount: missingItems.length,
      collectionType: config.type,
    });
    return [];
  }

  logger.info('Creating placeholders for missing items', {
    label: 'PlaceholderService',
    configName: config.name,
    itemCount: sourceData.length,
    skippedNoReleaseDate: missingItems.length - sourceData.length,
    collectionType: config.type,
  });

  // Filter missingItems to only those that have sourceData
  const tmdbIdsWithSourceData = new Set(sourceData.map((s) => s.tmdbId));
  const filteredMissingItems = missingItems.filter((item) =>
    tmdbIdsWithSourceData.has(item.tmdbId)
  );

  // Call the internal placeholder creation logic
  return createPlaceholders(
    filteredMissingItems,
    sourceData,
    config,
    plexClient
  );
}

export default {
  processPlaceholdersForMissingItems,
  isPlaceholderCreationEnabled,
  getReleasedDays,
  getDaysAhead,
};
