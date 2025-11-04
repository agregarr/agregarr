import { templateEngine } from '@server/lib/collections/utils/TemplateEngine';
import type { PosterGenerationConfig } from '@server/lib/posterGeneration';
import {
  downloadAndSavePoster,
  generatePoster,
  getPosterUrl,
  savePosterFile,
} from '@server/lib/posterStorage';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';
import { posterUpload, rateLimiter } from './collections';

const collectionPostersRoutes = Router();

/**
 * Upload a poster image for collections
 * POST /api/v1/collections/poster
 */
collectionPostersRoutes.post(
  '/poster',
  isAuthenticated(),
  (req, res, next) => {
    posterUpload(req, res, (err) => {
      if (err) {
        logger.error('Poster upload error:', err);

        // Handle specific multer errors
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            error: 'File too large. Maximum size is 10MB.',
          });
        } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return res.status(400).json({
            error: 'Unexpected field name. Use "poster" as the field name.',
          });
        } else {
          return res.status(400).json({
            error: err.message || 'File upload failed',
          });
        }
      }
      next();
    });
  },
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      // Save the poster file
      const filename = await savePosterFile(
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname
      );

      return res.status(200).json({
        filename,
        url: getPosterUrl(filename),
      });
    } catch (error) {
      logger.error('Error processing poster upload:', error);
      return res.status(400).json({
        error:
          error instanceof Error ? error.message : 'Failed to process poster',
      });
    }
  }
);

/**
 * Generate a poster for a collection
 * POST /api/v1/collections/generate-poster
 */
collectionPostersRoutes.post(
  '/generate-poster',
  isAuthenticated(),
  async (req, res) => {
    try {
      const {
        collectionName,
        collectionType,
        collectionSubtype,
        mediaType,
        template,
        customMovieTemplate,
        customTVTemplate,
        autoPosterTemplate,
      } = req.body;

      // Validate required fields
      if (
        !collectionName ||
        typeof collectionName !== 'string' ||
        !collectionName.trim()
      ) {
        return res.status(400).json({
          error: 'Collection name is required and must be a non-empty string',
        });
      }

      // Validate optional fields
      if (collectionType && typeof collectionType !== 'string') {
        return res.status(400).json({
          error: 'Collection type must be a string if provided',
        });
      }

      if (mediaType && !['movie', 'tv'].includes(mediaType)) {
        return res.status(400).json({
          error: 'Media type must be "movie" or "tv" if provided',
        });
      }

      // Process template if provided, using the specific media type
      let processedCollectionName = collectionName.trim();

      if (template && mediaType) {
        const context = {
          mediaType,
          subtype: collectionSubtype,
        };

        // Choose the correct template based on media type
        let templateToProcess = template;
        if (mediaType === 'movie' && customMovieTemplate) {
          templateToProcess = customMovieTemplate;
        } else if (mediaType === 'tv' && customTVTemplate) {
          templateToProcess = customTVTemplate;
        }

        processedCollectionName = templateEngine.processTemplate(
          templateToProcess,
          context
        );
      }

      const config: PosterGenerationConfig = {
        collectionName: processedCollectionName,
        collectionType,
        collectionSubtype,
        mediaType,
        template,
        autoPosterTemplate,
      };

      logger.info('Generating poster for collection:', config);

      // Generate the poster
      const filename = await generatePoster(
        config,
        `Generated: ${collectionName}`
      );

      return res.status(200).json({
        filename,
        url: getPosterUrl(filename),
        message: 'Poster generated successfully',
      });
    } catch (error) {
      logger.error('Error generating poster:', error);
      return res.status(500).json({
        error:
          error instanceof Error ? error.message : 'Failed to generate poster',
      });
    }
  }
);

/**
 * Download a poster from a URL and save it
 * POST /api/v1/collections/download-poster
 */
collectionPostersRoutes.post(
  '/download-poster',
  isAuthenticated(),
  async (req, res) => {
    try {
      const { url } = req.body;

      // Validate URL
      if (!url || typeof url !== 'string' || !url.trim()) {
        return res.status(400).json({
          error: 'URL is required and must be a non-empty string',
        });
      }

      // Basic URL validation
      let validUrl: URL;
      try {
        validUrl = new URL(url.trim());
      } catch {
        return res.status(400).json({
          error: 'Invalid URL format',
        });
      }

      // Security: Only allow HTTP/HTTPS
      if (!['http:', 'https:'].includes(validUrl.protocol)) {
        return res.status(400).json({
          error: 'Only HTTP and HTTPS URLs are allowed',
        });
      }

      // Rate limiting check
      const clientId = req.ip || 'unknown';
      if (!rateLimiter.isAllowed(clientId)) {
        return res.status(429).json({
          error: 'Too many requests. Please try again later.',
        });
      }

      logger.info('Downloading poster from URL:', {
        url: url.trim(),
        clientId,
      });

      // Download and save the poster
      const filename = await downloadAndSavePoster(
        url.trim(),
        `Downloaded from: ${validUrl.hostname}`
      );

      if (!filename) {
        return res.status(400).json({
          error:
            'Failed to download poster. The URL may be invalid, the image may be too large, or the server may be unreachable.',
        });
      }

      return res.status(200).json({
        filename,
        url: getPosterUrl(filename),
        message: 'Poster downloaded successfully',
      });
    } catch (error) {
      logger.error('Error downloading poster from URL:', error);
      return res.status(500).json({
        error:
          error instanceof Error ? error.message : 'Failed to download poster',
      });
    }
  }
);

/**
 * List all stored poster files
 * GET /api/v1/collections/posters
 */
collectionPostersRoutes.get('/posters', isAuthenticated(), async (req, res) => {
  try {
    const { getAllPosterFiles, getPosterUrl } = await import(
      '@server/lib/posterStorage'
    );

    const posterFiles = await getAllPosterFiles();

    // Map files to include URLs and metadata
    const posters = posterFiles.map((filename) => ({
      filename,
      url: getPosterUrl(filename),
    }));

    return res.status(200).json({ posters });
  } catch (error) {
    logger.error('Error listing posters:', error);
    return res.status(500).json({ error: 'Failed to list posters' });
  }
});

/**
 * Serve poster images
 * GET /api/v1/collections/poster/:filename
 */
collectionPostersRoutes.get('/poster/:filename', async (req, res) => {
  // Note: No authentication required for serving images - they're already uploaded by admins
  // and filenames are UUIDs making them hard to guess
  try {
    const { filename } = req.params;
    const { getPosterPath, posterExists } = await import(
      '@server/lib/posterStorage'
    );

    // Security validation is now handled by posterExists and getPosterPath
    if (!posterExists(filename)) {
      return res.status(404).json({ error: 'Poster not found' });
    }

    const posterPath = getPosterPath(filename);

    // Determine content type from file extension
    const extension = filename.toLowerCase().split('.').pop();
    let contentType = 'image/jpeg'; // default
    if (extension === 'png') {
      contentType = 'image/png';
    } else if (extension === 'webp') {
      contentType = 'image/webp';
    }

    // Set appropriate headers
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year

    // Stream the file
    const fs = await import('fs');
    const stream = fs.createReadStream(posterPath);
    stream.pipe(res);

    stream.on('error', (error) => {
      logger.error('Error streaming poster file:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to serve poster' });
      }
    });
  } catch (error) {
    logger.error('Error serving poster:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Delete a poster image
 * DELETE /api/v1/collections/poster/:filename
 */
collectionPostersRoutes.delete('/poster/:filename', async (req, res) => {
  if (!req.user) {
    return res.status(403).json({ error: 'Authentication required' });
  }
  // Permission system removed - all authenticated users can manage collections

  try {
    const { filename } = req.params;
    const { deletePosterFile, posterExists } = await import(
      '@server/lib/posterStorage'
    );

    // Security validation is now handled by posterExists and deletePosterFile
    if (!posterExists(filename)) {
      return res.status(404).json({ error: 'Poster not found' });
    }

    await deletePosterFile(filename);

    return res.status(200).json({ message: 'Poster deleted successfully' });
  } catch (error) {
    logger.error('Error deleting poster:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default collectionPostersRoutes;
