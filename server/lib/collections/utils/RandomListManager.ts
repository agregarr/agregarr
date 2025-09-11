import type { TraktListResponse } from '@server/api/trakt';
import type { LibraryItemsCache } from '@server/lib/collections/core/CollectionUtilities';
import logger from '@server/logger';
import fs from 'fs';
import path from 'path';

/**
 * RandomListManager - Manages random list configuration files with built-in defaults
 *
 * Handles reading and parsing of config files for random list rotation:
 * - /config/random-lists/trakt.txt
 * - /config/random-lists/tmdb.txt
 * - /config/random-lists/imdb.txt
 * - /config/random-lists/letterboxd.txt
 *
 * Also provides built-in default lists when user configuration is not available.
 */
export class RandomListManager {
  private static configDir: string;
  private static cache: Map<
    string,
    { enabled: boolean; urls: string[]; lastRead: number }
  > = new Map();
  private static readonly CACHE_TTL = 60000; // 1 minute cache

  // Discovery cache for dynamically discovered lists
  private static discoveryCache: Map<
    string,
    { urls: string[]; lastDiscovered: number; nextRefresh: number }
  > = new Map();
  private static readonly DISCOVERY_CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

  // TMDb filtered collections cache
  private static tmdbFilteredCache: {
    collections: { id: number; name: string }[];
    lastFiltered: number;
    nextRefresh: number;
  } | null = null;
  private static readonly TMDB_FILTERED_CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

  /**
   * Initialize the RandomListManager with the config directory
   */
  public static initialize(configDirectory: string): void {
    this.configDir = path.join(configDirectory, 'random-lists');

    // Ensure the random-lists directory exists
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
      logger.info('Created random-lists config directory', {
        label: 'RandomListManager',
        path: this.configDir,
      });
    }
  }

  /**
   * Check if random lists are enabled for a given source type
   */
  public static isEnabled(
    sourceType: 'trakt' | 'tmdb' | 'imdb' | 'letterboxd'
  ): boolean {
    const config = this.readConfig(sourceType);
    return config.enabled;
  }

  /**
   * Get random list URLs for a given source type
   * Priority: User config > Dynamically discovered lists
   */
  public static async getRandomUrls(
    sourceType: 'trakt' | 'tmdb' | 'imdb' | 'letterboxd',
    targetMediaType?: 'movie' | 'tv'
  ): Promise<string[]> {
    const config = this.readConfig(sourceType);

    // Priority 1: If user has configured URLs and enabled random lists, use those
    if (config.enabled && config.urls.length > 0) {
      logger.debug(`Using user-configured random lists for ${sourceType}`, {
        label: 'RandomListManager',
        sourceType,
        count: config.urls.length,
      });
      return config.urls;
    }

    // Priority 2: Dynamically discover lists
    const discoveredUrls = await this.getDiscoveredUrls(
      sourceType,
      targetMediaType
    );
    if (discoveredUrls.length > 0) {
      logger.info(
        `Using ${discoveredUrls.length} discovered random lists for ${sourceType}`,
        {
          label: 'RandomListManager',
          sourceType,
          count: discoveredUrls.length,
        }
      );
      return discoveredUrls;
    }

    // No lists available
    logger.warn(`No random lists available for ${sourceType}`, {
      label: 'RandomListManager',
      sourceType,
    });
    return [];
  }

  /**
   * Get a random URL with title for a given source type with optional media type validation
   */
  public static async getRandomUrlWithTitle(
    sourceType: 'trakt' | 'tmdb' | 'imdb' | 'letterboxd',
    maxItems: number,
    targetMediaType?: 'movie' | 'tv',
    libraryCache?: LibraryItemsCache
  ): Promise<{ url: string; title: string } | null> {
    const result = await this.getRandomUrl(
      sourceType,
      maxItems,
      targetMediaType,
      libraryCache
    );
    if (!result) {
      return null;
    }

    const title = await this.extractTitleFromUrl(result, sourceType);
    return { url: result, title };
  }

  /**
   * Extract title from a list URL using the same logic as the fetch-title endpoint
   */
  private static async extractTitleFromUrl(
    url: string,
    sourceType: 'trakt' | 'tmdb' | 'imdb' | 'letterboxd'
  ): Promise<string> {
    try {
      switch (sourceType) {
        case 'trakt': {
          const TraktAPI = (await import('@server/api/trakt')).default;
          const { getSettings } = await import('@server/lib/settings');
          const settings = getSettings();

          if (!settings.trakt.apiKey) {
            return 'Trakt List';
          }

          const traktClient = new TraktAPI(settings.trakt.apiKey);

          // Parse the URL to extract username and list slug
          const userListMatch = url.match(
            /trakt\.tv\/users\/([^/]+)\/lists\/([^/?]+)/
          );
          const officialListMatch = url.match(
            /trakt\.tv\/lists\/official\/([^/?]+)/
          );

          try {
            if (userListMatch) {
              const [, username, listSlug] = userListMatch;
              const listMetadata = await traktClient.getListMetadata(
                `https://trakt.tv/users/${username}/lists/${listSlug}`
              );
              return listMetadata.name || 'Trakt List';
            } else if (officialListMatch) {
              // For official lists, we might need different handling
              return 'Trakt Official List';
            }
          } catch (error) {
            // Fallback to slug conversion if API call fails
            const match = userListMatch || officialListMatch;
            if (match && match[2]) {
              return match[2]
                .replace(/-/g, ' ')
                .replace(/\b\w/g, (l: string) => l.toUpperCase());
            }
          }

          return 'Trakt List';
        }

        case 'tmdb': {
          const TheMovieDb = (await import('@server/api/themoviedb')).default;
          const tmdbClient = new TheMovieDb();

          const urlMatch = url.match(/themoviedb\.org\/collection\/(\d+)/);
          if (urlMatch) {
            const collectionId = parseInt(urlMatch[1]);
            const collection = await tmdbClient.getCollection({ collectionId });
            return collection.name;
          }
          return 'TMDb Collection';
        }

        case 'imdb': {
          const axios = (await import('axios')).default;

          const response = await axios.get(url, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            },
            timeout: 10000,
          });

          // Extract title from HTML using the same logic as fetch-title endpoint
          const titleMatch = response.data.match(/<title>([^<]+)<\/title>/i);
          if (titleMatch) {
            let title = titleMatch[1].replace(' - IMDb', '').trim();

            // Decode HTML entities (same as Letterboxd)
            title = title
              .replace(/&lrm;/g, '') // Remove left-to-right mark
              .replace(/&rlm;/g, '') // Remove right-to-left mark
              .replace(/&bull;/g, '•') // Replace bullet entity with actual bullet
              .replace(/&ndash;/g, '–') // Replace en-dash
              .replace(/&mdash;/g, '—') // Replace em-dash
              .replace(/&hellip;/g, '…') // Replace ellipsis
              .replace(/&quot;/g, '"') // Replace quotes
              .replace(/&#39;/g, "'") // Replace apostrophe
              .replace(/&#x27;/g, "'") // Replace hex-encoded apostrophe
              .replace(/&amp;/g, '&') // Replace ampersand (do this last)
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>');

            return title;
          }

          return 'IMDb List';
        }

        case 'letterboxd': {
          const axios = (await import('axios')).default;

          const response = await axios.get(url, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            },
            timeout: 10000,
          });

          // Extract title from HTML and clean it up using same logic as fetch-title endpoint
          const titleMatch = response.data.match(/<title>([^<]+)<\/title>/i);
          if (titleMatch) {
            let rawTitle = titleMatch[1];

            // Decode HTML entities
            rawTitle = rawTitle
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

            // Extract list name (everything before " • Letterboxd" or ", a list of films by")
            const patterns = [
              /^(.*?),\s*a\s+list\s+of\s+films?\s+by/i, // ", a list of films by"
              /^(.*?)\s*•\s*Letterboxd/i, // " • Letterboxd"
              /^(.*?)\s*-\s*Letterboxd/i, // " - Letterboxd"
              /^(.*?)\s*\|\s*Letterboxd/i, // " | Letterboxd"
            ];

            for (const pattern of patterns) {
              const match = rawTitle.match(pattern);
              if (match && match[1]) {
                return match[1].trim();
              }
            }

            // If no pattern matched, use fallback cleanup
            return rawTitle
              .replace(/\s*•\s*Letterboxd.*$/i, '') // Remove " • Letterboxd" suffix
              .replace(/\s*-\s*Letterboxd.*$/i, '') // Remove " - Letterboxd" suffix
              .replace(/\s*\|\s*Letterboxd.*$/i, '') // Remove " | Letterboxd" suffix
              .trim();
          }

          return 'Letterboxd List';
        }

        default:
          return 'Random List';
      }
    } catch (error) {
      logger.warn(`Failed to extract title from ${sourceType} URL: ${url}`, {
        label: 'RandomListManager',
        sourceType,
        url,
        error: error instanceof Error ? error.message : String(error),
      });
      return `${sourceType.charAt(0).toUpperCase() + sourceType.slice(1)} List`;
    }
  }

  /**
   * Get a random URL from available lists for a source type
   * Validates that the URL contains enough items of the target media type
   */
  public static async getRandomUrl(
    sourceType: 'trakt' | 'tmdb' | 'imdb' | 'letterboxd',
    maxItems: number,
    targetMediaType?: 'movie' | 'tv',
    libraryCache?: LibraryItemsCache
  ): Promise<string | null> {
    const urls = await this.getRandomUrls(sourceType, targetMediaType);
    if (urls.length === 0) {
      logger.warn(`No random URLs available for source type: ${sourceType}`, {
        label: 'RandomListManager',
        sourceType,
      });
      return null;
    }

    // If no media type validation needed, use old behavior
    if (!targetMediaType) {
      const randomIndex = Math.floor(Math.random() * urls.length);
      const selectedUrl = urls[randomIndex];

      logger.info(`Selected random URL for ${sourceType}: ${selectedUrl}`, {
        label: 'RandomListManager',
        sourceType,
        selectedUrl,
        totalUrls: urls.length,
      });

      return selectedUrl;
    }

    // Early filtering for incompatible source/media type combinations
    if (
      (sourceType === 'letterboxd' || sourceType === 'tmdb') &&
      targetMediaType === 'tv'
    ) {
      logger.warn(
        `Source ${sourceType} does not support TV content, skipping validation attempts`,
        {
          label: 'RandomListManager',
          sourceType,
          targetMediaType,
        }
      );
      return null;
    }

    // Try up to 500 random URLs to find one suitable for target media type
    const maxAttempts = Math.min(500, urls.length);
    const triedUrls = new Set<string>();

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let randomIndex: number;
      let selectedUrl: string;

      // Find an untried URL
      do {
        randomIndex = Math.floor(Math.random() * urls.length);
        selectedUrl = urls[randomIndex];
      } while (triedUrls.has(selectedUrl) && triedUrls.size < urls.length);

      triedUrls.add(selectedUrl);

      logger.debug(
        `Validating random URL (attempt ${attempt + 1}): ${selectedUrl}`,
        {
          label: 'RandomListManager',
          sourceType,
          targetMediaType,
          maxItems,
        }
      );

      // Validate this URL has enough items of target type
      try {
        const isValid = await this.validateUrlForMediaType(
          selectedUrl,
          sourceType,
          targetMediaType,
          maxItems,
          libraryCache
        );

        if (isValid) {
          logger.info(
            `Selected validated random URL for ${sourceType}: ${selectedUrl}`,
            {
              label: 'RandomListManager',
              sourceType,
              targetMediaType,
              selectedUrl,
              attempt: attempt + 1,
            }
          );

          return selectedUrl;
        }
      } catch (error) {
        logger.debug(`Failed to validate URL ${selectedUrl}:`, {
          label: 'RandomListManager',
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue to next URL
      }
    }

    logger.warn(
      `Could not find valid random URL for ${sourceType} with ${targetMediaType} content after ${maxAttempts} attempts`,
      {
        label: 'RandomListManager',
        sourceType,
        targetMediaType,
        maxItems,
        triedUrls: triedUrls.size,
      }
    );

    return null;
  }

  /**
   * Get dynamically discovered URLs for a source type
   */
  private static async getDiscoveredUrls(
    sourceType: 'trakt' | 'tmdb' | 'imdb' | 'letterboxd',
    targetMediaType?: 'movie' | 'tv'
  ): Promise<string[]> {
    const now = Date.now();
    const cacheKey = targetMediaType
      ? `${sourceType}-${targetMediaType}`
      : sourceType;
    const cached = this.discoveryCache.get(cacheKey);

    // Return cached results if still valid
    if (cached && now < cached.nextRefresh) {
      logger.debug(`Using cached discovered lists for ${sourceType}`, {
        label: 'RandomListManager',
        sourceType,
        count: cached.urls.length,
        cacheAge: Math.round((now - cached.lastDiscovered) / (1000 * 60 * 60)),
      });
      return cached.urls;
    }

    // Discover new lists
    logger.info(`Discovering new random lists for ${sourceType}...`, {
      label: 'RandomListManager',
      sourceType,
    });

    try {
      const discoveredUrls = await this.discoverLists(
        sourceType,
        targetMediaType
      );

      // Cache the results
      this.discoveryCache.set(cacheKey, {
        urls: discoveredUrls,
        lastDiscovered: now,
        nextRefresh: now + this.DISCOVERY_CACHE_TTL,
      });

      logger.info(
        `Discovered ${discoveredUrls.length} lists for ${sourceType}`,
        {
          label: 'RandomListManager',
          sourceType,
          count: discoveredUrls.length,
        }
      );

      return discoveredUrls;
    } catch (error) {
      logger.error(`Failed to discover lists for ${sourceType}`, {
        label: 'RandomListManager',
        sourceType,
        error: error instanceof Error ? error.message : String(error),
      });

      // Return cached results if available, even if expired
      if (cached) {
        logger.warn(
          `Using expired cache for ${sourceType} due to discovery failure`,
          {
            label: 'RandomListManager',
            sourceType,
            count: cached.urls.length,
          }
        );
        return cached.urls;
      }

      return [];
    }
  }

  /**
   * Discover lists dynamically for each source type
   */
  private static async discoverLists(
    sourceType: 'trakt' | 'tmdb' | 'imdb' | 'letterboxd',
    targetMediaType?: 'movie' | 'tv'
  ): Promise<string[]> {
    switch (sourceType) {
      case 'trakt':
        return this.discoverTraktLists();
      case 'tmdb':
        return this.discoverTmdbCollections();
      case 'imdb':
        return this.discoverImdbLists(targetMediaType);
      case 'letterboxd':
        return this.discoverLetterboxdLists();
      default:
        throw new Error(`Unknown source type: ${sourceType}`);
    }
  }

  /**
   * Discover Trakt lists using API endpoints
   */
  private static async discoverTraktLists(): Promise<string[]> {
    try {
      const { getSettings } = await import('@server/lib/settings');
      const settings = getSettings();
      const apiKey = settings.trakt.apiKey;

      if (!apiKey) {
        logger.warn('Trakt API key not configured, skipping list discovery', {
          label: 'RandomListManager',
        });
        return [];
      }

      const { default: TraktAPI } = await import('@server/api/trakt');
      const traktClient = new TraktAPI(apiKey);

      const discoveredUrls: string[] = [];

      // 1. Get popular lists
      try {
        const popularLists = await traktClient.getPopularLists(50);
        for (const list of popularLists) {
          // API returns TraktListSummary directly
          if (list && list.privacy === 'public' && list.item_count > 10) {
            const url = `https://trakt.tv/users/${list.user.username}/lists/${list.ids.slug}`;
            discoveredUrls.push(url);
          }
        }
        logger.debug(`Found ${popularLists.length} popular Trakt lists`, {
          label: 'RandomListManager',
          added: popularLists.filter(
            (list) => list?.privacy === 'public' && list?.item_count > 10
          ).length,
        });
      } catch (error) {
        logger.warn('Failed to fetch popular Trakt lists', {
          label: 'RandomListManager',
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // 2. Get trending lists
      try {
        const trendingLists = await traktClient.getTrendingLists(50);
        for (const list of trendingLists) {
          // API returns TraktListSummary directly
          if (list && list.privacy === 'public' && list.item_count > 10) {
            const url = `https://trakt.tv/users/${list.user.username}/lists/${list.ids.slug}`;
            if (!discoveredUrls.includes(url)) {
              discoveredUrls.push(url);
            }
          }
        }
        logger.debug(`Found ${trendingLists.length} trending Trakt lists`, {
          label: 'RandomListManager',
          newAdded: trendingLists.filter((list) => {
            return (
              list?.privacy === 'public' &&
              list?.item_count > 10 &&
              !discoveredUrls.includes(
                `https://trakt.tv/users/${list.user.username}/lists/${list.ids.slug}`
              )
            );
          }).length,
        });
      } catch (error) {
        logger.warn('Failed to fetch trending Trakt lists', {
          label: 'RandomListManager',
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // 3. Get lists from known active users
      const popularUsernames = [
        'justin',
        'giladg',
        'sp1ti',
        'hdlists',
        'movistapp',
        'donxy',
      ];
      for (const username of popularUsernames) {
        try {
          const userLists = await traktClient.getUserLists(username, 20);
          for (const list of userLists) {
            if (list.privacy === 'public' && list.item_count > 10) {
              const url = `https://trakt.tv/users/${username}/lists/${list.ids.slug}`;
              if (!discoveredUrls.includes(url)) {
                discoveredUrls.push(url);
              }
            }
          }
        } catch (error) {
          logger.debug(`Failed to fetch lists for user ${username}`, {
            label: 'RandomListManager',
            username,
            error: error instanceof Error ? error.message : String(error),
          });
          // Continue with other users
        }
      }

      logger.info(`Discovered ${discoveredUrls.length} Trakt lists`, {
        label: 'RandomListManager',
        count: discoveredUrls.length,
      });

      return discoveredUrls;
    } catch (error) {
      logger.error('Failed to discover Trakt lists', {
        label: 'RandomListManager',
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Discover TMDb collections using daily exports with quality pre-filtering
   * Strategy: Download daily collection IDs export, filter for quality, cache results
   */
  private static async discoverTmdbCollections(): Promise<string[]> {
    // Check if we have valid cached filtered collections
    const now = Date.now();
    if (this.tmdbFilteredCache && now < this.tmdbFilteredCache.nextRefresh) {
      logger.debug('Using cached filtered TMDb collections', {
        label: 'RandomListManager',
        cachedCount: this.tmdbFilteredCache.collections.length,
        cacheAge: Math.round(
          (now - this.tmdbFilteredCache.lastFiltered) / (1000 * 60 * 60 * 24)
        ),
      });

      return this.tmdbFilteredCache.collections.map(
        (c) => `https://www.themoviedb.org/collection/${c.id}`
      );
    }

    // Need to fetch and filter collections
    try {
      const axios = (await import('axios')).default;

      // Try to get yesterday's collection export (files are generated at ~7AM UTC)
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dateStr = `${String(yesterday.getMonth() + 1).padStart(
        2,
        '0'
      )}_${String(yesterday.getDate()).padStart(
        2,
        '0'
      )}_${yesterday.getFullYear()}`;
      const exportUrl = `http://files.tmdb.org/p/exports/collection_ids_${dateStr}.json.gz`;

      logger.debug('Fetching TMDb collection IDs from daily export', {
        label: 'RandomListManager',
        url: exportUrl,
      });

      // Download the gzipped collection IDs file
      const response = await axios.get(exportUrl, {
        headers: {
          'Accept-Encoding': 'gzip',
        },
        responseType: 'stream',
        timeout: 30000,
      });

      // Parse the JSONL format (one JSON object per line)
      const collections: { id: number; name: string }[] = [];
      const chunks: Buffer[] = [];

      response.data.on('data', (chunk: Buffer) => chunks.push(chunk));

      await new Promise((resolve, reject) => {
        response.data.on('end', () => resolve(undefined));
        response.data.on('error', reject);
      });

      const buffer = Buffer.concat(chunks);
      const zlib = await import('zlib');
      const decompressed = zlib.gunzipSync(buffer);
      const lines = decompressed.toString('utf8').trim().split('\n');

      for (const line of lines) {
        try {
          const collection = JSON.parse(line);
          if (collection.id && collection.name) {
            collections.push(collection);
          }
        } catch (parseError) {
          // Skip malformed lines
          continue;
        }
      }

      logger.info(
        `Loaded ${collections.length} collections from TMDb daily export`,
        {
          label: 'RandomListManager',
          totalCollections: collections.length,
        }
      );

      // Cache all collections (no pre-filtering - we'll pick random ones during sync)
      this.tmdbFilteredCache = {
        collections: collections,
        lastFiltered: now,
        nextRefresh: now + this.TMDB_FILTERED_CACHE_TTL,
      };

      logger.info(`TMDb collections cached for 30 days`, {
        label: 'RandomListManager',
        cachedCount: collections.length,
      });

      // Return URLs for all collections (random selection happens during validation)
      return collections.map(
        (c) => `https://www.themoviedb.org/collection/${c.id}`
      );
    } catch (error) {
      logger.error('Failed to discover TMDb collections from daily export', {
        label: 'RandomListManager',
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Discover IMDb lists using GraphQL API
   * Strategy: Use IMDb's GraphQL API to access all 3,500+ lists from editors profile
   */
  private static async discoverImdbLists(
    targetMediaType?: 'movie' | 'tv'
  ): Promise<string[]> {
    try {
      const axios = (await import('axios')).default;
      const discoveredUrls: string[] = [];

      // TV-related keywords to filter for when targeting TV media type
      const tvKeywords = [
        'tv',
        'television',
        'show',
        'shows',
        'series',
        'season',
        'seasons',
      ];

      let cursor = null;
      let pageCount = 0;
      const maxPages = 15; // Fetch up to 3,750 lists (15 * 250)

      logger.debug('Using IMDb GraphQL API to discover lists', {
        label: 'RandomListManager',
        maxPages,
        targetMediaType,
      });

      while (pageCount < maxPages) {
        const variables: {
          anyListTypes: string[];
          first: number;
          locale: string;
          sort: { by: string; order: string };
          urConst: string;
          after?: string;
        } = {
          anyListTypes: ['TITLES', 'PEOPLE', 'IMAGES', 'VIDEOS'],
          first: 250,
          locale: 'en-GB',
          sort: {
            by: 'DATE_MODIFIED',
            order: 'DESC',
          },
          urConst: 'ur23892615',
        };

        // Add cursor for pagination if provided
        if (cursor) {
          variables.after = cursor;
        }

        const extensions = {
          persistedQuery: {
            sha256Hash:
              'b4130fe1929cd679b4ede4babde461e41ca4da371938094961f4d453b3002d65',
            version: 1,
          },
        };

        const payload = {
          operationName: 'ListsPage',
          variables: variables,
          extensions: extensions,
        };

        try {
          const response = await axios.post(
            'https://caching.graphql.imdb.com/',
            payload,
            {
              headers: {
                'User-Agent':
                  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                Accept: 'application/json',
                'Accept-Language': 'en-US,en;q=0.9',
                'Content-Type': 'application/json',
                Referer: 'https://www.imdb.com/user/ur23892615/lists/',
                Origin: 'https://www.imdb.com',
              },
              timeout: 15000,
            }
          );

          const data = response.data.data;
          const userListSearch = data.userListSearch;

          const lists = userListSearch.edges.map(
            (edge: {
              node: {
                id: string;
                name?: { originalText?: string };
                items?: { total?: number };
                listType?: { id?: string };
              };
            }) => ({
              id: edge.node.id,
              name: edge.node.name?.originalText || 'Unknown',
              itemCount: edge.node.items?.total || 0,
              listType: edge.node.listType?.id || 'Unknown',
              url: `https://www.imdb.com/list/${edge.node.id}/`,
            })
          );

          // Filter for TV lists if targeting TV media type
          for (const list of lists) {
            if (targetMediaType === 'tv' && list.name) {
              const titleLower = list.name.toLowerCase();
              const hasTvKeyword = tvKeywords.some((keyword) =>
                titleLower.includes(keyword)
              );
              if (!hasTvKeyword) {
                continue; // Skip non-TV lists when targeting TV
              }
            }

            // Only include TITLES lists (not PEOPLE, IMAGES, VIDEOS)
            if (
              list.listType === 'TITLES' &&
              !discoveredUrls.includes(list.url)
            ) {
              discoveredUrls.push(list.url);
            }
          }

          pageCount++;

          if (!userListSearch.pageInfo.hasNextPage) {
            logger.debug(`Reached end of IMDb lists at page ${pageCount}`, {
              label: 'RandomListManager',
            });
            break;
          }

          cursor = userListSearch.pageInfo.endCursor;

          // Small delay between requests to be respectful
          if (pageCount < maxPages) {
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        } catch (error) {
          logger.warn(`Failed to fetch IMDb lists page ${pageCount + 1}`, {
            label: 'RandomListManager',
            error: error instanceof Error ? error.message : String(error),
          });
          break;
        }
      }

      const logMessage =
        targetMediaType === 'tv'
          ? `Discovered ${discoveredUrls.length} TV-filtered IMDb lists from GraphQL API`
          : `Discovered ${discoveredUrls.length} IMDb lists from GraphQL API`;

      logger.info(logMessage, {
        label: 'RandomListManager',
        count: discoveredUrls.length,
        source: 'IMDb GraphQL API',
        pagesProcessed: pageCount,
        filtered: targetMediaType === 'tv',
        targetMediaType,
      });

      return discoveredUrls;
    } catch (error) {
      logger.error('Failed to discover IMDb lists via GraphQL API', {
        label: 'RandomListManager',
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Discover Letterboxd lists using random page strategy
   * Strategy: Random page (1-250) from https://letterboxd.com/lists/popular/page/{N}/
   */
  private static async discoverLetterboxdLists(): Promise<string[]> {
    try {
      const axios = (await import('axios')).default;
      const discoveredUrls: string[] = [];

      // Pick 3 random pages from the 250 available to get good variety
      const pagesToScrape = 3;
      const scrapedPages = new Set<number>();

      for (let i = 0; i < pagesToScrape; i++) {
        let randomPage: number;
        do {
          randomPage = Math.floor(Math.random() * 250) + 1; // 1-250
        } while (scrapedPages.has(randomPage));

        scrapedPages.add(randomPage);

        try {
          const pageUrl =
            randomPage === 1
              ? 'https://letterboxd.com/lists/popular/'
              : `https://letterboxd.com/lists/popular/page/${randomPage}/`;

          logger.debug(`Scraping Letterboxd page ${randomPage}`, {
            label: 'RandomListManager',
            pageUrl,
          });

          const response = await axios.get(pageUrl, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
            timeout: 10000,
          });

          // Parse HTML to extract list URLs
          const html = response.data;

          // Look for list URLs in the format: /username/list/list-name/
          const listUrlRegex = /href="(\/[^/]+\/list\/[^/]+\/)"[^>]*>/g;
          let match;

          while ((match = listUrlRegex.exec(html)) !== null) {
            const listPath = match[1];
            const fullUrl = `https://letterboxd.com${listPath}`;

            if (!discoveredUrls.includes(fullUrl)) {
              discoveredUrls.push(fullUrl);
            }
          }

          logger.debug(
            `Found ${discoveredUrls.length} total Letterboxd lists so far`,
            {
              label: 'RandomListManager',
              page: randomPage,
              newFromThisPage: html.match(listUrlRegex)?.length || 0,
            }
          );
        } catch (error) {
          logger.warn(`Failed to scrape Letterboxd page ${randomPage}`, {
            label: 'RandomListManager',
            page: randomPage,
            error: error instanceof Error ? error.message : String(error),
          });
          // Continue with other pages
        }

        // Small delay between requests to be respectful
        if (i < pagesToScrape - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      logger.info(
        `Discovered ${discoveredUrls.length} Letterboxd lists from ${scrapedPages.size} pages`,
        {
          label: 'RandomListManager',
          count: discoveredUrls.length,
          pagesScraped: Array.from(scrapedPages),
        }
      );

      return discoveredUrls;
    } catch (error) {
      logger.error('Failed to discover Letterboxd lists', {
        label: 'RandomListManager',
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Read and parse config file for a source type
   */
  private static readConfig(
    sourceType: 'trakt' | 'tmdb' | 'imdb' | 'letterboxd'
  ): { enabled: boolean; urls: string[] } {
    const now = Date.now();
    const cached = this.cache.get(sourceType);

    // Return cached result if still valid
    if (cached && now - cached.lastRead < this.CACHE_TTL) {
      return { enabled: cached.enabled, urls: cached.urls };
    }

    const configPath = path.join(this.configDir, `${sourceType}.txt`);

    // Return disabled state if file doesn't exist
    if (!fs.existsSync(configPath)) {
      logger.warn(`Random list config file not found: ${configPath}`, {
        label: 'RandomListManager',
        sourceType,
      });

      const result = { enabled: false, urls: [] };
      this.cache.set(sourceType, { ...result, lastRead: now });
      return result;
    }

    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const config = this.parseConfig(content);

      logger.debug(`Loaded random list config for ${sourceType}`, {
        label: 'RandomListManager',
        sourceType,
        enabled: config.enabled,
        urlCount: config.urls.length,
      });

      // Cache the result
      this.cache.set(sourceType, { ...config, lastRead: now });

      return config;
    } catch (error) {
      logger.error(
        `Failed to read random list config for ${sourceType}: ${error}`,
        {
          label: 'RandomListManager',
          sourceType,
          error: error instanceof Error ? error.message : String(error),
        }
      );

      const result = { enabled: false, urls: [] };
      this.cache.set(sourceType, { ...result, lastRead: now });
      return result;
    }
  }

  /**
   * Parse config file content
   * Expected format:
   * enabled=true
   * # Comment
   * https://example.com/list1
   * https://example.com/list2
   */
  private static parseConfig(content: string): {
    enabled: boolean;
    urls: string[];
  } {
    const lines = content.split('\n').map((line) => line.trim());

    let enabled = false;
    const urls: string[] = [];

    for (const line of lines) {
      // Skip empty lines and comments
      if (!line || line.startsWith('#')) {
        continue;
      }

      // Parse enabled flag
      if (line.startsWith('enabled=')) {
        const value = line.substring('enabled='.length).toLowerCase();
        enabled = value === 'true';
        continue;
      }

      // Parse URLs - basic validation
      if (line.startsWith('http://') || line.startsWith('https://')) {
        urls.push(line);
      }
    }

    return { enabled, urls };
  }

  /**
   * Clear cache for a specific source type or all cache
   */
  public static clearCache(
    sourceType?: 'trakt' | 'tmdb' | 'imdb' | 'letterboxd'
  ): void {
    if (sourceType) {
      this.cache.delete(sourceType);
    } else {
      this.cache.clear();
    }

    logger.debug('Cleared random list cache', {
      label: 'RandomListManager',
      sourceType: sourceType || 'all',
    });
  }

  /**
   * Get cache statistics for debugging
   */
  public static getCacheStats(): Record<
    string,
    {
      enabled: boolean;
      urls: string[];
      lastUpdated: Date;
    }
  > {
    const stats: Record<
      string,
      {
        enabled: boolean;
        urls: string[];
        lastUpdated: Date;
      }
    > = {};

    for (const [sourceType, cached] of this.cache.entries()) {
      stats[sourceType] = {
        enabled: cached.enabled,
        urls: cached.urls,
        lastUpdated: new Date(cached.lastRead),
      };
    }

    return stats;
  }

  /**
   * Validate that a URL contains enough items of the target media type
   */
  private static async validateUrlForMediaType(
    url: string,
    sourceType: 'trakt' | 'tmdb' | 'imdb' | 'letterboxd',
    targetMediaType: 'movie' | 'tv',
    maxItems: number,
    libraryCache?: LibraryItemsCache
  ): Promise<boolean> {
    try {
      // Quick validation by analyzing URL patterns and making lightweight requests
      // We don't want to do full list processing here, just check media type compatibility

      switch (sourceType) {
        case 'trakt':
          return await this.validateTraktUrl(
            url,
            targetMediaType,
            maxItems,
            libraryCache
          );
        case 'tmdb':
          return await this.validateTmdbUrl(
            url,
            targetMediaType,
            maxItems,
            libraryCache
          );
        case 'imdb':
          return await this.validateImdbUrl(
            url,
            targetMediaType,
            maxItems,
            libraryCache
          );
        case 'letterboxd':
          return await this.validateLetterboxdUrl(
            url,
            targetMediaType,
            maxItems,
            libraryCache
          );
        default:
          return false;
      }
    } catch (error) {
      logger.debug(`URL validation failed for ${url}:`, {
        label: 'RandomListManager',
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Validate Trakt URL for media type compatibility
   */
  private static async validateTraktUrl(
    url: string,
    targetMediaType: 'movie' | 'tv',
    maxItems: number,
    libraryCache?: LibraryItemsCache
  ): Promise<boolean> {
    try {
      // Import TraktAPI to check the list
      const { getSettings } = await import('@server/lib/settings');
      const settings = getSettings();
      const apiKey = settings.trakt.apiKey;

      if (!apiKey) {
        return false; // Can't validate without API key
      }

      const { default: TraktAPI } = await import('@server/api/trakt');
      const traktClient = new TraktAPI(apiKey);

      // Extract list slug from URL (e.g., https://trakt.tv/users/username/lists/listname)
      const match = url.match(/\/users\/([^/]+)\/lists\/([^/?]+)/);
      if (!match) {
        return false;
      }

      const [, username, listSlug] = match;

      // Get list items with limit to check media types
      const listUrl = `https://trakt.tv/users/${username}/lists/${listSlug}`;
      const listItems = await traktClient.getCustomList(
        listUrl,
        Math.min(maxItems, 50)
      );

      // Filter items by target media type
      const targetItems = listItems.filter((item: TraktListResponse) => {
        return targetMediaType === 'movie' ? item.movie : item.show;
      });

      // Check if list has enough items of target type to fill the collection
      if (targetItems.length < maxItems) {
        return false;
      }

      // If library cache is provided, check that we have at least 4 items in Plex library
      if (libraryCache) {
        // Build efficient lookup sets from library cache
        const userTmdbIds = new Set<number>();
        const userTvdbIds = new Set<number>();
        const userImdbIds = new Set<string>();

        for (const libraryKey in libraryCache) {
          const libraryItems = libraryCache[libraryKey];
          for (const item of libraryItems) {
            if (item.Guid) {
              for (const guid of item.Guid) {
                if (guid.id.startsWith('tmdb://')) {
                  const tmdbId = parseInt(guid.id.replace('tmdb://', ''), 10);
                  if (!isNaN(tmdbId)) {
                    userTmdbIds.add(tmdbId);
                  }
                } else if (guid.id.startsWith('tvdb://')) {
                  const tvdbId = parseInt(guid.id.replace('tvdb://', ''), 10);
                  if (!isNaN(tvdbId)) {
                    userTvdbIds.add(tvdbId);
                  }
                } else if (guid.id.startsWith('imdb://')) {
                  const imdbId = guid.id.replace('imdb://', '');
                  userImdbIds.add(imdbId);
                }
              }
            }
          }
        }

        let plexMatchCount = 0;
        for (const item of targetItems) {
          const mediaItem =
            targetMediaType === 'movie' ? item.movie : item.show;
          if (!mediaItem || !mediaItem.ids) continue;

          // Check for matches using available IDs
          const tmdbId = mediaItem.ids.tmdb;
          const tvdbId =
            targetMediaType === 'tv'
              ? (mediaItem.ids as { tvdb?: number }).tvdb
              : undefined; // tvdb only exists on shows
          const imdbId = mediaItem.ids.imdb;

          if (
            (tmdbId && userTmdbIds.has(tmdbId)) ||
            (tvdbId && userTvdbIds.has(tvdbId)) ||
            (imdbId && userImdbIds.has(imdbId))
          ) {
            plexMatchCount++;
            if (plexMatchCount >= 4) {
              return true; // Found enough matches in Plex library!
            }
          }
        }

        // Need at least 4 matches in Plex library for custom lists
        return false;
      }

      // Fallback: if no library cache, just check media type compatibility
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Validate TMDb URL for media type compatibility
   */
  private static async validateTmdbUrl(
    url: string,
    targetMediaType: 'movie' | 'tv',
    maxItems: number,
    libraryCache?: LibraryItemsCache
  ): Promise<boolean> {
    try {
      // TMDb collections are movie-only by design
      if (targetMediaType === 'tv') {
        return false;
      }

      // Extract collection ID from URL
      const collectionIdMatch = url.match(/\/collection\/(\d+)/);
      if (!collectionIdMatch) {
        return false;
      }

      const collectionId = collectionIdMatch[1];

      // Import TMDb API to check the collection
      const { default: TmdbAPI } = await import('@server/api/themoviedb');
      const tmdbClient = new TmdbAPI();

      // Get collection details
      const collectionData: {
        parts?: { id?: number; release_date?: string }[];
      } = await tmdbClient.getCollection({
        collectionId: parseInt(collectionId, 10),
      });

      if (!collectionData || !collectionData.parts) {
        return false;
      }

      // Count valid movie items (filter out any invalid entries)
      const validMovieCount = collectionData.parts.filter(
        (part: { id?: number; release_date?: string }) =>
          part && part.id && part.release_date
      ).length;

      // For franchise collections, check we have at least 2 items in Plex library
      if (libraryCache) {
        // Build efficient TMDB ID lookup set from library cache
        const userTmdbIds = new Set<number>();
        for (const libraryKey in libraryCache) {
          const libraryItems = libraryCache[libraryKey];
          for (const item of libraryItems) {
            if (item.Guid) {
              for (const guid of item.Guid) {
                if (guid.id.startsWith('tmdb://')) {
                  const tmdbId = parseInt(guid.id.replace('tmdb://', ''), 10);
                  if (!isNaN(tmdbId)) {
                    userTmdbIds.add(tmdbId);
                  }
                }
              }
            }
          }
        }

        let plexMatchCount = 0;
        for (const part of collectionData.parts) {
          if (!part || !part.id) continue;

          // Fast O(1) lookup using Set
          if (userTmdbIds.has(part.id)) {
            plexMatchCount++;
            if (plexMatchCount >= 2) {
              return true; // Found a suitable franchise collection!
            }
          }
        }

        // Need at least 2 matches in Plex library for franchise collections
        return false;
      }

      // Fallback: if no library cache, just check it's a valid movie collection
      return targetMediaType === 'movie' && validMovieCount >= 2;
    } catch (error) {
      return false;
    }
  }

  /**
   * Validate IMDb URL for media type compatibility
   */
  private static async validateImdbUrl(
    url: string,
    targetMediaType: 'movie' | 'tv',
    maxItems: number,
    libraryCache?: LibraryItemsCache
  ): Promise<boolean> {
    try {
      // If library cache is provided, check that we have at least 4 items in Plex library
      if (libraryCache) {
        // Import axios for web scraping
        const axios = (await import('axios')).default;

        // Fetch the IMDb list page
        const response = await axios.get(url, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
          timeout: 10000,
        });

        // Parse the HTML to extract IMDb items using the proper parser
        const ImdbCollections = await import(
          '@server/lib/collections/external/imdb'
        );
        const imdbCollections = new ImdbCollections.default();
        const imdbItems = imdbCollections.parseImdbListHtml(
          response.data,
          Math.min(maxItems, 50)
        );

        // Filter items by target media type
        const targetItems = imdbItems.filter((item) => {
          return targetMediaType === 'movie'
            ? item.type === 'movie'
            : item.type === 'tv';
        });

        // Check if list has enough items of target type to fill the collection
        if (targetItems.length < maxItems) {
          return false;
        }

        // Build efficient TMDB ID lookup set from library cache
        const userTmdbIds = new Set<number>();

        for (const libraryKey in libraryCache) {
          const libraryItems = libraryCache[libraryKey];
          for (const item of libraryItems) {
            if (item.Guid) {
              for (const guid of item.Guid) {
                if (guid.id.startsWith('tmdb://')) {
                  const tmdbId = parseInt(guid.id.replace('tmdb://', ''), 10);
                  if (!isNaN(tmdbId)) {
                    userTmdbIds.add(tmdbId);
                  }
                }
              }
            }
          }
        }

        // For IMDb validation, we need to resolve TMDB IDs like the actual sync process does
        const ImdbCollectionsModule = await import(
          '@server/lib/collections/external/imdb'
        );
        const imdbValidator = new ImdbCollectionsModule.default();

        let plexMatchCount = 0;
        for (const item of targetItems) {
          try {
            // Resolve TMDB ID from IMDb ID (same logic as actual sync)
            const tmdbId = await imdbValidator.resolveTmdbIdFromImdbId(
              item.imdbId
            );

            // Check if this TMDB ID exists in user's Plex library
            if (tmdbId && userTmdbIds.has(tmdbId)) {
              plexMatchCount++;
              if (plexMatchCount >= 4) {
                return true; // Found enough matches in Plex library!
              }
            }
          } catch (error) {
            // Skip items that fail TMDB ID resolution
            continue;
          }
        }

        // Need at least 4 matches in Plex library for custom lists
        return false;
      }

      // Fallback: if no library cache, assume IMDb lists can contain both movies and TV shows
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Validate Letterboxd URL for media type compatibility
   */
  private static async validateLetterboxdUrl(
    url: string,
    targetMediaType: 'movie' | 'tv',
    maxItems: number,
    libraryCache?: LibraryItemsCache
  ): Promise<boolean> {
    try {
      // Letterboxd is movie-only, so only valid for movie collections
      if (targetMediaType !== 'movie') {
        return false;
      }

      // If library cache is provided, check that we have at least 4 items in Plex library
      if (libraryCache) {
        // Import axios for web scraping
        const axios = (await import('axios')).default;

        // Fetch the Letterboxd list page
        const response = await axios.get(url, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
          timeout: 10000,
        });

        // Parse the HTML to extract Letterboxd items using the proper parser
        const LetterboxdCollections = await import(
          '@server/lib/collections/external/letterboxd'
        );
        const letterboxdCollections =
          new LetterboxdCollections.LetterboxdCollectionSync();
        const letterboxdItems = letterboxdCollections.parseLetterboxdListHtml(
          response.data,
          Math.min(maxItems, 50)
        );

        // Check if list has enough items to fill the collection (all are movies)
        if (letterboxdItems.length < maxItems) {
          return false;
        }

        // Build efficient lookup sets from library cache
        const userTmdbIds = new Set<number>();
        const userImdbIds = new Set<string>();

        for (const libraryKey in libraryCache) {
          const libraryItems = libraryCache[libraryKey];
          for (const item of libraryItems) {
            if (item.Guid) {
              for (const guid of item.Guid) {
                if (guid.id.startsWith('tmdb://')) {
                  const tmdbId = parseInt(guid.id.replace('tmdb://', ''), 10);
                  if (!isNaN(tmdbId)) {
                    userTmdbIds.add(tmdbId);
                  }
                } else if (guid.id.startsWith('imdb://')) {
                  const imdbId = guid.id.replace('imdb://', '');
                  userImdbIds.add(imdbId);
                }
              }
            }
          }
        }

        // For Letterboxd validation, we need to resolve TMDb IDs like the actual sync process does
        const { default: TmdbAPI } = await import('@server/api/themoviedb');
        const tmdbClient = new TmdbAPI();

        let plexMatchCount = 0;

        for (const item of letterboxdItems) {
          try {
            // Search for the movie on TMDb using title and year (same logic as actual sync)
            const searchResults = await tmdbClient.searchMovies({
              query: item.title,
              year: item.year,
            });

            if (searchResults.results && searchResults.results.length > 0) {
              const tmdbMovie = searchResults.results[0];

              // Check if this TMDb ID exists in user's Plex library
              if (tmdbMovie.id && userTmdbIds.has(tmdbMovie.id)) {
                plexMatchCount++;
                if (plexMatchCount >= 4) {
                  return true; // Found enough matches in Plex library!
                }
              }
            }
          } catch (error) {
            // Skip items that fail TMDb lookup
            continue;
          }
        }

        // Need at least 4 matches in Plex library for custom lists
        return false;
      }

      // Fallback: if no library cache, just check it's a movie collection
      return targetMediaType === 'movie';
    } catch (error) {
      return false;
    }
  }

  /**
   * Determine if a TMDb collection meets quality criteria
   */
  private static isQualityTmdbCollection(
    collectionData: { parts?: unknown[] },
    maxItems: number
  ): boolean {
    if (!collectionData || !collectionData.parts) {
      return false;
    }

    // Only criterion: collection must have at least maxItems movies
    return collectionData.parts.length >= maxItems;
  }
}
