import type PlexAPI from '@server/api/plexapi';
import RadarrAPI from '@server/api/servarr/radarr';
import SonarrAPI from '@server/api/servarr/sonarr';
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
} from '@server/lib/collections/core/types';
import type { CollectionConfig } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { translatePath } from '@server/utils/pathMapping';
import fs from 'fs/promises';

/**
 * Handle placeholder creation for missing Coming Soon items
 * Strategy: Create ALL files first, then trigger ONE scan, then apply overlays
 * Returns the discovered placeholder items as CollectionItems
 */
export async function handlePlaceholderCreation(
  missingItems: MissingItem[],
  sourceData: ComingSoonSourceData[],
  config: CollectionConfig,
  plexClient: PlexAPI
): Promise<CollectionItem[]> {
  if (missingItems.length === 0) {
    return [];
  }

  logger.info('Creating placeholders for Coming Soon items', {
    label: 'Coming Soon Collections',
    count: missingItems.length,
  });

  const overlayColor = config.comingSoonOverlayColor || '#C21807';
  const sourceMap = new Map(sourceData.map((s) => [s.tmdbId, s]));

  // Step 0: Pre-filter items - only create placeholders for items with posters available
  const TmdbAPI = (await import('@server/api/themoviedb')).default;
  const tmdbClient = new TmdbAPI();
  const itemsWithPosters: MissingItem[] = [];

  logger.info('Checking TMDB for poster availability', {
    label: 'Coming Soon Collections',
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
          label: 'Coming Soon Collections',
          title: sourceItem.title,
          tmdbId: sourceItem.tmdbId,
          mediaType: sourceItem.mediaType,
        });
      }
    } catch (error) {
      logger.warn('Failed to check poster availability, skipping item', {
        label: 'Coming Soon Collections',
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
        label: 'Coming Soon Collections',
        originalCount: missingItems.length,
      }
    );
    return [];
  }

  logger.info('Creating placeholders for items with posters', {
    label: 'Coming Soon Collections',
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
        label: 'Coming Soon Collections',
        title: sourceItem.title,
        path: placeholderPath,
      });
    } catch (error) {
      logger.error('Failed to create placeholder file', {
        label: 'Coming Soon Collections',
        title: sourceItem.title,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (createdPlaceholders.length === 0) {
    logger.warn('No placeholder files were created', {
      label: 'Coming Soon Collections',
    });
    return [];
  }

  // Step 2: Trigger ONE Plex library scan for all files
  logger.info('Triggering Plex library scan for all placeholders', {
    label: 'Coming Soon Collections',
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

  // Step 4: Apply overlays to discovered items only
  if (matchedPlaceholders.length > 0) {
    await applyOverlaysToPlaceholders(
      matchedPlaceholders,
      config,
      plexClient,
      overlayColor,
      discoveredItemsMap
    );
  } else {
    logger.warn('No placeholders matched in Plex after creation', {
      label: 'Coming Soon Collections',
      count: createdPlaceholders.length,
    });
  }

  // Step 5: Convert discovered items to CollectionItem format
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

  logger.info('Returning discovered placeholder items', {
    label: 'Coming Soon Collections',
    itemCount: collectionItems.length,
  });

  return collectionItems;
}

/**
 * Create just the placeholder file without scanning or applying overlays
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

  // 2. Get library path from Radarr/Sonarr root folders
  // For Trakt items, use Radarr/Sonarr based on media type (same as monitored items)
  const settings = getSettings();
  let libraryPath: string | undefined;

  if (sourceItem.mediaType === 'movie') {
    // For movies: use default Radarr instance, fallback to first if no default set
    if (settings.radarr && settings.radarr.length > 0) {
      const radarrInstance =
        settings.radarr.find((r) => r.isDefault) || settings.radarr[0];
      const radarrClient = new RadarrAPI({
        url: `${radarrInstance.useSsl ? 'https' : 'http'}://${
          radarrInstance.hostname
        }:${radarrInstance.port}${radarrInstance.baseUrl || ''}/api/v3`,
        apiKey: radarrInstance.apiKey,
      });

      const rootFolders = await radarrClient.getRootFolders();
      if (rootFolders.length > 0) {
        const remotePath = rootFolders[0].path;
        libraryPath = translatePath(remotePath, radarrInstance.pathMappings);

        logger.debug('Using Radarr instance for placeholder creation', {
          label: 'Coming Soon Collections',
          instance: radarrInstance.name,
          isDefault: radarrInstance.isDefault,
          rootFolder: libraryPath,
        });
      }
    }
  } else if (sourceItem.mediaType === 'tv') {
    // For TV shows: use default Sonarr instance, fallback to first if no default set
    if (settings.sonarr && settings.sonarr.length > 0) {
      const sonarrInstance =
        settings.sonarr.find((s) => s.isDefault) || settings.sonarr[0];
      const sonarrClient = new SonarrAPI({
        url: `${sonarrInstance.useSsl ? 'https' : 'http'}://${
          sonarrInstance.hostname
        }:${sonarrInstance.port}${sonarrInstance.baseUrl || ''}/api/v3`,
        apiKey: sonarrInstance.apiKey,
      });

      const rootFolders = await sonarrClient.getRootFolders();
      if (rootFolders.length > 0) {
        const remotePath = rootFolders[0].path;
        libraryPath = translatePath(remotePath, sonarrInstance.pathMappings);

        logger.debug('Using Sonarr instance for placeholder creation', {
          label: 'Coming Soon Collections',
          instance: sonarrInstance.name,
          isDefault: sonarrInstance.isDefault,
          rootFolder: libraryPath,
        });
      }
    }
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
        label: 'Coming Soon Collections',
        title: sourceItem.title,
        tmdbId: sourceItem.tmdbId,
        mediaType: sourceItem.mediaType,
        placeholderPath,
      });
    } catch (error) {
      logger.error('Failed to remove unmatched placeholder', {
        label: 'Coming Soon Collections',
        title: sourceItem.title,
        tmdbId: sourceItem.tmdbId,
        placeholderPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (removedCount > 0) {
    logger.info('Triggering Plex scan to clean up unmatched placeholders', {
      label: 'Coming Soon Collections',
      libraryId: config.libraryId,
      removedCount,
    });

    try {
      await plexClient.scanLibrary(config.libraryId);
    } catch (error) {
      logger.warn(
        'Failed to trigger cleanup scan after removing unmatched placeholders',
        {
          label: 'Coming Soon Collections',
          libraryId: config.libraryId,
          removedCount,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }
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
  const minTimeBeforeFallback = 120000; // 120 seconds (12 attempts)
  const waitCyclesAfterStop = 2; // Wait 2 more cycles after items stop

  logger.info('Polling Plex for placeholder discovery', {
    label: 'Coming Soon Collections',
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
        label: 'Coming Soon Collections',
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
      label: 'Coming Soon Collections',
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
          label: 'Coming Soon Collections',
          title: item.title,
          attempt,
        });
      } else {
        logger.debug('Item not found in map', {
          label: 'Coming Soon Collections',
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
          label: 'Coming Soon Collections',
          attempt,
          elapsed: attempt * 10,
        });
      }
      consecutiveNoDiscovery = 0; // Reset counter
    } else if (itemsStartedAppearing) {
      // No new items found, and items had started appearing before
      consecutiveNoDiscovery++;
      logger.debug('No new discoveries this cycle', {
        label: 'Coming Soon Collections',
        attempt,
        consecutiveNoDiscovery,
      });
    }

    // Check if all found or need to continue
    if (discovered.size === sourceItems.length) {
      logger.info('All placeholders discovered by Plex', {
        label: 'Coming Soon Collections',
        attempt,
        totalItems: sourceItems.length,
      });
      break;
    }

    // Title-based fallback logic
    // After items have been appearing for at least 120 seconds (12 attempts)
    // AND items have stopped appearing for 2 consecutive cycles (20 seconds)
    const elapsedTime = attempt * pollInterval;
    const shouldAttemptFallback =
      itemsStartedAppearing &&
      elapsedTime >= minTimeBeforeFallback &&
      consecutiveNoDiscovery >= waitCyclesAfterStop;

    if (shouldAttemptFallback && stillMissing.length > 0) {
      logger.info(
        'Items stopped appearing - attempting title-based fallback search for unmatched placeholders',
        {
          label: 'Coming Soon Collections',
          attempt,
          elapsed: elapsedTime / 1000,
          stillMissingCount: stillMissing.length,
          consecutiveNoDiscovery,
        }
      );

      // Attempt title-based search for each missing item
      await handleUnmatchedPlaceholders(
        stillMissing,
        config,
        plexClient,
        discovered,
        excludedUnmatched,
        placeholderPathMap
      );

      // After fallback, check if we're done
      const remainingMissing = sourceItems.filter(
        (item) =>
          !discovered.has(item.tmdbId) && !excludedUnmatched.has(item.tmdbId)
      );

      if (remainingMissing.length === 0) {
        logger.info('All placeholders resolved after title-based fallback', {
          label: 'Coming Soon Collections',
          attempt,
          totalItems: sourceItems.length,
          discovered: discovered.size,
          excludedUnmatched: excludedUnmatched.size,
        });
        break;
      }
    }

    // Wait before next check (except on last attempt)
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
  }

  if (discovered.size + excludedUnmatched.size < sourceItems.length) {
    logger.warn('Some placeholders were not resolved by Plex after polling', {
      label: 'Coming Soon Collections',
      totalItems: sourceItems.length,
      discovered: discovered.size,
      excludedUnmatched: excludedUnmatched.size,
      missing: sourceItems.length - discovered.size - excludedUnmatched.size,
    });
  }

  return discovered;
}

/**
 * Handle unmatched placeholders - search by title and cleanup if truly unmatched
 * This is a fallback for when Plex doesn't match items with TMDB metadata
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
    label: 'Coming Soon Collections',
    unmatchedCount: unmatchedItems.length,
  });

  let needsScan = false;

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
        logger.debug('No title matches found in Plex', {
          label: 'Coming Soon Collections',
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
        // Found the placeholder in Plex, but it's unmatched
        const match = unmatchedInPlex[0]; // Take first match
        const placeholderPath = placeholderPathMap.get(item.tmdbId);

        if (!placeholderPath) {
          logger.warn('No placeholder path found for unmatched item', {
            label: 'Coming Soon Collections',
            title: item.title,
            tmdbId: item.tmdbId,
          });
          continue;
        }

        logger.warn(
          'Found placeholder in Plex but it is unmatched (no TMDB guid) - deleting file and excluding from collection',
          {
            label: 'Coming Soon Collections',
            title: item.title,
            year: item.year,
            tmdbId: item.tmdbId,
            plexTitle: match.title,
            plexYear: match.year,
            placeholderPath,
          }
        );

        // Delete the placeholder file
        try {
          await removePlaceholder(placeholderPath, item.mediaType);
          needsScan = true;
          logger.info('Deleted unmatched placeholder file', {
            label: 'Coming Soon Collections',
            title: item.title,
            placeholderPath,
          });
        } catch (deleteError) {
          logger.error('Failed to delete unmatched placeholder file', {
            label: 'Coming Soon Collections',
            title: item.title,
            placeholderPath,
            error:
              deleteError instanceof Error
                ? deleteError.message
                : String(deleteError),
          });
        }

        // Mark as excluded so we don't keep trying to find it
        excludedUnmatched.add(item.tmdbId);
      } else if (titleMatches.length > 0) {
        // Found matched items - this shouldn't happen (means TMDB search failed but item is actually matched)
        const match = titleMatches[0];
        logger.info(
          'Found item by title with TMDB guid - adding to discovered (TMDB search may have been too early)',
          {
            label: 'Coming Soon Collections',
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
        label: 'Coming Soon Collections',
        title: item.title,
        tmdbId: item.tmdbId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Trigger library scan to clean up deleted placeholders from Plex database
  if (needsScan) {
    logger.info('Triggering library scan to clean up deleted placeholders', {
      label: 'Coming Soon Collections',
      libraryId: config.libraryId,
    });

    try {
      await plexClient.scanLibrary(config.libraryId);
    } catch (error) {
      logger.error('Failed to trigger library scan after cleanup', {
        label: 'Coming Soon Collections',
        libraryId: config.libraryId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info('Title-based fallback search completed', {
    label: 'Coming Soon Collections',
    totalProcessed: unmatchedItems.length,
    excluded: excludedUnmatched.size,
    additionalDiscovered: discovered.size,
  });
}

/**
 * Apply overlay posters to discovered placeholder items
 */
async function applyOverlaysToPlaceholders(
  placeholders: {
    sourceItem: ComingSoonSourceData;
    placeholderPath: string;
  }[],
  config: CollectionConfig,
  plexClient: PlexAPI,
  overlayColor: string,
  preDiscoveredItems?: Map<number, { ratingKey: string; title: string }>
): Promise<void> {
  const { generateOverlayPoster } = await import(
    '@server/lib/comingsoon/overlayGenerator'
  );
  const TmdbAPI = (await import('@server/api/themoviedb')).default;
  const tmdbClient = new TmdbAPI();
  const repository = getRepository(ComingSoonItem);

  // First, wait for Plex to discover all items (if not already provided)
  const discoveredItems =
    preDiscoveredItems ??
    (await waitForPlexDiscovery(placeholders, config, plexClient));

  logger.info('Applying overlays to discovered placeholders', {
    label: 'Coming Soon Collections',
    totalItems: placeholders.length,
    discovered: discoveredItems.size,
  });

  for (const { sourceItem, placeholderPath } of placeholders) {
    const plexItem = discoveredItems.get(sourceItem.tmdbId);
    if (!plexItem) {
      logger.warn('Cannot apply overlay - item not discovered by Plex', {
        label: 'Coming Soon Collections',
        title: sourceItem.title,
      });
      continue;
    }

    try {
      // Import categorization
      const { categorizeItem } = await import(
        '@server/lib/comingsoon/categorization'
      );

      // Categorize the item
      const category = categorizeItem(sourceItem, {
        futureDays: 360,
        recentDays: 7,
        futureOnly: false,
      });

      if (!category) {
        logger.warn('Could not categorize item for overlay', {
          label: 'Coming Soon Collections',
          title: sourceItem.title,
        });
        continue;
      }

      // Get poster URL from TMDB
      let posterUrl: string | undefined;
      if (sourceItem.mediaType === 'movie') {
        const movieDetails = await tmdbClient.getMovie({
          movieId: sourceItem.tmdbId,
        });
        posterUrl = movieDetails.poster_path
          ? `https://image.tmdb.org/t/p/original${movieDetails.poster_path}`
          : undefined;
      } else {
        const showDetails = await tmdbClient.getTvShow({
          tvId: sourceItem.tmdbId,
        });
        posterUrl = showDetails.poster_path
          ? `https://image.tmdb.org/t/p/original${showDetails.poster_path}`
          : undefined;
      }

      if (posterUrl) {
        const overlayPosterBuffer = await generateOverlayPoster({
          posterUrl,
          category,
          releaseDate: sourceItem.releaseDate || sourceItem.airDate,
          color: overlayColor,
          dateFormat: 'd mmm',
          capitalizeDates: true,
          isEstimatedDate: sourceItem.isEstimatedDate,
          seasonNumber: sourceItem.seasonNumber,
        });

        // Upload poster to Plex
        const tempPosterPath = `/tmp/comingsoon-${sourceItem.tmdbId}.jpg`;
        await fs.writeFile(tempPosterPath, overlayPosterBuffer);
        await plexClient.uploadPosterFromFile(
          plexItem.ratingKey,
          tempPosterPath
        );
        await fs.unlink(tempPosterPath);

        logger.info('Applied overlay poster', {
          label: 'Coming Soon Collections',
          title: sourceItem.title,
          category,
        });
      }

      // Set metadata markers for Recently Added filtering
      try {
        if (sourceItem.mediaType === 'tv') {
          // For TV shows: Need to set title on the episode (S00E00)
          // Get seasons using getChildrenMetadata (getMetadata doesn't return Children property)
          const seasons = await plexClient.getChildrenMetadata(
            plexItem.ratingKey
          );

          if (seasons && seasons.length > 0) {
            // Find Season 00
            const season00 = seasons.find((season) => season.index === 0);

            if (season00) {
              // Get episodes from Season 00
              const episodesData = await plexClient.getChildrenMetadata(
                season00.ratingKey
              );
              if (episodesData && episodesData.length > 0) {
                const episode = episodesData[0]; // S00E00
                await plexClient.updateItemTitle(
                  episode.ratingKey,
                  'Trailer (Placeholder)'
                );
                logger.debug('Set placeholder episode title', {
                  label: 'Coming Soon Collections',
                  title: sourceItem.title,
                  episodeRatingKey: episode.ratingKey,
                });
              } else {
                logger.warn(
                  'No episodes found in Season 00 - cannot set placeholder title',
                  {
                    label: 'Coming Soon Collections',
                    title: sourceItem.title,
                    season00RatingKey: season00.ratingKey,
                  }
                );
              }
            } else {
              logger.warn(
                'Season 00 not found - cannot set placeholder title',
                {
                  label: 'Coming Soon Collections',
                  title: sourceItem.title,
                  availableSeasons: seasons.map((s) => s.index),
                }
              );
            }
          } else {
            logger.warn(
              'No seasons found for show - cannot set placeholder title',
              {
                label: 'Coming Soon Collections',
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
            label: 'Coming Soon Collections',
            title: sourceItem.title,
            ratingKey: plexItem.ratingKey,
          });
        }
      } catch (metadataError) {
        logger.warn('Failed to set placeholder metadata markers', {
          label: 'Coming Soon Collections',
          title: sourceItem.title,
          mediaType: sourceItem.mediaType,
          error:
            metadataError instanceof Error
              ? metadataError.message
              : String(metadataError),
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
        label: 'Coming Soon Collections',
        title: sourceItem.title,
      });
    } catch (error) {
      logger.error('Failed to apply overlay to placeholder', {
        label: 'Coming Soon Collections',
        title: sourceItem.title,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
