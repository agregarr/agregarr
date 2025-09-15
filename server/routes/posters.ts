import { getRepository } from '@server/datasource';
import { PosterTemplate } from '@server/entity/PosterTemplate';
import { SavedPoster } from '@server/entity/SavedPoster';
import {
  deleteIcon,
  downloadIcon,
  getIconCategories,
  getIcons,
  loadIconFile,
  uploadIcon,
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
import multer from 'multer';

const router = Router();

// Configure multer for icon/image uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (_req, file, cb) => {
    const allowedMimeTypes = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/svg+xml',
    ];
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          'Invalid file type. Only JPEG, PNG, WebP, and SVG files are allowed.'
        )
      );
    }
  },
});

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

    const templatesResponse = templates.map((template: PosterTemplate) => ({
      id: template.id,
      name: template.name,
      description: template.description,
      isDefault: template.isDefault,
      templateData: template.getTemplateData(),
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    }));

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
        return {
          id: dbPoster.id,
          name: dbPoster.name,
          description: dbPoster.description,
          filename: dbPoster.filename,
          thumbnailFilename: dbPoster.thumbnailFilename,
          posterData: dbPoster.getPosterData(),
          createdAt: dbPoster.createdAt,
          updatedAt: dbPoster.updatedAt,
          isEditable: true, // Can be edited in poster editor
        };
      } else {
        // This is a legacy/uploaded file without database entry
        return {
          id: `file-${filename}`, // Use filename-based ID for legacy files
          name: filename.replace(/\.(jpg|jpeg|png|webp)$/i, ''), // Filename without extension
          description: 'Uploaded poster file',
          filename,
          thumbnailFilename: undefined,
          posterData: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
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

// DELETE /api/v1/posters/saved/:id - Delete saved poster
router.delete('/saved/:id', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
      });
    }

    const posterId = parseInt(req.params.id);

    const posterRepository = getRepository(SavedPoster);
    const poster = await posterRepository.findOne({
      where: { id: posterId, isActive: true },
    });

    if (!poster) {
      return res.status(404).json({
        error: 'Poster not found',
      });
    }

    // Soft delete
    poster.isActive = false;
    await posterRepository.save(poster);

    // TODO: Also clean up associated files (filename, thumbnailFilename)
    // This will be handled in Phase 3 when we set up file management

    logger.info('Deleted saved poster', {
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
        'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
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

// POST /api/v1/posters/icons/upload - Upload icon/asset
router.post('/icons/upload', upload.single('icon'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'No file uploaded',
      });
    }

    const { name, category, tags, description } = req.body;

    try {
      const iconMetadata = await uploadIcon(
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname,
        {
          name,
          category,
          tags: tags
            ? tags.split(',').map((tag: string) => tag.trim())
            : undefined,
          description,
        }
      );

      logger.info('Icon uploaded successfully', {
        iconId: iconMetadata.id,
        name: iconMetadata.name,
        userId: req.user?.id,
      });

      return res.status(201).json({
        icon: iconMetadata,
      });
    } catch (uploadError) {
      logger.error('Failed to upload icon:', uploadError);
      return res.status(400).json({
        error:
          uploadError instanceof Error
            ? uploadError.message
            : 'Failed to upload icon',
      });
    }
  } catch (error) {
    logger.error('Icon upload endpoint error:', error);
    return next({
      status: 500,
      message: 'Failed to upload icon',
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
