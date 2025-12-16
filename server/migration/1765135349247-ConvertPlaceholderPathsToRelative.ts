import { getRepository } from '@server/datasource';
import { PlaceholderItem } from '@server/entity/PlaceholderItem';
import logger from '@server/logger';
import path from 'path';
import type { MigrationInterface } from 'typeorm';

/**
 * Migration to convert placeholder paths from absolute to relative
 *
 * REASON:
 * Storing absolute paths causes issues when users change their library root folder
 * in Agregarr settings. Even if the mounted volume hasn't changed, the stored
 * absolute paths become invalid.
 *
 * SOLUTION:
 * Store only the relative path (e.g., "MovieName (2025)/file.mp4" instead of
 * "/mnt/e/data/media/movies/MovieName (2025)/file.mp4").
 *
 * When deleting, we combine the relative path with the current library root from settings.
 */
export class ConvertPlaceholderPathsToRelative1765135349247
  implements MigrationInterface
{
  name = 'ConvertPlaceholderPathsToRelative1765135349247';

  public async up(): Promise<void> {
    logger.info('Converting placeholder paths from absolute to relative', {
      label: 'Migration',
    });

    try {
      const repository = getRepository(PlaceholderItem);
      const placeholders = await repository.find();

      logger.info('Found placeholder records to convert', {
        label: 'Migration',
        count: placeholders.length,
      });

      let convertedCount = 0;

      for (const placeholder of placeholders) {
        if (!placeholder.placeholderPath) {
          continue;
        }

        // Extract relative path
        // Absolute: /mnt/e/data/media/movies/MovieName (2025)/file.mp4
        // Relative: MovieName (2025)/file.mp4
        const pathParts = placeholder.placeholderPath
          .split(path.sep)
          .filter((p) => p);

        let relativePath = '';

        if (placeholder.mediaType === 'movie') {
          // Take last 2 parts: folder + filename
          relativePath = pathParts.slice(-2).join(path.sep);
        } else {
          // TV: Take last 3 parts: show folder + Season 00 + filename
          relativePath = pathParts.slice(-3).join(path.sep);
        }

        if (relativePath && relativePath !== placeholder.placeholderPath) {
          placeholder.placeholderPath = relativePath;
          await repository.save(placeholder);
          convertedCount++;

          logger.debug('Converted placeholder path to relative', {
            label: 'Migration',
            title: placeholder.title,
            newPath: relativePath,
          });
        }
      }

      logger.info('Completed placeholder path conversion', {
        label: 'Migration',
        total: placeholders.length,
        converted: convertedCount,
      });
    } catch (error) {
      logger.error('Failed to convert placeholder paths', {
        label: 'Migration',
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - this is a data cleanup migration
      // The system will still work with absolute paths, just less robustly
    }
  }

  public async down(): Promise<void> {
    logger.info(
      'Cannot reverse relative path conversion (no way to reconstruct original absolute paths)',
      {
        label: 'Migration',
      }
    );
    // We can't reverse this migration because we don't know what the original
    // absolute paths were. But that's okay - relative paths work fine.
  }
}
