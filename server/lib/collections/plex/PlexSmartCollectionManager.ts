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
   * @param maxItems - Maximum number of items to include in the smart collection
   * @returns The rating key of the created smart collection or null if failed
   */
  public async createLabelBasedSmartCollection(
    title: string,
    libraryKey: string,
    labelName: string,
    mediaType: 'movie' | 'tv' = 'movie',
    sortOption?: string,
    agregarrLabel?: string,
    maxItems?: number
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

      // Add limit parameter if specified
      if (maxItems && maxItems > 0) {
        filterUri += `&limit=${maxItems}`;
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
   * @param maxItems - Maximum number of items to include in the smart collection
   * @returns Promise<void>
   */
  public async updateLabelBasedSmartCollectionUri(
    smartCollectionRatingKey: string,
    libraryKey: string,
    labelName: string,
    mediaType: 'movie' | 'tv' = 'movie',
    sortOption?: string,
    maxItems?: number
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

      // Add limit parameter if specified
      if (maxItems && maxItems > 0) {
        filterUri += `&limit=${maxItems}`;
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
   * Create a filtered hub replacement smart collection that excludes coming soon placeholders
   * Supports: recently_added, recently_released
   * @param title - Title for the smart collection
   * @param libraryKey - Library section key (e.g., "1" for movies)
   * @param mediaType - 'movie' or 'tv'
   * @param subtype - Hub subtype ('recently_added' or 'recently_released')
   * @param maxItems - Maximum number of items to include in the smart collection
   * @returns The rating key of the created smart collection or null if failed
   */
  public async createFilteredHub(
    title: string,
    libraryKey: string,
    mediaType: 'movie' | 'tv',
    subtype: 'recently_added' | 'recently_released',
    maxItems?: number
  ): Promise<string | null> {
    try {
      logger.debug(
        `Creating filtered hub smart collection "${title}" for library ${libraryKey}`,
        {
          label: 'Plex API',
          title,
          libraryKey,
          mediaType,
          subtype,
        }
      );

      const type = mediaType === 'movie' ? 1 : 2;

      // Build filter URI based on media type and subtype
      let filterUri: string;

      if (subtype === 'recently_added') {
        // Recently Added: Sort by Date Added (addedAt), exclude placeholders
        if (mediaType === 'tv') {
          // TV Shows: Filter out "Trailer (Placeholder)" episode titles
          const sortParam = 'addedAt:desc';
          const titleFilter = encodeURIComponent('Trailer (Placeholder)');
          filterUri = `/library/sections/${libraryKey}/all?type=${type}&sort=${sortParam}&episode.title!=${titleFilter}`;
        } else {
          // Movies: Filter out "trailer-placeholder" label
          const sortParam = 'addedAt:desc';
          const labelFilter = 'trailer-placeholder';
          filterUri = `/library/sections/${libraryKey}/all?type=${type}&sort=${sortParam}&label!=${encodeURIComponent(
            labelFilter
          )}`;
        }
      } else if (subtype === 'recently_released') {
        // Recently Released: Sort by Release Date (originallyAvailableAt), exclude placeholders
        if (mediaType === 'tv') {
          // TV Shows (Episodes): Sort by air date, filter out "Trailer (Placeholder)"
          const sortParam = 'originallyAvailableAt:desc';
          const titleFilter = encodeURIComponent('Trailer (Placeholder)');
          filterUri = `/library/sections/${libraryKey}/all?type=${type}&sort=${sortParam}&episode.title!=${titleFilter}`;
        } else {
          // Movies: Sort by release date, filter out "trailer-placeholder" label
          const sortParam = 'originallyAvailableAt:desc';
          const labelFilter = 'trailer-placeholder';
          filterUri = `/library/sections/${libraryKey}/all?type=${type}&sort=${sortParam}&label!=${encodeURIComponent(
            labelFilter
          )}`;
        }
      } else {
        throw new Error(`Unsupported filtered hub subtype: ${subtype}`);
      }

      // Add limit parameter if specified
      if (maxItems && maxItems > 0) {
        filterUri += `&limit=${maxItems}`;
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
          'Invalid response when creating filtered hub smart collection',
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
          'No metadata returned when creating filtered hub smart collection',
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
        `Successfully created filtered hub smart collection "${title}" with rating key ${smartCollectionRatingKey}`,
        {
          label: 'Plex API',
          title,
          smartCollectionRatingKey,
          mediaType,
          subtype,
        }
      );

      return smartCollectionRatingKey;
    } catch (error) {
      logger.error(`Error creating filtered hub smart collection "${title}"`, {
        label: 'Plex API',
        title,
        libraryKey,
        mediaType,
        subtype,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
   }
  }

  /**
   * Create a smart collection filtered by director name
   */
  public async createDirectorCollection(
    title: string,
    libraryKey: string,
    mediaType: 'movie' | 'tv',
    directorName: string,
    limit?: number
  ): Promise<string | null> {
    try {
      logger.debug(
        `Creating director smart collection "${title}" for library ${libraryKey}`,
        {
          label: 'Plex API',
          title,
          libraryKey,
          mediaType,
          directorName,
          limit,
        }
      );

      const type = mediaType === 'movie' ? 1 : 2;

      // Build filter URI: director filter + exclude placeholders
      const directorFilter = encodeURIComponent(directorName);
      let filterUri: string;
      if (mediaType === 'tv') {
        const titleFilter = encodeURIComponent('Trailer (Placeholder)');
        filterUri = `/library/sections/${libraryKey}/all?type=${type}&director=${directorFilter}&episode.title!=${titleFilter}`;
      } else {
        const labelFilter = encodeURIComponent('trailer-placeholder');
        filterUri = `/library/sections/${libraryKey}/all?type=${type}&director=${directorFilter}&label!=${labelFilter}`;
      }

      if (limit && limit > 0) {
        filterUri += `&limit=${limit}`;
      }

      const uri = `server://${getSettings().plex.machineId}/com.plexapp.plugins.library${filterUri}`;
      const createUrl = `/library/collections?type=${type}&title=${encodeURIComponent(
        title
      )}&smart=1&uri=${encodeURIComponent(uri)}&sectionId=${libraryKey}`;

      const createResponse = await this.plexApi['safePostQuery'](createUrl);
      if (
        !createResponse ||
        typeof createResponse !== 'object' ||
        !('MediaContainer' in createResponse)
      ) {
        logger.error('Invalid response when creating director smart collection', {
          label: 'Plex API',
          response: createResponse,
        });
        return null;
      }

      const mediaContainer = createResponse.MediaContainer as {
        Metadata?: { ratingKey: string }[];
      };
      if (!mediaContainer.Metadata || mediaContainer.Metadata.length === 0) {
        logger.error(
          'No metadata returned when creating director smart collection',
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

      logger.info(
        `Successfully created director smart collection "${title}" with rating key ${smartCollectionRatingKey}`,
        {
          label: 'Plex API',
          title,
          smartCollectionRatingKey,
          mediaType,
          directorName,
          limit,
        }
      );

      return smartCollectionRatingKey;
    } catch (error) {
      logger.error(`Error creating director smart collection "${title}"`, {
        label: 'Plex API',
        title,
        libraryKey,
        mediaType,
        directorName,
        directorMinimumItems: 5,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Create a smart collection filtered by actor name
   */
  public async createActorCollection(
    title: string,
    libraryKey: string,
    mediaType: 'movie' | 'tv',
    actorName: string,
    limit?: number
  ): Promise<string | null> {
    try {
      logger.debug(
        `Creating actor smart collection "${title}" for library ${libraryKey}`,
        {
          label: 'Plex API',
          title,
          libraryKey,
          mediaType,
          actorName,
          limit,
        }
      );

      const type = mediaType === 'movie' ? 1 : 2;

      // Build filter URI: actor filter + exclude placeholders
      const actorFilter = encodeURIComponent(actorName);
      let filterUri: string;
      if (mediaType === 'tv') {
        const titleFilter = encodeURIComponent('Trailer (Placeholder)');
        filterUri = `/library/sections/${libraryKey}/all?type=${type}&actor=${actorFilter}&episode.title!=${titleFilter}`;
      } else {
        const labelFilter = encodeURIComponent('trailer-placeholder');
        filterUri = `/library/sections/${libraryKey}/all?type=${type}&actor=${actorFilter}&label!=${labelFilter}`;
      }

      if (limit && limit > 0) {
        filterUri += `&limit=${limit}`;
      }

      const uri = `server://${getSettings().plex.machineId}/com.plexapp.plugins.library${filterUri}`;
      const createUrl = `/library/collections?type=${type}&title=${encodeURIComponent(
        title
      )}&smart=1&uri=${encodeURIComponent(uri)}&sectionId=${libraryKey}`;

      const createResponse = await this.plexApi['safePostQuery'](createUrl);
      if (
        !createResponse ||
        typeof createResponse !== 'object' ||
        !('MediaContainer' in createResponse)
      ) {
        logger.error('Invalid response when creating actor smart collection', {
          label: 'Plex API',
          response: createResponse,
        });
        return null;
      }

      const mediaContainer = createResponse.MediaContainer as {
        Metadata?: { ratingKey: string }[];
      };
      if (!mediaContainer.Metadata || mediaContainer.Metadata.length === 0) {
        logger.error(
          'No metadata returned when creating actor smart collection',
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

      logger.info(
        `Successfully created actor smart collection "${title}" with rating key ${smartCollectionRatingKey}`,
        {
          label: 'Plex API',
          title,
          smartCollectionRatingKey,
          mediaType,
          actorName,
          limit,
        }
      );

      return smartCollectionRatingKey;
    } catch (error) {
      logger.error(`Error creating actor smart collection "${title}"`, {
        label: 'Plex API',
        title,
        libraryKey,
        mediaType,
        actorName,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * @deprecated Use createFilteredHub instead
   * Legacy method for backwards compatibility
   */
  public async createFilteredRecentlyAdded(
    title: string,
    libraryKey: string,
    mediaType: 'movie' | 'tv'
  ): Promise<string | null> {
    return this.createFilteredHub(
      title,
      libraryKey,
      mediaType,
      'recently_added'
    );
  }
}

export default PlexSmartCollectionManager;
