import logger from '@server/logger';
import type { AxiosInstance, AxiosResponse } from 'axios';
import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import { AwsWafTokenSolver } from './AwsWafTokenSolver';

// Extend axios config to include our retry flag
declare module 'axios' {
  // axios-cookiejar-support augments this in its typings, but when dependencies
  // are missing/stale (e.g. in docker node_modules volume) TypeScript won't see
  // that augmentation.
  export interface CreateAxiosDefaults {
    jar?: CookieJar;
  }

  export interface InternalAxiosRequestConfig {
    _wafRetry?: boolean;
  }
}

/**
 * IMDb Axios Client with Cookie Persistence
 *
 * Provides a shared axios instance with cookie jar support for IMDb requests.
 * Automatically handles AWS WAF challenges by solving them when needed.
 */
export class ImdbAxiosClient {
  private static instance: AxiosInstance | null = null;
  private static cookieJar: CookieJar | null = null;
  private static isInitialized = false;

  /**
   * Get the shared axios instance with cookie jar
   */
  static async getInstance(): Promise<AxiosInstance> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.instance) {
      throw new Error('Failed to initialize IMDb axios client');
    }

    return this.instance;
  }

  /**
   * Initialize the axios instance with cookie jar and WAF token
   */
  private static async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    logger.debug('Initializing IMDb axios client with cookie jar', {
      label: 'IMDb Axios Client',
    });

    // Create cookie jar
    this.cookieJar = new CookieJar();

    // Create axios instance with cookie jar support
    const client = wrapper(
      axios.create({
        jar: this.cookieJar,
        withCredentials: true,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'max-age=0',
          Connection: 'keep-alive',
        },
      })
    );

    // Add response interceptor to handle WAF challenges
    // CRITICAL: 202 is a SUCCESS status, so we check in the success handler!
    client.interceptors.response.use(
      async (response: AxiosResponse) => {
        // Check if this is a WAF challenge (HTTP 202)
        if (
          response.status === 202 &&
          !response.config._wafRetry &&
          response.config.url?.includes('imdb.com')
        ) {
          logger.warn('AWS WAF challenge detected (HTTP 202), solving...', {
            label: 'IMDb Axios Client',
            url: response.config.url,
          });

          try {
            // Solve the challenge
            const cookies = await AwsWafTokenSolver.getCookies(
              response.config.url
            );

            // Set cookies in the jar
            if (this.cookieJar) {
              for (const cookie of cookies) {
                await this.cookieJar.setCookie(
                  `${cookie.name}=${cookie.value}`,
                  response.config.url
                );
              }
            }

            // Mark this request as retried to avoid infinite loops
            response.config._wafRetry = true;

            // Retry the request with cookies
            logger.debug('Retrying request with WAF token', {
              label: 'IMDb Axios Client',
              url: response.config.url,
            });

            return client.request(response.config);
          } catch (wafError) {
            logger.error('Failed to solve WAF challenge', {
              label: 'IMDb Axios Client',
              error:
                wafError instanceof Error ? wafError.message : String(wafError),
            });
            throw wafError;
          }
        }

        return response;
      },
      async (error: unknown) => {
        // Still handle actual errors (4xx, 5xx)
        return Promise.reject(error);
      }
    );

    this.instance = client;
    this.isInitialized = true;

    logger.info('IMDb axios client initialized successfully', {
      label: 'IMDb Axios Client',
    });
  }

  /**
   * Pre-fetch WAF token (optional - useful for warming up)
   */
  static async warmup(): Promise<void> {
    logger.debug('Warming up IMDb client with WAF token', {
      label: 'IMDb Axios Client',
    });

    try {
      const cookies = await AwsWafTokenSolver.getCookies(
        'https://www.imdb.com/chart/top/'
      );

      if (!this.cookieJar) {
        this.cookieJar = new CookieJar();
      }

      for (const cookie of cookies) {
        await this.cookieJar.setCookie(
          `${cookie.name}=${cookie.value}`,
          'https://www.imdb.com'
        );
      }

      logger.info('IMDb client warmed up successfully', {
        label: 'IMDb Axios Client',
        cookieCount: cookies.length,
      });
    } catch (error) {
      logger.error('Failed to warm up IMDb client', {
        label: 'IMDb Axios Client',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Reset the client (clears cookies and reinitializes)
   */
  static reset(): void {
    this.isInitialized = false;
    this.instance = null;
    this.cookieJar = null;
    AwsWafTokenSolver.clearCache('www.imdb.com');

    logger.debug('IMDb axios client reset', {
      label: 'IMDb Axios Client',
    });
  }
}
