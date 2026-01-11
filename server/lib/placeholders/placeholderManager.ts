import logger from '@server/logger';
import fs from 'fs/promises';
import path from 'path';
import type { PlaceholderOptions, PlaceholderResult } from './types';

/**
 * Sanitize filename to remove invalid characters
 */
function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[<>:"/\\|?*]/g, '') // Remove invalid chars
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

/**
 * Create placeholder file for movie
 */
async function createMoviePlaceholder(
  options: PlaceholderOptions
): Promise<PlaceholderResult> {
  const { title, year, tmdbId, libraryPath, trailerPath } = options;

  // Folder format: MovieName (Year)
  const sanitizedTitle = sanitizeFilename(title);
  const yearStr = year ? ` (${year})` : '';
  const folderName = `${sanitizedTitle}${yearStr}`;
  const movieFolder = path.join(libraryPath, folderName);

  // Filename format: MovieName (Year) {tmdb-12345} {edition-Trailer}.mp4
  const filename = `${folderName} {tmdb-${tmdbId}} {edition-Trailer}.mp4`;
  const destinationPath = path.join(movieFolder, filename);

  logger.debug('Creating movie placeholder', {
    label: 'Coming Soon Placeholder',
    title,
    filename,
    movieFolder,
    destinationPath,
  });

  // Create movie folder
  await fs.mkdir(movieFolder, { recursive: true });

  // Copy trailer to movie folder
  await fs.copyFile(trailerPath, destinationPath);

  // Clean up temporary trailer file
  try {
    await fs.unlink(trailerPath);
    logger.debug('Cleaned up temporary trailer file', {
      label: 'Coming Soon Placeholder',
      path: trailerPath,
    });
  } catch (error) {
    logger.warn('Failed to clean up temporary trailer file', {
      label: 'Coming Soon Placeholder',
      path: trailerPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  logger.info('Created movie placeholder', {
    label: 'Coming Soon Placeholder',
    title,
    filename,
  });

  return {
    placeholderPath: destinationPath,
    filename,
  };
}

/**
 * Create placeholder file for TV show
 */
async function createTVPlaceholder(
  options: PlaceholderOptions
): Promise<PlaceholderResult> {
  const { title, year, libraryPath, trailerPath } = options;

  // Directory format: ShowName (Year)/Season 00/S00E00.Trailer.mp4
  const sanitizedTitle = sanitizeFilename(title);
  const yearStr = year ? ` (${year})` : '';
  const showDir = path.join(libraryPath, `${sanitizedTitle}${yearStr}`);
  const seasonDir = path.join(showDir, 'Season 00');

  logger.debug('Creating TV show placeholder', {
    label: 'Coming Soon Placeholder',
    title,
    showDir,
    seasonDir,
  });

  // Create directories
  await fs.mkdir(seasonDir, { recursive: true });

  // Create trailer file
  const filename = 'S00E00.Trailer.mp4';
  const destinationPath = path.join(seasonDir, filename);
  await fs.copyFile(trailerPath, destinationPath);

  // Clean up temporary trailer file
  try {
    await fs.unlink(trailerPath);
    logger.debug('Cleaned up temporary trailer file', {
      label: 'Coming Soon Placeholder',
      path: trailerPath,
    });
  } catch (error) {
    logger.warn('Failed to clean up temporary trailer file', {
      label: 'Coming Soon Placeholder',
      path: trailerPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Create .comingsoon marker file for identification
  const markerPath = path.join(seasonDir, '.comingsoon');
  await fs.writeFile(
    markerPath,
    JSON.stringify({
      createdAt: new Date().toISOString(),
      title,
      year,
      tmdbId: options.tmdbId,
      tvdbId: options.tvdbId,
    }),
    'utf-8'
  );

  logger.info('Created TV show placeholder', {
    label: 'Coming Soon Placeholder',
    title,
    filename: destinationPath,
  });

  return {
    placeholderPath: destinationPath,
    filename,
  };
}

/**
 * Create placeholder file in Plex library
 */
export async function createPlaceholder(
  options: PlaceholderOptions
): Promise<PlaceholderResult> {
  const { mediaType } = options;

  try {
    if (mediaType === 'movie') {
      return await createMoviePlaceholder(options);
    } else {
      return await createTVPlaceholder(options);
    }
  } catch (error) {
    logger.error('Failed to create placeholder', {
      label: 'Coming Soon Placeholder',
      error: error instanceof Error ? error.message : String(error),
      title: options.title,
      mediaType: options.mediaType,
    });
    throw error;
  }
}

/**
 * Remove placeholder file
 */
export async function removePlaceholder(
  placeholderPath: string,
  mediaType: 'movie' | 'tv'
): Promise<void> {
  try {
    // Safety check: Verify path contains placeholder marker (supports both old and new format)
    if (
      !placeholderPath.includes('{edition-Trailer}') &&
      !placeholderPath.includes('{edition-Placeholder}') &&
      !placeholderPath.includes('{edition-Coming Soon}') &&
      !placeholderPath.includes('S00E00.Trailer.mp4')
    ) {
      logger.warn(
        'Refusing to delete - path does not appear to be a placeholder',
        {
          label: 'Coming Soon Placeholder',
          path: placeholderPath,
          mediaType,
        }
      );
      throw new Error('Invalid placeholder path - missing placeholder markers');
    }

    logger.debug('Removing placeholder', {
      label: 'Coming Soon Placeholder',
      path: placeholderPath,
      mediaType,
    });

    // Delete the file
    await fs.unlink(placeholderPath);

    // Clean up associated .trickplay directory (Jellyfin creates these for video thumbnails)
    // Pattern: "Movie {tmdb-123} {edition-Trailer}.mp4" -> "Movie {tmdb-123} {edition-Trailer}.trickplay"
    if (placeholderPath.endsWith('.mp4')) {
      const trickplayPath = placeholderPath.replace(/\.mp4$/, '.trickplay');
      try {
        const trickplayStat = await fs.stat(trickplayPath);
        if (trickplayStat.isDirectory()) {
          await fs.rm(trickplayPath, { recursive: true });
          logger.debug('Removed associated trickplay directory', {
            label: 'Coming Soon Placeholder',
            path: trickplayPath,
          });
        }
      } catch {
        // Trickplay directory doesn't exist, that's fine
      }
    }

    // Clean up parent directories if empty
    if (mediaType === 'movie') {
      const movieDir = path.dirname(placeholderPath);

      // Try to remove movie directory if it's empty
      try {
        const files = await fs.readdir(movieDir);
        if (files.length === 0) {
          await fs.rmdir(movieDir);
          logger.debug('Removed empty movie directory', {
            label: 'Coming Soon Placeholder',
            path: movieDir,
          });
        }
      } catch {
        // Directory not empty or other error, ignore
      }
    } else if (mediaType === 'tv') {
      const seasonDir = path.dirname(placeholderPath);
      const showDir = path.dirname(seasonDir);

      // Remove .comingsoon marker if it exists
      const markerPath = path.join(seasonDir, '.comingsoon');
      try {
        await fs.unlink(markerPath);
      } catch {
        // Marker file might not exist, ignore
      }

      // Try to remove Season 00 directory if it's empty
      try {
        const files = await fs.readdir(seasonDir);
        if (files.length === 0) {
          await fs.rmdir(seasonDir);
          logger.debug('Removed empty season directory', {
            label: 'Coming Soon Placeholder',
            path: seasonDir,
          });

          // Try to remove show directory if it's empty
          const showFiles = await fs.readdir(showDir);
          if (showFiles.length === 0) {
            await fs.rmdir(showDir);
            logger.debug('Removed empty show directory', {
              label: 'Coming Soon Placeholder',
              path: showDir,
            });
          }
        }
      } catch {
        // Directory not empty or other error, ignore
      }
    }

    logger.info('Removed placeholder successfully', {
      label: 'Coming Soon Placeholder',
      path: placeholderPath,
    });
  } catch (error) {
    logger.error('Failed to remove placeholder', {
      label: 'Coming Soon Placeholder',
      error: error instanceof Error ? error.message : String(error),
      path: placeholderPath,
    });
    throw error;
  }
}

/**
 * Marker file content structure
 */
export interface PlaceholderMarker {
  createdAt: string;
  title: string;
  year?: number;
  tmdbId?: number; // Optional for backward compatibility with old markers
  tvdbId?: number;
}

/**
 * Discovered marker with file path
 */
export interface DiscoveredMarker extends PlaceholderMarker {
  filePath: string; // Path to the .comingsoon marker file
  placeholderPath: string; // Path to the S00E00.Trailer.mp4 file
}

/**
 * Scan a library directory for .comingsoon marker files
 * Returns all discovered markers with their file paths
 */
export async function scanForMarkerFiles(
  libraryPath: string
): Promise<DiscoveredMarker[]> {
  const markers: DiscoveredMarker[] = [];

  try {
    // Get all items in the library root
    const items = await fs.readdir(libraryPath, { withFileTypes: true });

    for (const item of items) {
      if (!item.isDirectory()) continue;

      const showDir = path.join(libraryPath, item.name);
      const season00Dir = path.join(showDir, 'Season 00');

      // Check if Season 00 exists
      try {
        const season00Stat = await fs.stat(season00Dir);
        if (!season00Stat.isDirectory()) continue;
      } catch {
        continue; // Season 00 doesn't exist
      }

      // Check for .comingsoon marker
      const markerPath = path.join(season00Dir, '.comingsoon');
      try {
        const markerContent = await fs.readFile(markerPath, 'utf-8');
        const markerData = JSON.parse(markerContent) as PlaceholderMarker;

        // Path to the actual placeholder file
        const placeholderPath = path.join(season00Dir, 'S00E00.Trailer.mp4');

        markers.push({
          ...markerData,
          filePath: markerPath,
          placeholderPath,
        });

        logger.debug('Found placeholder marker', {
          label: 'PlaceholderManager',
          title: markerData.title,
          hasTmdbId: !!markerData.tmdbId,
          path: markerPath,
        });
      } catch (error) {
        // Marker file doesn't exist or is invalid JSON - skip
        logger.debug('No valid marker found in Season 00', {
          label: 'PlaceholderManager',
          path: season00Dir,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info('Scanned library for placeholder markers', {
      label: 'PlaceholderManager',
      libraryPath,
      markersFound: markers.length,
      withTmdbId: markers.filter((m) => m.tmdbId).length,
      withoutTmdbId: markers.filter((m) => !m.tmdbId).length,
    });

    return markers;
  } catch (error) {
    logger.error('Failed to scan for marker files', {
      label: 'PlaceholderManager',
      libraryPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Upgrade an old marker file to include tmdbId and tvdbId
 */
export async function upgradeMarkerFile(
  markerPath: string,
  tmdbId: number,
  tvdbId?: number
): Promise<void> {
  try {
    // Read existing marker
    const markerContent = await fs.readFile(markerPath, 'utf-8');
    const markerData = JSON.parse(markerContent) as PlaceholderMarker;

    // Add tmdbId and tvdbId
    const upgradedMarker = {
      ...markerData,
      tmdbId,
      tvdbId,
    };

    // Write back to file
    await fs.writeFile(
      markerPath,
      JSON.stringify(upgradedMarker, null, 2),
      'utf-8'
    );

    logger.info('Upgraded marker file with TMDB ID', {
      label: 'PlaceholderManager',
      title: markerData.title,
      tmdbId,
      tvdbId,
      path: markerPath,
    });
  } catch (error) {
    logger.error('Failed to upgrade marker file', {
      label: 'PlaceholderManager',
      path: markerPath,
      tmdbId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Discovered movie placeholder with metadata extracted from filename
 */
export interface DiscoveredMoviePlaceholder {
  title: string; // Extracted from folder name
  year?: number; // Extracted from folder name
  tmdbId: number; // Extracted from {tmdb-12345}
  placeholderPath: string; // Full path to the .mp4 file
  folderPath: string; // Path to the movie folder
}

/**
 * Scan a movie library directory for placeholder files based on filename pattern
 * Movies use {edition-Trailer} and {tmdb-12345} in filename - no marker file needed
 * Returns all discovered movie placeholders with extracted metadata
 */
export async function scanForMoviePlaceholders(
  libraryPath: string
): Promise<DiscoveredMoviePlaceholder[]> {
  const placeholders: DiscoveredMoviePlaceholder[] = [];

  try {
    // Get all items in the library root
    const items = await fs.readdir(libraryPath, { withFileTypes: true });

    for (const item of items) {
      if (!item.isDirectory()) continue;

      const movieFolder = path.join(libraryPath, item.name);

      // Check for placeholder files in this folder
      try {
        const files = await fs.readdir(movieFolder);

        for (const file of files) {
          // Look for files with {edition-Trailer} pattern
          if (
            !file.includes('{edition-Trailer}') &&
            !file.includes('{edition-Placeholder}') &&
            !file.includes('{edition-Coming Soon}')
          ) {
            continue;
          }

          // Extract TMDB ID from {tmdb-12345} pattern
          const tmdbMatch = file.match(/\{tmdb-(\d+)\}/);
          if (!tmdbMatch) {
            logger.warn('Placeholder file missing TMDB ID in filename', {
              label: 'PlaceholderManager',
              file,
              folder: movieFolder,
            });
            continue;
          }

          const tmdbId = parseInt(tmdbMatch[1], 10);

          // Extract title and year from folder name
          // Format: "MovieTitle (Year)" or "MovieTitle"
          const folderName = item.name;
          const yearMatch = folderName.match(/\((\d{4})\)$/);
          const year = yearMatch ? parseInt(yearMatch[1], 10) : undefined;
          const title = yearMatch
            ? folderName.substring(0, folderName.lastIndexOf('(')).trim()
            : folderName;

          const placeholderPath = path.join(movieFolder, file);

          placeholders.push({
            title,
            year,
            tmdbId,
            placeholderPath,
            folderPath: movieFolder,
          });

          logger.debug('Found movie placeholder', {
            label: 'PlaceholderManager',
            title,
            year,
            tmdbId,
            path: placeholderPath,
          });

          // Only process first placeholder file per folder
          break;
        }
      } catch (error) {
        // Can't read folder contents, skip
        logger.debug('Could not read movie folder', {
          label: 'PlaceholderManager',
          path: movieFolder,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info('Scanned movie library for placeholders', {
      label: 'PlaceholderManager',
      libraryPath,
      placeholdersFound: placeholders.length,
    });

    return placeholders;
  } catch (error) {
    logger.error('Failed to scan for movie placeholders', {
      label: 'PlaceholderManager',
      libraryPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
