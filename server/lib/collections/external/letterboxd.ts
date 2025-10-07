import type PlexAPI from '@server/api/plexapi';
import TmdbAPI from '@server/api/themoviedb';
import type { TmdbMovieResult } from '@server/api/themoviedb/interfaces';
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
import { RandomListManager } from '@server/lib/collections/utils/RandomListManager';
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
  private lastFetchedHtml = '';
  private dynamicRandomTitle: string | null = null;

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

  public async fetchSourceData(
    config: CollectionConfig,
    options?: CollectionSyncOptions,
    libraryCache?: LibraryItemsCache
  ): Promise<LetterboxdSourceData[]> {
    try {
      if (config.subtype === 'custom' && !config.letterboxdCustomListUrl) {
        throw this.createSyncError(
          CollectionSyncErrorType.CONFIGURATION_ERROR,
          'Custom Letterboxd list URL is required'
        );
      }

      if (config.subtype !== 'custom' && config.subtype !== 'random') {
        throw this.createSyncError(
          CollectionSyncErrorType.CONFIGURATION_ERROR,
          'Only custom and random Letterboxd lists are supported'
        );
      }

      // Determine which URL to use based on subtype
      let listUrl: string;
      if (config.subtype === 'random') {
        // Get a random URL from RandomListManager with media type validation
        const mediaType = getCollectionMediaType(config);
        const randomResult = await RandomListManager.getRandomUrlWithTitle(
          'letterboxd',
          9999,
          mediaType,
          libraryCache
        );
        if (!randomResult) {
          throw this.createSyncError(
            CollectionSyncErrorType.CONFIGURATION_ERROR,
            `No random Letterboxd lists available with ${mediaType} content`
          );
        }

        const { url: randomUrl, title: listTitle } = randomResult;
        listUrl = randomUrl;

        // Store the dynamic title for use in generateCollectionNameWithCustom
        if (config.template === 'DYNAMIC_RANDOM_TITLE') {
          this.dynamicRandomTitle = listTitle;
          this.updateCollectionConfigField(config.id, { name: listTitle });
        }

        logger.info(`Using random Letterboxd list: ${randomUrl}`, {
          label: 'Letterboxd Collections',
          collection: config.name,
          randomUrl,
          listTitle,
        });
      } else {
        // Use custom URL
        if (!config.letterboxdCustomListUrl) {
          throw this.createSyncError(
            CollectionSyncErrorType.CONFIGURATION_ERROR,
            'Custom Letterboxd list URL is required but not provided'
          );
        }
        listUrl = config.letterboxdCustomListUrl;
      }

      // Use the same approach as fetch-title endpoint
      const axios = (await import('axios')).default;

      logger.debug(`Fetching Letterboxd list: ${listUrl}`, {
        label: 'Letterboxd Collections',
        configName: config.name,
        url: listUrl,
        subtype: config.subtype,
      });

      // Fetch all pages to get the complete list
      const letterboxdData: LetterboxdListItem[] = [];
      let currentPage = 1;
      let totalFetched = 0;
      const maxPages = 15; // Safety limit (1001 movies ÷ 100 per page ≈ 11 pages)

      while (totalFetched < 9999 && currentPage <= maxPages) {
        const pageUrl =
          currentPage === 1 ? listUrl : `${listUrl}page/${currentPage}/`;

        logger.debug(`Fetching Letterboxd page ${currentPage}: ${pageUrl}`, {
          label: 'Letterboxd Collections',
          configName: config.name,
          page: currentPage,
          totalFetched,
        });

        const response = await axios.get(pageUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
          timeout: 10000,
        });

        // Store HTML from first page for later title extraction
        if (currentPage === 1) {
          this.lastFetchedHtml = response.data;
        }

        // Parse this page's HTML to extract movie items
        const remainingItems = 9999 - totalFetched;
        const pageData = this.parseLetterboxdListHtml(
          response.data,
          remainingItems
        );

        if (pageData.length === 0) {
          logger.debug(
            `No more items found on page ${currentPage}, stopping pagination`,
            {
              label: 'Letterboxd Collections',
              configName: config.name,
              currentPage,
              totalFetched,
            }
          );
          break; // No more items, stop pagination
        }

        letterboxdData.push(...pageData);
        totalFetched += pageData.length;

        logger.debug(
          `Page ${currentPage} complete: ${pageData.length} items (total: ${totalFetched})`,
          {
            label: 'Letterboxd Collections',
            configName: config.name,
            pageItems: pageData.length,
            totalFetched,
          }
        );

        currentPage++;

        // Small delay between pages to be respectful
        if (currentPage <= maxPages && totalFetched < 9999) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }

      logger.info(
        `Successfully fetched ${
          letterboxdData.length
        } items from Letterboxd custom list (${currentPage - 1} pages)`,
        {
          label: 'Letterboxd Collections',
          configName: config.name,
          itemCount: letterboxdData.length,
          pagesFetched: currentPage - 1,
        }
      );

      // Convert to LetterboxdSourceData and resolve TMDB IDs
      logger.info(
        `Starting TMDB ID resolution for ${letterboxdData.length} items`,
        {
          label: 'Letterboxd Collections',
          configName: config.name,
          itemsToProcess: letterboxdData.length,
        }
      );

      const sourceData: LetterboxdSourceData[] = [];
      const batchSize = 20; // Process 20 items concurrently (well under 40 req/sec limit)
      const maxItems = config.maxItems || 9999;

      // Build library index for early matching checks (if library cache provided)
      const libraryIndex = libraryCache
        ? this.buildLibraryTmdbIndex(libraryCache, config)
        : null;

      // Process items in concurrent batches
      for (let i = 0; i < letterboxdData.length; i += batchSize) {
        const batch = letterboxdData.slice(i, i + batchSize);

        // Log progress
        const percentage = Math.round(
          ((i + batch.length) / letterboxdData.length) * 100
        );
        logger.info(
          `Resolving TMDB IDs: ${Math.min(
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
            // Search for the movie on TMDB using title and year
            const searchResults = await this.tmdbClient.searchMovies({
              query: item.title,
              year: item.year,
            });

            if (searchResults.results && searchResults.results.length > 0) {
              const tmdbMovie = this.findBestTmdbMatch(
                searchResults.results,
                item.title,
                item.year
              );

              if (tmdbMovie) {
                return {
                  title: item.title,
                  year: item.year,
                  letterboxdUrl: item.letterboxdUrl,
                  tmdbId: tmdbMovie.id,
                  mediaType: 'movie' as const,
                };
              }
            }

            logger.warn(
              `No TMDB match found for Letterboxd item: ${item.title} (${item.year})`,
              {
                label: 'Letterboxd Collections',
                configName: config.name,
                itemTitle: item.title,
                itemYear: item.year,
              }
            );
            return null;
          } catch (error) {
            logger.warn(`Error resolving TMDB ID for ${item.title}:`, {
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

        // Check every 5 batches (100 items) if we have enough matched items
        const batchNumber = Math.floor(i / batchSize) + 1;
        if (libraryIndex && batchNumber % 5 === 0) {
          const matchedCount = this.countMatchedLetterboxdItems(
            sourceData,
            libraryIndex
          );

          logger.debug(
            `Letterboxd early matching check: ${matchedCount} matched items from ${sourceData.length} resolved (target: ${maxItems})`,
            {
              label: 'Letterboxd Collections',
              configName: config.name,
              matchedCount,
              resolvedCount: sourceData.length,
              maxItems,
              batchNumber,
            }
          );

          // If we have enough matched items to satisfy maxItems, stop resolving
          if (matchedCount >= maxItems) {
            logger.info(
              `Letterboxd early termination: Found ${matchedCount} matched items (target: ${maxItems}) after resolving ${sourceData.length} items`,
              {
                label: 'Letterboxd Collections',
                configName: config.name,
                matchedCount,
                maxItems,
                itemsResolved: sourceData.length,
              }
            );
            break;
          }
        }
      }

      logger.info(
        `TMDB ID resolution complete: ${sourceData.length}/${letterboxdData.length} items resolved`,
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

  public async mapSourceDataToItems(
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
      year?: number;
      originalPosition: number;
    }[] = [];
    for (let index = 0; index < sourceData.length; index++) {
      const item = sourceData[index];
      if (!item.tmdbId) {
        // Skip items without TMDB ID as we can't map them to Plex
        logger.debug(
          `Skipping Letterboxd item ${item.letterboxdUrl} (${item.title}) - no TMDB ID found`
        );
        continue;
      }
      // Letterboxd is movies only
      tmdbLookups.push({
        tmdbId: item.tmdbId,
        mediaType: 'movie',
        title: item.title,
        year: item.year,
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
        libraryCache, // OPTIMIZATION: Pass library cache to avoid repeated API calls
        false // Library-scoped search for collection creation
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
          year: lookup.year,
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
  ): Promise<LetterboxdTemplateContext> {
    const baseContext = (await this.templateEngine.createLetterboxdContext(
      mediaType,
      config.subtype || 'custom'
    )) as LetterboxdTemplateContext;

    // Try to get list name from HTML title first (more accurate), fallback to URL
    let listName = '';
    if (this.lastFetchedHtml) {
      logger.debug('Attempting HTML title extraction', {
        label: 'Letterboxd Collections',
        hasHtml: !!this.lastFetchedHtml,
        htmlLength: this.lastFetchedHtml.length,
      });
      listName = this.extractListNameFromHtml(this.lastFetchedHtml);
    } else {
      logger.warn('No HTML available for title extraction', {
        label: 'Letterboxd Collections',
        configName: config.name,
      });
    }

    // If HTML extraction failed, fallback to URL-based extraction
    if (!listName) {
      logger.debug('HTML extraction failed, falling back to URL extraction', {
        label: 'Letterboxd Collections',
        url: config.letterboxdCustomListUrl,
      });
      listName = this.extractListNameFromUrl(
        config.letterboxdCustomListUrl || ''
      );
    }

    logger.info('Final list name determined:', {
      label: 'Letterboxd Collections',
      listName,
      extractionMethod: this.lastFetchedHtml ? 'HTML' : 'URL',
    });

    return {
      ...baseContext,
      listUrl: config.letterboxdCustomListUrl || '',
      listName: listName,
    };
  }

  protected async processConfiguration(
    config: CollectionConfig,
    plexClient: PlexAPI,
    allCollections: PlexCollection[],
    processedCollectionKeys?: Set<string>,
    libraryCache?: LibraryItemsCache,
    options?: CollectionSyncOptions
  ) {
    logger.debug('Starting Letterboxd processConfiguration', {
      label: 'Letterboxd Collections Debug',
      configName: config.name,
      configId: config.id,
      subtype: config.subtype,
      mediaType: getCollectionMediaType(config),
    });

    try {
      const sourceData = await this.fetchSourceData(
        config,
        options,
        libraryCache
      );
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
        mediaType,
        libraryCache
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

  public parseLetterboxdListHtml(
    html: string,
    maxItems: number
  ): LetterboxdListItem[] {
    const items: LetterboxdListItem[] = [];

    try {
      // Parse HTML using regex patterns for the actual Letterboxd structure
      // Use multiple patterns for robustness against CSS class changes
      const patterns = [
        // Primary pattern - current structure
        /<li[^>]*class="[^"]*posteritem[^"]*"[^>]*>(.*?)<\/li>/gs,
        // Fallback pattern - any li containing film data
        /<li[^>]*[^>]*>(.*?data-film-id="[^"]*".*?)<\/li>/gs,
      ];

      const filmIdRegex = /data-film-id="([^"]+)"/;
      const targetLinkRegex = /data-target-link="([^"]+)"/;
      const fullDisplayNameRegex = /data-item-full-display-name="([^"]+)"/;
      const titleRegex = /<img[^>]*alt="([^"]+)"/;

      let matches: RegExpMatchArray[] = [];
      let patternUsed = 0;

      // Try patterns in order until we find matches
      for (let i = 0; i < patterns.length; i++) {
        matches = [...html.matchAll(patterns[i])];
        if (matches.length > 0) {
          patternUsed = i + 1;
          logger.debug(
            `Using pattern ${patternUsed} for Letterboxd parsing (found ${matches.length} matches)`,
            {
              label: 'Letterboxd Collections',
              patternUsed,
              matchCount: matches.length,
            }
          );
          break;
        }
      }

      if (matches.length === 0) {
        logger.warn(
          'No matches found with any pattern - Letterboxd structure may have changed',
          {
            label: 'Letterboxd Collections',
            htmlLength: html.length,
            patternsAttempted: patterns.length,
          }
        );
      }

      let count = 0;

      for (const match of matches) {
        if (count >= maxItems) break;
        const itemHtml = match[1];

        // Extract film ID
        const filmIdMatch = itemHtml.match(filmIdRegex);
        if (!filmIdMatch) continue;

        // Extract target link (movie slug)
        const targetLinkMatch = itemHtml.match(targetLinkRegex);
        if (!targetLinkMatch) continue;

        // Extract title from img alt text
        const titleMatch = itemHtml.match(titleRegex);
        if (!titleMatch) continue;

        // Decode HTML entities in the title
        let title = titleMatch[1];
        title = title
          .replace(/&lrm;/g, '') // Remove left-to-right mark
          .replace(/&rlm;/g, '') // Remove right-to-left mark
          .replace(/&bull;/g, '•') // Replace bullet entity with actual bullet
          .replace(/&ndash;/g, '–') // Replace en-dash
          .replace(/&mdash;/g, '—') // Replace em-dash
          .replace(/&hellip;/g, '…') // Replace ellipsis
          .replace(/&quot;/g, '"') // Replace quotes
          .replace(/&#39;/g, "'") // Replace apostrophe
          .replace(/&#039;/g, "'") // Replace apostrophe variant
          .replace(/&amp;/g, '&') // Replace ampersand (do this last)
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>');

        // Extract year from full display name (e.g., "All of Us Strangers (2023)")
        const fullDisplayNameMatch = itemHtml.match(fullDisplayNameRegex);
        let year = new Date().getFullYear(); // default fallback

        if (fullDisplayNameMatch) {
          const yearMatch = fullDisplayNameMatch[1].match(/\((\d{4})\)$/);
          if (yearMatch) {
            year = parseInt(yearMatch[1]);
          }
        }

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

  /**
   * Extract and clean the list name from HTML title, removing HTML entities and unwanted text
   */
  private extractListNameFromHtml(html: string): string {
    try {
      // Extract title from HTML
      const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
      if (!titleMatch) {
        logger.debug('No title tag found in HTML', {
          label: 'Letterboxd Collections',
          htmlLength: html.length,
        });
        return '';
      }

      let title = titleMatch[1];
      logger.debug('Extracted raw title from HTML:', {
        label: 'Letterboxd Collections',
        rawTitle: title,
      });

      // Decode HTML entities first
      title = title
        .replace(/&lrm;/g, '') // Remove left-to-right mark
        .replace(/&rlm;/g, '') // Remove right-to-left mark
        .replace(/&bull;/g, '•') // Replace bullet entity with actual bullet
        .replace(/&ndash;/g, '–') // Replace en-dash
        .replace(/&mdash;/g, '—') // Replace em-dash
        .replace(/&hellip;/g, '…') // Replace ellipsis
        .replace(/&quot;/g, '"') // Replace quotes
        .replace(/&#39;/g, "'") // Replace apostrophe
        .replace(/&amp;/g, '&') // Replace ampersand (do this last)
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');

      logger.debug('Title after HTML entity cleanup:', {
        label: 'Letterboxd Collections',
        cleanedTitle: title,
      });

      // Extract list name (everything before " • Letterboxd" or ", a list of films by")
      const patterns = [
        /^(.*?),\s*a\s+list\s+of\s+films?\s+by/i, // ", a list of films by"
        /^(.*?)\s*•\s*Letterboxd/i, // " • Letterboxd"
        /^(.*?)\s*-\s*Letterboxd/i, // " - Letterboxd"
        /^(.*?)\s*\|\s*Letterboxd/i, // " | Letterboxd"
      ];

      for (const pattern of patterns) {
        const match = title.match(pattern);
        if (match && match[1]) {
          const extractedName = match[1].trim();
          logger.info('Successfully extracted list name from HTML title:', {
            label: 'Letterboxd Collections',
            extractedName,
            usedPattern: pattern.source,
          });
          return extractedName;
        }
      }

      // If no pattern matches, return the whole title cleaned up
      const fallbackName = title
        .replace(/\s*•\s*Letterboxd.*$/i, '') // Remove " • Letterboxd" suffix
        .replace(/\s*-\s*Letterboxd.*$/i, '') // Remove " - Letterboxd" suffix
        .replace(/\s*\|\s*Letterboxd.*$/i, '') // Remove " | Letterboxd" suffix
        .trim();

      logger.info('Used fallback pattern for list name extraction:', {
        label: 'Letterboxd Collections',
        fallbackName,
      });

      return fallbackName;
    } catch (error) {
      logger.warn('Failed to extract list name from HTML title:', {
        label: 'Letterboxd Collections',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return '';
    }
  }

  /**
   * Find the best TMDB match from search results using intelligent scoring
   */
  private findBestTmdbMatch(
    results: TmdbMovieResult[],
    targetTitle: string,
    targetYear: number
  ): TmdbMovieResult | null {
    if (!results || results.length === 0) return null;

    let bestMatch = null;
    let bestScore = -1;

    for (const result of results) {
      const score = this.calculateMatchScore(result, targetTitle, targetYear);

      if (score > bestScore) {
        bestScore = score;
        bestMatch = result;
      }
    }

    // Only return a match if it meets a minimum threshold
    if (bestScore >= 0.3) {
      logger.debug(`Best TMDB match found`, {
        label: 'Letterboxd Collections',
        targetTitle,
        targetYear,
        matchedTitle: bestMatch?.title || bestMatch?.original_title,
        matchedYear: this.extractYearFromDate(bestMatch?.release_date),
        score: bestScore,
      });
      return bestMatch;
    }

    logger.warn(`No good TMDB match found (best score: ${bestScore})`, {
      label: 'Letterboxd Collections',
      targetTitle,
      targetYear,
      resultCount: results.length,
    });
    return null;
  }

  /**
   * Build a TMDB ID index from library cache for fast matching checks.
   * Only includes items from the target library.
   */
  private buildLibraryTmdbIndex(
    libraryCache: LibraryItemsCache,
    config: CollectionConfig
  ): Set<number> {
    const tmdbIds = new Set<number>();

    // Filter to target library only
    const targetLibraryId = Array.isArray(config.libraryId)
      ? config.libraryId[0]
      : config.libraryId;

    const targetCache = targetLibraryId ? libraryCache[targetLibraryId] : null;
    if (!targetCache) return tmdbIds;

    for (const item of targetCache) {
      // Extract TMDB IDs from item Guid (note: capital G in library cache type)
      const guids = Array.isArray(item.Guid) ? item.Guid : [];

      for (const guid of guids) {
        const guidStr = guid?.id;
        if (!guidStr) continue;

        // Match tmdb:// or agents.themoviedb://
        const tmdbMatch = guidStr.match(
          /(?:^|agents\.themoviedb:\/\/|tmdb:\/\/)(\d+)\b/i
        );
        if (tmdbMatch) {
          tmdbIds.add(parseInt(tmdbMatch[1]));
        }
      }
    }

    return tmdbIds;
  }

  /**
   * Count how many resolved Letterboxd items match the library.
   */
  private countMatchedLetterboxdItems(
    sourceData: LetterboxdSourceData[],
    libraryIndex: Set<number>
  ): number {
    let matchedCount = 0;

    for (const item of sourceData) {
      if (item.tmdbId && libraryIndex.has(item.tmdbId)) {
        matchedCount++;
      }
    }

    return matchedCount;
  }

  /**
   * Calculate match score for a TMDB result
   */
  private calculateMatchScore(
    result: TmdbMovieResult,
    targetTitle: string,
    targetYear: number
  ): number {
    let score = 0;

    // Get titles and year from TMDB result
    const tmdbTitle = result.title || '';
    const tmdbOriginalTitle = result.original_title || '';
    const tmdbYear = this.extractYearFromDate(result.release_date);

    // Title matching (70% of score)
    const titleScore = Math.max(
      this.calculateTitleSimilarity(targetTitle, tmdbTitle),
      this.calculateTitleSimilarity(targetTitle, tmdbOriginalTitle)
    );
    score += titleScore * 0.7;

    // Year matching (25% of score)
    if (tmdbYear && Math.abs(tmdbYear - targetYear) === 0) {
      score += 0.25; // Exact year match
    } else if (tmdbYear && Math.abs(tmdbYear - targetYear) <= 1) {
      score += 0.15; // Close year match (±1 year)
    } else if (tmdbYear && Math.abs(tmdbYear - targetYear) <= 2) {
      score += 0.05; // Somewhat close year match (±2 years)
    }

    // Popularity boost (5% of score) - normalized by typical TMDB popularity ranges
    const popularityScore = Math.min(result.popularity / 100, 1) * 0.05;
    score += popularityScore;

    return score;
  }

  /**
   * Calculate title similarity using multiple methods
   */
  private calculateTitleSimilarity(title1: string, title2: string): number {
    const clean1 = this.cleanTitle(title1);
    const clean2 = this.cleanTitle(title2);

    // Exact match
    if (clean1 === clean2) return 1.0;

    // Check if one title contains the other (for cases like "Movie" vs "Movie: Subtitle")
    if (clean1.includes(clean2) || clean2.includes(clean1)) {
      return 0.9;
    }

    // Simple word-based similarity
    const words1 = clean1.split(' ').filter((w) => w.length > 2);
    const words2 = clean2.split(' ').filter((w) => w.length > 2);

    if (words1.length === 0 || words2.length === 0) return 0;

    const commonWords = words1.filter((word) => words2.includes(word));
    const similarity =
      commonWords.length / Math.max(words1.length, words2.length);

    return similarity;
  }

  /**
   * Clean title for comparison
   */
  private cleanTitle(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^\w\s]/g, '') // Remove punctuation
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  /**
   * Extract year from TMDB date string
   */
  private extractYearFromDate(dateString?: string): number | null {
    if (!dateString) return null;
    const year = parseInt(dateString.substring(0, 4));
    return isNaN(year) ? null : year;
  }
}
