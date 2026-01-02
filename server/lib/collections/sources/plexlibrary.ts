import { getRepository } from '@server/datasource';
import { PosterTemplate } from '@server/entity/PosterTemplate';
/**
 * Plex Library Collection Sync
 *
 * Creates smart collections based on Plex library metadata (e.g., directors, actors).
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
import {
  getSettings,
  getTmdbLanguage,
  type CollectionConfig,
} from '@server/lib/settings';
import logger from '@server/logger';

type PersonTmdbInfo = {
  tmdbPersonId: number;
  profilePath?: string;
  biography?: string;
};

type TmdbSearchResult = {
  media_type?: string;
  name?: string;
  id?: number | string;
  profile_path?: string;
};

type PersonCollectionSubtype = 'directors' | 'actors';

const DEFAULT_SEPARATOR_POSTER = 'generated_separator.jpg';

export class PlexLibraryCollectionSync extends BaseCollectionSync<'plex'> {
  constructor() {
    super('plex');
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

  private getSeparatorLabel(configId: string): string {
    return `AgregarrPersonSeparator-${configId}`;
  }

  private getSeparatorTitle(config: CollectionConfig): string {
    const fallback =
      config.subtype === 'actors'
        ? 'Actor Collections'
        : 'Director Collections';
    const title = config.separatorTitle?.trim();
    return title && title.length > 0 ? title : fallback;
  }

  private normalizeLabel(label: string | PlexLabel): string {
    return typeof label === 'string'
      ? label.toLowerCase()
      : (label.tag || '').toLowerCase();
  }

  private buildSeparatorSortTitle(
    config: CollectionConfig,
    baseTitle: string
  ): string {
    const settings = getSettings();
    const sortOrderLibrary = config.sortOrderLibrary;
    const isPromoted = config.isLibraryPromoted;

    if (sortOrderLibrary !== undefined && isPromoted) {
      const allConfigs = settings.plex.collectionConfigs || [];
      const promotedConfigs = allConfigs.filter(
        (c) =>
          c.libraryId === config.libraryId &&
          c.sortOrderLibrary !== undefined &&
          c.isLibraryPromoted === true
      );

      const maxSortOrder =
        promotedConfigs.length > 0
          ? Math.max(
              ...promotedConfigs
                .map((c) => c.sortOrderLibrary)
                .filter((v): v is number => v !== undefined)
            )
          : 0;

      const exclamationCount = maxSortOrder
        ? maxSortOrder - sortOrderLibrary + 2
        : 2;
      // Add a digit after the prefix so it sorts before alpha titles but after plain '!'
      const prefix = '!'.repeat(Math.max(1, exclamationCount));
      return `${prefix}0${baseTitle}`;
    }

    // Non-promoted: use a digit so it stays ahead of alpha names in A-Z buckets
    return `0${baseTitle}`;
  }

  private async resolveSeparatorTemplateId(): Promise<number | null> {
    try {
      const templateRepository = getRepository(PosterTemplate);
      const template = await templateRepository.findOne({
        where: { name: 'Separator', isActive: true },
      });

      return template?.id ?? null;
    } catch (error) {
      logger.warn('Failed to resolve Separator poster template', {
        label: 'Plex Library Collections',
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
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
        personInfo ?? (await this.fetchTmdbPersonInfo(personName, undefined));
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
        `Failed to set bio description for ${this.getPersonTypeLabel(
          subtype
        )} "${personName}"`,
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
        `Prepared ${mappedItems.length} items for ${this.getPersonTypeLabel(
          subtype
        )} poster generation`,
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
        `Failed to fetch ${this.getPersonTypeLabel(
          subtype
        )} items for poster generation`,
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
        `Failed to add label "${label}" to ${this.getPersonTypeLabel(
          subtype
        )} collection`,
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
    personName: string,
    libraryId?: string
  ): Promise<PersonTmdbInfo | null> {
    try {
      const language = await getTmdbLanguage(libraryId);
      const tmdbClient = new TheMovieDb({
        originalLanguage: language,
      });

      const searchResults = await tmdbClient.searchMulti({
        query: personName,
        language,
      });

      const results = (searchResults.results ?? []) as TmdbSearchResult[];

      const personResult =
        results.find(
          (result) =>
            result.media_type === 'person' &&
            result.name?.toLowerCase() === personName.toLowerCase()
        ) || results.find((result) => result.media_type === 'person');

      if (!personResult || personResult.id == null) {
        logger.debug(
          `No TMDB match found for person "${personName}", skipping media lookups`,
          {
            label: 'Plex Library Collections',
            personName,
          }
        );
        return null;
      }

      const personId = Number(personResult.id);

      const personDetails = await tmdbClient.getPerson({
        personId,
        language,
      });

      return {
        tmdbPersonId: personId,
        profilePath:
          personResult.profile_path || personDetails.profile_path || undefined,
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

  private findSeparatorCollection(
    allCollections: PlexCollection[],
    label: string,
    title: string,
    libraryId: string
  ): PlexCollection | undefined {
    const normalizedLabel = label.toLowerCase();
    const normalizedTitle = title.toLowerCase();

    return allCollections.find((collection) => {
      if (collection.libraryKey !== libraryId) {
        return false;
      }

      const labels = Array.isArray(collection.labels) ? collection.labels : [];

      const hasLabel = labels.some(
        (label: string | PlexLabel) =>
          this.normalizeLabel(label) === normalizedLabel
      );

      return (
        hasLabel ||
        (collection.title && collection.title.toLowerCase() === normalizedTitle)
      );
    });
  }

  private async syncSeparatorCollection(
    config: CollectionConfig,
    plexClient: PlexAPI,
    allCollections: PlexCollection[],
    mediaType: 'movie' | 'tv',
    processedCollectionKeys?: Set<string>
  ): Promise<void> {
    const separatorLabel = this.getSeparatorLabel(config.id);
    const separatorTitle = this.getSeparatorTitle(config);

    try {
      const existingCollection =
        this.findSeparatorCollection(
          allCollections,
          separatorLabel,
          separatorTitle,
          config.libraryId
        ) ||
        (await plexClient.getCollectionByName(
          separatorTitle,
          config.libraryId
        ));

      let ratingKey: string | null | undefined = existingCollection?.ratingKey;

      if (!ratingKey) {
        ratingKey = await plexClient.createEmptyCollection(
          separatorTitle,
          config.libraryId,
          mediaType
        );
      }

      if (!ratingKey) {
        logger.warn(
          `Failed to create separator collection for ${config.subtype}`,
          {
            label: 'Plex Library Collections',
            configId: config.id,
            libraryId: config.libraryId,
          }
        );
        return;
      }

      const separatorRatingKey = ratingKey as string;

      processedCollectionKeys?.add(separatorRatingKey);

      const visibilityConfig: CollectionVisibilityConfig = {
        usersHome: config.visibilityConfig?.usersHome ?? false,
        serverOwnerHome: config.visibilityConfig?.serverOwnerHome ?? false,
        libraryRecommended:
          config.visibilityConfig?.libraryRecommended ?? false,
        isActive: config.isActive ?? true,
      };

      await this.updateCollectionMetadata(plexClient, separatorRatingKey, {
        collectionName: separatorTitle,
        mediaType,
        visibilityConfig,
        customLabel: separatorLabel,
        sortOrderLibrary: config.sortOrderLibrary,
        isLibraryPromoted: config.isLibraryPromoted,
        customPoster: undefined,
        libraryKey: config.libraryId,
        config,
      });

      // Set separator to inherit library default (collectionMode = -1)
      // This allows the separator to respect library-level visibility settings
      try {
        await plexClient.updateCollectionMode(separatorRatingKey, -1);
        logger.debug(
          'Successfully set separator collection mode to -1 (inherit library default)',
          {
            label: 'Plex Library Collections',
            separatorRatingKey,
          }
        );
      } catch (modeError) {
        logger.warn('Failed to set separator collection mode', {
          label: 'Plex Library Collections',
          error:
            modeError instanceof Error ? modeError.message : String(modeError),
        });
      }

      // Align separator sort title with user ordering (matching prefix, underscore to float before group)
      try {
        const sortTitle = this.buildSeparatorSortTitle(config, separatorTitle);
        await plexClient.updateCollectionSortTitle(
          separatorRatingKey,
          sortTitle
        );
      } catch (sortError) {
        logger.debug('Failed to set separator sort title', {
          label: 'Plex Library Collections',
          error:
            sortError instanceof Error ? sortError.message : String(sortError),
        });
      }

      // Generate poster via pipeline using the Separator template; fall back to static poster on failure
      const separatorTemplateId = await this.resolveSeparatorTemplateId();

      if (separatorTemplateId) {
        try {
          await this.generateAutoPoster(
            separatorTitle,
            {
              ...config,
              autoPoster: true,
              autoPosterTemplate: separatorTemplateId,
            },
            separatorRatingKey,
            plexClient
          );
        } catch (posterError) {
          logger.warn('Failed to generate separator poster via pipeline', {
            label: 'Plex Library Collections',
            error:
              posterError instanceof Error
                ? posterError.message
                : String(posterError),
          });

          await this.updateCollectionMetadata(plexClient, separatorRatingKey, {
            collectionName: separatorTitle,
            mediaType,
            visibilityConfig,
            customLabel: separatorLabel,
            sortOrderLibrary: config.sortOrderLibrary,
            isLibraryPromoted: config.isLibraryPromoted,
            customPoster: DEFAULT_SEPARATOR_POSTER,
            libraryKey: config.libraryId,
            config,
          });
        }
      } else {
        await this.updateCollectionMetadata(plexClient, separatorRatingKey, {
          collectionName: separatorTitle,
          mediaType,
          visibilityConfig,
          customLabel: separatorLabel,
          sortOrderLibrary: config.sortOrderLibrary,
          isLibraryPromoted: config.isLibraryPromoted,
          customPoster: DEFAULT_SEPARATOR_POSTER,
          libraryKey: config.libraryId,
          config,
        });
      }
    } catch (error) {
      logger.warn(`Failed to sync separator collection for ${config.subtype}`, {
        label: 'Plex Library Collections',
        configId: config.id,
        libraryId: config.libraryId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async cleanupSeparatorCollection(
    config: CollectionConfig,
    plexClient: PlexAPI,
    allCollections: PlexCollection[]
  ): Promise<void> {
    const separatorLabel = this.getSeparatorLabel(config.id).toLowerCase();

    const existing = allCollections.find((collection) => {
      if (collection.libraryKey !== config.libraryId) {
        return false;
      }

      const labels = Array.isArray(collection.labels) ? collection.labels : [];

      return labels.some(
        (label: string | PlexLabel) =>
          this.normalizeLabel(label) === separatorLabel
      );
    });

    if (!existing) {
      return;
    }

    try {
      await plexClient.deleteCollection(existing.ratingKey);
      logger.info(
        `Removed separator collection "${existing.title}" for config ${config.id}`,
        {
          label: 'Plex Library Collections',
          collectionId: existing.ratingKey,
          libraryId: config.libraryId,
        }
      );
    } catch (error) {
      logger.warn(
        `Failed to delete separator collection for config ${config.id}`,
        {
          label: 'Plex Library Collections',
          collectionId: existing.ratingKey,
          libraryId: config.libraryId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  protected async validateConfiguration(): Promise<void> {
    // No external API dependencies - just needs Plex
  }

  protected async createTemplateContext(
    config: CollectionConfig,
    _mediaType: 'movie' | 'tv'
  ): Promise<Record<string, unknown>> {
    void _mediaType;
    const personPlaceholder =
      config.subtype === 'actors' ? '{actor}' : '{director}';

    return {
      source: 'plex',
      subtype: config.subtype,
      // Per-person collections use the person name as the title; expose placeholders
      director: '{director}',
      actor: '{actor}',
      name: personPlaceholder,
      collectionName: personPlaceholder,
    };
  }

  /**
   * Create collection name for a specific person (director/actor)
   * Similar to how Overseerr handles per-user collection names
   */
  private async createPersonCollectionName(
    personName: string,
    config: CollectionConfig,
    mediaType: 'movie' | 'tv'
  ): Promise<string> {
    // Create context with actual person name instead of placeholders
    const context = {
      source: 'plex',
      subtype: config.subtype,
      director: personName,
      actor: personName,
      name: personName,
      collectionName: personName,
      mediaType: mediaType,
    };

    // Use the same template logic as generateCollectionNameWithCustom
    const template = (() => {
      if (config.template === 'custom') {
        return mediaType === 'movie'
          ? config.customMovieTemplate || config.name
          : config.customTVTemplate || config.name;
      }
      return config.template || personName;
    })();

    return this.templateEngine.processTemplate(template, context);
  }

  public override async fetchSourceData(
    _config: CollectionConfig,
    _options?: CollectionSyncOptions,
    _libraryCache?: LibraryItemsCache
  ): Promise<CollectionSourceData[]> {
    void _config;
    void _options;
    void _libraryCache;
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
    void _sourceData;
    void _config;
    void _plexClient;
    void _libraryCache;
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
    void _items;
    void _mediaType;
    void _collectionName;
    void _plexClient;
    void _allCollections;
    void _config;
    void _processedCollectionKeys;
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
    void _libraryCache;
    void _options;
    const mediaType = getCollectionMediaType(config);
    const subtype = config.subtype;
    if (!subtype || (subtype !== 'directors' && subtype !== 'actors')) {
      throw this.createSyncError(
        CollectionSyncErrorType.CONFIGURATION_ERROR,
        `Invalid plex subtype: ${subtype}. Currently only 'directors' and 'actors' are supported.`
      );
    }

    const personTypeLabel = this.getPersonTypeLabel(subtype);
    const minimumItems = config.personMinimumItems ?? 5;

    logger.info(`Processing ${subtype} collection`, {
      label: 'Plex Library Collections',
      configName: config.name,
      libraryId: config.libraryId,
      minimumItems,
    });

    const personLabelPrefix = this.getPersonLabelPrefix(subtype, config.id);

    if (config.useSeparator) {
      await this.syncSeparatorCollection(
        config,
        plexClient,
        allCollections,
        mediaType,
        processedCollectionKeys
      );
    } else {
      await this.cleanupSeparatorCollection(config, plexClient, allCollections);
    }

    try {
      // Fetch people from library (full list so we can respect minimum thresholds during cleanup)
      const people =
        subtype === 'actors'
          ? await plexClient.getLibraryActors(config.libraryId)
          : await plexClient.getLibraryDirectors(config.libraryId);

      // Filter people by minimum items threshold
      const qualifyingPeople = people.filter(
        (person) => person.count >= minimumItems
      );
      const qualifyingPersonNames = new Set(
        qualifyingPeople.map((person) => person.name.toLowerCase())
      );

      logger.info(
        `Creating collections for ${qualifyingPeople.length} ${personTypeLabel}s (${people.length} total)`,
        {
          label: 'Plex Library Collections',
          configName: config.name,
          people: qualifyingPeople.map(
            (person) => `${person.name} (${person.count} items)`
          ),
        }
      );

      let created = 0;
      let updated = 0;
      let deleted = 0;

      for (const person of qualifyingPeople) {
        try {
          // Generate collection name using template with actual person name
          const collectionName = await this.createPersonCollectionName(
            person.name,
            config,
            mediaType
          );
          const personInfo =
            (await this.fetchTmdbPersonInfo(person.name, config.libraryId)) ??
            undefined;
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
                ? await plexClient.createActorCollection(
                    collectionName,
                    config.libraryId,
                    mediaType,
                    person.name
                  )
                : await plexClient.createDirectorCollection(
                    collectionName,
                    config.libraryId,
                    mediaType,
                    person.name
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
                  plexClient
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
              {
                personImageUrl,
              }
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

      // Remove any previously created collections that no longer meet the threshold
      const managedCollections = allCollections.filter((collection) => {
        if (collection.libraryKey !== config.libraryId) {
          return false;
        }

        const labels = Array.isArray(collection.labels)
          ? collection.labels
          : [];

        return labels.some((label: string | PlexLabel) => {
          const labelText = typeof label === 'string' ? label : label.tag;
          if (!labelText) return false;
          const normalized = labelText.toLowerCase();
          return normalized.startsWith(personLabelPrefix.toLowerCase());
        });
      });

      for (const collection of managedCollections) {
        const normalizedTitle = collection.title.toLowerCase();

        if (qualifyingPersonNames.has(normalizedTitle)) {
          continue;
        }

        try {
          await plexClient.deleteCollection(collection.ratingKey);
          deleted++;
          logger.info(
            `Removed ${personTypeLabel} collection below minimum item threshold: ${collection.title}`,
            {
              label: 'Plex Library Collections',
              collectionName: collection.title,
              ratingKey: collection.ratingKey,
              libraryId: config.libraryId,
              minimumItems,
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

      // If no person collections exist and separator was enabled, clean it up
      if (qualifyingPeople.length === 0 && config.useSeparator) {
        logger.info(
          `No qualifying ${personTypeLabel}s found, cleaning up separator collection`,
          {
            label: 'Plex Library Collections',
            configName: config.name,
          }
        );
        // Re-fetch collections to include the separator we just created
        const updatedCollections = await plexClient.getAllCollections();
        await this.cleanupSeparatorCollection(
          config,
          plexClient,
          updatedCollections
        );
      }

      logger.info(`${subtype} collection sync completed`, {
        label: 'Plex Library Collections',
        configName: config.name,
        created,
        updated,
        deleted,
        total: qualifyingPeople.length,
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
