import ImdbRatingsAPI from '@server/api/imdbRatings';
import RottenTomatoes from '@server/api/rottentomatoes';
import TheMovieDb from '@server/api/themoviedb';
import { getRepository } from '@server/datasource';
import { OverlayLibraryConfig } from '@server/entity/OverlayLibraryConfig';
import type {
  OverlayTileElementProps,
  OverlayVariableElementProps,
} from '@server/entity/OverlayTemplate';
import { OverlayTemplate } from '@server/entity/OverlayTemplate';
import { overlayTemplateRenderer } from '@server/lib/overlays/OverlayTemplateRenderer';
import { presetTemplateService } from '@server/lib/overlays/PresetTemplates';
import { getTmdbLanguage } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';
import * as fsPromises from 'fs/promises';
import path from 'path';
import type sharp from 'sharp';

const router = Router();

// Cache for preview poster metadata (to avoid repeated API calls)
const metadataCache = new Map<
  string,
  { data: PreviewPosterMetadata; timestamp: number }
>();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// Track the latest preview request per context
// Contexts allow us to deduplicate rapid requests in a modal while allowing
// parallel requests from different UI components (like library grid)
const latestPreviewRequestTimestamp = new Map<string, number>();

/**
 * Fetch TMDB metadata and ratings for a preview poster
 * Shared helper to avoid code duplication
 */
async function fetchPreviewPosterMetadata(
  mediaType: 'movie' | 'tv',
  tmdbId: number
): Promise<{
  title: string;
  year?: number;
  imdbId?: string;
  studio?: string;
  imdbRating?: number;
  rtCriticsScore?: number;
  rtAudienceScore?: number;
}> {
  const tmdbClient = new TheMovieDb({
    originalLanguage: await getTmdbLanguage(),
  });
  let title = 'Sample Title';
  let year: number | undefined;
  let imdbId: string | undefined;
  let studio: string | undefined;

  try {
    if (mediaType === 'movie') {
      const movieDetails = await tmdbClient.getMovie({ movieId: tmdbId });
      title = movieDetails.title;
      year = movieDetails.release_date
        ? new Date(movieDetails.release_date).getFullYear()
        : undefined;
      imdbId = movieDetails.imdb_id || undefined;
      studio = movieDetails.production_companies?.[0]?.name;
    } else {
      const showDetails = await tmdbClient.getTvShow({ tvId: tmdbId });
      title = showDetails.name;
      year = showDetails.first_air_date
        ? new Date(showDetails.first_air_date).getFullYear()
        : undefined;
      imdbId = showDetails.external_ids?.imdb_id || undefined;
      studio = showDetails.production_companies?.[0]?.name;
    }
  } catch (err) {
    logger.debug('Failed to fetch TMDB metadata for preview', {
      mediaType,
      tmdbId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Fetch real ratings if we have an IMDb ID
  let imdbRating: number | undefined;
  let rtCriticsScore: number | undefined;
  let rtAudienceScore: number | undefined;

  if (imdbId) {
    try {
      const imdbApi = new ImdbRatingsAPI();
      const imdbData = await imdbApi.getRatings(imdbId);
      if (imdbData && imdbData.length > 0 && imdbData[0].rating) {
        imdbRating = imdbData[0].rating;
      }
    } catch {
      // Ignore rating fetch errors
    }
  }

  if (title && year) {
    try {
      const rtApi = new RottenTomatoes();
      const rtData =
        mediaType === 'movie'
          ? await rtApi.getMovieRatings(title, year)
          : await rtApi.getTVRatings(title, year);
      if (rtData) {
        rtCriticsScore = rtData.criticsScore;
        rtAudienceScore = rtData.audienceScore;
      }
    } catch {
      // Ignore rating fetch errors
    }
  }

  return {
    title,
    year,
    imdbId,
    studio,
    imdbRating,
    rtCriticsScore,
    rtAudienceScore,
  };
}

interface PreviewPosterInfo {
  id: string;
  type: 'movie' | 'tv';
  tmdbId: number;
  filename: string;
  url: string;
}

interface PreviewPosterMetadata {
  title: string;
  year: number;
  imdbRating?: number;
  rtCriticsScore?: number;
  rtAudienceScore?: number;
  director?: string;
  studio?: string;
  network?: string;
  resolution: string;
  audioFormat: string;
  videoCodec: string;
  status: string;
  daysUntilRelease?: number;
  releaseDate?: string;
  runtime?: number;
  daysUntilAction?: number;
}

// Apply authentication to all routes
router.use(isAuthenticated());

// GET /api/v1/overlay-templates/preview-posters - List available preview posters
router.get('/preview-posters', async (_req, res, next) => {
  try {
    const postersDir = path.join(process.cwd(), 'public', 'preview-posters');

    const files = await fsPromises.readdir(postersDir);
    const posterFiles = files.filter(
      (file) =>
        file.endsWith('.jpg') || file.endsWith('.png') || file.endsWith('.jpeg')
    );

    const posters: PreviewPosterInfo[] = posterFiles
      .map((filename) => {
        // Parse filename: movie_123.jpg or tv_456.jpg
        const match = filename.match(/^(movie|tv)_(\d+)\.(jpg|jpeg|png)$/);
        if (!match) return null;

        const [, type, tmdbIdStr] = match;
        const tmdbId = parseInt(tmdbIdStr);

        return {
          id: `${type}_${tmdbId}`,
          type: type as 'movie' | 'tv',
          tmdbId,
          filename,
          url: `/preview-posters/${filename}`,
        };
      })
      .filter((poster): poster is PreviewPosterInfo => poster !== null);

    return res.status(200).json({
      posters,
      count: posters.length,
    });
  } catch (error) {
    logger.error('Failed to list preview posters:', error);
    return next({
      status: 500,
      message: 'Failed to list preview posters',
    });
  }
});

// GET /api/v1/overlay-templates/preview-metadata/:posterId - Get real metadata for a preview poster
router.get('/preview-metadata/:posterId', async (req, res, next) => {
  try {
    const { posterId } = req.params;

    // Check cache first
    const cached = metadataCache.get(posterId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return res.status(200).json(cached.data);
    }

    // Parse posterId: movie_123 or tv_456
    const match = posterId.match(/^(movie|tv)_(\d+)$/);
    if (!match) {
      return res.status(400).json({
        error: 'Invalid poster ID format. Expected movie_123 or tv_456',
      });
    }

    const [, type, tmdbIdStr] = match;
    const tmdbId = parseInt(tmdbIdStr);
    const isMovie = type === 'movie';

    const tmdb = new TheMovieDb({ originalLanguage: await getTmdbLanguage() });

    let metadata: PreviewPosterMetadata;

    if (isMovie) {
      const movieDetails = await tmdb.getMovie({ movieId: tmdbId });

      // Get director from credits
      let director: string | undefined;
      if (movieDetails.credits?.crew) {
        const directorCrew = movieDetails.credits.crew.find(
          (member) => member.job === 'Director'
        );
        if (directorCrew) {
          director = directorCrew.name;
        }
      }

      // Get studio from production companies
      let studio: string | undefined;
      if (
        movieDetails.production_companies &&
        movieDetails.production_companies.length > 0
      ) {
        studio = movieDetails.production_companies[0].name;
      }

      // Try to get IMDb rating
      let imdbRating: number | undefined;
      if (movieDetails.external_ids?.imdb_id) {
        try {
          const imdbApi = new ImdbRatingsAPI();
          const imdbData = await imdbApi.getRatings(
            movieDetails.external_ids.imdb_id
          );
          if (imdbData && imdbData.length > 0 && imdbData[0].rating) {
            imdbRating = imdbData[0].rating;
          }
        } catch {
          // IMDb rating fetch failed, continue without it
        }
      }

      // Try to get RT scores
      let rtCriticsScore: number | undefined;
      let rtAudienceScore: number | undefined;
      try {
        const rtApi = new RottenTomatoes();
        const releaseYear = movieDetails.release_date
          ? new Date(movieDetails.release_date).getFullYear()
          : new Date().getFullYear();
        const rtData = await rtApi.getMovieRatings(
          movieDetails.title,
          releaseYear
        );
        if (rtData) {
          rtCriticsScore = rtData.criticsScore;
          rtAudienceScore = rtData.audienceScore;
        }
      } catch {
        // RT rating fetch failed, continue without it
      }

      metadata = {
        title: movieDetails.title,
        year: movieDetails.release_date
          ? new Date(movieDetails.release_date).getFullYear()
          : 0,
        imdbRating,
        rtCriticsScore,
        rtAudienceScore,
        director,
        studio,
        resolution: '4K', // Simulated technical info
        audioFormat: 'Dolby Atmos',
        videoCodec: 'HEVC',
        status: 'Available',
        releaseDate: movieDetails.release_date,
        runtime: movieDetails.runtime,
        daysUntilAction: 5, // Simulated Maintainerr data for preview
      };
    } else {
      // TV show
      const tvDetails = await tmdb.getTvShow({ tvId: tmdbId });

      // Get network
      let network: string | undefined;
      if (tvDetails.networks && tvDetails.networks.length > 0) {
        network = tvDetails.networks[0].name;
      }

      // Try to get IMDb rating
      let imdbRating: number | undefined;
      if (tvDetails.external_ids?.imdb_id) {
        try {
          const imdbApi = new ImdbRatingsAPI();
          const imdbData = await imdbApi.getRatings(
            tvDetails.external_ids.imdb_id
          );
          if (imdbData && imdbData.length > 0 && imdbData[0].rating) {
            imdbRating = imdbData[0].rating;
          }
        } catch {
          // IMDb rating fetch failed, continue without it
        }
      }

      // Try to get RT scores
      let rtCriticsScore: number | undefined;
      let rtAudienceScore: number | undefined;
      try {
        const rtApi = new RottenTomatoes();
        const firstAirYear = tvDetails.first_air_date
          ? new Date(tvDetails.first_air_date).getFullYear()
          : new Date().getFullYear();
        const rtData = await rtApi.getTVRatings(tvDetails.name, firstAirYear);
        if (rtData) {
          rtCriticsScore = rtData.criticsScore;
          rtAudienceScore = rtData.audienceScore;
        }
      } catch {
        // RT rating fetch failed, continue without it
      }

      metadata = {
        title: tvDetails.name,
        year: tvDetails.first_air_date
          ? new Date(tvDetails.first_air_date).getFullYear()
          : 0,
        imdbRating,
        rtCriticsScore,
        rtAudienceScore,
        network,
        resolution: '1080p', // Simulated technical info
        audioFormat: '5.1',
        videoCodec: 'H.264',
        status:
          tvDetails.status === 'Ended' || tvDetails.status === 'Canceled'
            ? 'Ended'
            : 'Continuing',
        releaseDate: tvDetails.first_air_date,
        daysUntilAction: 3, // Simulated Maintainerr data for preview
      };
    }

    // Cache the result
    metadataCache.set(posterId, { data: metadata, timestamp: Date.now() });

    return res.status(200).json(metadata);
  } catch (error) {
    logger.error('Failed to fetch preview poster metadata:', error);
    return next({
      status: 500,
      message: 'Failed to fetch preview poster metadata',
    });
  }
});

// GET /api/v1/overlay-templates - Get all overlay templates
router.get('/', async (req, res, next) => {
  try {
    const templateRepository = getRepository(OverlayTemplate);

    const templates = await templateRepository.find({
      where: { isActive: true },
      order: { isDefault: 'DESC', displayOrder: 'ASC', createdAt: 'ASC' },
    });

    const templatesResponse = templates.map((template: OverlayTemplate) => ({
      id: template.id,
      name: template.name,
      description: template.description,
      type: template.type,
      isDefault: template.isDefault,
      templateData: template.getTemplateData(),
      applicationCondition: template.getApplicationCondition(),
      tags: template.getTags(),
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    }));

    return res.status(200).json({
      templates: templatesResponse,
    });
  } catch (error) {
    logger.error('Failed to fetch overlay templates:', error);
    return next({
      status: 500,
      message: 'Failed to fetch overlay templates',
    });
  }
});

// GET /api/v1/overlay-templates/tags - Get all unique tags
router.get('/tags', async (_req, res, next) => {
  try {
    const templateRepository = getRepository(OverlayTemplate);

    const templates = await templateRepository.find({
      where: { isActive: true },
    });

    // Collect all unique tags from all templates
    const tagsSet = new Set<string>();
    templates.forEach((template) => {
      const templateTags = template.getTags();
      templateTags.forEach((tag) => tagsSet.add(tag));
    });

    // Return sorted array of unique tags
    const tags = Array.from(tagsSet).sort();

    return res.status(200).json({ tags });
  } catch (error) {
    logger.error('Failed to fetch overlay template tags:', error);
    return next({
      status: 500,
      message: 'Failed to fetch overlay template tags',
    });
  }
});

// POST /api/v1/overlay-templates - Create new overlay template
router.post('/', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
      });
    }

    const {
      name,
      description,
      type,
      templateData,
      applicationCondition,
      tags,
    } = req.body;

    if (!name || !templateData) {
      return res.status(400).json({
        error: 'Template name and data are required',
      });
    }

    // Validate template data structure - check for variable elements
    const variableElements =
      templateData.elements?.filter(
        (el: { type: string }) => el.type === 'variable'
      ) || [];

    if (variableElements.length > 1) {
      return res.status(400).json({
        error:
          'Template has multiple variable elements. Each template can only contain one variable element.',
      });
    }

    const templateRepository = getRepository(OverlayTemplate);

    const newTemplate = new OverlayTemplate({
      name,
      description,
      type: type || 'generic',
      isDefault: false,
      isActive: true,
    });

    newTemplate.setTemplateData(templateData);
    newTemplate.setApplicationCondition(applicationCondition);
    newTemplate.setTags(tags);

    const savedTemplate = await templateRepository.save(newTemplate);

    logger.info('Created new overlay template', {
      templateId: savedTemplate.id,
      name: savedTemplate.name,
      type: savedTemplate.type,
      userId: req.user?.id,
    });

    return res.status(201).json({
      id: savedTemplate.id,
      name: savedTemplate.name,
      description: savedTemplate.description,
      type: savedTemplate.type,
      isDefault: savedTemplate.isDefault,
      templateData: savedTemplate.getTemplateData(),
      applicationCondition: savedTemplate.getApplicationCondition(),
      tags: savedTemplate.getTags(),
      createdAt: savedTemplate.createdAt,
      updatedAt: savedTemplate.updatedAt,
    });
  } catch (error) {
    logger.error('Failed to create overlay template:', error);
    return next({
      status: 500,
      message: 'Failed to create overlay template',
    });
  }
});

// PUT /api/v1/overlay-templates/:id - Update overlay template
router.put('/:id', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
      });
    }

    const templateId = parseInt(req.params.id);
    const {
      name,
      description,
      type,
      templateData,
      applicationCondition,
      tags,
    } = req.body;

    const templateRepository = getRepository(OverlayTemplate);
    const template = await templateRepository.findOne({
      where: { id: templateId, isActive: true },
    });

    if (!template) {
      return res.status(404).json({
        error: 'Template not found',
      });
    }

    // Prevent editing system default templates
    if (template.isDefault) {
      return res.status(403).json({
        error: 'Cannot edit system default templates',
      });
    }

    if (name !== undefined) template.name = name;
    if (description !== undefined) template.description = description;
    if (type !== undefined) template.type = type;
    if (templateData) {
      // Validate template data structure - check for variable elements
      const variableElements =
        templateData.elements?.filter(
          (el: { type: string }) => el.type === 'variable'
        ) || [];

      if (variableElements.length > 1) {
        return res.status(400).json({
          error:
            'Template has multiple variable elements. Each template can only contain one variable element.',
        });
      }

      template.setTemplateData(templateData);
    }
    // Always update applicationCondition (set to stringified JSON or null to clear)
    template.applicationCondition = applicationCondition
      ? JSON.stringify(applicationCondition)
      : null;

    // Update tags if provided
    if (tags !== undefined) {
      template.setTags(tags);
    }

    const savedTemplate = await templateRepository.save(template);

    logger.info('Updated overlay template', {
      templateId: savedTemplate.id,
      name: savedTemplate.name,
      userId: req.user?.id,
    });

    return res.status(200).json({
      id: savedTemplate.id,
      name: savedTemplate.name,
      description: savedTemplate.description,
      type: savedTemplate.type,
      isDefault: savedTemplate.isDefault,
      templateData: savedTemplate.getTemplateData(),
      applicationCondition: savedTemplate.getApplicationCondition(),
      tags: savedTemplate.getTags(),
      createdAt: savedTemplate.createdAt,
      updatedAt: savedTemplate.updatedAt,
    });
  } catch (error) {
    logger.error('Failed to update overlay template:', error);
    return next({
      status: 500,
      message: 'Failed to update overlay template',
    });
  }
});

// DELETE /api/v1/overlay-templates/:id - Delete overlay template
router.delete('/:id', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
      });
    }

    const templateId = parseInt(req.params.id);
    const templateRepository = getRepository(OverlayTemplate);

    const template = await templateRepository.findOne({
      where: { id: templateId, isActive: true },
    });

    if (!template) {
      return res.status(404).json({
        error: 'Template not found',
      });
    }

    // Prevent deleting system default templates
    if (template.isDefault) {
      return res.status(403).json({
        error: 'Cannot delete system default templates',
      });
    }

    // Hard delete user-created templates
    await templateRepository.remove(template);

    // Clean up orphaned references in library configs
    const libraryConfigRepository = getRepository(OverlayLibraryConfig);
    const allLibraryConfigs = await libraryConfigRepository.find();

    let cleanedConfigsCount = 0;
    for (const config of allLibraryConfigs) {
      const originalLength = config.enabledOverlays.length;
      config.enabledOverlays = config.enabledOverlays.filter(
        (overlay) => overlay.templateId !== templateId
      );

      // Only save if we actually removed something
      if (config.enabledOverlays.length < originalLength) {
        await libraryConfigRepository.save(config);
        cleanedConfigsCount++;
      }
    }

    logger.info('Deleted overlay template', {
      templateId: template.id,
      name: template.name,
      cleanedLibraryConfigs: cleanedConfigsCount,
      userId: req.user?.id,
    });

    return res.status(200).json({
      message: 'Template deleted successfully',
    });
  } catch (error) {
    logger.error('Failed to delete overlay template:', error);
    return next({
      status: 500,
      message: 'Failed to delete overlay template',
    });
  }
});

// GET /api/v1/overlay-templates/:id/preview - Generate preview of overlay template
router.get('/:id/preview', async (req, res, next) => {
  try {
    const templateId = parseInt(req.params.id);
    const templateRepository = getRepository(OverlayTemplate);

    const template = await templateRepository.findOne({
      where: { id: templateId, isActive: true },
    });

    if (!template) {
      return res.status(404).json({
        error: 'Template not found',
      });
    }

    // Get list of preview posters
    const postersDir = path.join(process.cwd(), 'public', 'preview-posters');
    const posterFiles = await fsPromises.readdir(postersDir);
    const jpgFiles = posterFiles.filter(
      (f) =>
        f.endsWith('.jpg') && (f.startsWith('movie_') || f.startsWith('tv_'))
    );

    if (jpgFiles.length === 0) {
      return res.status(500).json({
        error: 'No preview posters available',
      });
    }

    // Pick a random poster
    const randomPoster = jpgFiles[Math.floor(Math.random() * jpgFiles.length)];
    const posterPath = path.join(postersDir, randomPoster);

    // Load the poster image
    const posterBuffer = await fsPromises.readFile(posterPath);

    // Extract TMDB ID and media type from filename (e.g., "movie_100402.jpg")
    const match = randomPoster.match(/^(movie|tv)_(\d+)\.jpg$/);
    const mediaType = match ? (match[1] as 'movie' | 'tv') : 'movie';
    const tmdbId = match ? parseInt(match[2]) : 0;

    // Fetch real TMDB metadata and ratings using shared helper
    const tmdbData = await fetchPreviewPosterMetadata(mediaType, tmdbId);

    // Build render context with real TMDB data + comprehensive placeholder data
    // Use fallback values to ensure all fields are always populated for previews
    const sampleContext = {
      // Real TMDB data with fallbacks
      title: tmdbData.title || 'Sample Movie',
      year: tmdbData.year || 2024,
      imdbRating: tmdbData.imdbRating || 8.5,
      rtCriticsScore: tmdbData.rtCriticsScore || 92,
      rtAudienceScore: tmdbData.rtAudienceScore || 88,
      rtCertifiedFresh: true,
      rtVerifiedHot: true,
      studio: tmdbData.studio || 'Warner Bros.',
      mediaType: mediaType === 'movie' ? ('movie' as const) : ('show' as const),

      // Ratings (additional)
      imdbTop250Rank: 42,
      isImdbTop250: true,
      // metacriticScore: 85, // TODO: Implement Metacritic integration

      // TMDB Metadata
      director: 'Christopher Nolan',
      network: 'HBO', // Always populate for previews
      genre: 'Action',
      runtime: 148,
      tmdbStatus: 'RETURNING', // Always populate for previews

      // Plex Media Info
      resolution: '4K',
      width: 3840,
      height: 2160,
      aspectRatio: 2.39,

      // Video specs
      videoCodec: 'hevc',
      videoProfile: 'main 10',
      videoFrameRate: '23.976',
      bitDepth: 10,
      hdr: true,
      dolbyVision: true,

      // Audio specs
      audioCodec: 'truehd',
      audioChannels: 8,
      audioChannelLayout: 'atmos',
      audioFormat: 'English (Dolby TrueHD Atmos 7.1)',

      // File info
      container: 'mkv',
      bitrate: 25000,
      fileSize: 45000000000, // 45 GB
      filePath: '/media/movies/Sample Movie (2024)/Sample Movie (2024).mkv',

      // Playback stats
      viewCount: 3,
      lastPlayed: new Date('2024-12-01'),
      dateAdded: new Date('2024-11-15'),

      // Status fields
      releaseDate: '2024-12-25',
      daysUntilRelease: 14,
      daysAgo: 3, // Set to 3 for "Released N Days Ago" preview
      nextEpisodeAirDate: '2025-01-15', // Always populate for previews
      daysUntilNextEpisode: 32, // Always populate for previews
      nextSeasonAirDate: '2025-03-01', // Always populate for previews
      daysUntilNextSeason: 23, // Always populate for previews

      // Episode information
      seasonNumber: 2, // Always populate for previews
      episodeNumber: 5, // Always populate for previews
      episodeLabel: 'EPISODE 5', // Always populate for previews

      // Monitoring status
      isMonitored: true,
      inRadarr: true, // Always populate for previews
      inSonarr: true, // Always populate for previews
      hasFile: true,
      downloaded: true,

      // Maintainerr integration
      daysUntilAction: 5, // Always populate for previews

      // Item metadata
      isPlaceholder: false,
    };

    // Render the overlay on the poster
    const templateData = template.getTemplateData();
    const renderedBuffer = await overlayTemplateRenderer.renderOverlay(
      posterBuffer,
      templateData,
      sampleContext
    );

    // Return the rendered image
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'no-cache'); // Don't cache so previews update immediately
    return res.send(renderedBuffer);
  } catch (error) {
    logger.error('Failed to generate overlay template preview:', error);
    return next({
      status: 500,
      message: 'Failed to generate overlay template preview',
    });
  }
});

// POST /api/v1/overlay-templates/combined-preview - Generate preview with multiple overlays
router.post('/combined-preview', async (req, res, next) => {
  try {
    const { templateIds, contextId } = req.body as {
      templateIds: number[];
      contextId?: string;
    };

    if (
      !templateIds ||
      !Array.isArray(templateIds) ||
      templateIds.length === 0
    ) {
      return res.status(400).json({
        error: 'templateIds array is required',
      });
    }

    // Use contextId to scope deduplication (default to 'global' for backward compatibility)
    const context = contextId || 'global';

    // Assign a timestamp to this request and update the latest timestamp for this context
    const requestTimestamp = Date.now();
    latestPreviewRequestTimestamp.set(context, requestTimestamp);

    // Helper to check if this request is still the latest for this context
    const isLatestRequest = (): boolean => {
      return latestPreviewRequestTimestamp.get(context) === requestTimestamp;
    };

    const templateRepository = getRepository(OverlayTemplate);

    // Fetch all requested templates
    const templates = await templateRepository.findByIds(templateIds);

    if (templates.length === 0) {
      return res.status(404).json({
        error: 'No templates found',
      });
    }

    // Check if this request is still relevant before proceeding
    if (!isLatestRequest()) {
      logger.debug('Skipping obsolete preview request', {
        label: 'OverlayTemplates',
        requestTimestamp,
      });
      return res.status(200).json({ message: 'Request superseded' });
    }

    // Sort templates by the order they appear in templateIds (preserves layer order)
    const orderedTemplates = templateIds
      .map((id) => templates.find((t) => t.id === id))
      .filter((t): t is OverlayTemplate => t !== undefined);

    // Get list of preview posters
    const postersDir = path.join(process.cwd(), 'public', 'preview-posters');
    const posterFiles = await fsPromises.readdir(postersDir);
    const jpgFiles = posterFiles.filter(
      (f) =>
        f.endsWith('.jpg') && (f.startsWith('movie_') || f.startsWith('tv_'))
    );

    if (jpgFiles.length === 0) {
      return res.status(500).json({
        error: 'No preview posters available',
      });
    }

    // Pick a random poster
    const randomPoster = jpgFiles[Math.floor(Math.random() * jpgFiles.length)];
    const posterPath = path.join(postersDir, randomPoster);

    // Load the poster image
    let posterBuffer = await fsPromises.readFile(posterPath);

    // Check again after I/O operation
    if (!isLatestRequest()) {
      logger.debug('Skipping obsolete preview request after loading poster', {
        label: 'OverlayTemplates',
        requestTimestamp,
      });
      return res.status(200).json({ message: 'Request superseded' });
    }

    // Extract TMDB ID and media type from filename
    const match = randomPoster.match(/^(movie|tv)_(\d+)\.jpg$/);
    const mediaType = match ? (match[1] as 'movie' | 'tv') : 'movie';
    const tmdbId = match ? parseInt(match[2]) : 0;

    // Fetch real TMDB metadata and ratings using shared helper
    const tmdbData = await fetchPreviewPosterMetadata(mediaType, tmdbId);

    // Check again after API calls
    if (!isLatestRequest()) {
      logger.debug(
        'Skipping obsolete preview request after fetching metadata',
        {
          label: 'OverlayTemplates',
          requestTimestamp,
        }
      );
      return res.status(200).json({ message: 'Request superseded' });
    }

    // Build render context with comprehensive placeholder data
    // Use fallback values to ensure all fields are always populated for previews
    const sampleContext = {
      // Real TMDB data with fallbacks
      title: tmdbData.title || 'Sample Movie',
      year: tmdbData.year || 2024,
      imdbRating: tmdbData.imdbRating || 8.5,
      rtCriticsScore: tmdbData.rtCriticsScore || 92,
      rtAudienceScore: tmdbData.rtAudienceScore || 88,
      rtCertifiedFresh: true,
      rtVerifiedHot: true,
      studio: tmdbData.studio || 'Warner Bros.',
      mediaType: mediaType === 'movie' ? ('movie' as const) : ('show' as const),

      // Ratings (additional)
      imdbTop250Rank: 42,
      isImdbTop250: true,
      // metacriticScore: 85, // TODO: Implement Metacritic integration

      // TMDB Metadata
      director: 'Christopher Nolan',
      network: 'HBO', // Always populate for previews
      genre: 'Action',
      runtime: 148,
      tmdbStatus: 'RETURNING', // Always populate for previews

      // Plex Media Info
      resolution: '4K',
      width: 3840,
      height: 2160,
      aspectRatio: 2.39,

      // Video specs
      videoCodec: 'hevc',
      videoProfile: 'main 10',
      videoFrameRate: '23.976',
      bitDepth: 10,
      hdr: true,
      dolbyVision: true,

      // Audio specs
      audioCodec: 'truehd',
      audioChannels: 8,
      audioChannelLayout: 'atmos',
      audioFormat: 'English (Dolby TrueHD Atmos 7.1)',

      // File info
      container: 'mkv',
      bitrate: 25000,
      fileSize: 45000000000, // 45 GB
      filePath: '/media/movies/Sample Movie (2024)/Sample Movie (2024).mkv',

      // Playback stats
      viewCount: 3,
      lastPlayed: new Date('2024-12-01'),
      dateAdded: new Date('2024-11-15'),

      // Status fields
      releaseDate: '2024-12-25',
      daysUntilRelease: 14,
      daysAgo: 3, // Set to 3 for "Released N Days Ago" preview
      nextEpisodeAirDate: '2025-01-15', // Always populate for previews
      daysUntilNextEpisode: 32, // Always populate for previews
      nextSeasonAirDate: '2025-03-01', // Always populate for previews
      daysUntilNextSeason: 23, // Always populate for previews

      // Episode information
      seasonNumber: 2, // Always populate for previews
      episodeNumber: 5, // Always populate for previews
      episodeLabel: 'EPISODE 5', // Always populate for previews

      // Monitoring status
      isMonitored: true,
      inRadarr: true, // Always populate for previews
      inSonarr: true, // Always populate for previews
      hasFile: true,
      downloaded: true,

      // Maintainerr integration
      daysUntilAction: 5, // Always populate for previews

      // Item metadata
      isPlaceholder: false,
    };

    // Batch render: collect all overlay elements, then composite once
    const { width: posterWidth, height: posterHeight } =
      await overlayTemplateRenderer.getPosterDimensions(posterBuffer);
    const allOverlays: sharp.OverlayOptions[] = [];

    for (const template of orderedTemplates) {
      // Check before each expensive rendering operation
      if (!isLatestRequest()) {
        logger.debug('Skipping obsolete preview request during rendering', {
          label: 'OverlayTemplates',
          requestTimestamp,
        });
        return res.status(200).json({ message: 'Request superseded' });
      }

      const templateData = template.getTemplateData();
      const templateOverlays =
        await overlayTemplateRenderer.renderOverlayElements(
          posterWidth,
          posterHeight,
          templateData,
          sampleContext
        );

      if (templateOverlays) {
        allOverlays.push(...templateOverlays);
      }
    }

    posterBuffer = await overlayTemplateRenderer.compositeOverlays(
      posterBuffer,
      allOverlays
    );

    // Final check before sending
    if (!isLatestRequest()) {
      logger.debug('Skipping obsolete preview request before sending', {
        label: 'OverlayTemplates',
        requestTimestamp,
      });
      return res.status(200).json({ message: 'Request superseded' });
    }

    // Return the combined image
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'no-cache'); // Don't cache combined previews
    return res.send(posterBuffer);
  } catch (error) {
    logger.error('Failed to generate combined overlay preview:', error);
    return next({
      status: 500,
      message: 'Failed to generate combined overlay preview',
    });
  }
});

// POST /api/v1/overlay-templates/presets/create - Create preset templates
router.post('/presets/create', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
      });
    }

    logger.info('Manually creating preset overlay templates', {
      userId: req.user?.id,
    });

    await presetTemplateService.createPresetTemplates();

    return res.status(200).json({
      message: 'Preset templates created successfully',
    });
  } catch (error) {
    logger.error('Failed to create preset templates:', error);
    return next({
      status: 500,
      message: 'Failed to create preset templates',
    });
  }
});

// POST /api/v1/overlay-templates/copy - Copy template elements to other templates
router.post('/copy', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
      });
    }

    const { sourceTemplateId, targetTemplateIds, elementIds } = req.body;

    if (!sourceTemplateId || !Array.isArray(targetTemplateIds)) {
      return res.status(400).json({
        error: 'sourceTemplateId and targetTemplateIds array are required',
      });
    }

    const templateRepository = getRepository(OverlayTemplate);

    // Get source template
    const sourceTemplate = await templateRepository.findOne({
      where: { id: sourceTemplateId, isActive: true },
    });

    if (!sourceTemplate) {
      return res.status(404).json({
        error: 'Source template not found',
      });
    }

    const sourceData = sourceTemplate.getTemplateData();
    let copiedCount = 0;

    // Filter elements if elementIds provided, otherwise copy all
    const elementsToCopy = elementIds
      ? sourceData.elements.filter((e) => elementIds.includes(e.id))
      : sourceData.elements;

    if (elementsToCopy.length === 0) {
      return res.status(400).json({
        error: 'No valid elements to copy',
      });
    }

    // Copy to each target template
    for (const targetId of targetTemplateIds) {
      const targetTemplate = await templateRepository.findOne({
        where: { id: targetId, isActive: true },
      });

      if (!targetTemplate) {
        logger.warn('Target template not found, skipping', {
          templateId: targetId,
        });
        continue;
      }

      // Skip preset templates (cannot edit)
      if (targetTemplate.isDefault) {
        logger.warn('Cannot copy to preset template, skipping', {
          templateId: targetId,
          templateName: targetTemplate.name,
        });
        continue;
      }

      const targetData = targetTemplate.getTemplateData();

      if (elementIds) {
        // Selective copy: Add specific elements to target template
        // Find max layer order in target to append new elements on top
        const maxLayerOrder = Math.max(
          ...targetData.elements.map((e) => e.layerOrder),
          -1
        );

        // Create new elements with updated IDs and layer orders
        const newElements = elementsToCopy.map((element, index) => {
          const newElement = {
            ...element,
            id: `${element.id}-${Date.now()}-${index}`, // Generate unique ID
            layerOrder: maxLayerOrder + index + 1,
          };

          // Preserve variable segments if element is a variable type
          if (element.type === 'variable') {
            const targetElement = targetData.elements.find(
              (e) => e.id === element.id
            );
            if (targetElement && targetElement.type === 'variable') {
              const targetProps =
                targetElement.properties as OverlayVariableElementProps;
              const sourceProps =
                element.properties as OverlayVariableElementProps;
              return {
                ...newElement,
                properties: {
                  ...sourceProps,
                  segments: targetProps.segments, // Preserve target's segments
                },
              };
            }
          }
          return newElement;
        });

        // Add new elements to target
        const updatedData = {
          ...targetData,
          elements: [...targetData.elements, ...newElements],
        };

        targetTemplate.setTemplateData(updatedData);
      } else {
        // Full copy: Replace all elements (legacy behavior)
        const copiedData = {
          ...sourceData,
          elements: sourceData.elements.map((element) => {
            // If element is a variable, try to preserve the target's variable segments
            if (element.type === 'variable') {
              const targetElement = targetData.elements.find(
                (e) => e.id === element.id
              );
              if (targetElement && targetElement.type === 'variable') {
                const targetProps =
                  targetElement.properties as OverlayVariableElementProps;
                const sourceProps =
                  element.properties as OverlayVariableElementProps;
                return {
                  ...element,
                  properties: {
                    ...sourceProps,
                    segments: targetProps.segments, // Preserve target's segments
                  },
                };
              }
            }
            return element;
          }),
        };

        targetTemplate.setTemplateData(copiedData);
      }

      await templateRepository.save(targetTemplate);
      copiedCount++;
    }

    logger.info('Copied template elements', {
      sourceId: sourceTemplateId,
      targetCount: copiedCount,
      elementCount: elementsToCopy.length,
      selective: !!elementIds,
      userId: req.user?.id,
    });

    return res.status(200).json({
      message: `${elementsToCopy.length} elements copied to ${copiedCount} templates`,
      copiedCount,
      elementCount: elementsToCopy.length,
    });
  } catch (error) {
    logger.error('Failed to copy template elements:', error);
    return next({
      status: 500,
      message: 'Failed to copy template elements',
    });
  }
});

// POST /api/v1/overlay-templates/bulk-edit - Bulk edit template properties
router.post('/bulk-edit', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
      });
    }

    const { templateIds, properties } = req.body;

    if (!Array.isArray(templateIds) || !properties) {
      return res.status(400).json({
        error: 'templateIds array and properties object are required',
      });
    }

    const templateRepository = getRepository(OverlayTemplate);
    let updatedCount = 0;

    for (const templateId of templateIds) {
      const template = await templateRepository.findOne({
        where: { id: templateId, isActive: true },
      });

      if (!template) {
        logger.warn('Template not found, skipping', { templateId });
        continue;
      }

      // Skip preset templates
      if (template.isDefault) {
        logger.warn('Cannot bulk edit preset template, skipping', {
          templateId,
          templateName: template.name,
        });
        continue;
      }

      const templateData = template.getTemplateData();

      // Apply bulk properties to all elements
      templateData.elements = templateData.elements.map((element) => {
        const updatedProps = { ...element.properties };

        // Apply font family if specified
        if (properties.fontFamily && 'fontFamily' in updatedProps) {
          updatedProps.fontFamily = properties.fontFamily;
        }

        // Apply font size if specified
        if (properties.fontSize && 'fontSize' in updatedProps) {
          updatedProps.fontSize = properties.fontSize;
        }

        // Apply font weight if specified
        if (properties.fontWeight && 'fontWeight' in updatedProps) {
          updatedProps.fontWeight = properties.fontWeight;
        }

        // Apply colors if specified
        if (properties.fillColor && element.type === 'tile') {
          (updatedProps as OverlayTileElementProps).fillColor =
            properties.fillColor;
        }

        if (properties.textColor && 'color' in updatedProps) {
          updatedProps.color = properties.textColor;
        }

        // Apply border radius if specified
        if (properties.borderRadius && element.type === 'tile') {
          (updatedProps as OverlayTileElementProps).borderRadius =
            properties.borderRadius;
        }

        // Apply opacity if specified
        if (properties.opacity !== undefined && element.type === 'tile') {
          (updatedProps as OverlayTileElementProps).fillOpacity =
            properties.opacity;
        }

        return { ...element, properties: updatedProps };
      });

      template.setTemplateData(templateData);
      await templateRepository.save(template);
      updatedCount++;
    }

    logger.info('Bulk edited templates', {
      count: updatedCount,
      properties,
      userId: req.user?.id,
    });

    return res.status(200).json({
      message: `Updated ${updatedCount} templates`,
      updatedCount,
    });
  } catch (error) {
    logger.error('Failed to bulk edit templates:', error);
    return next({
      status: 500,
      message: 'Failed to bulk edit templates',
    });
  }
});

// Note: Overlay template export functionality has been moved to /overlay-template-export/:id endpoint
// (direct server route) to bypass API middleware, matching the pattern used for imports

export default router;
