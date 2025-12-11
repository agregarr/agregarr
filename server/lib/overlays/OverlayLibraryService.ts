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
            config.mediaType,
            libraryId
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

      // Early return if no overlays configured (same logic as applyOverlaysToLibrary)
      if (!config || config.enabledOverlays.length === 0) {
        logger.info(
          'No overlays enabled for library, skipping overlay application',
          {
            label: 'OverlayLibrary',
            libraryId,
          }
        );
        return;
      }

      // Get enabled overlay templates
      const templateRepository = getRepository(OverlayTemplate);
      const enabledTemplateIds = config.enabledOverlays
        .filter((o) => o.enabled)
        .map((o) => o.templateId);

      const templates = await templateRepository.findByIds(enabledTemplateIds);

      if (templates.length === 0) {
        logger.info(
          'No templates found for library, skipping overlay application',
          {
            label: 'OverlayLibrary',
            libraryId,
          }
        );
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
      const mediaType = config.mediaType || 'movie';

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
              sortedTemplates,
              mediaType,
              libraryId,
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
   *
   * NOTE: configuredLibraryType is the library's configured type, but PlexBasePosterManager
   * will use item.type for TMDB API calls to prevent fetching wrong posters
   */
  private async applyOverlaysToItem(
    plexApi: PlexAPI,
    item: PlexLibraryItem,
    templates: OverlayTemplate[],
    configuredLibraryType: 'movie' | 'show',
    libraryId: string,
    contextOverrides?: Partial<OverlayRenderContext>
  ): Promise<void> {
    try {
      // CRITICAL: Derive actual media type from item.type, not library config
      // This prevents TMDB API namespace mismatches that cause wrong posters
      const actualMediaType: 'movie' | 'show' =
        item.type === 'movie' ? 'movie' : 'show';

      // Warn if there's a mismatch between item type and library config
      if (actualMediaType !== configuredLibraryType) {
        logger.warn('Item type does not match library configuration', {
          label: 'OverlayLibrary',
          itemTitle: item.title,
          ratingKey: item.ratingKey,
          itemType: item.type,
          configuredLibraryType,
          usingType: actualMediaType,
        });
      }

      // Get metadata tracking for this item
      const metadataService = (
        await import('@server/lib/metadata/MetadataTrackingService')
      ).default;
      const metadata = await metadataService.getItemMetadata(item.ratingKey);

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

      // Check if this is a placeholder (async version with API call for suspicious items)
      const { placeholderContextService } = await import(
        '@server/lib/collections/services/PlaceholderContextService'
      );
      const plexMetadata = item as {
        type: string;
        guid?: string;
        editionTitle?: string;
        Guid?: { id: string }[];
        childCount?: number;
        Children?: { Metadata?: unknown[] };
        seasonCount?: number;
        leafCount?: number;
        ratingKey?: string;
      };

      logger.debug('Calling async placeholder detection', {
        label: 'OverlayLibrary',
        itemTitle: item.title,
        ratingKey: item.ratingKey,
        leafCount: plexMetadata.leafCount,
        type: plexMetadata.type,
      });

      const isPlaceholder =
        await placeholderContextService.isPlaceholderItemAsync(
          plexMetadata,
          plexApi['plexClient'] as {
            query: (path: string) => Promise<{
              MediaContainer?: { Directory?: unknown[]; Metadata?: unknown[] };
            }>;
          }
        );

      logger.debug('Async placeholder detection result', {
        label: 'OverlayLibrary',
        itemTitle: item.title,
        ratingKey: item.ratingKey,
        isPlaceholder,
      });

      // Build base context for dynamic fields
      const baseContext = await this.buildRenderContext(
        item,
        actualMediaType,
        isPlaceholder
      );

      // Fetch fresh release date information for ALL items with TMDB ID
      let releaseDateContext: Partial<OverlayRenderContext> = {};
      if (tmdbId) {
        const releaseDateInfo = await this.fetchReleaseDateInfo(
          tmdbId,
          actualMediaType
        );

        if (releaseDateInfo) {
          // Calculate days until release and days ago
          const { calculateDaysSince } = await import(
            '@server/utils/dateHelpers'
          );
          let daysUntilRelease: number | undefined;
          let daysAgo: number | undefined;
          let daysUntilNextEpisode: number | undefined;
          let daysUntilNextSeason: number | undefined;

          if (releaseDateInfo.releaseDate) {
            const daysSince = calculateDaysSince(releaseDateInfo.releaseDate);
            if (daysSince < 0) {
              daysUntilRelease = -daysSince;
            } else {
              daysAgo = daysSince;
            }
          }

          if (releaseDateInfo.nextEpisodeAirDate) {
            const daysSince = calculateDaysSince(
              releaseDateInfo.nextEpisodeAirDate
            );
            if (daysSince < 0) {
              daysUntilNextEpisode = -daysSince;
            }
          }

          if (releaseDateInfo.nextSeasonAirDate) {
            const daysSince = calculateDaysSince(
              releaseDateInfo.nextSeasonAirDate
            );
            if (daysSince < 0) {
              daysUntilNextSeason = -daysSince;
            }
          }

          releaseDateContext = {
            releaseDate: releaseDateInfo.releaseDate,
            daysUntilRelease,
            daysAgo,
            nextEpisodeAirDate: releaseDateInfo.nextEpisodeAirDate,
            daysUntilNextEpisode,
            nextSeasonAirDate: releaseDateInfo.nextSeasonAirDate,
            daysUntilNextSeason,
            seasonNumber: releaseDateInfo.seasonNumber,
          };
        }
      }

      // Check monitoring status for ALL items with TMDB ID
      let monitoringContext: Partial<OverlayRenderContext> = {};
      if (tmdbId) {
        monitoringContext = await this.checkMonitoringStatus(
          tmdbId,
          actualMediaType
        );
      }

      // Merge contexts: base → release dates → monitoring → explicit overrides
      // Set isPlaceholder and downloaded at the end so they're always present

      // CRITICAL: If *arr reports hasFile=true, the item CANNOT be a placeholder
      // This overrides incorrect placeholder detection (e.g., corrupted metadata)
      let actualIsPlaceholder = isPlaceholder;
      if (monitoringContext.hasFile === true) {
        actualIsPlaceholder = false; // *arr has files, so it's definitely not a placeholder
      }

      // For downloaded: placeholders are never downloaded, real items check *arr hasFile status
      let downloaded: boolean;
      if (actualIsPlaceholder) {
        downloaded = false; // Placeholders are never downloaded
      } else if (typeof monitoringContext.hasFile === 'boolean') {
        downloaded = monitoringContext.hasFile; // Real monitored items use *arr hasFile status
      } else {
        downloaded = true; // Real items not in *arr are assumed downloaded (they exist in Plex)
      }

      const context: OverlayRenderContext = {
        ...baseContext,
        ...releaseDateContext,
        ...monitoringContext,
        ...contextOverrides,
        isPlaceholder: actualIsPlaceholder,
        downloaded,
      };

      // Filter templates by conditions to get only templates that will actually be applied
      // CRITICAL: Hash must be based on MATCHING templates, not all enabled templates
      // This ensures hash changes when different templates match due to context changes
      const matchingTemplates = templates.filter((template) => {
        const condition = template.getApplicationCondition();
        return evaluateCondition(condition, context);
      });

      // Calculate overlay input hash for metadata tracking
      // Extract which context fields are actually used by MATCHING templates
      // CRITICAL: Hash uses matching template IDs + variable field values + condition field values
      // Template IDs capture which templates match, field values capture all data affecting rendering
      const { calculateOverlayInputHash, extractUsedContextFields } =
        await import('@server/utils/metadataHashing');

      const templateDataArray = matchingTemplates.map((t) =>
        t.getTemplateData()
      );
      const applicationConditions = matchingTemplates.map((t) =>
        t.getApplicationCondition()
      );
      const usedFields = extractUsedContextFields(
        templateDataArray,
        applicationConditions
      );

      const overlayInputHash = calculateOverlayInputHash({
        templateIds: matchingTemplates.map((t) => t.id).sort(),
        usedFields: usedFields,
        context: context as Record<string, unknown>,
      });

      // Debug logging for hash comparison
      logger.debug('Overlay hash comparison', {
        label: 'OverlayLibrary',
        itemTitle: item.title,
        ratingKey: item.ratingKey,
        oldHash: metadata?.lastOverlayInputHash,
        newHash: overlayInputHash,
        matchingTemplateIds: matchingTemplates.map((t) => t.id).sort(),
        matchingTemplateNames: matchingTemplates.map((t) => t.name),
        usedFields: Array.from(usedFields),
        contextValues: {
          downloaded: context.downloaded,
          hasFile: context.hasFile,
          isMonitored: context.isMonitored,
          inSonarr: context.inSonarr,
          daysAgo: context.daysAgo,
          isPlaceholder: context.isPlaceholder,
        },
      });

      // OPTIMIZATION: Check if overlay inputs changed BEFORE downloading poster
      // This prevents expensive poster downloads when nothing has changed
      try {
        const currentPosterUrl = await plexApi.getCurrentPosterUrl(
          item.ratingKey
        );

        const overlayInputsChanged =
          metadata?.lastOverlayInputHash !== overlayInputHash;

        // Check if Plex poster changed using normalized comparison
        // This handles different URL formats (upload://, /library/metadata/, http://...)
        const { posterUrlsMatch, extractThumbId } = await import(
          '@server/utils/posterUrlHelpers'
        );
        const plexPosterMissing = !posterUrlsMatch(
          metadata?.ourOverlayPosterUrl,
          currentPosterUrl
        );

        // Debug logging for poster URL comparison
        logger.debug('Poster URL comparison', {
          label: 'OverlayLibrary',
          itemTitle: item.title,
          storedUrl: metadata?.ourOverlayPosterUrl,
          currentUrl: currentPosterUrl,
          storedThumbId: extractThumbId(metadata?.ourOverlayPosterUrl),
          currentThumbId: extractThumbId(currentPosterUrl),
          urlsMatch: !plexPosterMissing,
          plexPosterMissing,
        });

        // Also check if base poster source changed (TMDB vs Plex)
        const settings = getSettings();
        const posterSource = settings.overlays?.defaultPosterSource || 'tmdb';
        const basePosterSourceChanged =
          metadata?.basePosterSource !== posterSource;

        if (
          !overlayInputsChanged &&
          !plexPosterMissing &&
          !basePosterSourceChanged
        ) {
          logger.debug('Nothing changed, skipping overlay application', {
            label: 'OverlayLibrary',
            itemTitle: item.title,
            ratingKey: item.ratingKey,
            overlayInputsChanged: false,
            plexPosterMissing: false,
            basePosterSourceChanged: false,
          });
          return; // Skip this item - no need to download poster
        }

        logger.info('Applying overlays - changes detected', {
          label: 'OverlayLibrary',
          itemTitle: item.title,
          overlayInputsChanged,
          plexPosterMissing,
          basePosterSourceChanged,
        });
      } catch (metaError) {
        logger.warn('Metadata check failed, proceeding with overlay', {
          label: 'MetadataTracking',
          error:
            metaError instanceof Error ? metaError.message : String(metaError),
        });
        // Fall through to apply overlay
      }

      // ONLY download poster if we've determined changes exist
      // Get poster source preference (global setting)
      const settings = getSettings();
      const posterSource = settings.overlays?.defaultPosterSource || 'tmdb';

      // Get base poster with change detection
      const { plexBasePosterManager } = await import(
        '@server/lib/overlays/PlexBasePosterManager'
      );

      let basePosterResult: {
        posterBuffer: Buffer;
        basePosterChanged: boolean;
        sourceUrl: string;
        filename: string;
      };

      try {
        basePosterResult = await plexBasePosterManager.getBasePosterForOverlay(
          plexApi,
          item,
          libraryId,
          configuredLibraryType,
          posterSource,
          {
            basePosterSource: metadata?.basePosterSource,
            originalPlexPosterUrl: metadata?.originalPlexPosterUrl,
            ourOverlayPosterUrl: metadata?.ourOverlayPosterUrl,
            basePosterFilename: metadata?.basePosterFilename,
          }
        );
      } catch (error) {
        logger.error('Failed to get base poster, skipping overlay', {
          label: 'OverlayLibrary',
          itemTitle: item.title,
          ratingKey: item.ratingKey,
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }

      const posterBuffer = basePosterResult.posterBuffer;

      // Apply each template in order
      let currentBuffer = posterBuffer;
      let templatesApplied = 0;

      for (const template of templates) {
        // Check if application condition is met
        const condition = template.getApplicationCondition();
        if (!evaluateCondition(condition, context)) {
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

        // Record overlay metadata tracking with base poster info
        try {
          const newPosterUrl = await plexApi.getCurrentPosterUrl(
            item.ratingKey
          );

          if (newPosterUrl) {
            await metadataService.recordOverlayApplicationWithBasePoster(
              item.ratingKey,
              libraryId,
              overlayInputHash,
              newPosterUrl,
              {
                basePosterSource: posterSource,
                originalPlexPosterUrl: basePosterResult.sourceUrl,
                basePosterFilename: basePosterResult.filename,
              }
            );
          }
        } catch (metaError) {
          logger.error('Failed to record overlay metadata, upload succeeded', {
            label: 'MetadataTracking',
            error:
              metaError instanceof Error
                ? metaError.message
                : String(metaError),
          });
        }

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
      isPlaceholder,
      mediaType,
      downloaded: !isPlaceholder, // Real items in Plex are downloaded, placeholders are not
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

        // TMDB Status (TV shows only) - using Kometa's user-friendly mapping
        if (mediaType === 'show' && 'status' in tmdbData) {
          const rawStatus = tmdbData.status;

          // Map TMDB status to user-friendly names (based on Kometa)
          let mappedStatus: string;
          switch (rawStatus) {
            case 'Returning Series':
              mappedStatus = 'RETURNING';
              break;
            case 'Ended':
              mappedStatus = 'ENDED';
              break;
            case 'Canceled':
              mappedStatus = 'CANCELLED';
              break;
            case 'Planned':
              mappedStatus = 'PLANNED';
              break;
            case 'In Production':
              mappedStatus = 'IN PRODUCTION';
              break;
            case 'Pilot':
              mappedStatus = 'PILOT';
              break;
            default:
              mappedStatus = rawStatus.toUpperCase();
          }

          // Check if an episode aired in last 15 days to determine "AIRING" status
          // Only override to AIRING if status is "Returning Series"
          // Use last_episode_to_air.air_date for accuracy (more reliable than last_air_date)
          if (
            rawStatus === 'Returning Series' &&
            'last_episode_to_air' in tmdbData &&
            tmdbData.last_episode_to_air?.air_date
          ) {
            const lastAired = new Date(tmdbData.last_episode_to_air.air_date);
            const daysSinceAired = Math.floor(
              (Date.now() - lastAired.getTime()) / (1000 * 60 * 60 * 24)
            );

            logger.debug('Checking AIRING status', {
              label: 'OverlayLibrary',
              title: context.title,
              lastEpisodeAirDate: tmdbData.last_episode_to_air.air_date,
              daysSinceAired,
              threshold: 15,
            });

            if (daysSinceAired <= 15) {
              mappedStatus = 'AIRING';
            }
          }

          context.tmdbStatus = mappedStatus;
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
      // For episode-level items, use parentIndex for season
      // For show-level items (placeholders/shows), parentIndex is undefined
      if (item.parentIndex !== undefined) {
        context.seasonNumber = item.parentIndex;
      }

      if (item.index !== undefined) {
        context.episodeNumber = item.index;
      }
    }

    return context;
  }

  /**
   * Fetch release date information from TMDB
   * For movies: Gets digital/physical/theatrical release dates
   * For TV: Gets next episode air date
   */
  private async fetchReleaseDateInfo(
    tmdbId: number,
    mediaType: 'movie' | 'show'
  ): Promise<
    | {
        releaseDate?: string;
        nextEpisodeAirDate?: string;
        nextSeasonAirDate?: string;
        seasonNumber?: number;
      }
    | undefined
  > {
    try {
      const tmdbClient = new TheMovieDb();

      if (mediaType === 'movie') {
        const movieDetails = await tmdbClient.getMovie({ movieId: tmdbId });

        // For movies, use proper release date calculation (digital > physical > theatrical+90)
        // This matches PlaceholderContextService implementation
        if (movieDetails.release_dates?.results) {
          const { extractReleaseDates, determineReleaseDate } = await import(
            '@server/utils/dateHelpers'
          );
          const extracted = extractReleaseDates(
            movieDetails.release_dates.results
          );

          const determined = determineReleaseDate(
            extracted.digitalRelease,
            extracted.physicalRelease,
            extracted.inCinemas
          );

          if (determined) {
            return {
              releaseDate: determined.releaseDate,
            };
          }
        }

        // Fallback to simple release_date if release_dates not available
        if (movieDetails.release_date) {
          return {
            releaseDate: movieDetails.release_date,
          };
        }
      } else {
        // For TV shows
        const showDetails = await tmdbClient.getTvShow({ tvId: tmdbId });

        // Get next episode info
        const nextEpisode = showDetails.next_episode_to_air;
        if (nextEpisode?.air_date) {
          const seasonNumber = nextEpisode.season_number;
          const episodeNumber = nextEpisode.episode_number;

          // nextSeasonAirDate is ONLY for season premieres (episode 1)
          const nextSeasonAirDate =
            episodeNumber === 1 ? nextEpisode.air_date : undefined;

          return {
            releaseDate: showDetails.first_air_date || nextEpisode.air_date,
            nextEpisodeAirDate: nextEpisode.air_date,
            nextSeasonAirDate,
            seasonNumber,
          };
        }

        // No next episode, use first_air_date if available
        if (showDetails.first_air_date) {
          return {
            releaseDate: showDetails.first_air_date,
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
   * Check monitoring status in Radarr/Sonarr
   * Returns whether item exists in *arr and if it's monitored (series-level)
   */
  private async checkMonitoringStatus(
    tmdbId: number,
    mediaType: 'movie' | 'show'
  ): Promise<{
    inRadarr?: boolean;
    inSonarr?: boolean;
    isMonitored?: boolean;
    hasFile?: boolean;
  }> {
    try {
      const settings = getSettings();

      if (
        mediaType === 'movie' &&
        settings.radarr &&
        settings.radarr.length > 0
      ) {
        // Check Radarr for movies
        for (const radarrSettings of settings.radarr) {
          if (!radarrSettings.hostname) {
            continue;
          }

          try {
            const movies = await this.getRadarrMovies(radarrSettings);
            const movie = movies.find((m) => m.tmdbId === tmdbId);

            if (movie) {
              logger.debug('Found movie in Radarr', {
                label: 'OverlayLibrary',
                tmdbId,
                monitored: movie.monitored,
                hasFile: movie.hasFile,
              });
              return {
                inRadarr: true,
                isMonitored: movie.monitored,
                hasFile: movie.hasFile,
              };
            }
          } catch (error) {
            logger.debug('Failed to check Radarr instance', {
              label: 'OverlayLibrary',
              hostname: radarrSettings.hostname,
              error: error instanceof Error ? error.message : String(error),
            });
            continue;
          }
        }

        return { inRadarr: false, isMonitored: false };
      } else if (
        mediaType === 'show' &&
        settings.sonarr &&
        settings.sonarr.length > 0
      ) {
        // Check Sonarr for TV shows - prefer TVDB ID, fallback to title match
        const tvdbId = await this.getTvdbIdFromTmdb(tmdbId);

        // Get title from TMDB for fallback matching
        let tmdbTitle: string | undefined;
        if (!tvdbId) {
          try {
            const tmdbClient = new TheMovieDb();
            const showDetails = await tmdbClient.getTvShow({ tvId: tmdbId });
            tmdbTitle = showDetails.name || showDetails.original_name;
          } catch {
            // Ignore errors, just won't have title fallback
          }
        }

        for (const sonarrSettings of settings.sonarr) {
          if (!sonarrSettings.hostname) {
            continue;
          }

          try {
            const allSeries = await this.getSonarrSeries(sonarrSettings);
            let series;

            // Try TVDB ID first if available
            if (tvdbId) {
              series = allSeries.find((s) => s.tvdbId === tvdbId);
            }

            // Fallback to title match if no TVDB ID or not found
            if (!series && tmdbTitle) {
              const normalizedTmdbTitle = tmdbTitle.toLowerCase();
              const normalizedTmdbTitleNoSpecial = normalizedTmdbTitle.replace(
                /[^\w\s]/g,
                ''
              );
              series = allSeries.find(
                (s) =>
                  s.title.toLowerCase() === normalizedTmdbTitle ||
                  s.title.toLowerCase().replace(/[^\w\s]/g, '') ===
                    normalizedTmdbTitleNoSpecial
              );
            }

            if (series) {
              const hasFile = (series.statistics?.episodeFileCount || 0) > 0;

              logger.debug('Found series in Sonarr', {
                label: 'OverlayLibrary',
                tmdbId,
                tvdbId,
                tmdbTitle,
                sonarrTitle: series.title,
                matchedBy:
                  tvdbId && series.tvdbId === tvdbId ? 'tvdbId' : 'title',
                monitored: series.monitored,
                episodeFileCount: series.statistics?.episodeFileCount,
                hasFile,
              });

              return {
                inSonarr: true,
                isMonitored: series.monitored,
                hasFile,
              };
            }
          } catch (error) {
            logger.debug('Failed to check Sonarr instance', {
              label: 'OverlayLibrary',
              hostname: sonarrSettings.hostname,
              error: error instanceof Error ? error.message : String(error),
            });
            continue;
          }
        }

        return { inSonarr: false, isMonitored: false };
      }

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
