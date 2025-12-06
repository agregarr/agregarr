import overlayApplication from '@server/lib/overlayApplication';
import { plexBasePosterDownloadJob } from '@server/lib/overlays/PlexBasePosterDownloadJob';
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

export default router;
