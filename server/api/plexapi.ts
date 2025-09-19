import type { PlexHubManagementResponse } from '@server/interfaces/api/plexInterfaces';
import type { Library, PlexSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import axios from 'axios';
import NodePlexAPI from 'plex-api';

// Extended interface for type-safe Plex API HTTP methods
interface ExtendedPlexAPI extends NodePlexAPI {
  postQuery?: (url: string) => Promise<unknown>;
  putQuery?: (url: string) => Promise<void>;
  deleteQuery?: (url: string) => Promise<void>;
}

export interface PlexLibraryItem {
  ratingKey: string;
  parentRatingKey?: string;
  grandparentRatingKey?: string;
  title: string;
  guid: string;
  parentGuid?: string;
  grandparentGuid?: string;
  addedAt: number;
  updatedAt: number;
  Guid?: {
    id: string;
  }[];
  type: 'movie' | 'show' | 'season' | 'episode';
  Media: Media[];
}

interface PlexLibraryResponse {
  MediaContainer: {
    totalSize: number;
    Metadata: PlexLibraryItem[];
  };
}

export interface PlexLibrary {
  type: 'show' | 'movie';
  key: string;
  title: string;
  agent: string;
}

interface PlexLibrariesResponse {
  MediaContainer: {
    Directory: PlexLibrary[];
  };
}

export interface PlexMetadata {
  ratingKey: string;
  parentRatingKey?: string;
  guid: string;
  type: 'movie' | 'show' | 'season' | 'episode';
  title: string;
  Guid: {
    id: string;
  }[];
  Children?: {
    size: 12;
    Metadata: PlexMetadata[];
  };
  index: number;
  parentIndex?: number;
  leafCount: number;
  viewedLeafCount: number;
  addedAt: number;
  updatedAt: number;
  Media: Media[];
}

interface Media {
  id: number;
  duration: number;
  bitrate: number;
  width: number;
  height: number;
  aspectRatio: number;
  audioChannels: number;
  audioCodec: string;
  videoCodec: string;
  videoResolution: string;
  container: string;
  videoFrameRate: string;
  videoProfile: string;
}

interface PlexMetadataResponse {
  MediaContainer: {
    Metadata: PlexMetadata[];
  };
}

export interface PlexCollectionItem {
  ratingKey: string;
  title: string;
  addedAt?: number;
  [key: string]: unknown;
}

interface PlexCollection {
  ratingKey: string;
  title: string;
  type: string;
  addedAt?: number;
  labels: string[];
  libraryKey?: string;
  libraryName?: string;
  titleSort?: string;
  Label?: { tag: string; id?: number }[];
  [key: string]: unknown;
}

interface PlexCollectionMetadata extends PlexCollection {
  summary?: string;
  childCount?: number;
  thumb?: string;
  art?: string;
  titleSort?: string;
}

interface PlexCollectionResponse {
  MediaContainer: {
    Metadata: PlexCollection[];
    size?: number;
    totalSize?: number;
  };
}

class PlexAPI {
  private plexClient: NodePlexAPI;
  private plexToken?: string;

  private getExtendedClient(): ExtendedPlexAPI {
    return this.plexClient as ExtendedPlexAPI;
  }

  private async safePostQuery(url: string): Promise<unknown> {
    const client = this.getExtendedClient();
    if (typeof client.postQuery !== 'function') {
      throw new Error(
        'POST operations are not supported by this Plex API version'
      );
    }
    return client.postQuery(url);
  }

  private async safePutQuery(url: string): Promise<void> {
    const client = this.getExtendedClient();
    if (typeof client.putQuery !== 'function') {
      throw new Error(
        'PUT operations are not supported by this Plex API version'
      );
    }
    return client.putQuery(url);
  }

  private async safeDeleteQuery(url: string): Promise<void> {
    const client = this.getExtendedClient();
    if (typeof client.deleteQuery !== 'function') {
      throw new Error(
        'DELETE operations are not supported by this Plex API version'
      );
    }
    return client.deleteQuery(url);
  }

  constructor({
    plexToken,
    plexSettings,
    timeout,
  }: {
    plexToken?: string;
    plexSettings?: PlexSettings;
    timeout?: number;
  }) {
    const settings = getSettings();
    let settingsPlex: PlexSettings | undefined;
    plexSettings
      ? (settingsPlex = plexSettings)
      : (settingsPlex = getSettings().plex);

    // Store the token for later use
    this.plexToken = plexToken;

    this.plexClient = new NodePlexAPI({
      hostname: settingsPlex.ip,
      port: settingsPlex.port,
      https: settingsPlex.useSsl,
      timeout: timeout,
      token: plexToken,
      authenticator: {
        authenticate: (
          _plexApi,
          cb: (err?: string, token?: string) => void
        ) => {
          if (!plexToken) {
            return cb('Plex Token not found!');
          }
          cb(undefined, plexToken);
        },
      },
      options: {
        identifier: settings.clientId,
        product: 'Agregarr',
        deviceName: 'Agregarr',
        platform: 'Agregarr',
      },
    });
  }

  public async getStatus() {
    return await this.plexClient.query('/');
  }

  public async checkPlexPass(): Promise<boolean> {
    try {
      const response = await this.plexClient.query('/myplex/account');
      const account = response.MyPlex;

      logger.info('Parsed account data.', {
        label: 'Plex API',
        subscriptionActive: account?.subscriptionActive,
        subscriptionState: account?.subscriptionState,
      });

      const hasPlexPass =
        account?.subscriptionActive === true ||
        account?.subscriptionState === 'Active';

      logger.info(
        `Plex Pass check result: ${hasPlexPass ? 'Active' : 'Inactive'}`,
        {
          label: 'Plex API',
          subscriptionActive: account?.subscriptionActive,
          subscriptionState: account?.subscriptionState,
        }
      );

      return hasPlexPass;
    } catch (error) {
      logger.warn(
        'Could not check Plex Pass status. Assuming false for safety.',
        {
          label: 'Plex API',
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );
      return false;
    }
  }

  public async getLibraries(): Promise<PlexLibrary[]> {
    const startTime = Date.now();

    try {
      const response = await this.plexClient.query<PlexLibrariesResponse>(
        '/library/sections'
      );

      // Only log if response time is unusually high (> 500ms) or if it fails
      const responseTime = Date.now() - startTime;
      if (responseTime > 500) {
        logger.warn('Slow Plex libraries fetch detected', {
          label: 'Plex API',
          libraryCount: response.MediaContainer.Directory?.length || 0,
          responseTime,
        });
      }

      return response.MediaContainer.Directory;
    } catch (error) {
      logger.error('Failed to fetch Plex libraries', {
        label: 'Plex API',
        error: error instanceof Error ? error.message : String(error),
        responseTime: Date.now() - startTime,
      });
      throw error;
    }
  }

  public async syncLibraries(): Promise<void> {
    const settings = getSettings();

    try {
      const libraries = await this.getLibraries();

      const newLibraries: Library[] = libraries
        .filter(
          (library) => library.type === 'movie' || library.type === 'show'
        )
        .filter((library) => library.agent !== 'com.plexapp.agents.none')
        .map((library) => {
          const existing = settings.plex.libraries.find(
            (l) => l.key === library.key && l.name === library.title
          );

          return {
            key: library.key,
            name: library.title,
            type: library.type,
            lastScan: existing?.lastScan,
          };
        });

      settings.plex.libraries = newLibraries;
    } catch (e) {
      logger.error('Failed to fetch Plex libraries.', {
        label: 'Plex API',
        message: e.message,
      });

      settings.plex.libraries = [];
    }

    settings.save();
  }

  public async getLibraryContents(
    id: string,
    { offset = 0, size = 50 }: { offset?: number; size?: number } = {}
  ): Promise<{ totalSize: number; items: PlexLibraryItem[] }> {
    const uri = `/library/sections/${id}/all?includeGuids=1`;
    const headers = {
      'X-Plex-Container-Start': `${offset}`,
      'X-Plex-Container-Size': `${size}`,
    };

    const response = await this.plexClient.query<PlexLibraryResponse>({
      uri,
      extraHeaders: headers,
    });

    const totalSize = response.MediaContainer.totalSize;

    return {
      totalSize,
      items: response.MediaContainer.Metadata ?? [],
    };
  }

  public async getMetadata(
    key: string,
    options: { includeChildren?: boolean } = {}
  ): Promise<PlexMetadata> {
    const response = await this.plexClient.query<PlexMetadataResponse>(
      `/library/metadata/${key}${
        options.includeChildren ? '?includeChildren=1' : ''
      }`
    );

    return response.MediaContainer.Metadata[0];
  }

  public async getChildrenMetadata(key: string): Promise<PlexMetadata[]> {
    const response = await this.plexClient.query<PlexMetadataResponse>(
      `/library/metadata/${key}/children`
    );

    return response.MediaContainer.Metadata;
  }

  /**
   * Find a specific episode within a show
   * @param showRatingKey - The show's Plex rating key
   * @param seasonNumber - Season number (1-based)
   * @param episodeNumber - Episode number within the season (1-based)
   * @returns The episode's PlexLibraryItem or null if not found
   */
  public async getShowEpisode(
    showRatingKey: string,
    seasonNumber: number,
    episodeNumber: number
  ): Promise<PlexLibraryItem | null> {
    try {
      // First get all seasons for the show
      const seasons = await this.getChildrenMetadata(showRatingKey);

      // Find the specific season
      const season = seasons.find(
        (s) => s.type === 'season' && s.index === seasonNumber
      );

      if (!season) {
        logger.debug(
          `Season ${seasonNumber} not found for show ${showRatingKey}`,
          {
            label: 'PlexAPI',
          }
        );
        return null;
      }

      // Get all episodes for this season
      const episodes = await this.getChildrenMetadata(season.ratingKey);

      // Find the specific episode
      const episode = episodes.find(
        (e) => e.type === 'episode' && e.index === episodeNumber
      );

      if (!episode) {
        logger.debug(
          `Episode ${episodeNumber} not found in season ${seasonNumber} for show ${showRatingKey}`,
          { label: 'PlexAPI' }
        );
        return null;
      }

      return episode as PlexLibraryItem;
    } catch (error) {
      logger.error(
        `Failed to find episode S${seasonNumber}E${episodeNumber} for show ${showRatingKey}`,
        {
          label: 'PlexAPI',
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return null;
    }
  }

  /**
   * Get all episodes from a show
   * @param showRatingKey - The show's Plex rating key
   * @returns Array of all episodes in the show with their metadata including TMDB GUIDs
   */
  public async getAllEpisodesFromShow(
    showRatingKey: string
  ): Promise<PlexLibraryItem[]> {
    try {
      // Get all seasons for the show
      const seasons = await this.getChildrenMetadata(showRatingKey);
      const allEpisodes: PlexLibraryItem[] = [];

      // Get episodes from each season
      for (const season of seasons) {
        if (season.type === 'season') {
          const episodes = await this.getChildrenMetadata(season.ratingKey);

          // For each episode, get full metadata including GUIDs
          for (const episode of episodes.filter(
            (ep) => ep.type === 'episode'
          )) {
            try {
              // Get full episode metadata with GUIDs
              const fullEpisodeMetadata = await this.getMetadata(
                episode.ratingKey
              );
              allEpisodes.push(fullEpisodeMetadata as PlexLibraryItem);
            } catch (error) {
              logger.warn(
                `Failed to get full metadata for episode ${episode.ratingKey}`,
                {
                  label: 'Plex API',
                  error: error instanceof Error ? error.message : String(error),
                }
              );
              // Fallback to basic episode metadata (without GUIDs)
              allEpisodes.push(episode as PlexLibraryItem);
            }
          }
        }
      }

      return allEpisodes;
    } catch (error) {
      logger.warn(`Failed to get episodes for show ${showRatingKey}`, {
        label: 'Plex API',
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  public async getRecentlyAdded(
    id: string,
    options: { addedAt: number } = {
      addedAt: Date.now() - 1000 * 60 * 60,
    },
    mediaType: 'movie' | 'show'
  ): Promise<PlexLibraryItem[]> {
    const response = await this.plexClient.query<PlexLibraryResponse>({
      uri: `/library/sections/${id}/all?type=${
        mediaType === 'show' ? '4' : '1'
      }&sort=addedAt%3Adesc&addedAt>>=${Math.floor(options.addedAt / 1000)}`,
      extraHeaders: {
        'X-Plex-Container-Start': `0`,
        'X-Plex-Container-Size': `500`,
      },
    });

    return response.MediaContainer.Metadata;
  }

  public async getAllCollections(): Promise<PlexCollection[]> {
    logger.debug('Fetching all Plex collections', { label: 'Plex API' });
    const startTime = Date.now();
    const allCollections: PlexCollection[] = [];

    try {
      const libraries = await this.getLibraries();
      logger.debug('Processing collections across libraries', {
        label: 'Plex API',
        libraryCount: libraries.length,
      });

      for (const library of libraries) {
        try {
          const response = await this.plexClient.query<PlexCollectionResponse>({
            uri: `/library/sections/${library.key}/collections`,
            extraHeaders: {
              'X-Plex-Container-Size': `0`,
            },
          });

          const collections = response.MediaContainer?.Metadata || [];

          for (const collection of collections) {
            const detailedCollection = await this.getCollectionMetadata(
              collection.ratingKey
            );
            const labels = detailedCollection?.labels || [];

            const enhancedCollection: PlexCollection = {
              ...collection,
              libraryKey: library.key,
              libraryName: library.title,
              labels,
              titleSort: detailedCollection?.titleSort,
            };

            allCollections.push(enhancedCollection);
          }
        } catch (error) {
          logger.warn(
            `Failed to get collections for library ${library.title}`,
            {
              label: 'Plex API',
              error,
            }
          );
        }
      }
    } catch (error) {
      logger.error('Error getting all collections.', {
        label: 'Plex API',
        error,
      });
    }

    // Collections fetched from Plex
    logger.debug('All collections fetched successfully', {
      label: 'Plex API',
      collectionCount: allCollections.length,
      responseTime: Date.now() - startTime,
    });

    // Return collections in Plex's natural order - don't force addedAt sorting
    return allCollections;
  }

  public async getCollectionMetadata(
    ratingKey: string
  ): Promise<PlexCollectionMetadata | null> {
    try {
      const response = await this.plexClient.query<{
        MediaContainer: { Metadata: PlexCollectionMetadata[] };
      }>(`/library/metadata/${ratingKey}`);

      const collection = response.MediaContainer?.Metadata?.[0];
      if (!collection) {
        // Collection not found - this is different from an API error
        logger.debug(`Collection ${ratingKey} not found`, {
          label: 'Plex API',
        });
        return null;
      }

      const labels = this.parseLabelsFromCollection(collection);

      return {
        ...collection,
        labels,
      };
    } catch (error) {
      logger.error(`Failed to get collection metadata for ${ratingKey}`, {
        label: 'Plex API',
        error,
      });
      // Throw error to distinguish from "collection not found"
      throw new Error(
        `API error getting collection metadata: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  /**
   * Safely get collection metadata with error handling
   * Returns null for both "not found" and "API error" cases, but logs appropriately
   */
  public async getCollectionMetadataSafe(
    ratingKey: string
  ): Promise<PlexCollectionMetadata | null> {
    try {
      return await this.getCollectionMetadata(ratingKey);
    } catch (error) {
      // API error already logged in getCollectionMetadata
      return null;
    }
  }

  private parseLabelsFromCollection(collection: PlexCollection): string[] {
    // Handle multiple possible label structures from Plex API
    if (Array.isArray(collection.Label)) {
      return collection.Label.map((label) => label.tag).filter(
        (tag): tag is string => typeof tag === 'string'
      );
    }

    // Fallback: check if labels are already processed and stored in the labels property
    if (Array.isArray(collection.labels)) {
      return collection.labels;
    }

    return [];
  }

  public async getItemsByRatingKeys(
    ratingKeys: string[]
  ): Promise<PlexCollectionItem[]> {
    if (ratingKeys.length === 0) {
      return [];
    }

    try {
      // Use bulk fetching with comma-separated rating keys (like Python PlexAPI)
      const ratingKeysParam = ratingKeys.join(',');
      const response = await this.plexClient.query(
        `/library/metadata/${ratingKeysParam}`
      );

      const items = response.MediaContainer?.Metadata || [];

      // CRITICAL: Preserve the original order from ratingKeys array
      // Plex returns items in alphabetical order, but we need chronological request order
      const orderedItems: PlexCollectionItem[] = [];
      const missingRatingKeys: string[] = [];

      for (const ratingKey of ratingKeys) {
        const item = items.find(
          (item: PlexCollectionItem) => item.ratingKey === ratingKey
        );
        if (item) {
          orderedItems.push(item);
        } else {
          missingRatingKeys.push(ratingKey);
        }
      }

      if (missingRatingKeys.length > 0) {
        logger.warn(
          `${missingRatingKeys.length}/${ratingKeys.length} items could not be found in Plex library.`,
          {
            label: 'Plex API',
            totalRequested: ratingKeys.length,
            totalFound: items.length,
            missingRatingKeys: missingRatingKeys,
          }
        );
      }

      return orderedItems;
    } catch (error) {
      // If bulk fetch fails, fall back to individual requests
      logger.warn('Bulk fetch failed, falling back to individual requests.', {
        label: 'Plex API',
      });

      const items: PlexCollectionItem[] = [];
      const failedRatingKeys: string[] = [];

      for (const ratingKey of ratingKeys) {
        try {
          const response = await this.plexClient.query(
            `/library/metadata/${ratingKey}`
          );
          if (response.MediaContainer?.Metadata?.[0]) {
            items.push(response.MediaContainer.Metadata[0]);
          } else {
            failedRatingKeys.push(ratingKey);
          }
        } catch {
          failedRatingKeys.push(ratingKey);
        }
      }

      if (failedRatingKeys.length > 0) {
        logger.warn(
          `${failedRatingKeys.length}/${ratingKeys.length} items could not be found in Plex library.`,
          {
            label: 'Plex API',
            totalRequested: ratingKeys.length,
            totalFound: items.length,
            missingRatingKeys: failedRatingKeys,
          }
        );
      }

      return items;
    }
  }

  public async getCollectionByName(
    name: string,
    libraryKey: string
  ): Promise<PlexCollection | null> {
    try {
      const response = await this.plexClient.query<PlexCollectionResponse>({
        uri: `/library/sections/${libraryKey}/collections`,
        extraHeaders: {
          'X-Plex-Container-Size': `0`,
        },
      });
      const collections = response.MediaContainer?.Metadata || [];

      const foundCollection =
        collections.find(
          (collection: PlexCollection) => collection.title === name
        ) || null;

      if (foundCollection) {
        const detailedCollection = await this.getCollectionMetadata(
          foundCollection.ratingKey
        );
        const labels = detailedCollection?.labels || [];

        return {
          ...foundCollection,
          libraryKey,
          labels,
        };
      }

      return null;
    } catch (error) {
      logger.error(`Error getting collection by name "${name}"`, {
        label: 'Plex API',
        error,
      });
      return null;
    }
  }

  public async createEmptyCollection(
    title: string,
    libraryKey: string,
    mediaType: 'movie' | 'tv' = 'movie',
    containsEpisodes = false
  ): Promise<string | null> {
    try {
      // Use correct type parameter: 1 for movies, 2 for TV shows, 4 for episodes
      let typeParam: number;
      if (containsEpisodes) {
        typeParam = 4; // Episode collections
      } else {
        typeParam = mediaType === 'tv' ? 2 : 1; // TV show or movie collections
      }

      const createUrl = `/library/collections?type=${typeParam}&title=${encodeURIComponent(
        title
      )}&smart=0&sectionId=${libraryKey}`;

      const result = await this.safePostQuery(createUrl);

      let collectionRatingKey: string | null = null;
      if (result && typeof result === 'object' && 'MediaContainer' in result) {
        const resultObj = result as {
          MediaContainer?: { Metadata?: PlexCollection[] };
        };
        if (resultObj.MediaContainer?.Metadata?.[0]) {
          collectionRatingKey = resultObj.MediaContainer.Metadata[0].ratingKey;
        }
      }

      return collectionRatingKey;
    } catch (error) {
      logger.error(`Error creating collection "${title}"`, {
        label: 'Plex API',
        title,
        libraryKey,
        mediaType,
        typeParam: mediaType === 'tv' ? 2 : 1,
        createUrl: `/library/collections?type=${
          mediaType === 'tv' ? 2 : 1
        }&title=${encodeURIComponent(title)}&smart=0&sectionId=${libraryKey}`,
        error:
          error instanceof Error
            ? {
                message: error.message,
                stack: error.stack,
                name: error.name,
              }
            : error,
      });
      return null;
    }
  }

  public async addItemsToCollection(
    collectionRatingKey: string,
    items: PlexCollectionItem[]
  ): Promise<void> {
    if (items.length === 0) {
      return;
    }

    const machineId = getSettings().plex.machineId;

    // Check if any items are episodes by querying their metadata
    let hasEpisodes = false;
    if (items.length <= 5) {
      // Only check first few items for performance
      try {
        const itemChecks = await Promise.all(
          items.slice(0, 3).map(async (item) => {
            try {
              const response = await this.plexClient.query(
                `/library/metadata/${item.ratingKey}`
              );
              const metadata = response.MediaContainer?.Metadata?.[0];
              return metadata?.type === 'episode';
            } catch {
              return false;
            }
          })
        );
        hasEpisodes = itemChecks.some((isEpisode) => isEpisode);
      } catch {
        // If we can't check, assume no episodes
        hasEpisodes = false;
      }
    }

    try {
      // Use bulk addition with comma-separated rating keys
      const ratingKeys = items.map((item) => item.ratingKey).join(',');
      const uriParam = `server://${machineId}/com.plexapp.plugins.library/library/metadata/${ratingKeys}`;
      let addUrl = `/library/collections/${collectionRatingKey}/items?uri=${encodeURIComponent(
        uriParam
      )}`;

      // Add type=4 parameter for episode collections
      if (hasEpisodes) {
        addUrl += '&type=4';
      }

      await this.safePutQuery(addUrl);
    } catch (error) {
      // If bulk addition fails, fall back to individual addition
      logger.warn(
        'Bulk item addition failed, falling back to individual addition.',
        {
          label: 'Plex API',
          collectionRatingKey,
        }
      );

      for (const item of items) {
        try {
          const uriParam = `server://${machineId}/com.plexapp.plugins.library/library/metadata/${item.ratingKey}`;
          let addUrl = `/library/collections/${collectionRatingKey}/items?uri=${encodeURIComponent(
            uriParam
          )}`;

          // Add type=4 parameter for episode collections (reuse the hasEpisodes check from above)
          if (hasEpisodes) {
            addUrl += '&type=4';
          }

          await this.safePutQuery(addUrl);
        } catch (itemError) {
          const errorMessage =
            itemError instanceof Error ? itemError.message : 'Unknown error';
          logger.warn(
            `Failed to add item "${item.title || 'Unknown'}" to collection.`,
            {
              label: 'Plex API',
              itemRatingKey: item.ratingKey,
              collectionRatingKey,
              error: errorMessage,
            }
          );
        }
      }
    }
  }

  /**
   * Get items in a collection
   */
  public async getCollectionItems(
    collectionRatingKey: string
  ): Promise<string[]> {
    try {
      const response = await this.plexClient.query({
        uri: `/library/collections/${collectionRatingKey}/children`,
        extraHeaders: {
          'X-Plex-Container-Size': `0`,
        },
      });
      const items = response.MediaContainer?.Metadata || [];
      return items.map((item: PlexCollectionItem) => item.ratingKey);
    } catch (error) {
      logger.error(
        `Error getting items from collection ${collectionRatingKey}`,
        {
          label: 'Plex API',
          error,
        }
      );
      return [];
    }
  }

  public async removeItemsFromCollection(
    collectionRatingKey: string
  ): Promise<void> {
    try {
      const response = await this.plexClient.query({
        uri: `/library/collections/${collectionRatingKey}/children`,
        extraHeaders: {
          'X-Plex-Container-Size': `0`,
        },
      });
      const items = response.MediaContainer?.Metadata || [];

      if (items.length === 0) {
        return;
      }

      for (const item of items) {
        const removeUrl = `/library/collections/${collectionRatingKey}/items/${item.ratingKey}`;

        try {
          await this.safeDeleteQuery(removeUrl);
        } catch (error) {
          const errorMessage = (error as Error).message;
          if (!errorMessage.includes('404')) {
            logger.warn(
              `Failed to remove item ${item.ratingKey} from collection`,
              {
                label: 'Plex API',
                error: errorMessage,
              }
            );
          }
        }
      }
    } catch (error) {
      logger.error(
        `Error removing items from collection ${collectionRatingKey}`,
        {
          label: 'Plex API',
          error,
        }
      );
      throw error;
    }
  }

  public async addLabelToCollection(
    collectionRatingKey: string,
    label: string
  ): Promise<boolean> {
    return this.addLabelToCollectionWithRetry(collectionRatingKey, label, 3);
  }

  /**
   * Add label to collection with retry logic and verification
   */
  private async addLabelToCollectionWithRetry(
    collectionRatingKey: string,
    label: string,
    maxRetries: number
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Get current collection metadata to preserve existing labels
        // Use strict version to distinguish API errors from "not found"
        const collectionMeta = await this.getCollectionMetadata(
          collectionRatingKey
        );
        if (!collectionMeta) {
          throw new Error(`Collection ${collectionRatingKey} not found`);
        }

        // Clean existing Agregarr labels while preserving user's custom labels
        const { cleanAgregarrCollectionLabels } = await import(
          '@server/lib/collections/core/CollectionUtilities'
        );
        const existingLabels = collectionMeta.labels || [];
        const preservedLabels = cleanAgregarrCollectionLabels(existingLabels);

        // Check if label already exists (case-insensitive comparison since Plex auto-formats labels)
        const labelExistsIndex = existingLabels.findIndex(
          (existingLabel) => existingLabel.toLowerCase() === label.toLowerCase()
        );
        if (labelExistsIndex !== -1) {
          return true;
        }

        // Combine preserved labels with new Agregarr label
        const allLabels = [...preservedLabels, label];

        // Build params with all labels to preserve existing ones
        const params: Record<string, string | number> = {
          'label.locked': 1,
        };

        // Add each label as a separate parameter
        allLabels.forEach((labelTag, index) => {
          params[`label[${index}].tag.tag`] = labelTag;
        });

        const queryString = Object.entries(params)
          .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
          .join('&');

        const editUrl = `/library/metadata/${collectionRatingKey}?${queryString}`;

        await this.safePutQuery(editUrl);

        // Verify the label was actually added (with a small delay for Plex API)
        await new Promise((resolve) => setTimeout(resolve, 500)); // Allow Plex time to index the label
        const updatedMeta = await this.getCollectionMetadata(
          collectionRatingKey
        );

        if (
          !updatedMeta ||
          !updatedMeta.labels?.some(
            (existingLabel) =>
              existingLabel.toLowerCase() === label.toLowerCase()
          )
        ) {
          // Don't fail immediately - Plex might need more time to index labels
          logger.warn(
            `Label verification delayed for collection ${collectionRatingKey} - label "${label}" not immediately visible`,
            {
              label: 'Plex API',
              foundLabels: updatedMeta?.labels || [],
              expectedLabel: label,
            }
          );

          // Give Plex more time and try once more
          await new Promise((resolve) => setTimeout(resolve, 1500));
          const finalMeta = await this.getCollectionMetadata(
            collectionRatingKey
          );

          if (
            !finalMeta ||
            !finalMeta.labels?.some(
              (existingLabel) =>
                existingLabel.toLowerCase() === label.toLowerCase()
            )
          ) {
            throw new Error(
              `Label verification failed - label "${label}" not found on collection after multiple attempts. Found labels: ${JSON.stringify(
                finalMeta?.labels || []
              )}`
            );
          }
        }

        return true;
      } catch (error) {
        logger.warn(
          `Attempt ${attempt}/${maxRetries} failed to add label "${label}" to collection ${collectionRatingKey}`,
          {
            label: 'Plex API',
            error: error instanceof Error ? error.message : 'Unknown error',
            attempt,
            maxRetries,
          }
        );

        if (attempt === maxRetries) {
          logger.error(
            `Failed to add label "${label}" to collection ${collectionRatingKey} after ${maxRetries} attempts`,
            {
              label: 'Plex API',
              error,
            }
          );
          return false;
        }

        // Wait before retrying (exponential backoff)
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
    return false;
  }

  public async updateCollectionTitle(
    collectionRatingKey: string,
    title: string
  ): Promise<void> {
    try {
      const params = {
        'title.value': title,
      };

      const queryString = Object.entries(params)
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
        .join('&');

      const editUrl = `/library/metadata/${collectionRatingKey}?${queryString}`;

      await this.safePutQuery(editUrl);
    } catch (error) {
      logger.error(
        `Error updating title for collection ${collectionRatingKey}`,
        {
          label: 'Plex API',
          error,
        }
      );
    }
  }

  public async updateCollectionSortTitle(
    collectionRatingKey: string,
    sortTitle: string
  ): Promise<void> {
    try {
      const params = {
        type: 18,
        id: collectionRatingKey,
        'titleSort.value': sortTitle,
        'titleSort.locked': 1,
      };

      const queryString = Object.entries(params)
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
        .join('&');

      const editUrl = `/library/metadata/${collectionRatingKey}?${queryString}`;

      await this.safePutQuery(editUrl);
    } catch (error) {
      logger.error(
        `Error updating sort title for collection ${collectionRatingKey}`,
        {
          label: 'Plex API',
          error,
        }
      );
    }
  }

  public async updateCollectionContentSort(
    collectionRatingKey: string,
    sortType: 'release' | 'alpha' | 'custom' = 'custom'
  ): Promise<void> {
    try {
      // Map sort types to Plex integer values (from Python PlexAPI reverse engineering)
      const sortValues = {
        release: 0, // Order by release dates
        alpha: 1, // Order alphabetically
        custom: 2, // Custom collection order (preserves add order)
      };

      // Use the correct endpoint discovered from Python PlexAPI debug output:
      // PUT /library/collections/{ratingKey}/prefs?collectionSort=2
      const editUrl = `/library/collections/${collectionRatingKey}/prefs?collectionSort=${sortValues[sortType]}`;

      await this.safePutQuery(editUrl);
    } catch (error) {
      logger.error(
        `Error updating content sort for collection ${collectionRatingKey}`,
        {
          label: 'Plex API',
          error,
        }
      );
      throw error;
    }
  }

  public async moveItemInCollection(
    collectionRatingKey: string,
    itemRatingKey: string,
    afterItemRatingKey: string
  ): Promise<boolean> {
    try {
      // Use the exact API endpoint discovered from Python PlexAPI debug output:
      // PUT /library/collections/{collectionRatingKey}/items/{itemRatingKey}/move?after={afterItemRatingKey}
      const moveUrl = `/library/collections/${collectionRatingKey}/items/${itemRatingKey}/move?after=${afterItemRatingKey}`;

      await this.safePutQuery(moveUrl);
      return true;
    } catch (error) {
      // Silently fail - this is not critical for functionality
      return false;
    }
  }

  public async arrangeCollectionItemsInOrder(
    collectionRatingKey: string,
    orderedItems: PlexCollectionItem[]
  ): Promise<void> {
    if (orderedItems.length <= 1) {
      return; // No need to arrange single item or empty collections
    }

    let failCount = 0;

    // Move each item to its correct position (skip the first item as it's already in position)
    // Items are ordered newest first, so we position each subsequent item after the previous one
    for (let i = 1; i < orderedItems.length; i++) {
      const currentItem = orderedItems[i];
      const previousItem = orderedItems[i - 1];

      const success = await this.moveItemInCollection(
        collectionRatingKey,
        currentItem.ratingKey,
        previousItem.ratingKey
      );

      if (!success) {
        failCount++;
      }
    }

    if (failCount > 0) {
      logger.warn(
        `Failed to arrange ${failCount} items in collection ${collectionRatingKey}`,
        {
          label: 'Plex API',
        }
      );
    }
  }

  public async updateCollectionVisibility(
    collectionRatingKey: string,
    recommended: boolean,
    home: boolean,
    shared: boolean
  ): Promise<void> {
    try {
      // Get collection metadata to determine library section
      const collectionMeta = await this.plexClient.query(
        `/library/metadata/${collectionRatingKey}`
      );
      const librarySectionID =
        collectionMeta.MediaContainer?.Metadata?.[0]?.librarySectionID;

      if (!librarySectionID) {
        throw new Error(
          `Could not determine library section ID for collection ${collectionRatingKey}`
        );
      }

      // Initialize hub for collection visibility management
      const hubInitUrl = `/hubs/sections/${librarySectionID}/manage?metadataItemId=${collectionRatingKey}`;
      await this.safePostQuery(hubInitUrl);

      // Update visibility settings
      const hubIdentifier = `custom.collection.${librarySectionID}.${collectionRatingKey}`;
      const params = new URLSearchParams({
        promotedToRecommended: recommended ? '1' : '0',
        promotedToOwnHome: home ? '1' : '0',
        promotedToSharedHome: shared ? '1' : '0',
      });

      const putUrl = `/hubs/sections/${librarySectionID}/manage/${hubIdentifier}?${params.toString()}`;
      await this.safePutQuery(putUrl);
    } catch (error) {
      logger.error(
        `Error updating visibility for collection ${collectionRatingKey}`,
        {
          label: 'Plex API',
          error: error instanceof Error ? error.message : String(error),
          collectionRatingKey,
          recommended,
          home,
          shared,
        }
      );
    }
  }

  // POSTER MANAGEMENT METHODS - Based on python-plexapi implementation

  /**
   * Get all available posters for a Plex item
   * @param ratingKey The rating key of the item (collection, movie, show, etc.)
   * @returns Array of available poster objects
   */
  public async getAvailablePosters(ratingKey: string): Promise<unknown[]> {
    try {
      const response = await this.plexClient.query(
        `/library/metadata/${ratingKey}/posters`
      );

      return response.MediaContainer?.Metadata || [];
    } catch (error) {
      logger.error(`Error getting available posters for ${ratingKey}`, {
        label: 'Plex API',
        error: error instanceof Error ? error.message : String(error),
        ratingKey,
      });
      return [];
    }
  }

  /**
   * Upload a poster from a URL
   * @param ratingKey The rating key of the item
   * @param url The URL of the image to upload
   */
  public async uploadPosterFromUrl(
    ratingKey: string,
    url: string
  ): Promise<void> {
    try {
      const key = `/library/metadata/${ratingKey}/posters?url=${encodeURIComponent(
        url
      )}`;
      await this.safePostQuery(key);

      logger.info(`Successfully uploaded poster from URL for ${ratingKey}`, {
        label: 'Plex API',
        ratingKey,
        url,
      });
    } catch (error) {
      logger.error(`Error uploading poster from URL for ${ratingKey}`, {
        label: 'Plex API',
        error: error instanceof Error ? error.message : String(error),
        ratingKey,
        url,
      });
      throw error;
    }
  }

  /**
   * Upload a poster from a local file path
   * @param ratingKey The rating key of the item
   * @param filepath The local file path to upload
   */
  public async uploadPosterFromFile(
    ratingKey: string,
    filepath: string
  ): Promise<void> {
    try {
      const fs = await import('fs');

      // Read the file data
      const fileData = await fs.promises.readFile(filepath);
      const key = `/library/metadata/${ratingKey}/posters`;

      // Make POST request with file data
      const client = this.getExtendedClient();
      if (typeof client.postQuery !== 'function') {
        throw new Error(
          'POST operations are not supported by this Plex API version'
        );
      }

      // Use axios directly for file upload since plex-api may not handle binary data properly
      const axios = await import('axios');
      const settings = getSettings();
      const baseUrl = `${settings.plex.useSsl ? 'https' : 'http'}://${
        settings.plex.ip
      }:${settings.plex.port}`;

      await axios.default.post(`${baseUrl}${key}`, fileData, {
        headers: {
          'X-Plex-Token': this.plexToken,
          'Content-Type': 'application/octet-stream',
        },
        timeout: 30000,
      });

      logger.info(`Successfully uploaded poster from file for ${ratingKey}`, {
        label: 'Plex API',
        ratingKey,
        filepath,
      });
    } catch (error) {
      logger.error(`Error uploading poster from file for ${ratingKey}`, {
        label: 'Plex API',
        error: error instanceof Error ? error.message : String(error),
        ratingKey,
        filepath,
      });
      throw error;
    }
  }

  /**
   * Select an existing poster for an item
   * @param ratingKey The rating key of the item
   * @param posterRatingKey The rating key of the poster to select
   */
  public async selectPoster(
    ratingKey: string,
    posterRatingKey: string
  ): Promise<void> {
    try {
      const key = `/library/metadata/${ratingKey}/posters?url=${encodeURIComponent(
        posterRatingKey
      )}`;
      await this.safePutQuery(key);

      logger.info(`Successfully selected poster for ${ratingKey}`, {
        label: 'Plex API',
        ratingKey,
        posterRatingKey,
      });
    } catch (error) {
      logger.error(`Error selecting poster for ${ratingKey}`, {
        label: 'Plex API',
        error: error instanceof Error ? error.message : String(error),
        ratingKey,
        posterRatingKey,
      });
      throw error;
    }
  }

  /**
   * Lock the poster for an item (prevents auto-updates)
   * @param ratingKey The rating key of the item
   */
  public async lockPoster(ratingKey: string): Promise<void> {
    try {
      const params = { 'thumb.locked': '1' };
      const queryString = Object.entries(params)
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
        .join('&');

      const editUrl = `/library/metadata/${ratingKey}?${queryString}`;
      await this.safePutQuery(editUrl);

      logger.info(`Successfully locked poster for ${ratingKey}`, {
        label: 'Plex API',
        ratingKey,
      });
    } catch (error) {
      logger.error(`Error locking poster for ${ratingKey}`, {
        label: 'Plex API',
        error: error instanceof Error ? error.message : String(error),
        ratingKey,
      });
      throw error;
    }
  }

  /**
   * Unlock the poster for an item (allows auto-updates)
   * @param ratingKey The rating key of the item
   */
  public async unlockPoster(ratingKey: string): Promise<void> {
    try {
      const params = { 'thumb.locked': '0' };
      const queryString = Object.entries(params)
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
        .join('&');

      const editUrl = `/library/metadata/${ratingKey}?${queryString}`;
      await this.safePutQuery(editUrl);

      logger.info(`Successfully unlocked poster for ${ratingKey}`, {
        label: 'Plex API',
        ratingKey,
      });
    } catch (error) {
      logger.error(`Error unlocking poster for ${ratingKey}`, {
        label: 'Plex API',
        error: error instanceof Error ? error.message : String(error),
        ratingKey,
      });
      throw error;
    }
  }

  /**
   * Get current poster URL for a Plex item
   * @param ratingKey The rating key of the item
   * @returns The current poster URL or null if none
   */
  public async getCurrentPosterUrl(ratingKey: string): Promise<string | null> {
    try {
      const response = await this.plexClient.query(
        `/library/metadata/${ratingKey}`
      );

      const item = response?.MediaContainer?.Metadata?.[0];
      if (!item?.thumb) {
        return null;
      }

      // Convert relative thumb path to full URL
      const settings = getSettings();
      const baseUrl = `${settings.plex.useSsl ? 'https' : 'http'}://${
        settings.plex.ip
      }:${settings.plex.port}`;

      // Handle both relative paths and full URLs
      if (item.thumb.startsWith('http')) {
        return item.thumb;
      } else {
        return `${baseUrl}${item.thumb}?X-Plex-Token=${this.plexToken}`;
      }
    } catch (error) {
      logger.error(`Error getting current poster for ${ratingKey}`, {
        label: 'Plex API',
        error: error instanceof Error ? error.message : String(error),
        ratingKey,
      });
      return null;
    }
  }

  /**
   * Combined method for uploading and setting a poster (backwards compatibility)
   * @param collectionRatingKey The rating key of the collection
   * @param posterPath The local file path to upload
   */
  public async updateCollectionPoster(
    collectionRatingKey: string,
    posterPath: string
  ): Promise<void> {
    await this.uploadPosterFromFile(collectionRatingKey, posterPath);

    // Lock the poster to prevent Plex from overriding it
    await this.lockPoster(collectionRatingKey);
  }

  /**
   * Remove specific items from a collection (incremental update)
   */
  public async removeSpecificItemsFromCollection(
    collectionRatingKey: string,
    itemsToRemove: string[]
  ): Promise<{ successful: number; failed: number }> {
    let successful = 0;
    let failed = 0;

    for (const ratingKey of itemsToRemove) {
      const removeUrl = `/library/collections/${collectionRatingKey}/items/${ratingKey}`;

      try {
        await this.safeDeleteQuery(removeUrl);
        successful++;
      } catch (error) {
        failed++;
        const errorMessage = (error as Error).message;
        if (!errorMessage.includes('404')) {
          logger.warn(
            `Failed to remove item ${ratingKey} from collection ${collectionRatingKey}`,
            {
              label: 'Plex API',
              error: errorMessage,
            }
          );
        }
      }
    }

    return { successful, failed };
  }

  /**
   * Incrementally update collection contents (preserve collection, update items only)
   * This replaces the delete/recreate approach with smart add/remove/reorder
   */
  public async updateCollectionContents(
    collectionRatingKey: string,
    desiredItems: PlexCollectionItem[]
  ): Promise<{
    added: number;
    removed: number;
    reordered: boolean;
    errors: string[];
  }> {
    const errors: string[] = [];
    let added = 0;
    let removed = 0;
    let reordered = false;

    try {
      // Get current collection contents (returns array of rating keys)
      const currentRatingKeys = await this.getCollectionItems(
        collectionRatingKey
      );
      const currentRatingKeysSet = new Set(currentRatingKeys);
      const desiredRatingKeysSet = new Set(
        desiredItems.map((item) => item.ratingKey)
      );

      // Calculate what needs to be added and removed
      const toAdd = desiredItems.filter(
        (item) => !currentRatingKeysSet.has(item.ratingKey)
      );
      const toRemoveKeys = currentRatingKeys.filter(
        (ratingKey) => !desiredRatingKeysSet.has(ratingKey)
      );

      // Remove items that shouldn't be in the collection
      if (toRemoveKeys.length > 0) {
        const removeResult = await this.removeSpecificItemsFromCollection(
          collectionRatingKey,
          toRemoveKeys
        );
        removed = removeResult.successful;
        if (removeResult.failed > 0) {
          errors.push(`Failed to remove ${removeResult.failed} items`);
        }
      }

      // Add new items to the collection
      if (toAdd.length > 0) {
        const addResult = await this.addSpecificItemsToCollection(
          collectionRatingKey,
          toAdd.map((item) => item.ratingKey)
        );
        added = addResult.successful;
        if (addResult.failed > 0) {
          errors.push(`Failed to add ${addResult.failed} items`);
        }
      }

      // Always reorder items to match desired order for consistency
      if (desiredItems.length > 0) {
        try {
          await this.arrangeCollectionItemsInOrder(
            collectionRatingKey,
            desiredItems
          );
          reordered = true;
        } catch (error) {
          errors.push(
            `Failed to reorder collection: ${(error as Error).message}`
          );
        }
      }

      return { added, removed, reordered, errors };
    } catch (error) {
      errors.push(`Collection update failed: ${(error as Error).message}`);
      return { added: 0, removed: 0, reordered: false, errors };
    }
  }

  /**
   * Add specific items to a collection (incremental update)
   */
  public async addSpecificItemsToCollection(
    collectionRatingKey: string,
    itemsToAdd: string[]
  ): Promise<{ successful: number; failed: number }> {
    let successful = 0;
    let failed = 0;

    // Validate all items exist before attempting to add them
    const validItems = await this.getItemsByRatingKeys(itemsToAdd);
    const validRatingKeys = validItems.map((item) => item.ratingKey);

    if (validRatingKeys.length === 0) {
      logger.warn(
        `No valid items to add to collection ${collectionRatingKey}`,
        {
          label: 'Plex API',
          requestedItems: itemsToAdd.length,
        }
      );
      return { successful: 0, failed: itemsToAdd.length };
    }

    // Check which items are already in the collection to avoid duplicate additions
    const currentItems = await this.getCollectionItems(collectionRatingKey);
    const currentItemsSet = new Set(currentItems);
    const itemsToActuallyAdd = validRatingKeys.filter(
      (key) => !currentItemsSet.has(key)
    );

    // Check what type of items these are and which library they belong to
    const itemTypes = await Promise.all(
      itemsToActuallyAdd.slice(0, 4).map(async (ratingKey) => {
        try {
          const response = await this.plexClient.query(
            `/library/metadata/${ratingKey}`
          );
          const item = response.MediaContainer?.Metadata?.[0];
          return {
            ratingKey,
            type: item?.type,
            title: item?.title,
            librarySectionID: item?.librarySectionID,
          };
        } catch {
          return {
            ratingKey,
            type: 'unknown',
            title: 'unknown',
            librarySectionID: 'unknown',
          };
        }
      })
    );

    // Also get the collection's library info
    let collectionLibrary = 'unknown';
    try {
      const collResponse = await this.plexClient.query(
        `/library/collections/${collectionRatingKey}`
      );
      collectionLibrary =
        collResponse.MediaContainer?.Metadata?.[0]?.librarySectionID ||
        'unknown';
    } catch (error) {
      logger.warn(
        `Failed to get collection library info for ${collectionRatingKey}`,
        {
          label: 'Plex API',
          error: error instanceof Error ? error.message : error,
        }
      );
    }

    const itemLibraries = [
      ...new Set(itemTypes.map((item) => item.librarySectionID)),
    ];
    const libraryMismatch =
      itemLibraries.length > 0 &&
      collectionLibrary !== 'unknown' &&
      !itemLibraries.includes(Number(collectionLibrary));

    if (libraryMismatch) {
      logger.error(
        `LIBRARY MISMATCH DETECTED: Collection ${collectionRatingKey} is in library ${collectionLibrary} but items are in libraries [${itemLibraries.join(
          ','
        )}]`,
        {
          label: 'Plex API',
          collectionLibrary,
          itemLibraries,
          collectionRatingKey,
        }
      );
    }

    logger.debug(`Collection ${collectionRatingKey} item analysis`, {
      label: 'Plex API',
      requestedItems: itemsToAdd.length,
      validItems: validRatingKeys.length,
      currentItems: currentItems.length,
      itemsToAdd: itemsToActuallyAdd.length,
      newItems: itemsToActuallyAdd,
      itemTypes: itemTypes,
      collectionLibrary: collectionLibrary,
    });

    if (itemsToActuallyAdd.length === 0) {
      logger.info(`All items already in collection ${collectionRatingKey}`, {
        label: 'Plex API',
        requestedItems: itemsToAdd.length,
        validItems: validRatingKeys.length,
      });
      return {
        successful: validRatingKeys.length,
        failed: itemsToAdd.length - validRatingKeys.length,
      };
    }

    // Add all items at once - no need for batching
    const machineId = getSettings().plex.machineId;
    const uri = `server://${machineId}/com.plexapp.plugins.library/library/metadata/${itemsToActuallyAdd.join(
      ','
    )}`;
    const addUrl = `/library/collections/${collectionRatingKey}/items?uri=${encodeURIComponent(
      uri
    )}`;

    // Check if we're adding episodes - if so, we might need special handling
    const hasEpisodes = itemTypes.some((item) => item.type === 'episode');

    try {
      if (hasEpisodes) {
        // For episodes, try adding the type=4 parameter
        const episodeAddUrl = `${addUrl}&type=4`;
        await this.safePutQuery(episodeAddUrl);
      } else {
        await this.safePutQuery(addUrl);
      }
      successful = itemsToActuallyAdd.length;
    } catch (error) {
      failed = itemsToActuallyAdd.length;
      logger.error(
        `Error adding ${itemsToActuallyAdd.length} items to collection ${collectionRatingKey}`,
        {
          label: 'Plex API',
          error: error instanceof Error ? error.message : error,
          itemCount: itemsToActuallyAdd.length,
          uri: uri.length > 200 ? uri.substring(0, 200) + '...' : uri,
        }
      );
    }

    // Account for items that were filtered out or already in collection
    const alreadyInCollection =
      validRatingKeys.length - itemsToActuallyAdd.length;
    const invalidItems = itemsToAdd.length - validRatingKeys.length;
    return {
      successful: successful + alreadyInCollection,
      failed: failed + invalidItems,
    };
  }

  public async deleteCollection(collectionRatingKey: string): Promise<void> {
    try {
      await this.safeDeleteQuery(`/library/collections/${collectionRatingKey}`);
    } catch (error) {
      logger.error(`Error deleting collection ${collectionRatingKey}.`, {
        label: 'Plex API',
        error,
      });
      throw error;
    }
  }

  // HUB MANAGEMENT METHODS

  /**
   * Get all hubs for a specific library section
   * Returns both built-in hubs (Recently Added, etc.) and custom collections
   */
  public async getLibraryHubs(sectionId: string): Promise<unknown> {
    try {
      const response = await this.plexClient.query(
        `/hubs/sections/${sectionId}`
      );
      return response;
    } catch (error) {
      logger.error(`Error fetching hubs for library section ${sectionId}`, {
        label: 'Plex API',
        error: error instanceof Error ? error.message : String(error),
        sectionId,
      });
      throw error;
    }
  }

  /**
   * Get hub management interface for a library section
   * This endpoint provides the drag-and-drop hub ordering interface
   */
  public async getHubManagement(
    sectionId: string
  ): Promise<PlexHubManagementResponse> {
    logger.debug('Fetching hub management interface', {
      label: 'Plex API',
      sectionId,
    });
    const startTime = Date.now();

    try {
      const response = await this.plexClient.query(
        `/hubs/sections/${sectionId}/manage`
      );

      const hubCount =
        (response as PlexHubManagementResponse)?.MediaContainer?.Hub?.length ||
        0;
      logger.debug('Hub management interface fetched successfully', {
        label: 'Plex API',
        sectionId,
        hubCount,
        responseTime: Date.now() - startTime,
      });

      return response as PlexHubManagementResponse;
    } catch (error) {
      logger.error(
        `Error fetching hub management for library section ${sectionId}`,
        {
          label: 'Plex API',
          error: error instanceof Error ? error.message : String(error),
          sectionId,
          responseTime: Date.now() - startTime,
        }
      );
      throw error;
    }
  }

  /**
   * Move a hub to a new position in the library home screen
   * @param sectionId Library section ID
   * @param hubId Hub identifier (e.g., 'movie.recentlyadded', collection rating key)
   * @param afterHubId Hub to move this hub after (null for first position)
   */
  public async moveHub(
    sectionId: string,
    hubId: string,
    afterHubId?: string
  ): Promise<void> {
    try {
      const url = afterHubId
        ? `/hubs/sections/${sectionId}/manage/${hubId}/move?after=${afterHubId}`
        : `/hubs/sections/${sectionId}/manage/${hubId}/move`;

      await this.safePutQuery(url);
    } catch (error) {
      logger.error(
        `Error moving hub ${hubId} in library section ${sectionId}`,
        {
          label: 'Plex API',
          error: error instanceof Error ? error.message : String(error),
          sectionId,
          hubId,
          afterHubId,
        }
      );
      throw error;
    }
  }

  /**
   * Update hub visibility settings
   * @param sectionId Library section ID
   * @param hubId Hub identifier
   * @param visibility Hub visibility configuration
   */
  /**
   * Get current collection visibility settings
   */
  public async getCollectionVisibility(
    collectionRatingKey: string
  ): Promise<unknown> {
    try {
      const response = await this.plexClient.query(
        `/library/collections/${collectionRatingKey}`
      );

      // Extract visibility info from collection metadata
      const collection = response.MediaContainer?.Metadata?.[0];
      if (!collection) {
        return {};
      }

      // Return basic visibility structure - this is simplified since getting exact
      // visibility settings from Plex is complex and not critical for update logic
      return {
        isVisible: collection.visible !== false,
        // Add more visibility fields if needed
      };
    } catch (error) {
      logger.warn(
        `Failed to get collection visibility for ${collectionRatingKey}`,
        {
          label: 'Plex API',
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return {};
    }
  }

  public async updateHubVisibility(
    sectionId: string,
    hubId: string,
    visibility: {
      promotedToRecommended?: boolean;
      promotedToOwnHome?: boolean;
      promotedToSharedHome?: boolean;
    }
  ): Promise<void> {
    try {
      const params = new URLSearchParams();

      if (visibility.promotedToRecommended !== undefined) {
        params.append(
          'promotedToRecommended',
          visibility.promotedToRecommended ? '1' : '0'
        );
      }
      if (visibility.promotedToOwnHome !== undefined) {
        params.append(
          'promotedToOwnHome',
          visibility.promotedToOwnHome ? '1' : '0'
        );
      }
      if (visibility.promotedToSharedHome !== undefined) {
        params.append(
          'promotedToSharedHome',
          visibility.promotedToSharedHome ? '1' : '0'
        );
      }

      const url = `/hubs/sections/${sectionId}/manage/${hubId}?${params.toString()}`;
      await this.safePutQuery(url);

      // Hub visibility updated successfully - reduced logging
    } catch (error) {
      logger.error(
        `Error updating hub visibility for ${hubId} in library section ${sectionId}`,
        {
          label: 'Plex API',
          error: error instanceof Error ? error.message : String(error),
          sectionId,
          hubId,
          visibility,
        }
      );
      throw error;
    }
  }

  /**
   * Get all available hubs across all library sections
   * Useful for getting a complete overview of the Plex home screen
   */
  public async getAllLibraryHubs(): Promise<{ [sectionId: string]: unknown }> {
    try {
      const libraries = await this.getLibraries();
      const allHubs: { [sectionId: string]: unknown } = {};

      for (const library of libraries) {
        try {
          allHubs[library.key] = await this.getLibraryHubs(library.key);
        } catch (error) {
          logger.warn(
            `Failed to fetch hubs for library ${library.title} (${library.key})`,
            {
              label: 'Plex API',
              error: error instanceof Error ? error.message : String(error),
              libraryKey: library.key,
              libraryTitle: library.title,
            }
          );
          // Continue with other libraries even if one fails
        }
      }

      return allHubs;
    } catch (error) {
      logger.error('Error fetching all library hubs', {
        label: 'Plex API',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Reorder multiple hubs in a library section
   * @param sectionId Library section ID
   * @param hubOrder Array of hub IDs in desired order
   * @param positionedItemsCount Optional count of positioned items
   * @param libraryType Type of library (movie or show) for anchor positioning
   * @param syncCounter Optional sync counter for alternating positioning methods (prevents precision convergence)
   */
  public async reorderHubs(
    sectionId: string,
    desiredOrder: string[],
    positionedItemsCount?: number,
    libraryType?: 'movie' | 'show',
    syncCounter?: number
  ): Promise<void> {
    // Declare outside try block for error logging
    let completeDesiredOrder = desiredOrder;

    try {
      if (desiredOrder.length <= 1) {
        return;
      }

      // Get current hub order from Plex
      const hubManagement = await this.getHubManagement(sectionId);
      const currentHubs = hubManagement.MediaContainer.Hub;
      const currentOrder = currentHubs.map(
        (h: { identifier: string }) => h.identifier
      );

      // Create complete desired order: our managed items first, then all unmanaged items at bottom
      const managedItemsSet = new Set(desiredOrder);
      const unmanagedItems = currentOrder.filter(
        (id) => !managedItemsSet.has(id)
      );
      completeDesiredOrder = [...desiredOrder, ...unmanagedItems];

      // Only proceed if orders are actually different
      if (
        JSON.stringify(currentOrder) === JSON.stringify(completeDesiredOrder)
      ) {
        return;
      }

      logger.debug(
        `Complete ordering includes ${completeDesiredOrder.length} items (${desiredOrder.length} managed, ${unmanagedItems.length} unmanaged)`,
        {
          label: 'Plex API',
          sectionId,
          managedItems: desiredOrder.length,
          unmanagedItems: unmanagedItems.length,
          completeOrder: completeDesiredOrder,
        }
      );

      // Smart selective reordering: only move items that are in wrong positions
      logger.debug(
        `Using selective reordering approach for sync ${
          syncCounter || 'manual'
        }`,
        {
          label: 'Plex API',
          sectionId,
          method: 'selective',
          syncCounter: syncCounter || 'manual',
          currentOrder: currentOrder.slice(0, 5), // First 5 items for debugging
          desiredOrder: completeDesiredOrder.slice(0, 5),
        }
      );

      let moveCount = 0;

      // Check if first item needs to be moved (use anchor positioning)
      if (currentOrder[0] !== completeDesiredOrder[0]) {
        // Determine anchor for positioning first item
        let requiredAnchor: string | null = null;
        if (libraryType === 'show') {
          requiredAnchor = 'tv.ondeck';
        } else if (libraryType === 'movie') {
          requiredAnchor = 'movie.inprogress';
        }

        if (requiredAnchor) {
          try {
            logger.debug(
              `Moving first item ${completeDesiredOrder[0]} after anchor ${requiredAnchor}`,
              {
                label: 'Plex API',
                sectionId,
                hubId: completeDesiredOrder[0],
                afterHubId: requiredAnchor,
              }
            );
            await this.moveHub(
              sectionId,
              completeDesiredOrder[0],
              requiredAnchor
            );
            moveCount++;
          } catch (error) {
            logger.error(
              `Failed to move first item ${completeDesiredOrder[0]} after anchor`,
              {
                label: 'Plex API',
                sectionId,
                hubId: completeDesiredOrder[0],
                afterHubId: requiredAnchor,
                error: error instanceof Error ? error.message : String(error),
              }
            );
          }
        }
      }

      // Check subsequent items - move after their immediate predecessor if wrong
      for (let i = 1; i < completeDesiredOrder.length; i++) {
        const currentItem = completeDesiredOrder[i];
        const expectedPredecessor = completeDesiredOrder[i - 1];

        // Find current position of this item
        const currentPosition = currentOrder.indexOf(currentItem);
        const expectedPredecessorCurrentPosition =
          currentOrder.indexOf(expectedPredecessor);

        // Item needs to move if it's not immediately after its expected predecessor
        const needsMove =
          currentPosition !== expectedPredecessorCurrentPosition + 1;

        if (needsMove) {
          try {
            logger.debug(
              `Moving item ${currentItem} after predecessor ${expectedPredecessor}`,
              {
                label: 'Plex API',
                sectionId,
                hubId: currentItem,
                afterHubId: expectedPredecessor,
                currentPosition,
                expectedPosition: i,
              }
            );
            await this.moveHub(sectionId, currentItem, expectedPredecessor);
            moveCount++;

            // Update our tracking of current order after the move
            // Remove item from old position and insert after predecessor
            const itemToMove = currentOrder.splice(currentPosition, 1)[0];
            const predecessorNewPosition =
              currentOrder.indexOf(expectedPredecessor);
            currentOrder.splice(predecessorNewPosition + 1, 0, itemToMove);
          } catch (error) {
            logger.error(
              `Failed to move item ${currentItem} after predecessor ${expectedPredecessor}`,
              {
                label: 'Plex API',
                sectionId,
                hubId: currentItem,
                afterHubId: expectedPredecessor,
                error: error instanceof Error ? error.message : String(error),
              }
            );
          }
        }
      }

      logger.info(`Selective reordering completed: ${moveCount} items moved`, {
        label: 'Plex API',
        sectionId,
        moveCount,
        totalItems: completeDesiredOrder.length,
        efficiency: `${moveCount}/${completeDesiredOrder.length} moves`,
      });

      // Verify order after moves - detect precision convergence
      if (moveCount > 0) {
        const verificationHubManagement = await this.getHubManagement(
          sectionId
        );
        const actualOrder = verificationHubManagement.MediaContainer.Hub.map(
          (h: { identifier: string }) => h.identifier
        );

        const orderMatches =
          JSON.stringify(actualOrder) === JSON.stringify(completeDesiredOrder);

        if (!orderMatches) {
          logger.error(
            `Order verification failed after ${moveCount} moves - precision convergence detected`,
            {
              label: 'Plex API',
              sectionId,
              moveCount,
              expectedOrder: completeDesiredOrder,
              actualOrder,
              convergenceDetected: true,
            }
          );

          // Throw a specific error that can be caught and handled with reset
          const convergenceError = new Error(
            `Precision convergence detected in library ${sectionId}`
          ) as Error & {
            isPrecisionConvergence: boolean;
            sectionId: string;
            moveCount: number;
          };
          convergenceError.isPrecisionConvergence = true;
          convergenceError.sectionId = sectionId;
          convergenceError.moveCount = moveCount;
          throw convergenceError;
        } else {
          logger.info(
            `Order verification successful - all ${completeDesiredOrder.length} items in correct positions`,
            {
              label: 'Plex API',
              sectionId,
              verification: 'passed',
              moveCount,
            }
          );
        }
      }
    } catch (error) {
      logger.error(`Error reordering hubs in library section ${sectionId}`, {
        label: 'Plex API',
        error: error instanceof Error ? error.message : String(error),
        sectionId,
        desiredOrder: completeDesiredOrder,
      });
      throw error;
    }
  }

  /**
   * Reset all hub management for a library section
   * This clears all hub positioning and forces Plex to use clean 1000-interval spacing
   * @param sectionId Library section ID
   */
  public async resetLibraryHubManagement(sectionId: string): Promise<void> {
    try {
      const url = `/hubs/sections/${sectionId}/manage`;

      logger.warn(
        `Resetting hub management for library section ${sectionId} due to precision convergence`,
        {
          label: 'Plex API',
          sectionId,
          action: 'nuclear_reset',
        }
      );

      await this.safeDeleteQuery(url);

      logger.info(
        `Successfully reset hub management for library section ${sectionId}`,
        {
          label: 'Plex API',
          sectionId,
          result: 'clean_spacing_restored',
        }
      );
    } catch (error) {
      logger.error(
        `Error resetting hub management for library section ${sectionId}`,
        {
          label: 'Plex API',
          error: error instanceof Error ? error.message : String(error),
          sectionId,
        }
      );
      throw error;
    }
  }

  /**
   * Delete a hub item from a library section
   * @param sectionId Library section ID
   * @param hubId Hub identifier to delete
   */
  public async deleteHubItem(sectionId: string, hubId: string): Promise<void> {
    try {
      const url = `/hubs/sections/${sectionId}/manage/${hubId}`;

      await this.safeDeleteQuery(url);
    } catch (error) {
      logger.error(
        `Error deleting hub item ${hubId} from library section ${sectionId}`,
        {
          label: 'Plex API',
          error: error instanceof Error ? error.message : String(error),
          sectionId,
          hubId,
        }
      );
      throw error;
    }
  }

  /**
   * Get Plex user display name (plexTitle) for a given Plex user ID
   * Uses the Plex users API to get user details with actual display names
   */
  public async getPlexUserTitle(userPlexId: string): Promise<string | null> {
    try {
      if (!this.plexToken) {
        return null;
      }

      // Use Plex Users API which contains the actual display names (title field)
      const response = await axios.get('https://plex.tv/api/users', {
        headers: {
          'X-Plex-Token': this.plexToken,
        },
        timeout: 10000,
      });

      // Parse XML response manually (since we're dealing with external Plex.tv API)
      const xmlString = response.data as string;

      // Simple XML parsing to find our user
      const userMatch = xmlString.match(
        new RegExp(`<User[^>]*id="${userPlexId}"[^>]*>`, 'i')
      );
      if (userMatch) {
        const userElement = userMatch[0];

        // Extract title attribute (display name)
        const titleMatch = userElement.match(/title="([^"]*)"/);
        const usernameMatch = userElement.match(/username="([^"]*)"/);

        // Decode HTML entities (e.g., &amp; -> &)
        const decodeHtmlEntities = (text: string) =>
          text
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");

        const title = titleMatch ? decodeHtmlEntities(titleMatch[1]) : null;
        const username = usernameMatch
          ? decodeHtmlEntities(usernameMatch[1])
          : null;

        logger.debug(
          `Found Plex user ${userPlexId}: title="${title}", username="${username}"`,
          {
            label: 'PlexAPI',
            userId: userPlexId,
          }
        );

        // Return title (display name) if available, otherwise fall back to username
        return title || username || null;
      }

      logger.debug(`Plex user ${userPlexId} not found in users API`, {
        label: 'PlexAPI',
        userId: userPlexId,
      });
      return null;
    } catch (error) {
      logger.warn(`Failed to get Plex user title for user ${userPlexId}`, {
        label: 'Plex API',
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Promote a collection to hub management (makes it available for visibility/ordering management)
   * @param collectionRatingKey The rating key of the collection to promote
   * @param libraryId The library ID where the collection exists
   */
  public async promoteCollectionToHub(
    collectionRatingKey: string,
    libraryId: string
  ): Promise<void> {
    try {
      const hubInitUrl = `/hubs/sections/${libraryId}/manage?metadataItemId=${collectionRatingKey}`;
      await this.safePostQuery(hubInitUrl);

      logger.debug(
        `Successfully promoted collection to hub management: ${collectionRatingKey}`,
        {
          label: 'Plex API',
          collectionRatingKey,
          libraryId,
        }
      );
    } catch (error) {
      logger.error(
        `Error promoting collection ${collectionRatingKey} to hub management in library ${libraryId}`,
        {
          label: 'Plex API',
          collectionRatingKey,
          libraryId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
    }
  }
}

export default PlexAPI;
