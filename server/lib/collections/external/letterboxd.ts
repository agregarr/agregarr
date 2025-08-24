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
  LetterboxdSourceData,
  LetterboxdTemplateContext,
  MissingItem,
  PlexCollection,
} from '@server/lib/collections/core/types';
import { CollectionSyncErrorType } from '@server/lib/collections/core/types';
import type { CollectionConfig } from '@server/lib/settings';
import logger from '@server/logger';

interface LetterboxdListItem {
  title: string;
  year: number;
  letterboxdUrl: string;
}

/**
 * Letterboxd Collection Sync - Implementation for Letterboxd custom lists
 *
 * Supports custom Letterboxd lists via web scraping since Letterboxd doesn't have a public API.
 */
export class LetterboxdCollectionSync extends BaseCollectionSync {
  private tmdbClient: TmdbAPI;

  constructor() {
    super('letterboxd');
    this.tmdbClient = new TmdbAPI();
  }

  protected async validateConfiguration(): Promise<void> {
    // Letterboxd lists are public and don't require API keys
    // Custom lists use simple axios approach so no complex validation needed

    logger.debug(
      'Letterboxd configuration validation - skipping complex validation',
      {
        label: 'Letterboxd Collections Debug',
      }
    );

    // No validation needed for Letterboxd since:
    // 1. Custom lists use simple axios (no complex dependencies)
    // 2. Lists are public Letterboxd URLs
    // 3. Any connectivity issues will be caught during actual fetching
  }

  protected async fetchSourceData(
    config: CollectionConfig,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    options?: CollectionSyncOptions
  ): Promise<LetterboxdSourceData[]> {
    try {
      if (config.subtype !== 'custom' || !config.letterboxdCustomListUrl) {
        throw this.createSyncError(
          CollectionSyncErrorType.CONFIGURATION_ERROR,
          'Custom Letterboxd list URL is required'
        );
      }

      // Use the same approach as fetch-title endpoint
      const axios = (await import('axios')).default;

      logger.debug(
        `Fetching Letterboxd custom list: ${config.letterboxdCustomListUrl}`,
        {
          label: 'Letterboxd Collections',
          configName: config.name,
          url: config.letterboxdCustomListUrl,
        }
      );

      const response = await axios.get(config.letterboxdCustomListUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        timeout: 10000,
      });

      // Parse the HTML to extract movie items
      const letterboxdData = this.parseLetterboxdListHtml(
        response.data,
        config.maxItems
      );

      logger.info(
        `Successfully fetched ${letterboxdData.length} items from Letterboxd custom list`,
        {
          label: 'Letterboxd Collections',
          configName: config.name,
          itemCount: letterboxdData.length,
        }
      );

      // Convert to LetterboxdSourceData and resolve TMDb IDs
      logger.info(
        `Starting TMDb ID resolution for ${letterboxdData.length} items`,
        {
          label: 'Letterboxd Collections',
          configName: config.name,
          itemsToProcess: letterboxdData.length,
        }
      );

      const sourceData: LetterboxdSourceData[] = [];
      const batchSize = 20; // Process 20 items concurrently (well under 40 req/sec limit)

      // Process items in concurrent batches
      for (let i = 0; i < letterboxdData.length; i += batchSize) {
        const batch = letterboxdData.slice(i, i + batchSize);

        // Log progress
        const percentage = Math.round(
          ((i + batch.length) / letterboxdData.length) * 100
        );
        logger.info(
          `Resolving TMDb IDs: ${Math.min(
            i + batch.length,
            letterboxdData.length
          )}/${letterboxdData.length} (${percentage}%)`,
          {
            label: 'Letterboxd Collections',
            configName: config.name,
            progress: `${Math.min(i + batch.length, letterboxdData.length)}/${
              letterboxdData.length
            }`,
            percentage,
          }
        );

        // Process batch concurrently
        const batchPromises = batch.map(async (item) => {
          try {
            // Search for the movie on TMDb using title and year
            const searchResults = await this.tmdbClient.searchMovies({
              query: item.title,
              year: item.year,
            });

            if (searchResults.results && searchResults.results.length > 0) {
              const tmdbMovie = searchResults.results[0];
              return {
                title: item.title,
                year: item.year,
                letterboxdUrl: item.letterboxdUrl,
                tmdbId: tmdbMovie.id,
                mediaType: 'movie' as const,
              };
            } else {
              logger.warn(
                `No TMDb match found for Letterboxd item: ${item.title} (${item.year})`,
                {
                  label: 'Letterboxd Collections',
                  configName: config.name,
                  itemTitle: item.title,
                  itemYear: item.year,
                }
              );
              return null;
            }
          } catch (error) {
            logger.warn(`Error resolving TMDb ID for ${item.title}:`, {
              label: 'Letterboxd Collections',
              configName: config.name,
              error: error instanceof Error ? error.message : 'Unknown error',
              itemTitle: item.title,
            });
            return null;
          }
        });

        // Wait for batch to complete and add results
        const batchResults = await Promise.all(batchPromises);
        const validResults = batchResults.filter(
          (result): result is LetterboxdSourceData => result !== null
        );
        sourceData.push(...validResults);
      }

      logger.info(
        `TMDb ID resolution complete: ${sourceData.length}/${letterboxdData.length} items resolved`,
        {
          label: 'Letterboxd Collections',
          configName: config.name,
          resolvedItems: sourceData.length,
          totalItems: letterboxdData.length,
        }
      );

      return sourceData;
    } catch (error) {
      logger.error('Error fetching Letterboxd source data:', {
        label: 'Letterboxd Collections',
        configName: config.name,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      if (error instanceof Error && error.name === 'CollectionSyncError') {
        throw error;
      }

      throw this.createSyncError(
        CollectionSyncErrorType.API_ERROR,
        `Failed to fetch Letterboxd data: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  protected async mapSourceDataToItems(
    sourceData: LetterboxdSourceData[],
    config: CollectionConfig,
    plexClient?: PlexAPI,
    libraryCache?: LibraryItemsCache
  ) {
    const mappedItems: CollectionItem[] = [];
    const missingItems: MissingItem[] = [];

    // Extract all TMDB IDs and prepare lookup data
    const tmdbLookups: {
      tmdbId: number;
      mediaType: 'movie' | 'tv';
      title: string;
      originalPosition: number;
    }[] = [];
    for (let index = 0; index < sourceData.length; index++) {
      const item = sourceData[index];
      if (!item.tmdbId) {
        // Skip items without TMDb ID as we can't map them to Plex
        logger.debug(
          `Skipping Letterboxd item ${item.letterboxdUrl} (${item.title}) - no TMDb ID found`
        );
        continue;
      }
      // Letterboxd is movies only
      tmdbLookups.push({
        tmdbId: item.tmdbId,
        mediaType: 'movie',
        title: item.title,
        originalPosition: index + 1, // 1-based position
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
        libraryCache // OPTIMIZATION: Pass library cache to avoid repeated API calls
      );
    } else {
      logger.warn('No Plex client provided to mapSourceDataToItems', {
        label: 'Letterboxd Collections',
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
          },
        });
      } else {
        // Item exists in Letterboxd but not in Plex
        missingItems.push({
          tmdbId: lookup.tmdbId,
          mediaType: lookup.mediaType,
          title: lookup.title,
          originalPosition: lookup.originalPosition,
        });
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

  protected async createTemplateContext(
    config: CollectionConfig,
    mediaType: 'movie' | 'tv'
  ): Promise<LetterboxdTemplateContext> {
    const baseContext = (await this.templateEngine.createLetterboxdContext(
      mediaType,
      config.subtype || 'custom'
    )) as LetterboxdTemplateContext;

    return {
      ...baseContext,
      listUrl: config.letterboxdCustomListUrl || '',
      listName: this.extractListNameFromUrl(
        config.letterboxdCustomListUrl || ''
      ),
    };
  }

  protected async processConfiguration(
    config: CollectionConfig,
    plexClient: PlexAPI,
    allCollections: PlexCollection[],
    processedCollectionKeys?: Set<string>
  ) {
    logger.debug('Starting Letterboxd processConfiguration', {
      label: 'Letterboxd Collections Debug',
      configName: config.name,
      configId: config.id,
      subtype: config.subtype,
      mediaType: getCollectionMediaType(config),
    });

    try {
      const sourceData = await this.fetchSourceData(config);
      logger.debug('Source data fetched successfully', {
        label: 'Letterboxd Collections Debug',
        configName: config.name,
        sourceDataLength: sourceData.length,
      });

      const mappedResult = await this.mapSourceDataToItems(
        sourceData,
        config,
        plexClient
      );
      const { items, missingItems } = this.applyFilteringToMappedItems(
        mappedResult,
        config
      );
      logger.debug('Source data mapped to items', {
        label: 'Letterboxd Collections Debug',
        configName: config.name,
        itemsLength: items.length,
        missingItemsLength: missingItems?.length || 0,
      });

      if (missingItems && missingItems.length > 0) {
        logger.debug('Processing auto requests', {
          label: 'Letterboxd Collections Debug',
          configName: config.name,
          missingItemsCount: missingItems.length,
        });
        await this.handleAutoRequests(missingItems, config);
      }

      if (items.length === 0) {
        logger.debug('No items found, returning early', {
          label: 'Letterboxd Collections Debug',
          configName: config.name,
        });
        return { created: 0, updated: 0 };
      }

      logger.debug('Processing collection creation', {
        label: 'Letterboxd Collections Debug',
        configName: config.name,
        mediaType: getCollectionMediaType(config),
        itemsCount: items.length,
      });

      // Letterboxd is movies only, so use movie template generation
      const mediaType = 'movie';
      const collectionName = await this.generateCollectionNameWithCustom(
        config,
        mediaType
      );

      const result = await this.createCollection(
        items,
        mediaType,
        collectionName,
        plexClient,
        allCollections,
        config,
        processedCollectionKeys
      );

      return {
        created: result.created,
        updated: result.updated,
      };
    } catch (error) {
      logger.error(
        `Error in Letterboxd processConfiguration for ${config.name}:`,
        {
          label: 'Letterboxd Collections',
          configName: config.name,
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );
      return { created: 0, updated: 0 };
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
    await processMissingItemsWithMode(missingItems, config, 'letterboxd');
  }

  private parseLetterboxdListHtml(
    html: string,
    maxItems: number
  ): LetterboxdListItem[] {
    const items: LetterboxdListItem[] = [];

    try {
      // Parse HTML using simple regex patterns based on Kometa's approach
      // Look for poster containers and film details
      const posterContainerRegex =
        /<li[^>]*class="[^"]*(?:poster-container|film-detail)[^"]*"[^>]*>(.*?)<\/li>/gs;
      const filmIdRegex = /data-film-id="([^"]+)"/;
      const targetLinkRegex = /data-target-link="([^"]+)"/;
      const yearRegex = /<small[^>]*>.*?<a[^>]*>(\d{4})<\/a>/;
      const titleRegex = /<img[^>]*alt="([^"]+)"/;

      let match;
      let count = 0;

      while (
        (match = posterContainerRegex.exec(html)) !== null &&
        count < maxItems
      ) {
        const itemHtml = match[1];

        // Extract film ID
        const filmIdMatch = itemHtml.match(filmIdRegex);
        if (!filmIdMatch) continue;

        // Extract target link (movie slug)
        const targetLinkMatch = itemHtml.match(targetLinkRegex);
        if (!targetLinkMatch) continue;

        // Extract year
        const yearMatch = itemHtml.match(yearRegex);
        const year = yearMatch
          ? parseInt(yearMatch[1])
          : new Date().getFullYear();

        // Extract title from img alt text
        const titleMatch = itemHtml.match(titleRegex);
        if (!titleMatch) continue;

        const title = titleMatch[1];
        const slug = targetLinkMatch[1];
        const letterboxdUrl = `https://letterboxd.com${slug}`;

        items.push({
          title: title,
          year: year,
          letterboxdUrl: letterboxdUrl,
        });

        count++;
      }

      logger.info(
        `Successfully parsed ${items.length} movies from Letterboxd list`,
        {
          label: 'Letterboxd Collections',
          itemCount: items.length,
          requestedMax: maxItems,
        }
      );
    } catch (error) {
      logger.error('Error parsing Letterboxd HTML:', {
        label: 'Letterboxd Collections',
        error: error instanceof Error ? error.message : 'Unknown error',
        htmlLength: html.length,
      });
    }

    return items;
  }

  private extractListNameFromUrl(url: string): string {
    const match = url.match(/letterboxd\.com\/[^/]+\/list\/([^/?]+)/);
    if (match) {
      return match[1]
        .replace(/-/g, ' ')
        .replace(/\b\w/g, (l: string) => l.toUpperCase());
    }
    return '';
  }
}
