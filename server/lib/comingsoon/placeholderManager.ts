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

  // Filename format: MovieName (Year) {tmdb-12345} {edition-Coming Soon}.mp4
  const filename = `${folderName} {tmdb-${tmdbId}} {edition-Coming Soon}.mp4`;
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
    // Safety check: Verify path contains Coming Soon marker
    if (
      !placeholderPath.includes('{edition-Coming Soon}') &&
      !placeholderPath.includes('S00E00.Trailer.mp4')
    ) {
      logger.warn(
        'Refusing to delete - path does not appear to be a Coming Soon placeholder',
        {
          label: 'Coming Soon Placeholder',
          path: placeholderPath,
          mediaType,
        }
      );
      throw new Error('Invalid placeholder path - missing Coming Soon markers');
    }

    logger.debug('Removing placeholder', {
      label: 'Coming Soon Placeholder',
      path: placeholderPath,
      mediaType,
    });

    // Delete the file
    await fs.unlink(placeholderPath);

    // For TV shows, also clean up parent directories if empty
    if (mediaType === 'tv') {
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
