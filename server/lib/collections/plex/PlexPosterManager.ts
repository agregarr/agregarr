import type PlexAPI from '@server/api/plexapi';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

/**
 * PlexPosterManager - Handles Plex poster management operations
 * Manages poster upload, selection, locking, and URL retrieval for Plex items
 */
class PlexPosterManager {
  private plexApi: PlexAPI;

  constructor(plexApi: PlexAPI) {
    this.plexApi = plexApi;
  }

  /**
   * Get all available posters for a Plex item
   * @param ratingKey The rating key of the item (collection, movie, show, etc.)
   * @returns Array of available poster objects
   */
  public async getAvailablePosters(ratingKey: string): Promise<unknown[]> {
    try {
      const response = await this.plexApi['plexClient'].query(
        `/library/metadata/${ratingKey}/posters`
      );

      return response.MediaContainer?.Metadata || [];
    } catch (error) {
      logger.error(`Error getting available posters for ${ratingKey}`, {
        label: 'Plex API',
        error: error instanceof Error ? error.message : String(error),
        ratingKey,
      });
      return [];
    }
  }

  /**
   * Upload a poster from a URL
   * @param ratingKey The rating key of the item
   * @param url The URL of the image to upload
   */
  public async uploadPosterFromUrl(
    ratingKey: string,
    url: string
  ): Promise<void> {
    try {
      const key = `/library/metadata/${ratingKey}/posters?url=${encodeURIComponent(
        url
      )}`;
      await this.plexApi['safePostQuery'](key);

      logger.info(`Successfully uploaded poster from URL for ${ratingKey}`, {
        label: 'Plex API',
        ratingKey,
        url,
      });
    } catch (error) {
      logger.error(`Error uploading poster from URL for ${ratingKey}`, {
        label: 'Plex API',
        error: error instanceof Error ? error.message : String(error),
        ratingKey,
        url,
      });
      throw error;
    }
  }

  /**
   * Upload a poster from a local file path
   * @param ratingKey The rating key of the item
   * @param filepath The local file path to upload
   */
  public async uploadPosterFromFile(
    ratingKey: string,
    filepath: string
  ): Promise<void> {
    try {
      const fs = await import('fs');

      // Read the file data
      const fileData = await fs.promises.readFile(filepath);
      const key = `/library/metadata/${ratingKey}/posters`;

      // Use axios directly for file upload since plex-api may not handle binary data properly
      const axios = await import('axios');
      const settings = getSettings();
      const baseUrl = `${settings.plex.useSsl ? 'https' : 'http'}://${
        settings.plex.ip
      }:${settings.plex.port}`;

      await axios.default.post(`${baseUrl}${key}`, fileData, {
        headers: {
          'X-Plex-Token': this.plexApi['plexToken'],
          'Content-Type': 'application/octet-stream',
        },
        timeout: 30000,
      });

      logger.info(`Successfully uploaded poster from file for ${ratingKey}`, {
        label: 'Plex API',
        ratingKey,
        filepath,
      });
    } catch (error) {
      logger.error(`Error uploading poster from file for ${ratingKey}`, {
        label: 'Plex API',
        error: error instanceof Error ? error.message : String(error),
        ratingKey,
        filepath,
      });
      throw error;
    }
  }

  /**
   * Select an existing poster for an item
   * @param ratingKey The rating key of the item
   * @param posterRatingKey The rating key of the poster to select
   */
  public async selectPoster(
    ratingKey: string,
    posterRatingKey: string
  ): Promise<void> {
    try {
      const key = `/library/metadata/${ratingKey}/posters?url=${encodeURIComponent(
        posterRatingKey
      )}`;
      await this.plexApi['safePutQuery'](key);

      logger.info(`Successfully selected poster for ${ratingKey}`, {
        label: 'Plex API',
        ratingKey,
        posterRatingKey,
      });
    } catch (error) {
      logger.error(`Error selecting poster for ${ratingKey}`, {
        label: 'Plex API',
        error: error instanceof Error ? error.message : String(error),
        ratingKey,
        posterRatingKey,
      });
      throw error;
    }
  }

  /**
   * Lock the poster for an item (prevents auto-updates)
   * @param ratingKey The rating key of the item
   */
  public async lockPoster(ratingKey: string): Promise<void> {
    try {
      const params = { 'thumb.locked': '1' };
      const queryString = Object.entries(params)
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
        .join('&');

      const editUrl = `/library/metadata/${ratingKey}?${queryString}`;
      await this.plexApi['safePutQuery'](editUrl);

      logger.info(`Successfully locked poster for ${ratingKey}`, {
        label: 'Plex API',
        ratingKey,
      });
    } catch (error) {
      logger.error(`Error locking poster for ${ratingKey}`, {
        label: 'Plex API',
        error: error instanceof Error ? error.message : String(error),
        ratingKey,
      });
      throw error;
    }
  }

  /**
   * Unlock the poster for an item (allows auto-updates)
   * @param ratingKey The rating key of the item
   */
  public async unlockPoster(ratingKey: string): Promise<void> {
    try {
      const params = { 'thumb.locked': '0' };
      const queryString = Object.entries(params)
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
        .join('&');

      const editUrl = `/library/metadata/${ratingKey}?${queryString}`;
      await this.plexApi['safePutQuery'](editUrl);

      logger.info(`Successfully unlocked poster for ${ratingKey}`, {
        label: 'Plex API',
        ratingKey,
      });
    } catch (error) {
      logger.error(`Error unlocking poster for ${ratingKey}`, {
        label: 'Plex API',
        error: error instanceof Error ? error.message : String(error),
        ratingKey,
      });
      throw error;
    }
  }

  /**
   * Get current poster URL for a Plex item
   * @param ratingKey The rating key of the item
   * @returns The current poster URL or null if none
   */
  public async getCurrentPosterUrl(ratingKey: string): Promise<string | null> {
    try {
      const response = await this.plexApi['plexClient'].query(
        `/library/metadata/${ratingKey}`
      );

      const item = response?.MediaContainer?.Metadata?.[0];
      if (!item?.thumb) {
        return null;
      }

      // Return upload:// format for consistency with metadata tracking
      if (item.thumb.startsWith('upload://')) {
        return item.thumb;
      }

      // Extract upload key from path like "/library/metadata/12345/thumb/67890"
      const match = item.thumb.match(/\/thumb\/(\d+)/);
      return match ? `upload://posters/${match[1]}` : item.thumb;
    } catch (error) {
      logger.error(`Error getting current poster for ${ratingKey}`, {
        label: 'Plex API',
        error: error instanceof Error ? error.message : String(error),
        ratingKey,
      });
      return null;
    }
  }

  /**
   * Get current art/wallpaper URL for a Plex item
   * @param ratingKey The rating key of the item
   * @returns The current art URL or null if none
   */
  public async getCurrentArtUrl(ratingKey: string): Promise<string | null> {
    try {
      const response = await this.plexApi['plexClient'].query(
        `/library/metadata/${ratingKey}`
      );

      const item = response?.MediaContainer?.Metadata?.[0];
      if (!item?.art) {
        return null;
      }

      // Return upload:// format for consistency
      if (item.art.startsWith('upload://')) {
        return item.art;
      }

      // Extract upload key from path like "/library/metadata/12345/art/67890"
      const match = item.art.match(/\/art\/(\d+)/);
      return match ? `upload://arts/${match[1]}` : item.art;
    } catch (error) {
      logger.error(`Error getting current art URL for ${ratingKey}`, {
        label: 'Plex API',
        error: error instanceof Error ? error.message : String(error),
        ratingKey,
      });
      return null;
    }
  }

  /**
   * Get current theme URL for a Plex item
   * @param ratingKey The rating key of the item
   * @returns The current theme URL or null if none
   */
  public async getCurrentThemeUrl(ratingKey: string): Promise<string | null> {
    try {
      const response = await this.plexApi['plexClient'].query(
        `/library/metadata/${ratingKey}`
      );

      const item = response?.MediaContainer?.Metadata?.[0];
      if (!item?.theme) {
        return null;
      }

      // Return upload:// format for consistency
      if (item.theme.startsWith('upload://')) {
        return item.theme;
      }

      // Extract upload key from path like "/library/metadata/12345/theme/67890"
      const match = item.theme.match(/\/theme\/(\d+)/);
      return match ? `upload://themes/${match[1]}` : item.theme;
    } catch (error) {
      logger.error(`Error getting current theme URL for ${ratingKey}`, {
        label: 'Plex API',
        error: error instanceof Error ? error.message : String(error),
        ratingKey,
      });
      return null;
    }
  }

  /**
   * Combined method for uploading and setting a poster (backwards compatibility)
   * @param collectionRatingKey The rating key of the collection
   * @param posterPath The local file path to upload
   */
  public async updateCollectionPoster(
    collectionRatingKey: string,
    posterPath: string
  ): Promise<void> {
    await this.uploadPosterFromFile(collectionRatingKey, posterPath);

    // Lock the poster to prevent Plex from overriding it
    await this.lockPoster(collectionRatingKey);
  }

  /**
   * Upload wallpaper/art from a local file path
   * @param ratingKey The rating key of the item
   * @param filepath The local file path to upload
   */
  public async uploadArtFromFile(
    ratingKey: string,
    filepath: string
  ): Promise<void> {
    try {
      const fs = await import('fs');

      // Read the file data
      const fileData = await fs.promises.readFile(filepath);
      const key = `/library/metadata/${ratingKey}/arts`;

      // Use axios directly for file upload
      const axios = await import('axios');
      const settings = getSettings();
      const baseUrl = `${settings.plex.useSsl ? 'https' : 'http'}://${
        settings.plex.ip
      }:${settings.plex.port}`;

      await axios.default.post(`${baseUrl}${key}`, fileData, {
        headers: {
          'X-Plex-Token': this.plexApi['plexToken'],
          'Content-Type': 'application/octet-stream',
        },
        timeout: 30000,
      });

      logger.info(`Successfully uploaded art from file for ${ratingKey}`, {
        label: 'Plex API',
        ratingKey,
        filepath,
      });
    } catch (error) {
      logger.error(`Error uploading art from file for ${ratingKey}`, {
        label: 'Plex API',
        error: error instanceof Error ? error.message : String(error),
        ratingKey,
        filepath,
      });
      throw error;
    }
  }

  /**
   * Lock the art for an item (prevents auto-updates)
   * @param ratingKey The rating key of the item
   */
  public async lockArt(ratingKey: string): Promise<void> {
    try {
      const params = { 'art.locked': '1' };
      const queryString = Object.entries(params)
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
        .join('&');

      const editUrl = `/library/metadata/${ratingKey}?${queryString}`;
      await this.plexApi['safePutQuery'](editUrl);

      logger.info(`Successfully locked art for ${ratingKey}`, {
        label: 'Plex API',
        ratingKey,
      });
    } catch (error) {
      logger.error(`Error locking art for ${ratingKey}`, {
        label: 'Plex API',
        error: error instanceof Error ? error.message : String(error),
        ratingKey,
      });
      throw error;
    }
  }

  /**
   * Upload theme music from a local file path
   * @param ratingKey The rating key of the item
   * @param filepath The local file path to upload
   */
  public async uploadThemeFromFile(
    ratingKey: string,
    filepath: string
  ): Promise<void> {
    try {
      const fs = await import('fs');

      // Read the file data
      const fileData = await fs.promises.readFile(filepath);
      const key = `/library/metadata/${ratingKey}/themes`;

      // Use axios directly for file upload
      const axios = await import('axios');
      const settings = getSettings();
      const baseUrl = `${settings.plex.useSsl ? 'https' : 'http'}://${
        settings.plex.ip
      }:${settings.plex.port}`;

      await axios.default.post(`${baseUrl}${key}`, fileData, {
        headers: {
          'X-Plex-Token': this.plexApi['plexToken'],
          'Content-Type': 'application/octet-stream',
        },
        timeout: 30000,
      });

      logger.info(`Successfully uploaded theme from file for ${ratingKey}`, {
        label: 'Plex API',
        ratingKey,
        filepath,
      });
    } catch (error) {
      logger.error(`Error uploading theme from file for ${ratingKey}`, {
        label: 'Plex API',
        error: error instanceof Error ? error.message : String(error),
        ratingKey,
        filepath,
      });
      throw error;
    }
  }

  /**
   * Lock the theme for an item (prevents auto-updates)
   * @param ratingKey The rating key of the item
   */
  public async lockTheme(ratingKey: string): Promise<void> {
    try {
      const params = { 'theme.locked': '1' };
      const queryString = Object.entries(params)
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
        .join('&');

      const editUrl = `/library/metadata/${ratingKey}?${queryString}`;
      await this.plexApi['safePutQuery'](editUrl);

      logger.info(`Successfully locked theme for ${ratingKey}`, {
        label: 'Plex API',
        ratingKey,
      });
    } catch (error) {
      logger.error(`Error locking theme for ${ratingKey}`, {
        label: 'Plex API',
        error: error instanceof Error ? error.message : String(error),
        ratingKey,
      });
      throw error;
    }
  }

  /**
   * Update collection summary/description
   * @param ratingKey The rating key of the item
   * @param summary The summary text to set
   */
  public async updateSummary(
    ratingKey: string,
    summary: string
  ): Promise<void> {
    try {
      const params = { summary: summary };
      const queryString = Object.entries(params)
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
        .join('&');

      const editUrl = `/library/metadata/${ratingKey}?${queryString}`;
      await this.plexApi['safePutQuery'](editUrl);

      logger.info(`Successfully updated summary for ${ratingKey}`, {
        label: 'Plex API',
        ratingKey,
      });
    } catch (error) {
      logger.error(`Error updating summary for ${ratingKey}`, {
        label: 'Plex API',
        error: error instanceof Error ? error.message : String(error),
        ratingKey,
      });
      throw error;
    }
  }
}

export default PlexPosterManager;
