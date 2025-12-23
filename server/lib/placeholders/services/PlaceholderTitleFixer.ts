import type PlexAPI from '@server/api/plexapi';
import logger from '@server/logger';

/**
 * Ensure a TV show placeholder has the correct episode title set
 * Includes retry logic to handle cases where Plex hasn't fully populated episode metadata yet
 * @param plexClient - Plex API client
 * @param showRatingKey - The show's rating key in Plex
 * @param showTitle - The show's title (for logging)
 * @param maxRetries - Maximum number of retry attempts (default: 5)
 * @param retryDelayMs - Delay between retries in milliseconds (default: 2000)
 * @returns true if title was set successfully, false otherwise
 */
export async function ensurePlaceholderEpisodeTitle(
  plexClient: PlexAPI,
  showRatingKey: string,
  showTitle: string,
  maxRetries = 5,
  retryDelayMs = 2000
): Promise<boolean> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Get seasons for the show
      const seasons = await plexClient.getChildrenMetadata(showRatingKey);

      if (!seasons || seasons.length === 0) {
        logger.debug(
          `Attempt ${attempt}/${maxRetries}: No seasons found for show`,
          {
            label: 'PlaceholderService',
            title: showTitle,
            ratingKey: showRatingKey,
          }
        );

        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          continue;
        }
        return false;
      }

      // Find Season 00
      const season00 = seasons.find((season) => season.index === 0);

      if (!season00) {
        logger.debug(
          `Attempt ${attempt}/${maxRetries}: Season 00 not found for show`,
          {
            label: 'PlaceholderService',
            title: showTitle,
            availableSeasons: seasons.map((s) => s.index),
          }
        );

        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          continue;
        }
        return false;
      }

      // Get episodes from Season 00
      const episodesData = await plexClient.getChildrenMetadata(
        season00.ratingKey
      );

      if (!episodesData || episodesData.length === 0) {
        logger.debug(
          `Attempt ${attempt}/${maxRetries}: No episodes found in Season 00`,
          {
            label: 'PlaceholderService',
            title: showTitle,
            season00RatingKey: season00.ratingKey,
          }
        );

        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          continue;
        }
        return false;
      }

      // Get the first episode (should be S00E00)
      const episode = episodesData[0];

      // Check if title is already correct
      if (episode.title === 'Trailer (Placeholder)') {
        logger.debug('Episode title already correct', {
          label: 'PlaceholderService',
          title: showTitle,
          episodeRatingKey: episode.ratingKey,
        });
        return true;
      }

      // Set the correct title
      await plexClient.updateItemTitle(
        episode.ratingKey,
        'Trailer (Placeholder)'
      );

      logger.info('Successfully set placeholder episode title', {
        label: 'PlaceholderService',
        title: showTitle,
        episodeRatingKey: episode.ratingKey,
        oldTitle: episode.title,
        attempt,
      });

      return true;
    } catch (error) {
      logger.warn(
        `Attempt ${attempt}/${maxRetries}: Error setting placeholder episode title`,
        {
          label: 'PlaceholderService',
          title: showTitle,
          ratingKey: showRatingKey,
          error: error instanceof Error ? error.message : String(error),
        }
      );

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        continue;
      }
      return false;
    }
  }

  return false;
}
