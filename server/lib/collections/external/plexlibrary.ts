/**
 * Plex Library Collection Sync
 *
 * Creates smart collections based on Plex library metadata (e.g., directors).
 */

import type PlexAPI from '@server/api/plexapi';
import TheMovieDb from '@server/api/themoviedb';
import axios from 'axios';
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
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';

type DirectorTmdbInfo = {
  tmdbPersonId: number;
  profilePath?: string;
  biography?: string;
};

const DIRECTOR_POSTER_WIDTH = 1000;
const DIRECTOR_POSTER_HEIGHT = 1500;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export class PlexLibraryCollectionSync extends BaseCollectionSync {
  constructor() {
    super('plex_library');
  }

  private async setDirectorBioAsDescription(
    directorName: string,
    collectionRatingKey: string,
    plexClient: PlexAPI,
    directorInfo?: DirectorTmdbInfo
  ): Promise<boolean> {
    try {
      const info =
        directorInfo ?? (await this.fetchTmdbDirectorInfo(directorName));
      const biography = info?.biography;

      if (!biography) {
        logger.debug(
          `No TMDB biography found for director "${directorName}", skipping description`,
          {
            label: 'Plex Library Collections',
            directorName,
          }
        );
        return false;
      }

      const paragraphs = biography.split('\n\n').filter((p) => p.trim());
      let bioText = '';

      for (const paragraph of paragraphs) {
        if ((bioText + paragraph).length > 500) {
          break;
        }
        bioText += (bioText ? '\n\n' : '') + paragraph;
      }

      if (!bioText) {
        logger.debug(
          `Biography truncated to empty string for director "${directorName}", skipping description`,
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

  private sanitizeDirectorNameForLabel(name: string): string {
    const sanitized = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return sanitized || 'director';
  }

  private buildDirectorLabel(
    configId: string,
    slug: string | number
  ): string {
    const suffix = String(slug).toLowerCase();
    return `AgregarrAutoDirector-${configId}-${suffix}`;
  }

  private extractTmdbIdFromGuids(
    guids?: { id?: string }[]
  ): number | undefined {
    if (!guids || guids.length === 0) {
      return undefined;
    }

    const tmdbGuid = guids.find(
      (guid) => guid.id && guid.id.startsWith('tmdb://')
    );
    if (!tmdbGuid?.id) {
      return undefined;
    }

    const match = tmdbGuid.id.match(/tmdb:\/\/(\d+)/);
    return match ? Number(match[1]) : undefined;
  }

  private async buildDirectorPosterItems(
    directorName: string,
    mediaType: 'movie' | 'tv',
    config: CollectionConfig,
    plexClient: PlexAPI,
    maxItems = 12
  ): Promise<CollectionItem[]> {
    if (!config.libraryId) {
      return [];
    }

    const cappedMaxItems = Math.max(1, Math.min(maxItems, 12));
    const itemLimit = Math.max(
      1,
      Math.min(config.maxItems ?? cappedMaxItems, cappedMaxItems)
    );

    try {
      const plexItems = await plexClient.getItemsByDirector(
        config.libraryId,
        directorName,
        mediaType,
        itemLimit
      );

      const mappedItems = plexItems.map((item) => {
        const tmdbId = this.extractTmdbIdFromGuids(item.Guid);
        return {
          ratingKey: item.ratingKey,
          title: item.title,
          type: mediaType === 'movie' ? 'movie' : 'tv',
          year: item.year,
          tmdbId: tmdbId ?? undefined,
          metadata: {
            libraryKey: config.libraryId,
          },
        } as CollectionItem;
      });

      logger.debug(
        `Prepared ${mappedItems.length} items for director poster generation`,
        {
          label: 'Plex Library Collections',
          directorName,
          libraryId: config.libraryId,
        }
      );

      return mappedItems.slice(0, itemLimit);
    } catch (error) {
      logger.warn('Failed to fetch director items for poster generation', {
        label: 'Plex Library Collections',
        directorName,
        libraryId: config.libraryId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private async addDirectorLabel(
    plexClient: PlexAPI,
    collectionRatingKey: string,
    label: string
  ): Promise<void> {
    try {
      await plexClient.addLabelToCollection(collectionRatingKey, label);
    } catch (labelError) {
      logger.warn(`Failed to add label "${label}" to director collection`, {
        label: 'Plex Library Collections',
        collectionRatingKey,
        error:
          labelError instanceof Error ? labelError.message : String(labelError),
      });
    }
  }

  private async fetchTmdbDirectorInfo(
    directorName: string
  ): Promise<DirectorTmdbInfo | null> {
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
          `No TMDB match found for director "${directorName}", skipping media lookups`,
          {
            label: 'Plex Library Collections',
            directorName,
          }
        );
        return null;
      }

      const personId = Number((personResult as any).id);

      const personDetails = await tmdbClient.getPerson({
        personId,
        language: getTmdbLanguage(),
      });

      return {
        tmdbPersonId: personId,
        profilePath:
          (personResult as any).profile_path || personDetails.profile_path || undefined,
        biography: personDetails.biography || undefined,
      };
    } catch (error) {
      logger.warn(
        `Failed to fetch TMDB director info for "${directorName}"`,
        {
          label: 'Plex Library Collections',
          directorName,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return null;
    }
  }

  private wrapDirectorName(name: string, maxLineLength = 16): string[] {
    const words = name.trim().split(/\s+/);
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (candidate.length <= maxLineLength) {
        currentLine = candidate;
      } else if (currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        // Single very long word - keep as is
        lines.push(candidate);
        currentLine = '';
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    if (lines.length > 2) {
      return [lines[0], lines.slice(1).join(' ')];
    }

    return lines;
  }

  private async applyDirectorMetadata(
    plexClient: PlexAPI,
    collectionRatingKey: string,
    collectionName: string,
    directorLabel: string,
    mediaType: 'movie' | 'tv',
    config: CollectionConfig
  ): Promise<void> {
    const visibilityConfig: CollectionVisibilityConfig = {
      usersHome: config.visibilityConfig?.usersHome ?? false,
      serverOwnerHome: config.visibilityConfig?.serverOwnerHome ?? false,
      libraryRecommended: config.visibilityConfig?.libraryRecommended ?? false,
      isActive: config.isActive ?? true,
    };

    await this.updateCollectionMetadata(plexClient, collectionRatingKey, {
      collectionName,
      mediaType,
      visibilityConfig,
      customLabel: directorLabel,
      sortOrderLibrary: config.sortOrderLibrary,
      isLibraryPromoted: config.isLibraryPromoted,
      customPoster: config.customPoster,
      libraryKey: config.libraryId,
      config,
    });
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

  public override async fetchSourceData(
    _config: CollectionConfig,
    _options?: CollectionSyncOptions,
    _libraryCache?: LibraryItemsCache
  ): Promise<CollectionSourceData[]> {
    // Director collections use Plex library data gathered during processing; no external source fetch required.
    return [];
  }

  public override async mapSourceDataToItems(
    _sourceData: CollectionSourceData[],
    _config: CollectionConfig,
    _plexClient?: PlexAPI,
    _libraryCache?: LibraryItemsCache
  ): Promise<{
    items: CollectionItem[];
    missingItems?: MissingItem[];
    stats?: FilteringStats;
  }> {
    // Items are derived directly from Plex during processConfiguration.
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

    const depth = 50; // Top N directors
    const limit = 30; // Max items per director
    const minimumItems = config.directorMinimumItems || 5; // Minimum threshold

    logger.info('Processing directors collection', {
      label: 'Plex Library Collections',
      configName: config.name,
      libraryId: config.libraryId,
      depth,
      limit,
      minimumItems,
    });

    const directorLabelPrefix = `AgregarrAutoDirector-${config.id}-`;

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
          const directorInfo =
            (await this.fetchTmdbDirectorInfo(director.name)) ?? undefined;
          const labelSuffix =
            directorInfo?.tmdbPersonId?.toString() ??
            this.sanitizeDirectorNameForLabel(director.name);
          const directorLabel = this.buildDirectorLabel(
            config.id,
            directorInfo?.tmdbPersonId ?? labelSuffix
          );

          const existingCollection = allCollections.find(
            (c) =>
              c.title === collectionName && c.libraryKey === config.libraryId
          );

          let collectionRatingKey: string | null = null;

          if (existingCollection) {
            collectionRatingKey = existingCollection.ratingKey;
            updated++;
          } else {
            collectionRatingKey =
              await plexClient['smartCollectionManager'].createDirectorCollection(
                collectionName,
                config.libraryId,
                mediaType,
                director.name,
                limit
              );

            if (collectionRatingKey) {
              created++;
            } else {
              logger.warn(
                `Failed to create collection for director: ${director.name}`,
                {
                  label: 'Plex Library Collections',
                }
              );
              continue;
            }
          }

          // Tag collection so discovery recognizes it as Agregarr-managed
          await this.addDirectorLabel(
            plexClient,
            collectionRatingKey,
            directorLabel
          );

          // Track by rating key so cleanup doesn't treat it as unmanaged
          processedCollectionKeys?.add(collectionRatingKey);

          // Apply the same metadata/ordering handling used by standard collections
          await this.applyDirectorMetadata(
            plexClient,
            collectionRatingKey,
            collectionName,
            directorLabel,
            mediaType,
            config
          );

          const shouldGeneratePoster = config.autoPoster ?? true;
          const directorPhotoUrl = directorInfo?.profilePath
            ? `https://image.tmdb.org/t/p/original${directorInfo.profilePath}`
            : undefined;
          const posterItems =
            shouldGeneratePoster && mediaType
              ? await this.buildDirectorPosterItems(
                  director.name,
                  mediaType,
                  config,
                  plexClient,
                  limit
                )
              : [];

          // Generate auto-poster with director portrait background
          if (shouldGeneratePoster) {
            // Update summary with TMDB bio if available (custom summaries override later)
            await this.setDirectorBioAsDescription(
              director.name,
              collectionRatingKey,
              plexClient,
              directorInfo
            );

            await this.generateAutoPoster(
              collectionName,
              config,
              collectionRatingKey,
              plexClient,
              posterItems,
              undefined,
              undefined,
              directorPhotoUrl
            );
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

        const labels = Array.isArray(collection.labels) ? collection.labels : [];

        return labels.some((label: string | PlexLabel) => {
          const labelText = typeof label === 'string' ? label : label.tag;
          if (!labelText) return false;
          const normalized = labelText.toLowerCase();
          return normalized.startsWith(directorLabelPrefix.toLowerCase());
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
