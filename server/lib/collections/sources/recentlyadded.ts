/**
 * Filtered Hub Collection Sync
 *
 * Creates smart collections that replicate Plex's default hubs
 * but exclude placeholder items created by the placeholder feature.
 *
 * Supports:
 * - recently_added: Replicates "Recently Added" hub (sorted by addedAt)
 * - recently_released: Replicates "Recently Released" hub (sorted by originallyAvailableAt)
 *
 * This is useful when users enable `createPlaceholdersForMissing` on their
 * collections and want clean hub views without placeholders.
 */

import type PlexAPI from '@server/api/plexapi';
import { BaseCollectionSync } from '@server/lib/collections/core/BaseCollectionSync';
import {
  extractTmdbIdFromGuids,
  extractTvdbIdFromGuids,
  getCollectionMediaType,
  parseConfigIdFromLabel,
  updateConfigWithRatingKey,
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
  RecentlyAddedTemplateContext,
  SyncResult,
} from '@server/lib/collections/core/types';
import { CollectionSyncErrorType } from '@server/lib/collections/core/types';
import { getSettings, type CollectionConfig } from '@server/lib/settings';
import logger from '@server/logger';

export class FilteredHubCollectionSync extends BaseCollectionSync<'filtered_hub'> {
  constructor() {
    super('filtered_hub');
  }

  /**
   * Validate that configuration is valid for filtered_hub collections
   */
  protected async validateConfiguration(): Promise<void> {
    // No external API dependencies - just needs Plex
  }

  /**
   * Create template context for name generation
   */
  protected async createTemplateContext(
    config: CollectionConfig,
    mediaType: 'movie' | 'tv'
  ): Promise<RecentlyAddedTemplateContext> {
    return {
      source: 'recently_added',
      mediaType,
    };
  }

  /**
   * Recently Added doesn't fetch external data - it creates a smart Plex collection
   */
  public async fetchSourceData(
    config: CollectionConfig,
    options?: CollectionSyncOptions,
    libraryCache?: LibraryItemsCache
  ): Promise<CollectionSourceData[]> {
    // Suppress unused variable warnings - required by abstract interface
    void config;
    void options;
    void libraryCache;
    return [];
  }

  /**
   * Not used for this collection type
   */
  public async mapSourceDataToItems(
    sourceData: CollectionSourceData[],
    config: CollectionConfig,
    plexClient?: PlexAPI,
    libraryCache?: LibraryItemsCache
  ): Promise<{
    items: CollectionItem[];
    missingItems?: MissingItem[];
    stats?: FilteringStats;
  }> {
    // Suppress unused variable warnings - required by abstract interface
    void sourceData;
    void config;
    void plexClient;
    void libraryCache;
    return {
      items: [],
      missingItems: [],
      stats: { original: 0, filtered: 0, removed: 0 },
    };
  }

  /**
   * Not used for this collection type - we use processConfiguration directly
   */
  protected async createCollection(
    items: CollectionItem[],
    mediaType: 'movie' | 'tv',
    collectionName: string,
    plexClient: PlexAPI,
    allCollections: PlexCollection[],
    config: CollectionConfig,
    processedCollectionKeys?: Set<string>
  ): Promise<CollectionOperationResult> {
    // Suppress unused variable warnings - required by abstract interface
    void items;
    void mediaType;
    void collectionName;
    void plexClient;
    void allCollections;
    void config;
    void processedCollectionKeys;
    return {
      created: 0,
      updated: 0,
      itemCount: 0,
    };
  }

  /**
   * Process a single Recently Added collection configuration
   */
  protected async processConfiguration(
    config: CollectionConfig,
    plexClient: PlexAPI,
    allCollections: PlexCollection[],
    processedCollectionKeys?: Set<string>,
    libraryCache?: LibraryItemsCache,
    options?: CollectionSyncOptions
  ): Promise<SyncResult> {
    // Suppress unused variable warnings - required by abstract interface
    void libraryCache;
    void options;
    const mediaType = getCollectionMediaType(config);

    // Generate collection name from template
    // Handle custom templates - check for customMovieTemplate/customTVTemplate when template is 'custom'
    const template = (() => {
      if (config.template === 'custom') {
        return mediaType === 'movie'
          ? config.customMovieTemplate || config.name
          : config.customTVTemplate || config.name;
      }
      return config.template || config.name;
    })();

    const templateContext = await this.createTemplateContext(config, mediaType);
    const collectionName = this.templateEngine.processTemplate(
      template,
      templateContext
    );

    // Validate subtype
    const subtype = config.subtype as
      | 'recently_added'
      | 'recently_released'
      | 'recently_released_episodes';
    if (
      !subtype ||
      ![
        'recently_added',
        'recently_released',
        'recently_released_episodes',
      ].includes(subtype)
    ) {
      throw this.createSyncError(
        CollectionSyncErrorType.CONFIGURATION_ERROR,
        `Invalid filtered_hub subtype: ${subtype}. Must be 'recently_added', 'recently_released', or 'recently_released_episodes'`
      );
    }

    // Validate that recently_released_episodes is only used with TV libraries
    if (subtype === 'recently_released_episodes' && mediaType !== 'tv') {
      throw this.createSyncError(
        CollectionSyncErrorType.CONFIGURATION_ERROR,
        `The 'recently_released_episodes' subtype is only supported for TV libraries`
      );
    }

    logger.info('Syncing filtered hub collection', {
      label: 'Filtered Hub Collections',
      configName: config.name,
      libraryId: config.libraryId,
      mediaType,
      subtype,
      generatedName: collectionName,
    });

    // Resolve collection exclusions to Plex collection titles
    const excludeCollectionTitles: string[] = [];
    if (config.excludeFromCollections?.length) {
      const settings = getSettings();
      const libraryCollections = allCollections.filter(
        (col) => col.libraryKey === config.libraryId
      );
      for (const excludedId of config.excludeFromCollections) {
        const excludedConfig = settings.plex.collectionConfigs?.find(
          (c) => c.id === excludedId
        );
        if (!excludedConfig) {
          logger.debug(
            `Skipping exclusion for config ${excludedId}: config not found`,
            { label: 'Filtered Hub Collections' }
          );
          continue;
        }

        let plexCol: (typeof libraryCollections)[number] | undefined;

        if (excludedConfig.collectionRatingKey) {
          plexCol = libraryCollections.find(
            (c) => c.ratingKey === excludedConfig.collectionRatingKey
          );
        }

        // Fallback: ratingKey missing or stale (collection was recreated).
        // Search by Agregarr label which encodes the config ID.
        // Only attempt if excluded config is in the same library as this hub.
        if (!plexCol && excludedConfig.libraryId === config.libraryId) {
          plexCol = libraryCollections.find((c) =>
            c.labels?.some((label) => {
              const labelText = typeof label === 'string' ? label : label.tag;
              return parseConfigIdFromLabel(labelText) === excludedId;
            })
          );
          if (plexCol) {
            logger.info(
              `Exclusion config ${excludedId} (${excludedConfig.name}): resolved via label fallback (ratingKey ${plexCol.ratingKey})`,
              { label: 'Filtered Hub Collections' }
            );
            updateConfigWithRatingKey(
              excludedId,
              plexCol.ratingKey,
              excludedConfig.libraryId
            );
          }
        }

        if (plexCol?.title) {
          excludeCollectionTitles.push(plexCol.title);
        } else {
          logger.debug(
            `Skipping exclusion for config ${excludedId}: Plex collection not found`,
            { label: 'Filtered Hub Collections' }
          );
        }
      }
      if (excludeCollectionTitles.length > 0) {
        logger.info('Applying collection exclusions to filtered hub', {
          label: 'Filtered Hub Collections',
          configName: config.name,
          excludedCollections: excludeCollectionTitles,
        });
      }
    }

    // Check if smart collection already exists
    // Define custom label for this collection
    const customLabel = `Agregarr-filtered_hub-${config.id}`;

    // Filter collections to only those in the target library
    const libraryCollections = allCollections.filter(
      (col) => col.libraryKey === config.libraryId
    );

    // First try using stored collectionRatingKey from config
    let existingCollection: PlexCollection | undefined;
    if (config.collectionRatingKey) {
      existingCollection = libraryCollections.find(
        (col) => col.ratingKey === config.collectionRatingKey
      );
    }

    // Fallback: search by label if ratingKey not found or not in config
    if (!existingCollection) {
      existingCollection = libraryCollections.find((col) =>
        col.labels?.some(
          (label) =>
            (typeof label === 'string' && label === customLabel) ||
            (typeof label === 'object' &&
              label !== null &&
              'tag' in label &&
              label.tag === customLabel)
        )
      );
    }

    let result: SyncResult;
    let collectionRatingKey: string;

    if (existingCollection) {
      logger.info('Filtered hub smart collection already exists', {
        label: 'Filtered Hub Collections',
        collectionName,
        subtype,
        ratingKey: existingCollection.ratingKey,
      });

      collectionRatingKey = existingCollection.ratingKey;

      // Update the smart collection URI with current config values (especially maxItems)
      const PlexSmartCollectionManager = (
        await import('@server/lib/collections/plex/PlexSmartCollectionManager')
      ).default;
      const smartCollectionManager = new PlexSmartCollectionManager(plexClient);

      await smartCollectionManager.updateFilteredHubUri(
        collectionRatingKey,
        config.libraryId,
        mediaType,
        subtype,
        config.maxItems,
        excludeCollectionTitles.length > 0 ? excludeCollectionTitles : undefined
      );

      logger.info('Updated filtered hub smart collection URI', {
        label: 'Filtered Hub Collections',
        collectionName,
        subtype,
        ratingKey: collectionRatingKey,
        maxItems: config.maxItems,
      });

      // Mark as processed
      if (processedCollectionKeys) {
        processedCollectionKeys.add(existingCollection.ratingKey);
      }

      result = { created: 0, updated: 1 };
    } else {
      // Create new filtered smart collection
      const PlexSmartCollectionManager = (
        await import('@server/lib/collections/plex/PlexSmartCollectionManager')
      ).default;
      const smartCollectionManager = new PlexSmartCollectionManager(plexClient);

      const smartCollectionKey = await smartCollectionManager.createFilteredHub(
        collectionName,
        config.libraryId,
        mediaType,
        subtype,
        config.maxItems,
        excludeCollectionTitles.length > 0 ? excludeCollectionTitles : undefined
      );

      if (!smartCollectionKey) {
        throw this.createSyncError(
          CollectionSyncErrorType.COLLECTION_ERROR,
          `Failed to create filtered hub smart collection (subtype: ${subtype})`
        );
      }

      logger.info('Created filtered hub smart collection', {
        label: 'Filtered Hub Collections',
        collectionName,
        subtype,
        smartCollectionKey,
      });

      collectionRatingKey = smartCollectionKey;

      // Mark as processed
      if (processedCollectionKeys) {
        processedCollectionKeys.add(smartCollectionKey);
      }

      result = { created: 1, updated: 0 };
    }

    // Update collection metadata (labels, visibility, sort title, hub promotion, etc.)
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
      customLabel,
      sortOrderLibrary: config.sortOrderLibrary,
      isLibraryPromoted: config.isLibraryPromoted,
      customPoster: config.customPoster,
      libraryKey: config.libraryId,
      config,
    });

    // Update config with rating key
    this.updateConfigWithRatingKey(config, collectionRatingKey);

    // Generate poster if autoPoster is enabled
    const shouldGeneratePoster = config.autoPoster ?? true;

    if (shouldGeneratePoster) {
      try {
        logger.debug('Fetching items from collection for poster generation', {
          label: 'Filtered Hub Collections',
          collectionRatingKey,
          collectionName,
        });

        // Fetch items from collection
        const children = await plexClient.getCollectionItemsWithMetadata(
          collectionRatingKey
        );

        logger.debug('Fetched items from collection', {
          label: 'Filtered Hub Collections',
          collectionRatingKey,
          itemCount: children.length,
        });

        // Plex API returns metadata items with optional properties
        interface PlexMetadataWithExtras {
          ratingKey: string;
          title: string;
          thumb?: string;
          year?: number;
          Guid?: { id: string }[];
        }

        // Convert to CollectionItem[] format for poster generation
        const items: CollectionItem[] = children.map((item) => {
          const itemWithExtras = item as unknown as PlexMetadataWithExtras;

          const tmdbId = extractTmdbIdFromGuids(itemWithExtras.Guid);
          const tvdbId = extractTvdbIdFromGuids(itemWithExtras.Guid);

          return {
            ratingKey: item.ratingKey,
            title: item.title,
            type: mediaType,
            tmdbId,
            tvdbId,
            year: itemWithExtras.year,
          };
        });

        // Use the normal poster generation flow
        await this.generateAutoPoster(
          collectionName,
          config,
          collectionRatingKey,
          plexClient,
          items
        );
      } catch (posterError) {
        logger.warn('Failed to generate poster for filtered hub collection', {
          label: 'Filtered Hub Collections',
          collectionName,
          error:
            posterError instanceof Error
              ? posterError.message
              : String(posterError),
        });
        // Don't fail the sync if poster generation fails
      }
    }

    return result;
  }
}

// Export singleton instance
export const filteredHubCollectionSync = new FilteredHubCollectionSync();
export default filteredHubCollectionSync;

// Legacy export for backwards compatibility
export const recentlyAddedCollectionSync = filteredHubCollectionSync;
