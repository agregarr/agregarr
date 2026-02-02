import type { MaintainerrCollection } from '@server/api/maintainerr';
import PlexAPI from '@server/api/plexapi';
import { getRepository } from '@server/datasource';
import { OverlayLibraryConfig } from '@server/entity/OverlayLibraryConfig';
import { OverlayTemplate } from '@server/entity/OverlayTemplate';
import {
  buildRenderContext,
  checkMonitoringStatus,
  fetchReleaseDateInfo,
} from '@server/lib/overlays/OverlayContextBuilder';
import type { OverlayRenderContext } from '@server/lib/overlays/OverlayTemplateRenderer';
import {
  evaluateConditionDetailed,
  overlayTemplateRenderer,
} from '@server/lib/overlays/OverlayTemplateRenderer';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { Router } from 'express';
import type sharp from 'sharp';

const overlayTestRouter = Router();

/**
 * Test overlay application on a single Plex item
 * POST /api/v1/overlay-test
 * Body: { ratingKey: string }
 */
overlayTestRouter.post('/', async (req, res) => {
  try {
    const { ratingKey } = req.body;

    if (!ratingKey || typeof ratingKey !== 'string') {
      return res.status(400).json({ error: 'ratingKey is required' });
    }

    logger.info('Starting overlay test', {
      label: 'OverlayTest',
      ratingKey,
    });

    // Get admin user for Plex API access
    const { getAdminUser } = await import(
      '@server/lib/collections/core/CollectionUtilities'
    );
    const admin = await getAdminUser();

    if (!admin) {
      return res.status(500).json({ error: 'No admin user found' });
    }

    const plexApi = new PlexAPI({ plexToken: admin.plexToken });

    // Fetch item metadata
    const item = await plexApi.getMetadata(ratingKey);

    if (!item) {
      return res.status(404).json({ error: 'Item not found in Plex' });
    }

    // Skip episodes and seasons
    if (item.type === 'episode' || item.type === 'season') {
      return res.status(400).json({
        error:
          'Overlays only apply to movies and shows, not episodes or seasons',
      });
    }

    // Get library information
    const libraryId = (
      item as { librarySectionID?: string }
    ).librarySectionID?.toString();
    if (!libraryId) {
      return res.status(400).json({ error: 'Could not determine library ID' });
    }

    let libraryName =
      (item as { librarySectionTitle?: string }).librarySectionTitle ||
      'Unknown Library';
    if (!(item as { librarySectionTitle?: string }).librarySectionTitle) {
      try {
        const libraries = await plexApi.getLibraries();
        const library = libraries.find((lib) => lib.key === libraryId);
        libraryName = library?.title || 'Unknown Library';
      } catch (error) {
        logger.warn('Failed to fetch library name', {
          label: 'OverlayTest',
          libraryId,
        });
      }
    }

    // Get library configuration
    const configRepository = getRepository(OverlayLibraryConfig);
    const config = await configRepository.findOne({
      where: { libraryId },
    });

    if (!config || config.enabledOverlays.length === 0) {
      return res.status(400).json({
        error: `No overlays enabled for library "${libraryName}"`,
        item: {
          ratingKey: item.ratingKey,
          title: item.title,
          year: (item as { year?: number }).year,
          type: item.type,
          libraryId,
          libraryName,
        },
      });
    }

    // Get enabled overlay templates
    const templateRepository = getRepository(OverlayTemplate);
    const enabledTemplateIds = config.enabledOverlays
      .filter((o) => o.enabled)
      .map((o) => o.templateId);

    const templates = await templateRepository.findByIds(enabledTemplateIds);

    if (templates.length === 0) {
      return res.status(400).json({
        error: `No templates found for library "${libraryName}"`,
      });
    }

    // Sort templates by layer order
    const sortedTemplates = templates.sort((a, b) => {
      const orderA =
        config.enabledOverlays.find((o) => o.templateId === a.id)?.layerOrder ||
        0;
      const orderB =
        config.enabledOverlays.find((o) => o.templateId === b.id)?.layerOrder ||
        0;
      return orderA - orderB;
    });

    // Derive actual media type from item.type
    const actualMediaType: 'movie' | 'show' =
      item.type === 'movie' ? 'movie' : 'show';

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

    // Check if this is a placeholder
    const { placeholderContextService } = await import(
      '@server/lib/placeholders/services/PlaceholderContextService'
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

    const isPlaceholder =
      await placeholderContextService.isPlaceholderItemAsync(
        plexMetadata,
        plexApi['plexClient'] as {
          query: (path: string) => Promise<{
            MediaContainer?: { Directory?: unknown[]; Metadata?: unknown[] };
          }>;
        }
      );

    logger.debug('Placeholder detection result', {
      label: 'OverlayTest',
      itemTitle: item.title,
      ratingKey: item.ratingKey,
      isPlaceholder,
    });

    // Fetch Maintainerr collections for daysUntilAction context
    const settings = getSettings();
    let maintainerrCollections: MaintainerrCollection[] | undefined;

    if (settings.maintainerr?.hostname && settings.maintainerr?.apiKey) {
      try {
        const MaintainerrAPI = (await import('@server/api/maintainerr'))
          .default;
        const maintainerrClient = new MaintainerrAPI(settings.maintainerr);
        maintainerrCollections = await maintainerrClient.getCollections();
        logger.debug('Fetched Maintainerr collections for overlay test', {
          label: 'OverlayTest',
          collectionsCount: maintainerrCollections.length,
        });
      } catch (error) {
        logger.debug('Failed to fetch Maintainerr collections', {
          label: 'OverlayTest',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Build base context (includes Maintainerr daysUntilAction if configured)
    const baseContext = await buildRenderContext(
      item,
      actualMediaType,
      isPlaceholder,
      maintainerrCollections
    );

    // Fetch release date information if TMDB ID available
    let releaseDateContext: Partial<OverlayRenderContext> = {};
    if (tmdbId) {
      const releaseDateInfo = await fetchReleaseDateInfo(
        tmdbId,
        actualMediaType
      );

      if (releaseDateInfo) {
        const { calculateDaysSince } = await import(
          '@server/utils/dateHelpers'
        );
        let daysUntilRelease: number | undefined;
        let daysAgo: number | undefined;
        let daysUntilNextEpisode: number | undefined;
        let daysUntilNextSeason: number | undefined;
        let daysAgoNextSeason: number | undefined;

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
          } else {
            daysAgoNextSeason = daysSince;
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
          daysAgoNextSeason,
          seasonNumber: releaseDateInfo.seasonNumber,
          episodeNumber: releaseDateInfo.episodeNumber,
        };
      }
    }

    // Check monitoring status if TMDB ID available
    let monitoringContext: Partial<OverlayRenderContext> = {};
    if (tmdbId) {
      monitoringContext = await checkMonitoringStatus(
        tmdbId,
        actualMediaType,
        undefined,
        undefined
      );
    }

    // Merge contexts
    let actualIsPlaceholder = isPlaceholder;
    if (monitoringContext.hasFile === true) {
      actualIsPlaceholder = false; // *arr has files, so it's definitely not a placeholder
    }

    let downloaded: boolean;
    if (actualIsPlaceholder) {
      downloaded = false;
    } else if (typeof monitoringContext.hasFile === 'boolean') {
      downloaded = monitoringContext.hasFile;
    } else {
      downloaded = true;
    }

    // Build collection membership for condition evaluation
    // Always build for test route (single item, no performance concern)
    const collectionIds: string[] = [];
    const allConfigs: { id: string; collectionRatingKey?: string }[] = [
      ...(settings.plex.collectionConfigs || []),
    ];

    const { preExistingCollectionConfigService } = await import(
      '@server/lib/collections/services/PreExistingCollectionConfigService'
    );
    allConfigs.push(...preExistingCollectionConfigService.getConfigs());

    for (const cfg of allConfigs) {
      if (cfg.collectionRatingKey) {
        try {
          const itemKeys = await plexApi.getCollectionItems(
            cfg.collectionRatingKey
          );
          if (itemKeys.includes(ratingKey)) {
            collectionIds.push(cfg.id);
          }
        } catch {
          // Skip collections that fail to fetch
        }
      }
    }

    logger.debug('Collection membership for test item', {
      label: 'OverlayTest',
      ratingKey,
      collectionIds,
      totalCollectionsChecked: allConfigs.filter((c) => c.collectionRatingKey)
        .length,
    });

    const context: OverlayRenderContext = {
      ...baseContext,
      isPlaceholder: actualIsPlaceholder,
      downloaded,
      ...releaseDateContext,
      ...monitoringContext,
      collection: collectionIds,
    };

    // Evaluate all templates with detailed results
    const templateResults = sortedTemplates.map((template) => {
      const condition = template.getApplicationCondition();
      const detailedResult = evaluateConditionDetailed(condition, context);

      return {
        id: template.id,
        name: template.name,
        matched: detailedResult.matched,
        appliedCondition: condition,
        conditionResults: {
          sectionResults: detailedResult.sectionResults,
        },
      };
    });

    // Get poster source preference (reuse settings from earlier)
    const posterSource = settings.overlays?.defaultPosterSource || 'tmdb';

    // Fetch base poster
    const { plexBasePosterManager } = await import(
      '@server/lib/overlays/PlexBasePosterManager'
    );

    let basePosterResult: {
      posterBuffer: Buffer;
      basePosterChanged: boolean;
      sourceUrl: string;
      filename: string;
      fileModTime?: number | null;
    };

    try {
      basePosterResult = await plexBasePosterManager.getBasePosterForOverlay(
        plexApi,
        item,
        libraryId,
        libraryName,
        config.mediaType,
        posterSource,
        {},
        tmdbId
      );
    } catch (error) {
      logger.error('Failed to get base poster', {
        label: 'OverlayTest',
        itemTitle: item.title,
        ratingKey: item.ratingKey,
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(500).json({
        error: 'Failed to fetch base poster',
        message: error instanceof Error ? error.message : String(error),
      });
    }

    let posterBuffer = basePosterResult.posterBuffer;

    // Apply matching overlays in order via batch rendering
    const matchingTemplates = sortedTemplates.filter(
      (template) => templateResults.find((tr) => tr.id === template.id)?.matched
    );

    const { width: posterWidth, height: posterHeight } =
      await overlayTemplateRenderer.getPosterDimensions(posterBuffer);
    const allOverlays: sharp.OverlayOptions[] = [];

    for (const template of matchingTemplates) {
      const templateData = template.getTemplateData();
      const templateOverlays =
        await overlayTemplateRenderer.renderOverlayElements(
          posterWidth,
          posterHeight,
          templateData,
          context
        );

      if (templateOverlays) {
        allOverlays.push(...templateOverlays);
      }
    }

    posterBuffer = await overlayTemplateRenderer.compositeOverlays(
      posterBuffer,
      allOverlays
    );

    // Return all context variables as a flat list (no grouping)
    const allContext: Record<string, unknown> = {};
    for (const key in context) {
      allContext[key] = context[key as keyof typeof context];
    }

    logger.info('Overlay test completed successfully', {
      label: 'OverlayTest',
      ratingKey,
      itemTitle: item.title,
      templatesEvaluated: templateResults.length,
      templatesMatched: matchingTemplates.length,
    });

    return res.status(200).json({
      poster: posterBuffer.toString('base64'),
      item: {
        ratingKey: item.ratingKey,
        title: item.title,
        year: (item as { year?: number }).year,
        type: item.type,
        libraryId,
        libraryName,
      },
      templates: templateResults,
      context: allContext,
    });
  } catch (error) {
    logger.error('Failed to test overlay', {
      label: 'OverlayTest',
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return res.status(500).json({
      error: 'Failed to test overlay',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

export default overlayTestRouter;
