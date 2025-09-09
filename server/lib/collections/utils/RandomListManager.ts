import logger from '@server/logger';
import fs from 'fs';
import path from 'path';

/**
 * RandomListManager - Manages random list configuration files
 *
 * Handles reading and parsing of config files for random list rotation:
 * - /config/random-lists/trakt.txt
 * - /config/random-lists/tmdb.txt
 * - /config/random-lists/imdb.txt
 * - /config/random-lists/letterboxd.txt
 */
export class RandomListManager {
  private static configDir: string;
  private static cache: Map<
    string,
    { enabled: boolean; urls: string[]; lastRead: number }
  > = new Map();
  private static readonly CACHE_TTL = 60000; // 1 minute cache

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
   */
  public static getRandomUrls(
    sourceType: 'trakt' | 'tmdb' | 'imdb' | 'letterboxd'
  ): string[] {
    const config = this.readConfig(sourceType);
    return config.urls;
  }

  /**
   * Get a random URL from the configured list for a source type
   * Returns null if no URLs are available or random lists are disabled
   */
  public static getRandomUrl(
    sourceType: 'trakt' | 'tmdb' | 'imdb' | 'letterboxd'
  ): string | null {
    const urls = this.getRandomUrls(sourceType);
    if (urls.length === 0) {
      return null;
    }

    const randomIndex = Math.floor(Math.random() * urls.length);
    return urls[randomIndex];
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
}
