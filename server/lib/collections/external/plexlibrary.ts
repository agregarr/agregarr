/**
 * Plex Library Collection Sync
 *
 * Creates smart collections based on Plex library metadata (e.g., directors).
 */

import type PlexAPI from '@server/api/plexapi';
import TheMovieDb from '@server/api/themoviedb';
import { BaseCollectionSync } from '@server/lib/collections/core/BaseCollectionSync';
import {
  getCollectionMediaType,
  type LibraryItemsCache,
} from '@server/lib/collections/core/CollectionUtilities';
import type {
  CollectionItem,
  CollectionOperationResult,
  CollectionSourceData,
  CollectionSyncOptions,
  CollectionVisibilityConfig,
  FilteringStats,
  MissingItem,
  PlexCollection,
  PlexLabel,
  SyncResult,
} from '@server/lib/collections/core/types';
import { CollectionSyncErrorType } from '@server/lib/collections/core/types';
import { getTmdbLanguage, type CollectionConfig } from '@server/lib/settings';
import logger from '@server/logger';

export class PlexLibraryCollectionSync extends BaseCollectionSync {
  constructor() {
    super('plex_library');
  }

  private async uploadTmdbDirectorPoster(
    directorName: string,
    collectionName: string,
    collectionRatingKey: string,
    plexClient: PlexAPI
  ): Promise<boolean> {
    try {
      const tmdbClient = new TheMovieDb({
        originalLanguage: getTmdbLanguage(),
      });

      const searchResults = await tmdbClient.searchMulti({
        query: directorName,
        language: getTmdbLanguage(),
      });

      const personResult =
        searchResults.results.find(
          (result: { media_type?: string; name?: string }) =>
            result.media_type === 'person' &&
            result.name?.toLowerCase() === directorName.toLowerCase()
        ) ||
        searchResults.results.find(
          (result: { media_type?: string }) => result.media_type === 'person'
        );

      if (!personResult || !('id' in personResult)) {
        logger.warn(
          `No TMDB match found for director "${directorName}", skipping TMDB poster`,
          {
            label: 'Plex Library Collections',
            collectionName,
          }
        );
        return false;
      }

      const personDetails = await tmdbClient.getPerson({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        personId: (personResult as any).id,
        language: getTmdbLanguage(),
      });

      const profilePath =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (personResult as any).profile_path || personDetails.profile_path;

      if (!profilePath) {
        logger.warn(
          `TMDB director result has no poster for "${directorName}", skipping TMDB poster`,
          {
            label: 'Plex Library Collections',
            collectionName,
          }
        );
        return false;
      }

      const tmdbPosterUrl = `https://image.tmdb.org/t/p/original${profilePath}`;
      const posterManager = plexClient['posterManager'];

      logger.debug(
        `Uploading TMDB director poster for "${collectionName}" from ${tmdbPosterUrl}`,
        {
          label: 'Plex Library Collections',
          collectionName,
          tmdbPosterUrl,
          collectionRatingKey,
        }
      );

      await posterManager.uploadPosterFromUrl(
        collectionRatingKey,
        tmdbPosterUrl
      );
      await posterManager.lockPoster(collectionRatingKey);

      logger.info(
        `Successfully uploaded TMDB director poster for "${collectionName}"`,
        {
          label: 'Plex Library Collections',
        }
      );

      return true;
    } catch (error) {
      logger.error(
        `Error uploading TMDB director poster for "${collectionName}", will fallback to auto-poster if enabled`,
        {
          label: 'Plex Library Collections',
          error: error instanceof Error ? error.message : String(error),
          directorName,
          collectionName,
        }
      );
      return false;
    }
  }

  private async setDirectorBioAsDescription(
    directorName: string,
    collectionRatingKey: string,
    plexClient: PlexAPI
  ): Promise<boolean> {
    try {
      const tmdbClient = new TheMovieDb({
        originalLanguage: getTmdbLanguage(),
      });

      const searchResults = await tmdbClient.searchMulti({
        query: directorName,
        language: getTmdbLanguage(),
      });

      const personResult =
        searchResults.results.find(
          (result: { media_type?: string; name?: string }) =>
            result.media_type === 'person' &&
            result.name?.toLowerCase() === directorName.toLowerCase()
        ) ||
        searchResults.results.find(
          (result: { media_type?: string }) => result.media_type === 'person'
        );

      if (!personResult || !('id' in personResult)) {
        logger.debug(
          `No TMDB match found for director "${directorName}", skipping bio description`,
          {
            label: 'Plex Library Collections',
            directorName,
          }
        );
        return false;
      }

      const personDetails = await tmdbClient.getPerson({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        personId: (personResult as any).id,
        language: getTmdbLanguage(),
      });

      if (!personDetails.biography) {
        logger.debug(
          `No biography found for director "${directorName}" on TMDB, skipping description`,
          {
            label: 'Plex Library Collections',
            directorName,
          }
        );
        return false;
      }

      // Extract first few paragraphs (up to 500 characters to keep it concise)
      const paragraphs = personDetails.biography
        .split('\n\n')
        .filter((p) => p.trim());
      let bioText = '';

      for (const paragraph of paragraphs) {
        if ((bioText + paragraph).length > 500) {
          break;
        }
        bioText += (bioText ? '\n\n' : '') + paragraph;
      }

      if (!bioText) {
        logger.debug(
          `Director bio too short for "${directorName}", skipping description`,
          {
            label: 'Plex Library Collections',
            directorName,
          }
        );
        return false;
      }

      await plexClient.updateSummary(collectionRatingKey, bioText);

      logger.debug(
        `Successfully set bio description for director "${directorName}" collection`,
        {
          label: 'Plex Library Collections',
          directorName,
          bioLength: bioText.length,
        }
      );

      return true;
    } catch (error) {
      logger.warn(
        `Failed to set bio description for director "${directorName}"`,
        {
          label: 'Plex Library Collections',
          directorName,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return false;
    }
  }

  protected async validateConfiguration(): Promise<void> {
    // No external API dependencies - just needs Plex
  }

  protected async createTemplateContext(
    config: CollectionConfig,
    _mediaType: 'movie' | 'tv'
  ): Promise<Record<string, unknown>> {
    return {
      source: 'plex_library',
      subtype: config.subtype,
      // Per-director collections use the director name as the title; expose placeholders
      director: '{director}',
      name: '{director}',
      collectionName: '{director}',
    };
  }

  public async fetchSourceData(
    _config: CollectionConfig,
    _options?: CollectionSyncOptions,
    _libraryCache?: LibraryItemsCache
  ): Promise<CollectionSourceData[]> {
    return [];
  }

  public async mapSourceDataToItems(
    _sourceData: CollectionSourceData[],
    _config: CollectionConfig,
    _plexClient?: PlexAPI,
    _libraryCache?: LibraryItemsCache
  ): Promise<{
    items: CollectionItem[];
    missingItems?: MissingItem[];
    stats?: FilteringStats;
  }> {
    return {
      items: [],
      missingItems: [],
      stats: { original: 0, filtered: 0, removed: 0 },
    };
  }

  protected async createCollection(
    _items: CollectionItem[],
    _mediaType: 'movie' | 'tv',
    _collectionName: string,
    _plexClient: PlexAPI,
    _allCollections: PlexCollection[],
    _config: CollectionConfig,
    _processedCollectionKeys?: Set<string>
  ): Promise<CollectionOperationResult> {
    return {
      created: 0,
      updated: 0,
      itemCount: 0,
    };
  }

  /**
   * Process directors collection - creates collections for top directors
   */
  protected async processConfiguration(
    config: CollectionConfig,
    plexClient: PlexAPI,
    allCollections: PlexCollection[],
    processedCollectionKeys?: Set<string>,
    _libraryCache?: LibraryItemsCache,
    _options?: CollectionSyncOptions
  ): Promise<SyncResult> {
    const mediaType = getCollectionMediaType(config);
    const subtype = config.subtype;
    if (!subtype || subtype !== 'directors') {
      throw this.createSyncError(
        CollectionSyncErrorType.CONFIGURATION_ERROR,
        `Invalid plex_library subtype: ${subtype}. Currently only 'directors' is supported.`
      );
    }

    const depth = 50; //config.directorDepth || 5; // Top N directors
    const limit = config.directorLimit || 30; // Max items per director
    const minimumItems = config.directorMinimumItems || 3; // Minimum threshold

    logger.info('Processing directors collection', {
      label: 'Plex Library Collections',
      configName: config.name,
      libraryId: config.libraryId,
      depth,
      limit,
      minimumItems,
    });

    // Use a consistent Agregarr label so discovery won't treat these as pre-existing
    const customLabel = `AgregarrPlexLibrary${config.id}`;

    try {
      // Fetch top directors from library
      const directors = await plexClient.getLibraryDirectors(
        config.libraryId,
        depth * 2 // Fetch extra in case some don't meet minimum threshold
      );

      // Filter directors by minimum items threshold
      const qualifyingDirectors = directors.filter(
        (d) => d.count >= minimumItems
      );

      // Limit to depth
      const topDirectors = qualifyingDirectors.slice(0, depth);

      logger.info(
        `Creating collections for ${topDirectors.length} directors (${qualifyingDirectors.length} qualified, ${directors.length} total)`,
        {
          label: 'Plex Library Collections',
          configName: config.name,
          topDirectors: topDirectors.map((d) => `${d.name} (${d.count} items)`),
        }
      );

      let created = 0;
      let updated = 0;
      let deleted = 0;

      for (const director of topDirectors) {
        try {
          const collectionName = director.name;

          const existingCollection = allCollections.find(
            (c) =>
              c.title === collectionName && c.libraryKey === config.libraryId
          );

          if (existingCollection) {
            // Already exists, ensure it's tagged as Agregarr-managed
            try {
              await plexClient.addLabelToCollection(
                existingCollection.ratingKey,
                customLabel
              );
            } catch (labelError) {
              logger.warn(
                `Failed to add Agregarr label to existing director collection "${collectionName}"`,
                {
                  label: 'Plex Library Collections',
                  error:
                    labelError instanceof Error
                      ? labelError.message
                      : String(labelError),
                }
              );
            }

            // Track by rating key so cleanup doesn't treat it as unmanaged
            processedCollectionKeys?.add(existingCollection.ratingKey);
            updated++;

            // Set director bio as collection description
            await this.setDirectorBioAsDescription(
              director.name,
              existingCollection.ratingKey,
              plexClient
            );

            // Try TMDB director poster, then auto-poster fallback
            if (config.useTmdbDirectorPoster) {
              const tmdbPosterUploaded = await this.uploadTmdbDirectorPoster(
                director.name,
                collectionName,
                existingCollection.ratingKey,
                plexClient
              );

              if (!tmdbPosterUploaded) {
                const shouldGeneratePoster = config.autoPoster ?? true;
                if (shouldGeneratePoster) {
                  await this.generateAutoPoster(
                    collectionName,
                    config,
                    existingCollection.ratingKey,
                    plexClient
                  );
                }
              }
            } else {
              const shouldGeneratePoster = config.autoPoster ?? true;
              if (shouldGeneratePoster) {
                await this.generateAutoPoster(
                  collectionName,
                  config,
                  existingCollection.ratingKey,
                  plexClient
                );
              }
            }
          } else {
            const smartCollectionRatingKey =
              await plexClient['smartCollectionManager'].createDirectorCollection(
                collectionName,
                config.libraryId,
                mediaType,
                director.name,
                limit
              );

            if (smartCollectionRatingKey) {
              // Tag collection so discovery recognizes it as Agregarr-managed
              try {
                await plexClient.addLabelToCollection(
                  smartCollectionRatingKey,
                  customLabel
                );
              } catch (labelError) {
                logger.warn(
                  `Failed to add Agregarr label to new director collection "${collectionName}"`,
                  {
                    label: 'Plex Library Collections',
                    error:
                      labelError instanceof Error
                        ? labelError.message
                        : String(labelError),
                  }
                );
              }

              // Track by rating key so cleanup won't delete it
              processedCollectionKeys?.add(smartCollectionRatingKey);
              created++;

              // Set director bio as collection description
              await this.setDirectorBioAsDescription(
                director.name,
                smartCollectionRatingKey,
                plexClient
              );

              // Try TMDB director poster, then auto-poster fallback
              if (config.useTmdbDirectorPoster) {
                const tmdbPosterUploaded = await this.uploadTmdbDirectorPoster(
                  director.name,
                  collectionName,
                  smartCollectionRatingKey,
                  plexClient
                );

                if (!tmdbPosterUploaded) {
                  const shouldGeneratePoster = config.autoPoster ?? true;
                  if (shouldGeneratePoster) {
                    await this.generateAutoPoster(
                      collectionName,
                      config,
                      smartCollectionRatingKey,
                      plexClient
                    );
                  }
                }
              } else {
                const shouldGeneratePoster = config.autoPoster ?? true;
                if (shouldGeneratePoster) {
                  await this.generateAutoPoster(
                    collectionName,
                    config,
                    smartCollectionRatingKey,
                    plexClient
                  );
                }
              }
            } else {
              logger.warn(`Failed to create collection for director: ${director.name}`, {
                label: 'Plex Library Collections',
              });
            }
          }
        } catch (error) {
          logger.error(`Error creating collection for director ${director.name}`, {
            label: 'Plex Library Collections',
            directorName: director.name,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Remove any previously created director collections that are now outside the depth limit
      const topDirectorNames = new Set(
        topDirectors.map((director) => director.name.toLowerCase())
      );
      const managedCollections = allCollections.filter((collection) => {
        if (collection.libraryKey !== config.libraryId) {
          return false;
        }

        const labels = Array.isArray(collection.labels)
          ? collection.labels
          : [];

        return labels.some((label: string | PlexLabel) => {
          const labelText = typeof label === 'string' ? label : label.tag;
          return labelText?.toLowerCase() === customLabel.toLowerCase();
        });
      });

      for (const collection of managedCollections) {
        if (topDirectorNames.has(collection.title.toLowerCase())) {
          continue;
        }

        try {
          await plexClient.deleteCollection(collection.ratingKey);
          deleted++;
          logger.info(
            `Removed director collection outside current limit: ${collection.title}`,
            {
              label: 'Plex Library Collections',
              collectionName: collection.title,
              ratingKey: collection.ratingKey,
              libraryId: config.libraryId,
            }
          );
        } catch (deleteError) {
          logger.warn(
            `Failed to delete outdated director collection "${collection.title}"`,
            {
              label: 'Plex Library Collections',
              error:
                deleteError instanceof Error
                  ? deleteError.message
                  : String(deleteError),
              ratingKey: collection.ratingKey,
              libraryId: config.libraryId,
            }
          );
        }
      }

      logger.info('Directors collection sync completed', {
        label: 'Plex Library Collections',
        configName: config.name,
        created,
        updated,
        deleted,
        total: topDirectors.length,
      });

      return {
        created,
        updated,
        details: deleted ? { deleted } : undefined,
      };
    } catch (error) {
      logger.error('Failed to process directors collection', {
        label: 'Plex Library Collections',
        configName: config.name,
        error: error instanceof Error ? error.message : String(error),
      });

      throw this.createSyncError(
        CollectionSyncErrorType.API_ERROR,
        `Failed to fetch directors from library: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}

export const plexLibraryCollectionSync = new PlexLibraryCollectionSync();
export default plexLibraryCollectionSync;
