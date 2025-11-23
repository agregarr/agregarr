/**
 * Recently Added Collection Sync
 *
 * Creates a smart collection that replicates Plex's "Recently Added" hub
 * but excludes placeholder items created by the placeholder feature.
 *
 * This is useful when users enable `createPlaceholdersForMissing` on their
 * collections and want a clean "Recently Added" view without placeholders.
 */

import type PlexAPI from '@server/api/plexapi';
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
  RecentlyAddedTemplateContext,
  SyncResult,
} from '@server/lib/collections/core/types';
import { CollectionSyncErrorType } from '@server/lib/collections/core/types';
import type { CollectionConfig } from '@server/lib/settings';
import logger from '@server/logger';

export class RecentlyAddedCollectionSync extends BaseCollectionSync {
  constructor() {
    super('recently_added');
  }

  /**
   * Validate that configuration is valid for recently_added collections
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

    logger.info('Syncing Recently Added (filtered) collection', {
      label: 'Recently Added Collections',
      configName: config.name,
      libraryId: config.libraryId,
      mediaType,
      generatedName: collectionName,
    });

    // Check if smart collection already exists
    // Define custom label for this collection
    const customLabel = `Agregarr-recently_added-${config.id}`;

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
      logger.info('Recently Added (filtered) smart collection already exists', {
        label: 'Recently Added Collections',
        collectionName,
        ratingKey: existingCollection.ratingKey,
      });

      collectionRatingKey = existingCollection.ratingKey;

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

      const smartCollectionKey =
        await smartCollectionManager.createFilteredRecentlyAdded(
          collectionName,
          config.libraryId,
          mediaType
        );

      if (!smartCollectionKey) {
        throw this.createSyncError(
          CollectionSyncErrorType.COLLECTION_ERROR,
          'Failed to create Recently Added (filtered) smart collection'
        );
      }

      logger.info('Created Recently Added (filtered) smart collection', {
        label: 'Recently Added Collections',
        collectionName,
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
          label: 'Recently Added Collections',
          collectionRatingKey,
          collectionName,
        });

        // Fetch items from collection
        const children = await plexClient.getCollectionItemsWithMetadata(
          collectionRatingKey
        );

        logger.debug('Fetched items from collection', {
          label: 'Recently Added Collections',
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

          // Extract tmdbId from Plex GUID metadata
          const tmdbGuid = itemWithExtras.Guid?.find((guid) =>
            guid.id.startsWith('tmdb://')
          );
          const tmdbMatch = tmdbGuid?.id.match(/tmdb:\/\/(\d+)/);
          const tmdbId = tmdbMatch ? parseInt(tmdbMatch[1], 10) : undefined;

          return {
            ratingKey: item.ratingKey,
            title: item.title,
            type: mediaType,
            tmdbId,
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
        logger.warn(
          'Failed to generate poster for Recently Added (filtered) collection',
          {
            label: 'Recently Added Collections',
            collectionName,
            error:
              posterError instanceof Error
                ? posterError.message
                : String(posterError),
          }
        );
        // Don't fail the sync if poster generation fails
      }
    }

    return result;
  }
}

// Export singleton instance
export const recentlyAddedCollectionSync = new RecentlyAddedCollectionSync();
export default recentlyAddedCollectionSync;
