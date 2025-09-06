import PlexAPI from '@server/api/plexapi';
import dataSource, { getRepository } from '@server/datasource';
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
    server.use(express.json());
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
