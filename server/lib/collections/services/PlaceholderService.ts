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
import type { CollectionConfig } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import fs from 'fs/promises';
import path from 'path';
import { Like, Not } from 'typeorm';

// Cleanup imports
import RadarrAPI from '@server/api/servarr/radarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import type { LibraryItemsCache } from '@server/lib/collections/core/CollectionUtilities';

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

  // Step 0.5: Check for existing orphaned placeholders in Plex and adopt them
  // This fixes placeholders that lost their database records
  const { placeholderContextService } = await import(
    '@server/lib/collections/services/PlaceholderContextService'
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

  // Get existing database records to check for orphans
  const placeholderRepository = getRepository(ComingSoonItem);
  const existingRecords = await placeholderRepository.find({
    where: { configId: config.id },
  });
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
    if (itemExtended.type === 'show' && itemExtended.Children?.Metadata) {
      try {
        const seasons = itemExtended.Children.Metadata as {
          index?: number;
          ratingKey?: string;
        }[];
        const season00 = seasons.find((season) => season.index === 0);

        if (season00?.ratingKey) {
          const episodesData = await plexClient.getChildrenMetadata(
            season00.ratingKey
          );
          if (episodesData && episodesData.length > 0) {
            const episode = episodesData[0];
            // Check if title is already correct
            if (episode.title !== 'Trailer (Placeholder)') {
              await plexClient.updateItemTitle(
                episode.ratingKey,
                'Trailer (Placeholder)'
              );
              logger.info('Fixed placeholder episode title', {
                label: 'PlaceholderService',
                title: item.title,
                episodeRatingKey: episode.ratingKey,
                oldTitle: episode.title,
              });
            }
          }
        }
      } catch (error) {
        logger.warn('Failed to check/fix placeholder episode title', {
          label: 'PlaceholderService',
          title: item.title,
          ratingKey: item.ratingKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
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
              '@server/lib/comingsoon/placeholderManager'
            );
            const settings = getSettings();
            const libraryPath =
              itemExtended.type === 'movie'
                ? settings.main.placeholderMovieRootFolder
                : settings.main.placeholderTVRootFolder;

            if (libraryPath) {
              // Extract relative path from full Plex path
              const relativePath = placeholderPath.replace(
                libraryPath + '/',
                ''
              );
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
        const settings = getSettings();
        const libraryPath =
          sourceItem.mediaType === 'movie'
            ? settings.main.placeholderMovieRootFolder
            : settings.main.placeholderTVRootFolder;

        if (!libraryPath) {
          logger.warn('Placeholder library path not configured', {
            label: 'PlaceholderService',
            title: item.title,
            mediaType: sourceItem.mediaType,
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
      const settings = getSettings();
      const libraryPath =
        sourceItem.mediaType === 'movie'
          ? settings.main.placeholderMovieRootFolder
          : settings.main.placeholderTVRootFolder;

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

/**
 * Clean up placeholders for a collection:
 * 1. Items that now have real files in Radarr/Sonarr (released items)
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
    placeholders = await repository.find({ where: { configId: config.id } });
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

  const settings = getSettings();
  let removedCount = 0;

  // Get released window from general config (not Coming Soon specific!)
  const releasedWindowDays = getReleasedDays(config);

  for (const placeholder of placeholders) {
    try {
      let hasRealFile = false;

      // Check if real file now exists in Radarr/Sonarr
      // This works for ANY placeholder regardless of source
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
            logger.info('Found real file for placeholder', {
              label: 'PlaceholderService',
              title: placeholder.title,
              source: placeholder.source,
              radarrInstance: radarrInstance.name,
            });
            break;
          }
        }
      }

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
          const series = allSeries.find((s) => s.tvdbId === placeholder.tvdbId);

          if (series && series.statistics?.episodeFileCount > 0) {
            hasRealFile = true;
            logger.info('Found real file for placeholder', {
              label: 'PlaceholderService',
              title: placeholder.title,
              source: placeholder.source,
              sonarrInstance: sonarrInstance.name,
            });
            break;
          }
        }
      }

      if (hasRealFile) {
        // Verify the real file actually exists in Plex before cleanup
        let realItemInPlex = false;
        let realItemRatingKey: string | undefined;
        let foundPlexItem:
          | {
              type: string;
              ratingKey: string;
              seasonCount?: number;
              childCount?: number;
              editionTitle?: string;
              Media?: { Part?: { file?: string }[] }[];
            }
          | undefined = undefined;

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
              // Cast item to unknown first to access extended properties
              const extendedItem = item as unknown as {
                seasonCount?: number;
                childCount?: number;
                editionTitle?: string;
                Media?: { Part?: { file?: string }[] }[];
              };
              foundPlexItem = {
                type: placeholder.mediaType === 'movie' ? 'movie' : 'show',
                ratingKey: item.ratingKey,
                seasonCount: extendedItem.seasonCount,
                childCount: extendedItem.childCount,
                editionTitle: extendedItem.editionTitle,
                Media: extendedItem.Media,
              };
              break;
            }
          }
        } else {
          // No library cache available - defer cleanup until next sync
          logger.debug(
            'Library cache not available - deferring cleanup verification',
            {
              label: 'PlaceholderService',
              title: placeholder.title,
            }
          );
          continue;
        }

        if (!realItemInPlex || !foundPlexItem) {
          logger.info(
            'Real file exists in Radarr/Sonarr but not yet in Plex - skipping cleanup',
            {
              label: 'PlaceholderService',
              title: placeholder.title,
            }
          );
          continue; // Skip cleanup until Plex has scanned the file
        }

        // Real content detected - delete placeholder IMMEDIATELY
        // CRITICAL: Only delete if the Plex item is REAL content (not still a placeholder)

        // Import PlaceholderContextService to check if Plex item is a placeholder
        const { placeholderContextService } = await import(
          '@server/lib/collections/services/PlaceholderContextService'
        );

        // Check if the Plex item itself is a placeholder
        const plexItemIsPlaceholder =
          placeholderContextService.isPlaceholderItem(foundPlexItem);

        if (plexItemIsPlaceholder) {
          // Plex item is still a placeholder - just update rating key, don't delete
          logger.debug('Plex item is still a placeholder, not deleting', {
            label: 'PlaceholderService',
            title: placeholder.title,
            ratingKey: realItemRatingKey,
          });
          placeholder.plexRatingKey = realItemRatingKey;
          await repository.save(placeholder);
          continue; // Skip cleanup - still a placeholder
        }

        // Plex item is REAL content - delete placeholder for ALL collections
        logger.info(
          'Real content detected - deleting placeholder for all collections',
          {
            label: 'PlaceholderService',
            title: placeholder.title,
            source: placeholder.source,
            tmdbId: placeholder.tmdbId,
          }
        );

        // Get ALL placeholder records for this TMDB ID across all collections
        const allPlaceholderRecords = await repository.find({
          where: { tmdbId: placeholder.tmdbId },
        });

        if (allPlaceholderRecords.length === 0) {
          continue;
        }

        // Get the placeholder file path (should be same for all records)
        const placeholderPath = allPlaceholderRecords[0].placeholderPath;
        const mediaType = allPlaceholderRecords[0].mediaType;

        // Delete the placeholder file once
        let fileRemovalSucceeded = false;
        if (placeholderPath) {
          const { removePlaceholder } = await import(
            '@server/lib/comingsoon/placeholderManager'
          );
          const settings = getSettings();
          const libraryPath =
            mediaType === 'movie'
              ? settings.main.placeholderMovieRootFolder
              : settings.main.placeholderTVRootFolder;

          if (!libraryPath) {
            logger.error(
              'Library path not configured - cannot remove placeholder file',
              {
                label: 'PlaceholderService',
                title: placeholder.title,
                mediaType,
              }
            );
            continue;
          }

          // Construct full path from relative path
          const fullPath = path.join(libraryPath, placeholderPath);

          try {
            await removePlaceholder(fullPath, mediaType);
            fileRemovalSucceeded = true;
            logger.info('Deleted placeholder file (real content exists)', {
              label: 'PlaceholderService',
              title: placeholder.title,
              path: placeholderPath,
              affectedCollections: allPlaceholderRecords.length,
            });
          } catch (error) {
            if (error instanceof Error && error.message.includes('ENOENT')) {
              // File doesn't exist - that's fine, proceed with database cleanup
              fileRemovalSucceeded = true;
              logger.debug('Placeholder file already deleted', {
                label: 'PlaceholderService',
                title: placeholder.title,
                path: fullPath,
              });
            } else {
              logger.error(
                'Failed to delete placeholder file - keeping all database records',
                {
                  label: 'PlaceholderService',
                  title: placeholder.title,
                  path: fullPath,
                  error: error instanceof Error ? error.message : String(error),
                }
              );
              continue; // Keep ALL database records if file deletion failed
            }
          }
        } else {
          fileRemovalSucceeded = true; // No file to delete
        }

        // Delete ALL database records for this placeholder across ALL collections
        if (fileRemovalSucceeded) {
          try {
            await repository.remove(allPlaceholderRecords);
            removedCount += allPlaceholderRecords.length;
            logger.info(
              'Deleted placeholder records for all collections (real content exists)',
              {
                label: 'PlaceholderService',
                title: placeholder.title,
                tmdbId: placeholder.tmdbId,
                recordsDeleted: allPlaceholderRecords.length,
                collections: allPlaceholderRecords.map((r) => r.configId),
              }
            );
          } catch (error) {
            logger.error('Failed to delete placeholder database records', {
              label: 'PlaceholderService',
              title: placeholder.title,
              tmdbId: placeholder.tmdbId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    } catch (error) {
      logger.error('Error checking placeholder for cleanup', {
        label: 'PlaceholderService',
        title: placeholder.title,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

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

        // For orphaned items, check if they now have a real file
        if (isOrphaned && !isStale) {
          let hasRealFile = false;

          // Check Radarr/Sonarr (same logic as above)
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
                break;
              }
            }
          }

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
                break;
              }
            }
          }

          // If orphaned item now has a real file, delete placeholder for ALL collections
          if (hasRealFile) {
            logger.info(
              'Orphaned item has real file - deleting placeholder for all collections',
              {
                label: 'PlaceholderService',
                title: placeholder.title,
                source: placeholder.source,
                tmdbId: placeholder.tmdbId,
              }
            );

            // Get ALL placeholder records for this TMDB ID across all collections
            const allPlaceholderRecords = await repository.find({
              where: { tmdbId: placeholder.tmdbId },
            });

            if (allPlaceholderRecords.length === 0) {
              continue;
            }

            // Get the placeholder file path (should be same for all records)
            const placeholderPath = allPlaceholderRecords[0].placeholderPath;
            const mediaType = allPlaceholderRecords[0].mediaType;

            // Delete the placeholder file once
            let fileRemovalSucceeded = false;
            if (placeholderPath) {
              const { removePlaceholder } = await import(
                '@server/lib/comingsoon/placeholderManager'
              );
              const settings = getSettings();
              const libraryPath =
                mediaType === 'movie'
                  ? settings.main.placeholderMovieRootFolder
                  : settings.main.placeholderTVRootFolder;

              if (!libraryPath) {
                logger.error(
                  'Library path not configured - cannot remove placeholder file',
                  {
                    label: 'PlaceholderService',
                    title: placeholder.title,
                    mediaType,
                  }
                );
                continue;
              }

              // Construct full path from relative path
              const fullPath = path.join(libraryPath, placeholderPath);

              try {
                await removePlaceholder(fullPath, mediaType);
                fileRemovalSucceeded = true;
                logger.info(
                  'Deleted placeholder file (orphaned with real content)',
                  {
                    label: 'PlaceholderService',
                    title: placeholder.title,
                    path: placeholderPath,
                    affectedCollections: allPlaceholderRecords.length,
                  }
                );
              } catch (error) {
                if (
                  error instanceof Error &&
                  error.message.includes('ENOENT')
                ) {
                  // File doesn't exist - that's fine, proceed with database cleanup
                  fileRemovalSucceeded = true;
                  logger.debug('Placeholder file already deleted', {
                    label: 'PlaceholderService',
                    title: placeholder.title,
                    path: fullPath,
                  });
                } else {
                  logger.error(
                    'Failed to delete placeholder file - keeping all database records',
                    {
                      label: 'PlaceholderService',
                      title: placeholder.title,
                      path: fullPath,
                      error:
                        error instanceof Error ? error.message : String(error),
                    }
                  );
                  continue; // Keep ALL database records if file deletion failed
                }
              }
            } else {
              fileRemovalSucceeded = true; // No file to remove
            }

            // Delete ALL database records for this placeholder across ALL collections
            if (fileRemovalSucceeded) {
              try {
                await repository.remove(allPlaceholderRecords);
                removedCount += allPlaceholderRecords.length;
                orphanedCount += allPlaceholderRecords.length;
                logger.info(
                  'Deleted placeholder records for all collections (orphaned with real content)',
                  {
                    label: 'PlaceholderService',
                    title: placeholder.title,
                    tmdbId: placeholder.tmdbId,
                    recordsDeleted: allPlaceholderRecords.length,
                    collections: allPlaceholderRecords.map((r) => r.configId),
                  }
                );
              } catch (error) {
                logger.error('Failed to delete placeholder database records', {
                  label: 'PlaceholderService',
                  title: placeholder.title,
                  tmdbId: placeholder.tmdbId,
                  error: error instanceof Error ? error.message : String(error),
                });
              }
            }

            continue;
          }

          // Orphaned item with no real file - check if past configured window
          // This handles items that fall off source lists (e.g., Trakt Trending)
          // Keep them for placeholderReleasedDays from:
          // - Release date (if released) - so users see "recently released" items
          // - Creation date (if not released yet) - so users see upcoming items

          // Fetch release date from TMDB to determine window start
          const { placeholderContextService } = await import(
            '@server/lib/collections/services/PlaceholderContextService'
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
                '@server/lib/comingsoon/placeholderManager'
              );
              const settings = getSettings();
              const libraryPath =
                placeholder.mediaType === 'movie'
                  ? settings.main.placeholderMovieRootFolder
                  : settings.main.placeholderTVRootFolder;

              if (!libraryPath) {
                logger.error(
                  'Library path not configured - cannot remove placeholder file',
                  {
                    label: 'PlaceholderService',
                    title: placeholder.title,
                    mediaType: placeholder.mediaType,
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
              '@server/lib/comingsoon/placeholderManager'
            );
            const settings = getSettings();
            const libraryPath =
              placeholder.mediaType === 'movie'
                ? settings.main.placeholderMovieRootFolder
                : settings.main.placeholderTVRootFolder;

            if (!libraryPath) {
              logger.error(
                'Library path not configured - cannot remove placeholder file',
                {
                  label: 'PlaceholderService',
                  title: placeholder.title,
                  mediaType: placeholder.mediaType,
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

    if (allRecords.length === 0) {
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
        if (activeConfigIds.has(parentId)) {
          return false; // Parent exists, keep record
        }
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

    const movieLibraryPath = settings.main.placeholderMovieRootFolder;
    const tvLibraryPath = settings.main.placeholderTVRootFolder;

    if (!movieLibraryPath && !tvLibraryPath) {
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
    const trackedPaths = new Set(allRecords.map((r) => r.placeholderPath));

    let filesRemoved = 0;

    // Scan movie library for orphaned files
    if (movieLibraryPath) {
      try {
        const movieFolders = await fs.readdir(movieLibraryPath);

        for (const folder of movieFolders) {
          const folderPath = path.join(movieLibraryPath, folder);

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
                    '@server/lib/comingsoon/placeholderManager'
                  );
                  await removePlaceholder(filePath, 'movie');
                  filesRemoved++;
                  logger.info('Removed orphaned placeholder file', {
                    label: 'PlaceholderService',
                    path: relativePath,
                    mediaType: 'movie',
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
      } catch (error) {
        logger.warn('Failed to scan movie library for orphaned files', {
          label: 'PlaceholderService',
          path: movieLibraryPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Scan TV library for orphaned files
    if (tvLibraryPath) {
      try {
        const showFolders = await fs.readdir(tvLibraryPath);

        for (const showFolder of showFolders) {
          const showPath = path.join(tvLibraryPath, showFolder);

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
                const relativePath = path.join(showFolder, seasonFolder, file);

                // Check if any DB record references this file
                if (!trackedPaths.has(relativePath)) {
                  // Orphaned file - delete it
                  try {
                    const { removePlaceholder } = await import(
                      '@server/lib/comingsoon/placeholderManager'
                    );
                    await removePlaceholder(filePath, 'tv');
                    filesRemoved++;
                    logger.info('Removed orphaned placeholder file', {
                      label: 'PlaceholderService',
                      path: relativePath,
                      mediaType: 'tv',
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
            }
          } catch (error) {
            // Folder access error, skip
            continue;
          }
        }
      } catch (error) {
        logger.warn('Failed to scan TV library for orphaned files', {
          label: 'PlaceholderService',
          path: tvLibraryPath,
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

export default {
  processPlaceholdersForMissingItems,
  cleanupPlaceholdersForConfig,
  handlePlaceholderCleanup,
  deleteAllPlaceholdersForConfig,
  cleanupOrphanedPlaceholderRecords,
  cleanupOrphanedPlaceholderFiles,
  isPlaceholderCreationEnabled,
  getReleasedDays,
  getDaysAhead,
};
