import { getRepository } from '@server/datasource';
import { OverlayLibraryConfig } from '@server/entity/OverlayLibraryConfig';
import { overlayLibraryService } from '@server/lib/overlays/OverlayLibraryService';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';

const router = Router();

// Apply authentication to all routes
router.use(isAuthenticated());

// GET /api/v1/overlay-library-configs - Get all library configurations
router.get('/', async (req, res, next) => {
  try {
    const configRepository = getRepository(OverlayLibraryConfig);

    const configs = await configRepository.find({
      order: { libraryName: 'ASC' },
    });

    return res.status(200).json({
      configs,
    });
  } catch (error) {
    logger.error('Failed to fetch overlay library configs:', error);
    return next({
      status: 500,
      message: 'Failed to fetch overlay library configs',
    });
  }
});

// GET /api/v1/overlay-library-configs/:libraryId - Get configuration for specific library
router.get('/:libraryId', async (req, res, next) => {
  try {
    const { libraryId } = req.params;
    const configRepository = getRepository(OverlayLibraryConfig);

    const config = await configRepository.findOne({
      where: { libraryId },
    });

    if (!config) {
      // Return empty config if not found
      return res.status(200).json({
        libraryId,
        enabledOverlays: [],
      });
    }

    return res.status(200).json(config);
  } catch (error) {
    logger.error('Failed to fetch overlay library config:', error);
    return next({
      status: 500,
      message: 'Failed to fetch overlay library config',
    });
  }
});

// POST /api/v1/overlay-library-configs/:libraryId - Create or update library configuration
router.post('/:libraryId', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
      });
    }

    const { libraryId } = req.params;
    const { libraryName, mediaType, enabledOverlays } = req.body;

    if (!libraryName || !mediaType) {
      return res.status(400).json({
        error: 'Library name and media type are required',
      });
    }

    if (mediaType !== 'movie' && mediaType !== 'show') {
      return res.status(400).json({
        error: 'Media type must be either movie or show',
      });
    }

    if (!Array.isArray(enabledOverlays)) {
      return res.status(400).json({
        error: 'enabledOverlays must be an array',
      });
    }

    const configRepository = getRepository(OverlayLibraryConfig);

    let config = await configRepository.findOne({
      where: { libraryId },
    });

    if (config) {
      // Update existing
      config.libraryName = libraryName;
      config.mediaType = mediaType;
      config.enabledOverlays = enabledOverlays;
    } else {
      // Create new
      config = new OverlayLibraryConfig({
        libraryId,
        libraryName,
        mediaType,
        enabledOverlays,
      });
    }

    const savedConfig = await configRepository.save(config);

    logger.info('Saved overlay library configuration', {
      libraryId,
      libraryName,
      enabledOverlayCount: enabledOverlays.length,
      userId: req.user?.id,
    });

    return res.status(200).json(savedConfig);
  } catch (error) {
    logger.error('Failed to save overlay library config:', error);
    return next({
      status: 500,
      message: 'Failed to save overlay library config',
    });
  }
});

// DELETE /api/v1/overlay-library-configs/:libraryId - Delete library configuration
router.delete('/:libraryId', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
      });
    }

    const { libraryId } = req.params;
    const configRepository = getRepository(OverlayLibraryConfig);

    const config = await configRepository.findOne({
      where: { libraryId },
    });

    if (!config) {
      return res.status(404).json({
        error: 'Configuration not found',
      });
    }

    await configRepository.remove(config);

    logger.info('Deleted overlay library configuration', {
      libraryId,
      userId: req.user?.id,
    });

    return res.status(200).json({
      message: 'Configuration deleted successfully',
    });
  } catch (error) {
    logger.error('Failed to delete overlay library config:', error);
    return next({
      status: 500,
      message: 'Failed to delete overlay library config',
    });
  }
});

// POST /api/v1/overlay-library-configs/:libraryId/apply - Apply overlays to library
router.post('/:libraryId/apply', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
      });
    }

    const { libraryId } = req.params;

    logger.info('Applying overlays to library', {
      libraryId,
      userId: req.user?.id,
    });

    // Start async overlay application
    overlayLibraryService.applyOverlaysToLibrary(libraryId).catch((error) => {
      logger.error('Overlay application failed', {
        libraryId,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    // Return immediately - overlay application runs in background
    return res.status(202).json({
      message: 'Overlay application started',
      libraryId,
    });
  } catch (error) {
    logger.error('Failed to start overlay application:', error);
    return next({
      status: 500,
      message: 'Failed to start overlay application',
    });
  }
});

export default router;
