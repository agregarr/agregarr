import ImdbRatingsAPI from '@server/api/imdbRatings';
import type { PlexLibraryItem } from '@server/api/plexapi';
import PlexAPI from '@server/api/plexapi';
import RottenTomatoes from '@server/api/rottentomatoes';
import TheMovieDb from '@server/api/themoviedb';
import { getRepository } from '@server/datasource';
import { OverlayLibraryConfig } from '@server/entity/OverlayLibraryConfig';
import { OverlayTemplate } from '@server/entity/OverlayTemplate';
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
  /**
   * Apply overlays to all items in a library
   */
  async applyOverlaysToLibrary(libraryId: string): Promise<void> {
    try {
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
        try {
          await this.applyOverlaysToItem(
            plexApi,
            item,
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

      // Merge contexts: base → coming soon → explicit overrides
      const context: OverlayRenderContext = {
        ...baseContext,
        ...comingSoonContext,
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
            const ImdbAPI = (await import('@server/api/imdb')).default;
            const imdbClient = new ImdbAPI();
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
          context.bitDepth = videoStream.bitDepth;
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

      // Build context with Coming Soon specific fields
      return {
        releaseDate: comingSoonItem.releaseDate,
        daysUntilRelease,
        daysAgo,
        seasonNumber: comingSoonItem.seasonNumber,
        isMonitored:
          comingSoonItem.source === 'radarr' ||
          comingSoonItem.source === 'sonarr',
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
}

export const overlayLibraryService = new OverlayLibraryService();
