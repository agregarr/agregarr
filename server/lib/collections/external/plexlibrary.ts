/**
 * Plex Library Collection Sync
 *
 * Creates smart collections based on Plex library metadata (e.g., directors, actors).
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

type PersonTmdbInfo = {
  tmdbPersonId: number;
  profilePath?: string;
  biography?: string;
};

type PersonCollectionSubtype = 'directors' | 'actors';

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

  private getPersonTypeLabel(subtype: PersonCollectionSubtype): string {
    return subtype === 'actors' ? 'actor' : 'director';
  }

  private getPersonLabelPrefix(
    subtype: PersonCollectionSubtype,
    configId: string
  ): string {
    const labelType =
      subtype === 'actors' ? 'AgregarrAutoActor' : 'AgregarrAutoDirector';
    return `${labelType}-${configId}-`;
  }

  private async setPersonBioAsDescription(
    personName: string,
    collectionRatingKey: string,
    plexClient: PlexAPI,
    subtype: PersonCollectionSubtype,
    personInfo?: PersonTmdbInfo
  ): Promise<boolean> {
    try {
      const info =
        personInfo ?? (await this.fetchTmdbPersonInfo(personName));
      const biography = info?.biography;
      const personLabel = this.getPersonTypeLabel(subtype);

      if (!biography) {
        logger.debug(
          `No TMDB biography found for ${personLabel} "${personName}", skipping description`,
          {
            label: 'Plex Library Collections',
            personName,
            subtype,
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
          `Biography truncated to empty string for ${personLabel} "${personName}", skipping description`,
          {
            label: 'Plex Library Collections',
            personName,
            subtype,
          }
        );
        return false;
      }

      await plexClient.updateSummary(collectionRatingKey, bioText);

      logger.debug(
        `Successfully set bio description for ${personLabel} "${personName}" collection`,
        {
          label: 'Plex Library Collections',
          personName,
          subtype,
          bioLength: bioText.length,
        }
      );

      return true;
    } catch (error) {
      logger.warn(
        `Failed to set bio description for ${this.getPersonTypeLabel(subtype)} "${personName}"`,
        {
          label: 'Plex Library Collections',
          personName,
          subtype,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return false;
    }
  }

  private sanitizePersonNameForLabel(name: string): string {
    const sanitized = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return sanitized || 'person';
  }

  private buildPersonLabel(
    subtype: PersonCollectionSubtype,
    configId: string,
    slug: string | number
  ): string {
    const suffix = String(slug).toLowerCase();
    const labelPrefix = this.getPersonLabelPrefix(subtype, configId);
    return `${labelPrefix}${suffix}`;
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

  private async buildPersonPosterItems(
    subtype: PersonCollectionSubtype,
    personName: string,
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
      const plexItems =
        subtype === 'actors'
          ? await plexClient.getItemsByActor(
              config.libraryId,
              personName,
              mediaType,
              itemLimit
            )
          : await plexClient.getItemsByDirector(
              config.libraryId,
              personName,
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
        `Prepared ${mappedItems.length} items for ${this.getPersonTypeLabel(subtype)} poster generation`,
        {
          label: 'Plex Library Collections',
          personName,
          subtype,
          libraryId: config.libraryId,
        }
      );

      return mappedItems.slice(0, itemLimit);
    } catch (error) {
      logger.warn(
        `Failed to fetch ${this.getPersonTypeLabel(subtype)} items for poster generation`,
        {
          label: 'Plex Library Collections',
          personName,
          subtype,
          libraryId: config.libraryId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return [];
    }
  }

  private async addPersonLabel(
    subtype: PersonCollectionSubtype,
    plexClient: PlexAPI,
    collectionRatingKey: string,
    label: string
  ): Promise<void> {
    try {
      await plexClient.addLabelToCollection(collectionRatingKey, label);
    } catch (labelError) {
      logger.warn(
        `Failed to add label "${label}" to ${this.getPersonTypeLabel(subtype)} collection`,
        {
          label: 'Plex Library Collections',
          collectionRatingKey,
          subtype,
          error:
            labelError instanceof Error
              ? labelError.message
              : String(labelError),
        }
      );
    }
  }

  private async fetchTmdbPersonInfo(
    personName: string
  ): Promise<PersonTmdbInfo | null> {
    try {
      const tmdbClient = new TheMovieDb({
        originalLanguage: getTmdbLanguage(),
      });

      const searchResults = await tmdbClient.searchMulti({
        query: personName,
        language: getTmdbLanguage(),
      });

      const personResult =
        searchResults.results.find(
          (result: { media_type?: string; name?: string }) =>
            result.media_type === 'person' &&
            result.name?.toLowerCase() === personName.toLowerCase()
        ) ||
        searchResults.results.find(
          (result: { media_type?: string }) => result.media_type === 'person'
        );

      if (!personResult || !('id' in personResult)) {
        logger.debug(
          `No TMDB match found for person "${personName}", skipping media lookups`,
          {
            label: 'Plex Library Collections',
            personName,
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
      logger.warn(`Failed to fetch TMDB person info for "${personName}"`, {
        label: 'Plex Library Collections',
        personName,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private wrapPersonName(name: string, maxLineLength = 16): string[] {
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

  private async applyPersonMetadata(
    plexClient: PlexAPI,
    collectionRatingKey: string,
    collectionName: string,
    personLabel: string,
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
      customLabel: personLabel,
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
    const personPlaceholder =
      config.subtype === 'actors' ? '{actor}' : '{director}';

    return {
      source: 'plex_library',
      subtype: config.subtype,
      // Per-person collections use the person name as the title; expose placeholders
      director: '{director}',
      actor: '{actor}',
      name: personPlaceholder,
      collectionName: personPlaceholder,
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
   * Process person collections - creates collections for top directors/actors
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
    if (!subtype || (subtype !== 'directors' && subtype !== 'actors')) {
      throw this.createSyncError(
        CollectionSyncErrorType.CONFIGURATION_ERROR,
        `Invalid plex_library subtype: ${subtype}. Currently only 'directors' and 'actors' are supported.`
      );
    }

    const personTypeLabel = this.getPersonTypeLabel(subtype);
    const depth = subtype === 'actors' ? 5 : 50; // Top N per person type
    const limit = 30; // Max items per person
    const minimumItems =
      subtype === 'actors'
        ? config.actorMinimumItems ?? 5
        : config.directorMinimumItems ?? 5; // Minimum threshold

    logger.info(`Processing ${subtype} collection`, {
      label: 'Plex Library Collections',
      configName: config.name,
      libraryId: config.libraryId,
      depth,
      limit,
      minimumItems,
    });

    const personLabelPrefix = this.getPersonLabelPrefix(subtype, config.id);

    try {
      // Fetch top people from library
      const people =
        subtype === 'actors'
          ? await plexClient.getLibraryActors(
              config.libraryId,
              depth * 2 // Fetch extra in case some don't meet minimum threshold
            )
          : await plexClient.getLibraryDirectors(
              config.libraryId,
              depth * 2 // Fetch extra in case some don't meet minimum threshold
            );

      // Filter people by minimum items threshold
      const qualifyingPeople = people.filter((person) => person.count >= minimumItems);

      // Limit to depth
      const topPeople = qualifyingPeople.slice(0, depth);

      logger.info(
        `Creating collections for ${topPeople.length} ${personTypeLabel}s (${qualifyingPeople.length} qualified, ${people.length} total)`,
        {
          label: 'Plex Library Collections',
          configName: config.name,
          topPeople: topPeople.map((person) => `${person.name} (${person.count} items)`),
        }
      );

      let created = 0;
      let updated = 0;
      let deleted = 0;

      for (const person of topPeople) {
        try {
          const collectionName = person.name;
          const personInfo =
            (await this.fetchTmdbPersonInfo(person.name)) ?? undefined;
          const labelSuffix =
            personInfo?.tmdbPersonId?.toString() ??
            this.sanitizePersonNameForLabel(person.name);
          const personLabel = this.buildPersonLabel(
            subtype,
            config.id,
            personInfo?.tmdbPersonId ?? labelSuffix
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
              subtype === 'actors'
                ? await plexClient['smartCollectionManager'].createActorCollection(
                    collectionName,
                    config.libraryId,
                    mediaType,
                    person.name,
                    limit
                  )
                : await plexClient['smartCollectionManager'].createDirectorCollection(
                    collectionName,
                    config.libraryId,
                    mediaType,
                    person.name,
                    limit
                  );

            if (collectionRatingKey) {
              created++;
            } else {
              logger.warn(
                `Failed to create collection for ${personTypeLabel}: ${person.name}`,
                {
                  label: 'Plex Library Collections',
                }
              );
              continue;
            }
          }

          // Tag collection so discovery recognizes it as Agregarr-managed
          await this.addPersonLabel(
            subtype,
            plexClient,
            collectionRatingKey,
            personLabel
          );

          // Track by rating key so cleanup doesn't treat it as unmanaged
          processedCollectionKeys?.add(collectionRatingKey);

          // Apply the same metadata/ordering handling used by standard collections
          await this.applyPersonMetadata(
            plexClient,
            collectionRatingKey,
            collectionName,
            personLabel,
            mediaType,
            config
          );

          const shouldGeneratePoster = config.autoPoster ?? true;
          const personImageUrl = personInfo?.profilePath
            ? `https://image.tmdb.org/t/p/original${personInfo.profilePath}`
            : undefined;
          const posterItems =
            shouldGeneratePoster && mediaType
              ? await this.buildPersonPosterItems(
                  subtype,
                  person.name,
                  mediaType,
                  config,
                  plexClient,
                  limit
                )
              : [];

          // Generate auto-poster with portrait background
          if (shouldGeneratePoster) {
            // Update summary with TMDB bio if available (custom summaries override later)
            await this.setPersonBioAsDescription(
              person.name,
              collectionRatingKey,
              plexClient,
              subtype,
              personInfo
            );

            await this.generateAutoPoster(
              collectionName,
              config,
              collectionRatingKey,
              plexClient,
              posterItems,
              undefined,
              undefined,
              personImageUrl
            );
          }
        } catch (error) {
          logger.error(
            `Error creating collection for ${personTypeLabel} ${person.name}`,
            {
              label: 'Plex Library Collections',
              personName: person.name,
              subtype,
              error: error instanceof Error ? error.message : String(error),
            }
          );
        }
      }

      // Remove any previously created collections that are now outside the depth limit
      const topPersonNames = new Set(
        topPeople.map((person) => person.name.toLowerCase())
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
          return normalized.startsWith(personLabelPrefix.toLowerCase());
        });
      });

      for (const collection of managedCollections) {
        if (topPersonNames.has(collection.title.toLowerCase())) {
          continue;
        }

        try {
          await plexClient.deleteCollection(collection.ratingKey);
          deleted++;
          logger.info(
            `Removed ${personTypeLabel} collection outside current limit: ${collection.title}`,
            {
              label: 'Plex Library Collections',
              collectionName: collection.title,
              ratingKey: collection.ratingKey,
              libraryId: config.libraryId,
            }
          );
        } catch (deleteError) {
          logger.warn(
            `Failed to delete outdated ${personTypeLabel} collection "${collection.title}"`,
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

      logger.info(`${subtype} collection sync completed`, {
        label: 'Plex Library Collections',
        configName: config.name,
        created,
        updated,
        deleted,
        total: topPeople.length,
      });

      return {
        created,
        updated,
        details: deleted ? { deleted } : undefined,
      };
    } catch (error) {
      logger.error(`Failed to process ${subtype} collection`, {
        label: 'Plex Library Collections',
        configName: config.name,
        error: error instanceof Error ? error.message : String(error),
      });

      throw this.createSyncError(
        CollectionSyncErrorType.API_ERROR,
        `Failed to fetch ${subtype} from library: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}

export const plexLibraryCollectionSync = new PlexLibraryCollectionSync();
export default plexLibraryCollectionSync;
