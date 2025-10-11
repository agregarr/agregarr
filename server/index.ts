import PlexAPI from '@server/api/plexapi';
import dataSource, { getRepository } from '@server/datasource';
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

    // Initialize icon storage directory
    try {
      const { initializeIconStorage } = await import('@server/lib/iconManager');
      await initializeIconStorage();
      logger.info('Icon storage initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize icon storage:', error);
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
