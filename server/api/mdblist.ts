import logger from '@server/logger';
import type { AxiosError, AxiosInstance } from 'axios';
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
      } catch (error: unknown) {
        if (attempt === maxRetries) {
          throw error;
        }

        // Check if it's a retryable error (5xx or network errors)
        const isAxiosError = axios.isAxiosError(error);
        const status = isAxiosError ? error.response?.status : undefined;
        const isRetryable =
          (status !== undefined && status >= 500) || !isAxiosError;

        if (!isRetryable) {
          throw error;
        }

        const errorMessage =
          error instanceof Error ? error.message : String(error);

        logger.debug(
          `MDBList API request failed, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`,
          {
            label: 'MDBList API',
            error: errorMessage,
            status,
          }
        );

        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2; // Exponential backoff
      }
    }
    throw new Error('Max retries exceeded');
  }

  /**
   * Extract detailed error information from Axios errors
   */
  private extractErrorDetails(error: unknown): {
    message: string;
    status?: number;
    statusText?: string;
    responseData?: unknown;
  } {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      const status = axiosError.response?.status;
      const statusText = axiosError.response?.statusText;
      const responseData = axiosError.response?.data;

      // Build a detailed error message
      let message = axiosError.message;

      if (status) {
        message = `HTTP ${status}`;
        if (statusText) {
          message += ` ${statusText}`;
        }

        // Add specific context for common errors
        if (status === 401 || status === 403) {
          message +=
            ' - Invalid API key or authentication failed. Please check your MDBList API key in Settings.';
        } else if (status === 404) {
          message +=
            ' - List not found. Please check the MDBList URL is correct.';
        } else if (status === 429) {
          message += ' - Rate limit exceeded. Please try again later.';
        }

        // Include response data if available
        if (responseData) {
          const dataStr =
            typeof responseData === 'string'
              ? responseData
              : JSON.stringify(responseData);
          if (dataStr && dataStr.length < 200) {
            message += ` | Response: ${dataStr}`;
          }
        }
      } else if (axiosError.code === 'ECONNABORTED') {
        message = 'Request timeout - MDBList API did not respond in time';
      } else if (axiosError.code === 'ENOTFOUND') {
        message = 'Network error - Could not reach MDBList API';
      }

      return {
        message,
        status,
        statusText,
        responseData,
      };
    }

    // Not an Axios error - handle other error types
    if (error instanceof Error) {
      return { message: error.message };
    }

    // Handle plain objects with message property
    if (
      typeof error === 'object' &&
      error !== null &&
      'message' in error &&
      typeof (error as { message: unknown }).message === 'string'
    ) {
      return { message: (error as { message: string }).message };
    }

    // Handle plain objects - try to extract useful information
    if (typeof error === 'object' && error !== null) {
      try {
        const errorObj = error as Record<string, unknown>;
        // Try common error property names
        if (errorObj.error && typeof errorObj.error === 'string') {
          return { message: errorObj.error };
        }
        if (errorObj.msg && typeof errorObj.msg === 'string') {
          return { message: errorObj.msg };
        }
        if (errorObj.detail && typeof errorObj.detail === 'string') {
          return { message: errorObj.detail };
        }
        // Fall back to JSON stringification
        return { message: JSON.stringify(error) };
      } catch {
        // JSON.stringify can fail on circular references
        return { message: 'Unknown error (could not serialize error object)' };
      }
    }

    return { message: String(error) };
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
    } catch (error: unknown) {
      const errorDetails = this.extractErrorDetails(error);

      logger.error('Failed to fetch user limits from MDBList', {
        label: 'MDBList API',
        errorMessage: errorDetails.message,
        httpStatus: errorDetails.status,
        statusText: errorDetails.statusText,
        responseData: errorDetails.responseData,
      });

      throw new Error(`[MDBList] ${errorDetails.message}`);
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
    } catch (error: unknown) {
      const errorDetails = this.extractErrorDetails(error);

      logger.error('Failed to fetch user lists from MDBList', {
        label: 'MDBList API',
        errorMessage: errorDetails.message,
        httpStatus: errorDetails.status,
        statusText: errorDetails.statusText,
        responseData: errorDetails.responseData,
      });

      throw new Error(`[MDBList] ${errorDetails.message}`);
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
    } catch (error: unknown) {
      const errorDetails = this.extractErrorDetails(error);

      logger.error(`Failed to fetch lists for user ${username} from MDBList`, {
        label: 'MDBList API',
        errorMessage: errorDetails.message,
        httpStatus: errorDetails.status,
        statusText: errorDetails.statusText,
        responseData: errorDetails.responseData,
        username,
      });

      throw new Error(`[MDBList] ${errorDetails.message}`);
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
    } catch (error: unknown) {
      const errorDetails = this.extractErrorDetails(error);

      logger.error(`Failed to fetch list ${listId} from MDBList`, {
        label: 'MDBList API',
        errorMessage: errorDetails.message,
        httpStatus: errorDetails.status,
        statusText: errorDetails.statusText,
        responseData: errorDetails.responseData,
        listId,
      });

      throw new Error(`[MDBList] ${errorDetails.message}`);
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
    } catch (error: unknown) {
      const errorDetails = this.extractErrorDetails(error);

      logger.error(`Failed to fetch items for list ${listId} from MDBList`, {
        label: 'MDBList API',
        errorMessage: errorDetails.message,
        httpStatus: errorDetails.status,
        statusText: errorDetails.statusText,
        responseData: errorDetails.responseData,
        listId,
        options,
      });

      throw new Error(`[MDBList] ${errorDetails.message}`);
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
    } catch (error: unknown) {
      const errorDetails = this.extractErrorDetails(error);

      logger.error(
        `Failed to fetch items for list ${username}/${listName} from MDBList`,
        {
          label: 'MDBList API',
          errorMessage: errorDetails.message,
          httpStatus: errorDetails.status,
          statusText: errorDetails.statusText,
          responseData: errorDetails.responseData,
          username,
          listName,
          options,
        }
      );

      throw new Error(`[MDBList] ${errorDetails.message}`);
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
    } catch (error: unknown) {
      const errorDetails = this.extractErrorDetails(error);

      logger.error('Failed to fetch top lists from MDBList', {
        label: 'MDBList API',
        errorMessage: errorDetails.message,
        httpStatus: errorDetails.status,
        statusText: errorDetails.statusText,
        responseData: errorDetails.responseData,
      });

      throw new Error(`[MDBList] ${errorDetails.message}`);
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
    } catch (error: unknown) {
      const errorDetails = this.extractErrorDetails(error);

      logger.error(`Failed to search lists for "${query}" from MDBList`, {
        label: 'MDBList API',
        errorMessage: errorDetails.message,
        httpStatus: errorDetails.status,
        statusText: errorDetails.statusText,
        responseData: errorDetails.responseData,
        query,
      });

      throw new Error(`[MDBList] ${errorDetails.message}`);
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
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      logger.error('Failed to parse MDBList URL', {
        label: 'MDBList API',
        errorMessage,
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
    } catch (error: unknown) {
      const errorDetails = this.extractErrorDetails(error);

      logger.error('Failed to fetch custom list from MDBList', {
        label: 'MDBList API',
        errorMessage: errorDetails.message,
        httpStatus: errorDetails.status,
        statusText: errorDetails.statusText,
        responseData: errorDetails.responseData,
        listUrl,
        options,
      });

      throw new Error(`[MDBList] ${errorDetails.message}`);
    }
  }

  /**
   * Test the API connection
   */
  public async testConnection(): Promise<boolean> {
    // Test connection with a simple request to user limits
    // Throw the original error to preserve response status for proper error handling
    await this.getUserLimits();
    return true;
  }
}

export default MDBListAPI;
