import { getRepository } from '@server/datasource';
import { PosterTemplate } from '@server/entity/PosterTemplate';
import { SavedPoster } from '@server/entity/SavedPoster';
import {
  deleteIcon,
  downloadIcon,
  getIconCategories,
  getIcons,
  loadIconFile,
} from '@server/lib/iconManager';
import {
  loadPosterFile,
  loadThumbnailFile,
} from '@server/lib/posterFileManager';
import {
  generateTemplatePreview,
  sanitizeTemplateData,
  validateTemplateData,
} from '@server/lib/posterTemplates';
import {
  DEFAULT_SOURCE_COLORS,
  getAvailableSourceTypes,
} from '@server/lib/sourceColors';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';
import fs from 'fs';
import path from 'path';

const router = Router();

// Apply authentication to all routes
router.use(isAuthenticated());

// GET /api/v1/posters/templates - Get all templates
router.get('/templates', async (req, res, next) => {
  try {
    const templateRepository = getRepository(PosterTemplate);

    const templates = await templateRepository.find({
      where: { isActive: true },
      order: { isDefault: 'DESC', createdAt: 'ASC' },
    });

    const templatesResponse = templates.map((template: PosterTemplate) => {
      return {
        id: template.id,
        name: template.name,
        description: template.description,
        isDefault: template.isDefault,
        templateData: template.getTemplateData(),
        createdAt: template.createdAt,
        updatedAt: template.updatedAt,
      };
    });

    return res.status(200).json({
      templates: templatesResponse,
    });
  } catch (error) {
    logger.error('Failed to fetch poster templates:', error);
    return next({
      status: 500,
      message: 'Failed to fetch poster templates',
    });
  }
});

// POST /api/v1/posters/templates - Create new template
router.post('/templates', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
      });
    }

    const { name, description, templateData } = req.body;

    if (!name || !templateData) {
      return res.status(400).json({
        error: 'Template name and data are required',
      });
    }

    // Sanitize and validate template data
    const sanitizedData = sanitizeTemplateData(templateData);
    const validation = validateTemplateData(sanitizedData);

    if (!validation.isValid) {
      return res.status(400).json({
        error: 'Invalid template data',
        details: validation.errors,
      });
    }

    const templateRepository = getRepository(PosterTemplate);

    const newTemplate = new PosterTemplate({
      name,
      description,
      isDefault: false,
      isActive: true,
    });

    newTemplate.setTemplateData(sanitizedData);

    const savedTemplate = await templateRepository.save(newTemplate);

    logger.info('Created new poster template', {
      templateId: savedTemplate.id,
      name: savedTemplate.name,
      userId: req.user?.id,
    });

    return res.status(201).json({
      id: savedTemplate.id,
      name: savedTemplate.name,
      description: savedTemplate.description,
      isDefault: savedTemplate.isDefault,
      templateData: savedTemplate.getTemplateData(),
      createdAt: savedTemplate.createdAt,
      updatedAt: savedTemplate.updatedAt,
    });
  } catch (error) {
    logger.error('Failed to create poster template:', error);
    return next({
      status: 500,
      message: 'Failed to create poster template',
    });
  }
});

// PUT /api/v1/posters/templates/:id - Update template
router.put('/templates/:id', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
      });
    }

    const templateId = parseInt(req.params.id);
    const { name, description, templateData } = req.body;

    const templateRepository = getRepository(PosterTemplate);
    const template = await templateRepository.findOne({
      where: { id: templateId, isActive: true },
    });

    if (!template) {
      return res.status(404).json({
        error: 'Template not found',
      });
    }

    // Single-user system - no permission checks needed

    if (name !== undefined) template.name = name;
    if (description !== undefined) template.description = description;
    if (templateData) {
      // Sanitize and validate template data
      const sanitizedData = sanitizeTemplateData(templateData);
      const validation = validateTemplateData(sanitizedData);

      if (!validation.isValid) {
        return res.status(400).json({
          error: 'Invalid template data',
          details: validation.errors,
        });
      }

      template.setTemplateData(sanitizedData);
    }

    const savedTemplate = await templateRepository.save(template);

    logger.info('Updated poster template', {
      templateId: savedTemplate.id,
      name: savedTemplate.name,
      userId: req.user?.id,
    });

    return res.status(200).json({
      id: savedTemplate.id,
      name: savedTemplate.name,
      description: savedTemplate.description,
      isDefault: savedTemplate.isDefault,
      templateData: savedTemplate.getTemplateData(),
      createdAt: savedTemplate.createdAt,
      updatedAt: savedTemplate.updatedAt,
    });
  } catch (error) {
    logger.error('Failed to update poster template:', error);
    return next({
      status: 500,
      message: 'Failed to update poster template',
    });
  }
});

// DELETE /api/v1/posters/templates/:id - Delete template
router.delete('/templates/:id', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
      });
    }

    const templateId = parseInt(req.params.id);

    const templateRepository = getRepository(PosterTemplate);
    const template = await templateRepository.findOne({
      where: { id: templateId, isActive: true },
    });

    if (!template) {
      return res.status(404).json({
        error: 'Template not found',
      });
    }

    // Don't allow deleting default templates
    if (template.isDefault) {
      return res.status(403).json({
        error: 'Cannot delete default template',
      });
    }

    // Soft delete
    template.isActive = false;
    await templateRepository.save(template);

    logger.info('Deleted poster template', {
      templateId,
      name: template.name,
      userId: req.user?.id,
    });

    return res.status(204).send();
  } catch (error) {
    logger.error('Failed to delete poster template:', error);
    return next({
      status: 500,
      message: 'Failed to delete poster template',
    });
  }
});

// POST /api/v1/posters/templates/:id/set-default - Set template as default
router.post('/templates/:id/set-default', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
      });
    }

    const templateId = parseInt(req.params.id);

    const templateRepository = getRepository(PosterTemplate);

    // Find the template to set as default
    const template = await templateRepository.findOne({
      where: { id: templateId, isActive: true },
    });

    if (!template) {
      return res.status(404).json({
        error: 'Template not found',
      });
    }

    // First, remove default flag from all templates
    await templateRepository.update({ isDefault: true }, { isDefault: false });

    // Set the selected template as default
    template.isDefault = true;
    await templateRepository.save(template);

    logger.info('Set template as default', {
      templateId,
      name: template.name,
      userId: req.user?.id,
    });

    return res.status(200).json({
      message: 'Template set as default successfully',
      template: {
        id: template.id,
        name: template.name,
        isDefault: template.isDefault,
      },
    });
  } catch (error) {
    logger.error('Failed to set template as default:', error);
    return next({
      status: 500,
      message: 'Failed to set template as default',
    });
  }
});

// GET /api/v1/posters/saved - Get all saved posters
router.get('/saved', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
      });
    }

    const posterRepository = getRepository(SavedPoster);

    // Get database entries for posters created in the editor
    const dbPosters = await posterRepository.find({
      where: { isActive: true },
      order: { createdAt: 'DESC' },
    });

    // Get all poster files from storage folder (includes legacy and editor-exported files)
    const { getAllPosterFiles } = await import('@server/lib/posterStorage');
    const allPosterFiles = await getAllPosterFiles();

    // Create a map of database posters by filename for quick lookup
    const dbPostersByFilename = new Map(
      dbPosters.filter((p) => p.filename).map((p) => [p.filename as string, p])
    );

    // Process all poster files from storage
    const allPostersResponse = allPosterFiles.map((filename) => {
      const dbPoster = dbPostersByFilename.get(filename);

      if (dbPoster) {
        // This file has a database entry (created in editor)
        // Get file mtime for cache-busting even for db posters
        let updatedAtMs: number | null = null;
        if (dbPoster.filename) {
          try {
            const filePath = path.join(
              process.cwd(),
              'config',
              'posters',
              dbPoster.filename
            );
            const stats = fs.statSync(filePath);
            updatedAtMs = stats.mtimeMs;
          } catch (error) {
            // Fallback to database timestamp if file stats unavailable
            updatedAtMs = new Date(dbPoster.updatedAt).getTime();
          }
        }

        return {
          id: dbPoster.id,
          name: dbPoster.name,
          description: dbPoster.description,
          filename: dbPoster.filename,
          thumbnailFilename: dbPoster.thumbnailFilename,
          posterData: dbPoster.getPosterData(),
          createdAt: dbPoster.createdAt,
          updatedAt: dbPoster.updatedAt,
          updatedAtMs, // Numeric timestamp for cache-busting
          isEditable: true, // Can be edited in poster editor
        };
      } else {
        // This is a legacy/uploaded file without database entry
        // Use file stats for consistent timestamps
        const filePath = path.join(
          process.cwd(),
          'config',
          'posters',
          filename
        );
        let createdAt = new Date().toISOString();
        let updatedAt = new Date().toISOString();
        let updatedAtMs: number | null = null;

        try {
          const stats = fs.statSync(filePath);
          createdAt = stats.birthtime.toISOString();
          updatedAt = stats.mtime.toISOString();
          updatedAtMs = stats.mtimeMs; // Numeric timestamp for cache-busting
        } catch (error) {
          // Fallback to current time if file stats unavailable
        }

        return {
          id: `file-${filename}`, // Use filename-based ID for legacy files
          name: filename.replace(/\.(jpg|jpeg|png|webp)$/i, ''), // Filename without extension
          description: 'Uploaded poster file',
          filename,
          thumbnailFilename: undefined,
          posterData: null,
          createdAt,
          updatedAt,
          updatedAtMs, // Numeric timestamp for cache-busting
          isEditable: false, // Cannot be edited in poster editor
        };
      }
    });

    // Add database entries that don't have files (edge case)
    const dbPostersWithoutFiles = dbPosters.filter(
      (p) => !p.filename || !allPosterFiles.includes(p.filename)
    );
    const dbOnlyPosters = dbPostersWithoutFiles.map((poster) => ({
      id: poster.id,
      name: poster.name,
      description: poster.description,
      filename: poster.filename,
      thumbnailFilename: poster.thumbnailFilename,
      posterData: poster.getPosterData(),
      createdAt: poster.createdAt,
      updatedAt: poster.updatedAt,
      isEditable: true,
    }));

    // Combine all posters and sort by creation date (newest first)
    const allPosters = [...allPostersResponse, ...dbOnlyPosters].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return res.status(200).json({
      posters: allPosters,
    });
  } catch (error) {
    logger.error('Failed to fetch saved posters:', error);
    return next({
      status: 500,
      message: 'Failed to fetch saved posters',
    });
  }
});

// POST /api/v1/posters/saved - Create new saved poster
router.post('/saved', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
      });
    }

    const { name, description, posterData, filename, thumbnailFilename } =
      req.body;

    if (!name || !posterData) {
      return res.status(400).json({
        error: 'Poster name and data are required',
      });
    }

    const posterRepository = getRepository(SavedPoster);

    const newPoster = new SavedPoster({
      name,
      description,
      filename,
      thumbnailFilename,
      isActive: true,
    });

    newPoster.setPosterData(posterData);

    const savedPoster = await posterRepository.save(newPoster);

    logger.info('Created new saved poster', {
      posterId: savedPoster.id,
      name: savedPoster.name,
      userId: req.user?.id,
    });

    return res.status(201).json({
      id: savedPoster.id,
      name: savedPoster.name,
      description: savedPoster.description,
      filename: savedPoster.filename,
      thumbnailFilename: savedPoster.thumbnailFilename,
      posterData: savedPoster.getPosterData(),
      createdAt: savedPoster.createdAt,
      updatedAt: savedPoster.updatedAt,
    });
  } catch (error) {
    logger.error('Failed to create saved poster:', error);
    return next({
      status: 500,
      message: 'Failed to create saved poster',
    });
  }
});

// PUT /api/v1/posters/saved/:id - Update saved poster
router.put('/saved/:id', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
      });
    }

    const posterId = parseInt(req.params.id);
    const { name, description, posterData, filename, thumbnailFilename } =
      req.body;

    const posterRepository = getRepository(SavedPoster);
    const poster = await posterRepository.findOne({
      where: { id: posterId, isActive: true },
    });

    if (!poster) {
      return res.status(404).json({
        error: 'Poster not found',
      });
    }

    if (name !== undefined) poster.name = name;
    if (description !== undefined) poster.description = description;
    if (filename !== undefined) poster.filename = filename;
    if (thumbnailFilename !== undefined)
      poster.thumbnailFilename = thumbnailFilename;
    if (posterData) poster.setPosterData(posterData);

    const savedPoster = await posterRepository.save(poster);

    logger.info('Updated saved poster', {
      posterId: savedPoster.id,
      name: savedPoster.name,
      userId: req.user?.id,
    });

    return res.status(200).json({
      id: savedPoster.id,
      name: savedPoster.name,
      description: savedPoster.description,
      filename: savedPoster.filename,
      thumbnailFilename: savedPoster.thumbnailFilename,
      posterData: savedPoster.getPosterData(),
      createdAt: savedPoster.createdAt,
      updatedAt: savedPoster.updatedAt,
    });
  } catch (error) {
    logger.error('Failed to update saved poster:', error);
    return next({
      status: 500,
      message: 'Failed to update saved poster',
    });
  }
});

/**
 * Check if a poster is currently in use by any collections
 */
async function checkPosterUsage(
  posterId: number | string
): Promise<{ inUse: boolean; collections: string[] }> {
  const { getSettings } = await import('@server/lib/settings');
  const { preExistingCollectionConfigService } = await import(
    '@server/lib/collections/services/PreExistingCollectionConfigService'
  );

  const collections: string[] = [];
  const posterIdStr = posterId.toString();

  // Check user-created collections (CollectionFormConfig)
  const settings = getSettings();
  const collectionConfigs = settings.plex.collectionConfigs || [];

  for (const config of collectionConfigs) {
    // Check customPoster field - can be string or Record<string, string>
    if (config.customPoster) {
      if (
        typeof config.customPoster === 'string' &&
        config.customPoster === posterIdStr
      ) {
        collections.push(config.name);
      } else if (typeof config.customPoster === 'object') {
        const posterValues = Object.values(config.customPoster);
        if (posterValues.includes(posterIdStr)) {
          collections.push(config.name);
        }
      }
    }

    // Check autoPosterTemplate field (only for numeric IDs)
    if (
      typeof posterId === 'number' &&
      config.autoPosterTemplate &&
      config.autoPosterTemplate === posterId
    ) {
      collections.push(config.name);
    }
  }

  // Check pre-existing collections (PreExistingCollectionConfig)
  const preExistingConfigs = preExistingCollectionConfigService.getConfigs();

  for (const config of preExistingConfigs) {
    // Check customPoster field - can be string or Record<string, string>
    if (config.customPoster) {
      if (
        typeof config.customPoster === 'string' &&
        config.customPoster === posterIdStr
      ) {
        collections.push(config.name);
      } else if (typeof config.customPoster === 'object') {
        const posterValues = Object.values(config.customPoster);
        if (posterValues.includes(posterIdStr)) {
          collections.push(config.name);
        }
      }
    }
  }

  return {
    inUse: collections.length > 0,
    collections,
  };
}

// DELETE /api/v1/posters/saved/:id - Delete saved poster
router.delete('/saved/:id', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
      });
    }

    const posterIdParam = req.params.id;

    // Check if this is a file-based poster (starts with "file-")
    if (posterIdParam.startsWith('file-')) {
      // Extract filename from file-based ID
      const filename = posterIdParam.substring(5); // Remove "file-" prefix
      const force = String(req.query.force) === 'true';

      // Check if file exists before deletion
      const { posterExists, deletePosterFile, getPosterUsage } = await import(
        '@server/lib/posterStorage'
      );

      if (!posterExists(filename)) {
        return res.status(404).json({
          error: 'Poster file not found',
        });
      }

      // Check if file-based poster is in use by any collections
      const usedBy = await getPosterUsage(filename);
      if (usedBy.length > 0 && !force) {
        return res.status(409).json({
          error: 'Poster is currently in use',
          inUse: true,
          usedBy,
        });
      }

      // Delete the file from storage
      await deletePosterFile(filename);

      logger.info('Deleted file-based poster', {
        filename,
        posterIdParam,
        force,
        userId: req.user?.id,
      });

      return res.status(204).send();
    }

    // Handle database poster (integer ID)
    const posterId = parseInt(posterIdParam);

    if (isNaN(posterId)) {
      return res.status(400).json({
        error: 'Invalid poster ID',
      });
    }

    const posterRepository = getRepository(SavedPoster);
    const poster = await posterRepository.findOne({
      where: { id: posterId, isActive: true },
    });

    if (!poster) {
      return res.status(404).json({
        error: 'Poster not found',
      });
    }

    // Check if database poster is in use by any collections
    const usage = await checkPosterUsage(posterId);
    if (usage.inUse) {
      return res.status(409).json({
        error: 'Poster is currently in use',
        message: `This poster is being used by the following collections: ${usage.collections.join(
          ', '
        )}`,
        collections: usage.collections,
      });
    }

    // Soft delete database entry
    poster.isActive = false;
    await posterRepository.save(poster);

    // TODO: Also clean up associated files (filename, thumbnailFilename)
    // This will be handled in Phase 3 when we set up file management

    logger.info('Deleted database poster', {
      posterId,
      name: poster.name,
      userId: req.user?.id,
    });

    return res.status(204).send();
  } catch (error) {
    logger.error('Failed to delete saved poster:', error);
    return next({
      status: 500,
      message: 'Failed to delete saved poster',
    });
  }
});

// GET /api/v1/posters/templates/:id/preview - Generate template preview
router.get('/templates/:id/preview', async (req, res, next) => {
  try {
    const templateId = parseInt(req.params.id);
    const { collectionName, collectionType, mediaType } = req.query;

    if (isNaN(templateId)) {
      return res.status(400).json({
        error: 'Invalid template ID',
      });
    }

    try {
      const previewBuffer = await generateTemplatePreview(templateId, {
        collectionName: (collectionName as string) || 'Preview Collection',
        collectionType: collectionType as string,
        mediaType: (mediaType as 'movie' | 'tv') || 'movie',
      });

      // Return the preview as an image
      res.set({
        'Content-Type': 'image/png',
        'Content-Length': previewBuffer.length,
        'Cache-Control': 'no-cache', // Don't cache so it updates immediately
      });

      return res.send(previewBuffer);
    } catch (error) {
      logger.error('Failed to generate template preview:', error);
      return res.status(400).json({
        error: 'Failed to generate preview',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  } catch (error) {
    logger.error('Template preview endpoint error:', error);
    return next({
      status: 500,
      message: 'Failed to generate template preview',
    });
  }
});

// POST /api/v1/posters/templates/validate - Validate template data
router.post('/templates/validate', async (req, res, next) => {
  try {
    const { templateData } = req.body;

    if (!templateData) {
      return res.status(400).json({
        error: 'Template data is required',
      });
    }

    const sanitizedData = sanitizeTemplateData(templateData);
    const validation = validateTemplateData(sanitizedData);

    return res.status(200).json({
      isValid: validation.isValid,
      errors: validation.errors,
      warnings: validation.warnings,
      sanitizedData: validation.isValid ? sanitizedData : undefined,
    });
  } catch (error) {
    logger.error('Failed to validate template data:', error);
    return next({
      status: 500,
      message: 'Failed to validate template data',
    });
  }
});

// POST /api/v1/posters/icons/download - Download icon from URL
router.post('/icons/download', async (req, res, next) => {
  try {
    const { url, name, category, tags, description } = req.body;

    if (!url) {
      return res.status(400).json({
        error: 'URL is required',
      });
    }

    try {
      const iconMetadata = await downloadIcon(url, {
        name,
        category,
        tags: tags ? (Array.isArray(tags) ? tags : [tags]) : undefined,
        description,
      });

      logger.info('Icon downloaded successfully', {
        iconId: iconMetadata.id,
        name: iconMetadata.name,
        url,
        userId: req.user?.id,
      });

      return res.status(201).json({
        icon: iconMetadata,
      });
    } catch (downloadError) {
      logger.error('Failed to download icon:', downloadError);
      return res.status(400).json({
        error:
          downloadError instanceof Error
            ? downloadError.message
            : 'Failed to download icon',
      });
    }
  } catch (error) {
    logger.error('Icon download endpoint error:', error);
    return next({
      status: 500,
      message: 'Failed to download icon',
    });
  }
});

// GET /api/v1/posters/icons - List available icons
router.get('/icons', async (req, res, next) => {
  try {
    const { type, category, tags, search } = req.query;

    const filters = {
      type: type as 'user' | 'system' | undefined,
      category: category as string | undefined,
      tags: tags
        ? Array.isArray(tags)
          ? (tags as string[])
          : [tags as string]
        : undefined,
      search: search as string | undefined,
    };

    const icons = await getIcons(filters);

    return res.status(200).json({
      icons,
    });
  } catch (error) {
    logger.error('Failed to list icons:', error);
    return next({
      status: 500,
      message: 'Failed to list icons',
    });
  }
});

// GET /api/v1/posters/icons/categories - List icon categories
router.get('/icons/categories', async (_req, res, next) => {
  try {
    const categories = await getIconCategories();

    return res.status(200).json({
      categories,
    });
  } catch (error) {
    logger.error('Failed to list icon categories:', error);
    return next({
      status: 500,
      message: 'Failed to list icon categories',
    });
  }
});

// DELETE /api/v1/posters/icons/:id - Delete icon
router.delete('/icons/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        error: 'Icon ID is required',
      });
    }

    try {
      await deleteIcon(id);

      logger.info('Icon deleted successfully', {
        iconId: id,
        userId: req.user?.id,
      });

      return res.status(204).send();
    } catch (deleteError) {
      if (
        deleteError instanceof Error &&
        deleteError.message === 'Icon not found'
      ) {
        return res.status(404).json({
          error: 'Icon not found',
        });
      }

      return res.status(400).json({
        error:
          deleteError instanceof Error
            ? deleteError.message
            : 'Failed to delete icon',
      });
    }
  } catch (error) {
    logger.error('Failed to delete icon:', error);
    return next({
      status: 500,
      message: 'Failed to delete icon',
    });
  }
});

// GET /api/v1/posters/files/:filename - Serve poster files
router.get('/files/:filename', async (req, res, next) => {
  try {
    const { filename } = req.params;

    if (!filename) {
      return res.status(400).json({
        error: 'Filename is required',
      });
    }

    try {
      const posterBuffer = await loadPosterFile(filename);

      res.set({
        'Content-Type': 'image/jpeg',
        'Content-Length': posterBuffer.length,
        'Cache-Control': 'public, max-age=86400', // Cache for 24 hours
      });

      return res.send(posterBuffer);
    } catch (error) {
      logger.debug('Poster file not found or failed to load', {
        filename,
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(404).json({
        error: 'Poster file not found',
      });
    }
  } catch (error) {
    logger.error('Failed to serve poster file:', error);
    return next({
      status: 500,
      message: 'Failed to serve poster file',
    });
  }
});

// GET /api/v1/posters/thumbnails/:filename - Serve thumbnail files
router.get('/thumbnails/:filename', async (req, res, next) => {
  try {
    const { filename } = req.params;

    if (!filename) {
      return res.status(400).json({
        error: 'Filename is required',
      });
    }

    try {
      const thumbnailBuffer = await loadThumbnailFile(filename);

      if (!thumbnailBuffer) {
        return res.status(404).json({
          error: 'Thumbnail not found',
        });
      }

      res.set({
        'Content-Type': 'image/jpeg',
        'Content-Length': thumbnailBuffer.length,
        'Cache-Control': 'public, max-age=86400', // Cache for 24 hours
      });

      return res.send(thumbnailBuffer);
    } catch (error) {
      logger.debug('Thumbnail file not found or failed to load', {
        filename,
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(404).json({
        error: 'Thumbnail not found',
      });
    }
  } catch (error) {
    logger.error('Failed to serve thumbnail file:', error);
    return next({
      status: 500,
      message: 'Failed to serve thumbnail file',
    });
  }
});

// GET /api/v1/posters/icons/:type/:filename - Serve icon files
router.get('/icons/:type/:filename', async (req, res, next) => {
  try {
    const { type, filename } = req.params;

    if (!['user', 'system'].includes(type)) {
      return res.status(400).json({
        error: 'Invalid icon type. Must be "user" or "system"',
      });
    }

    if (!filename) {
      return res.status(400).json({
        error: 'Filename is required',
      });
    }

    try {
      const iconBuffer = await loadIconFile(
        filename,
        type as 'user' | 'system'
      );

      // Determine content type based on file extension
      const ext = filename.toLowerCase().split('.').pop();
      let contentType = 'image/png';

      switch (ext) {
        case 'svg':
          contentType = 'image/svg+xml';
          break;
        case 'jpg':
        case 'jpeg':
          contentType = 'image/jpeg';
          break;
        case 'png':
          contentType = 'image/png';
          break;
        case 'webp':
          contentType = 'image/webp';
          break;
      }

      res.set({
        'Content-Type': contentType,
        'Content-Length': iconBuffer.length,
        'Cache-Control': 'public, max-age=86400', // Cache for 24 hours
      });

      return res.send(iconBuffer);
    } catch (error) {
      logger.debug('Icon file not found or failed to load', {
        type,
        filename,
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(404).json({
        error: 'Icon file not found',
      });
    }
  } catch (error) {
    logger.error('Failed to serve icon file:', error);
    return next({
      status: 500,
      message: 'Failed to serve icon file',
    });
  }
});

// GET /api/v1/posters/templates/:id/export - Export template as ZIP with assets
router.get('/templates/:id/export', async (req, res, next) => {
  try {
    const templateId = parseInt(req.params.id);

    if (isNaN(templateId)) {
      return res.status(400).json({
        error: 'Invalid template ID',
      });
    }

    const templateRepository = getRepository(PosterTemplate);
    const template = await templateRepository.findOne({
      where: { id: templateId, isActive: true },
    });

    if (!template) {
      return res.status(404).json({
        error: 'Template not found',
      });
    }

    const templateData = template.getTemplateData();

    // Collect all asset paths that need to be included
    const assetPaths = new Set<string>();

    // Check unified elements for custom assets
    templateData.elements?.forEach((element) => {
      if (element.type === 'svg') {
        const svgProps = element.properties as { iconPath?: string };
        if (svgProps.iconPath) {
          assetPaths.add(svgProps.iconPath);
        }
      } else if (element.type === 'raster') {
        const rasterProps = element.properties as { imagePath?: string };
        if (rasterProps.imagePath) {
          assetPaths.add(rasterProps.imagePath);
        }
      }
    });

    const archiver = (await import('archiver')).default;
    const archive = archiver('zip', {
      zlib: { level: 9 }, // Maximum compression
    });

    // Set headers for ZIP download
    const filename = `${template.name.replace(
      /[^a-zA-Z0-9]/g,
      '_'
    )}_template.zip`;
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });

    // Handle archiver events
    archive.on('error', (err) => {
      logger.error('Archive error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to create archive' });
      }
    });

    // Pipe archive to response
    archive.pipe(res);

    // Add template JSON to the archive
    const exportData = {
      name: template.name,
      description: template.description,
      templateData: templateData,
      exportedAt: new Date().toISOString(),
      version: '2.0', // Increment version for zip format
    };

    archive.append(JSON.stringify(exportData, null, 2), {
      name: 'template.json',
    });

    // Add asset files to the archive
    for (const assetPath of assetPaths) {
      try {
        // Check if this is an icon URL path (format: /api/v1/posters/icons/{type}/{filename})
        const iconUrlMatch = assetPath.match(
          /\/api\/v1\/posters\/icons\/(\w+)\/(.+)/
        );

        if (iconUrlMatch) {
          const [, iconType, filename] = iconUrlMatch;

          // Only bundle user-uploaded icons, skip system icons
          if (iconType === 'user') {
            const iconFilePath = path.join(
              process.cwd(),
              'config',
              'icons',
              filename
            );

            if (fs.existsSync(iconFilePath)) {
              archive.file(iconFilePath, {
                name: `assets/icons/${filename}`,
              });
              logger.debug(`Added user icon to archive: ${filename}`);
            }
          }
        } else {
          // This might be a raster image path - check in different possible locations
          const possiblePaths = [
            path.join(process.cwd(), 'config', 'uploads', assetPath),
            path.join(process.cwd(), 'config', 'posters', assetPath),
            path.join(process.cwd(), assetPath),
          ];

          for (const possiblePath of possiblePaths) {
            if (fs.existsSync(possiblePath)) {
              const relativeName = `assets/images/${path.basename(assetPath)}`;
              archive.file(possiblePath, { name: relativeName });
              logger.debug(`Added raster image to archive: ${relativeName}`);
              break;
            }
          }
        }
      } catch (error) {
        logger.warn(`Failed to add asset to archive: ${assetPath}`, error);
      }
    }

    // Finalize the archive
    archive.finalize();

    logger.info('Exported template as ZIP with assets', {
      templateId: template.id,
      name: template.name,
      assetCount: assetPaths.size,
    });
  } catch (error) {
    logger.error('Failed to export template:', error);
    return next({
      status: 500,
      message: 'Failed to export template',
    });
  }
});

// Note: Template import functionality has been moved to /template-import endpoint
// (direct server route) due to middleware conflicts with multer file uploads

// GET /api/v1/posters/source-colors - Get default source colors
router.get('/source-colors', async (_req, res, next) => {
  try {
    const sourceTypes = getAvailableSourceTypes();
    const sourceColorsResponse = sourceTypes.reduce((acc, sourceType) => {
      acc[sourceType] = DEFAULT_SOURCE_COLORS[sourceType];
      return acc;
    }, {} as Record<string, (typeof DEFAULT_SOURCE_COLORS)[string]>);

    return res.status(200).json({
      sourceColors: sourceColorsResponse,
      sourceTypes,
    });
  } catch (error) {
    logger.error('Failed to fetch source colors:', error);
    return next({
      status: 500,
      message: 'Failed to fetch source colors',
    });
  }
});

export default router;
