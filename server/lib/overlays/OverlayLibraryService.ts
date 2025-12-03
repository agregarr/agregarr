import ImdbAPI from '@server/api/imdb';
import ImdbRatingsAPI from '@server/api/imdbRatings';
import type { PlexLibraryItem } from '@server/api/plexapi';
import PlexAPI from '@server/api/plexapi';
import RottenTomatoes from '@server/api/rottentomatoes';
import type { RadarrMovie } from '@server/api/servarr/radarr';
import type { SonarrSeries } from '@server/api/servarr/sonarr';
import TheMovieDb from '@server/api/themoviedb';
import { getRepository } from '@server/datasource';
import { OverlayLibraryConfig } from '@server/entity/OverlayLibraryConfig';
import { OverlayTemplate } from '@server/entity/OverlayTemplate';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import axios from 'axios';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { OverlayRenderContext } from './OverlayTemplateRenderer';
import {
  evaluateCondition,
  overlayTemplateRenderer,
} from './OverlayTemplateRenderer';

/**
 * Input for overlay application - either a simple rating key or with context overrides
 */
export interface OverlayItemInput {
  ratingKey: string;
  contextOverrides?: Partial<OverlayRenderContext>;
}

/**
 * Service for applying overlay templates to Plex library items
 */
class OverlayLibraryService {
  // Shared API clients to avoid creating new instances for each item
  private imdbClient?: ImdbAPI;

  // Cache for Radarr/Sonarr library data (per job)
  private radarrMoviesCache?: Map<string, RadarrMovie[]>;
  private sonarrSeriesCache?: Map<string, SonarrSeries[]>;

  /**
   * Get or create shared IMDb client
   */
  private async getImdbClient() {
    if (!this.imdbClient) {
      this.imdbClient = new ImdbAPI();
    }
    return this.imdbClient;
  }

  /**
   * Clear library caches (call at start of overlay job)
   */
  private clearLibraryCaches() {
    this.radarrMoviesCache = new Map();
    this.sonarrSeriesCache = new Map();
  }

  /**
   * Get all movies from a Radarr instance (with caching)
   */
  private async getRadarrMovies(radarrSettings: {
    hostname: string;
    port: number;
    useSsl: boolean;
    baseUrl?: string;
    apiKey: string;
  }): Promise<RadarrMovie[]> {
    const RadarrAPI = (await import('@server/api/servarr/radarr')).default;

    // Build URL manually (same pattern as buildUrl)
    const protocol = radarrSettings.useSsl ? 'https' : 'http';
    const url = `${protocol}://${radarrSettings.hostname}:${
      radarrSettings.port
    }${radarrSettings.baseUrl || ''}/api/v3`;
    const cacheKey = url;

    if (!this.radarrMoviesCache) {
      this.radarrMoviesCache = new Map();
    }

    const cached = this.radarrMoviesCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const radarr = new RadarrAPI({
      url,
      apiKey: radarrSettings.apiKey,
    });

    const movies = await radarr.getMovies();
    this.radarrMoviesCache.set(cacheKey, movies);

    logger.debug('Cached Radarr movies', {
      label: 'OverlayLibrary',
      url,
      movieCount: movies.length,
    });

    return movies;
  }

  /**
   * Get all series from a Sonarr instance (with caching)
   */
  private async getSonarrSeries(sonarrSettings: {
    hostname: string;
    port: number;
    useSsl: boolean;
    baseUrl?: string;
    apiKey: string;
  }): Promise<SonarrSeries[]> {
    const SonarrAPI = (await import('@server/api/servarr/sonarr')).default;

    // Build URL manually (same pattern as buildUrl)
    const protocol = sonarrSettings.useSsl ? 'https' : 'http';
    const url = `${protocol}://${sonarrSettings.hostname}:${
      sonarrSettings.port
    }${sonarrSettings.baseUrl || ''}/api/v3`;
    const cacheKey = url;

    if (!this.sonarrSeriesCache) {
      this.sonarrSeriesCache = new Map();
    }

    const cached = this.sonarrSeriesCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const sonarr = new SonarrAPI({
      url,
      apiKey: sonarrSettings.apiKey,
    });

    const series = await sonarr.getSeries();
    this.sonarrSeriesCache.set(cacheKey, series);

    logger.debug('Cached Sonarr series', {
      label: 'OverlayLibrary',
      url,
      seriesCount: series.length,
    });

    return series;
  }

  /**
   * Apply overlays to all items in a library
   */
  async applyOverlaysToLibrary(
    libraryId: string,
    checkCancelled?: () => boolean
  ): Promise<void> {
    try {
      // Clear library caches at start of job
      this.clearLibraryCaches();

      logger.info('Starting overlay application for library', {
        label: 'OverlayLibrary',
        libraryId,
      });

      // Get library configuration
      const configRepository = getRepository(OverlayLibraryConfig);
      const config = await configRepository.findOne({
        where: { libraryId },
      });

      if (!config || config.enabledOverlays.length === 0) {
        logger.info('No overlays enabled for library', {
          label: 'OverlayLibrary',
          libraryId,
        });
        return;
      }

      // Get enabled overlay templates
      const templateRepository = getRepository(OverlayTemplate);
      const enabledTemplateIds = config.enabledOverlays
        .filter((o) => o.enabled)
        .map((o) => o.templateId);

      const templates = await templateRepository.findByIds(enabledTemplateIds);

      if (templates.length === 0) {
        logger.info('No templates found for library', {
          label: 'OverlayLibrary',
          libraryId,
        });
        return;
      }

      // Sort templates by layer order
      const sortedTemplates = templates.sort((a, b) => {
        const orderA =
          config.enabledOverlays.find((o) => o.templateId === a.id)
            ?.layerOrder || 0;
        const orderB =
          config.enabledOverlays.find((o) => o.templateId === b.id)
            ?.layerOrder || 0;
        return orderA - orderB;
      });

      logger.info('Applying overlays to library', {
        label: 'OverlayLibrary',
        libraryId,
        templateCount: sortedTemplates.length,
        templates: sortedTemplates.map((t) => t.name),
      });

      // Get library items from Plex
      const { getAdminUser } = await import(
        '@server/lib/collections/core/CollectionUtilities'
      );
      const admin = await getAdminUser();

      if (!admin) {
        throw new Error('No admin user found');
      }

      const plexApi = new PlexAPI({ plexToken: admin.plexToken });

      // Fetch all items (handle pagination)
      let allItems: PlexLibraryItem[] = [];
      let offset = 0;
      const pageSize = 50;
      let hasMore = true;

      // Paginate through all library items
      while (hasMore) {
        const response = await plexApi.getLibraryContents(libraryId, {
          offset,
          size: pageSize,
        });

        allItems = allItems.concat(response.items);

        if (offset + pageSize >= response.totalSize) {
          hasMore = false;
        }

        offset += pageSize;
      }

      logger.info('Processing library items', {
        label: 'OverlayLibrary',
        libraryId,
        itemCount: allItems.length,
      });

      // Process each item
      let successCount = 0;
      let errorCount = 0;

      for (const item of allItems) {
        // Check for cancellation
        if (checkCancelled && checkCancelled()) {
          logger.info(
            'Overlay application cancelled during library processing',
            {
              label: 'OverlayLibrary',
              libraryId,
              processedItems: successCount + errorCount,
              totalItems: allItems.length,
            }
          );
          break;
        }

        try {
          // Fetch full metadata including Stream details (needed for HDR, bitDepth, etc.)
          const fullMetadata = await plexApi.getMetadata(item.ratingKey);

          // Merge full metadata with library item
          const itemWithFullMetadata = {
            ...item,
            Media: fullMetadata.Media,
          };

          await this.applyOverlaysToItem(
            plexApi,
            itemWithFullMetadata,
            sortedTemplates,
            config.mediaType
          );
          successCount++;
        } catch (error) {
          errorCount++;
          logger.error('Failed to apply overlays to item', {
            label: 'OverlayLibrary',
            itemTitle: item.title,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            errorDetails: error,
          });
          // Continue with next item
        }
      }

      logger.info('Completed overlay application for library', {
        label: 'OverlayLibrary',
        libraryId,
        successCount,
        errorCount,
      });
    } catch (error) {
      logger.error('Failed to apply overlays to library', {
        label: 'OverlayLibrary',
        libraryId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Apply overlays to specific collection items only
   * Used by "Apply overlays during sync" feature
   *
   * @param items - Either an array of rating keys (string[]) or items with context overrides (OverlayItemInput[])
   * @param libraryId - The Plex library ID
   */
  async applyOverlaysToCollectionItems(
    items: string[] | OverlayItemInput[],
    libraryId: string
  ): Promise<void> {
    try {
      // Clear library caches at start of job
      this.clearLibraryCaches();

      // Normalize input to OverlayItemInput[]
      const normalizedItems: OverlayItemInput[] = items.map((item) =>
        typeof item === 'string' ? { ratingKey: item } : item
      );

      logger.info('Applying overlays to collection items', {
        label: 'OverlayLibrary',
        itemCount: normalizedItems.length,
        libraryId,
      });

      // Get library configuration for templates
      const configRepository = getRepository(OverlayLibraryConfig);
      const config = await configRepository.findOne({
        where: { libraryId },
      });

      // Get enabled overlay templates (if any configured for this library)
      let templates: OverlayTemplate[] = [];
      if (config && config.enabledOverlays.length > 0) {
        const templateRepository = getRepository(OverlayTemplate);
        const enabledTemplateIds = config.enabledOverlays
          .filter((o) => o.enabled)
          .map((o) => o.templateId);

        templates = await templateRepository.findByIds(enabledTemplateIds);

        // Sort templates by layer order
        templates = templates.sort((a, b) => {
          const orderA =
            config.enabledOverlays.find((o) => o.templateId === a.id)
              ?.layerOrder || 0;
          const orderB =
            config.enabledOverlays.find((o) => o.templateId === b.id)
              ?.layerOrder || 0;
          return orderA - orderB;
        });
      }

      // Get admin user for Plex API
      const { getAdminUser } = await import(
        '@server/lib/collections/core/CollectionUtilities'
      );
      const admin = await getAdminUser();

      if (!admin) {
        throw new Error('No admin user found');
      }

      const plexApi = new PlexAPI({ plexToken: admin.plexToken });

      // Determine media type from library config
      const mediaType = config?.mediaType || 'movie';

      // Process each item
      let successCount = 0;
      let errorCount = 0;

      for (const { ratingKey, contextOverrides } of normalizedItems) {
        try {
          // Fetch item metadata
          const itemMetadata = await plexApi.getMetadata(ratingKey);

          if (itemMetadata) {
            // Convert to PlexLibraryItem format (cast to satisfy type requirements)
            const item = {
              ratingKey: itemMetadata.ratingKey,
              title: itemMetadata.title,
              year: (itemMetadata as { year?: number }).year,
              type: itemMetadata.type,
              guid: itemMetadata.guid || '',
              Guid: itemMetadata.Guid,
              Media: itemMetadata.Media,
              parentIndex: itemMetadata.parentIndex,
              index: itemMetadata.index,
              addedAt: itemMetadata.addedAt || 0,
              updatedAt: itemMetadata.updatedAt || 0,
            } as PlexLibraryItem;

            await this.applyOverlaysToItem(
              plexApi,
              item,
              templates,
              mediaType,
              contextOverrides
            );
            successCount++;
          }
        } catch (error) {
          errorCount++;
          logger.error('Failed to apply overlays to collection item', {
            label: 'OverlayLibrary',
            ratingKey,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      logger.info('Completed overlay application for collection items', {
        label: 'OverlayLibrary',
        successCount,
        errorCount,
        totalItems: normalizedItems.length,
      });
    } catch (error) {
      logger.error('Failed to apply overlays to collection items', {
        label: 'OverlayLibrary',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Apply overlays to a single Plex item
   */
  private async applyOverlaysToItem(
    plexApi: PlexAPI,
    item: PlexLibraryItem,
    templates: OverlayTemplate[],
    mediaType: 'movie' | 'show',
    contextOverrides?: Partial<OverlayRenderContext>
  ): Promise<void> {
    try {
      // Extract TMDB ID from item GUIDs
      let tmdbId: number | undefined;
      if (item.Guid && Array.isArray(item.Guid)) {
        const tmdbGuid = item.Guid.find((g) => g.id?.includes('tmdb://'));
        if (tmdbGuid) {
          const match = tmdbGuid.id.match(/tmdb:\/\/(\d+)/);
          if (match) {
            tmdbId = parseInt(match[1]);
          }
        }
      }

      // Must have TMDB ID to fetch fresh poster
      if (!tmdbId) {
        logger.debug('Skipping overlay - no TMDB ID found', {
          label: 'OverlayLibrary',
          itemTitle: item.title,
        });
        return;
      }

      // Fetch fresh poster from TMDB (avoids overlay-on-overlay issues)
      const tmdbClient = new TheMovieDb();
      let posterUrl: string | undefined;

      if (mediaType === 'movie') {
        const movieDetails = await tmdbClient.getMovie({ movieId: tmdbId });
        posterUrl = movieDetails.poster_path
          ? `https://image.tmdb.org/t/p/original${movieDetails.poster_path}`
          : undefined;
      } else {
        const showDetails = await tmdbClient.getTvShow({ tvId: tmdbId });
        posterUrl = showDetails.poster_path
          ? `https://image.tmdb.org/t/p/original${showDetails.poster_path}`
          : undefined;
      }

      if (!posterUrl) {
        logger.debug('Skipping overlay - no TMDB poster available', {
          label: 'OverlayLibrary',
          itemTitle: item.title,
          tmdbId,
        });
        return;
      }

      // Download poster
      const posterResponse = await axios.get(posterUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
      });
      const posterBuffer = Buffer.from(posterResponse.data);

      // Check if this is a Coming Soon placeholder first
      const comingSoonContext = await this.getComingSoonContext(item.ratingKey);
      const isPlaceholder = comingSoonContext?.itemType === 'placeholder';

      logger.debug('Retrieved Coming Soon context', {
        label: 'OverlayLibrary',
        itemTitle: item.title,
        ratingKey: item.ratingKey,
        comingSoonContext,
        isPlaceholder,
      });

      // Build context for dynamic fields (skip Plex media metadata for placeholders)
      const baseContext = await this.buildRenderContext(
        item,
        mediaType,
        isPlaceholder
      );

      // Fetch fresh release date information for recent items (year >= currentYear - 1)
      // This applies to ALL items, not just placeholders
      let freshReleaseDateContext: Partial<OverlayRenderContext> | undefined;
      if (tmdbId && item.year) {
        const releaseDateInfo = await this.fetchReleaseDateInfo(
          tmdbId,
          mediaType,
          item.year
        );

        if (releaseDateInfo) {
          // Calculate days until release and days ago
          const { calculateDaysSince } = await import(
            '@server/utils/dateHelpers'
          );
          let daysUntilRelease: number | undefined;
          let daysAgo: number | undefined;

          if (releaseDateInfo.releaseDate) {
            const daysSince = calculateDaysSince(releaseDateInfo.releaseDate);
            if (daysSince < 0) {
              daysUntilRelease = -daysSince;
            } else {
              daysAgo = daysSince;
            }
          }

          freshReleaseDateContext = {
            releaseDate: releaseDateInfo.releaseDate,
            daysUntilRelease,
            daysAgo,
            // Real items exist in Plex, so they're downloaded
            // Placeholders will override this with downloaded: false from comingSoonContext
            downloaded: !isPlaceholder,
          };

          logger.debug('Fetched fresh release date context', {
            label: 'OverlayLibrary',
            itemTitle: item.title,
            tmdbId,
            freshReleaseDateContext,
          });

          // Update placeholder database record if this is a placeholder
          if (isPlaceholder && releaseDateInfo.releaseDate) {
            try {
              const { getRepository } = await import('@server/datasource');
              const { ComingSoonItem } = await import(
                '@server/entity/ComingSoonItem'
              );
              const repository = getRepository(ComingSoonItem);

              await repository.update(
                { plexRatingKey: item.ratingKey },
                { releaseDate: releaseDateInfo.releaseDate }
              );

              logger.debug('Updated placeholder record with release date', {
                label: 'OverlayLibrary',
                itemTitle: item.title,
                ratingKey: item.ratingKey,
                releaseDate: releaseDateInfo.releaseDate,
              });
            } catch (error) {
              logger.debug('Failed to update placeholder record', {
                label: 'OverlayLibrary',
                itemTitle: item.title,
                ratingKey: item.ratingKey,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }
      }

      // Check monitoring status for real items (not placeholders)
      // Sets inRadarr/inSonarr and isMonitored with clear semantic meaning
      let monitoringContext: Partial<OverlayRenderContext> | undefined;
      if (!isPlaceholder && tmdbId) {
        monitoringContext = await this.checkRealItemMonitoringStatus(
          tmdbId,
          mediaType
        );
      }

      // Merge contexts: base → coming soon → fresh release dates → monitoring → explicit overrides
      // Fresh release dates override Coming Soon context (which may be stale)
      // Monitoring status overrides Coming Soon monitoring (for real items)
      const context: OverlayRenderContext = {
        ...baseContext,
        ...comingSoonContext,
        ...freshReleaseDateContext,
        ...monitoringContext,
        ...contextOverrides,
      };

      // Apply each template in order
      let currentBuffer = posterBuffer;
      let templatesApplied = 0;

      for (const template of templates) {
        // Check if application condition is met
        const condition = template.getApplicationCondition();
        if (!evaluateCondition(condition, context)) {
          logger.debug('Skipping template - condition not met', {
            label: 'OverlayLibrary',
            itemTitle: item.title,
            templateName: template.name,
            condition,
            contextData: {
              isMonitored: context.isMonitored,
              downloaded: context.downloaded,
              daysUntilRelease: context.daysUntilRelease,
              daysAgo: context.daysAgo,
              mediaType: context.mediaType,
              seasonNumber: context.seasonNumber,
              itemType: context.itemType,
            },
          });
          continue;
        }

        const templateData = template.getTemplateData();
        currentBuffer = await overlayTemplateRenderer.renderOverlay(
          currentBuffer,
          templateData,
          context
        );
        templatesApplied++;
      }

      // Save to temporary file
      const tempDir = os.tmpdir();
      const tempFilePath = path.join(
        tempDir,
        `overlay-${item.ratingKey}-${Date.now()}.webp`
      );

      await fs.writeFile(tempFilePath, currentBuffer);

      try {
        // Upload modified poster back to Plex
        await plexApi.uploadPosterFromFile(item.ratingKey, tempFilePath);

        // Manage "Overlay" label based on whether overlays were applied
        if (templatesApplied > 0) {
          // Add "Overlay" label to indicate this item has overlays
          try {
            await plexApi.addLabelToItem(item.ratingKey, 'Overlay');
            logger.debug('Added Overlay label', {
              label: 'OverlayLibrary',
              itemTitle: item.title,
              ratingKey: item.ratingKey,
              templatesApplied,
            });
          } catch (error) {
            // Log but don't fail the entire operation if label addition fails
            logger.warn('Failed to add Overlay label', {
              label: 'OverlayLibrary',
              itemTitle: item.title,
              ratingKey: item.ratingKey,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        } else {
          // Remove "Overlay" label since we've reset to default poster
          try {
            await plexApi.removeLabelFromItem(item.ratingKey, 'Overlay');
            logger.debug('Removed Overlay label - no templates applied', {
              label: 'OverlayLibrary',
              itemTitle: item.title,
              ratingKey: item.ratingKey,
            });
          } catch (error) {
            // Log but don't fail the entire operation if label removal fails
            logger.warn('Failed to remove Overlay label', {
              label: 'OverlayLibrary',
              itemTitle: item.title,
              ratingKey: item.ratingKey,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        logger.info('Applied overlays to item', {
          label: 'OverlayLibrary',
          itemTitle: item.title,
          templateCount: templates.length,
          templatesApplied,
        });
      } finally {
        // Clean up temp file
        await fs.unlink(tempFilePath).catch(() => {
          // Ignore cleanup errors
        });
      }
    } catch (error) {
      logger.error('Failed to apply overlays to item', {
        label: 'OverlayLibrary',
        itemTitle: item.title,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        errorDetails: error,
      });
      throw error;
    }
  }

  /**
   * Build context for dynamic field replacement
   */
  private async buildRenderContext(
    item: PlexLibraryItem,
    mediaType: 'movie' | 'show',
    isPlaceholder = false
  ): Promise<OverlayRenderContext> {
    const context: OverlayRenderContext = {
      title: item.title,
      year: item.year,
      itemType: isPlaceholder ? 'placeholder' : 'real',
      mediaType,
    };

    // Extract TMDb ID from GUID
    let tmdbId: number | undefined;

    if (item.Guid && Array.isArray(item.Guid)) {
      const tmdbGuid = item.Guid.find((g) => g.id?.includes('tmdb://'));
      if (tmdbGuid) {
        const match = tmdbGuid.id.match(/tmdb:\/\/(\d+)/);
        if (match) {
          tmdbId = parseInt(match[1]);
        }
      }
    }

    if (tmdbId) {
      try {
        // Fetch TMDb data
        const tmdbClient = new TheMovieDb();
        const tmdbData =
          mediaType === 'movie'
            ? await tmdbClient.getMovie({ movieId: tmdbId })
            : await tmdbClient.getTvShow({ tvId: tmdbId });

        // Get IMDb ID
        const imdbId = tmdbData.external_ids?.imdb_id;

        // Fetch ratings
        if (imdbId) {
          // IMDb rating
          try {
            const imdbApi = new ImdbRatingsAPI();
            const imdbRatings = await imdbApi.getRatings(imdbId);
            if (imdbRatings.length > 0 && imdbRatings[0].rating !== null) {
              context.imdbRating = imdbRatings[0].rating;
            }
          } catch (error) {
            logger.debug('Failed to fetch IMDb rating', {
              label: 'OverlayLibrary',
              imdbId,
            });
          }

          // IMDb Top 250 check
          try {
            const imdbClient = await this.getImdbClient();
            const imdbMediaType: 'movie' | 'tv' =
              mediaType === 'show' ? 'tv' : 'movie';
            const top250Result = await imdbClient.checkTop250(
              imdbId,
              imdbMediaType
            );

            if (top250Result.isTop250) {
              context.isImdbTop250 = true;
              context.imdbTop250Rank = top250Result.rank;
            }
          } catch (error) {
            logger.debug('Failed to check IMDb Top 250', {
              label: 'OverlayLibrary',
              imdbId,
              error: error instanceof Error ? error.message : String(error),
            });
          }

          // Rotten Tomatoes ratings
          try {
            const rtClient = new RottenTomatoes();
            const rtRating =
              mediaType === 'movie'
                ? await rtClient.getMovieRatings(
                    context.title || '',
                    context.year || 0
                  )
                : await rtClient.getTVRatings(
                    context.title || '',
                    context.year
                  );

            if (rtRating) {
              context.rtCriticsScore = rtRating.criticsScore;
              context.rtAudienceScore = rtRating.audienceScore;
              logger.debug('Fetched RT ratings', {
                label: 'OverlayLibrary',
                title: context.title,
                criticsScore: rtRating.criticsScore,
                audienceScore: rtRating.audienceScore,
              });
            } else {
              logger.debug('RT rating not found', {
                label: 'OverlayLibrary',
                title: context.title,
                year: context.year,
              });
            }
          } catch (error) {
            logger.debug('Failed to fetch RT rating', {
              label: 'OverlayLibrary',
              title: context.title,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        // Movie-specific metadata
        if (mediaType === 'movie' && 'credits' in tmdbData) {
          const director = tmdbData.credits?.crew?.find(
            (c) => c.job === 'Director'
          );
          if (director) {
            context.director = director.name;
          }
        }

        // Studio/Network
        if (
          'production_companies' in tmdbData &&
          tmdbData.production_companies?.[0]
        ) {
          context.studio = tmdbData.production_companies[0].name;
        }

        // Genre (concatenate all genres for matching)
        if (
          'genres' in tmdbData &&
          tmdbData.genres &&
          tmdbData.genres.length > 0
        ) {
          context.genre = tmdbData.genres
            .map((g: { name: string }) => g.name)
            .join(', ');
        }

        // Runtime
        if (mediaType === 'movie' && 'runtime' in tmdbData) {
          context.runtime = tmdbData.runtime;
        } else if (
          mediaType === 'show' &&
          'episode_run_time' in tmdbData &&
          tmdbData.episode_run_time?.[0]
        ) {
          context.runtime = tmdbData.episode_run_time[0];
        }
      } catch (error) {
        logger.debug('Failed to fetch external metadata', {
          label: 'OverlayLibrary',
          tmdbId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Plex-specific metadata from Media (skip for placeholder items)
    if (!isPlaceholder && item.Media?.[0]) {
      const media = item.Media[0];

      // Resolution - use raw value from Plex (e.g., "720", "1080", "4k")
      if (media.videoResolution) {
        context.resolution = media.videoResolution;
      }

      // Dimensions
      context.width = media.width;
      context.height = media.height;
      context.aspectRatio = media.aspectRatio;

      // Video specs (from Media level)
      context.videoCodec = media.videoCodec;
      context.videoProfile = media.videoProfile;
      context.videoFrameRate = media.videoFrameRate;

      // Audio specs (from Media level)
      context.audioCodec = media.audioCodec;
      context.audioChannels = media.audioChannels;

      // File info
      context.container = media.container;
      context.bitrate = media.bitrate;

      // Extract detailed info from Streams
      if (media.Part?.[0]?.Stream) {
        const streams = media.Part[0].Stream;

        // Find video stream (streamType 1)
        const videoStream = streams.find((s) => s.streamType === 1);
        if (videoStream) {
          // HDR/Dolby Vision detection
          context.dolbyVision = videoStream.DOVIPresent || false;
          // Check for HDR in color transfer characteristic
          context.hdr =
            videoStream.colorTrc?.toLowerCase().includes('smpte2084') ||
            videoStream.colorTrc?.toLowerCase().includes('arib') ||
            false;
          // Parse bitDepth as number (Plex returns it as string)
          if (videoStream.bitDepth) {
            context.bitDepth = parseInt(String(videoStream.bitDepth), 10);
          }
        }

        // Find audio stream (streamType 2) - prefer first one
        const audioStream = streams.find((s) => s.streamType === 2);
        if (audioStream) {
          // Detailed audio format from displayTitle
          if (audioStream.displayTitle) {
            context.audioFormat = audioStream.displayTitle;
          }
          // Audio channel layout
          if (audioStream.audioChannelLayout) {
            context.audioChannelLayout = audioStream.audioChannelLayout;
          }
          if (audioStream.channels) {
            context.audioChannels = audioStream.channels;
          }
        }

        // Get file path from Part
        if (media.Part[0].file) {
          context.filePath = media.Part[0].file;
        }
        // Get file size
        if (media.Part[0].size) {
          context.fileSize = media.Part[0].size;
        }
      }
    }

    // Playback stats and dates
    if (item.viewCount !== undefined) {
      context.viewCount = item.viewCount;
    }
    if (item.lastViewedAt) {
      context.lastPlayed = new Date(item.lastViewedAt * 1000);
    }
    if (item.addedAt) {
      context.dateAdded = new Date(item.addedAt * 1000);
    }

    // TV-specific
    if (mediaType === 'show') {
      context.seasonNumber = item.parentIndex;
      context.episodeNumber = item.index;
    }

    return context;
  }

  /**
   * Fetch fresh release date information from TMDB
   * For items with year >= currentYear - 1
   */
  private async fetchReleaseDateInfo(
    tmdbId: number,
    mediaType: 'movie' | 'show',
    itemYear?: number
  ): Promise<
    | {
        releaseDate?: string;
        digitalRelease?: string;
        physicalRelease?: string;
        inCinemas?: string;
        airDate?: string;
        isEstimated?: boolean;
      }
    | undefined
  > {
    const currentYear = new Date().getFullYear();

    // Only fetch for recent items (last year and beyond)
    if (!itemYear || itemYear < currentYear - 1) {
      return undefined;
    }

    try {
      const tmdbClient = new TheMovieDb();

      if (mediaType === 'movie') {
        const movieDetails = await tmdbClient.getMovie({ movieId: tmdbId });

        // Extract release dates using shared helper
        const { extractReleaseDates, determineReleaseDate } = await import(
          '@server/utils/dateHelpers'
        );

        const extracted = movieDetails.release_dates?.results
          ? extractReleaseDates(movieDetails.release_dates.results)
          : {};

        // Fallback to generic release_date if no specific theatrical date
        const inCinemas =
          extracted.inCinemas || movieDetails.release_date || undefined;

        // Use shared priority logic: Digital > Physical > Theatrical (+90 days)
        const releaseDateResult = determineReleaseDate(
          extracted.digitalRelease,
          extracted.physicalRelease,
          inCinemas
        );

        if (releaseDateResult) {
          logger.debug('Fetched release dates from TMDB (movie)', {
            label: 'OverlayLibrary',
            tmdbId,
            releaseDate: releaseDateResult.releaseDate,
            digitalRelease: extracted.digitalRelease,
            physicalRelease: extracted.physicalRelease,
            inCinemas,
            isEstimated: releaseDateResult.isEstimated,
          });

          return {
            releaseDate: releaseDateResult.releaseDate,
            digitalRelease: extracted.digitalRelease,
            physicalRelease: extracted.physicalRelease,
            inCinemas,
            isEstimated: releaseDateResult.isEstimated,
          };
        }
      } else {
        const showDetails = await tmdbClient.getTvShow({ tvId: tmdbId });

        if (showDetails.next_episode_to_air?.air_date) {
          logger.debug('Fetched release dates from TMDB (TV)', {
            label: 'OverlayLibrary',
            tmdbId,
            airDate: showDetails.next_episode_to_air.air_date,
          });

          return {
            releaseDate: showDetails.next_episode_to_air.air_date,
            airDate: showDetails.next_episode_to_air.air_date,
            isEstimated: false,
          };
        }
      }

      return undefined;
    } catch (error) {
      logger.debug('Failed to fetch release date info', {
        label: 'OverlayLibrary',
        tmdbId,
        mediaType,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  /**
   * Get Coming Soon context data for placeholder items
   * Returns undefined if item is not a Coming Soon placeholder
   */
  private async getComingSoonContext(
    ratingKey: string
  ): Promise<Partial<OverlayRenderContext> | undefined> {
    try {
      const { getRepository } = await import('@server/datasource');
      const { ComingSoonItem } = await import('@server/entity/ComingSoonItem');

      const repository = getRepository(ComingSoonItem);
      const comingSoonItem = await repository.findOne({
        where: { plexRatingKey: ratingKey },
      });

      if (!comingSoonItem) {
        return undefined;
      }

      // Calculate days until release and days ago
      const { calculateDaysSince } = await import('@server/utils/dateHelpers');
      let daysUntilRelease: number | undefined;
      let daysAgo: number | undefined;

      if (comingSoonItem.releaseDate) {
        const daysSince = calculateDaysSince(comingSoonItem.releaseDate);
        if (daysSince < 0) {
          // Future date - negate to get days until
          daysUntilRelease = -daysSince;
        } else {
          // Past date - this is days ago
          daysAgo = daysSince;
        }
      }

      // Check if item is actually monitored in Radarr/Sonarr
      // Use semantic variables: inRadarr/inSonarr + isMonitored
      let inRadarr = false;
      let inSonarr = false;
      let isMonitored = false;

      try {
        const settings = getSettings();

        if (
          comingSoonItem.mediaType === 'movie' &&
          settings.radarr.length > 0
        ) {
          // Check Radarr for movies
          // Try each configured Radarr instance
          for (const radarrSettings of settings.radarr) {
            // Skip if hostname is not configured
            if (!radarrSettings.hostname) {
              continue;
            }

            try {
              // Get cached Radarr movies and find by TMDB ID
              logger.debug('Checking Radarr for movie', {
                label: 'OverlayLibrary',
                tmdbId: comingSoonItem.tmdbId,
                hostname: radarrSettings.hostname,
              });

              const movies = await this.getRadarrMovies(radarrSettings);

              logger.debug('Retrieved Radarr movies from cache', {
                label: 'OverlayLibrary',
                movieCount: movies.length,
                hostname: radarrSettings.hostname,
              });

              const movie = movies.find(
                (m) => m.tmdbId === comingSoonItem.tmdbId
              );

              if (movie) {
                logger.debug('Found movie in Radarr', {
                  label: 'OverlayLibrary',
                  tmdbId: comingSoonItem.tmdbId,
                  monitored: movie.monitored,
                });
                inRadarr = true;
                isMonitored = movie.monitored;
                break;
              } else {
                logger.debug('Movie not found in Radarr movies', {
                  label: 'OverlayLibrary',
                  tmdbId: comingSoonItem.tmdbId,
                  radarrMovieCount: movies.length,
                });
              }
            } catch (err) {
              // Failed to get movies from this Radarr instance, try next
              logger.error('Error checking Radarr instance', {
                label: 'OverlayLibrary',
                hostname: radarrSettings.hostname,
                error: err instanceof Error ? err.message : String(err),
                stack: err instanceof Error ? err.stack : undefined,
              });
              continue;
            }
          }
        } else if (
          comingSoonItem.mediaType === 'tv' &&
          settings.sonarr.length > 0
        ) {
          // Check Sonarr for TV shows
          // Try each configured Sonarr instance
          for (const sonarrSettings of settings.sonarr) {
            // Skip if hostname is not configured
            if (!sonarrSettings.hostname) {
              continue;
            }

            try {
              // Sonarr uses TVDB ID, not TMDB ID
              if (comingSoonItem.tvdbId) {
                // Get cached Sonarr series and find by TVDB ID
                const allSeries = await this.getSonarrSeries(sonarrSettings);
                const series = allSeries.find(
                  (s) => s.tvdbId === comingSoonItem.tvdbId
                );

                if (series) {
                  inSonarr = true;
                  isMonitored = series.monitored;
                  break;
                }
              }
            } catch {
              // Failed to get series from this Sonarr instance, try next
              continue;
            }
          }
        }
      } catch (error) {
        logger.error('Failed to check monitored status in Radarr/Sonarr', {
          label: 'OverlayLibrary',
          mediaType: comingSoonItem.mediaType,
          tmdbId: comingSoonItem.tmdbId,
          tvdbId: comingSoonItem.tvdbId,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        // If we can't check, default to false (not monitored, not in *arr)
      }

      // Build context with Coming Soon specific fields
      return {
        releaseDate: comingSoonItem.releaseDate,
        daysUntilRelease,
        daysAgo,
        seasonNumber: comingSoonItem.seasonNumber,
        inRadarr,
        inSonarr,
        isMonitored,
        downloaded: false, // Placeholders are by definition not downloaded
        itemType: 'placeholder',
      };
    } catch (error) {
      // If ComingSoonItem table doesn't exist or query fails, just return undefined
      logger.debug('Failed to fetch Coming Soon context', {
        label: 'OverlayLibrary',
        ratingKey,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  /**
   * Check monitoring status for real items (non-placeholders) in Radarr/Sonarr
   * Returns semantic status with clear meaning:
   * - inRadarr/inSonarr: Whether item exists in any *arr instance
   * - isMonitored: Whether item is monitored (only set if found in *arr)
   */
  private async checkRealItemMonitoringStatus(
    tmdbId: number,
    mediaType: 'movie' | 'show'
  ): Promise<{
    inRadarr?: boolean;
    inSonarr?: boolean;
    isMonitored?: boolean;
  }> {
    try {
      const settings = getSettings();

      if (mediaType === 'movie' && settings.radarr.length > 0) {
        // Check Radarr for movies
        // Try each configured Radarr instance
        for (const radarrSettings of settings.radarr) {
          if (!radarrSettings.hostname) {
            continue;
          }

          try {
            // Get cached Radarr movies and find by TMDB ID
            const movies = await this.getRadarrMovies(radarrSettings);
            const movie = movies.find((m) => m.tmdbId === tmdbId);

            if (movie) {
              // Movie found in Radarr
              logger.debug('Found movie in Radarr', {
                label: 'OverlayLibrary',
                tmdbId,
                monitored: movie.monitored,
              });
              return {
                inRadarr: true,
                isMonitored: movie.monitored,
              };
            }
          } catch {
            // Failed to get movies from this instance, try next
            continue;
          }
        }

        // Not found in any Radarr instance
        logger.debug('Movie not found in any Radarr instance', {
          label: 'OverlayLibrary',
          tmdbId,
        });
        return { inRadarr: false };
      } else if (mediaType === 'show' && settings.sonarr.length > 0) {
        // Check Sonarr for TV shows
        // Get TVDB ID from TMDB (Sonarr uses TVDB)
        const tvdbId = await this.getTvdbIdFromTmdb(tmdbId);

        if (!tvdbId) {
          logger.debug('Cannot check Sonarr - no TVDB ID available', {
            label: 'OverlayLibrary',
            tmdbId,
          });
          return {};
        }

        // Try each configured Sonarr instance
        for (const sonarrSettings of settings.sonarr) {
          if (!sonarrSettings.hostname) {
            continue;
          }

          try {
            // Get cached Sonarr series and find by TVDB ID
            const allSeries = await this.getSonarrSeries(sonarrSettings);
            const series = allSeries.find((s) => s.tvdbId === tvdbId);

            if (series) {
              // Series found in Sonarr
              logger.debug('Found series in Sonarr', {
                label: 'OverlayLibrary',
                tmdbId,
                tvdbId,
                monitored: series.monitored,
              });
              return {
                inSonarr: true,
                isMonitored: series.monitored,
              };
            }
          } catch {
            // Failed to get series from this instance, try next
            continue;
          }
        }

        // Not found in any Sonarr instance
        logger.debug('Series not found in any Sonarr instance', {
          label: 'OverlayLibrary',
          tmdbId,
        });
        return { inSonarr: false };
      }

      // No *arr instances configured
      return {};
    } catch (error) {
      logger.debug('Failed to check monitoring status', {
        label: 'OverlayLibrary',
        mediaType,
        tmdbId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {};
    }
  }

  /**
   * Get TVDB ID from TMDB ID for TV shows
   * Required for Sonarr lookups since Sonarr uses TVDB IDs
   */
  private async getTvdbIdFromTmdb(tmdbId: number): Promise<number | undefined> {
    try {
      const tmdbClient = new TheMovieDb();
      const showDetails = await tmdbClient.getTvShow({ tvId: tmdbId });

      return showDetails.external_ids?.tvdb_id;
    } catch (error) {
      logger.debug('Failed to get TVDB ID from TMDB', {
        label: 'OverlayLibrary',
        tmdbId,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }
}

export const overlayLibraryService = new OverlayLibraryService();
