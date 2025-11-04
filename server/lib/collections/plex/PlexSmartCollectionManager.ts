import type PlexAPI from '@server/api/plexapi';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

interface PlexCollectionMetadata {
  labels?: string[];
  index?: string | number;
  [key: string]: unknown;
}

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
   * Create a smart collection for unwatched items based on a regular collection
   * @param title - Title for the smart collection
   * @param libraryKey - Library section key (e.g., "1" for movies)
   * @param baseCollectionRatingKey - Rating key of the base collection to filter
   * @param mediaType - 'movie' or 'tv'
   * @returns The rating key of the created smart collection or null if failed
   */
  public async createSmartCollection(
    title: string,
    libraryKey: string,
    baseCollectionRatingKey: string,
    mediaType: 'movie' | 'tv' = 'movie',
    sortOption?: string
  ): Promise<string | null> {
    try {
      logger.debug(
        `Creating smart collection "${title}" for library ${libraryKey}`,
        {
          label: 'Plex API',
          title,
          libraryKey,
          baseCollectionRatingKey,
          mediaType,
        }
      );

      // Step 1: Get the collection's index field which is used for smart collection filters
      const collectionMetadata = await this.plexApi.getCollectionMetadata(
        baseCollectionRatingKey
      );
      if (!collectionMetadata) {
        logger.error(
          `Could not get metadata for base collection ${baseCollectionRatingKey}`,
          {
            label: 'Plex API',
            baseCollectionRatingKey,
          }
        );
        return null;
      }

      // Use the index field for the collection filter, not the ratingKey
      const indexField = (
        collectionMetadata as PlexCollectionMetadata & {
          index?: string | number;
        }
      ).index;
      const collectionFilterId = indexField
        ? String(indexField)
        : baseCollectionRatingKey;

      logger.debug(
        `Using collection filter ID ${collectionFilterId} for smart collection (base collection rating key: ${baseCollectionRatingKey})`,
        {
          label: 'Plex API',
          baseCollectionRatingKey,
          collectionFilterId,
        }
      );

      // Step 2: Create the smart collection with uri parameter (like Plex Web UI does)
      const type = mediaType === 'movie' ? 1 : 2;
      const sortParam = sortOption || 'originallyAvailableAt:desc'; // Default to release date (newest first) if no sort option provided

      // TV shows use different filter parameters than movies
      let filterUri: string;
      if (mediaType === 'tv') {
        filterUri = `/library/sections/${libraryKey}/all?type=${type}&sort=${sortParam}&show.unwatchedLeaves=1&and=1&show.collection=${collectionFilterId}`;
      } else {
        filterUri = `/library/sections/${libraryKey}/all?type=${type}&sort=${sortParam}&unwatched=1&and=1&collection=${collectionFilterId}`;
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
        logger.error('Invalid response when creating smart collection', {
          label: 'Plex API',
          response: createResponse,
        });
        return null;
      }

      const mediaContainer = createResponse.MediaContainer as {
        Metadata?: { ratingKey: string }[];
      };

      if (!mediaContainer.Metadata || mediaContainer.Metadata.length === 0) {
        logger.error('No metadata returned when creating smart collection', {
          label: 'Plex API',
          response: createResponse,
        });
        return null;
      }

      const smartCollectionRatingKey = mediaContainer.Metadata[0].ratingKey;

      // Step 3: Set the collection to be filtered by user
      await this.setCollectionUserFilter(smartCollectionRatingKey);

      // Step 4: Add the same Agregarr label as the base collection so it's not discovered as pre-existing
      const baseCollectionMetadata = await this.plexApi.getCollectionMetadata(
        baseCollectionRatingKey
      );
      if (baseCollectionMetadata?.labels) {
        const agregarrLabel = baseCollectionMetadata.labels.find(
          (label: string) =>
            typeof label === 'string' &&
            label.toLowerCase().startsWith('agregarr')
        );
        if (agregarrLabel) {
          await this.plexApi.addLabelToCollection(
            smartCollectionRatingKey,
            agregarrLabel
          );
        }
      }

      logger.info(
        `Successfully created smart collection "${title}" with rating key ${smartCollectionRatingKey}`,
        {
          label: 'Plex API',
          title,
          smartCollectionRatingKey,
          baseCollectionRatingKey,
        }
      );

      return smartCollectionRatingKey;
    } catch (error) {
      logger.error(`Error creating smart collection "${title}"`, {
        label: 'Plex API',
        title,
        libraryKey,
        baseCollectionRatingKey,
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
   * Update a smart collection's URI (including sort parameters)
   * @param smartCollectionRatingKey - The rating key of the smart collection to update
   * @param libraryKey - Library section key (e.g., "1" for movies)
   * @param baseCollectionRatingKey - Rating key of the base collection to filter
   * @param mediaType - 'movie' or 'tv'
   * @param sortOption - Sort parameter (e.g., 'year:desc', 'titleSort')
   * @returns Promise<void>
   */
  public async updateSmartCollectionUri(
    smartCollectionRatingKey: string,
    libraryKey: string,
    baseCollectionRatingKey: string,
    mediaType: 'movie' | 'tv' = 'movie',
    sortOption?: string
  ): Promise<void> {
    try {
      logger.debug(
        `Updating smart collection URI for collection ${smartCollectionRatingKey}`,
        {
          label: 'Plex API',
          smartCollectionRatingKey,
          libraryKey,
          baseCollectionRatingKey,
          mediaType,
          sortOption,
        }
      );

      // Get the collection's index field which is used for smart collection filters
      const collectionMetadata = await this.plexApi.getCollectionMetadata(
        baseCollectionRatingKey
      );
      if (!collectionMetadata) {
        throw new Error(
          `Could not get metadata for base collection ${baseCollectionRatingKey}`
        );
      }

      // Use the index field for the collection filter, not the ratingKey
      const indexField = (
        collectionMetadata as PlexCollectionMetadata & {
          index?: string | number;
        }
      ).index;
      const collectionFilterId = indexField
        ? String(indexField)
        : baseCollectionRatingKey;

      // Build the filter URI with the specified sort option
      const type = mediaType === 'movie' ? 1 : 2;
      const sortParam = sortOption || 'originallyAvailableAt:desc'; // Default to release date (newest first) if no sort option provided

      // TV shows use different filter parameters than movies
      let filterUri: string;
      if (mediaType === 'tv') {
        filterUri = `/library/sections/${libraryKey}/all?type=${type}&sort=${sortParam}&show.unwatchedLeaves=1&and=1&show.collection=${collectionFilterId}`;
      } else {
        filterUri = `/library/sections/${libraryKey}/all?type=${type}&sort=${sortParam}&unwatched=1&and=1&collection=${collectionFilterId}`;
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
        `Successfully updated smart collection URI for collection ${smartCollectionRatingKey}`,
        {
          label: 'Plex API',
          smartCollectionRatingKey,
          sortParam,
        }
      );
    } catch (error) {
      logger.error(
        `Error updating smart collection URI for collection ${smartCollectionRatingKey}`,
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
}

export default PlexSmartCollectionManager;
