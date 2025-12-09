import overlayApplication from '@server/lib/overlayApplication';
import { plexBasePosterDownloadJob } from '@server/lib/overlays/PlexBasePosterDownloadJob';
import { posterResetJob } from '@server/lib/overlays/PosterResetJob';
import { getSettings } from '@server/lib/settings';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';

const router = Router();

/**
 * GET /api/v1/overlay-settings
 * Get overlay settings
 */
router.get('/', isAuthenticated(), (_req, res) => {
  const settings = getSettings();
  return res.status(200).json({
    defaultPosterSource: settings.overlays?.defaultPosterSource || 'tmdb',
    initialSetupComplete: settings.overlays?.initialSetupComplete || false,
  });
});

/**
 * PUT /api/v1/overlay-settings
 * Update overlay settings
 */
router.put('/', isAuthenticated(), async (req, res) => {
  const { defaultPosterSource } = req.body;

  if (!['tmdb', 'plex'].includes(defaultPosterSource)) {
    return res.status(400).json({ error: 'Invalid poster source' });
  }

  const settings = getSettings();
  settings.overlays = {
    ...settings.overlays,
    defaultPosterSource,
    initialSetupComplete: true,
  };

  settings.save();

  return res.status(200).json({
    defaultPosterSource: settings.overlays.defaultPosterSource,
    initialSetupComplete: settings.overlays.initialSetupComplete,
  });
});

/**
 * POST /api/v1/overlay-settings/download-base-posters
 * Start downloading base posters from Plex
 */
router.post('/download-base-posters', isAuthenticated(), async (_req, res) => {
  // Check if download job is already running
  if (plexBasePosterDownloadJob.running) {
    return res.status(409).json({ error: 'Download job already running' });
  }

  // Check if overlay application is running (safety check)
  if (overlayApplication.running) {
    return res.status(409).json({
      error:
        'Cannot download base posters while overlay application is running',
    });
  }

  // Start download job in background
  plexBasePosterDownloadJob.run().catch(() => {
    // Error already logged in job
  });

  return res.status(202).json({
    message: 'Base poster download started',
    status: plexBasePosterDownloadJob.status,
  });
});

/**
 * GET /api/v1/overlay-settings/download-status
 * Get download job status
 */
router.get('/download-status', isAuthenticated(), (_req, res) => {
  return res.status(200).json(plexBasePosterDownloadJob.status);
});

/**
 * POST /api/v1/overlay-settings/cancel-download
 * Cancel download job
 */
router.post('/cancel-download', isAuthenticated(), (_req, res) => {
  if (!plexBasePosterDownloadJob.running) {
    return res.status(400).json({ error: 'No download job running' });
  }

  plexBasePosterDownloadJob.cancel();

  return res.status(200).json({
    message: 'Download job cancellation requested',
  });
});

/**
 * POST /api/v1/overlay-settings/reset-library-posters
 * Start resetting all posters in a library to their base versions
 */
router.post('/reset-library-posters', isAuthenticated(), async (req, res) => {
  const { libraryId } = req.body;

  if (!libraryId) {
    return res.status(400).json({ error: 'Library ID is required' });
  }

  // Check if reset job is already running
  if (posterResetJob.running) {
    return res.status(409).json({ error: 'Poster reset job already running' });
  }

  // Check if overlay application is running (safety check)
  if (overlayApplication.running) {
    return res.status(409).json({
      error: 'Cannot reset posters while overlay application is running',
    });
  }

  // Check if download job is running (safety check)
  if (plexBasePosterDownloadJob.running) {
    return res.status(409).json({
      error: 'Cannot reset posters while base poster download is running',
    });
  }

  // Start reset job in background
  posterResetJob.resetLibraryPosters(libraryId).catch(() => {
    // Error already logged in job
  });

  return res.status(202).json({
    message: 'Poster reset started',
    status: posterResetJob.status,
  });
});

/**
 * GET /api/v1/overlay-settings/reset-status
 * Get poster reset job status
 */
router.get('/reset-status', isAuthenticated(), (_req, res) => {
  return res.status(200).json(posterResetJob.status);
});

/**
 * POST /api/v1/overlay-settings/cancel-reset
 * Cancel poster reset job
 */
router.post('/cancel-reset', isAuthenticated(), (_req, res) => {
  if (!posterResetJob.running) {
    return res.status(400).json({ error: 'No reset job running' });
  }

  posterResetJob.cancel();

  return res.status(200).json({
    message: 'Poster reset cancellation requested',
  });
});

export default router;
