import PlexAPI from '@server/api/plexapi';
import dataSource, { getRepository } from '@server/datasource';
import type {
  ApplicationCondition,
  OverlayTemplateData,
  OverlayTemplateType,
} from '@server/entity/OverlayTemplate';
import type { PosterTemplateData } from '@server/entity/PosterTemplate';
import { Session } from '@server/entity/Session';
import { User } from '@server/entity/User';
import { startJobs } from '@server/job/schedule';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import routes from '@server/routes';
import restartFlag from '@server/utils/restartFlag';
// imageproxy removed - not needed for collections-only app
import { getAppVersion } from '@server/utils/appVersion';
import { getClientIp } from '@supercharge/request-ip';
import { TypeormStore } from 'connect-typeorm/out';
import cookieParser from 'cookie-parser';
import csurf from 'csurf';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import * as OpenApiValidator from 'express-openapi-validator';
import type { Store } from 'express-session';
import session from 'express-session';
import next from 'next';
import path from 'path';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';

const API_SPEC_PATH = path.join(__dirname, '../agregarr-api.yml');

logger.info(`Starting Agregarr version ${getAppVersion()}`);
const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(async () => {
    const dbConnection = await dataSource.initialize();

    // Run migrations in production
    if (process.env.NODE_ENV === 'production') {
      await dbConnection.query('PRAGMA foreign_keys=OFF');
      await dbConnection.runMigrations();
      await dbConnection.query('PRAGMA foreign_keys=ON');
    }

    // Load Settings
    const settings = getSettings().load();

    // Initialize RestartFlag with current settings
    restartFlag.initializeSettings(settings.main);

    // Initialize sync status for existing collections (one-time migration)
    settings.initializeSyncStatusForExistingCollections();

    // Complete collection data normalization migration for v1.1.0
    // Replaces 4 incomplete migrations with comprehensive field normalization
    settings.migrateCollectionDataNormalizationV110();

    // Migrate comingsoon/recently_added to standalone recently_added type
    settings.migrateComingSoonRecentlyAddedToStandalone();

    // Migrate recently_added to filtered_hub type
    settings.migrateRecentlyAddedToFilteredHub();

    // Migrate old filter format to unified filterSettings with include/exclude modes
    settings.migrateToUnifiedFilterSettings();

    // Migrate legacy sort order (reverseOrder/randomizeOrder) to sortOrder enum
    settings.migrateSortOrderToEnum();

    // Migrate poster templates to unified layering system for v1.3.2
    await settings.migratePosterTemplatesV132();

    // Seed default source colors and poster template (one-time setup)
    try {
      const { seedSourceColors } = await import(
        '@server/scripts/seedSourceColors'
      );
      const { seedDefaultTemplate } = await import(
        '@server/scripts/seedDefaultTemplate'
      );

      await seedSourceColors();
      await seedDefaultTemplate();
    } catch (error) {
      logger.error('Failed to seed default data:', error);
    }

    // Seed preset overlay templates (one-time setup)
    try {
      const { presetTemplateService } = await import(
        '@server/lib/overlays/PresetTemplates'
      );

      await presetTemplateService.createPresetTemplates();
    } catch (error) {
      logger.error('Failed to seed preset overlay templates:', error);
    }

    // Initialize IndividualCollectionScheduler for custom sync schedules
    try {
      const { IndividualCollectionScheduler } = await import(
        '@server/lib/collections/services/IndividualCollectionScheduler'
      );
      await IndividualCollectionScheduler.initialize();
    } catch (error) {
      logger.error(
        'Failed to initialize IndividualCollectionScheduler:',
        error
      );
    }

    // Initialize poster storage directory
    try {
      const { initializePosterStorage } = await import(
        '@server/lib/posterStorage'
      );
      initializePosterStorage();
      logger.info('Poster storage initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize poster storage:', error);
    }

    // Initialize wallpaper storage directory
    try {
      const { initializeWallpaperStorage } = await import(
        '@server/lib/wallpaperStorage'
      );
      initializeWallpaperStorage();
      logger.info('Wallpaper storage initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize wallpaper storage:', error);
    }

    // Initialize theme storage directory
    try {
      const { initializeThemeStorage } = await import(
        '@server/lib/themeStorage'
      );
      initializeThemeStorage();
      logger.info('Theme storage initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize theme storage:', error);
    }

    // Initialize icon storage directory
    try {
      const { initializeIconStorage } = await import('@server/lib/iconManager');
      await initializeIconStorage();
      logger.info('Icon storage initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize icon storage:', error);
    }

    // Initialize base poster storage directory
    try {
      const { plexBasePosterManager } = await import(
        '@server/lib/overlays/PlexBasePosterManager'
      );
      await plexBasePosterManager.initialize();
      logger.info('Base poster storage initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize base poster storage:', error);
    }

    // Initialize RandomListManager for multi-source collections
    try {
      const { RandomListManager } = await import(
        '@server/lib/collections/utils/RandomListManager'
      );
      const configDir =
        process.env.CONFIG_DIRECTORY || path.join(__dirname, '../config');
      RandomListManager.initialize(configDir);
      logger.info('RandomListManager initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize RandomListManager:', error);
    }

    // Migrate library types
    if (
      settings.plex.libraries.length > 1 &&
      !settings.plex.libraries[0].type
    ) {
      const userRepository = getRepository(User);
      const admin = await userRepository.findOne({
        select: { id: true, plexToken: true },
        where: { id: 1 },
      });

      if (admin) {
        logger.info('Migrating Plex libraries to include media type', {
          label: 'Settings',
        });

        const plexapi = new PlexAPI({ plexToken: admin.plexToken });
        await plexapi.syncLibraries();
      }
    }

    // Start Jobs
    startJobs();

    const server = express();
    if (settings.main.trustProxy) {
      server.enable('trust proxy');
    }
    server.use(cookieParser());
    server.use(express.json({ limit: '10mb' }));
    server.use(express.urlencoded({ extended: true }));
    server.use((req, _res, next) => {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(req, 'ip');
        if (descriptor?.writable === true) {
          req.ip = getClientIp(req) ?? '';
        }
      } catch (e) {
        logger.error('Failed to attach the ip to the request', {
          label: 'Middleware',
          message: e.message,
        });
      } finally {
        next();
      }
    });
    if (settings.main.csrfProtection) {
      server.use(
        csurf({
          cookie: {
            httpOnly: true,
            sameSite: true,
            secure: !dev,
          },
        })
      );
      server.use((req, res, next) => {
        res.cookie('AGREGARR-XSRF-TOKEN', req.csrfToken(), {
          sameSite: true,
          secure: !dev,
        });
        next();
      });
    }

    // Set up sessions
    const sessionRespository = getRepository(Session);
    server.use(
      '/api',
      session({
        name: 'agregarr.sid', // Unique cookie name to prevent conflicts with Overseerr
        secret: settings.clientId,
        resave: false,
        saveUninitialized: false,
        cookie: {
          maxAge: 1000 * 60 * 60 * 24 * 30,
          httpOnly: true,
          sameSite: settings.main.csrfProtection ? 'strict' : 'lax',
          secure: 'auto',
        },
        store: new TypeormStore({
          cleanupLimit: 2,
          ttl: 60 * 60 * 24 * 30,
        }).connect(sessionRespository) as Store,
      })
    );
    const apiDocs = YAML.load(API_SPEC_PATH);
    server.use('/api-docs', swaggerUi.serve, swaggerUi.setup(apiDocs));
    server.use(
      OpenApiValidator.middleware({
        apiSpec: API_SPEC_PATH,
        validateRequests: true, // Re-enabled after fixing schema
      })
    );
    /**
     * This is a workaround to convert dates to strings before they are validated by
     * OpenAPI validator. Otherwise, they are treated as objects instead of strings
     * and response validation will fail
     */
    server.use((_req, res, next) => {
      const original = res.json;
      res.json = function jsonp(json) {
        return original.call(this, JSON.parse(JSON.stringify(json)));
      };
      next();
    });

    // Direct static file serving for posters
    server.use(
      '/poster-files',
      express.static(path.join(process.cwd(), 'config', 'posters'), {
        maxAge: '1y', // Cache for 1 year since filenames are UUIDs
        setHeaders: (res, filePath) => {
          // Set appropriate content type based on file extension
          const ext = path.extname(filePath).toLowerCase();
          if (ext === '.jpg' || ext === '.jpeg') {
            res.setHeader('Content-Type', 'image/jpeg');
          } else if (ext === '.png') {
            res.setHeader('Content-Type', 'image/png');
          } else if (ext === '.webp') {
            res.setHeader('Content-Type', 'image/webp');
          }
        },
      })
    );

    // Direct static file serving for wallpapers
    server.use(
      '/wallpaper-files',
      express.static(path.join(process.cwd(), 'config', 'wallpapers'), {
        maxAge: '1y', // Cache for 1 year since filenames are UUIDs
        setHeaders: (res, filePath) => {
          // Set appropriate content type based on file extension
          const ext = path.extname(filePath).toLowerCase();
          if (ext === '.jpg' || ext === '.jpeg') {
            res.setHeader('Content-Type', 'image/jpeg');
          } else if (ext === '.png') {
            res.setHeader('Content-Type', 'image/png');
          } else if (ext === '.webp') {
            res.setHeader('Content-Type', 'image/webp');
          }
        },
      })
    );

    // Direct static file serving for theme music
    server.use(
      '/theme-files',
      express.static(path.join(process.cwd(), 'config', 'themes'), {
        maxAge: '1y', // Cache for 1 year since filenames are UUIDs
        setHeaders: (res, filePath) => {
          // Set appropriate content type based on file extension
          const ext = path.extname(filePath).toLowerCase();
          if (ext === '.mp3') {
            res.setHeader('Content-Type', 'audio/mpeg');
          } else if (ext === '.wav') {
            res.setHeader('Content-Type', 'audio/wav');
          } else if (ext === '.flac') {
            res.setHeader('Content-Type', 'audio/flac');
          } else if (ext === '.ogg') {
            res.setHeader('Content-Type', 'audio/ogg');
          } else if (ext === '.aac') {
            res.setHeader('Content-Type', 'audio/aac');
          } else if (ext === '.m4a') {
            res.setHeader('Content-Type', 'audio/x-m4a');
          }
        },
      })
    );

    // Simple poster upload endpoint (bypasses complex API routing)
    server.post('/upload-poster', async (req, res) => {
      try {
        const multer = (await import('multer')).default;
        const { savePosterFile, initializePosterStorage } = await import(
          '@server/lib/posterStorage'
        );

        // Initialize storage
        initializePosterStorage();

        // Simple multer config
        const upload = multer({
          storage: multer.memoryStorage(),
          limits: { fileSize: 10 * 1024 * 1024 },
        }).single('poster');

        upload(req, res, async (err) => {
          if (err) {
            logger.error('Simple poster upload error:', err);
            return res
              .status(400)
              .json({ error: err.message || 'Upload failed' });
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
      } catch (error) {
        logger.error('Poster upload endpoint error:', error);
        return res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Simple wallpaper upload endpoint (bypasses complex API routing)
    server.post('/upload-wallpaper', async (req, res) => {
      try {
        const multer = (await import('multer')).default;
        const { saveWallpaperFile, initializeWallpaperStorage } = await import(
          '@server/lib/wallpaperStorage'
        );

        // Initialize storage
        initializeWallpaperStorage();

        // Simple multer config
        const upload = multer({
          storage: multer.memoryStorage(),
          limits: { fileSize: 10 * 1024 * 1024 },
        }).single('wallpaper');

        upload(req, res, async (err) => {
          if (err) {
            logger.error('Simple wallpaper upload error:', err);
            return res
              .status(400)
              .json({ error: err.message || 'Upload failed' });
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
      } catch (error) {
        logger.error('Wallpaper upload endpoint error:', error);
        return res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Simple theme upload endpoint (bypasses complex API routing)
    server.post('/upload-theme', async (req, res) => {
      try {
        const multer = (await import('multer')).default;
        const { saveThemeFile, initializeThemeStorage } = await import(
          '@server/lib/themeStorage'
        );

        // Initialize storage
        initializeThemeStorage();

        // Simple multer config
        const upload = multer({
          storage: multer.memoryStorage(),
          limits: { fileSize: 10 * 1024 * 1024 },
        }).single('theme');

        upload(req, res, async (err) => {
          if (err) {
            logger.error('Simple theme upload error:', err);
            return res
              .status(400)
              .json({ error: err.message || 'Upload failed' });
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
      } catch (error) {
        logger.error('Theme upload endpoint error:', error);
        return res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Serve fonts as web fonts
    server.use(
      '/fonts',
      express.static('/usr/share/fonts', {
        setHeaders: (res, path) => {
          if (path.endsWith('.ttf')) {
            res.setHeader('Content-Type', 'font/ttf');
          } else if (path.endsWith('.otf')) {
            res.setHeader('Content-Type', 'font/otf');
          } else if (path.endsWith('.woff')) {
            res.setHeader('Content-Type', 'font/woff');
          } else if (path.endsWith('.woff2')) {
            res.setHeader('Content-Type', 'font/woff2');
          }
          res.setHeader('Access-Control-Allow-Origin', '*');
        },
      })
    );

    server.post('/upload-icon', async (req, res) => {
      try {
        const multer = (await import('multer')).default;
        const { uploadIcon, initializeIconStorage } = await import(
          '@server/lib/iconManager'
        );

        // Initialize storage
        initializeIconStorage();

        // Simple multer config
        const upload = multer({
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

        upload(req, res, async (err) => {
          if (err) {
            logger.error('Simple icon upload error:', err);
            return res
              .status(400)
              .json({ error: err.message || 'Upload failed' });
          }

          if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
          }

          try {
            const { name, category, description } = req.body;
            const iconMetadata = await uploadIcon(
              req.file.buffer,
              req.file.mimetype,
              req.file.originalname,
              {
                name,
                category,
                description,
              }
            );

            return res.status(200).json({ icon: iconMetadata });
          } catch (error) {
            logger.error('Error saving icon:', error);
            return res.status(400).json({
              error: error instanceof Error ? error.message : 'Save failed',
            });
          }
        });
      } catch (error) {
        logger.error('Icon upload endpoint error:', error);
        return res.status(500).json({ error: 'Internal server error' });
      }
    });

    server.post('/template-import', async (req, res) => {
      try {
        const multer = (await import('multer')).default;

        const upload = multer({
          storage: multer.memoryStorage(),
          limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
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

        upload(req, res, async (uploadError) => {
          if (uploadError) {
            logger.error('Template import upload error:', uploadError);
            return res.status(400).json({
              error: 'File upload failed',
              details: uploadError.message,
            });
          }

          if (!req.file) {
            return res.status(400).json({
              error: 'ZIP file is required',
            });
          }

          try {
            const { getRepository } = await import('@server/datasource');
            const { PosterTemplate } = await import(
              '@server/entity/PosterTemplate'
            );
            const { sanitizeTemplateData, validateTemplateData } = await import(
              '@server/lib/posterTemplates'
            );
            const fs = await import('fs');
            const path = await import('path');

            let templateData: PosterTemplateData;
            let name: string;
            let description: string;
            let version: string;
            const assetMapping = new Map<string, string>();

            const StreamZip = (await import('node-stream-zip')).default;
            const os = await import('os');

            // Write buffer to temporary file
            const tempPath = path.join(
              os.tmpdir(),
              `agregarr-import-${Date.now()}-${Math.random()
                .toString(36)
                .substring(7)}.zip`
            );
            await fs.promises.writeFile(tempPath, req.file.buffer);
            const zip = new StreamZip.async({ file: tempPath });

            try {
              const templateJsonData = await zip.entryData('template.json');
              const templateJson = JSON.parse(
                templateJsonData.toString('utf8')
              );

              name = templateJson.name;
              description = templateJson.description;
              templateData = templateJson.templateData;
              version = templateJson.version;

              // Extract and save asset files
              const entries = await zip.entries();
              for (const entryName of Object.keys(entries)) {
                if (entryName.startsWith('assets/')) {
                  const entryData = await zip.entryData(entryName);

                  if (entryName.startsWith('assets/icons/')) {
                    const { uploadIcon } = await import(
                      '@server/lib/iconManager'
                    );
                    const originalFilename = path.basename(entryName);
                    const fileExtension = path
                      .extname(originalFilename)
                      .toLowerCase();

                    // Determine MIME type
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

                    // Map old filename to new icon ID
                    assetMapping.set(originalFilename, iconMetadata.id);
                    logger.debug(
                      `Imported icon: ${originalFilename} -> ${iconMetadata.id}`
                    );
                  } else if (entryName.startsWith('assets/images/')) {
                    // Import raster image - save to uploads directory
                    const originalFilename = path.basename(entryName);
                    const { randomUUID } = await import('crypto');
                    const newFilename = `${randomUUID()}_${originalFilename}`;
                    const uploadsDir = path.join(
                      process.cwd(),
                      'config',
                      'uploads'
                    );

                    // Ensure uploads directory exists
                    if (!fs.existsSync(uploadsDir)) {
                      fs.mkdirSync(uploadsDir, { recursive: true });
                    }

                    const newFilePath = path.join(uploadsDir, newFilename);
                    await fs.promises.writeFile(newFilePath, entryData);

                    // Map old filename to new filename
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
                  zipError instanceof Error
                    ? zipError.message
                    : 'Unknown error',
              });
            } finally {
              // Clean up temporary file
              if (fs.existsSync(tempPath)) {
                await fs.promises.unlink(tempPath);
              }
            }

            if (!name || !templateData) {
              return res.status(400).json({
                error: 'Template name and data are required',
              });
            }

            // Validate version compatibility
            if (version && version !== '2.0') {
              return res.status(400).json({
                error: `Unsupported template version: ${version}. This version of Agregarr only supports version 2.0 (ZIP format).`,
              });
            }

            // Update asset paths in template data to use new imported asset IDs/paths
            if (assetMapping.size > 0) {
              // Update unified elements
              templateData.elements?.forEach((element) => {
                if (element.type === 'svg') {
                  const svgProps = element.properties as { iconPath?: string };
                  if (svgProps.iconPath) {
                    const filename = path.basename(svgProps.iconPath);
                    const newPath = assetMapping.get(filename);
                    if (newPath) {
                      svgProps.iconPath = newPath;
                    }
                  }
                } else if (element.type === 'raster') {
                  const rasterProps = element.properties as {
                    imagePath?: string;
                  };
                  if (rasterProps.imagePath) {
                    const filename = path.basename(rasterProps.imagePath);
                    const newPath = assetMapping.get(filename);
                    if (newPath) {
                      rasterProps.imagePath = newPath;
                    }
                  }
                }
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

            // Check for duplicate names and append suffix if needed
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
            logger.error('Failed to import template:', error);
            return res.status(500).json({
              error: 'Failed to import template',
              message: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        });
      } catch (error) {
        logger.error('Template import setup error:', error);
        return res.status(500).json({
          error: 'Failed to setup upload',
        });
      }
    });

    server.get('/overlay-template-export/:id', async (req, res) => {
      try {
        const templateId = parseInt(req.params.id);

        if (isNaN(templateId)) {
          return res.status(400).json({
            error: 'Invalid template ID',
          });
        }

        const { getRepository } = await import('@server/datasource');
        const { OverlayTemplate } = await import(
          '@server/entity/OverlayTemplate'
        );
        const fs = await import('fs');
        const path = await import('path');

        const templateRepository = getRepository(OverlayTemplate);
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

        // Check elements for custom assets
        templateData.elements?.forEach((element) => {
          if (element.type === 'svg') {
            const svgProps = element.properties as {
              iconPath?: string;
            };
            if (svgProps.iconPath) {
              assetPaths.add(svgProps.iconPath);
            }
          } else if (element.type === 'raster') {
            const rasterProps = element.properties as {
              imagePath?: string;
            };
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
        )}_overlay_template.zip`;
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
          type: template.type,
          templateData: templateData,
          applicationCondition: template.getApplicationCondition(),
          exportedAt: new Date().toISOString(),
          version: '1.0',
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
                  const relativeName = `assets/images/${path.basename(
                    assetPath
                  )}`;
                  archive.file(possiblePath, { name: relativeName });
                  logger.debug(
                    `Added raster image to archive: ${relativeName}`
                  );
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

    server.post('/overlay-template-import', async (req, res) => {
      try {
        const multer = (await import('multer')).default;

        const upload = multer({
          storage: multer.memoryStorage(),
          limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
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

        upload(req, res, async (uploadError) => {
          if (uploadError) {
            logger.error('Overlay template import upload error:', uploadError);
            return res.status(400).json({
              error: 'File upload failed',
              details: uploadError.message,
            });
          }

          if (!req.file) {
            return res.status(400).json({
              error: 'ZIP file is required',
            });
          }

          try {
            const { getRepository } = await import('@server/datasource');
            const { OverlayTemplate } = await import(
              '@server/entity/OverlayTemplate'
            );
            const fs = await import('fs');
            const path = await import('path');

            let templateData: OverlayTemplateData;
            let name: string;
            let description: string;
            let type: OverlayTemplateType;
            let applicationCondition: ApplicationCondition | undefined;
            let version: string;
            const assetMapping = new Map<string, string>();

            const StreamZip = (await import('node-stream-zip')).default;
            const os = await import('os');

            // Write buffer to temporary file
            const tempPath = path.join(
              os.tmpdir(),
              `agregarr-overlay-import-${Date.now()}-${Math.random()
                .toString(36)
                .substring(7)}.zip`
            );
            await fs.promises.writeFile(tempPath, req.file.buffer);
            const zip = new StreamZip.async({ file: tempPath });

            try {
              const templateJsonData = await zip.entryData('template.json');
              const templateJson = JSON.parse(
                templateJsonData.toString('utf8')
              );

              name = templateJson.name;
              description = templateJson.description;
              type = templateJson.type || 'generic';
              templateData = templateJson.templateData;
              applicationCondition = templateJson.applicationCondition;
              version = templateJson.version;

              // Extract and save asset files
              const entries = await zip.entries();
              for (const entryName of Object.keys(entries)) {
                if (entryName.startsWith('assets/')) {
                  const entryData = await zip.entryData(entryName);

                  if (entryName.startsWith('assets/icons/')) {
                    const { uploadIcon } = await import(
                      '@server/lib/iconManager'
                    );
                    const originalFilename = path.basename(entryName);
                    const fileExtension = path
                      .extname(originalFilename)
                      .toLowerCase();

                    // Determine MIME type
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

                    // Map old filename to new icon ID
                    assetMapping.set(originalFilename, iconMetadata.id);
                    logger.debug(
                      `Imported icon: ${originalFilename} -> ${iconMetadata.id}`
                    );
                  } else if (entryName.startsWith('assets/images/')) {
                    // Import raster image - save to uploads directory
                    const originalFilename = path.basename(entryName);
                    const { randomUUID } = await import('crypto');
                    const newFilename = `${randomUUID()}_${originalFilename}`;
                    const uploadsDir = path.join(
                      process.cwd(),
                      'config',
                      'uploads'
                    );

                    // Ensure uploads directory exists
                    if (!fs.existsSync(uploadsDir)) {
                      fs.mkdirSync(uploadsDir, { recursive: true });
                    }

                    const newFilePath = path.join(uploadsDir, newFilename);
                    await fs.promises.writeFile(newFilePath, entryData);

                    // Map old filename to new filename
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
                  zipError instanceof Error
                    ? zipError.message
                    : 'Unknown error',
              });
            } finally {
              // Clean up temporary file
              if (fs.existsSync(tempPath)) {
                await fs.promises.unlink(tempPath);
              }
            }

            if (!name || !templateData) {
              return res.status(400).json({
                error: 'Template name and data are required',
              });
            }

            // Validate version compatibility
            if (version && version !== '1.0') {
              return res.status(400).json({
                error: `Unsupported overlay template version: ${version}. This version of Agregarr only supports version 1.0.`,
              });
            }

            // Update asset paths in template data to use new imported asset IDs/paths
            if (assetMapping.size > 0) {
              // Update elements
              templateData.elements?.forEach((element) => {
                if (element.type === 'svg') {
                  const svgProps = element.properties as {
                    iconPath?: string;
                  };
                  if (svgProps.iconPath) {
                    const filename = path.basename(svgProps.iconPath);
                    const newPath = assetMapping.get(filename);
                    if (newPath) {
                      svgProps.iconPath = newPath;
                    }
                  }
                } else if (element.type === 'raster') {
                  const rasterProps = element.properties as {
                    imagePath?: string;
                  };
                  if (rasterProps.imagePath) {
                    const filename = path.basename(rasterProps.imagePath);
                    const newPath = assetMapping.get(filename);
                    if (newPath) {
                      rasterProps.imagePath = newPath;
                    }
                  }
                }
              });
            }

            const templateRepository = getRepository(OverlayTemplate);

            // Check for duplicate names and append suffix if needed
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
              type: type,
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
      } catch (error) {
        logger.error('Overlay template import setup error:', error);
        return res.status(500).json({
          error: 'Failed to setup upload',
        });
      }
    });

    server.use('/api/v1', routes);

    // Do not set cookies so CDNs can cache them
    // imageproxy removed - not needed for collections-only app

    server.get('*', (req, res) => handle(req, res));
    server.use(
      (
        err: { status: number; message: string; errors: string[] },
        _req: Request,
        res: Response,
        // We must provide a next function for the function signature here even though its not used
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _next: NextFunction
      ) => {
        // format error
        res.status(err.status || 500).json({
          message: err.message,
          errors: err.errors,
        });
      }
    );

    const port = Number(process.env.PORT) || 7171;
    const host = process.env.HOST;
    if (host) {
      server.listen(port, host, () => {
        logger.info(`Server ready on ${host} port ${port}`, {
          label: 'Server',
        });
      });
    } else {
      server.listen(port, () => {
        logger.info(`Server ready on port ${port}`, {
          label: 'Server',
        });
      });
    }
  })
  .catch((err) => {
    logger.error(err.stack);
    process.exit(1);
  });
