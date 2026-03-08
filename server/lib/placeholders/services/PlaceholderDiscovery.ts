import type PlexAPI from '@server/api/plexapi';
import { getRepository } from '@server/datasource';
import { ComingSoonItem } from '@server/entity/ComingSoonItem';
import {
  findPlexItemsByTitle,
  findPlexItemsByTmdbIds,
} from '@server/lib/collections/core/CollectionUtilities';
import logger from '@server/logger';

/**
 * Discovered placeholder with Plex item information
 */
export interface DiscoveredPlaceholder {
  marker: {
    title: string;
    year?: number;
    tmdbId?: number;
    tvdbId?: number;
    filePath: string;
    placeholderPath: string;
  };
  plexItem?: {
    ratingKey: string;
    title: string;
  };
  needsTitleFix: boolean;
  discoveryMethod: 'tmdb-id' | 'database-lookup' | 'title-search' | 'not-found';
}

/**
 * Extract TMDB ID from Plex item metadata
 */
function extractTmdbIdFromPlexItem(plexItem: {
  Guid?: { id: string }[];
}): number | null {
  if (!plexItem.Guid || plexItem.Guid.length === 0) {
    return null;
  }

  for (const guid of plexItem.Guid) {
    const tmdbMatch = guid.id.match(/tmdb:\/\/(\d+)/);
    if (tmdbMatch) {
      return parseInt(tmdbMatch[1], 10);
    }
  }

  return null;
}

/**
 * Discovered movie placeholder with Plex item information
 */
export interface DiscoveredMoviePlaceholder {
  movie: {
    title: string;
    year?: number;
    tmdbId: number;
    placeholderPath: string;
    folderPath: string;
  };
  plexItem?: {
    ratingKey: string;
    title: string;
  };
  needsCleanup: boolean;
  discoveryMethod: 'tmdb-id' | 'not-found';
}

/**
 * Three-tier placeholder discovery system using .comingsoon marker files
 *
 * Tier 1: Markers with tmdbId → Direct TMDB lookup (fast, for new placeholders)
 * Tier 2: Markers without tmdbId + DB record → Database-assisted upgrade (migration path)
 * Tier 3: Markers without tmdbId + No DB record → Title-based fallback (orphan recovery)
 *
 * This approach scales O(p) with placeholder count, not O(n) with library size
 *
 * @param plexClient - Plex API client
 * @param libraryId - Library ID to search in
 * @param libraryPath - Filesystem path to library root
 * @returns Array of discovered placeholders with Plex matching information
 */
export async function discoverPlaceholdersFromMarkers(
  plexClient: PlexAPI,
  libraryId: string,
  libraryPath: string
): Promise<DiscoveredPlaceholder[]> {
  const { scanForMarkerFiles, upgradeMarkerFile } = await import(
    '@server/lib/placeholders/placeholderManager'
  );

  // Step 1: Scan filesystem for .comingsoon marker files
  const markers = await scanForMarkerFiles(libraryPath);

  if (markers.length === 0) {
    logger.debug('No placeholder markers found in library', {
      label: 'PlaceholderService',
      libraryId,
      libraryPath,
    });
    return [];
  }

  const discovered: DiscoveredPlaceholder[] = [];
  const repository = getRepository(ComingSoonItem);

  // Separate markers by tier for efficient batch processing
  const tier1Markers = markers.filter((m) => m.tmdbId);
  const tier2And3Markers = markers.filter((m) => !m.tmdbId);

  // Import PlaceholderContextService for verification
  const { placeholderContextService } = await import(
    '@server/lib/placeholders/services/PlaceholderContextService'
  );

  // TIER 1: Batch process markers with tmdbId (new format)
  if (tier1Markers.length > 0) {
    logger.info('Processing Tier 1: Markers with TMDB IDs', {
      label: 'PlaceholderService',
      count: tier1Markers.length,
    });

    // Batch query Plex for all tmdbIds at once
    const tmdbLookups = tier1Markers
      .filter((m) => m.tmdbId !== undefined)
      .map((m) => ({
        tmdbId: m.tmdbId as number,
        mediaType: 'tv' as const,
        title: m.title,
      }));

    const plexMatches = await findPlexItemsByTmdbIds(
      plexClient,
      tmdbLookups,
      libraryId
    );

    // Batch check *arr download status for all tier 1 markers
    const arrLookups = tier1Markers
      .filter((m) => m.tmdbId !== undefined)
      .map((m) => ({
        tmdbId: m.tmdbId as number,
        tvdbId: m.tvdbId,
        mediaType: 'tv' as const,
      }));

    const { showsByTvdbId } =
      await placeholderContextService.batchCheckDownloadStatus(arrLookups);

    for (const marker of tier1Markers) {
      if (!marker.tmdbId) {
        continue;
      }

      const plexItem = plexMatches.get(`${marker.tmdbId}-tv`);

      // Check if *arr reports content as downloaded
      const arrStatus = marker.tvdbId
        ? showsByTvdbId.get(marker.tvdbId)
        : undefined;
      const isDownloadedInArr = arrStatus?.downloaded === true;

      // Marker file on disk proves this is an Agregarr-created placeholder.
      // Don't re-verify via isPlaceholderItem — returns false for TV shows
      // when Children metadata is missing from the Plex API response.
      // Use *arr download status as additional cleanup signal.
      let needsTitleFix = false;
      if (plexItem) {
        needsTitleFix = !isDownloadedInArr;
        if (isDownloadedInArr) {
          logger.info(
            'Placeholder has content downloaded in Sonarr - triggering cleanup',
            {
              label: 'PlaceholderService',
              title: marker.title,
              tvdbId: marker.tvdbId,
            }
          );
        }
      } else if (isDownloadedInArr) {
        logger.info(
          'No Plex item but content downloaded in Sonarr - triggering cleanup',
          {
            label: 'PlaceholderService',
            title: marker.title,
            tvdbId: marker.tvdbId,
          }
        );
      } else {
        needsTitleFix = true;
      }

      discovered.push({
        marker,
        plexItem: plexItem
          ? { ratingKey: plexItem.ratingKey, title: plexItem.title }
          : undefined,
        needsTitleFix,
        discoveryMethod: 'tmdb-id',
      });
    }
  }

  // Batch check *arr download status for all tier 2/3 markers that have DB records
  // This avoids per-marker full library pulls
  const tier2DbRecords = new Map<string, { tmdbId: number; tvdbId?: number }>();
  for (const marker of tier2And3Markers) {
    const dbRecord = await repository.findOne({
      where: { placeholderPath: marker.placeholderPath },
    });
    if (dbRecord) {
      tier2DbRecords.set(marker.placeholderPath, {
        tmdbId: dbRecord.tmdbId,
        tvdbId: dbRecord.tvdbId,
      });
    }
  }

  // Batch *arr check for all tier 2 markers with tvdbIds
  let tier2ArrShows = new Map<
    number,
    { downloaded: boolean; inSonarr: boolean; folderName?: string }
  >();
  const tier2ArrLookups = [...tier2DbRecords.values()]
    .filter((r) => r.tvdbId)
    .map((r) => ({
      tmdbId: r.tmdbId,
      tvdbId: r.tvdbId,
      mediaType: 'tv' as const,
    }));
  if (tier2ArrLookups.length > 0) {
    const result = await placeholderContextService.batchCheckDownloadStatus(
      tier2ArrLookups
    );
    tier2ArrShows = result.showsByTvdbId;
  }

  // TIER 2 & 3: Process old markers without tmdbId
  for (const marker of tier2And3Markers) {
    // TIER 2: Check database for existing record
    const dbRecordInfo = tier2DbRecords.get(marker.placeholderPath);

    if (dbRecordInfo) {
      logger.info('Tier 2: Found database record for old marker', {
        label: 'PlaceholderService',
        title: marker.title,
        tmdbId: dbRecordInfo.tmdbId,
      });

      // Upgrade marker file with tmdbId from database
      try {
        await upgradeMarkerFile(
          marker.filePath,
          dbRecordInfo.tmdbId,
          dbRecordInfo.tvdbId
        );

        // Query Plex using tmdbId from database
        const plexMatches = await findPlexItemsByTmdbIds(
          plexClient,
          [
            {
              tmdbId: dbRecordInfo.tmdbId,
              mediaType: 'tv',
              title: marker.title,
            },
          ],
          libraryId
        );

        const plexItem = plexMatches.get(`${dbRecordInfo.tmdbId}-tv`);

        // Check *arr download status from batched results
        const arrStatus = dbRecordInfo.tvdbId
          ? tier2ArrShows.get(dbRecordInfo.tvdbId)
          : undefined;
        const isDownloadedInArr = arrStatus?.downloaded === true;

        // Marker file on disk proves this is an Agregarr-created placeholder.
        // Don't re-verify via isPlaceholderItem — returns false for TV shows
        // when Children metadata is missing from the Plex API response.
        // Use *arr download status as additional cleanup signal.
        let needsTitleFix = false;
        if (plexItem) {
          needsTitleFix = !isDownloadedInArr;
          if (isDownloadedInArr) {
            logger.info(
              'Tier 2: Content downloaded in Sonarr - triggering cleanup',
              {
                label: 'PlaceholderService',
                title: marker.title,
                tvdbId: dbRecordInfo.tvdbId,
              }
            );
          }
        } else if (isDownloadedInArr) {
          logger.info(
            'Tier 2: No Plex item but content downloaded - triggering cleanup',
            {
              label: 'PlaceholderService',
              title: marker.title,
              tvdbId: dbRecordInfo.tvdbId,
            }
          );
        } else {
          needsTitleFix = true;
        }

        discovered.push({
          marker: {
            ...marker,
            tmdbId: dbRecordInfo.tmdbId,
            tvdbId: dbRecordInfo.tvdbId,
          },
          plexItem: plexItem
            ? { ratingKey: plexItem.ratingKey, title: plexItem.title }
            : undefined,
          needsTitleFix,
          discoveryMethod: 'database-lookup',
        });

        continue;
      } catch (error) {
        logger.warn('Failed to upgrade marker from database record', {
          label: 'PlaceholderService',
          title: marker.title,
          error: error instanceof Error ? error.message : String(error),
        });
        // Fall through to Tier 3
      }
    }

    // TIER 3: Truly orphaned - fallback to title search
    logger.info('Tier 3: Orphaned placeholder - using title search', {
      label: 'PlaceholderService',
      title: marker.title,
      year: marker.year,
      path: marker.filePath,
    });

    const titleMatches = await findPlexItemsByTitle(
      plexClient,
      marker.title,
      marker.year,
      libraryId,
      'tv'
    );

    if (titleMatches.length > 0) {
      const plexItem = titleMatches[0];

      // Try to extract tmdbId from Plex item and upgrade marker
      const plexItemDetails = await plexClient.getMetadata(plexItem.ratingKey, {
        includeChildren: true,
      });
      const tmdbId = extractTmdbIdFromPlexItem(plexItemDetails);

      // Verify it's still a placeholder (check if real content was added)
      const isStillPlaceholder =
        placeholderContextService.isPlaceholderItem(plexItemDetails);

      if (!isStillPlaceholder) {
        logger.info(
          'Orphan found but has real content now - skipping title fix',
          {
            label: 'PlaceholderService',
            title: marker.title,
            ratingKey: plexItem.ratingKey,
          }
        );
      }

      if (tmdbId) {
        try {
          await upgradeMarkerFile(marker.filePath, tmdbId);

          // Create database record for future runs
          await repository.save({
            tmdbId,
            title: marker.title,
            placeholderPath: marker.placeholderPath,
            configId: '', // Will be updated when placeholder is properly tracked
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          logger.info('Adopted orphaned placeholder and created DB record', {
            label: 'PlaceholderService',
            title: marker.title,
            tmdbId,
            ratingKey: plexItem.ratingKey,
          });
        } catch (error) {
          logger.warn('Failed to upgrade orphaned marker', {
            label: 'PlaceholderService',
            title: marker.title,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      discovered.push({
        marker: { ...marker, tmdbId: tmdbId ?? undefined },
        plexItem: { ratingKey: plexItem.ratingKey, title: plexItem.title },
        needsTitleFix: isStillPlaceholder,
        discoveryMethod: 'title-search',
      });
    } else {
      // Not found in Plex at all
      logger.warn('Orphaned placeholder not found in Plex', {
        label: 'PlaceholderService',
        title: marker.title,
        path: marker.placeholderPath,
      });

      discovered.push({
        marker,
        plexItem: undefined,
        needsTitleFix: false,
        discoveryMethod: 'not-found',
      });
    }
  }

  logger.info('Placeholder discovery complete', {
    label: 'PlaceholderService',
    libraryId,
    total: discovered.length,
    tier1: discovered.filter((d) => d.discoveryMethod === 'tmdb-id').length,
    tier2: discovered.filter((d) => d.discoveryMethod === 'database-lookup')
      .length,
    tier3: discovered.filter((d) => d.discoveryMethod === 'title-search')
      .length,
    notFound: discovered.filter((d) => d.discoveryMethod === 'not-found')
      .length,
  });

  return discovered;
}

/**
 * Movie placeholder discovery using filename patterns
 *
 * Movies store metadata in filename: {tmdb-12345} {edition-Trailer}
 * This is simpler than TV shows - just scan filenames and extract TMDB IDs
 *
 * This approach scales O(p) with placeholder count, not O(n) with library size
 *
 * @param plexClient - Plex API client
 * @param libraryId - Library ID to search in
 * @param libraryPath - Filesystem path to library root
 * @returns Array of discovered movie placeholders with Plex matching information
 */
export async function discoverMoviePlaceholdersFromFilenames(
  plexClient: PlexAPI,
  libraryId: string,
  libraryPath: string
): Promise<DiscoveredMoviePlaceholder[]> {
  const { scanForMoviePlaceholders } = await import(
    '@server/lib/placeholders/placeholderManager'
  );

  // Step 1: Scan filesystem for placeholder files
  const movies = await scanForMoviePlaceholders(libraryPath);

  if (movies.length === 0) {
    logger.debug('No movie placeholders found in library', {
      label: 'PlaceholderService',
      libraryId,
      libraryPath,
    });
    return [];
  }

  const discovered: DiscoveredMoviePlaceholder[] = [];

  // Import PlaceholderContextService for verification
  const { placeholderContextService } = await import(
    '@server/lib/placeholders/services/PlaceholderContextService'
  );

  // Step 2: Batch query Plex for all TMDB IDs at once
  const tmdbLookups = movies.map((m) => ({
    tmdbId: m.tmdbId,
    mediaType: 'movie' as const,
    title: m.title,
  }));

  logger.info('Discovering movie placeholders via filename parsing', {
    label: 'PlaceholderService',
    count: movies.length,
  });

  const plexMatches = await findPlexItemsByTmdbIds(
    plexClient,
    tmdbLookups,
    libraryId
  );

  // Batch check *arr download status for all movies
  const arrLookups = movies.map((m) => ({
    tmdbId: m.tmdbId,
    mediaType: 'movie' as const,
  }));

  const { moviesByTmdbId } =
    await placeholderContextService.batchCheckDownloadStatus(arrLookups);

  // Step 3: Match filesystem placeholders to Plex items and verify they're still placeholders
  for (const movie of movies) {
    const plexItem = plexMatches.get(`${movie.tmdbId}-movie`);

    // Check if *arr reports content as downloaded
    const arrStatus = moviesByTmdbId.get(movie.tmdbId);
    const isDownloadedInArr = arrStatus?.downloaded === true;

    // Verify it's still a placeholder (check if real movie was added)
    let needsCleanup = false;
    if (plexItem) {
      const plexMetadata = await plexClient.getMetadata(
        plexItem.ratingKey.toString(),
        { includeChildren: true }
      );
      const isStillPlaceholder =
        placeholderContextService.isPlaceholderItem(plexMetadata);

      if (!isStillPlaceholder) {
        logger.info('Movie placeholder has real content now', {
          label: 'PlaceholderService',
          title: movie.title,
          ratingKey: plexItem.ratingKey,
        });
        needsCleanup = true;
      } else if (isDownloadedInArr) {
        logger.info(
          'Movie placeholder has content downloaded in Radarr - triggering cleanup',
          {
            label: 'PlaceholderService',
            title: movie.title,
            tmdbId: movie.tmdbId,
          }
        );
        needsCleanup = true;
      }
    } else if (isDownloadedInArr) {
      // No Plex item but *arr says downloaded - still trigger cleanup
      logger.info(
        'No Plex item but content downloaded in Radarr - triggering cleanup',
        {
          label: 'PlaceholderService',
          title: movie.title,
          tmdbId: movie.tmdbId,
        }
      );
      needsCleanup = true;
    }

    discovered.push({
      movie,
      plexItem: plexItem
        ? { ratingKey: plexItem.ratingKey, title: plexItem.title }
        : undefined,
      needsCleanup,
      discoveryMethod: plexItem ? 'tmdb-id' : 'not-found',
    });
  }

  logger.info('Movie placeholder discovery complete', {
    label: 'PlaceholderService',
    libraryId,
    total: discovered.length,
    matched: discovered.filter((d) => d.plexItem).length,
    notFound: discovered.filter((d) => !d.plexItem).length,
  });

  return discovered;
}
