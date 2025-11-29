import type PlexAPI from '@server/api/plexapi';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

/**
 * PlexSmartCollectionManager - Handles Plex smart collection operations
 * Smart collections are auto-populated by Plex based on filters
 */
class PlexSmartCollectionManager {
  private plexApi: PlexAPI;

  constructor(plexApi: PlexAPI) {
    this.plexApi = plexApi;
  }

  /**
   * Create a label-based smart collection for unwatched items
   * This creates a smart collection that filters items by label AND unwatched status
   * No base collection needed - items have the label applied directly
   *
   * @param title - Title for the smart collection
   * @param libraryKey - Library section key (e.g., "1" for movies)
   * @param labelName - Label name to filter by (e.g., "agregarr-collection-123")
   * @param mediaType - 'movie' or 'tv'
   * @param sortOption - Sort parameter (e.g., 'titleSort', 'year:desc')
   * @param agregarrLabel - Agregarr management label to add to the smart collection
   * @returns The rating key of the created smart collection or null if failed
   */
  public async createLabelBasedSmartCollection(
    title: string,
    libraryKey: string,
    labelName: string,
    mediaType: 'movie' | 'tv' = 'movie',
    sortOption?: string,
    agregarrLabel?: string
  ): Promise<string | null> {
    try {
      logger.debug(
        `Creating label-based smart collection "${title}" for library ${libraryKey}`,
        {
          label: 'Plex API',
          title,
          libraryKey,
          labelName,
          mediaType,
        }
      );

      // Step 1: Create the smart collection with label + unwatched filter
      const type = mediaType === 'movie' ? 1 : 2;
      const sortParam = sortOption || 'originallyAvailableAt:desc'; // Default to release date (newest first)

      // Build filter URI: label AND unwatched
      // TV shows use different filter parameters than movies
      let filterUri: string;
      if (mediaType === 'tv') {
        // TV: Filter by label AND unwatched episodes
        filterUri = `/library/sections/${libraryKey}/all?type=${type}&sort=${sortParam}&show.unwatchedLeaves=1&and=1&label=${encodeURIComponent(
          labelName
        )}`;
      } else {
        // Movie: Filter by label AND unwatched
        filterUri = `/library/sections/${libraryKey}/all?type=${type}&sort=${sortParam}&unwatched=1&and=1&label=${encodeURIComponent(
          labelName
        )}`;
      }

      const uri = `server://${
        getSettings().plex.machineId
      }/com.plexapp.plugins.library${filterUri}`;

      const createUrl = `/library/collections?type=${type}&title=${encodeURIComponent(
        title
      )}&smart=1&uri=${encodeURIComponent(uri)}&sectionId=${libraryKey}`;

      const createResponse = await this.plexApi['safePostQuery'](createUrl);

      if (
        !createResponse ||
        typeof createResponse !== 'object' ||
        !('MediaContainer' in createResponse)
      ) {
        logger.error(
          'Invalid response when creating label-based smart collection',
          {
            label: 'Plex API',
            response: createResponse,
          }
        );
        return null;
      }

      const mediaContainer = createResponse.MediaContainer as {
        Metadata?: { ratingKey: string }[];
      };

      if (!mediaContainer.Metadata || mediaContainer.Metadata.length === 0) {
        logger.error(
          'No metadata returned when creating label-based smart collection',
          {
            label: 'Plex API',
            response: createResponse,
          }
        );
        return null;
      }

      const smartCollectionRatingKey = mediaContainer.Metadata[0].ratingKey;

      // Step 2: Set the collection to be filtered by user (per-user watch status)
      await this.setCollectionUserFilter(smartCollectionRatingKey);

      // Step 3: Add Agregarr management label so it's not discovered as pre-existing
      if (agregarrLabel) {
        await this.plexApi.addLabelToCollection(
          smartCollectionRatingKey,
          agregarrLabel
        );
      }

      logger.info(
        `Successfully created label-based smart collection "${title}" with rating key ${smartCollectionRatingKey}`,
        {
          label: 'Plex API',
          title,
          smartCollectionRatingKey,
          labelName,
        }
      );

      return smartCollectionRatingKey;
    } catch (error) {
      logger.error(`Error creating label-based smart collection "${title}"`, {
        label: 'Plex API',
        title,
        libraryKey,
        labelName,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Set collection filtering to be based on the current user viewing the content
   * @param collectionRatingKey - The rating key of the collection to configure
   */
  public async setCollectionUserFilter(
    collectionRatingKey: string
  ): Promise<void> {
    try {
      await this.plexApi['safePutQuery'](
        `/library/metadata/${collectionRatingKey}/prefs?collectionFilterBasedOnUser=1`
      );

      logger.debug(
        `Set user-based filtering for collection ${collectionRatingKey}`,
        {
          label: 'Plex API',
          collectionRatingKey,
        }
      );
    } catch (error) {
      logger.error(
        `Error setting user filter for collection ${collectionRatingKey}`,
        {
          label: 'Plex API',
          collectionRatingKey,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
    }
  }

  /**
   * Update a label-based smart collection's URI (including sort parameters)
   * @param smartCollectionRatingKey - The rating key of the smart collection to update
   * @param libraryKey - Library section key (e.g., "1" for movies)
   * @param labelName - Label name to filter by
   * @param mediaType - 'movie' or 'tv'
   * @param sortOption - Sort parameter (e.g., 'year:desc', 'titleSort')
   * @returns Promise<void>
   */
  public async updateLabelBasedSmartCollectionUri(
    smartCollectionRatingKey: string,
    libraryKey: string,
    labelName: string,
    mediaType: 'movie' | 'tv' = 'movie',
    sortOption?: string
  ): Promise<void> {
    try {
      logger.debug(
        `Updating label-based smart collection URI for collection ${smartCollectionRatingKey}`,
        {
          label: 'Plex API',
          smartCollectionRatingKey,
          libraryKey,
          labelName,
          mediaType,
          sortOption,
        }
      );

      // Build the filter URI with the specified sort option
      const type = mediaType === 'movie' ? 1 : 2;
      const sortParam = sortOption || 'originallyAvailableAt:desc'; // Default to release date (newest first)

      // Build filter URI: label AND unwatched
      let filterUri: string;
      if (mediaType === 'tv') {
        // TV: Filter by label AND unwatched episodes
        filterUri = `/library/sections/${libraryKey}/all?type=${type}&sort=${sortParam}&show.unwatchedLeaves=1&and=1&label=${encodeURIComponent(
          labelName
        )}`;
      } else {
        // Movie: Filter by label AND unwatched
        filterUri = `/library/sections/${libraryKey}/all?type=${type}&sort=${sortParam}&unwatched=1&and=1&label=${encodeURIComponent(
          labelName
        )}`;
      }

      const uri = `server://${
        getSettings().plex.machineId
      }/com.plexapp.plugins.library${filterUri}`;

      // Update the smart collection URI using PUT request
      const updateUrl = `/library/collections/${smartCollectionRatingKey}/items?uri=${encodeURIComponent(
        uri
      )}`;
      await this.plexApi['safePutQuery'](updateUrl);

      logger.debug(
        `Successfully updated label-based smart collection URI for collection ${smartCollectionRatingKey}`,
        {
          label: 'Plex API',
          smartCollectionRatingKey,
          sortParam,
        }
      );
    } catch (error) {
      logger.error(
        `Error updating label-based smart collection URI for collection ${smartCollectionRatingKey}`,
        {
          label: 'Plex API',
          smartCollectionRatingKey,
          error:
            error instanceof Error ? error.message : 'Unknown error occurred',
        }
      );
      throw error;
    }
  }

  /**
   * Delete a smart collection (same as regular collection deletion)
   * @param smartCollectionRatingKey - The rating key of the smart collection to delete
   */
  public async deleteSmartCollection(
    smartCollectionRatingKey: string
  ): Promise<void> {
    return this.plexApi.deleteCollection(smartCollectionRatingKey);
  }

  /**
   * Create a filtered Recently Added smart collection that excludes coming soon placeholders
   * @param title - Title for the smart collection (usually "Recently Added")
   * @param libraryKey - Library section key (e.g., "1" for movies)
   * @param mediaType - 'movie' or 'tv'
   * @returns The rating key of the created smart collection or null if failed
   */
  public async createFilteredRecentlyAdded(
    title: string,
    libraryKey: string,
    mediaType: 'movie' | 'tv'
  ): Promise<string | null> {
    try {
      logger.debug(
        `Creating filtered Recently Added smart collection "${title}" for library ${libraryKey}`,
        {
          label: 'Plex API',
          title,
          libraryKey,
          mediaType,
        }
      );

      const type = mediaType === 'movie' ? 1 : 2;

      // Build filter URI based on media type
      let filterUri: string;
      if (mediaType === 'tv') {
        // TV Shows: Sort by Last Episode Date Added (lastViewedAt), filter out "Trailer (Placeholder)"
        // Note: Plex uses title!= for "is not" filter
        const sortParam = 'lastViewedAt:desc';
        const titleFilter = encodeURIComponent('Trailer (Placeholder)');
        filterUri = `/library/sections/${libraryKey}/all?type=${type}&sort=${sortParam}&episode.title!=${titleFilter}`;
      } else {
        // Movies: Sort by Date Added (addedAt), filter out "trailer-placeholder" label
        const sortParam = 'addedAt:desc';
        const labelFilter = 'trailer-placeholder';
        filterUri = `/library/sections/${libraryKey}/all?type=${type}&sort=${sortParam}&label!=${encodeURIComponent(
          labelFilter
        )}`;
      }

      const uri = `server://${
        getSettings().plex.machineId
      }/com.plexapp.plugins.library${filterUri}`;

      const createUrl = `/library/collections?type=${type}&title=${encodeURIComponent(
        title
      )}&smart=1&uri=${encodeURIComponent(uri)}&sectionId=${libraryKey}`;

      const createResponse = await this.plexApi['safePostQuery'](createUrl);

      if (
        !createResponse ||
        typeof createResponse !== 'object' ||
        !('MediaContainer' in createResponse)
      ) {
        logger.error(
          'Invalid response when creating filtered Recently Added smart collection',
          {
            label: 'Plex API',
            response: createResponse,
          }
        );
        return null;
      }

      const mediaContainer = createResponse.MediaContainer as {
        Metadata?: { ratingKey: string }[];
      };

      if (!mediaContainer.Metadata || mediaContainer.Metadata.length === 0) {
        logger.error(
          'No metadata returned when creating filtered Recently Added smart collection',
          {
            label: 'Plex API',
            response: createResponse,
          }
        );
        return null;
      }

      const smartCollectionRatingKey = mediaContainer.Metadata[0].ratingKey;

      // Set the collection to be filtered by user
      await this.setCollectionUserFilter(smartCollectionRatingKey);

      // Note: Labels, titles, and visibility are handled by updateCollectionMetadata in the sync flow

      logger.info(
        `Successfully created filtered Recently Added smart collection "${title}" with rating key ${smartCollectionRatingKey}`,
        {
          label: 'Plex API',
          title,
          smartCollectionRatingKey,
          mediaType,
        }
      );

      return smartCollectionRatingKey;
    } catch (error) {
      logger.error(
        `Error creating filtered Recently Added smart collection "${title}"`,
        {
          label: 'Plex API',
          title,
          libraryKey,
          mediaType,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return null;
    }
  }
}

export default PlexSmartCollectionManager;
