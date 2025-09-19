import logger from '@server/logger';
import type { AxiosInstance } from 'axios';
import axios from 'axios';

export interface MDBListMovie {
  id: number;
  rank: number;
  adult: number;
  title: string;
  imdb_id: string;
  tvdb_id: number | null;
  language: string;
  mediatype: 'movie';
  release_year: number;
  spoken_language: string;
}

export interface MDBListShow {
  id: number;
  rank: number;
  adult: number;
  title: string;
  imdb_id: string;
  tvdb_id: number;
  language: string;
  mediatype: 'show';
  release_year: number;
  spoken_language: string;
}

export interface MDBListItem {
  movie?: MDBListMovie;
  show?: MDBListShow;
}

export interface MDBListResponse {
  movies: MDBListMovie[];
  shows: MDBListShow[];
}

export interface MDBListSummary {
  id: number;
  user_id: number;
  user_name: string;
  name: string;
  slug: string;
  description: string;
  mediatype: 'movie' | 'show';
  items: number;
  likes: number;
  dynamic?: boolean;
  private?: boolean;
}

export interface MDBListUserInfo {
  api_requests: number;
  api_requests_count: number;
  user_id: number;
  patron_status: string;
  patreon_pledge: number;
}

class MDBListAPI {
  private axios: AxiosInstance;

  constructor(apiKey: string) {
    this.axios = axios.create({
      baseURL: 'https://api.mdblist.com',
      params: {
        apikey: apiKey,
      },
      timeout: 30000,
    });
  }

  private async retryRequest<T>(
    requestFn: () => Promise<T>,
    maxRetries = 3,
    delay = 1000
  ): Promise<T> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await requestFn();
      } catch (error) {
        if (attempt === maxRetries) {
          throw error;
        }

        // Check if it's a retryable error (5xx or network errors)
        const isRetryable = error.response?.status >= 500 || !error.response;
        if (!isRetryable) {
          throw error;
        }

        logger.debug(
          `MDBList API request failed, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`,
          {
            label: 'MDBList API',
            error: error.message,
            status: error.response?.status,
          }
        );

        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2; // Exponential backoff
      }
    }
    throw new Error('Max retries exceeded');
  }

  /**
   * Get user's API limits and usage
   */
  public async getUserLimits(): Promise<MDBListUserInfo> {
    try {
      return await this.retryRequest(async () => {
        const response = await this.axios.get<MDBListUserInfo>('/user');
        return response.data;
      });
    } catch (e) {
      logger.error('Something went wrong fetching user limits from MDBList', {
        label: 'MDBList API',
        errorMessage: e.message,
      });
      throw new Error(`[MDBList] Failed to fetch user limits: ${e.message}`);
    }
  }

  /**
   * Get user's lists
   */
  public async getUserLists(): Promise<MDBListSummary[]> {
    try {
      return await this.retryRequest(async () => {
        const response = await this.axios.get<MDBListSummary[]>('/lists/user');
        return response.data;
      });
    } catch (e) {
      logger.error('Something went wrong fetching user lists from MDBList', {
        label: 'MDBList API',
        errorMessage: e.message,
      });
      throw new Error(`[MDBList] Failed to fetch user lists: ${e.message}`);
    }
  }

  /**
   * Get lists from a specific user by username
   */
  public async getUserListsByUsername(
    username: string
  ): Promise<MDBListSummary[]> {
    try {
      return await this.retryRequest(async () => {
        const response = await this.axios.get<MDBListSummary[]>(
          `/lists/user/${username}`
        );
        return response.data;
      });
    } catch (e) {
      logger.error(
        `Something went wrong fetching lists for user ${username} from MDBList`,
        {
          label: 'MDBList API',
          errorMessage: e.message,
          username,
        }
      );
      throw new Error(
        `[MDBList] Failed to fetch lists for user ${username}: ${e.message}`
      );
    }
  }

  /**
   * Get list details by ID
   */
  public async getListById(listId: number): Promise<MDBListSummary[]> {
    try {
      return await this.retryRequest(async () => {
        const response = await this.axios.get<MDBListSummary[]>(
          `/lists/${listId}`
        );
        return response.data;
      });
    } catch (e) {
      logger.error(
        `Something went wrong fetching list ${listId} from MDBList`,
        {
          label: 'MDBList API',
          errorMessage: e.message,
          listId,
        }
      );
      throw new Error(`[MDBList] Failed to fetch list ${listId}: ${e.message}`);
    }
  }

  /**
   * Get list items by list ID
   */
  public async getListItems(
    listId: number,
    options: {
      limit?: number;
      offset?: number;
      sort?: string;
      order?: 'asc' | 'desc';
      unified?: boolean;
    } = {}
  ): Promise<MDBListResponse> {
    try {
      return await this.retryRequest(async () => {
        const response = await this.axios.get<MDBListResponse>(
          `/lists/${listId}/items`,
          {
            params: {
              limit: options.limit || 100,
              offset: options.offset || 0,
              sort: options.sort,
              order: options.order,
              unified: options.unified,
            },
          }
        );
        return response.data;
      });
    } catch (e) {
      logger.error(
        `Something went wrong fetching items for list ${listId} from MDBList`,
        {
          label: 'MDBList API',
          errorMessage: e.message,
          listId,
          options,
        }
      );
      throw new Error(
        `[MDBList] Failed to fetch items for list ${listId}: ${e.message}`
      );
    }
  }

  /**
   * Get list items by username and list name
   */
  public async getListItemsByName(
    username: string,
    listName: string,
    options: {
      limit?: number;
      offset?: number;
      sort?: string;
      order?: 'asc' | 'desc';
      unified?: boolean;
    } = {}
  ): Promise<MDBListResponse> {
    try {
      return await this.retryRequest(async () => {
        const response = await this.axios.get<MDBListResponse>(
          `/lists/${username}/${listName}/items`,
          {
            params: {
              limit: options.limit || 100,
              offset: options.offset || 0,
              sort: options.sort,
              order: options.order,
              unified: options.unified,
            },
          }
        );
        return response.data;
      });
    } catch (e) {
      logger.error(
        `Something went wrong fetching items for list ${username}/${listName} from MDBList`,
        {
          label: 'MDBList API',
          errorMessage: e.message,
          username,
          listName,
          options,
        }
      );
      throw new Error(
        `[MDBList] Failed to fetch items for list ${username}/${listName}: ${e.message}`
      );
    }
  }

  /**
   * Get top lists sorted by likes
   */
  public async getTopLists(): Promise<MDBListSummary[]> {
    try {
      return await this.retryRequest(async () => {
        const response = await this.axios.get<MDBListSummary[]>('/lists/top');
        return response.data;
      });
    } catch (e) {
      logger.error('Something went wrong fetching top lists from MDBList', {
        label: 'MDBList API',
        errorMessage: e.message,
      });
      throw new Error(`[MDBList] Failed to fetch top lists: ${e.message}`);
    }
  }

  /**
   * Search for lists by title
   */
  public async searchLists(query: string): Promise<MDBListSummary[]> {
    try {
      return await this.retryRequest(async () => {
        const response = await this.axios.get<MDBListSummary[]>(
          '/lists/search',
          {
            params: { query },
          }
        );
        return response.data;
      });
    } catch (e) {
      logger.error(
        `Something went wrong searching lists for "${query}" from MDBList`,
        {
          label: 'MDBList API',
          errorMessage: e.message,
          query,
        }
      );
      throw new Error(
        `[MDBList] Failed to search lists for "${query}": ${e.message}`
      );
    }
  }

  /**
   * Parse a MDBList URL to extract useful information
   */
  public parseListUrl(url: string): {
    type: 'user' | 'list' | 'external';
    username?: string;
    listName?: string;
    listId?: number;
  } | null {
    try {
      // Expected formats:
      // - https://mdblist.com/lists/123456
      // - https://mdblist.com/lists/username/list-name
      // - https://mdblist.com/lists/external/12345

      const listByIdMatch = url.match(/mdblist\.com\/lists\/(\d+)/);
      const listByNameMatch = url.match(
        /mdblist\.com\/lists\/([^/]+)\/([^/?]+)/
      );
      const externalListMatch = url.match(
        /mdblist\.com\/lists\/external\/(\d+)/
      );

      if (listByIdMatch) {
        return {
          type: 'list',
          listId: parseInt(listByIdMatch[1], 10),
        };
      } else if (externalListMatch) {
        return {
          type: 'external',
          listId: parseInt(externalListMatch[1], 10),
        };
      } else if (listByNameMatch) {
        return {
          type: 'user',
          username: listByNameMatch[1],
          listName: listByNameMatch[2],
        };
      }

      return null;
    } catch (e) {
      logger.error('Failed to parse MDBList URL', {
        label: 'MDBList API',
        errorMessage: e.message,
        url,
      });
      return null;
    }
  }

  /**
   * Get custom list items from a URL
   */
  public async getCustomList(
    listUrl: string,
    options: {
      limit?: number;
      offset?: number;
      sort?: string;
      order?: 'asc' | 'desc';
    } = {}
  ): Promise<MDBListResponse> {
    try {
      const parsedUrl = this.parseListUrl(listUrl);

      if (!parsedUrl) {
        throw new Error(
          'Invalid MDBList URL format. Expected: https://mdblist.com/lists/{id} or https://mdblist.com/lists/{username}/{list-name}'
        );
      }

      if (parsedUrl.type === 'list' && parsedUrl.listId) {
        return await this.getListItems(parsedUrl.listId, options);
      } else if (
        parsedUrl.type === 'user' &&
        parsedUrl.username &&
        parsedUrl.listName
      ) {
        return await this.getListItemsByName(
          parsedUrl.username,
          parsedUrl.listName,
          options
        );
      } else if (parsedUrl.type === 'external' && parsedUrl.listId) {
        // External lists use the same endpoint as regular lists
        return await this.getListItems(parsedUrl.listId, options);
      } else {
        throw new Error('Unable to determine list type from URL');
      }
    } catch (e) {
      logger.error('Something went wrong fetching custom list from MDBList', {
        label: 'MDBList API',
        errorMessage: e.message,
        listUrl,
        options,
      });
      throw new Error(`[MDBList] Failed to fetch custom list: ${e.message}`);
    }
  }

  /**
   * Test the API connection
   */
  public async testConnection(): Promise<boolean> {
    try {
      // Test connection with a simple request to user limits
      await this.getUserLimits();
      return true;
    } catch (e) {
      logger.error('MDBList API connection test failed', {
        label: 'MDBList API',
        errorMessage: e.message,
      });
      return false;
    }
  }
}

export default MDBListAPI;
