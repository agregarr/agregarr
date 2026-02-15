import ExternalAPI from '@server/api/externalapi';
import cacheManager from '@server/lib/cache';
import logger from '@server/logger';
import axios from 'axios';
import type {
  TvdbLoginResponse,
  TvdbSeriesData,
  TvdbSeriesResponse,
} from './interfaces';

const TVDB_BASE_URL = 'https://api4.thetvdb.com/v4';
const TVDB_API_KEY = '031c39c2-1777-42fb-9da6-c80ba1d6d10c';

// Module-level token cache (~29-day TTL)
const TOKEN_TTL_MS = 29 * 24 * 60 * 60 * 1000;
let tokenCache: { token: string; expiresAt: number } | undefined;

class TvdbAPI extends ExternalAPI {
  constructor() {
    super(
      TVDB_BASE_URL,
      {},
      {
        nodeCache: cacheManager.getCache('tvdb').data,
      }
    );
  }

  /**
   * Get (or refresh) the TVDB JWT auth token.
   * Uses a fresh axios instance to avoid interceptor loops.
   */
  private async getAuthToken(): Promise<string> {
    const now = Date.now();

    if (tokenCache && now < tokenCache.expiresAt) {
      return tokenCache.token;
    }

    logger.debug('Fetching new TVDB auth token', { label: 'TvdbAPI' });

    const loginAxios = axios.create({
      baseURL: TVDB_BASE_URL,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });

    const response = await loginAxios.post<TvdbLoginResponse>('/login', {
      apikey: TVDB_API_KEY,
    });

    tokenCache = {
      token: response.data.data.token,
      expiresAt: now + TOKEN_TTL_MS,
    };

    logger.debug('TVDB auth token acquired', { label: 'TvdbAPI' });

    return tokenCache.token;
  }

  /**
   * Get series details from TVDB by ID.
   * Response is cached for 1 hour (3600 seconds).
   */
  public async getSeriesById(tvdbId: number): Promise<TvdbSeriesData> {
    const token = await this.getAuthToken();

    const data = await this.get<TvdbSeriesResponse>(
      `/series/${tvdbId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      3600
    );

    return data.data;
  }
}

export default TvdbAPI;
