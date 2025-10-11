import ExternalAPI from '@server/api/externalapi';
import cacheManager from '@server/lib/cache';
import logger from '@server/logger';
import { JSDOM } from 'jsdom';

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
 * IMDb Rating interface (from Radarr proxy)
 */
export interface ImdbRating {
  title: string;
  url: string;
  criticsScore: number;
}

/**
 * IMDb Top Lists enum for predefined lists
 */
export enum ImdbTopList {
  TOP_250_MOVIES = 'top250movies',
  TOP_250_TV = 'top250tv',
  POPULAR_MOVIES = 'popularmovies',
  POPULAR_TV = 'populartv',
  MOST_POPULAR_MOVIES = 'mostpopularmovies',
  MOST_POPULAR_TV = 'mostpopulartv',
}

/**
 * IMDb API client for fetching lists and popular content
 *
 * Note: IMDb doesn't have a public API for lists, so this uses web scraping
 * for public IMDb lists. This is a best-effort implementation.
 */
class ImdbAPI extends ExternalAPI {
  constructor() {
    super('https://www.imdb.com', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        Connection: 'keep-alive',
      },
      nodeCache: cacheManager.getCache('imdb').data,
    });
  }

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
          url = '/chart/top/';
          expectedType = 'movie';
          break;
        case ImdbTopList.TOP_250_TV:
          url = '/chart/toptv/';
          expectedType = 'tv';
          break;
        case ImdbTopList.POPULAR_MOVIES:
          url = '/chart/moviemeter/';
          expectedType = 'movie';
          break;
        case ImdbTopList.POPULAR_TV:
          url = '/chart/tvmeter/';
          expectedType = 'tv';
          break;
        case ImdbTopList.MOST_POPULAR_MOVIES:
          url = '/chart/boxoffice/';
          expectedType = 'movie';
          break;
        case ImdbTopList.MOST_POPULAR_TV:
          url = '/chart/tvpopular/';
          expectedType = 'tv';
          break;
        default:
          throw new Error(`Unknown IMDb top list type: ${listType}`);
      }

      const html = await this.get<string>(url, undefined, 30000);
      return this.parseTopListHtml(html, expectedType, limit);
    } catch (error) {
      logger.error(`Failed to fetch IMDb top list ${listType}:`, {
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
   * Get a custom IMDb list by URL
   */
  public async getCustomList(
    listUrl: string,
    limit = 9999
  ): Promise<ImdbListItem[]> {
    try {
      // Extract list ID from URL
      const listMatch = listUrl.match(/\/list\/(ls\d+)/);
      if (!listMatch) {
        throw new Error('Invalid IMDb list URL format');
      }

      const listId = listMatch[1];
      const url = `/list/${listId}/`;

      const html = await this.get<string>(url, undefined, 30000);
      return this.parseCustomListHtml(html, limit);
    } catch (error) {
      logger.error(`Failed to fetch IMDb custom list ${listUrl}:`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        listUrl,
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw new Error(
        `Failed to fetch IMDb custom list: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  /**
   * Parse HTML for top lists (Top 250, Popular, etc.)
   */
  private parseTopListHtml(
    html: string,
    expectedType: 'movie' | 'tv',
    limit: number
  ): ImdbListItem[] {
    const dom = new JSDOM(html);
    const document = dom.window.document;
    const items: ImdbListItem[] = [];

    // Different selectors for different chart types
    const itemSelectors = [
      '.cli-item', // Top 250 movies/TV
      '.titleColumn', // Some chart pages
      '.ipc-title-link-wrapper', // Newer layout
      '.titleListItem', // Fallback
    ];

    let itemElements: NodeListOf<Element> | null = null;

    for (const selector of itemSelectors) {
      itemElements = document.querySelectorAll(selector);
      if (itemElements.length > 0) break;
    }

    if (!itemElements || itemElements.length === 0) {
      logger.warn('No items found in IMDb top list HTML');
      return [];
    }

    for (let i = 0; i < Math.min(itemElements.length, limit); i++) {
      const element = itemElements[i];
      const imdbId = this.extractImdbId(element);
      const title = this.extractTitle(element);
      const year = this.extractYear(element);

      if (imdbId && title) {
        items.push({
          imdbId,
          title,
          year,
          type: expectedType,
        });
      }
    }

    return items;
  }

  /**
   * Parse HTML for custom user lists
   */
  private parseCustomListHtml(html: string, limit: number): ImdbListItem[] {
    const dom = new JSDOM(html);
    const document = dom.window.document;
    const items: ImdbListItem[] = [];

    const itemElements = document.querySelectorAll('.lister-item, .ipc-title');

    for (let i = 0; i < Math.min(itemElements.length, limit); i++) {
      const element = itemElements[i];
      const imdbId = this.extractImdbId(element);
      const title = this.extractTitle(element);
      const year = this.extractYear(element);
      const type = this.inferType(element);

      if (imdbId && title) {
        items.push({
          imdbId,
          title,
          year,
          type,
        });
      }
    }

    return items;
  }

  /**
   * Extract IMDb ID from an element
   */
  private extractImdbId(element: Element): string | null {
    // Look for links with IMDb title patterns
    const linkSelectors = ['a[href*="/title/"]', '[href*="/title/"]'];

    for (const selector of linkSelectors) {
      const link = element.querySelector(selector) || element.closest(selector);
      if (link) {
        const href = link.getAttribute('href');
        const match = href?.match(/\/title\/(tt\d+)/);
        if (match) return match[1];
      }
    }

    return null;
  }

  /**
   * Extract title from an element
   */
  private extractTitle(element: Element): string | null {
    const titleSelectors = [
      '.cli-title a',
      '.titleColumn a',
      '.ipc-title__text',
      '.titleListItem .title a',
      'h3 a',
      '.title a',
      'a',
    ];

    for (const selector of titleSelectors) {
      const titleElement = element.querySelector(selector);
      if (titleElement?.textContent?.trim()) {
        return titleElement.textContent.trim();
      }
    }

    return null;
  }

  /**
   * Extract year from an element
   */
  private extractYear(element: Element): number | undefined {
    const yearSelectors = [
      '.cli-title-metadata .cli-title-metadata-item:first-child',
      '.secondaryInfo',
      '.lister-item-year',
      '.year',
    ];

    for (const selector of yearSelectors) {
      const yearElement = element.querySelector(selector);
      if (yearElement?.textContent) {
        const yearMatch = yearElement.textContent.match(/(\d{4})/);
        if (yearMatch) {
          return parseInt(yearMatch[1], 10);
        }
      }
    }

    return undefined;
  }

  /**
   * Infer media type from element content
   */
  private inferType(element: Element): 'movie' | 'tv' {
    const text = element.textContent?.toLowerCase() || '';

    // Look for TV indicators
    if (
      text.includes('tv series') ||
      text.includes('tv mini series') ||
      text.includes('episode') ||
      text.includes('season')
    ) {
      return 'tv';
    }

    // Default to movie
    return 'movie';
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
   * Get movie ratings from Radarr IMDB proxy API
   *
   * This uses the Radarr-hosted public IMDB proxy that aggregates ratings data.
   * This is a best-effort API as IMDB's official API requires paid access.
   *
   * @param imdbId - IMDB ID (e.g., "tt1234567")
   * @returns Rating data including title, URL, and critics score, or null if not found
   */
  public async getMovieRatings(imdbId: string): Promise<ImdbRating | null> {
    try {
      const response = await this.axios.get<
        {
          ImdbId: string;
          Title: string;
          MovieRatings: {
            Imdb: {
              Count: number;
              Value: number;
              Type: string;
            };
          };
        }[]
      >(`https://api.radarr.video/v1/movie/imdb/${imdbId}`, {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      });

      if (!response.data?.length || response.data[0].ImdbId !== imdbId) {
        return null;
      }

      return {
        title: response.data[0].Title,
        url: `https://www.imdb.com/title/${response.data[0].ImdbId}`,
        criticsScore: response.data[0].MovieRatings.Imdb.Value,
      };
    } catch (error) {
      logger.error(`Failed to fetch IMDB ratings for ${imdbId}:`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        imdbId,
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw new Error(
        `Failed to retrieve movie ratings: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }
}

export default ImdbAPI;
