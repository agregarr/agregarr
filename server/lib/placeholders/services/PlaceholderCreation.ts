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
import type { CollectionConfig, Library } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import path from 'path';
import { ensurePlaceholderEpisodeTitle } from './PlaceholderTitleFixer';

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

  // Enrich source data with TMDB release dates for items that don't have them
  // This is critical for regular collections (IMDb, Trakt, Letterboxd) which don't populate release dates
  const { enrichWithTMDBReleaseDates } = await import(
    '@server/lib/collections/sources/comingsoon/comingSoonFetch'
  );
  const daysAhead = getDaysAhead(config);
  await enrichWithTMDBReleaseDates(sourceData, daysAhead);

  // Filter by days ahead - only create placeholders for items releasing within the configured window
  const { isDateWithinDays, determineReleaseDate } = await import(
    '@server/utils/dateHelpers'
  );

  const filteredSourceData = sourceData.filter((item) => {
    // Determine the effective release date to check
    let releaseDateToCheck: string | undefined;

    if (item.mediaType === 'movie') {
      // Use the shared determineReleaseDate function which handles:
      // Priority 1: Digital release
      // Priority 2: Physical release
      // Priority 3: Theatrical + 90 days estimate
      const result = determineReleaseDate(
        item.digitalRelease,
        item.physicalRelease,
        item.inCinemas
      );
      if (result) {
        releaseDateToCheck = result.releaseDate;
      } else if (item.releaseDate) {
        // Fallback to generic release date if specific dates unavailable
        releaseDateToCheck = item.releaseDate;
      }
    } else if (item.mediaType === 'tv') {
      // For TV: use air date
      releaseDateToCheck = item.airDate;
    }

    // If no release date after TMDB enrichment, exclude the item
    // This prevents creating placeholders for items with unknown release dates
    // when user has specified a specific days ahead window
    if (!releaseDateToCheck) {
      logger.debug(
        'Skipping placeholder creation - no release date available after TMDB enrichment',
        {
          label: 'PlaceholderService',
          title: item.title,
          tmdbId: item.tmdbId,
          mediaType: item.mediaType,
          configName: config.name,
        }
      );
      return false;
    }

    // Check if release date is within the configured window
    const withinWindow = isDateWithinDays(releaseDateToCheck, daysAhead);

    if (!withinWindow) {
      logger.debug(
        'Skipping placeholder creation - release date too far ahead',
        {
          label: 'PlaceholderService',
          title: item.title,
          releaseDate: releaseDateToCheck,
          daysAhead,
          configName: config.name,
        }
      );
    }

    return withinWindow;
  });

  const skippedByDateFilter = sourceData.length - filteredSourceData.length;

  if (filteredSourceData.length === 0) {
    logger.info(
      'No items within configured days ahead window for placeholder creation',
      {
        label: 'PlaceholderService',
        configName: config.name,
        originalCount: missingItems.length,
        skippedNoReleaseDateMetadata: missingItems.length - sourceData.length,
        skippedByDateFilter,
        daysAhead,
        collectionType: config.type,
      }
    );
    return [];
  }

  logger.info('Creating placeholders for missing items', {
    label: 'PlaceholderService',
    configName: config.name,
    itemCount: filteredSourceData.length,
    skippedNoReleaseDateMetadata: missingItems.length - sourceData.length,
    skippedByDateFilter,
    daysAhead,
    collectionType: config.type,
  });

  // Filter missingItems to only those that have filteredSourceData
  const tmdbIdsWithSourceData = new Set(
    filteredSourceData.map((s) => s.tmdbId)
  );
  const filteredMissingItems = missingItems.filter((item) =>
    tmdbIdsWithSourceData.has(item.tmdbId)
  );

  // Call the internal placeholder creation logic
  return createPlaceholders(
    filteredMissingItems,
    filteredSourceData,
    config,
    plexClient
  );
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
      source: item.source,
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
 * Create a single placeholder file without scanning or applying overlays
 * Returns the path to the created file
 */
async function createPlaceholderFile(
  sourceItem: ComingSoonSourceData,
  libraryKey: string
): Promise<string> {
  const { downloadTrailer } = await import(
    '@server/lib/placeholders/trailerDownload'
  );
  const { createPlaceholder } = await import(
    '@server/lib/placeholders/placeholderManager'
  );

  // 1. Download trailer
  const trailerPath = await downloadTrailer(
    sourceItem.title,
    sourceItem.year,
    sourceItem.mediaType
  );

  // 2. Get library-specific placeholder root folder
  const { getPlaceholderRootFolder } = await import(
    '@server/lib/placeholders/helpers/placeholderPathHelpers'
  );

  const libraryPath = getPlaceholderRootFolder(
    libraryKey,
    sourceItem.mediaType
  );

  if (!libraryPath) {
    // Get library name for better error message
    const settings = getSettings();
    const library = settings.plex.libraries?.find(
      (lib: Library) => lib.key === libraryKey
    );
    const libraryName = library?.name || `Library ${libraryKey}`;
    const mediaTypeLabel = sourceItem.mediaType === 'movie' ? 'Movie' : 'TV';

    throw new Error(
      `${mediaTypeLabel} placeholder root folder not configured for "${libraryName}". Please configure it in Settings > Downloads > ${mediaTypeLabel} Placeholder Folders.`
    );
  }

  logger.debug(
    `Using configured ${sourceItem.mediaType} root folder for placeholder creation`,
    {
      label: 'PlaceholderService',
      libraryKey,
      rootFolder: libraryPath,
    }
  );

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
    '@server/lib/placeholders/placeholderManager'
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
    '@server/lib/placeholders/placeholderManager'
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
 * Verify that discovered placeholders have posters in Plex
 * If Plex has no poster but TMDB does, apply the TMDB poster directly
 */
async function verifyPlexPosters(
  discovered: Map<number, { ratingKey: string; title: string }>,
  config: CollectionConfig,
  plexClient: PlexAPI,
  placeholderPathMap: Map<number, string>,
  sourceMap: Map<number, ComingSoonSourceData>
): Promise<Map<number, { ratingKey: string; title: string }>> {
  const TmdbAPI = (await import('@server/api/themoviedb')).default;
  const tmdbClient = new TmdbAPI();

  let postersApplied = 0;
  let postersAlreadyPresent = 0;

  logger.info('Verifying Plex posters for discovered placeholders', {
    label: 'PlaceholderService',
    itemCount: discovered.size,
  });

  // Check each discovered item for poster
  for (const [tmdbId, plexItem] of discovered) {
    try {
      const metadata = await plexClient.getMetadata(plexItem.ratingKey);

      if (!metadata.thumb) {
        const sourceItem = sourceMap.get(tmdbId);

        if (sourceItem) {
          logger.info(
            'Placeholder has no poster in Plex - applying TMDB poster',
            {
              label: 'PlaceholderService',
              title: plexItem.title,
              tmdbId,
              ratingKey: plexItem.ratingKey,
              mediaType: sourceItem.mediaType,
            }
          );

          // Fetch TMDB poster URL
          let posterPath: string | undefined;

          if (sourceItem.mediaType === 'movie') {
            const movieDetails = await tmdbClient.getMovie({
              movieId: tmdbId,
            });
            posterPath = movieDetails.poster_path;
          } else {
            const showDetails = await tmdbClient.getTvShow({
              tvId: tmdbId,
            });
            posterPath = showDetails.poster_path;
          }

          if (posterPath) {
            const tmdbPosterUrl = `https://image.tmdb.org/t/p/original${posterPath}`;

            // Apply TMDB poster to Plex item
            const posterManager = plexClient['posterManager'];
            await posterManager.uploadPosterFromUrl(
              plexItem.ratingKey,
              tmdbPosterUrl
            );

            postersApplied++;

            logger.info('Successfully applied TMDB poster to placeholder', {
              label: 'PlaceholderService',
              title: plexItem.title,
              tmdbId,
              ratingKey: plexItem.ratingKey,
            });
          } else {
            // This shouldn't happen since we pre-filter for TMDB posters,
            // but log it just in case
            logger.warn(
              'TMDB has no poster for item (unexpected - pre-filter should have caught this)',
              {
                label: 'PlaceholderService',
                title: plexItem.title,
                tmdbId,
                mediaType: sourceItem.mediaType,
              }
            );
          }
        }
      } else {
        postersAlreadyPresent++;
      }
    } catch (error) {
      logger.error('Failed to verify/apply poster', {
        label: 'PlaceholderService',
        title: plexItem.title,
        tmdbId,
        ratingKey: plexItem.ratingKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info('Poster verification complete', {
    label: 'PlaceholderService',
    totalChecked: discovered.size,
    postersAlreadyPresent,
    postersApplied,
  });

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

  // Step 0.5: Check for existing orphaned placeholders in Plex and adopt them
  // This fixes placeholders that lost their database records
  const { placeholderContextService } = await import(
    '@server/lib/placeholders/services/PlaceholderContextService'
  );

  logger.info('Checking Plex for existing orphaned placeholders', {
    label: 'PlaceholderService',
    libraryId: config.libraryId,
  });

  // Get all items in the library
  const libraryItems = await plexClient.getLibraryContents(config.libraryId);
  const orphanedPlaceholders: {
    sourceItem: ComingSoonSourceData;
    plexItem: { ratingKey: string; title: string };
    placeholderPath: string;
  }[] = [];
  let deletedOrphanCount = 0;

  // Get ALL existing database records to check for orphans
  // CRITICAL: Must query ALL records, not just current config, to avoid deleting
  // placeholders that belong to other collections
  const placeholderRepository = getRepository(ComingSoonItem);
  const existingRecords = await placeholderRepository.find();
  const existingByTmdbId = new Map(existingRecords.map((r) => [r.tmdbId, r]));

  // Check each library item to see if it's an orphaned placeholder
  for (const item of libraryItems.items) {
    // Check if this is a placeholder using PlaceholderContextService
    const itemExtended = item as {
      type: string;
      guid?: string;
      editionTitle?: string;
      Guid?: { id: string }[];
      childCount?: number;
      Children?: { Metadata?: unknown[] };
      seasonCount?: number;
      leafCount?: number;
    };

    const isPlaceholder = placeholderContextService.isPlaceholderItem({
      type: itemExtended.type,
      guid: itemExtended.guid,
      editionTitle: itemExtended.editionTitle,
      Guid: itemExtended.Guid,
      childCount: itemExtended.childCount,
      Children: itemExtended.Children,
      seasonCount: itemExtended.seasonCount,
      leafCount: itemExtended.leafCount,
    });

    if (!isPlaceholder) {
      continue;
    }

    // For TV placeholders, ensure episode title is correct
    if (itemExtended.type === 'show') {
      await ensurePlaceholderEpisodeTitle(
        plexClient,
        item.ratingKey,
        item.title
      );
    }

    // Extract TMDB ID from Plex item
    let tmdbId: number | undefined;
    if (item.Guid && Array.isArray(item.Guid)) {
      const tmdbGuid = item.Guid.find((g: { id?: string }) =>
        g.id?.includes('tmdb://')
      );
      if (tmdbGuid) {
        const match = tmdbGuid.id.match(/tmdb:\/\/(\d+)/);
        if (match) {
          tmdbId = parseInt(match[1], 10);
        }
      }
    }

    if (!tmdbId) {
      continue;
    }

    // Check if it has a database record
    const hasRecord = existingByTmdbId.has(tmdbId);

    if (!hasRecord) {
      // Check if this placeholder is in our source data
      const sourceItem = sourceMap.get(tmdbId);
      if (!sourceItem) {
        // Orphaned placeholder not in our source - DELETE IMMEDIATELY
        logger.warn('Found orphaned placeholder - deleting immediately', {
          label: 'PlaceholderService',
          title: item.title,
          tmdbId,
          ratingKey: item.ratingKey,
        });

        // Get placeholder file path for deletion
        let placeholderPath = '';
        try {
          if (itemExtended.type === 'movie') {
            // Get movie file path
            const fullMetadata = await plexClient.getMetadata(item.ratingKey);
            if (fullMetadata.Media?.[0]?.Part?.[0]?.file) {
              placeholderPath = fullMetadata.Media[0].Part[0].file;
            }
          } else {
            // Get TV show file path from Season 00 Episode 01
            const fullMetadata = await plexClient.getMetadata(item.ratingKey);
            const seasons = fullMetadata.Children?.Metadata;
            const season00 = seasons?.find(
              (s: { index?: number }) => s.index === 0
            );

            if (season00 && 'ratingKey' in season00) {
              const seasonMetadata = await plexClient.getMetadata(
                String(season00.ratingKey)
              );
              const firstEpisode = seasonMetadata.Children?.Metadata?.[0];

              if (firstEpisode && 'ratingKey' in firstEpisode) {
                const episodeMetadata = await plexClient.getMetadata(
                  String(firstEpisode.ratingKey)
                );
                if (episodeMetadata.Media?.[0]?.Part?.[0]?.file) {
                  placeholderPath = episodeMetadata.Media[0].Part[0].file;
                }
              }
            }
          }

          // Delete placeholder file
          if (placeholderPath) {
            const { removePlaceholder } = await import(
              '@server/lib/placeholders/placeholderManager'
            );
            const { getPlaceholderRootFolder } = await import(
              '@server/lib/placeholders/helpers/placeholderPathHelpers'
            );
            const mediaType: 'movie' | 'tv' =
              itemExtended.type === 'movie' ? 'movie' : 'tv';
            const libraryPath = getPlaceholderRootFolder(
              config.libraryId,
              mediaType
            );

            if (libraryPath) {
              // Extract relative path from Plex path by taking last N parts
              // This works regardless of path separators (Windows \ vs Linux /)
              // and handles cases where Plex runs on different OS than Agregarr
              const pathParts = placeholderPath.split(/[/\\]/).filter((p) => p);

              let relativePath = '';
              if (itemExtended.type === 'movie') {
                // Movies: last 2 parts (folder + filename)
                relativePath = pathParts.slice(-2).join(path.sep);
              } else {
                // TV: last 3 parts (show folder + Season 00 + filename)
                relativePath = pathParts.slice(-3).join(path.sep);
              }

              const fullPath = path.join(libraryPath, relativePath);

              await removePlaceholder(
                fullPath,
                itemExtended.type === 'movie' ? 'movie' : 'tv'
              );
              deletedOrphanCount++;
              logger.info('Deleted orphaned placeholder file', {
                label: 'PlaceholderService',
                title: item.title,
                path: relativePath,
              });
            }
          }
        } catch (error) {
          logger.error('Failed to delete orphaned placeholder', {
            label: 'PlaceholderService',
            title: item.title,
            tmdbId,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        continue; // Skip to next item - orphan has been deleted
      }
    } else {
      // Has database record - check if it's in our source
      const sourceItem = sourceMap.get(tmdbId);
      if (!sourceItem) {
        continue; // Already has DB record but not in our source - cleanup will handle it
      }
    }

    // Get sourceItem (either from original source or newly created for orphaned)
    const sourceItem = sourceMap.get(tmdbId);
    if (!sourceItem) {
      continue; // Shouldn't happen, but safety check
    }

    if (!hasRecord) {
      // This is an orphaned placeholder - it exists in Plex but has no database record
      logger.warn('Found orphaned placeholder in Plex - will adopt it', {
        label: 'PlaceholderService',
        title: item.title,
        tmdbId,
        ratingKey: item.ratingKey,
      });

      // Get the placeholder file path
      let placeholderPath = '';
      try {
        let plexFilePath = '';

        if (sourceItem.mediaType === 'movie') {
          // For movies, get file path directly from metadata
          const fullMetadata = await plexClient.getMetadata(item.ratingKey);

          if (
            fullMetadata.Media &&
            Array.isArray(fullMetadata.Media) &&
            fullMetadata.Media.length > 0
          ) {
            const media = fullMetadata.Media[0];
            if (
              media.Part &&
              Array.isArray(media.Part) &&
              media.Part.length > 0
            ) {
              plexFilePath = media.Part[0].file || '';
            }
          }
        } else {
          // For TV shows, we need to get an episode from Season 00
          // Show-level items don't have Media/Part, only episodes do
          const fullMetadata = await plexClient.getMetadata(item.ratingKey);

          // Get children (seasons)
          if (!fullMetadata.Children?.Metadata) {
            logger.warn('Could not extract file path - no Children.Metadata', {
              label: 'PlaceholderService',
              title: item.title,
              ratingKey: item.ratingKey,
            });
            continue;
          }

          const seasons = fullMetadata.Children.Metadata;

          // Find Season 00
          const season00 = seasons.find(
            (s: { index?: number }) => s.index === 0
          );

          if (!season00 || !('ratingKey' in season00)) {
            logger.warn('Could not extract file path - no Season 00 found', {
              label: 'PlaceholderService',
              title: item.title,
              seasonCount: seasons.length,
            });
            continue;
          }

          // Get episodes from Season 00
          const seasonMetadata = await plexClient.getMetadata(
            String(season00.ratingKey)
          );

          if (
            !seasonMetadata.Children?.Metadata ||
            seasonMetadata.Children.Metadata.length === 0
          ) {
            logger.warn(
              'Could not extract file path - Season 00 has no episodes',
              {
                label: 'PlaceholderService',
                title: item.title,
                season00RatingKey: season00.ratingKey,
              }
            );
            continue;
          }

          const firstEpisode = seasonMetadata.Children.Metadata[0];

          if (!('ratingKey' in firstEpisode)) {
            logger.warn(
              'Could not extract file path - episode has no ratingKey',
              {
                label: 'PlaceholderService',
                title: item.title,
              }
            );
            continue;
          }

          // Get file path from episode
          const episodeMetadata = await plexClient.getMetadata(
            String(firstEpisode.ratingKey)
          );

          if (
            !episodeMetadata.Media ||
            !Array.isArray(episodeMetadata.Media) ||
            episodeMetadata.Media.length === 0
          ) {
            logger.warn('Could not extract file path - episode has no Media', {
              label: 'PlaceholderService',
              title: item.title,
              episodeRatingKey: firstEpisode.ratingKey,
            });
            continue;
          }

          const media = episodeMetadata.Media[0];
          if (
            !media.Part ||
            !Array.isArray(media.Part) ||
            media.Part.length === 0
          ) {
            logger.warn('Could not extract file path - media has no Part', {
              label: 'PlaceholderService',
              title: item.title,
            });
            continue;
          }

          plexFilePath = media.Part[0].file || '';
        }

        if (!plexFilePath) {
          logger.warn('Could not extract file path - file is empty', {
            label: 'PlaceholderService',
            title: item.title,
            mediaType: sourceItem.mediaType,
          });
          continue;
        }

        // Extract relative path from Plex full path
        // Plex path: /plex/mount/tv/ShowName (Year)/Season 00/file.mp4 (Unix)
        // Plex path: E:\data\media\series\ShowName (Year)\Season 00\file.mp4 (Windows)
        // We need: ShowName (Year)/Season 00/file.mp4

        // Normalize path separators - handle both Unix (/) and Windows (\)
        const normalizedPath = plexFilePath.replace(/\\/g, '/');
        const pathParts = normalizedPath.split('/').filter((p) => p);

        let relativePath = '';
        if (sourceItem.mediaType === 'movie') {
          // Movies: Take last 2 parts (folder + filename)
          relativePath = pathParts.slice(-2).join('/');
        } else {
          // TV: Take last 3 parts (show folder + Season 00 + filename)
          relativePath = pathParts.slice(-3).join('/');
        }

        if (!relativePath) {
          logger.warn('Could not extract relative path', {
            label: 'PlaceholderService',
            title: item.title,
            plexFilePath,
          });
          continue;
        }

        // Verify file exists in our library
        const { getPlaceholderRootFolder } = await import(
          '@server/lib/placeholders/helpers/placeholderPathHelpers'
        );
        const libraryPath = getPlaceholderRootFolder(
          config.libraryId,
          sourceItem.mediaType
        );

        if (!libraryPath) {
          logger.warn('Placeholder library path not configured', {
            label: 'PlaceholderService',
            title: item.title,
            mediaType: sourceItem.mediaType,
            libraryId: config.libraryId,
          });
          continue;
        }

        const fullPath = path.join(libraryPath, relativePath);

        // Check if file exists
        const fs = await import('fs/promises');
        try {
          await fs.access(fullPath);
          placeholderPath = relativePath; // Store relative path

          logger.debug('Found orphaned placeholder file', {
            label: 'PlaceholderService',
            title: item.title,
            relativePath,
          });
        } catch {
          logger.warn('Orphaned placeholder file not found at expected path', {
            label: 'PlaceholderService',
            title: item.title,
            expectedPath: fullPath,
          });
          continue;
        }
      } catch (error) {
        logger.warn('Failed to locate placeholder file for orphaned item', {
          label: 'PlaceholderService',
          title: item.title,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      if (placeholderPath) {
        orphanedPlaceholders.push({
          sourceItem,
          plexItem: { ratingKey: item.ratingKey, title: item.title },
          placeholderPath,
        });

        // Remove from itemsWithPosters so we don't try to create a duplicate
        const indexToRemove = itemsWithPosters.findIndex(
          (mi) => mi.tmdbId === tmdbId
        );
        if (indexToRemove !== -1) {
          itemsWithPosters.splice(indexToRemove, 1);
        }
      }
    }
  }

  if (deletedOrphanCount > 0) {
    logger.info('Deleted orphaned placeholders', {
      label: 'PlaceholderService',
      count: deletedOrphanCount,
    });
  }

  if (orphanedPlaceholders.length > 0) {
    logger.info('Found orphaned placeholders to adopt', {
      label: 'PlaceholderService',
      count: orphanedPlaceholders.length,
    });
  }

  // Filter out items that already have placeholders (in database)
  // This prevents duplicate placeholder creation when multiple collections include the same item
  const itemsNeedingPlaceholders = itemsWithPosters.filter(
    (item) => !existingByTmdbId.has(item.tmdbId)
  );

  const skippedDuplicateCount =
    itemsWithPosters.length - itemsNeedingPlaceholders.length;
  if (skippedDuplicateCount > 0) {
    logger.info(
      'Skipping placeholder creation for items that already have placeholders',
      {
        label: 'PlaceholderService',
        count: skippedDuplicateCount,
      }
    );
  }

  // Step 1: Create ALL placeholder files (without scanning/overlays)
  const createdPlaceholders: {
    sourceItem: ComingSoonSourceData;
    placeholderPath: string;
  }[] = [];

  for (const missingItem of itemsNeedingPlaceholders) {
    const sourceItem = sourceMap.get(missingItem.tmdbId);
    if (!sourceItem) {
      continue;
    }

    try {
      const placeholderPath = await createPlaceholderFile(
        sourceItem,
        config.libraryId
      );

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

  // Check if we have any work to do (created or orphaned placeholders)
  if (createdPlaceholders.length === 0 && orphanedPlaceholders.length === 0) {
    logger.warn(
      'No placeholder files were created and no orphaned placeholders found',
      {
        label: 'PlaceholderService',
      }
    );
    return [];
  }

  // Step 2: Trigger ONE Plex library scan for newly created files (skip if only orphaned)
  let discoveredItemsMap = new Map<
    number,
    { ratingKey: string; title: string }
  >();

  if (createdPlaceholders.length > 0) {
    logger.info('Triggering Plex library scan for newly created placeholders', {
      label: 'PlaceholderService',
      libraryId: config.libraryId,
      fileCount: createdPlaceholders.length,
    });

    await plexClient.scanLibrary(config.libraryId);

    // Step 3: Poll for ALL items to be discovered
    discoveredItemsMap = await waitForPlexDiscovery(
      createdPlaceholders,
      config,
      plexClient
    );
  }

  // Add orphaned placeholders to discovered map (they're already in Plex)
  for (const orphaned of orphanedPlaceholders) {
    discoveredItemsMap.set(orphaned.sourceItem.tmdbId, orphaned.plexItem);
  }

  // Build maps for poster verification
  const placeholderPathMap = new Map<number, string>();
  for (const { sourceItem, placeholderPath } of [
    ...createdPlaceholders,
    ...orphanedPlaceholders,
  ]) {
    placeholderPathMap.set(sourceItem.tmdbId, placeholderPath);
  }

  // Verify that discovered placeholders have posters in Plex
  // If Plex has no poster (common for future releases), apply the TMDB poster directly
  discoveredItemsMap = await verifyPlexPosters(
    discoveredItemsMap,
    config,
    plexClient,
    placeholderPathMap,
    sourceMap
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

  // Step 4: Apply overlays to ALL placeholders (newly created + orphaned)
  const allPlaceholders = [
    ...matchedPlaceholders.map((p) => ({
      sourceItem: p.sourceItem,
      placeholderPath: p.placeholderPath,
    })),
    ...orphanedPlaceholders,
  ];

  // Step 4: Set metadata markers and save to database for cleanup tracking
  const repository = getRepository(ComingSoonItem);

  for (const { sourceItem, placeholderPath } of allPlaceholders) {
    const plexItem = discoveredItemsMap.get(sourceItem.tmdbId);
    if (!plexItem) continue;

    try {
      // Set metadata markers for Recently Added filtering
      if (sourceItem.mediaType === 'tv') {
        // For TV shows: Need to set title on the episode (S00E00)
        // Use retry logic to handle cases where Plex hasn't fully populated episode metadata yet
        await ensurePlaceholderEpisodeTitle(
          plexClient,
          plexItem.ratingKey,
          sourceItem.title
        );
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

      // Save placeholder to database for lifecycle tracking only
      // NOTE: We don't store cached context (releaseDate, seasonNumber, isPlaceholder)
      // Those are fetched fresh from live sources (TMDB, Plex, Sonarr/Radarr)

      // Check if record already exists for THIS collection
      // Note: The same tmdbId can exist in multiple collections, so we check by both configId and tmdbId
      const existingRecord = await repository.findOne({
        where: {
          configId: config.id,
          tmdbId: sourceItem.tmdbId,
        },
      });

      // Convert absolute path to relative path before storing
      const { getPlaceholderRootFolder } = await import(
        '@server/lib/placeholders/helpers/placeholderPathHelpers'
      );
      const libraryPath = getPlaceholderRootFolder(
        config.libraryId,
        sourceItem.mediaType
      );

      let relativePath = placeholderPath;
      if (libraryPath && placeholderPath.startsWith(libraryPath)) {
        // Remove library root to get relative path
        relativePath = path.relative(libraryPath, placeholderPath);
      } else if (libraryPath && !path.isAbsolute(placeholderPath)) {
        // Already relative
        relativePath = placeholderPath;
      }

      if (existingRecord) {
        // Update existing record with new plexRatingKey and path
        existingRecord.plexRatingKey = plexItem.ratingKey;
        existingRecord.placeholderPath = relativePath;
        await repository.save(existingRecord);

        logger.info('Updated existing database record for placeholder', {
          label: 'PlaceholderService',
          title: sourceItem.title,
          tmdbId: sourceItem.tmdbId,
          configId: config.id,
        });
      } else {
        // Create new record for THIS collection
        // If this is an orphaned placeholder, it gets adopted by this collection
        const placeholderRecord = repository.create({
          configId: config.id, // Always use the current collection's ID
          mediaType: sourceItem.mediaType,
          tmdbId: sourceItem.tmdbId,
          tvdbId: sourceItem.tvdbId,
          title: sourceItem.title,
          year: sourceItem.year,
          source: sourceItem.source,
          placeholderPath: relativePath,
          plexRatingKey: plexItem.ratingKey,
        });

        await repository.save(placeholderRecord);

        logger.info('Created database record for placeholder', {
          label: 'PlaceholderService',
          title: sourceItem.title,
          tmdbId: sourceItem.tmdbId,
          configId: config.id,
          placeholderPath: relativePath,
          isOrphaned: orphanedPlaceholders.some(
            (o) => o.sourceItem.tmdbId === sourceItem.tmdbId
          ),
        });
      }
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
