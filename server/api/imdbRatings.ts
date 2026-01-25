import ExternalAPI from '@server/api/externalapi';
import cacheManager from '@server/lib/cache';
import logger from '@server/logger';

/**
 * IMDb Rating Response from Agregarr API
 */
export interface ImdbRatingResponse {
  imdbId: string;
  rating: number | null;
  votes: number | null;
}

/**
 * IMDb Ratings API client for fetching ratings from Agregarr's IMDb proxy
 *
 * This API supports both Movies and TV Shows.
 * API Documentation: https://api.agregarr.org
 */
class ImdbRatingsAPI extends ExternalAPI {
  constructor() {
    super(
      'https://api.agregarr.org',
      {}, // URL params
      {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        nodeCache: cacheManager.getCache('imdb').data,
      }
    );
  }

  /**
   * Get ratings for one or more IMDb IDs
   *
   * @param imdbIds - Single IMDb ID or array of IMDb IDs (max 100 per request)
   * @returns Array of rating responses
   */
  public async getRatings(
    imdbIds: string | string[]
  ): Promise<ImdbRatingResponse[]> {
    try {
      const ids = Array.isArray(imdbIds) ? imdbIds : [imdbIds];

      if (ids.length === 0) {
        return [];
      }

      if (ids.length > 100) {
        logger.warn(
          `Requested ${ids.length} IMDb ratings, but API supports max 100 per request. Splitting into batches.`,
          {
            label: 'IMDb Ratings API',
            requestedCount: ids.length,
          }
        );

        // Split into batches of 100
        const batches: string[][] = [];
        for (let i = 0; i < ids.length; i += 100) {
          batches.push(ids.slice(i, i + 100));
        }

        // Fetch all batches in parallel
        const results = await Promise.all(
          batches.map((batch) => this.getRatings(batch))
        );

        // Flatten results
        return results.flat();
      }

      // Build query string with multiple id parameters
      const queryParams = ids.map((id) => `id=${encodeURIComponent(id)}`);
      const url = `/api/ratings?${queryParams.join('&')}`;

      const response = await this.get<ImdbRatingResponse[]>(
        url,
        undefined,
        30000
      );

      logger.debug(`Fetched ${response.length} IMDb ratings`, {
        label: 'IMDb Ratings API',
        requestedCount: ids.length,
        receivedCount: response.length,
      });

      return response;
    } catch (error) {
      logger.error('Failed to fetch IMDb ratings:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        imdbIds: Array.isArray(imdbIds) ? imdbIds.length : 1,
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw new Error(
        `Failed to retrieve IMDb ratings: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  /**
   * Get rating for a single IMDb ID
   *
   * @param imdbId - IMDb ID (e.g., "tt0111161")
   * @returns Rating response or null if not found
   */
  public async getRating(imdbId: string): Promise<ImdbRatingResponse | null> {
    try {
      const results = await this.getRatings(imdbId);
      return results.length > 0 ? results[0] : null;
    } catch (error) {
      logger.error(`Failed to fetch IMDb rating for ${imdbId}:`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        imdbId,
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  /**
   * Check API health status
   *
   * @returns Health status information
   */
  public async getHealth(): Promise<{
    status: string;
    lastUpdate: string;
    totalRatings: number;
    uptime: number;
  }> {
    try {
      return await this.get('/api/health', undefined, 10000);
    } catch (error) {
      logger.error('Failed to fetch IMDb Ratings API health:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw new Error(
        `Failed to check API health: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }
}

export default ImdbRatingsAPI;
