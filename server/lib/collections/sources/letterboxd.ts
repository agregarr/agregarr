import type PlexAPI from '@server/api/plexapi';
import TmdbAPI from '@server/api/themoviedb';
import type {
  TmdbMovieResult,
  TmdbTvResult,
} from '@server/api/themoviedb/interfaces';
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
  PlexLookupResult,
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
export class LetterboxdCollectionSync extends BaseCollectionSync<'letterboxd'> {
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

      if (
        config.subtype !== 'custom' &&
        config.subtype !== 'random' &&
        config.subtype !== 'watchlist'
      ) {
        throw this.createSyncError(
          CollectionSyncErrorType.CONFIGURATION_ERROR,
          'Only custom, watchlist, and random Letterboxd lists are supported'
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

      // Use Playwright to bypass Cloudflare protection
      const { CloudflareSolver } = await import(
        '@server/lib/collections/utils/CloudflareSolver'
      );

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
        // Ensure URL ends with / for proper pagination
        const normalizedUrl = listUrl.endsWith('/') ? listUrl : `${listUrl}/`;
        const pageUrl =
          currentPage === 1
            ? normalizedUrl
            : `${normalizedUrl}page/${currentPage}/`;

        logger.debug(`Fetching Letterboxd page ${currentPage}: ${pageUrl}`, {
          label: 'Letterboxd Collections',
          configName: config.name,
          page: currentPage,
          totalFetched,
        });

        // Use Playwright to bypass Cloudflare and get page content
        const html = await CloudflareSolver.fetchPage(pageUrl);

        // Store HTML from first page for later title extraction
        if (currentPage === 1) {
          this.lastFetchedHtml = html;
        }

        // Parse this page's HTML to extract movie items
        const remainingItems = 9999 - totalFetched;
        const pageData = this.parseLetterboxdListHtml(html, remainingItems);

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
        `Successfully fetched ${letterboxdData.length
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

      // Phase 1: TMDB search with exact year — confident if title matches exactly
      logger.info(`Phase 1: TMDB search for ${letterboxdData.length} items`, {
        label: 'Letterboxd Collections',
        configName: config.name,
        itemCount: letterboxdData.length,
      });
      const { confident: searchResults, uncertain: uncertainItems } =
        await this.resolveViaTmdbSearch(letterboxdData, config.name);

      logger.info(
        `Phase 1 complete: ${searchResults.size} confident, ${uncertainItems.length} need film page`,
        {
          label: 'Letterboxd Collections',
          configName: config.name,
          confident: searchResults.size,
          uncertain: uncertainItems.length,
        }
      );

      // Phase 2: For uncertain items, scrape film pages with a single shared browser
      let filmPageResults = new Map<
        string,
        { tmdbId: number; mediaType: 'movie' | 'tv' }
      >();
      if (uncertainItems.length > 0) {
        logger.info(
          `Phase 2: Scraping ${uncertainItems.length} film pages for uncertain items`,
          {
            label: 'Letterboxd Collections',
            configName: config.name,
            itemCount: uncertainItems.length,
          }
        );
        filmPageResults = await this.resolveViaFilmPages(uncertainItems);
        logger.info(
          `Phase 2 complete: ${filmPageResults.size}/${uncertainItems.length} resolved via film pages`,
          {
            label: 'Letterboxd Collections',
            configName: config.name,
            filmPageHits: filmPageResults.size,
            stillUncertain: uncertainItems.length - filmPageResults.size,
          }
        );
      }

      // Phase 3: Scored ±1 year TMDB search for anything still unresolved
      const resolvedMap = new Map<
        string,
        { tmdbId: number; mediaType: 'movie' | 'tv' }
      >();
      for (const [url, result] of searchResults) {
        resolvedMap.set(url, result);
      }
      for (const [url, result] of filmPageResults) {
        if (!resolvedMap.has(url)) {
          resolvedMap.set(url, result);
        }
      }

      const phase3Items = uncertainItems.filter(
        (item) => !resolvedMap.has(item.letterboxdUrl)
      );

      if (phase3Items.length > 0) {
        logger.info(
          `Phase 3: Scored TMDB search for ${phase3Items.length} remaining items`,
          {
            label: 'Letterboxd Collections',
            configName: config.name,
            itemCount: phase3Items.length,
          }
        );

        const batchSize = 20;
        for (let i = 0; i < phase3Items.length; i += batchSize) {
          const batch = phase3Items.slice(i, i + batchSize);
          const batchPromises = batch.map(async (item) => {
            try {
              const [
                movieYear,
                movieYearMinus,
                movieYearPlus,
                tvYear,
                tvYearMinus,
                tvYearPlus,
              ] = await Promise.all([
                this.tmdbClient.searchMovies({
                  query: item.title,
                  year: item.year,
                }),
                this.tmdbClient.searchMovies({
                  query: item.title,
                  year: item.year - 1,
                }),
                this.tmdbClient.searchMovies({
                  query: item.title,
                  year: item.year + 1,
                }),
                this.tmdbClient.searchTvShows({
                  query: item.title,
                  year: item.year,
                }),
                this.tmdbClient.searchTvShows({
                  query: item.title,
                  year: item.year - 1,
                }),
                this.tmdbClient.searchTvShows({
                  query: item.title,
                  year: item.year + 1,
                }),
              ]);

              const allMovies = [
                ...movieYear.results,
                ...movieYearMinus.results,
                ...movieYearPlus.results,
              ];
              const allTv = [
                ...tvYear.results,
                ...tvYearMinus.results,
                ...tvYearPlus.results,
              ];

              const seenIds = new Set<number>();
              const mediaResults: (TmdbMovieResult | TmdbTvResult)[] = [];

              for (const r of allMovies) {
                if (!seenIds.has(r.id)) {
                  seenIds.add(r.id);
                  mediaResults.push({ ...r, media_type: 'movie' as const });
                }
              }
              for (const r of allTv) {
                if (!seenIds.has(r.id)) {
                  seenIds.add(r.id);
                  mediaResults.push({ ...r, media_type: 'tv' as const });
                }
              }

              if (mediaResults.length > 0) {
                const bestMatch = this.findBestTmdbMatch(
                  mediaResults,
                  item.title,
                  item.year
                );
                if (bestMatch) {
                  return {
                    url: item.letterboxdUrl,
                    result: {
                      tmdbId: bestMatch.id,
                      mediaType: bestMatch.media_type,
                    },
                  };
                }
              }

              logger.warn(
                `No TMDB match found for: ${item.title} (${item.year})`,
                {
                  label: 'Letterboxd Collections',
                  configName: config.name,
                  itemTitle: item.title,
                  itemYear: item.year,
                }
              );
              return null;
            } catch (error) {
              logger.warn(`Error in phase 3 search for ${item.title}:`, {
                label: 'Letterboxd Collections',
                configName: config.name,
                error: error instanceof Error ? error.message : 'Unknown error',
                itemTitle: item.title,
              });
              return null;
            }
          });

          const batchResults = await Promise.all(batchPromises);
          for (const res of batchResults) {
            if (res) {
              resolvedMap.set(res.url, res.result);
            }
          }
        }
      }

      // Build sourceData preserving original list order
      const sourceData: LetterboxdSourceData[] = [];
      for (const item of letterboxdData) {
        const resolved = resolvedMap.get(item.letterboxdUrl);
        if (resolved) {
          sourceData.push({
            title: item.title,
            year: item.year,
            letterboxdUrl: item.letterboxdUrl,
            tmdbId: resolved.tmdbId,
            mediaType: resolved.mediaType,
          });
        }
      }

      logger.info(
        `TMDB ID resolution complete: ${sourceData.length}/${letterboxdData.length} items resolved`,
        {
          label: 'Letterboxd Collections',
          configName: config.name,
          resolvedItems: sourceData.length,
          totalItems: letterboxdData.length,
          phase1: searchResults.size,
          phase2: filmPageResults.size,
          phase3: resolvedMap.size - searchResults.size - filmPageResults.size,
        }
      );

      return sourceData;
    } catch (error) {
      // Check if it's already a CollectionSyncError (has type and message properties)
      const isCollectionSyncError =
        error &&
        typeof error === 'object' &&
        'type' in error &&
        'message' in error;

      const errorMessage =
        error instanceof Error
          ? error.message
          : isCollectionSyncError
            ? (error as { message: string }).message
            : 'Unknown error';

      logger.error('Error fetching Letterboxd source data:', {
        label: 'Letterboxd Collections',
        configName: config.name,
        error: errorMessage,
      });

      // Re-throw CollectionSyncError objects directly
      if (isCollectionSyncError) {
        throw error;
      }

      throw this.createSyncError(
        CollectionSyncErrorType.API_ERROR,
        `Failed to fetch Letterboxd data: ${errorMessage}`
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
      // Use the detected media type from TMDB search (movie or tv)
      tmdbLookups.push({
        tmdbId: item.tmdbId,
        mediaType: item.mediaType,
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
    let plexLookup: Map<string, PlexLookupResult> = new Map();

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
          tvdbId: plexItem.tvdbId,
          addedAt: plexItem.addedAt,
          releaseDate: plexItem.releaseDate,
          metadata: {
            libraryKey: plexItem.libraryKey,
            originalPosition: lookup.originalPosition, // CRITICAL: Preserve source order for multi-source interleaving
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
          source: this.source,
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
      const { items, missingItems } = await this.applyFilteringToMappedItems(
        mappedResult,
        config
      );

      logger.debug('Source data mapped to items', {
        label: 'Letterboxd Collections Debug',
        configName: config.name,
        itemsLength: items.length,
        missingItemsLength: missingItems?.length || 0,
      });

      // Tag existing items in Radarr/Sonarr (if enabled)
      await this.tagExistingItemsInArr(items, config);

      // Handle placeholder cleanup and process missing items
      const placeholderItems = await this.handlePlaceholdersAndMissingItems(
        items,
        missingItems,
        config,
        plexClient,
        libraryCache,
        missingItems && missingItems.length > 0
          ? () => this.handleAutoRequests(missingItems, config)
          : undefined
      );

      // Add placeholder items to the collection
      let finalItems = items;
      if (placeholderItems.length > 0) {
        finalItems = [...items, ...placeholderItems];
      }

      if (finalItems.length === 0) {
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
        itemsCount: finalItems.length,
      });

      // Use the config's media type for template generation
      // Letterboxd lists can contain both movies and TV shows
      const mediaType = getCollectionMediaType(config);
      const collectionName = await this.generateCollectionNameWithCustom(
        config,
        mediaType,
        libraryCache
      );

      const result = await this.createCollection(
        finalItems,
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
        // Secondary pattern - grid items (watchlists)
        /<li[^>]*class="[^"]*griditem[^"]*"[^>]*>(.*?)<\/li>/gs,
        // Fallback pattern - any li containing film data (data-item-link is current attribute)
        /<li[^>]*[^>]*>(.*?data-item-link="[^"]*".*?)<\/li>/gs,
      ];

      const itemLinkRegex = /data-item-link="([^"]+)"/;
      const fullDisplayNameRegex = /data-item-full-display-name="([^"]+)"/;
      const titleRegex = /data-item-name="([^"]+)"/;

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
        // Use the full match (match[0]) — Letterboxd puts data-item-link and
        // data-item-name as attributes on the <li> element itself
        const itemHtml = match[0];

        // Extract film link (e.g. "/film/angels-egg/")
        const itemLinkMatch = itemHtml.match(itemLinkRegex);
        if (!itemLinkMatch) continue;

        // Extract title
        const titleMatch = itemHtml.match(titleRegex);
        if (!titleMatch) continue;

        // Decode HTML entities in the title
        let title = titleMatch[1];
        // Strip year suffix like "(2004)" since year is extracted separately
        title = title.replace(/\s*\(\d{4}\)$/, '');
        title = title
          .replace(/&lrm;/g, '') // Remove left-to-right mark
          .replace(/&rlm;/g, '') // Remove right-to-left mark
          .replace(/&bull;/g, '•') // Replace bullet entity with actual bullet
          .replace(/&ndash;/g, '–') // Replace en-dash
          .replace(/&mdash;/g, '—') // Replace em-dash
          .replace(/&hellip;/g, '…') // Replace ellipsis
          .replace(/&quot;/g, '"') // Replace quotes
          .replace(/&#0?39;/g, "'") // Replace apostrophe (with or without leading zero)
          .replace(/&#x27;/g, "'") // Replace hex-encoded apostrophe
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

        const slug = itemLinkMatch[1];
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
    // Check for watchlist
    const watchlistMatch = url.match(/letterboxd\.com\/([^/]+)\/watchlist/);
    if (watchlistMatch) {
      const username = watchlistMatch[1]
        .replace(/-/g, ' ')
        .replace(/\b\w/g, (l: string) => l.toUpperCase());
      return `${username}'s Watchlist`;
    }

    // Check for standard list
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
        .replace(/&#0?39;/g, "'") // Replace apostrophe (with or without leading zero)
        .replace(/&#x27;/g, "'") // Replace hex-encoded apostrophe
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
   * Fetch the TMDB ID directly from a Letterboxd film page.
   * Letterboxd embeds a link like: <a data-track-action="TMDb" href="https://www.themoviedb.org/movie/496243/">
   */
  /**
   * Parse a TMDB ID and media type from a Letterboxd film page HTML.
   * Letterboxd embeds a link to themoviedb.org with data-track-action="TMDB".
   */
  private parseTmdbIdFromHtml(
    html: string
  ): { tmdbId: number; mediaType: 'movie' | 'tv' } | null {
    const tmdbLinkPattern =
      /<a[^>]*href="[^"]*themoviedb\.org\/(movie|tv)\/(\d+)\/?[^"]*"[^>]*data-track-action="TMDB"/;
    const tmdbLinkPatternAlt =
      /<a[^>]*data-track-action="TMDB"[^>]*href="[^"]*themoviedb\.org\/(movie|tv)\/(\d+)\/?[^"]*"/;

    const match = html.match(tmdbLinkPattern) || html.match(tmdbLinkPatternAlt);
    if (match) {
      const mediaType = match[1] as 'movie' | 'tv';
      const tmdbId = parseInt(match[2], 10);
      if (!isNaN(tmdbId)) {
        return { tmdbId, mediaType };
      }
    }

    return null;
  }

  /**
   * Phase 1: Try to resolve TMDB IDs via TMDB title+year search.
   * Returns items where the top result is an exact title and year match (confident),
   * and items where no confident match was found (uncertain — need film page scraping).
   */
  private async resolveViaTmdbSearch(
    items: LetterboxdListItem[],
    configName: string
  ): Promise<{
    confident: Map<string, { tmdbId: number; mediaType: 'movie' | 'tv' }>;
    uncertain: LetterboxdListItem[];
  }> {
    const confident = new Map<
      string,
      { tmdbId: number; mediaType: 'movie' | 'tv' }
    >();
    const uncertain: LetterboxdListItem[] = [];
    const batchSize = 20;

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);

      const batchResults = await Promise.all(
        batch.map(async (item) => {
          try {
            const normalizedTitle = item.title.toLowerCase().trim();

            const [movieResults, tvResults] = await Promise.all([
              this.tmdbClient.searchMovies({
                query: item.title,
                year: item.year,
              }),
              this.tmdbClient.searchTvShows({
                query: item.title,
                year: item.year,
              }),
            ]);

            // Collect ALL exact title+year matches across movies and TV.
            // If there are multiple matches (same title, same year), we can't be
            // confident which one Letterboxd meant — fall through to film page scraping.
            let exactMatchCount = 0;
            let exactMatchResult: {
              tmdbId: number;
              mediaType: 'movie' | 'tv';
            } | null = null;

            for (const result of movieResults.results) {
              const resultTitle = (result.title || result.original_title || '')
                .toLowerCase()
                .trim();
              const resultYear = result.release_date
                ? parseInt(result.release_date.substring(0, 4))
                : undefined;
              if (resultTitle === normalizedTitle && resultYear === item.year) {
                exactMatchCount++;
                if (exactMatchResult === null) {
                  exactMatchResult = {
                    tmdbId: result.id,
                    mediaType: 'movie' as const,
                  };
                }
              }
            }

            for (const result of tvResults.results) {
              const resultTitle = (result.name || result.original_name || '')
                .toLowerCase()
                .trim();
              const resultYear = result.first_air_date
                ? parseInt(result.first_air_date.substring(0, 4))
                : undefined;
              if (resultTitle === normalizedTitle && resultYear === item.year) {
                exactMatchCount++;
                if (exactMatchResult === null) {
                  exactMatchResult = {
                    tmdbId: result.id,
                    mediaType: 'tv' as const,
                  };
                }
              }
            }

            // Only confident when exactly one match exists — multiple same-title/year
            // results require film page scraping to get the correct TMDB ID.
            if (exactMatchCount === 1 && exactMatchResult !== null) {
              return {
                confident: true as const,
                result: exactMatchResult,
              };
            }

            return { confident: false as const, result: null };
          } catch (error) {
            logger.debug(
              `TMDB search failed for ${item.title}: ${error instanceof Error ? error.message : 'Unknown'
              }`,
              { label: 'Letterboxd Collections', configName }
            );
            return { confident: false as const, result: null };
          }
        })
      );

      for (let j = 0; j < batch.length; j++) {
        const item = batch[j];
        const res = batchResults[j];
        if (res.confident && res.result) {
          confident.set(item.letterboxdUrl, res.result);
        } else {
          uncertain.push(item);
        }
      }
    }

    return { confident, uncertain };
  }

  /**
   * Phase 2: Scrape individual Letterboxd film pages for exact TMDB IDs.
   * Uses a single shared browser instance for all pages (avoids per-URL launch overhead).
   */
  private async resolveViaFilmPages(
    items: LetterboxdListItem[]
  ): Promise<Map<string, { tmdbId: number; mediaType: 'movie' | 'tv' }>> {
    const results = new Map<
      string,
      { tmdbId: number; mediaType: 'movie' | 'tv' }
    >();

    const urls = items
      .map((item) => item.letterboxdUrl)
      .filter((url) => url?.startsWith('https://letterboxd.com/'));

    if (urls.length === 0) return results;

    const { CloudflareSolver } = await import(
      '@server/lib/collections/utils/CloudflareSolver'
    );

    const htmlMap = await CloudflareSolver.fetchPagesBatch(urls, 5);

    for (const [url, html] of htmlMap) {
      const tmdbResult = this.parseTmdbIdFromHtml(html);
      if (tmdbResult) {
        results.set(url, tmdbResult);
      }
    }

    return results;
  }

  /**
   * Find the best TMDB match from search results using intelligent scoring
   * Supports both movies and TV shows from multi-search results
   */
  private findBestTmdbMatch(
    results: (TmdbMovieResult | TmdbTvResult)[],
    targetTitle: string,
    targetYear: number
  ): TmdbMovieResult | TmdbTvResult | null {
    if (!results || results.length === 0) return null;

    let bestMatch: TmdbMovieResult | TmdbTvResult | null = null;
    let bestScore = -1;

    // Calculate scores for all candidates
    const candidateScores = results.map((result) => ({
      result,
      score: this.calculateMatchScore(result, targetTitle, targetYear),
    }));

    // Sort by score descending and take top 5
    const topCandidates = candidateScores
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    // Log top 5 candidates for debugging
    logger.debug(
      `Top 5 TMDB candidates for "${targetTitle}" (${targetYear}):`,
      {
        label: 'Letterboxd Collections',
        candidates: topCandidates.map((c) => ({
          title: this.getResultTitle(c.result),
          mediaType: c.result.media_type,
          year: this.extractYearFromResult(c.result),
          score: c.score.toFixed(3),
        })),
      }
    );

    // Best match is the first one
    if (topCandidates.length > 0) {
      bestMatch = topCandidates[0].result;
      bestScore = topCandidates[0].score;
    }

    // Only return a match if it meets a minimum threshold
    if (bestScore >= 0.4) {
      logger.debug(`Best TMDB match found`, {
        label: 'Letterboxd Collections',
        targetTitle,
        targetYear,
        matchedTitle: bestMatch ? this.getResultTitle(bestMatch) : undefined,
        matchedMediaType: bestMatch?.media_type,
        matchedYear: bestMatch
          ? this.extractYearFromResult(bestMatch)
          : undefined,
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
   * Get the title from a movie or TV result
   */
  private getResultTitle(result: TmdbMovieResult | TmdbTvResult): string {
    if (result.media_type === 'movie') {
      return result.title || result.original_title;
    }
    return result.name || result.original_name;
  }

  /**
   * Extract year from a movie or TV result
   */
  private extractYearFromResult(
    result: TmdbMovieResult | TmdbTvResult
  ): number | null {
    if (result.media_type === 'movie') {
      return this.extractYearFromDate(result.release_date);
    }
    return this.extractYearFromDate(result.first_air_date);
  }

  /**
   * Calculate match score for a TMDB result (movie or TV)
   */
  private calculateMatchScore(
    result: TmdbMovieResult | TmdbTvResult,
    targetTitle: string,
    targetYear: number
  ): number {
    let score = 0;

    // Get titles and year from TMDB result (handle both movie and TV properties)
    const tmdbTitle = this.getResultTitle(result);
    const tmdbOriginalTitle =
      result.media_type === 'movie'
        ? result.original_title || ''
        : result.original_name || '';
    const tmdbYear = this.extractYearFromResult(result);

    // Title matching (60% of score)
    const titleScore = Math.max(
      this.calculateTitleSimilarity(targetTitle, tmdbTitle),
      this.calculateTitleSimilarity(targetTitle, tmdbOriginalTitle)
    );
    score += titleScore * 0.6;

    // Year matching (30% of score)
    if (tmdbYear && tmdbYear === targetYear) {
      score += 0.3; // Exact year match
    } else if (tmdbYear && Math.abs(tmdbYear - targetYear) === 1) {
      score += 0.2; // ±1 year — festival vs theatrical release
    } else if (tmdbYear && Math.abs(tmdbYear - targetYear) === 2) {
      score += 0.1; // ±2 year match
    } else if (tmdbYear) {
      // Penalize large year differences - wrong year should lose to right year
      const yearDiff = Math.abs(tmdbYear - targetYear);
      score -= Math.min(yearDiff * 0.01, 0.3);
    }

    // Popularity boost (10% of score) - normalized by typical TMDB popularity ranges
    const popularityScore = Math.min(result.popularity / 100, 1) * 0.1;
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
    // Scale by length ratio — "columbus" in "colkatay columbus" scores lower than in "columbus 2017"
    const shorter = clean1.length <= clean2.length ? clean1 : clean2;
    const longer = clean1.length <= clean2.length ? clean2 : clean1;
    if (longer.includes(shorter)) {
      return (shorter.length / longer.length) * 0.9;
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
