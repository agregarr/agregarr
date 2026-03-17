import PlexAPI from '@server/api/plexapi';
import dataSource, { getRepository } from '@server/datasource';
import { Session } from '@server/entity/Session';
import { User } from '@server/entity/User';
import { startJobs } from '@server/job/schedule';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import routes from '@server/routes';
import plexWebhookRoute from '@server/routes/plex-webhook';
import { sanitizeErrorMessage } from '@server/utils/errorResponse';
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
import fs from 'fs';
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

    // Migrate overlay-application job schedule from midnight to 3am to prevent conflicts
    settings.migrateOverlayJobSchedule();

    // Migrate placeholder settings from global to per-library format
    settings.migratePlaceholderSettingsToPerLibrary();

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
      await initializePosterStorage();
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

    // Initialize fonts directory for custom fonts
    try {
      const fontsDir = path.join(process.cwd(), 'config', 'fonts');
      if (!fs.existsSync(fontsDir)) {
        fs.mkdirSync(fontsDir, { recursive: true });
        logger.info('Created fonts directory successfully');
      }
    } catch (error) {
      logger.error('Failed to initialize fonts directory:', error);
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
    // Plex webhook — must be before CSRF and OpenAPI validator (unauthenticated, multipart)
    server.use('/plex-webhook', plexWebhookRoute);

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
        // Exclude upload routes: the validator consumes multipart streams before
        // multer in the route handler can read them, causing "Unexpected end of form"
        ignorePaths: /\/uploads\//,
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

    // Serve custom fonts
    const customFontsPath = path.join(process.cwd(), 'config', 'fonts');
    server.use(
      '/custom-fonts',
      express.static(customFontsPath, {
        setHeaders: (res, path) => {
          if (path.endsWith('.ttf')) {
            res.setHeader('Content-Type', 'font/ttf');
          } else if (path.endsWith('.otf')) {
            res.setHeader('Content-Type', 'font/otf');
          }
          res.setHeader('Access-Control-Allow-Origin', '*');
        },
      })
    );

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
        // Log full error details internally
        logger.error('Unhandled API error', {
          label: 'Server',
          status: err.status,
          message: err.message,
          errors: err.errors,
          stack: err instanceof Error ? err.stack : undefined,
        });

        // Sanitize error response
        const safeMessage = sanitizeErrorMessage(
          err.message,
          'An unexpected error occurred'
        );

        let safeErrors: string[] | undefined;
        if (Array.isArray(err.errors)) {
          safeErrors = err.errors.map((e) =>
            sanitizeErrorMessage(e, 'Validation error')
          );
        } else if (typeof err.errors === 'string') {
          safeErrors = [sanitizeErrorMessage(err.errors, 'Validation error')];
        }

        res.status(err.status || 500).json({
          message: safeMessage,
          ...(safeErrors && safeErrors.length > 0 && { errors: safeErrors }),
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
