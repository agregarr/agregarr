import PlexAPI from '@server/api/plexapi';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import type { PlexCollection } from '@server/lib/collections/core/types';
import { libraryCacheService } from '@server/lib/collections/services/LibraryCacheService';
import { PreExistingCollectionConfigService } from '@server/lib/collections/services/PreExistingCollectionConfigService';
import { OriginalsCollectionSync } from '@server/lib/collections/sources/originals';
import { templateEngine } from '@server/lib/collections/utils/TemplateEngine';
import { TimeRestrictionUtils } from '@server/lib/collections/utils/TimeRestrictionUtils';
import collectionsSync from '@server/lib/collectionsSync';
import type {
  CollectionConfig,
  MultiSourceCombineMode,
  MultiSourceType,
} from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';
import multer from 'multer';

// Plex label can be either a string or an object with a tag property
type PlexLabel = string | { tag: string };

// Extract label text safely
function getLabelText(label: PlexLabel): string {
  return typeof label === 'string'
    ? label
    : typeof label === 'object' && label && 'tag' in label
    ? label.tag
    : '';
}

/**
 * Simple in-memory rate limiter for external URL fetching
 */
class RateLimiter {
  private requests: Map<string, number[]> = new Map();
  private readonly maxRequests = 10; // Max requests per window
  private readonly windowMs = 60000; // 1 minute window

  isAllowed(identifier: string): boolean {
    const now = Date.now();
    const requests = this.requests.get(identifier) || [];

    // Remove requests outside the window
    const validRequests = requests.filter((time) => now - time < this.windowMs);

    if (validRequests.length >= this.maxRequests) {
      return false;
    }

    // Add current request
    validRequests.push(now);
    this.requests.set(identifier, validRequests);

    return true;
  }
}

export const rateLimiter = new RateLimiter();

/**
 * Validate and sanitize external URLs for security
 */
export function validateExternalUrl(
  url: string,
  type: string
): { isValid: boolean; error?: string; sanitizedUrl?: string } {
  try {
    const urlObj = new URL(url);

    // Only allow HTTPS URLs for security
    if (urlObj.protocol !== 'https:') {
      return { isValid: false, error: 'Only HTTPS URLs are allowed' };
    }

    // Validate allowed domains based on collection type
    const allowedDomains = {
      trakt: ['trakt.tv', 'app.trakt.tv'],
      tmdb: ['www.themoviedb.org', 'themoviedb.org'],
      imdb: ['www.imdb.com', 'imdb.com'],
      mdblist: ['mdblist.com', 'www.mdblist.com'],
      letterboxd: ['letterboxd.com', 'www.letterboxd.com'],
      anilist: ['anilist.co', 'www.anilist.co'],
    };

    const validDomains = allowedDomains[type as keyof typeof allowedDomains];
    if (!validDomains || !validDomains.includes(urlObj.hostname)) {
      return {
        isValid: false,
        error: `Invalid domain for ${type} collection. Allowed domains: ${validDomains?.join(
          ', '
        )}`,
      };
    }

    // Validate URL patterns for each service
    switch (type) {
      case 'trakt':
        if (
          !urlObj.pathname.match(/^\/users\/[^/]+\/lists\/[^/?]+\/?$/) &&
          !urlObj.pathname.match(/^\/lists\/official\/[^/?]+\/?$/)
        ) {
          return {
            isValid: false,
            error:
              'Invalid Trakt list URL format. Expected: https://trakt.tv/users/username/lists/listname or https://app.trakt.tv/users/username/lists/listname',
          };
        }
        break;
      case 'tmdb':
        if (
          !urlObj.pathname.match(
            /^\/(collection\/\d+|list\/\d+|network\/\d+|company\/\d+(?:-[^/]+)?\/(?:movie|tv))/
          )
        ) {
          return {
            isValid: false,
            error:
              'Invalid TMDB URL format. Expected: collection, list, network, or company URL (e.g., https://www.themoviedb.org/collection/123456, /list/310, /network/213, or /company/7505/movie)',
          };
        }
        break;
      case 'imdb':
        if (
          !urlObj.pathname.match(/^\/list\/ls\d+\/?$/) &&
          !urlObj.pathname.match(/^\/user\/ur\d+\/watchlist\/?$/)
        ) {
          return {
            isValid: false,
            error:
              'Invalid IMDb URL format. Expected: https://www.imdb.com/list/ls123456789 or https://www.imdb.com/user/ur12345678/watchlist',
          };
        }
        break;
      case 'mdblist':
        if (!urlObj.pathname.match(/^\/lists\/[^/]+\/[^/?]+\/?$/)) {
          return {
            isValid: false,
            error:
              'Invalid MDBList list URL format. Expected: https://mdblist.com/lists/username/listname',
          };
        }
        break;
      case 'letterboxd':
        if (
          !urlObj.pathname.match(/^\/[^/]+\/list\/[^/?]+\/?$/) &&
          !urlObj.pathname.match(/^\/[^/]+\/watchlist\/?$/) &&
          !urlObj.pathname.match(/^\/[^/]+\/films\/.*/)
        ) {
          return {
            isValid: false,
            error:
              'Invalid Letterboxd URL format. Expected: https://letterboxd.com/username/list/listname, https://letterboxd.com/username/watchlist/, or https://letterboxd.com/username/films/...',
          };
        }
        break;
      case 'anilist': {
        // Accept a wide range of AniList URL patterns including:
        // - https://anilist.co/user/:username/animelist/:listname (personal animelists)
        // - https://anilist.co/list/:listname
        // - https://anilist.co/search/anime?... (with optional additional path segments like /this-season, /popular)
        // - single item pages: /anime/:id
        const anilistPattern =
          /^(?:\/user\/[^/]+\/(?:animelist|list)\/[^/?]+|\/(?:animelist|list)\/[^/?]+|\/search\/anime(?:\/[^/?]+)?|\/anime\/?\d+)(?:\/)?$/;

        // Allow the pattern to match either the pathname or a search path with query params
        if (!urlObj.pathname.match(anilistPattern)) {
          return {
            isValid: false,
            error:
              'Invalid AniList URL format. Expected one of: user animelist, /list/, /search/anime or /anime/:id',
          };
        }

        break;
      }
      default:
        return { isValid: false, error: 'Unsupported collection type' };
    }

    // Sanitize URL by removing unnecessary query parameters and fragments
    const sanitizedUrl = `${urlObj.protocol}//${urlObj.hostname}${urlObj.pathname}`;

    return { isValid: true, sanitizedUrl };
  } catch (error) {
    return { isValid: false, error: 'Invalid URL format' };
  }
}

const collectionsRoutes = Router();

// Configure multer for poster uploads
export const posterUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 1, // Only allow one file
  },
  fileFilter: (req, file, callback) => {
    // Allow specific mime types
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];

    if (!allowedMimeTypes.includes(file.mimetype)) {
      return callback(
        new Error('Invalid file type. Only JPEG, PNG, and WebP are allowed.')
      );
    }

    // Check file extension matches mime type
    const fileExt = file.originalname?.toLowerCase().split('.').pop();
    const expectedExts: Record<string, string[]> = {
      'image/jpeg': ['jpg', 'jpeg'],
      'image/png': ['png'],
      'image/webp': ['webp'],
    };

    if (fileExt && !expectedExts[file.mimetype]?.includes(fileExt)) {
      return callback(new Error('File extension does not match file type.'));
    }

    callback(null, true);
  },
}).single('poster');

/**
 * GET /api/v1/collections
 * Get collection configurations
 */
collectionsRoutes.get('/', (_req, res) => {
  const settings = getSettings();
  const configs = settings.plex.collectionConfigs || [];

  logger.debug('Fetching collection configurations', {
    label: 'Collections API',
    count: configs.length,
    collectionNames: configs.map((c) => c.name).slice(0, 10),
  });

  return res.status(200).json({
    collectionConfigs: configs,
  });
});

/**
 * PUT /api/v1/collections/:id/settings
 * Update individual collection settings
 */
collectionsRoutes.put('/:id/settings', isAuthenticated(), async (req, res) => {
  try {
    const { id } = req.params;
    const settings = getSettings();

    // Find the existing collection config
    const configs = settings.plex.collectionConfigs || [];
    const existingConfigIndex = configs.findIndex((c) => c.id === id);

    if (existingConfigIndex === -1) {
      return res.status(404).json({
        error: 'Collection not found',
        message: `Collection with id "${id}" not found`,
      });
    }

    const existingConfig = configs[existingConfigIndex];

    // Debug logging for person settings payload (directors/actors)
    if (
      req.body?.type === 'plex' &&
      (req.body?.subtype === 'directors' || req.body?.subtype === 'actors')
    ) {
      const maybeNumber = (value: unknown): number | undefined => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
      };
      const personMinimum = maybeNumber(req.body.personMinimumItems);

      if (personMinimum !== undefined && personMinimum < 2) {
        return res.status(400).json({
          error: `${req.body.subtype} minimum items must be at least 2`,
          message:
            'Person collections require a minimum of 2 items, 1 is not allowed',
        });
      }

      if (personMinimum !== undefined) {
        req.body.personMinimumItems = personMinimum;
      }

      logger.info(`Updating plex/${req.body.subtype} config`, {
        label: 'Collections API',
        id,
        incomingMinimumItems: personMinimum,
        rawBodyKeys: Object.keys(req.body || {}),
        rawBody: req.body,
      });
    }

    // Check if this is a linked collection - if so, update all linked configs
    const configsToUpdate = [];
    if (existingConfig.isLinked && existingConfig.linkId) {
      // Find all configs with the same linkId
      const linkedConfigs = configs.filter(
        (c) => c.linkId === existingConfig.linkId && c.isLinked
      );
      configsToUpdate.push(...linkedConfigs);
      logger.info(
        `Updating ${linkedConfigs.length} linked collection configs`,
        {
          label: 'Collections API',
          linkId: existingConfig.linkId,
          configIds: linkedConfigs.map((c) => c.id),
        }
      );
    } else {
      configsToUpdate.push(existingConfig);
    }

    // Get libraries for template processing
    const libraries = settings.plex.libraries || [];
    const updatedConfigs: CollectionConfig[] = [];
    const affectedLibraryIds: string[] = [];

    // Handle library additions/removals for linked collections
    if (
      existingConfig.isLinked &&
      existingConfig.linkId &&
      req.body.libraryIds
    ) {
      const requestedLibraryIds = Array.isArray(req.body.libraryIds)
        ? req.body.libraryIds
        : [req.body.libraryIds];

      // Get current library IDs from existing linked configs
      const currentLibraryIds = configsToUpdate.map((c) => c.libraryId);

      // Detect additions and removals
      const addedLibraryIds = requestedLibraryIds.filter(
        (id: string) => !currentLibraryIds.includes(id)
      );
      const removedLibraryIds = currentLibraryIds.filter(
        (id: string) => !requestedLibraryIds.includes(id)
      );

      logger.info('Library changes detected for linked collection', {
        label: 'Collections API',
        linkId: existingConfig.linkId,
        currentLibraries: currentLibraryIds,
        requestedLibraries: requestedLibraryIds,
        added: addedLibraryIds,
        removed: removedLibraryIds,
      });

      // Create new configs for added libraries
      for (const libraryId of addedLibraryIds) {
        const library = libraries.find((lib) => lib.key === libraryId);
        if (!library) {
          logger.warn('Library not found for addition', {
            label: 'Collections API',
            libraryId,
          });
          continue;
        }

        // Determine proper media type based on library type
        const libraryMediaType: 'movie' | 'tv' =
          library.type === 'show' ? 'tv' : 'movie';

        // Process template for this library
        const context = {
          ...templateEngine.getDefaultContext(),
          mediaType: libraryMediaType,
          days: req.body.customDays || existingConfig.customDays,
          customdays: req.body.customDays || existingConfig.customDays,
          statType:
            req.body.tautulliStatType || existingConfig.tautulliStatType,
          subtype: req.body.subtype || existingConfig.subtype,
        };

        let templateToProcess =
          req.body.template || existingConfig.template || existingConfig.name;

        // For custom templates, choose appropriate template based on library type
        if (templateToProcess === 'custom') {
          if (libraryMediaType === 'movie' && req.body.customMovieTemplate) {
            templateToProcess = req.body.customMovieTemplate;
          } else if (libraryMediaType === 'tv' && req.body.customTVTemplate) {
            templateToProcess = req.body.customTVTemplate;
          }
        }

        let processedName = templateEngine.processTemplate(
          templateToProcess,
          context
        );

        // Handle Overseerr user collections
        if (
          (req.body.type || existingConfig.type) === 'overseerr' &&
          (req.body.subtype || existingConfig.subtype) === 'users'
        ) {
          const defaultContext = templateEngine.getDefaultContext();
          if (defaultContext.username) {
            processedName = processedName.replace(
              new RegExp(defaultContext.username, 'g'),
              '{username}'
            );
          }
          if (defaultContext.nickname) {
            processedName = processedName.replace(
              new RegExp(defaultContext.nickname, 'g'),
              '{nickname}'
            );
          }
        }

        // Extract per-library poster if available
        let customPosterForNewLibrary: string | undefined;
        if (req.body.customPoster) {
          if (typeof req.body.customPoster === 'string') {
            customPosterForNewLibrary = req.body.customPoster;
          } else if (typeof req.body.customPoster === 'object') {
            customPosterForNewLibrary = req.body.customPoster[libraryId] || '';
          }
        }

        // Extract per-library wallpaper if available
        let customWallpaperForNewLibrary: string | undefined;
        if (req.body.customWallpaper) {
          if (typeof req.body.customWallpaper === 'string') {
            customWallpaperForNewLibrary = req.body.customWallpaper;
          } else if (typeof req.body.customWallpaper === 'object') {
            customWallpaperForNewLibrary =
              req.body.customWallpaper[libraryId] || '';
          }
        }

        // Extract per-library theme if available
        let customThemeForNewLibrary: string | undefined;
        if (req.body.customTheme) {
          if (typeof req.body.customTheme === 'string') {
            customThemeForNewLibrary = req.body.customTheme;
          } else if (typeof req.body.customTheme === 'object') {
            customThemeForNewLibrary = req.body.customTheme[libraryId] || '';
          }
        }

        // Generate new ID for this config
        const { IdGenerator } = await import('@server/utils/idGenerator');
        const newConfigId = IdGenerator.generateId();

        // Create new config based on existing config settings
        const newConfig: CollectionConfig = {
          ...existingConfig, // Copy all settings from the base config
          ...req.body, // Apply user changes
          id: newConfigId,
          name: processedName,
          libraryId: libraryId,
          libraryName: library.name,
          customPoster: customPosterForNewLibrary || '',
          customWallpaper: customWallpaperForNewLibrary || '',
          customTheme: customThemeForNewLibrary || '',
          isLinked: true,
          linkId: existingConfig.linkId,
          isActive: false, // Will be computed by sync service
          collectionRatingKey: undefined, // New collection doesn't exist in Plex yet
          sortOrderHome: existingConfig.sortOrderHome,
          sortOrderLibrary: existingConfig.sortOrderLibrary,
        };

        // Add to configs array
        configs.push(newConfig);
        configsToUpdate.push(newConfig);

        logger.info('Created new config for added library', {
          label: 'Collections API',
          linkId: existingConfig.linkId,
          libraryId,
          libraryName: library.name,
          configId: newConfigId,
          configName: processedName,
        });
      }

      // Delete configs for removed libraries
      for (const libraryId of removedLibraryIds) {
        const configToRemove = configsToUpdate.find(
          (c) => c.libraryId === libraryId
        );
        if (configToRemove) {
          const removeIndex = configs.findIndex(
            (c) => c.id === configToRemove.id
          );
          if (removeIndex >= 0) {
            configs.splice(removeIndex, 1);

            // Also remove from configsToUpdate so we don't try to update it
            const updateIndex = configsToUpdate.findIndex(
              (c) => c.id === configToRemove.id
            );
            if (updateIndex >= 0) {
              configsToUpdate.splice(updateIndex, 1);
            }

            logger.info('Deleted config for removed library', {
              label: 'Collections API',
              linkId: existingConfig.linkId,
              libraryId,
              configId: configToRemove.id,
              configName: configToRemove.name,
            });
          }
        }
      }
    }

    // Process each config (could be just one, or multiple if linked)
    for (const configToUpdate of configsToUpdate) {
      const configIndex = configs.findIndex((c) => c.id === configToUpdate.id);

      // Get library to determine media type for template processing
      const library = libraries.find(
        (lib) => lib.key === configToUpdate.libraryId
      );
      const libraryMediaType: 'movie' | 'tv' =
        library && library.type === 'show' ? 'tv' : 'movie';

      const context = {
        ...templateEngine.getDefaultContext(),
        mediaType: libraryMediaType,
        days: req.body.customDays || configToUpdate.customDays,
        customdays: req.body.customDays || configToUpdate.customDays,
        statType: req.body.tautulliStatType || configToUpdate.tautulliStatType,
        subtype: req.body.subtype || configToUpdate.subtype,
      };

      // Determine template to process - handle custom templates per library type
      let templateToProcess =
        req.body.template ||
        req.body.name ||
        configToUpdate.template ||
        configToUpdate.name ||
        '';

      // For custom templates, choose the appropriate template based on library type
      if (templateToProcess === 'custom') {
        if (libraryMediaType === 'movie' && req.body.customMovieTemplate) {
          templateToProcess = req.body.customMovieTemplate;
        } else if (libraryMediaType === 'tv' && req.body.customTVTemplate) {
          templateToProcess = req.body.customTVTemplate;
        }
      }

      let processedName = templateEngine.processTemplate(
        templateToProcess,
        context
      );

      // Check for duplicate collection names within this library
      // Skip duplicate check for DYNAMIC_RANDOM_TITLE as each collection gets a unique title from the random list
      const templateValue = req.body.template || configToUpdate.template;
      if (
        templateValue !== 'DYNAMIC_RANDOM_TITLE' &&
        templateValue !== 'DYNAMIC_CYCLE_TITLE'
      ) {
        const duplicateName = configs.find(
          (config) =>
            config.id !== configToUpdate.id && // Exclude the collection being updated
            config.name === processedName &&
            config.libraryId === configToUpdate.libraryId
        );

        if (duplicateName) {
          return res.status(400).json({
            error: `Collection "${processedName}" already exists in this library`,
            message: `A collection with the name "${processedName}" already exists in library "${library?.name}". Please choose a different name or template.`,
          });
        }

        // Also check pre-existing collections
        const preExistingService = new PreExistingCollectionConfigService();
        const preExistingConfigs = preExistingService.getConfigs();
        const duplicatePreExisting = preExistingConfigs.find(
          (config) =>
            config.name === processedName &&
            config.libraryId === configToUpdate.libraryId
        );

        if (duplicatePreExisting) {
          return res.status(400).json({
            error: `Collection "${processedName}" already exists in this library`,
            message: `A pre-existing collection with the name "${processedName}" already exists in library "${library?.name}". Please choose a different name or template.`,
          });
        }
      }

      // For Overseerr user collections, keep {username} and {nickname} as literals
      if (
        (req.body.type || configToUpdate.type) === 'overseerr' &&
        (req.body.subtype || configToUpdate.subtype) === 'users'
      ) {
        const defaultContext = templateEngine.getDefaultContext();
        if (defaultContext.username) {
          processedName = processedName.replace(
            new RegExp(defaultContext.username, 'g'),
            '{username}'
          );
        }
        if (defaultContext.nickname) {
          processedName = processedName.replace(
            new RegExp(defaultContext.nickname, 'g'),
            '{nickname}'
          );
        }
      }

      // Handle per-library poster extraction for linked collections
      let customPosterForThisLibrary: string | undefined;
      if (req.body.customPoster) {
        if (typeof req.body.customPoster === 'string') {
          // Single poster - use as-is
          customPosterForThisLibrary = req.body.customPoster;
        } else if (typeof req.body.customPoster === 'object') {
          // Per-library posters - extract the one for this config's library
          customPosterForThisLibrary =
            req.body.customPoster[configToUpdate.libraryId] || '';
        }
      }

      // Handle per-library wallpaper extraction for linked collections
      let customWallpaperForThisLibrary: string | undefined;
      if (req.body.customWallpaper) {
        if (typeof req.body.customWallpaper === 'string') {
          customWallpaperForThisLibrary = req.body.customWallpaper;
        } else if (typeof req.body.customWallpaper === 'object') {
          customWallpaperForThisLibrary =
            req.body.customWallpaper[configToUpdate.libraryId] || '';
        }
      }

      // Handle per-library theme extraction for linked collections
      let customThemeForThisLibrary: string | undefined;
      if (req.body.customTheme) {
        if (typeof req.body.customTheme === 'string') {
          customThemeForThisLibrary = req.body.customTheme;
        } else if (typeof req.body.customTheme === 'object') {
          customThemeForThisLibrary =
            req.body.customTheme[configToUpdate.libraryId] || '';
        }
      }

      // Merge settings while preserving computed fields and library-specific fields
      const updatedConfig: CollectionConfig = {
        ...configToUpdate, // Preserve all existing fields including computed ones
        ...req.body, // Apply user changes
        name: processedName, // Use processed template name
        // Override per-library media fields with library-specific values
        customPoster:
          customPosterForThisLibrary !== undefined
            ? customPosterForThisLibrary
            : configToUpdate.customPoster,
        customWallpaper:
          customWallpaperForThisLibrary !== undefined
            ? customWallpaperForThisLibrary
            : configToUpdate.customWallpaper,
        customTheme:
          customThemeForThisLibrary !== undefined
            ? customThemeForThisLibrary
            : configToUpdate.customTheme,
        // Ensure computed fields stay computed:
        id: configToUpdate.id, // ID never changes
        isActive: configToUpdate.isActive, // Preserve sync service's isActive calculation
        // For linked collections, preserve library-specific fields
        libraryId: configToUpdate.libraryId, // Don't change the library assignment
        libraryName: configToUpdate.libraryName, // Don't change the library name
        // Preserve library-specific Plex state fields (CRITICAL: prevents cross-library ratingKey bugs)
        collectionRatingKey: configToUpdate.collectionRatingKey, // Plex collection rating key is library-specific
        smartCollectionRatingKey: configToUpdate.smartCollectionRatingKey, // Legacy smart collection rating key is library-specific
        sortOrderHome: configToUpdate.sortOrderHome, // Home screen position is library-specific
        sortOrderLibrary: configToUpdate.sortOrderLibrary, // Library tab position is library-specific
        isLibraryPromoted: configToUpdate.isLibraryPromoted, // Library promotion status is library-specific
        everLibraryPromoted: configToUpdate.everLibraryPromoted, // Library promotion history is library-specific
        isPromotedToHub: configToUpdate.isPromotedToHub, // Hub promotion status is library-specific
        // Preserve library-specific sync tracking fields (each library syncs independently)
        lastSyncedAt: configToUpdate.lastSyncedAt, // Last sync timestamp is per-library
        lastSyncError: configToUpdate.lastSyncError, // Sync errors are per-library
        lastSyncErrorAt: configToUpdate.lastSyncErrorAt, // Sync error timestamp is per-library
        missing: configToUpdate.missing, // Missing status is per-library (can exist in one library but not another)
      };

      // Handle firstSyncAt for custom sync schedules
      if (updatedConfig.customSyncSchedule?.enabled) {
        const oldSchedule = configToUpdate.customSyncSchedule;
        const newSchedule = req.body.customSyncSchedule;

        // Set firstSyncAt if this is a new custom schedule with startNow
        if (!oldSchedule?.enabled && newSchedule?.startNow) {
          updatedConfig.customSyncSchedule.firstSyncAt =
            new Date().toISOString();
        }
        // Preserve existing firstSyncAt if it exists
        else if (oldSchedule?.firstSyncAt) {
          updatedConfig.customSyncSchedule.firstSyncAt =
            oldSchedule.firstSyncAt;
        }
        // If changing to startNow=true and no firstSyncAt exists, set it
        else if (newSchedule?.startNow && !oldSchedule?.firstSyncAt) {
          updatedConfig.customSyncSchedule.firstSyncAt =
            new Date().toISOString();
        }
      }

      // Update the config in place
      configs[configIndex] = updatedConfig;
      updatedConfigs.push(updatedConfig);

      // Track affected libraries for auto-reorder
      const libraryId = Array.isArray(updatedConfig.libraryId)
        ? updatedConfig.libraryId[0]
        : updatedConfig.libraryId;
      if (libraryId && !affectedLibraryIds.includes(libraryId)) {
        affectedLibraryIds.push(libraryId);
      }

      // Mark collection as needing sync due to modification
      settings.markCollectionModified(configToUpdate.id, 'collection');
    }

    settings.plex.collectionConfigs = configs;
    settings.save();

    // Update individual collection scheduler for edited collections only
    try {
      const { IndividualCollectionScheduler } = await import(
        '@server/lib/collections/services/IndividualCollectionScheduler'
      );

      // Update scheduler for each edited collection
      for (const config of updatedConfigs) {
        const customSync = config.customSyncSchedule;
        if (customSync?.enabled) {
          // Use refreshAllJobs to handle the new format properly
          // This will re-evaluate all jobs with the new schedule parsing
          await IndividualCollectionScheduler.refreshAllJobs();
          break; // Only need to refresh once for all configs
        } else {
          // Cancel scheduling if custom sync was disabled
          IndividualCollectionScheduler.cancelCollectionSync(config.id);
        }
      }
    } catch (error) {
      logger.warn('Failed to update individual collection scheduler:', error);
    }

    logger.info('Collection config(s) updated successfully', {
      label: 'Collections API',
      updatedCount: updatedConfigs.length,
      configIds: updatedConfigs.map((c) => c.id),
      configNames: updatedConfigs.map((c) => c.name),
      isLinked: existingConfig.isLinked,
      linkId: existingConfig.linkId || 'none',
    });

    // Auto-reorder after visibility changes to assign proper sort orders
    const { autoReorderLibrary } = await import('@server/routes/reorder');
    for (const libraryId of affectedLibraryIds) {
      try {
        await autoReorderLibrary(libraryId, 'home');
        await autoReorderLibrary(libraryId, 'library');
        logger.debug(
          `Auto-reordering completed after collection settings update for library ${libraryId}`,
          {
            label: 'Collections API - Auto Reorder',
          }
        );
      } catch (error) {
        logger.warn('Failed to auto-reorder after collection settings update', {
          label: 'Collections API - Auto Reorder',
          libraryId,
          error: error instanceof Error ? error.message : String(error),
        });
        // Don't fail the settings update if reordering fails
      }
    }

    return res.status(200).json({
      collectionConfig: updatedConfigs[0], // Return the primary config (the one that was edited)
      updatedConfigs: updatedConfigs, // Include all updated configs in response
      message: `${updatedConfigs.length} collection config${
        updatedConfigs.length === 1 ? '' : 's'
      } updated successfully`,
    });
  } catch (error) {
    logger.error('Failed to update collection settings', {
      label: 'Collections API',
      error: error instanceof Error ? error.message : String(error),
      configId: req.params.id,
    });

    return res.status(500).json({
      error: 'Failed to update collection settings',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * DELETE /api/v1/collections/cleanup-missing
 * Remove all collection configs where missing: true and delete them from Plex hubs
 */
collectionsRoutes.delete(
  '/cleanup-missing',
  isAuthenticated(),
  async (req, res) => {
    try {
      const settings = getSettings();
      let cleanupCount = 0;
      let hubDeleteCount = 0;

      // Get Plex client for hub deletion
      let plexClient: PlexAPI | null = null;
      try {
        const { getRepository } = await import('@server/datasource');
        const { User } = await import('@server/entity/User');
        const userRepository = getRepository(User);
        const adminUser = await userRepository.findOne({
          where: { id: 1 },
          select: ['id', 'plexToken'],
        });

        if (adminUser?.plexToken && settings.plex.ip && settings.plex.port) {
          plexClient = new PlexAPI({
            plexToken: adminUser.plexToken,
            plexSettings: settings.plex,
          });
        }
      } catch (error) {
        logger.warn('Could not initialize Plex client for hub cleanup', {
          label: 'Collections API - Cleanup',
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Remove missing collections and delete from hubs
      const missingCollections = (settings.plex.collectionConfigs || []).filter(
        (config) => config.missing === true
      );
      const filteredCollections = (
        settings.plex.collectionConfigs || []
      ).filter((config) => {
        const shouldRemove = config.missing === true;
        if (shouldRemove) {
          cleanupCount++;
          logger.info(`Cleaning up missing collection: ${config.name}`, {
            label: 'Collections API - Cleanup',
            configId: config.id,
            ratingKey: config.collectionRatingKey,
          });
        }
        return !shouldRemove;
      });

      // Delete missing collections from Plex hubs
      if (plexClient && missingCollections.length > 0) {
        for (const config of missingCollections) {
          if (config.collectionRatingKey && config.libraryId) {
            try {
              // Generate the hub identifier for custom collections
              const hubIdentifier = `custom.collection.${config.libraryId}.${config.collectionRatingKey}`;

              await plexClient.deleteHubItem(config.libraryId, hubIdentifier);
              hubDeleteCount++;

              logger.info(
                `Deleted missing collection from Plex hub: ${config.name}`,
                {
                  label: 'Collections API - Cleanup',
                  configId: config.id,
                  hubIdentifier,
                  libraryId: config.libraryId,
                }
              );
            } catch (error) {
              logger.warn(
                `Failed to delete collection from Plex hub: ${config.name}`,
                {
                  label: 'Collections API - Cleanup',
                  configId: config.id,
                  error: error instanceof Error ? error.message : String(error),
                }
              );
            }
          }
        }
      }

      // Remove missing hubs
      const filteredHubs = (settings.plex.hubConfigs || []).filter((config) => {
        const shouldRemove = config.missing === true;
        if (shouldRemove) {
          cleanupCount++;
          logger.info(`Cleaning up missing hub: ${config.name}`, {
            label: 'Collections API - Cleanup',
            configId: config.id,
            hubIdentifier: config.hubIdentifier,
          });
        }
        return !shouldRemove;
      });

      // Remove missing pre-existing collections and delete from hubs
      const missingPreExisting = (
        settings.plex.preExistingCollectionConfigs || []
      ).filter((config) => config.missing === true);

      const filteredPreExisting = (
        settings.plex.preExistingCollectionConfigs || []
      ).filter((config) => {
        const shouldRemove = config.missing === true;
        if (shouldRemove) {
          cleanupCount++;
          logger.info(
            `Cleaning up missing pre-existing collection: ${config.name}`,
            {
              label: 'Collections API - Cleanup',
              configId: config.id,
              ratingKey: config.collectionRatingKey,
            }
          );
        }
        return !shouldRemove;
      });

      // Delete missing pre-existing collections from Plex hubs
      if (plexClient && missingPreExisting.length > 0) {
        for (const config of missingPreExisting) {
          if (config.collectionRatingKey && config.libraryId) {
            try {
              // Generate the hub identifier for pre-existing collections
              const hubIdentifier = `custom.collection.${config.libraryId}.${config.collectionRatingKey}`;

              await plexClient.deleteHubItem(config.libraryId, hubIdentifier);
              hubDeleteCount++;

              logger.info(
                `Deleted missing pre-existing collection from Plex hub: ${config.name}`,
                {
                  label: 'Collections API - Cleanup',
                  configId: config.id,
                  hubIdentifier,
                  libraryId: config.libraryId,
                  ratingKey: config.collectionRatingKey,
                }
              );
            } catch (error) {
              logger.warn(
                `Failed to delete pre-existing collection from Plex hub: ${config.name}`,
                {
                  label: 'Collections API - Cleanup',
                  configId: config.id,
                  error: error instanceof Error ? error.message : String(error),
                }
              );
            }
          }
        }
      }

      // Update settings with filtered configs
      settings.plex.collectionConfigs = filteredCollections;
      settings.plex.hubConfigs = filteredHubs;
      settings.plex.preExistingCollectionConfigs = filteredPreExisting;
      settings.save();

      const message =
        hubDeleteCount > 0
          ? `${cleanupCount} missing collection configuration${
              cleanupCount !== 1 ? 's' : ''
            } removed successfully (${hubDeleteCount} also deleted from Plex hubs)`
          : `${cleanupCount} missing collection configuration${
              cleanupCount !== 1 ? 's' : ''
            } removed successfully`;

      logger.info(
        `Cleanup complete: ${cleanupCount} missing collection configurations removed, ${hubDeleteCount} deleted from Plex hubs`,
        {
          label: 'Collections API - Cleanup',
        }
      );

      return res.status(200).json({
        message,
        cleanupCount,
        hubDeleteCount,
      });
    } catch (error) {
      logger.error('Failed to cleanup missing collections', {
        label: 'Collections API - Cleanup',
        error: error instanceof Error ? error.message : String(error),
      });

      return res.status(500).json({
        error: 'Failed to cleanup missing collections',
      });
    }
  }
);

/**
 * DELETE /api/v1/collections/:id
 * Delete individual collection and recalculate sort orders
 */
collectionsRoutes.delete('/:id', isAuthenticated(), async (req, res) => {
  try {
    const { id } = req.params;
    const settings = getSettings();

    // Find the collection config to delete
    const configs = settings.plex.collectionConfigs || [];
    const configToDelete = configs.find((c) => c.id === id);

    if (!configToDelete) {
      return res.status(404).json({
        error: 'Collection not found',
        message: `Collection with id "${id}" not found`,
      });
    }

    // Check if this is a linked collection - if so, delete all linked configs
    const configsToDelete = [];
    if (configToDelete.isLinked && configToDelete.linkId) {
      // Find all configs with the same linkId
      const linkedConfigs = configs.filter(
        (c) => c.linkId === configToDelete.linkId && c.isLinked
      );
      configsToDelete.push(...linkedConfigs);
    } else {
      configsToDelete.push(configToDelete);
    }

    // Clean up labels for smart collections before deletion
    try {
      // Get admin user for Plex token
      const { getAdminUser } = await import(
        '@server/lib/collections/core/CollectionUtilities'
      );
      const localAdmin = await getAdminUser();

      if (localAdmin?.plexToken) {
        const plexClient = new PlexAPI({
          plexToken: localAdmin.plexToken,
          plexSettings: settings.plex,
        });

        // Clean up labels for each collection being deleted
        for (const config of configsToDelete) {
          // Only clean up labels for smart collections (showUnwatchedOnly enabled)
          if (config.showUnwatchedOnly && config.libraryId) {
            const labelName = `agregarr-unwatched-${config.id}`;
            const libraryId = Array.isArray(config.libraryId)
              ? config.libraryId[0]
              : config.libraryId;

            try {
              logger.info(
                `Cleaning up labels for smart collection: ${config.name}`,
                {
                  label: 'Collections API',
                  configId: config.id,
                  labelName,
                }
              );

              // Get all items with this label
              const labeledItems = await plexClient.getItemsWithLabel(
                libraryId,
                labelName
              );

              if (labeledItems.length > 0) {
                logger.info(
                  `Removing label from ${labeledItems.length} items`,
                  {
                    label: 'Collections API',
                    configId: config.id,
                    labelName,
                    itemCount: labeledItems.length,
                  }
                );
                for (const itemKey of labeledItems) {
                  await plexClient.removeLabelFromItem(itemKey, labelName);
                }
              }
            } catch (error) {
              logger.warn(
                `Failed to cleanup labels for collection ${config.name}`,
                {
                  label: 'Collections API',
                  configId: config.id,
                  labelName,
                  error: error instanceof Error ? error.message : String(error),
                }
              );
              // Continue with deletion even if label cleanup fails
            }
          }
        }
      } else {
        logger.warn(
          'No local admin Plex token found for label cleanup during deletion'
        );
      }
    } catch (error) {
      logger.warn('Error during label cleanup', {
        label: 'Collections API',
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue with deletion even if label cleanup fails
    }

    // Remove the configs
    const deletedConfigIds = configsToDelete.map((c) => c.id);
    const remainingConfigs = configs.filter(
      (c) => !deletedConfigIds.includes(c.id)
    );

    // Save updated configs (auto-reordering will handle sort order cleanup)
    settings.plex.collectionConfigs = remainingConfigs;
    settings.save();

    // Clean up placeholder records for deleted collections
    try {
      const { getRepository } = await import('@server/datasource');
      const { PlaceholderItem } = await import(
        '@server/entity/PlaceholderItem'
      );
      const { Not, Like } = await import('typeorm');
      const path = await import('path');

      const repository = getRepository(PlaceholderItem);
      let totalPlaceholdersRemoved = 0;
      let totalFilesRemoved = 0;

      for (const deletedConfig of configsToDelete) {
        // Find both direct records AND multi-source sub-collection records
        // Multi-source collections have IDs like "33079-source-1762115269335"
        const orphanedRecords = await repository.find({
          where: [
            { configId: deletedConfig.id },
            { configId: Like(`${deletedConfig.id}-source-%`) },
          ],
        });

        if (orphanedRecords.length === 0) {
          continue;
        }

        logger.info(
          `Cleaning up ${orphanedRecords.length} placeholder records for deleted collection`,
          {
            label: 'Collections API',
            configId: deletedConfig.id,
            configName: deletedConfig.name,
            recordCount: orphanedRecords.length,
          }
        );

        // Collect all config IDs being deleted (parent + all sub-sources)
        const allDeletedConfigIds = Array.from(
          new Set(orphanedRecords.map((r) => r.configId))
        );

        for (const record of orphanedRecords) {
          try {
            let fileDeleted = false;

            // Check if we should delete the placeholder file
            if (record.placeholderPath) {
              // Check if any OTHER collection (excluding all deleted IDs) still needs this file
              const { In } = await import('typeorm');
              const otherCollectionRecords = await repository.find({
                where: {
                  placeholderPath: record.placeholderPath,
                  configId: Not(In(allDeletedConfigIds)),
                },
              });

              if (otherCollectionRecords.length === 0) {
                // No other collections use this file - safe to delete
                const { getPlaceholderRootFolder } = await import(
                  '@server/lib/placeholders/helpers/placeholderPathHelpers'
                );
                const libraryPath = getPlaceholderRootFolder(
                  deletedConfig.libraryId,
                  record.mediaType
                );

                if (libraryPath) {
                  const fullPath = path.join(
                    libraryPath,
                    record.placeholderPath
                  );

                  try {
                    const { removePlaceholder } = await import(
                      '@server/lib/placeholders/placeholderManager'
                    );
                    await removePlaceholder(fullPath, record.mediaType);
                    fileDeleted = true;
                    totalFilesRemoved++;
                  } catch (error) {
                    // File might already be gone - that's ok
                    if (
                      error instanceof Error &&
                      !error.message.includes('ENOENT')
                    ) {
                      logger.warn('Failed to remove placeholder file', {
                        label: 'Collections API',
                        title: record.title,
                        path: fullPath,
                        error: error.message,
                      });
                    } else {
                      fileDeleted = true; // File doesn't exist - consider it removed
                    }
                  }
                } else {
                  logger.warn(
                    'Placeholder library path not configured - cannot remove file',
                    {
                      label: 'Collections API',
                      title: record.title,
                      mediaType: record.mediaType,
                    }
                  );
                }
              } else {
                logger.debug(
                  'Placeholder file shared with other collections - keeping file',
                  {
                    label: 'Collections API',
                    title: record.title,
                    otherCollections: otherCollectionRecords.length,
                  }
                );
              }
            }

            // Always delete the database record (even if file deletion failed)
            await repository.remove(record);
            totalPlaceholdersRemoved++;

            logger.debug('Removed placeholder record', {
              label: 'Collections API',
              title: record.title,
              configId: deletedConfig.id,
              fileDeleted,
            });
          } catch (error) {
            logger.error('Failed to cleanup placeholder record', {
              label: 'Collections API',
              title: record.title,
              configId: deletedConfig.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }

      if (totalPlaceholdersRemoved > 0) {
        logger.info('Placeholder cleanup completed', {
          label: 'Collections API',
          recordsRemoved: totalPlaceholdersRemoved,
          filesRemoved: totalFilesRemoved,
        });
      }
    } catch (error) {
      logger.warn('Failed to cleanup placeholder records', {
        label: 'Collections API',
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue with collection deletion even if placeholder cleanup fails
    }

    // If this was the last collection config, trigger cleanup to remove all agregarr collections
    if (remainingConfigs.length === 0) {
      logger.info(
        'Last collection config deleted - triggering cleanup of all agregarr collections',
        {
          label: 'Collections API',
        }
      );

      try {
        const collectionsSync = await import('@server/lib/collectionsSync');
        await collectionsSync.default.cleanupCollections();
        logger.info('Cleanup completed after last collection deletion', {
          label: 'Collections API',
        });
      } catch (error) {
        logger.warn('Failed to cleanup collections after deletion', {
          label: 'Collections API',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info('Collection(s) deleted successfully', {
      label: 'Collections API',
      deletedCount: configsToDelete.length,
      deletedConfigs: configsToDelete.map((c) => ({
        id: c.id,
        name: c.name,
        libraryId: c.libraryId,
      })),
      remainingCount: remainingConfigs.length,
    });

    // Auto-reorder collections in affected libraries to fill gaps
    const affectedLibraries = [
      ...new Set(
        configsToDelete.map((c) => {
          return Array.isArray(c.libraryId) ? c.libraryId[0] : c.libraryId;
        })
      ),
    ];

    const { autoReorderLibrary } = await import('@server/routes/reorder');
    for (const libraryId of affectedLibraries) {
      try {
        // Auto-reorder both home and library contexts to fill gaps
        await autoReorderLibrary(libraryId, 'home');
        await autoReorderLibrary(libraryId, 'library');
        logger.debug(
          `Auto-reordering completed after deletion for library ${libraryId}`,
          {
            label: 'Collections API - Auto Reorder',
          }
        );
      } catch (error) {
        logger.warn('Failed to auto-reorder after collection deletion', {
          label: 'Collections API - Auto Reorder',
          libraryId,
          error: error instanceof Error ? error.message : String(error),
        });
        // Don't fail the deletion if reordering fails
      }
    }

    return res.status(200).json({
      message: `${configsToDelete.length} collection(s) deleted successfully`,
      deletedConfigs: configsToDelete.map((c) => ({ id: c.id, name: c.name })),
    });
  } catch (error) {
    logger.error('Failed to delete collection', {
      label: 'Collections API',
      error: error instanceof Error ? error.message : String(error),
      configId: req.params.id,
    });

    return res.status(500).json({
      error: 'Failed to delete collection',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/v1/collections/create
 * Create a new collection (supports multiple libraries)
 */
collectionsRoutes.post('/create', isAuthenticated(), async (req, res) => {
  try {
    const settings = getSettings();
    const { IdGenerator } = await import('@server/utils/idGenerator');

    // Cache warming removed - caused double requests and rate limiting issues

    // Extract libraryIds from request - support both single libraryId and multiple libraryIds
    const libraryIds = req.body.libraryIds
      ? Array.isArray(req.body.libraryIds)
        ? req.body.libraryIds
        : [req.body.libraryIds]
      : req.body.libraryId
      ? [req.body.libraryId]
      : [];

    if (libraryIds.length === 0) {
      return res.status(400).json({
        error: 'Library selection required',
        message: 'Either libraryId or libraryIds must be provided',
      });
    }

    // Get libraries for proper media type detection
    const libraries = settings.plex.libraries || [];
    const existingConfigs = settings.plex.collectionConfigs || [];
    const createdConfigs = [];

    // Generate linkId for multi-library collections
    const linkId = libraryIds.length > 1 ? getNextLinkId(existingConfigs) : 0;

    // Create individual configs for each selected library
    for (const libraryId of libraryIds) {
      const library = libraries.find((lib) => lib.key === libraryId);
      if (!library) {
        logger.warn('Library not found for collection creation', {
          label: 'Collections API',
          libraryId,
          availableLibraries: libraries.map((l) => ({
            key: l.key,
            name: l.name,
          })),
        });
        continue; // Skip missing libraries instead of failing completely
      }

      // Determine proper media type based on library type
      const libraryMediaType: 'movie' | 'tv' =
        library.type === 'show' ? 'tv' : 'movie';

      // Process template to generate actual collection name for this library
      const context = {
        ...templateEngine.getDefaultContext(),
        mediaType: libraryMediaType,
        days: req.body.customDays,
        customdays: req.body.customDays,
        statType: req.body.tautulliStatType,
        subtype: req.body.subtype,
      };
      // For custom templates, choose the appropriate template based on library type
      let templateToProcess = req.body.template || req.body.name || '';
      if (req.body.template === 'custom') {
        if (libraryMediaType === 'movie' && req.body.customMovieTemplate) {
          templateToProcess = req.body.customMovieTemplate;
        } else if (libraryMediaType === 'tv' && req.body.customTVTemplate) {
          templateToProcess = req.body.customTVTemplate;
        }
      }

      let processedName = templateEngine.processTemplate(
        templateToProcess,
        context
      );

      // Check for duplicate collection names within this library
      // Skip duplicate check for DYNAMIC_RANDOM_TITLE as each collection gets a unique title from the random list
      if (
        req.body.template !== 'DYNAMIC_RANDOM_TITLE' &&
        req.body.template !== 'DYNAMIC_CYCLE_TITLE'
      ) {
        const duplicateName = existingConfigs.find(
          (config) =>
            config.name === processedName && config.libraryId === libraryId
        );

        if (duplicateName) {
          return res.status(400).json({
            error: `Collection "${processedName}" already exists in this library`,
            message: `A collection with the name "${processedName}" already exists in library "${library.name}". Please choose a different name or template.`,
          });
        }

        // Also check pre-existing collections
        const preExistingService = new PreExistingCollectionConfigService();
        const preExistingConfigs = preExistingService.getConfigs();
        const duplicatePreExisting = preExistingConfigs.find(
          (config) =>
            config.name === processedName && config.libraryId === libraryId
        );

        if (duplicatePreExisting) {
          return res.status(400).json({
            error: `Collection "${processedName}" already exists in this library`,
            message: `A pre-existing collection with the name "${processedName}" already exists in library "${library.name}". Please choose a different name or template.`,
          });
        }
      }

      // For Overseerr user collections, keep {username} and {nickname} as literals
      if (req.body.type === 'overseerr' && req.body.subtype === 'users') {
        const defaultContext = templateEngine.getDefaultContext();
        if (defaultContext.username) {
          processedName = processedName.replace(
            new RegExp(defaultContext.username, 'g'),
            '{username}'
          );
        }
        if (defaultContext.nickname) {
          processedName = processedName.replace(
            new RegExp(defaultContext.nickname, 'g'),
            '{nickname}'
          );
        }
      }

      // Create time restriction evaluation
      const timeRestrictionResult =
        TimeRestrictionUtils.evaluateTimeRestriction(req.body.timeRestriction);

      // Determine default promotion status
      // Franchise collections default to A-Z section (where movies normally are)
      // All other collections default to promoted section
      const defaultIsLibraryPromoted = !(
        req.body.type === 'tmdb' && req.body.subtype === 'auto_franchise'
      );

      // Create individual config for this library
      const newConfig = {
        ...req.body,
        id: IdGenerator.generateId(),
        libraryId,
        libraryName: library.name,
        name: processedName,
        mediaType: libraryMediaType,
        isActive: timeRestrictionResult.isActive,
        isLinked: libraryIds.length > 1,
        linkId: linkId,
        isLibraryPromoted: defaultIsLibraryPromoted,
        everLibraryPromoted: defaultIsLibraryPromoted,
        // Remove multi-library fields that don't belong in individual configs
        libraryIds: undefined,
        libraryNames: undefined,
      };

      // Set firstSyncAt for custom sync schedules that use startNow
      if (
        newConfig.customSyncSchedule?.enabled &&
        newConfig.customSyncSchedule?.startNow
      ) {
        newConfig.customSyncSchedule.firstSyncAt = new Date().toISOString();
      }

      createdConfigs.push(newConfig);
    }

    if (createdConfigs.length === 0) {
      return res.status(400).json({
        error: 'No valid libraries found',
        message: 'None of the specified libraries could be found',
      });
    }

    // Add all created configs to settings
    const configs = settings.plex.collectionConfigs || [];
    configs.push(...createdConfigs);
    settings.plex.collectionConfigs = configs;
    settings.save();

    // Mark all newly created collections as needing sync
    createdConfigs.forEach((config) => {
      settings.markCollectionModified(config.id, 'collection');
    });

    const configSummary = createdConfigs.map((c) => ({
      id: c.id,
      name: c.name,
      libraryId: c.libraryId,
      libraryName: c.libraryName,
      isLinked: c.isLinked,
      linkId: c.linkId,
    }));

    logger.info('Collection configs created successfully', {
      label: 'Collections API',
      configCount: createdConfigs.length,
      isMultiLibrary: libraryIds.length > 1,
      linkId: linkId || 'none',
      configs: configSummary,
    });

    // Auto-reorder collections in each affected library to assign proper sort orders
    // New collections will be placed at the top (position 0) and existing ones shifted
    const { autoReorderLibrary } = await import('@server/routes/reorder');
    for (const libraryId of libraryIds) {
      try {
        // Auto-reorder both home and library contexts
        await autoReorderLibrary(libraryId, 'home');
        await autoReorderLibrary(libraryId, 'library');
        logger.debug(`Auto-reordering completed for library ${libraryId}`, {
          label: 'Collections API - Auto Reorder',
        });
      } catch (error) {
        logger.warn('Failed to auto-reorder after collection creation', {
          label: 'Collections API - Auto Reorder',
          libraryId,
          error: error instanceof Error ? error.message : String(error),
        });
        // Don't fail the creation if reordering fails
      }
    }

    // Schedule individual collections with custom sync schedules (without affecting existing schedules)
    try {
      const { IndividualCollectionScheduler } = await import(
        '@server/lib/collections/services/IndividualCollectionScheduler'
      );

      // Only schedule newly created collections with custom sync
      for (const config of createdConfigs) {
        const customSync = config.customSyncSchedule;
        if (customSync?.enabled) {
          // Use refreshAllJobs to handle the new format properly
          await IndividualCollectionScheduler.refreshAllJobs();
          break; // Only need to refresh once for all configs
        }
      }
    } catch (error) {
      logger.warn('Failed to schedule individual collections:', error);
    }

    return res.status(201).json({
      collectionConfigs: createdConfigs,
      message: `${createdConfigs.length} collection config${
        createdConfigs.length === 1 ? '' : 's'
      } created successfully`,
    });
  } catch (error) {
    logger.error('Failed to create collection', {
      label: 'Collections API',
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      error: 'Failed to create collection',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Helper function to find the next available link ID across ALL collection types
 */
function getNextLinkId(configs: CollectionConfig[]): number {
  const settings = getSettings();

  // Collect all existing link IDs from ALL collection types
  const allExistingLinkIds: number[] = [];

  // 1. Check Agregarr-created collections
  const agregarrConfigs = configs || [];
  agregarrConfigs.forEach((config) => {
    if (config.linkId && config.linkId >= 1) {
      allExistingLinkIds.push(config.linkId);
    }
  });

  // 2. Check default Plex hubs
  const hubConfigs = settings.plex.hubConfigs || [];
  hubConfigs.forEach((hub) => {
    if (hub.linkId && hub.linkId >= 1) {
      allExistingLinkIds.push(hub.linkId);
    }
  });

  // 3. Check pre-existing collections
  const preExistingConfigs = settings.plex.preExistingCollectionConfigs || [];
  preExistingConfigs.forEach((preExisting) => {
    if (preExisting.linkId && preExisting.linkId >= 1) {
      allExistingLinkIds.push(preExisting.linkId);
    }
  });

  // Remove duplicates and sort
  const uniqueLinkIds = [...new Set(allExistingLinkIds)].sort((a, b) => a - b);

  // If no existing link IDs, start with 1
  if (uniqueLinkIds.length === 0) {
    return 1;
  }

  // Find the highest existing link ID and return the next one
  const maxLinkId = Math.max(...uniqueLinkIds);
  return maxLinkId + 1;
}

// Legacy bulk save endpoint removed - use specific endpoints instead:
// - POST /api/v1/collections/create for new collections
// - PUT /api/v1/collections/{id}/settings for updates

/**
 * GET /api/v1/collections/sync
 * Get collections sync status (simplified - no detailed progress)
 */
collectionsRoutes.get('/sync', (_req, res) => {
  return res.status(200).json({
    running: collectionsSync.running,
    message: collectionsSync.running
      ? 'Collections sync in progress'
      : 'Not running',
  });
});

/**
 * GET /api/v1/collections/sync/status
 * Get global collection sync status including last sync time and error information
 */
collectionsRoutes.get('/sync/status', async (_req, res) => {
  const settings = getSettings();
  const globalSyncStatus = settings.getGlobalSyncStatus();
  const syncStatus = collectionsSync.status;

  // Get next sync time from scheduled job
  let nextSyncAt: string | undefined;
  try {
    const { scheduledJobs } = await import('@server/job/schedule');
    const syncJob = scheduledJobs.find(
      (job) => job.id === 'plex-collections-sync'
    );
    if (syncJob?.job?.nextInvocation) {
      nextSyncAt = syncJob.job.nextInvocation().toISOString();
    }
  } catch (error) {
    // If we can't get next sync time, just omit it
  }

  return res.status(200).json({
    running: syncStatus.running,
    currentStage: syncStatus.currentStage,
    totalCollections: syncStatus.totalCollections,
    processedCollections: syncStatus.processedCollections,
    progress: syncStatus.progress,
    lastGlobalSyncAt: globalSyncStatus.lastGlobalSyncAt,
    globalSyncError: globalSyncStatus.globalSyncError,
    collectionsNeedingSync: globalSyncStatus.collectionsNeedingSync,
    nextSyncAt,
  });
});

/**
 * POST /api/v1/collections/sync
 * Start a collection sync in the background (fire-and-forget)
 */
collectionsRoutes.post('/sync', isAuthenticated(), async (req, res) => {
  try {
    // Start collection sync immediately in background with proper error handling
    collectionsSync.run().catch((error) => {
      logger.error('Background collections sync failed:', error);
    });

    logger.info('Manual Plex collections sync started in background');

    return res.status(200).json({
      status: 'success',
      message: 'Collections sync started in background',
    });
  } catch (error) {
    logger.error('Error starting collections sync:', error);

    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while starting collections sync',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/v1/collections/:id/sync
 * Sync a specific collection by ID
 */
collectionsRoutes.post('/:id/sync', isAuthenticated(), async (req, res) => {
  try {
    const { id } = req.params;
    const settings = getSettings().load();

    // Find the collection config by ID
    const collectionConfig = settings.plex.collectionConfigs?.find(
      (config) => config.id === id
    );

    if (!collectionConfig) {
      return res.status(404).json({
        status: 'error',
        message: `Collection with ID ${id} not found`,
      });
    }

    // Check if full sync is running before allowing individual sync
    const collectionsSync = (await import('@server/lib/collectionsSync'))
      .default;
    if (collectionsSync.running) {
      logger.warn(
        'Manual individual sync blocked - full sync is currently running',
        {
          label: 'Individual Collection Sync',
          collectionId: id,
          collectionName: collectionConfig.name,
        }
      );
      return res.status(409).json({
        status: 'error',
        message:
          'Cannot start individual collection sync while a full sync is running. Please wait for the full sync to complete.',
      });
    }

    logger.info(
      `Starting manual sync for collection: ${collectionConfig.name}`,
      {
        label: 'Individual Collection Sync',
        collectionId: id,
        collectionName: collectionConfig.name,
      }
    );

    // Import the collection sync service
    const { collectionSyncService } = await import(
      '@server/lib/collections/services/CollectionSyncService'
    );

    // Get admin user for Plex token using the same utility as global sync
    const { getAdminUser } = await import(
      '@server/lib/collections/core/CollectionUtilities'
    );
    const admin = await getAdminUser();

    if (!admin) {
      return res.status(500).json({
        status: 'error',
        message: 'Admin user not found',
      });
    }

    const plexClient = new PlexAPI({
      plexToken: admin.plexToken,
      plexSettings: settings.plex,
    });

    // Start individual collection sync
    const syncPromise = (async () => {
      try {
        // Check if this is a multi-source collection
        const extendedConfig = collectionConfig as typeof collectionConfig & {
          isMultiSource?: boolean;
          sources?: {
            id: string;
            type: string;
            subtype?: string;
            customUrl?: string;
            timePeriod?: string;
            customDays?: number;
            minimumPlays?: number;
            priority: number;
            networksCountry?: string;
            radarrTagServerId?: number;
            radarrTagId?: number;
            radarrTagLabel?: string;
            sonarrTagServerId?: number;
            sonarrTagId?: number;
            sonarrTagLabel?: string;
          }[];
          combineMode?: 'ordered' | 'randomized' | 'cycle';
        };
        const isMultiSource =
          extendedConfig.isMultiSource &&
          (extendedConfig.sources?.length ?? 0) > 0;
        const allCollections = await plexClient.getAllCollections();

        // Use global library cache for content matching (with proper pagination)
        const libraryCache = await libraryCacheService.getCache(plexClient);

        let result;
        if (isMultiSource) {
          // Use multi-source orchestrator
          const { MultiSourceOrchestrator } = await import(
            '@server/lib/collections/services/MultiSourceOrchestrator'
          );
          const orchestrator = new MultiSourceOrchestrator();

          // Convert to MultiSourceCollectionConfig format
          const multiSourceConfig = {
            ...extendedConfig,
            type: 'multi-source' as const,
            sources:
              extendedConfig.sources?.map((source) => ({
                id: source.id,
                type: source.type as MultiSourceType,
                subtype: source.subtype || '',
                customUrl: source.customUrl,
                timePeriod: source.timePeriod as
                  | 'daily'
                  | 'weekly'
                  | 'monthly'
                  | 'all',
                customDays: source.customDays,
                minimumPlays: source.minimumPlays,
                priority: source.priority,
                networksCountry: source.networksCountry,
                radarrTagServerId: source.radarrTagServerId,
                radarrTagId: source.radarrTagId,
                radarrTagLabel: source.radarrTagLabel,
                sonarrTagServerId: source.sonarrTagServerId,
                sonarrTagId: source.sonarrTagId,
                sonarrTagLabel: source.sonarrTagLabel,
              })) || [],
            combineMode:
              (extendedConfig.combineMode as
                | MultiSourceCombineMode
                | undefined) ?? 'list_order',
          };

          result = await orchestrator.processMultiSourceCollection(
            multiSourceConfig,
            plexClient,
            allCollections,
            new Set(),
            libraryCache
          );
        } else {
          // Use normal single-source sync
          const syncService = await collectionSyncService.createSyncService(
            collectionConfig.type
          );
          result = await syncService.processCollections(
            [collectionConfig],
            plexClient,
            allCollections,
            new Set(),
            libraryCache
          );
        }

        // Check if the sync returned an error (e.g., from multi-source orchestrator)
        if (result.error) {
          logger.warn(
            `Individual collection sync returned error for ${collectionConfig.name}: ${result.error}`,
            {
              label: 'Individual Collection Sync',
              collectionId: id,
            }
          );
          // Persist error for UI display
          settings.setCollectionSyncError(id, result.error);
          settings.save();
        } else {
          // Mark collection as synced (update needsSync status, clears any previous error)
          settings.markCollectionSynced(id, 'collection');
          settings.save();
        }

        // Sync Plex collection ordering after collection sync
        const { HubSyncService } = await import(
          '@server/lib/collections/plex/HubSyncService'
        );
        const hubSyncService = new HubSyncService();
        await hubSyncService.syncUnifiedOrdering(plexClient);

        logger.info(
          `Individual collection sync completed: ${collectionConfig.name}`,
          {
            label: 'Individual Collection Sync',
            collectionId: id,
            result,
            hasError: !!result.error,
          }
        );

        return result;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.error(
          `Individual collection sync failed for ${collectionConfig.name}: ${error}`,
          {
            label: 'Individual Collection Sync',
            collectionId: id,
            error: errorMessage,
          }
        );
        // Persist error for UI display
        settings.setCollectionSyncError(id, errorMessage);
        settings.save();
        throw error;
      }
    })();

    // Start sync in background
    syncPromise.catch((error) => {
      logger.error(
        `Background individual collection sync failed for ${collectionConfig.name}:`,
        error
      );
    });

    return res.status(200).json({
      status: 'success',
      message: `Collection sync started for "${collectionConfig.name}"`,
      collectionId: id,
      collectionName: collectionConfig.name,
    });
  } catch (error) {
    logger.error('Error starting individual collection sync:', error);

    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while starting collection sync',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/v1/collections/preview-template
 * Preview a collection template with given context
 */
collectionsRoutes.post(
  '/preview-template',
  isAuthenticated(),
  async (req, res) => {
    try {
      const { template, mediaType, type, subtype, customDays } = req.body;

      if (!template) {
        return res.status(400).json({
          status: 'error',
          message: 'Template is required',
        });
      }

      if (!mediaType || !['movie', 'tv'].includes(mediaType)) {
        return res.status(400).json({
          status: 'error',
          message: 'Valid mediaType (movie or tv) is required',
        });
      }

      // Create appropriate context based on collection type
      let context;
      switch (type) {
        case 'trakt':
          context = templateEngine.createTraktContext(mediaType, subtype || '');
          break;
        case 'tmdb':
          context = templateEngine.createTmdbContext(mediaType, subtype || '');
          break;
        case 'imdb':
          context = templateEngine.createImdbContext(mediaType, subtype || '');
          break;
        case 'letterboxd':
          context = templateEngine.createLetterboxdContext(
            mediaType,
            subtype || ''
          );
          break;
        case 'tautulli':
          context = templateEngine.createTautulliContext(
            mediaType,
            customDays || 30,
            'plays',
            subtype || ''
          );
          break;
        case 'anilist':
          context = templateEngine.createAnilistContext(
            mediaType,
            subtype || ''
          );
          break;
        case 'overseerr':
          context = templateEngine.createGlobalContext(mediaType);
          break;
        default:
          context = templateEngine.createGlobalContext(mediaType);
      }

      // Process the template
      const preview = templateEngine.processTemplate(template, context);

      return res.status(200).json({
        status: 'success',
        preview: preview,
      });
    } catch (error) {
      logger.error('Error previewing template', {
        label: 'Collections API',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      });

      return res.status(500).json({
        status: 'error',
        message: 'Internal server error while previewing template',
      });
    }
  }
);

// GET /api/v1/collections/preexisting - Get pre-existing Plex collections (non-Overseerr)
collectionsRoutes.get('/preexisting', isAuthenticated(), async (_req, res) => {
  try {
    const settings = getSettings().load();

    if (!settings.plex.ip || !settings.plex.port) {
      return res.status(400).json({
        error: 'Plex server not configured',
      });
    }

    // Get admin user for Plex token
    const userRepository = getRepository(User);
    const adminUser = await userRepository.findOne({
      where: { id: 1 },
      select: ['id', 'plexToken'],
    });

    if (!adminUser?.plexToken) {
      return res.status(400).json({
        error: 'No Plex token found for admin user',
      });
    }

    const plexClient = new PlexAPI({
      plexToken: adminUser.plexToken,
      plexSettings: settings.plex,
    });

    // Test connection
    const statusResult = await plexClient.getStatus();
    if (!statusResult) {
      return res.status(500).json({
        error: 'Unable to connect to Plex server',
      });
    }

    // Get all collections from Plex
    const allCollections = await plexClient.getAllCollections();

    // Filter out collections that have Overseerr labels (case insensitive)
    const preExistingCollections = allCollections.filter(
      (collection: PlexCollection) => {
        // Collections WITHOUT Overseerr labels are pre-existing
        return !(
          Array.isArray(collection.labels) &&
          collection.labels.some((label: PlexLabel) =>
            getLabelText(label).toLowerCase().startsWith('agregarr')
          )
        );
      }
    );

    logger.info(
      `Found ${preExistingCollections.length} pre-existing Plex collections`,
      {
        label: 'Collections API',
        totalCollections: allCollections.length,
        preExistingCount: preExistingCollections.length,
      }
    );

    return res.status(200).json({
      collections: preExistingCollections.map((collection: PlexCollection) => ({
        id: collection.ratingKey,
        name: collection.title,
        summary: collection.summary || '',
        libraryId: collection.librarySectionID,
        libraryTitle: collection.librarySectionTitle,
        itemCount: collection.childCount || 0,
        thumb: collection.thumb || '',
        art: collection.art || '',
        guid: collection.guid || '',
        updatedAt: collection.updatedAt,
        addedAt: collection.addedAt,
        labels: collection.labels || [],
      })),
    });
  } catch (error) {
    logger.error('Failed to fetch pre-existing collections', {
      label: 'Collections API',
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      error: 'Failed to fetch pre-existing collections',
    });
  }
});

/**
 * PATCH /api/v1/collections/:id/promote
 * Promote a collection from A-Z section to promoted section
 */
collectionsRoutes.patch('/:id/promote', isAuthenticated(), async (req, res) => {
  try {
    const { id } = req.params;
    const settings = getSettings();
    const collectionConfigs = settings.plex.collectionConfigs || [];

    // Find the collection to promote
    const configIndex = collectionConfigs.findIndex(
      (config) => config.id === id
    );
    if (configIndex === -1) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    const config = collectionConfigs[configIndex];

    // Check if already promoted
    if (config.isLibraryPromoted) {
      return res
        .status(400)
        .json({ error: 'Collection is already in promoted section' });
    }

    // Find the next available sortOrderLibrary for this library
    const sameLibraryConfigs = collectionConfigs.filter(
      (c) => c.libraryId === config.libraryId && c.isLibraryPromoted === true
    );
    const maxSortOrder =
      sameLibraryConfigs.length > 0
        ? Math.max(...sameLibraryConfigs.map((c) => c.sortOrderLibrary || 0))
        : 0;

    // Update the collection to promoted status
    collectionConfigs[configIndex] = {
      ...config,
      isLibraryPromoted: true,
      sortOrderLibrary: maxSortOrder + 1,
    };

    // Save settings
    settings.plex.collectionConfigs = collectionConfigs;
    settings.save();

    logger.info(`Promoted collection ${config.name} to promoted section`, {
      label: 'Collections API',
      collectionId: id,
      newSortOrderLibrary: maxSortOrder + 1,
    });

    return res.json({ success: true, config: collectionConfigs[configIndex] });
  } catch (error) {
    logger.error(`Failed to promote collection ${req.params.id}`, {
      label: 'Collections API',
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({ error: 'Failed to promote collection' });
  }
});

/**
 * PATCH /api/v1/collections/:id/demote
 * Demote a collection from promoted section to A-Z section
 */
collectionsRoutes.patch('/:id/demote', isAuthenticated(), async (req, res) => {
  try {
    const { id } = req.params;
    const settings = getSettings();
    const collectionConfigs = settings.plex.collectionConfigs || [];

    // Find the collection to demote
    const configIndex = collectionConfigs.findIndex(
      (config) => config.id === id
    );
    if (configIndex === -1) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    const config = collectionConfigs[configIndex];

    // Check if already in A-Z section
    if (!config.isLibraryPromoted) {
      return res
        .status(400)
        .json({ error: 'Collection is already in A-Z section' });
    }

    // Update the collection to A-Z status
    collectionConfigs[configIndex] = {
      ...config,
      isLibraryPromoted: false,
      sortOrderLibrary: 0, // A-Z collections have sortOrderLibrary: 0
    };

    // Save settings
    settings.plex.collectionConfigs = collectionConfigs;
    settings.save();

    logger.info(`Demoted collection ${config.name} to A-Z section`, {
      label: 'Collections API',
      collectionId: id,
    });

    return res.json({ success: true, config: collectionConfigs[configIndex] });
  } catch (error) {
    logger.error(`Failed to demote collection ${req.params.id}`, {
      label: 'Collections API',
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({ error: 'Failed to demote collection' });
  }
});

/**
 * Get available countries for Networks collections
 */
collectionsRoutes.get('/networks/countries', async (_req, res) => {
  try {
    logger.debug('Fetching available countries for Networks collections', {
      label: 'Collections API',
    });

    const { default: FlixPatrolAPI } = await import('@server/api/flixpatrol');
    const flixpatrolClient = new FlixPatrolAPI();

    const countryStrings = await flixpatrolClient.getAvailableCountries();

    // Convert to the format expected by frontend dropdowns
    const countries = countryStrings.map((country) => ({
      value: country,
      label: country.charAt(0).toUpperCase() + country.slice(1), // Capitalize first letter
    }));

    logger.debug(`Retrieved ${countries.length} countries for Networks`, {
      label: 'Collections API',
      count: countries.length,
    });

    return res.json(countries);
  } catch (error) {
    logger.error('Failed to fetch Networks countries:', {
      label: 'Collections API',
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      error: 'Failed to load available countries',
    });
  }
});

/**
 * Get available platforms for a specific country (on-demand caching)
 */
collectionsRoutes.get('/networks/platforms', async (req, res) => {
  try {
    const country = req.query.country as string;

    if (!country) {
      return res.status(400).json({
        error: 'Country parameter is required',
      });
    }

    logger.debug(`Fetching platforms for country: ${country}`, {
      label: 'Collections API',
      country,
    });

    const { default: FlixPatrolAPI } = await import('@server/api/flixpatrol');
    const flixpatrolClient = new FlixPatrolAPI();

    const platforms = await flixpatrolClient.getAvailablePlatformsForCountry(
      country
    );

    logger.debug(`Retrieved ${platforms.length} platforms for ${country}`, {
      label: 'Collections API',
      country,
      count: platforms.length,
    });

    return res.json(platforms);
  } catch (error) {
    logger.error(
      `Failed to fetch platforms for country ${req.query.country}:`,
      {
        label: 'Collections API',
        country: req.query.country,
        error: error instanceof Error ? error.message : String(error),
      }
    );

    return res.status(500).json({
      error: `Failed to load platforms for ${
        req.query.country || 'selected country'
      }`,
    });
  }
});

/**
 * Get available streaming providers for Originals collections
 * Based on Kometa's curated MDBList collections
 */
collectionsRoutes.get('/originals/providers', async (_req, res) => {
  try {
    logger.debug('Fetching available providers for Originals collections', {
      label: 'Collections API',
    });

    const providers = OriginalsCollectionSync.getProviderOptions();

    logger.debug(`Returning ${providers.length} originals providers`, {
      label: 'Collections API',
      providersCount: providers.length,
    });

    return res.status(200).json(providers);
  } catch (error) {
    logger.error('Failed to fetch originals providers', {
      label: 'Collections API',
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      error: 'Failed to load streaming providers for originals',
    });
  }
});

// Mount preview routes
import collectionsPreviewRoutes from './collections-preview';
collectionsRoutes.use('/preview', collectionsPreviewRoutes);

// Mount fetch-title routes
import fetchTitleRoutes from './fetch-title';
collectionsRoutes.use('/fetch-title', fetchTitleRoutes);

// Mount media-type routes
import mediaTypeRoutes from './media-type';
collectionsRoutes.use('/detect-media-type', mediaTypeRoutes);

// Mount poster routes (at root level since they have varied paths)
import collectionPostersRoutes from './collection-posters';
collectionsRoutes.use('/', collectionPostersRoutes);

export default collectionsRoutes;
