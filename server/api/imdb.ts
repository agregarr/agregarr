import { ImdbAxiosClient } from '@server/lib/collections/utils/ImdbAxiosClient';
import logger from '@server/logger';

/**
 * IMDb List Item interface
 */
export interface ImdbListItem {
  imdbId: string;
  title: string;
  year?: number;
  type: 'movie' | 'tv';
  tmdbId?: number; // Will be resolved separately
  isEpisode?: boolean; // True if this is an individual episode
  episodeInfo?: {
    episodeTitle?: string;
    season?: number;
    episode?: number;
  };
}

/**
 * IMDb List interface
 */
export interface ImdbList {
  id: string;
  title: string;
  description?: string;
  items: ImdbListItem[];
  totalItems: number;
}

/**
 * IMDb Top Lists enum for predefined lists
 */
export enum ImdbTopList {
  TOP_250_MOVIES = 'top250movies',
  TOP_250_ENGLISH_MOVIES = 'top250englishmovies',
  TOP_250_TV = 'top250tv',
  POPULAR_MOVIES = 'popularmovies',
  POPULAR_TV = 'populartv',
  MOST_POPULAR_MOVIES = 'mostpopularmovies',
  MOST_POPULAR_TV = 'mostpopulartv',
}

/**
 * IMDb Top 250 ranking result
 */
export interface ImdbTop250Result {
  isTop250: boolean;
  rank?: number; // 1-250 if in top 250
}

/**
 * IMDb API client for fetching lists and popular content
 *
 * Uses the shared ImdbAxiosClient which handles AWS WAF challenges
 * and maintains cookies for reliable access to IMDb.
 */
class ImdbAPI {
  // Cache for Top 250 lists (refreshed periodically)
  private top250MoviesCache: Map<string, number> = new Map();
  private top250TvCache: Map<string, number> = new Map();
  private top250LastRefresh: { movies?: number; tv?: number } = {};
  private readonly TOP250_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

  /**
   * Get a predefined IMDb top list
   */
  public async getTopList(
    listType: ImdbTopList,
    limit = 50
  ): Promise<ImdbListItem[]> {
    try {
      let url: string;
      let expectedType: 'movie' | 'tv';

      switch (listType) {
        case ImdbTopList.TOP_250_MOVIES:
          url = 'https://www.imdb.com/chart/top/';
          expectedType = 'movie';
          break;
        case ImdbTopList.TOP_250_ENGLISH_MOVIES:
          url = 'https://www.imdb.com/chart/top-english-movies/';
          expectedType = 'movie';
          break;
        case ImdbTopList.TOP_250_TV:
          url = 'https://www.imdb.com/chart/toptv/';
          expectedType = 'tv';
          break;
        case ImdbTopList.POPULAR_MOVIES:
          url = 'https://www.imdb.com/chart/moviemeter/';
          expectedType = 'movie';
          break;
        case ImdbTopList.POPULAR_TV:
          url = 'https://www.imdb.com/chart/tvmeter/';
          expectedType = 'tv';
          break;
        case ImdbTopList.MOST_POPULAR_MOVIES:
          url = 'https://www.imdb.com/chart/boxoffice/';
          expectedType = 'movie';
          break;
        case ImdbTopList.MOST_POPULAR_TV:
          url = 'https://www.imdb.com/chart/tvpopular/';
          expectedType = 'tv';
          break;
        default:
          throw new Error(`Unknown IMDb top list type: ${listType}`);
      }

      // Use the shared ImdbAxiosClient with WAF handling
      const axios = await ImdbAxiosClient.getInstance();
      const response = await axios.get(url, { timeout: 30000 });
      const html = response.data as string;

      return this.parseTopListHtml(html, expectedType, limit);
    } catch (error) {
      logger.error(`Failed to fetch IMDb top list ${listType}:`, {
        label: 'IMDb API',
        error: error instanceof Error ? error.message : 'Unknown error',
        listType,
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw new Error(
        `Failed to fetch IMDb top list: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  /**
   * Parse HTML for top lists (Top 250, Popular, etc.)
   * Uses JSON-LD structured data which IMDb provides for all chart pages.
   */
  private parseTopListHtml(
    html: string,
    expectedType: 'movie' | 'tv',
    limit: number
  ): ImdbListItem[] {
    const items = this.parseJsonLd(html, expectedType, limit);

    if (items.length > 0) {
      logger.debug('Parsed IMDb list from JSON-LD', {
        label: 'IMDb API',
        itemCount: items.length,
        expectedType,
      });
    } else {
      logger.warn('No items found in IMDb JSON-LD data', {
        label: 'IMDb API',
        expectedType,
      });
    }

    return items;
  }

  /**
   * Parse JSON-LD structured data from IMDb page
   * IMDb includes ItemList schema with all items - much more reliable than HTML scraping
   */
  private parseJsonLd(
    html: string,
    expectedType: 'movie' | 'tv',
    limit: number
  ): ImdbListItem[] {
    try {
      // Look for ItemList JSON-LD script
      const jsonLdMatch = html.match(
        /<script type="application\/ld\+json">(\{"@type":"ItemList"[^<]+)<\/script>/
      );

      if (!jsonLdMatch) {
        return [];
      }

      const data = JSON.parse(jsonLdMatch[1]) as {
        itemListElement?: {
          item?: {
            url?: string;
            name?: string;
          };
        }[];
      };

      const itemListElement = data.itemListElement || [];
      const items: ImdbListItem[] = [];

      for (let i = 0; i < Math.min(itemListElement.length, limit); i++) {
        const listItem = itemListElement[i];
        const movie = listItem.item;

        if (!movie?.url || !movie?.name) continue;

        // Extract IMDb ID from URL (e.g., https://www.imdb.com/title/tt0111161/)
        const urlMatch = movie.url.match(/\/title\/(tt\d+)/);
        if (!urlMatch) continue;

        const imdbId = urlMatch[1];

        items.push({
          imdbId,
          title: movie.name,
          type: expectedType,
        });
      }

      return items;
    } catch (error) {
      logger.debug('Failed to parse JSON-LD from IMDb page', {
        label: 'IMDb API',
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Validate if a URL is a valid IMDb list URL
   */
  public static isValidListUrl(url: string): boolean {
    return /imdb\.com\/list\/ls\d+/.test(url);
  }

  /**
   * Get the predefined list label for display
   */
  public static getTopListLabel(listType: ImdbTopList): string {
    switch (listType) {
      case ImdbTopList.TOP_250_MOVIES:
        return 'Top 250 Movies';
      case ImdbTopList.TOP_250_ENGLISH_MOVIES:
        return 'Top 250 English Movies';
      case ImdbTopList.TOP_250_TV:
        return 'Top 250 TV Shows';
      case ImdbTopList.POPULAR_MOVIES:
        return 'Popular Movies';
      case ImdbTopList.POPULAR_TV:
        return 'Popular TV Shows';
      case ImdbTopList.MOST_POPULAR_MOVIES:
        return 'Most Popular Movies';
      case ImdbTopList.MOST_POPULAR_TV:
        return 'Most Popular TV Shows';
      default:
        return 'IMDb List';
    }
  }

  /**
   * Refresh Top 250 cache for a specific type
   */
  private async refreshTop250Cache(type: 'movie' | 'tv'): Promise<void> {
    try {
      const listType =
        type === 'movie' ? ImdbTopList.TOP_250_MOVIES : ImdbTopList.TOP_250_TV;

      logger.info(`Refreshing IMDb Top 250 ${type} cache`, {
        label: 'IMDb API',
      });

      const items = await this.getTopList(listType, 250);

      // Build cache map: imdbId -> rank (1-based)
      const cache =
        type === 'movie' ? this.top250MoviesCache : this.top250TvCache;
      cache.clear();

      items.forEach((item, index) => {
        cache.set(item.imdbId, index + 1); // Rank is 1-based
      });

      this.top250LastRefresh[type === 'movie' ? 'movies' : 'tv'] = Date.now();

      logger.info(`IMDb Top 250 ${type} cache refreshed`, {
        label: 'IMDb API',
        itemCount: cache.size,
      });
    } catch (error) {
      logger.error(`Failed to refresh IMDb Top 250 ${type} cache`, {
        label: 'IMDb API',
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - fall back to empty cache
    }
  }

  /**
   * Check if Top 250 cache needs refresh
   */
  private needsRefresh(type: 'movie' | 'tv'): boolean {
    const lastRefresh =
      this.top250LastRefresh[type === 'movie' ? 'movies' : 'tv'];
    if (!lastRefresh) return true;
    return Date.now() - lastRefresh > this.TOP250_CACHE_TTL;
  }

  /**
   * Check if an IMDb ID is in the Top 250 and get its ranking
   *
   * @param imdbId - IMDb ID (e.g., "tt0111161")
   * @param type - Media type ('movie' or 'tv')
   * @returns Top 250 result with isTop250 flag and optional rank
   */
  public async checkTop250(
    imdbId: string,
    type: 'movie' | 'tv'
  ): Promise<ImdbTop250Result> {
    try {
      // Refresh cache if needed
      if (this.needsRefresh(type)) {
        await this.refreshTop250Cache(type);
      }

      const cache =
        type === 'movie' ? this.top250MoviesCache : this.top250TvCache;
      const rank = cache.get(imdbId);

      if (rank !== undefined) {
        return {
          isTop250: true,
          rank,
        };
      }

      return {
        isTop250: false,
      };
    } catch (error) {
      logger.error(`Failed to check IMDb Top 250 for ${imdbId}`, {
        label: 'IMDb API',
        imdbId,
        type,
        error: error instanceof Error ? error.message : String(error),
      });

      // Return false on error (don't fail overlay rendering)
      return {
        isTop250: false,
      };
    }
  }
}

export default ImdbAPI;
