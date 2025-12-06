import type { PlexHubManagementResponse } from '@server/interfaces/api/plexInterfaces';
import PlexHubManager from '@server/lib/collections/plex/PlexHubManager';
import PlexPosterManager from '@server/lib/collections/plex/PlexPosterManager';
import PlexSmartCollectionManager from '@server/lib/collections/plex/PlexSmartCollectionManager';
import type { Library, PlexSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
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
  lastViewedAt?: number;
  viewCount?: number;
  year?: number;
  index?: number;
  parentIndex?: number;
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
  lastViewedAt?: number;
  viewCount?: number;
  Media: Media[];
}

interface PlexStream {
  id: number;
  streamType: number; // 1=video, 2=audio, 3=subtitle
  codec: string;

  // Video stream fields
  DOVIPresent?: boolean;
  height?: number;
  width?: number;
  colorPrimaries?: string;
  colorSpace?: string;
  colorTrc?: string;
  bitDepth?: number;
  chromaSubsampling?: string;

  // Audio stream fields
  channels?: number;
  audioChannelLayout?: string;
  displayTitle?: string;
  language?: string;
  languageCode?: string;

  // Subtitle stream fields
  format?: string;
  forced?: boolean;
}

interface PlexPart {
  id: number;
  file: string;
  size: number;
  Stream?: PlexStream[];
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
  Part?: PlexPart[];
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
  smart?: string; // Smart collections have smart="1" attribute (Plex returns string)
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
  private hubManager: PlexHubManager;
  private smartCollectionManager: PlexSmartCollectionManager;
  private posterManager: PlexPosterManager;

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

    // Initialize hub manager
    this.hubManager = new PlexHubManager(this);

    // Initialize smart collection manager
    this.smartCollectionManager = new PlexSmartCollectionManager(this);

    // Initialize poster manager
    this.posterManager = new PlexPosterManager(this);
  }

  public async getStatus() {
    return await this.plexClient.query('/');
  }

  /**
   * Check if a collection is a smart collection
   * @param collectionRatingKey The rating key of the collection to check
   * @returns true if the collection is smart, false otherwise
   */
  private async isSmartCollection(
    collectionRatingKey: string
  ): Promise<boolean> {
    try {
      const metadata = await this.getCollectionMetadata(collectionRatingKey);
      if (!metadata) {
        return false;
      }

      // Smart collections have smart="1" attribute in Plex API
      return metadata.smart === '1';
    } catch (error) {
      logger.warn(
        `Failed to check if collection ${collectionRatingKey} is smart`,
        {
          label: 'Plex API',
          error: error instanceof Error ? error.message : String(error),
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

    // PROTECTION: Never add items to smart collections - they are auto-populated by Plex
    const isSmart = await this.isSmartCollection(collectionRatingKey);
    if (isSmart) {
      logger.error(
        `PROTECTION: Attempted to add items to smart collection ${collectionRatingKey}. This could corrupt the Plex database!`,
        {
          label: 'Plex API',
          collectionRatingKey,
          itemCount: items.length,
          protection: 'SMART_COLLECTION_BLOCK',
        }
      );
      throw new Error(
        `Cannot add items to smart collection ${collectionRatingKey}. Smart collections are auto-populated by Plex.`
      );
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

  /**
   * Get full metadata for items in a collection, including Guid array for TMDB IDs
   * This is specifically for collections (smart or regular) - NOT for regular metadata items
   */
  public async getCollectionItemsWithMetadata(
    collectionRatingKey: string
  ): Promise<PlexMetadata[]> {
    try {
      const response = await this.plexClient.query({
        uri: `/library/collections/${collectionRatingKey}/children?includeGuids=1`,
        extraHeaders: {
          'X-Plex-Container-Size': `0`,
        },
      });
      return response.MediaContainer?.Metadata || [];
    } catch (error) {
      logger.error(
        `Error getting metadata from collection ${collectionRatingKey}`,
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
    // PROTECTION: Never remove items from smart collections - they are auto-populated by Plex
    const isSmart = await this.isSmartCollection(collectionRatingKey);
    if (isSmart) {
      logger.error(
        `PROTECTION: Attempted to remove items from smart collection ${collectionRatingKey}. This could corrupt the Plex database!`,
        {
          label: 'Plex API',
          collectionRatingKey,
          protection: 'SMART_COLLECTION_BLOCK',
        }
      );
      throw new Error(
        `Cannot remove items from smart collection ${collectionRatingKey}. Smart collections are auto-populated by Plex.`
      );
    }

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

        // Check if label already exists first (case-insensitive comparison since Plex auto-formats labels)
        const existingLabels = collectionMeta.labels || [];
        const labelExistsIndex = existingLabels.findIndex(
          (existingLabel) => existingLabel.toLowerCase() === label.toLowerCase()
        );
        if (labelExistsIndex !== -1) {
          return true; // Early return - no changes needed
        }

        // Clean existing Agregarr labels while preserving user's custom labels
        // Only remove OTHER Agregarr labels, not the one we're trying to add
        const { cleanAgregarrCollectionLabels } = await import(
          '@server/lib/collections/core/CollectionUtilities'
        );
        const preservedLabels = cleanAgregarrCollectionLabels(
          existingLabels,
          label
        );

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

  /**
   * Update collection mode (visibility of individual items)
   * @param collectionRatingKey - Collection rating key
   * @param mode - Collection mode: 0 = library default, 1 = hide items show collection, 2 = show collection and items, 3 = hide collection show items
   */
  public async updateCollectionMode(
    collectionRatingKey: string,
    mode: 0 | 1 | 2 | 3
  ): Promise<void> {
    try {
      // Plex uses /prefs endpoint with collectionMode query parameter
      const prefsUrl = `/library/metadata/${collectionRatingKey}/prefs?collectionMode=${mode}`;

      await this.safePutQuery(prefsUrl);

      logger.debug(
        `Updated collection mode to ${mode} for collection ${collectionRatingKey}`,
        {
          label: 'Plex API',
          mode,
          collectionRatingKey,
        }
      );
    } catch (error) {
      logger.error(
        `Error updating collection mode for collection ${collectionRatingKey}`,
        {
          label: 'Plex API',
          error,
        }
      );
    }
  }

  /**
   * Update the title of an individual item (movie, show, episode)
   */
  public async updateItemTitle(
    ratingKey: string,
    title: string
  ): Promise<void> {
    try {
      const params = {
        'title.value': title,
        'title.locked': '1', // Lock to prevent Plex from overwriting
      };

      const queryString = Object.entries(params)
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
        .join('&');

      const editUrl = `/library/metadata/${ratingKey}?${queryString}`;

      await this.safePutQuery(editUrl);

      logger.debug('Updated item title', {
        label: 'Plex API',
        ratingKey,
        title,
      });
    } catch (error) {
      logger.error(`Error updating title for item ${ratingKey}`, {
        label: 'Plex API',
        error,
      });
      throw error;
    }
  }

  /**
   * Add a label to an individual item (movie, show, episode)
   */
  public async addLabelToItem(ratingKey: string, label: string): Promise<void> {
    try {
      // Get current item metadata to preserve existing labels
      const metadata = await this.getMetadata(ratingKey);

      // Get existing labels
      const existingLabels: string[] = [];
      if (metadata && 'Label' in metadata) {
        const labels = metadata.Label as { tag: string }[] | undefined;
        if (labels && Array.isArray(labels)) {
          existingLabels.push(...labels.map((l) => l.tag));
        }
      }

      // Check if label already exists
      if (existingLabels.includes(label)) {
        logger.debug('Label already exists on item', {
          label: 'Plex API',
          ratingKey,
          labelTag: label,
        });
        return;
      }

      // Build params with all labels (existing + new)
      const allLabels = [...existingLabels, label];
      const params: Record<string, string> = {};
      allLabels.forEach((labelTag, index) => {
        params[`label[${index}].tag.tag`] = labelTag;
      });

      const queryString = Object.entries(params)
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
        .join('&');

      const editUrl = `/library/metadata/${ratingKey}?${queryString}`;

      await this.safePutQuery(editUrl);

      logger.debug('Added label to item', {
        label: 'Plex API',
        ratingKey,
        labelTag: label,
      });
    } catch (error) {
      logger.error(`Error adding label to item ${ratingKey}`, {
        label: 'Plex API',
        error,
      });
      throw error;
    }
  }

  /**
   * Remove a label from an individual item (movie, show, episode)
   */
  public async removeLabelFromItem(
    ratingKey: string,
    label: string
  ): Promise<void> {
    try {
      // Get current item metadata to check existing labels
      const metadata = await this.getMetadata(ratingKey);

      // Get existing labels
      const existingLabels: string[] = [];
      if (metadata && 'Label' in metadata) {
        const labels = metadata.Label as { tag: string }[] | undefined;
        if (labels && Array.isArray(labels)) {
          existingLabels.push(...labels.map((l) => l.tag));
        }
      }

      // Check if label exists (case-insensitive)
      const labelIndex = existingLabels.findIndex(
        (existingLabel) => existingLabel.toLowerCase() === label.toLowerCase()
      );

      if (labelIndex === -1) {
        logger.debug('Label does not exist on item, nothing to remove', {
          label: 'Plex API',
          ratingKey,
          labelTag: label,
        });
        return;
      }

      // Remove the label from the array
      const updatedLabels = existingLabels.filter(
        (_, index) => index !== labelIndex
      );

      // Build params with remaining labels
      const params: Record<string, string> = {};
      updatedLabels.forEach((labelTag, index) => {
        params[`label[${index}].tag.tag`] = labelTag;
      });

      // If no labels remain, we still need to send the request to clear all labels
      const queryString =
        updatedLabels.length > 0
          ? Object.entries(params)
              .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
              .join('&')
          : 'label[0].tag.tag-=';

      const editUrl = `/library/metadata/${ratingKey}?${queryString}`;

      await this.safePutQuery(editUrl);

      logger.debug('Removed label from item', {
        label: 'Plex API',
        ratingKey,
        labelTag: label,
        remainingLabels: updatedLabels,
      });
    } catch (error) {
      logger.error(`Error removing label from item ${ratingKey}`, {
        label: 'Plex API',
        error,
      });
      throw error;
    }
  }

  /**
   * Get all items in a library that have a specific label
   * @param libraryKey - Library section key
   * @param labelName - Label to search for
   * @returns Array of rating keys for items with the label
   */
  public async getItemsWithLabel(
    libraryKey: string,
    labelName: string
  ): Promise<string[]> {
    try {
      const response = await this.plexClient.query<{
        MediaContainer?: { Metadata?: { ratingKey: string }[] };
      }>({
        uri: `/library/sections/${libraryKey}/all?label=${encodeURIComponent(
          labelName
        )}`,
        extraHeaders: {
          'X-Plex-Container-Size': `0`,
        },
      });

      const items = response.MediaContainer?.Metadata || [];
      return items.map((item) => item.ratingKey);
    } catch (error) {
      logger.error(
        `Error getting items with label "${labelName}" in library ${libraryKey}`,
        {
          label: 'Plex API',
          libraryKey,
          labelName,
          error,
        }
      );
      return [];
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
    // PROTECTION: Never move items in smart collections - they have their own ordering
    const isSmart = await this.isSmartCollection(collectionRatingKey);
    if (isSmart) {
      logger.debug(
        `PROTECTION: Attempted to move item in smart collection ${collectionRatingKey}. Skipping move for smart collection.`,
        {
          label: 'Plex API',
          collectionRatingKey,
          itemRatingKey,
          protection: 'SMART_COLLECTION_SKIP',
        }
      );
      return false; // Just return false for smart collections, don't throw error
    }

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

    // PROTECTION: Never arrange items in smart collections - they have their own ordering
    const isSmart = await this.isSmartCollection(collectionRatingKey);
    if (isSmart) {
      logger.warn(
        `PROTECTION: Attempted to arrange items in smart collection ${collectionRatingKey}. Skipping arrangement for smart collection.`,
        {
          label: 'Plex API',
          collectionRatingKey,
          itemCount: orderedItems.length,
          protection: 'SMART_COLLECTION_SKIP',
        }
      );
      return; // Just skip arrangement for smart collections, don't throw error
    }

    // Fetch current order once
    const currentOrder = await this.getCollectionItems(collectionRatingKey);
    const desiredOrder = orderedItems.map((item) => item.ratingKey);

    // Early return optimization: Check if already in correct order
    if (
      currentOrder.length === desiredOrder.length &&
      currentOrder.every(
        (ratingKey, index) => ratingKey === desiredOrder[index]
      )
    ) {
      logger.debug(
        `Collection ${collectionRatingKey} is already in correct order. Skipping reordering.`,
        {
          label: 'Plex API',
          collectionRatingKey,
          itemCount: orderedItems.length,
        }
      );
      return;
    }

    let moveCount = 0;
    let failCount = 0;

    // Selective reordering: Only move items that are out of position
    for (let i = 0; i < desiredOrder.length; i++) {
      if (currentOrder[i] !== desiredOrder[i]) {
        const itemToMove = desiredOrder[i];
        const afterItem = i > 0 ? desiredOrder[i - 1] : null;

        if (afterItem) {
          const success = await this.moveItemInCollection(
            collectionRatingKey,
            itemToMove,
            afterItem
          );

          if (success) {
            moveCount++;
            // Update in-memory tracking: remove from old position and insert at new position
            const oldIndex = currentOrder.indexOf(itemToMove);
            currentOrder.splice(oldIndex, 1);
            currentOrder.splice(i, 0, itemToMove);
          } else {
            failCount++;
          }
        }
      }
    }

    if (moveCount > 0) {
      logger.debug(
        `Selectively moved ${moveCount} items in collection ${collectionRatingKey}`,
        {
          label: 'Plex API',
          collectionRatingKey,
          totalItems: orderedItems.length,
          movedItems: moveCount,
        }
      );
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

  /**
   * Remove specific items from a collection (incremental update)
   */
  public async removeSpecificItemsFromCollection(
    collectionRatingKey: string,
    itemsToRemove: string[]
  ): Promise<{ successful: number; failed: number }> {
    let successful = 0;
    let failed = 0;

    // PROTECTION: Never remove items from smart collections - they are auto-populated by Plex
    const isSmart = await this.isSmartCollection(collectionRatingKey);
    if (isSmart) {
      logger.error(
        `PROTECTION: Attempted to remove specific items from smart collection ${collectionRatingKey}. This could corrupt the Plex database!`,
        {
          label: 'Plex API',
          collectionRatingKey,
          itemCount: itemsToRemove.length,
          protection: 'SMART_COLLECTION_BLOCK',
        }
      );
      throw new Error(
        `Cannot remove items from smart collection ${collectionRatingKey}. Smart collections are auto-populated by Plex.`
      );
    }

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

    // PROTECTION: Never update smart collections - they are auto-populated by Plex
    const isSmart = await this.isSmartCollection(collectionRatingKey);
    if (isSmart) {
      logger.error(
        `PROTECTION: Attempted to update contents of smart collection ${collectionRatingKey}. This could corrupt the Plex database!`,
        {
          label: 'Plex API',
          collectionRatingKey,
          itemCount: desiredItems.length,
          protection: 'SMART_COLLECTION_BLOCK',
        }
      );
      throw new Error(
        `Cannot update smart collection ${collectionRatingKey}. Smart collections are auto-populated by Plex.`
      );
    }

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

    // PROTECTION: Never add items to smart collections - they are auto-populated by Plex
    const isSmart = await this.isSmartCollection(collectionRatingKey);
    if (isSmart) {
      logger.error(
        `PROTECTION: Attempted to add specific items to smart collection ${collectionRatingKey}. This could corrupt the Plex database!`,
        {
          label: 'Plex API',
          collectionRatingKey,
          itemCount: itemsToAdd.length,
          protection: 'SMART_COLLECTION_BLOCK',
        }
      );
      throw new Error(
        `Cannot add items to smart collection ${collectionRatingKey}. Smart collections are auto-populated by Plex.`
      );
    }

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

    const itemLibraries = Array.from(
      new Set(itemTypes.map((item) => item.librarySectionID))
    );
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

  /**
   * Trigger a Plex library scan/refresh
   * @param libraryId - The library section ID to scan
   */
  public async scanLibrary(libraryId: string): Promise<void> {
    try {
      logger.debug('Triggering Plex library scan', {
        label: 'Plex API',
        libraryId,
      });

      await this.plexClient.query(`/library/sections/${libraryId}/refresh`);

      logger.info('Plex library scan triggered', {
        label: 'Plex API',
        libraryId,
      });
    } catch (error) {
      logger.error('Failed to trigger Plex library scan', {
        label: 'Plex API',
        libraryId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // PLEX.TV METHODS - Delegated to PlexTvAPI

  /**
   * Get Plex user display name for a given Plex user ID
   * Delegates to PlexTvAPI
   */
  public async getPlexUserTitle(userPlexId: string): Promise<string | null> {
    if (!this.plexToken) {
      return null;
    }
    const PlexTvAPI = (await import('./plextv')).default;
    const plexTvApi = new PlexTvAPI(this.plexToken);
    return plexTvApi.getPlexUserTitle(userPlexId);
  }

  // HUB MANAGEMENT METHODS - Delegated to PlexHubManager

  /**
   * Get all hubs for a specific library section
   * Returns both built-in hubs (Recently Added, etc.) and custom collections
   */
  public async getLibraryHubs(sectionId: string): Promise<unknown> {
    return this.hubManager.getLibraryHubs(sectionId);
  }

  /**
   * Get hub management interface for a library section
   * This endpoint provides the drag-and-drop hub ordering interface
   */
  public async getHubManagement(
    sectionId: string
  ): Promise<PlexHubManagementResponse> {
    return this.hubManager.getHubManagement(sectionId);
  }

  /**
   * Move a hub to a new position in the library home screen
   */
  public async moveHub(
    sectionId: string,
    hubId: string,
    afterHubId?: string
  ): Promise<void> {
    return this.hubManager.moveHub(sectionId, hubId, afterHubId);
  }

  /**
   * Get current collection visibility settings
   */
  public async getCollectionVisibility(
    collectionRatingKey: string
  ): Promise<unknown> {
    return this.hubManager.getCollectionVisibility(collectionRatingKey);
  }

  /**
   * Update hub visibility settings
   */
  public async updateHubVisibility(
    sectionId: string,
    hubId: string,
    visibility: {
      promotedToRecommended?: boolean;
      promotedToOwnHome?: boolean;
      promotedToSharedHome?: boolean;
    }
  ): Promise<void> {
    return this.hubManager.updateHubVisibility(sectionId, hubId, visibility);
  }

  /**
   * Get all available hubs across all library sections
   */
  public async getAllLibraryHubs(): Promise<{ [sectionId: string]: unknown }> {
    return this.hubManager.getAllLibraryHubs();
  }

  /**
   * Reorder multiple hubs in a library section
   */
  public async reorderHubs(
    sectionId: string,
    desiredOrder: string[],
    positionedItemsCount?: number,
    libraryType?: 'movie' | 'show',
    syncCounter?: number
  ): Promise<void> {
    return this.hubManager.reorderHubs(
      sectionId,
      desiredOrder,
      positionedItemsCount,
      libraryType,
      syncCounter
    );
  }

  /**
   * Reset all hub management for a library section
   */
  public async resetLibraryHubManagement(sectionId: string): Promise<void> {
    return this.hubManager.resetLibraryHubManagement(sectionId);
  }

  /**
   * Delete a hub item from a library section
   */
  public async deleteHubItem(sectionId: string, hubId: string): Promise<void> {
    return this.hubManager.deleteHubItem(sectionId, hubId);
  }

  /**
   * Promote a collection to hub management
   */
  public async promoteCollectionToHub(
    collectionRatingKey: string,
    libraryId: string
  ): Promise<void> {
    return this.hubManager.promoteCollectionToHub(
      collectionRatingKey,
      libraryId
    );
  }

  // SMART COLLECTION METHODS - Delegated to PlexSmartCollectionManager

  /**
   * Create a label-based smart collection for unwatched items
   * New approach: labels items directly, no base collection needed
   */
  public async createLabelBasedSmartCollection(
    title: string,
    libraryKey: string,
    labelName: string,
    mediaType: 'movie' | 'tv' = 'movie',
    sortOption?: string,
    agregarrLabel?: string
  ): Promise<string | null> {
    return this.smartCollectionManager.createLabelBasedSmartCollection(
      title,
      libraryKey,
      labelName,
      mediaType,
      sortOption,
      agregarrLabel
    );
  }

  /**
   * Set collection filtering to be based on the current user viewing the content
   */
  public async setCollectionUserFilter(
    collectionRatingKey: string
  ): Promise<void> {
    return this.smartCollectionManager.setCollectionUserFilter(
      collectionRatingKey
    );
  }

  /**
   * Update a label-based smart collection's URI (including sort parameters)
   */
  public async updateLabelBasedSmartCollectionUri(
    smartCollectionRatingKey: string,
    libraryKey: string,
    labelName: string,
    mediaType: 'movie' | 'tv' = 'movie',
    sortOption?: string
  ): Promise<void> {
    return this.smartCollectionManager.updateLabelBasedSmartCollectionUri(
      smartCollectionRatingKey,
      libraryKey,
      labelName,
      mediaType,
      sortOption
    );
  }

  /**
   * Delete a smart collection
   */
  public async deleteSmartCollection(
    smartCollectionRatingKey: string
  ): Promise<void> {
    return this.smartCollectionManager.deleteSmartCollection(
      smartCollectionRatingKey
    );
  }

  // POSTER MANAGEMENT METHODS - Delegated to PlexPosterManager

  /**
   * Get all available posters for a Plex item
   */
  public async getAvailablePosters(ratingKey: string): Promise<unknown[]> {
    return this.posterManager.getAvailablePosters(ratingKey);
  }

  /**
   * Upload a poster from a URL
   */
  public async uploadPosterFromUrl(
    ratingKey: string,
    url: string
  ): Promise<void> {
    return this.posterManager.uploadPosterFromUrl(ratingKey, url);
  }

  /**
   * Upload a poster from a local file path
   */
  public async uploadPosterFromFile(
    ratingKey: string,
    filepath: string
  ): Promise<void> {
    return this.posterManager.uploadPosterFromFile(ratingKey, filepath);
  }

  /**
   * Select an existing poster for an item
   */
  public async selectPoster(
    ratingKey: string,
    posterRatingKey: string
  ): Promise<void> {
    return this.posterManager.selectPoster(ratingKey, posterRatingKey);
  }

  /**
   * Lock the poster for an item (prevents auto-updates)
   */
  public async lockPoster(ratingKey: string): Promise<void> {
    return this.posterManager.lockPoster(ratingKey);
  }

  /**
   * Unlock the poster for an item (allows auto-updates)
   */
  public async unlockPoster(ratingKey: string): Promise<void> {
    return this.posterManager.unlockPoster(ratingKey);
  }

  /**
   * Get current poster URL for a Plex item
   */
  public async getCurrentPosterUrl(ratingKey: string): Promise<string | null> {
    return this.posterManager.getCurrentPosterUrl(ratingKey);
  }

  /**
   * Get current art/wallpaper URL for a Plex item
   */
  public async getCurrentArtUrl(ratingKey: string): Promise<string | null> {
    return this.posterManager.getCurrentArtUrl(ratingKey);
  }

  /**
   * Get current theme URL for a Plex item
   */
  public async getCurrentThemeUrl(ratingKey: string): Promise<string | null> {
    return this.posterManager.getCurrentThemeUrl(ratingKey);
  }

  /**
   * Combined method for uploading and setting a poster (backwards compatibility)
   */
  public async updateCollectionPoster(
    collectionRatingKey: string,
    posterPath: string
  ): Promise<void> {
    return this.posterManager.updateCollectionPoster(
      collectionRatingKey,
      posterPath
    );
  }

  /**
   * Upload wallpaper/art from a local file path
   */
  public async uploadArtFromFile(
    ratingKey: string,
    filepath: string
  ): Promise<void> {
    return this.posterManager.uploadArtFromFile(ratingKey, filepath);
  }

  /**
   * Lock the art for an item (prevents auto-updates)
   */
  public async lockArt(ratingKey: string): Promise<void> {
    return this.posterManager.lockArt(ratingKey);
  }

  /**
   * Upload theme music from a local file path
   */
  public async uploadThemeFromFile(
    ratingKey: string,
    filepath: string
  ): Promise<void> {
    return this.posterManager.uploadThemeFromFile(ratingKey, filepath);
  }

  /**
   * Lock the theme for an item (prevents auto-updates)
   */
  public async lockTheme(ratingKey: string): Promise<void> {
    return this.posterManager.lockTheme(ratingKey);
  }

  /**
   * Update collection summary/description
   */
  public async updateSummary(
    ratingKey: string,
    summary: string
  ): Promise<void> {
    return this.posterManager.updateSummary(ratingKey, summary);
  }

  /**
   * Get top directors from a library section with their item counts
   */
  public async getLibraryDirectors(
    libraryId: string,
    limit?: number
  ): Promise<{ name: string; count: number }[]> {
    try {
      logger.debug(`Fetching directors from library ${libraryId}`, {
        label: 'Plex API',
        libraryId,
        limit,
      });

      const response = await this.plexClient.query<{
        MediaContainer: {
          totalSize: number;
          Metadata?: {
            Director?: { tag: string }[];
          }[];
        };
      }>({
        uri: `/library/sections/${libraryId}/all`,
        extraHeaders: {
          'X-Plex-Container-Size': '0', // Get all items
        },
      });

      const items = response.MediaContainer.Metadata || [];
      const directorCounts = new Map<string, number>();

      for (const item of items) {
        if (item.Director && Array.isArray(item.Director)) {
          for (const director of item.Director) {
            if (director.tag) {
              const currentCount = directorCounts.get(director.tag) || 0;
              directorCounts.set(director.tag, currentCount + 1);
            }
          }
        }
      }

      let directors = Array.from(directorCounts.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);

      if (limit && limit > 0) {
        directors = directors.slice(0, limit);
      }

      logger.info(
        `Found ${directorCounts.size} unique directors in library ${libraryId}`,
        {
          label: 'Plex API',
          libraryId,
          totalDirectors: directorCounts.size,
          returned: directors.length,
          topDirectors: directors.slice(0, 5).map((d) => `${d.name} (${d.count})`),
        }
      );

      return directors;
    } catch (error) {
      logger.error(`Failed to fetch directors from library ${libraryId}`, {
        label: 'Plex API',
        libraryId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get library items for a specific director (movies or TV)
   */
  public async getItemsByDirector(
    libraryId: string,
    directorName: string,
    mediaType: 'movie' | 'tv',
    limit?: number
  ): Promise<PlexLibraryItem[]> {
    const type = mediaType === 'movie' ? 1 : 2;
    const directorFilter = encodeURIComponent(directorName);
    const filterParams =
      mediaType === 'tv'
        ? `episode.title!=${encodeURIComponent('Trailer (Placeholder)')}`
        : `label!=${encodeURIComponent('trailer-placeholder')}`;

    let uri = `/library/sections/${libraryId}/all?type=${type}&director=${directorFilter}&${filterParams}&includeGuids=1`;
    if (limit && limit > 0) {
      uri += `&limit=${limit}`;
    }

    try {
      const response = await this.plexClient.query<{
        MediaContainer: { Metadata?: PlexLibraryItem[] };
      }>({
        uri,
        extraHeaders: limit
          ? {
              'X-Plex-Container-Size': `${limit}`,
            }
          : undefined,
      });

      return response.MediaContainer.Metadata || [];
    } catch (error) {
      logger.error(
        `Failed to fetch items for director "${directorName}" in library ${libraryId}`,
        {
          label: 'Plex API',
          directorName,
          libraryId,
          mediaType,
          limit,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
    }
  }
}

export default PlexAPI;
