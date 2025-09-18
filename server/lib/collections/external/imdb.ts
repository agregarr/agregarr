import type { ImdbListItem } from '@server/api/imdb';
import type PlexAPI from '@server/api/plexapi';
import TmdbAPI from '@server/api/themoviedb';
import { BaseCollectionSync } from '@server/lib/collections/core/BaseCollectionSync';
import {
  findPlexItemsByTmdbIds,
  getCollectionMediaType,
  processMissingItemsWithMode,
  type LibraryItemsCache,
} from '@server/lib/collections/core/CollectionUtilities';
import type {
  CollectionItem,
  CollectionSyncOptions,
  ImdbSourceData,
  ImdbTemplateContext,
  MissingItem,
  PlexCollection,
} from '@server/lib/collections/core/types';
import { CollectionSyncErrorType } from '@server/lib/collections/core/types';
import { RandomListManager } from '@server/lib/collections/utils/RandomListManager';
import type { CollectionConfig } from '@server/lib/settings';
import logger from '@server/logger';

// ImdbSourceData interface is now imported from types.ts

/**
 * IMDb Collection Sync - Implementation for IMDb top lists and custom lists
 *
 * Supports IMDb Top 250, Popular lists, and custom user lists.
 * Uses web scraping since IMDb doesn't have a public API for lists.
 */
export class ImdbCollectionSync extends BaseCollectionSync {
  private tmdbClient: TmdbAPI;
  private dynamicRandomTitle: string | null = null;

  constructor() {
    super('imdb');
    this.tmdbClient = new TmdbAPI();
  }

  protected async validateConfiguration(): Promise<void> {
    // IMDb lists are public and don't require API keys
    // For custom lists, we use simple axios approach so no complex validation needed
    // For predefined lists, we could validate but it's not critical since they're public
    // No complex validation needed for IMDb predefined lists
    // No validation needed for IMDb since:
    // 1. Custom lists use simple axios (no complex dependencies)
    // 2. Predefined lists are public IMDb URLs
    // 3. Any connectivity issues will be caught during actual fetching
  }

  public async fetchSourceData(
    config: CollectionConfig,
    options?: CollectionSyncOptions,
    libraryCache?: LibraryItemsCache
  ): Promise<ImdbSourceData[]> {
    try {
      let imdbData: ImdbListItem[] = [];

      if (config.subtype === 'custom') {
        // Custom IMDb list - use the simple approach that works in fetch-title
        if (!config.imdbCustomListUrl) {
          throw this.createSyncError(
            CollectionSyncErrorType.CONFIGURATION_ERROR,
            'Custom IMDb list URL is required'
          );
        }

        // Use the same approach as fetch-title endpoint (which works)
        const axios = (await import('axios')).default;

        logger.debug(
          `Fetching IMDb custom list with simple approach: ${config.imdbCustomListUrl}`,
          {
            label: 'IMDb Collections',
            configName: config.name,
            url: config.imdbCustomListUrl,
          }
        );

        const response = await axios.get(config.imdbCustomListUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
          timeout: 10000,
        });

        // Parse the HTML to extract movie/TV show items
        imdbData = this.parseImdbListHtml(response.data, config.maxItems);

        logger.info(
          `Successfully fetched ${imdbData.length} items from IMDb custom list`,
          {
            label: 'IMDb Collections',
            configName: config.name,
            itemCount: imdbData.length,
          }
        );
      } else if (config.subtype === 'random') {
        // Random IMDb list - get a random URL from RandomListManager with media type validation
        const mediaType = getCollectionMediaType(config);
        const randomResult = await RandomListManager.getRandomUrlWithTitle(
          'imdb',
          config.maxItems,
          mediaType,
          libraryCache
        );
        if (!randomResult) {
          throw this.createSyncError(
            CollectionSyncErrorType.CONFIGURATION_ERROR,
            `No random IMDb lists available with ${mediaType} content`
          );
        }

        const { url: randomUrl, title: listTitle } = randomResult;

        // Store the dynamic title for use in generateCollectionNameWithCustom
        if (config.template === 'DYNAMIC_RANDOM_TITLE') {
          this.dynamicRandomTitle = listTitle;
          this.updateCollectionConfigField(config.id, { name: listTitle });
        }

        logger.info(`Using random IMDb list: ${randomUrl}`, {
          label: 'IMDb Collections',
          collection: config.name,
          randomUrl,
          listTitle,
        });

        // Use the same approach as custom lists
        const axios = (await import('axios')).default;

        const response = await axios.get(randomUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
          timeout: 10000,
        });

        // Parse the HTML to extract movie/TV show items
        imdbData = this.parseImdbListHtml(response.data, config.maxItems);

        logger.info(
          `Successfully fetched ${imdbData.length} items from random IMDb list`,
          {
            label: 'IMDb Collections',
            configName: config.name,
            itemCount: imdbData.length,
            randomUrl,
          }
        );
      } else {
        // Predefined IMDb lists - use the same simple axios approach
        const mediaType = getCollectionMediaType(config);

        // Using simple axios for predefined IMDb list

        const predefinedUrl = this.getPredefinedListUrl(
          config.subtype || '',
          mediaType
        );
        const axios = (await import('axios')).default;

        // Fetching predefined IMDb list

        const response = await axios.get(
          `https://www.imdb.com${predefinedUrl}`,
          {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
            timeout: 10000,
          }
        );

        // Predefined list response received

        // Parse using the same HTML parsing method
        imdbData = this.parseImdbListHtml(response.data, config.maxItems);

        // Predefined list parsed
      }

      // Convert ImdbListItem to ImdbSourceData and resolve TMDb IDs
      logger.info(`Starting TMDb ID resolution for ${imdbData.length} items`, {
        label: 'IMDb Collections',
        configName: config.name,
        itemsToProcess: imdbData.length,
      });

      const sourceData: ImdbSourceData[] = [];
      const batchSize = 20; // Process 20 items concurrently (well under 40 req/sec limit)

      // Process items in concurrent batches
      for (let i = 0; i < imdbData.length; i += batchSize) {
        const batch = imdbData.slice(i, i + batchSize);

        // Log progress only at significant milestones
        const percentage = Math.round(
          ((i + batch.length) / imdbData.length) * 100
        );
        if (percentage % 25 === 0 || i + batch.length === imdbData.length) {
          logger.info(
            `Resolving TMDb IDs: ${Math.min(
              i + batch.length,
              imdbData.length
            )}/${imdbData.length} (${percentage}%)`,
            {
              label: 'IMDb Collections',
              configName: config.name,
              progress: `${Math.min(i + batch.length, imdbData.length)}/${
                imdbData.length
              }`,
              percentage,
            }
          );
        }

        // Process batch concurrently
        const batchPromises = batch.map(async (item) => {
          try {
            // Use enhanced resolution to get both episode and show TMDb IDs
            const { episodeTmdbId, showTmdbId, seasonNumber, episodeNumber } =
              await this.resolveEpisodeAndShowTmdbIds(item.imdbId);

            if (episodeTmdbId && showTmdbId) {
              logger.debug(
                `Found episode TMDb ID ${episodeTmdbId} and show TMDb ID ${showTmdbId} for ${item.title}`
              );
            }

            // Update episodeInfo with TMDB data if available
            let updatedEpisodeInfo = item.episodeInfo;
            if (showTmdbId && (seasonNumber || episodeNumber)) {
              updatedEpisodeInfo = {
                ...item.episodeInfo,
                season: seasonNumber,
                episode: episodeNumber,
              };
            }

            return {
              imdbId: item.imdbId,
              title: item.title,
              year: item.year,
              type: item.type,
              tmdbId: episodeTmdbId,
              isEpisode: item.isEpisode,
              episodeInfo: updatedEpisodeInfo,
              showTmdbId, // Store show TMDb ID for episodes
            };
          } catch (error) {
            logger.warn(
              `Failed to resolve TMDb ID for IMDb ${item.imdbId} (${
                item.title
              }): ${error instanceof Error ? error.message : 'Unknown error'}`,
              {
                label: 'IMDb Collections',
                configName: config.name,
                imdbId: item.imdbId,
                title: item.title,
              }
            );
            // Still include the item without TMDb ID - might be resolved later
            return {
              imdbId: item.imdbId,
              title: item.title,
              year: item.year,
              type: item.type,
              isEpisode: item.isEpisode,
              episodeInfo: item.episodeInfo,
              showTmdbId: undefined, // No show TMDb ID if episode lookup failed
            };
          }
        });

        // Wait for batch to complete and add results
        const batchResults = await Promise.all(batchPromises);
        sourceData.push(...batchResults);
      }

      return sourceData;
    } catch (error) {
      logger.error(`Failed to fetch IMDb data for ${config.name}`, {
        label: 'IMDb Collections',
        configName: config.name,
        subtype: config.subtype,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });

      throw this.createSyncError(
        CollectionSyncErrorType.API_ERROR,
        `Failed to fetch IMDb list data: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
        { subtype: config.subtype, mediaType: getCollectionMediaType(config) },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Parse IMDb list HTML to extract movie/TV items
   * Supports both custom lists (HTML parsing) and predefined lists (JSON-LD)
   */
  public parseImdbListHtml(html: string, maxItems: number): ImdbListItem[] {
    const items: ImdbListItem[] = [];

    try {
      // First, try to parse JSON-LD structured data (used by predefined lists like Top 250)
      const jsonLdMatch = html.match(
        /<script type="application\/ld\+json">(.*?)<\/script>/s
      );
      if (jsonLdMatch) {
        try {
          const jsonData = JSON.parse(jsonLdMatch[1]);
          if (jsonData['@type'] === 'ItemList' && jsonData.itemListElement) {
            // Found JSON-LD structured data, parsing

            for (
              let i = 0;
              i < Math.min(jsonData.itemListElement.length, maxItems);
              i++
            ) {
              const item = jsonData.itemListElement[i];
              const movieData = item.item;

              if (movieData && movieData.url) {
                const imdbIdMatch = movieData.url.match(/\/title\/(tt\d+)/);
                if (imdbIdMatch) {
                  // Determine type based on @type or genre
                  let type: 'movie' | 'tv' = 'movie';
                  const finalTitle = movieData.name || movieData.alternateName;
                  let year: number | undefined;
                  let isEpisode = false;
                  let episodeInfo:
                    | {
                        episodeTitle?: string;
                        season?: number;
                        episode?: number;
                      }
                    | undefined;

                  if (movieData['@type'] === 'TVEpisode') {
                    type = 'tv';
                    isEpisode = true;

                    // Store episode info
                    episodeInfo = {
                      episodeTitle: movieData.name || movieData.alternateName,
                    };

                    // Try to extract season/episode numbers if available
                    if (movieData.episodeNumber) {
                      episodeInfo.episode = parseInt(movieData.episodeNumber);
                    }
                    if (movieData.seasonNumber) {
                      episodeInfo.season = parseInt(movieData.seasonNumber);
                    }
                  } else if (
                    movieData['@type'] === 'TVSeries' ||
                    (movieData.genre &&
                      movieData.genre.toLowerCase().includes('tv'))
                  ) {
                    type = 'tv';
                  }

                  // Extract year from duration or other metadata if available (for non-episodes)
                  if (!isEpisode && movieData.datePublished) {
                    year = parseInt(movieData.datePublished.substring(0, 4));
                  }

                  items.push({
                    imdbId: imdbIdMatch[1],
                    title: finalTitle,
                    year,
                    type,
                    isEpisode,
                    episodeInfo,
                  });
                }
              }
            }

            // Parsed items from JSON-LD data

            return items;
          }
        } catch (jsonError) {
          logger.debug(
            'Failed to parse JSON-LD, falling back to HTML parsing',
            {
              label: 'IMDb Collections Debug',
              error:
                jsonError instanceof Error
                  ? jsonError.message
                  : 'Unknown error',
            }
          );
        }
      }

      // Fallback to HTML parsing for custom lists
      logger.debug('Using HTML parsing approach', {
        label: 'IMDb Collections Debug',
      });

      let listItemMatches = html.match(
        /<li[^>]*class="[^"]*ipc-metadata-list-summary-item[^"]*"[^>]*>.*?<\/li>/gs
      );

      // If the first pattern doesn't work, try alternative patterns
      if (!listItemMatches) {
        listItemMatches =
          html.match(
            /<div[^>]*class="[^"]*titleColumn[^"]*"[^>]*>.*?<\/div>/gs
          ) ||
          html.match(
            /<div[^>]*class="[^"]*list[^"]*item[^"]*"[^>]*>.*?<\/div>/gs
          );
      }

      // If no matches found, return empty array
      if (!listItemMatches) {
        logger.warn('No list items found in IMDb HTML', {
          label: 'IMDb Collections Debug',
          htmlLength: html.length,
        });
        return items;
      }

      // Process each item found
      for (let i = 0; i < Math.min(listItemMatches.length, maxItems); i++) {
        const item = listItemMatches[i];

        // Extract IMDb ID
        const imdbIdMatch = item.match(/\/title\/(tt\d+)/);
        if (!imdbIdMatch) continue;

        const imdbId = imdbIdMatch[1];

        // Extract title
        let title = '';
        const titleMatch =
          item.match(
            /<h3[^>]*class="[^"]*ipc-title__text[^"]*"[^>]*>.*?(\d+\.\s*)?([^<]+)<\/h3>/s
          ) ||
          item.match(
            /<a[^>]*class="[^"]*titleColumn[^"]*"[^>]*>([^<]+)<\/a>/s
          ) ||
          item.match(/alt="([^"]+)"/);

        if (titleMatch) {
          title = (titleMatch[2] || titleMatch[1]).trim();
        }

        // Extract year
        let year: number | undefined;
        const yearMatch = item.match(/\((\d{4})\)/);
        if (yearMatch) {
          year = parseInt(yearMatch[1]);
        }

        // Determine type (movie vs TV show)
        let type: 'movie' | 'tv' = 'movie'; // Default to movie
        const lowerItem = item.toLowerCase();

        // Check for TV show indicators
        if (
          lowerItem.includes('titletype-tvseries') ||
          lowerItem.includes('tv series') ||
          lowerItem.includes('tv-series') ||
          lowerItem.includes('tvseries') ||
          lowerItem.includes('episodes') ||
          lowerItem.includes('seasons')
        ) {
          type = 'tv';
        }

        if (title && imdbId) {
          items.push({
            imdbId,
            title,
            year,
            type,
          });
        }
      }

      logger.debug(`Parsed ${items.length} items from IMDb HTML`, {
        label: 'IMDb Collections Debug',
        itemCount: items.length,
        htmlLength: html.length,
      });
    } catch (error) {
      logger.error(`Failed to parse IMDb HTML: ${error}`, {
        label: 'IMDb Collections Debug',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    return items;
  }

  public async mapSourceDataToItems(
    sourceData: ImdbSourceData[],
    config: CollectionConfig,
    plexClient?: PlexAPI,
    libraryCache?: LibraryItemsCache
  ) {
    const mappedItems: CollectionItem[] = [];
    const missingItems: MissingItem[] = [];

    // Extract all TMDB IDs and prepare lookup data
    const tmdbLookups: {
      tmdbId: number;
      showTmdbId?: number; // For episodes: the parent show's TMDB ID
      mediaType: 'movie' | 'tv';
      title: string;
      originalPosition: number;
      episodeInfo?: {
        season?: number;
        episode?: number;
        episodeTitle?: string;
      };
    }[] = [];
    const skippedItems: string[] = [];

    for (let index = 0; index < sourceData.length; index++) {
      const item = sourceData[index];
      if (!item.tmdbId) {
        // Collect skipped items for summary logging
        skippedItems.push(`${item.title} (${item.imdbId})`);
        continue;
      }
      tmdbLookups.push({
        tmdbId: item.tmdbId,
        showTmdbId: item.showTmdbId, // For episodes: parent show's TMDb ID
        mediaType: item.type,
        title: item.title,
        originalPosition: index + 1, // 1-based position
        episodeInfo: item.episodeInfo,
      });
    }

    // Log summary of skipped items
    if (skippedItems.length > 0) {
      logger.info(`IMDb items skipped due to missing TMDb IDs`, {
        label: 'IMDb Collections',
        configName: config.name,
        count: skippedItems.length,
        items: skippedItems.slice(0, 5), // Show first 5 items
        ...(skippedItems.length > 5 && {
          additionalCount: skippedItems.length - 5,
        }),
      });
    }

    if (tmdbLookups.length === 0) {
      const stats = this.createFilteringStats(sourceData.length, 0, {
        'no tmdb id': sourceData.length,
      });
      return { items: mappedItems, missingItems, stats };
    }

    // Use direct Plex queries instead of Media table
    let plexLookup: Map<
      string,
      { ratingKey: string; title: string; libraryKey: string }
    > = new Map();

    if (plexClient) {
      // Pass target library ID to limit search scope to only the collection's target library
      const targetLibraryId = Array.isArray(config.libraryId)
        ? config.libraryId[0]
        : config.libraryId;
      plexLookup = await findPlexItemsByTmdbIds(
        plexClient,
        tmdbLookups,
        targetLibraryId,
        libraryCache, // OPTIMIZATION: Pass library cache to avoid repeated API calls
        false // Library-scoped search for collection creation
      );
    } else {
      logger.warn('No Plex client provided to mapSourceDataToItems', {
        label: 'IMDb Collections',
      });
    }

    // Process items using the Plex lookup map
    for (const lookup of tmdbLookups) {
      const key = `${lookup.tmdbId}-${lookup.mediaType}`;
      const plexItem = plexLookup.get(key);

      if (plexItem) {
        mappedItems.push({
          ratingKey: plexItem.ratingKey,
          title: lookup.title,
          type: lookup.mediaType,
          tmdbId: lookup.tmdbId,
          metadata: {
            libraryKey: plexItem.libraryKey,
            showTmdbId: lookup.showTmdbId, // Preserve show TMDb ID for episodes
          },
          episodeInfo: lookup.episodeInfo,
        });
      } else {
        // Item exists in IMDb but not in Plex
        // Skip episodes from missing items (as per plan)
        if (!lookup.episodeInfo) {
          missingItems.push({
            tmdbId: lookup.tmdbId,
            mediaType: lookup.mediaType,
            title: lookup.title,
            originalPosition: lookup.originalPosition,
          });
        } else {
          logger.debug(`Skipping episode ${lookup.title} from missing items`, {
            label: 'IMDb Collections',
          });
        }
      }
    }

    const stats = this.createFilteringStats(
      sourceData.length,
      mappedItems.length,
      {
        'missing from plex': missingItems.length,
        'no tmdb id': sourceData.length - tmdbLookups.length,
      }
    );

    return {
      items: mappedItems,
      missingItems,
      stats,
    };
  }

  public async generateCollectionNameWithCustom(
    config: CollectionConfig,
    mediaType: 'movie' | 'tv',
    libraryCache?: LibraryItemsCache
  ): Promise<string> {
    // Handle DYNAMIC_RANDOM_TITLE using stored title from fetchSourceData
    if (config.template === 'DYNAMIC_RANDOM_TITLE' && this.dynamicRandomTitle) {
      return this.dynamicRandomTitle;
    }

    // Fall back to base implementation for other templates
    return super.generateCollectionNameWithCustom(
      config,
      mediaType,
      libraryCache
    );
  }

  protected async createTemplateContext(
    config: CollectionConfig,
    mediaType: 'movie' | 'tv'
  ): Promise<ImdbTemplateContext> {
    return this.templateEngine.createImdbContext(
      mediaType,
      config.subtype || 'popular'
    ) as ImdbTemplateContext;
  }

  protected async processConfiguration(
    config: CollectionConfig,
    plexClient: PlexAPI,
    allCollections: PlexCollection[],
    processedCollectionKeys?: Set<string>,
    libraryCache?: LibraryItemsCache,
    options?: CollectionSyncOptions
  ) {
    // Processing IMDb collection configuration

    try {
      const sourceData = await this.fetchSourceData(
        config,
        options,
        libraryCache
      );
      // Source data fetched successfully

      const mappedResult = await this.mapSourceDataToItems(
        sourceData,
        config,
        plexClient
      );
      const { items, missingItems } = this.applyFilteringToMappedItems(
        mappedResult,
        config
      );
      // Source data mapped to items

      if (missingItems && missingItems.length > 0) {
        logger.debug('Processing auto requests', {
          label: 'IMDb Collections Debug',
          configName: config.name,
          missingItemsCount: missingItems.length,
        });
        await this.handleAutoRequests(missingItems, config);
      }

      if (items.length === 0) {
        logger.debug('No items found, returning early', {
          label: 'IMDb Collections Debug',
          configName: config.name,
        });
        return { created: 0, updated: 0 };
      }

      logger.debug('Processing collection creation', {
        label: 'IMDb Collections Debug',
        configName: config.name,
        mediaType: getCollectionMediaType(config),
        itemsCount: items.length,
      });

      // Use the new media type processing strategy
      return await this.processWithMediaTypeStrategy(
        items,
        config,
        plexClient,
        allCollections,
        processedCollectionKeys,
        undefined, // userInfo
        libraryCache
      );
    } catch (error) {
      logger.error('Error in IMDb processConfiguration', {
        label: 'IMDb Collections Debug',
        configName: config.name,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        errorType: typeof error,
        errorConstructor: error?.constructor?.name,
      });
      throw error; // Re-throw to be handled by base class
    }
  }

  protected async createCollection(
    items: CollectionItem[],
    mediaType: 'movie' | 'tv',
    collectionName: string,
    plexClient: PlexAPI,
    allCollections: PlexCollection[],
    config: CollectionConfig,
    processedCollectionKeys?: Set<string>
  ) {
    // Use the new standardized approach via BaseCollectionSync
    const result = await this.createOrUpdateCollectionStandardized(
      items,
      collectionName,
      mediaType,
      config,
      plexClient,
      allCollections,
      processedCollectionKeys
    );

    return {
      created: result.created,
      updated: result.updated,
      collectionRatingKey: result.collectionRatingKey,
      itemCount: result.itemCount || items.length,
      stats: result.stats,
    };
  }

  private async handleAutoRequests(
    missingItems: MissingItem[],
    config: CollectionConfig
  ): Promise<void> {
    // Use the unified download service (routes to Overseerr or direct *arr based on config)
    await processMissingItemsWithMode(missingItems, config, 'imdb');
  }

  /**
   * Get the URL path for predefined IMDb lists
   */
  private getPredefinedListUrl(subtype: string, mediaType?: string): string {
    switch (subtype) {
      case 'top_250':
        return mediaType === 'tv' ? '/chart/toptv/' : '/chart/top/';
      case 'popular':
        return mediaType === 'tv' ? '/chart/tvmeter/' : '/chart/moviemeter/';
      case 'boxoffice':
        return '/chart/boxoffice/';
      default:
        throw this.createSyncError(
          CollectionSyncErrorType.CONFIGURATION_ERROR,
          `Unknown IMDb subtype: ${subtype}`
        );
    }
  }

  /**
   * Enhanced resolve that returns both episode and show TMDb IDs for episodes
   */
  public async resolveEpisodeAndShowTmdbIds(imdbId: string): Promise<{
    episodeTmdbId?: number;
    showTmdbId?: number;
    seasonNumber?: number;
    episodeNumber?: number;
  }> {
    try {
      // Use the external ID lookup directly to get all result types
      const extResponse = await this.tmdbClient.getByExternalId({
        externalId: imdbId,
        type: 'imdb',
      });

      // Check if it's an episode first
      if (
        extResponse.tv_episode_results &&
        extResponse.tv_episode_results.length > 0
      ) {
        const episode = extResponse.tv_episode_results[0];
        return {
          episodeTmdbId: episode.id,
          showTmdbId: episode.show_id,
          seasonNumber: episode.season_number,
          episodeNumber: episode.episode_number,
        };
      }

      // Fallback to regular movie/show handling
      if (extResponse.movie_results && extResponse.movie_results.length > 0) {
        return { episodeTmdbId: extResponse.movie_results[0].id };
      }

      if (extResponse.tv_results && extResponse.tv_results.length > 0) {
        return { episodeTmdbId: extResponse.tv_results[0].id };
      }

      return {};
    } catch (error) {
      logger.warn(`Failed to resolve TMDb IDs for IMDb ID ${imdbId}:`, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return {};
    }
  }
}

export default ImdbCollectionSync;
