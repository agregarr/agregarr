import { getRepository } from '@server/datasource';
import type {
  ApplicationCondition,
  OverlayTemplateData,
  OverlayTemplateType,
} from '@server/entity/OverlayTemplate';
import { OverlayTemplate } from '@server/entity/OverlayTemplate';
import type { PosterTemplateData } from '@server/entity/PosterTemplate';
import { PosterTemplate } from '@server/entity/PosterTemplate';
import { initializeIconStorage, uploadIcon } from '@server/lib/iconManager';
import { savePosterFile } from '@server/lib/posterStorage';
import {
  sanitizeTemplateData,
  validateTemplateData,
} from '@server/lib/posterTemplates';
import {
  initializeThemeStorage,
  saveThemeFile,
} from '@server/lib/themeStorage';
import {
  initializeWallpaperStorage,
  saveWallpaperFile,
} from '@server/lib/wallpaperStorage';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import archiver from 'archiver';
import { randomUUID } from 'crypto';
import { Router } from 'express';
import fs from 'fs';
import multer from 'multer';
import StreamZip from 'node-stream-zip';
import os from 'os';
import path from 'path';

const router = Router();

router.use(isAuthenticated());

// --- Multer configurations ---

const imageMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const iconUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
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
}).single('icon');

const zipUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (
      file.mimetype === 'application/zip' ||
      file.originalname.endsWith('.zip')
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only ZIP files are allowed'));
    }
  },
}).single('file');

// --- POST /api/v1/uploads/poster ---

router.post('/poster', (req, res) => {
  imageMulter.single('poster')(req, res, async (err) => {
    if (err) {
      logger.error('Poster upload error:', err);
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
      const filename = await savePosterFile(
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname
      );
      return res
        .status(200)
        .json({ filename, url: `/poster-files/${filename}` });
    } catch (error) {
      logger.error('Error saving poster:', error);
      return res.status(400).json({
        error: error instanceof Error ? error.message : 'Save failed',
      });
    }
  });
});

// --- POST /api/v1/uploads/wallpaper ---

router.post('/wallpaper', (req, res) => {
  initializeWallpaperStorage();
  imageMulter.single('wallpaper')(req, res, async (err) => {
    if (err) {
      logger.error('Wallpaper upload error:', err);
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
      const filename = await saveWallpaperFile(
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname
      );
      return res
        .status(200)
        .json({ filename, url: `/wallpaper-files/${filename}` });
    } catch (error) {
      logger.error('Error saving wallpaper:', error);
      return res.status(400).json({
        error: error instanceof Error ? error.message : 'Save failed',
      });
    }
  });
});

// --- POST /api/v1/uploads/theme ---

router.post('/theme', (req, res) => {
  initializeThemeStorage();
  imageMulter.single('theme')(req, res, async (err) => {
    if (err) {
      logger.error('Theme upload error:', err);
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
      const filename = await saveThemeFile(
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname
      );
      return res
        .status(200)
        .json({ filename, url: `/theme-files/${filename}` });
    } catch (error) {
      logger.error('Error saving theme:', error);
      return res.status(400).json({
        error: error instanceof Error ? error.message : 'Save failed',
      });
    }
  });
});

// --- POST /api/v1/uploads/icon ---

router.post('/icon', (req, res) => {
  initializeIconStorage();
  iconUpload(req, res, async (err) => {
    if (err) {
      logger.error('Icon upload error:', err);
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
      const { name, category, description } = req.body as {
        name?: string;
        category?: string;
        description?: string;
      };
      const iconMetadata = await uploadIcon(
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname,
        { name, category, description }
      );
      return res.status(200).json({ icon: iconMetadata });
    } catch (error) {
      logger.error('Error saving icon:', error);
      return res.status(400).json({
        error: error instanceof Error ? error.message : 'Save failed',
      });
    }
  });
});

// --- POST /api/v1/uploads/poster-template ---

router.post('/poster-template', (req, res) => {
  zipUpload(req, res, async (uploadError) => {
    if (uploadError) {
      logger.error('Poster template import upload error:', uploadError);
      return res
        .status(400)
        .json({ error: 'File upload failed', details: uploadError.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'ZIP file is required' });
    }

    let templateData: PosterTemplateData;
    let name: string;
    let description: string;
    let version: string;
    const assetMapping = new Map<string, string>();

    const tempPath = path.join(
      os.tmpdir(),
      `agregarr-import-${Date.now()}-${Math.random()
        .toString(36)
        .substring(7)}.zip`
    );

    try {
      await fs.promises.writeFile(tempPath, req.file.buffer);
      const zip = new StreamZip.async({ file: tempPath });

      try {
        const templateJsonData = await zip.entryData('template.json');
        const templateJson = JSON.parse(templateJsonData.toString('utf8'));

        name = templateJson.name;
        description = templateJson.description;
        templateData = templateJson.templateData;
        version = templateJson.version;

        const entries = await zip.entries();
        for (const entryName of Object.keys(entries)) {
          if (entryName.startsWith('assets/')) {
            const entryData = await zip.entryData(entryName);

            if (entryName.startsWith('assets/icons/')) {
              const originalFilename = path.basename(entryName);
              const fileExtension = path
                .extname(originalFilename)
                .toLowerCase();
              const mimeTypeMap: Record<string, string> = {
                '.svg': 'image/svg+xml',
                '.png': 'image/png',
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.webp': 'image/webp',
              };
              const mimeType = mimeTypeMap[fileExtension] || 'image/png';

              const iconMetadata = await uploadIcon(
                entryData,
                mimeType,
                originalFilename,
                {
                  name: path.parse(originalFilename).name,
                  category: 'imported',
                  tags: ['imported'],
                  description: 'Imported with template',
                }
              );
              assetMapping.set(originalFilename, iconMetadata.id);
              logger.debug(
                `Imported icon: ${originalFilename} -> ${iconMetadata.id}`
              );
            } else if (entryName.startsWith('assets/images/')) {
              const originalFilename = path.basename(entryName);
              const newFilename = `${randomUUID()}_${originalFilename}`;
              const uploadsDir = path.join(process.cwd(), 'config', 'uploads');

              if (!fs.existsSync(uploadsDir)) {
                fs.mkdirSync(uploadsDir, { recursive: true });
              }

              await fs.promises.writeFile(
                path.join(uploadsDir, newFilename),
                entryData
              );
              assetMapping.set(originalFilename, newFilename);
              logger.debug(
                `Imported raster image: ${originalFilename} -> ${newFilename}`
              );
            }
          }
        }

        await zip.close();
      } catch (zipError) {
        logger.error('Failed to process ZIP file:', zipError);
        return res.status(400).json({
          error: 'Invalid ZIP file or missing template.json',
          details:
            zipError instanceof Error ? zipError.message : 'Unknown error',
        });
      } finally {
        if (fs.existsSync(tempPath)) {
          await fs.promises.unlink(tempPath);
        }
      }

      if (!name || !templateData) {
        return res
          .status(400)
          .json({ error: 'Template name and data are required' });
      }

      if (version && version !== '2.0') {
        return res.status(400).json({
          error: `Unsupported template version: ${version}. This version of Agregarr only supports version 2.0 (ZIP format).`,
        });
      }

      if (assetMapping.size > 0) {
        templateData.elements?.forEach((element) => {
          if (element.type === 'svg') {
            const svgProps = element.properties as { iconPath?: string };
            if (svgProps.iconPath) {
              const newPath = assetMapping.get(
                path.basename(svgProps.iconPath)
              );
              if (newPath) svgProps.iconPath = newPath;
            }
          } else if (element.type === 'raster') {
            const rasterProps = element.properties as { imagePath?: string };
            if (rasterProps.imagePath) {
              const newPath = assetMapping.get(
                path.basename(rasterProps.imagePath)
              );
              if (newPath) rasterProps.imagePath = newPath;
            }
          }
        });
      }

      const sanitizedData = sanitizeTemplateData(templateData);
      const validation = validateTemplateData(sanitizedData);

      if (!validation.isValid) {
        return res
          .status(400)
          .json({ error: 'Invalid template data', details: validation.errors });
      }

      const templateRepository = getRepository(PosterTemplate);

      let finalName = name;
      let counter = 1;
      while (
        await templateRepository.findOne({
          where: { name: finalName, isActive: true },
        })
      ) {
        finalName = `${name} (${counter})`;
        counter++;
      }

      const newTemplate = new PosterTemplate({
        name: finalName,
        description: description || 'Imported template',
        isDefault: false,
        isActive: true,
      });

      newTemplate.setTemplateData(sanitizedData);
      const savedTemplate = await templateRepository.save(newTemplate);

      logger.info('Imported poster template', {
        templateId: savedTemplate.id,
        originalName: name,
        finalName: savedTemplate.name,
        assetCount: assetMapping.size,
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
      logger.error('Failed to import poster template:', error);
      return res.status(500).json({
        error: 'Failed to import template',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
});

// --- GET /api/v1/uploads/overlay-template-export/:id ---

router.get('/overlay-template-export/:id', async (req, res) => {
  try {
    const templateId = parseInt(req.params.id);

    if (isNaN(templateId)) {
      return res.status(400).json({ error: 'Invalid template ID' });
    }

    const templateRepository = getRepository(OverlayTemplate);
    const template = await templateRepository.findOne({
      where: { id: templateId, isActive: true },
    });

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const templateData = template.getTemplateData();
    const assetPaths = new Set<string>();

    templateData.elements?.forEach((element) => {
      if (element.type === 'svg') {
        const svgProps = element.properties as { iconPath?: string };
        if (svgProps.iconPath) assetPaths.add(svgProps.iconPath);
      } else if (element.type === 'raster') {
        const rasterProps = element.properties as { imagePath?: string };
        if (rasterProps.imagePath) assetPaths.add(rasterProps.imagePath);
      }
    });

    const archive = archiver('zip', { zlib: { level: 9 } });
    const filename = `${template.name.replace(
      /[^a-zA-Z0-9]/g,
      '_'
    )}_overlay_template.zip`;

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });

    archive.on('error', (err) => {
      logger.error('Archive error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to create archive' });
      }
    });

    archive.pipe(res);

    const exportData = {
      name: template.name,
      description: template.description,
      type: template.type,
      templateData,
      applicationCondition: template.getApplicationCondition(),
      exportedAt: new Date().toISOString(),
      version: '1.0',
    };

    archive.append(JSON.stringify(exportData, null, 2), {
      name: 'template.json',
    });

    for (const assetPath of assetPaths) {
      try {
        const iconUrlMatch = assetPath.match(
          /\/api\/v1\/posters\/icons\/(\w+)\/(.+)/
        );

        if (iconUrlMatch) {
          const [, iconType, iconFilename] = iconUrlMatch;
          if (iconType === 'user') {
            const iconFilePath = path.join(
              process.cwd(),
              'config',
              'icons',
              iconFilename
            );
            if (fs.existsSync(iconFilePath)) {
              archive.file(iconFilePath, {
                name: `assets/icons/${iconFilename}`,
              });
              logger.debug(`Added user icon to archive: ${iconFilename}`);
            }
          }
        } else {
          const possiblePaths = [
            path.join(process.cwd(), 'config', 'uploads', assetPath),
            path.join(process.cwd(), 'config', 'posters', assetPath),
            path.join(process.cwd(), assetPath),
          ];

          for (const possiblePath of possiblePaths) {
            if (fs.existsSync(possiblePath)) {
              archive.file(possiblePath, {
                name: `assets/images/${path.basename(assetPath)}`,
              });
              logger.debug(
                `Added raster image to archive: assets/images/${path.basename(
                  assetPath
                )}`
              );
              break;
            }
          }
        }
      } catch (error) {
        logger.warn(`Failed to add asset to archive: ${assetPath}`, error);
      }
    }

    archive.finalize();

    logger.info('Exported overlay template as ZIP with assets', {
      templateId: template.id,
      name: template.name,
      assetCount: assetPaths.size,
    });
  } catch (error) {
    logger.error('Failed to export overlay template:', error);
    return res.status(500).json({
      error: 'Failed to export overlay template',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// --- POST /api/v1/uploads/overlay-template ---

router.post('/overlay-template', (req, res) => {
  zipUpload(req, res, async (uploadError) => {
    if (uploadError) {
      logger.error('Overlay template import upload error:', uploadError);
      return res
        .status(400)
        .json({ error: 'File upload failed', details: uploadError.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'ZIP file is required' });
    }

    let templateData: OverlayTemplateData;
    let name: string;
    let description: string;
    let type: OverlayTemplateType;
    let applicationCondition: ApplicationCondition | undefined;
    let version: string;
    const assetMapping = new Map<string, string>();

    const tempPath = path.join(
      os.tmpdir(),
      `agregarr-overlay-import-${Date.now()}-${Math.random()
        .toString(36)
        .substring(7)}.zip`
    );

    try {
      await fs.promises.writeFile(tempPath, req.file.buffer);
      const zip = new StreamZip.async({ file: tempPath });

      try {
        const templateJsonData = await zip.entryData('template.json');
        const templateJson = JSON.parse(templateJsonData.toString('utf8'));

        name = templateJson.name;
        description = templateJson.description;
        type = templateJson.type || 'generic';
        templateData = templateJson.templateData;
        applicationCondition = templateJson.applicationCondition;
        version = templateJson.version;

        const entries = await zip.entries();
        for (const entryName of Object.keys(entries)) {
          if (entryName.startsWith('assets/')) {
            const entryData = await zip.entryData(entryName);

            if (entryName.startsWith('assets/icons/')) {
              const originalFilename = path.basename(entryName);
              const fileExtension = path
                .extname(originalFilename)
                .toLowerCase();
              const mimeTypeMap: Record<string, string> = {
                '.svg': 'image/svg+xml',
                '.png': 'image/png',
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.webp': 'image/webp',
              };
              const mimeType = mimeTypeMap[fileExtension] || 'image/png';

              const iconMetadata = await uploadIcon(
                entryData,
                mimeType,
                originalFilename,
                {
                  name: path.parse(originalFilename).name,
                  category: 'imported',
                  tags: ['imported'],
                  description: 'Imported with overlay template',
                }
              );
              assetMapping.set(originalFilename, iconMetadata.id);
              logger.debug(
                `Imported icon: ${originalFilename} -> ${iconMetadata.id}`
              );
            } else if (entryName.startsWith('assets/images/')) {
              const originalFilename = path.basename(entryName);
              const newFilename = `${randomUUID()}_${originalFilename}`;
              const uploadsDir = path.join(process.cwd(), 'config', 'uploads');

              if (!fs.existsSync(uploadsDir)) {
                fs.mkdirSync(uploadsDir, { recursive: true });
              }

              await fs.promises.writeFile(
                path.join(uploadsDir, newFilename),
                entryData
              );
              assetMapping.set(originalFilename, newFilename);
              logger.debug(
                `Imported raster image: ${originalFilename} -> ${newFilename}`
              );
            }
          }
        }

        await zip.close();
      } catch (zipError) {
        logger.error('Failed to process ZIP file:', zipError);
        return res.status(400).json({
          error: 'Invalid ZIP file or missing template.json',
          details:
            zipError instanceof Error ? zipError.message : 'Unknown error',
        });
      } finally {
        if (fs.existsSync(tempPath)) {
          await fs.promises.unlink(tempPath);
        }
      }

      if (!name || !templateData) {
        return res
          .status(400)
          .json({ error: 'Template name and data are required' });
      }

      if (version && version !== '1.0') {
        return res.status(400).json({
          error: `Unsupported overlay template version: ${version}. This version of Agregarr only supports version 1.0.`,
        });
      }

      if (assetMapping.size > 0) {
        templateData.elements?.forEach((element) => {
          if (element.type === 'svg') {
            const svgProps = element.properties as { iconPath?: string };
            if (svgProps.iconPath) {
              const newPath = assetMapping.get(
                path.basename(svgProps.iconPath)
              );
              if (newPath) svgProps.iconPath = newPath;
            }
          } else if (element.type === 'raster') {
            const rasterProps = element.properties as { imagePath?: string };
            if (rasterProps.imagePath) {
              const newPath = assetMapping.get(
                path.basename(rasterProps.imagePath)
              );
              if (newPath) rasterProps.imagePath = newPath;
            }
          }
        });
      }

      const templateRepository = getRepository(OverlayTemplate);

      let finalName = name;
      let counter = 1;
      while (
        await templateRepository.findOne({
          where: { name: finalName, isActive: true },
        })
      ) {
        finalName = `${name} (${counter})`;
        counter++;
      }

      const newTemplate = new OverlayTemplate({
        name: finalName,
        description: description || 'Imported overlay template',
        type,
        isDefault: false,
        isActive: true,
      });

      newTemplate.setTemplateData(templateData);
      newTemplate.setApplicationCondition(applicationCondition);

      const savedTemplate = await templateRepository.save(newTemplate);

      logger.info('Imported overlay template', {
        templateId: savedTemplate.id,
        originalName: name,
        finalName: savedTemplate.name,
        assetCount: assetMapping.size,
      });

      return res.status(201).json({
        id: savedTemplate.id,
        name: savedTemplate.name,
        description: savedTemplate.description,
        type: savedTemplate.type,
        isDefault: savedTemplate.isDefault,
        templateData: savedTemplate.getTemplateData(),
        applicationCondition: savedTemplate.getApplicationCondition(),
        createdAt: savedTemplate.createdAt,
        updatedAt: savedTemplate.updatedAt,
      });
    } catch (error) {
      logger.error('Failed to import overlay template:', error);
      return res.status(500).json({
        error: 'Failed to import overlay template',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
});

export default router;
