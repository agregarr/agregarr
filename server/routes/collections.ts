import PlexAPI from '@server/api/plexapi';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import type { PlexCollection } from '@server/lib/collections/core/types';
import { libraryCacheService } from '@server/lib/collections/services/LibraryCacheService';
import { templateEngine } from '@server/lib/collections/utils/TemplateEngine';
import { TimeRestrictionUtils } from '@server/lib/collections/utils/TimeRestrictionUtils';
import collectionsSync from '@server/lib/collectionsSync';
import type { PosterGenerationConfig } from '@server/lib/posterGeneration';
import {
  downloadAndSavePoster,
  generatePoster,
  getPosterUrl,
  initializePosterStorage,
  savePosterFile,
} from '@server/lib/posterStorage';
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

const rateLimiter = new RateLimiter();

/**
 * Validate and sanitize external URLs for security
 */
function validateExternalUrl(
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
      trakt: ['trakt.tv'],
      tmdb: ['www.themoviedb.org', 'themoviedb.org'],
      imdb: ['www.imdb.com', 'imdb.com'],
      mdblist: ['mdblist.com', 'www.mdblist.com'],
      letterboxd: ['letterboxd.com', 'www.letterboxd.com'],
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
              'Invalid Trakt list URL format. Expected: https://trakt.tv/users/username/lists/listname or https://trakt.tv/lists/official/collection-name',
          };
        }
        break;
      case 'tmdb':
        if (!urlObj.pathname.match(/^\/(collection|list)\/\d+/)) {
          return {
            isValid: false,
            error:
              'Invalid TMDB URL format. Expected: https://www.themoviedb.org/collection/123456 or https://www.themoviedb.org/list/310',
          };
        }
        break;
      case 'imdb':
        if (!urlObj.pathname.match(/^\/list\/ls\d+\/?$/)) {
          return {
            isValid: false,
            error:
              'Invalid IMDb list URL format. Expected: https://www.imdb.com/list/ls123456789',
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
        if (!urlObj.pathname.match(/^\/[^/]+\/list\/[^/?]+\/?$/)) {
          return {
            isValid: false,
            error:
              'Invalid Letterboxd list URL format. Expected: https://letterboxd.com/username/list/listname',
          };
        }
        break;
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

// Initialize poster storage directory
initializePosterStorage();

// Configure multer for poster uploads
const posterUpload = multer({
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
  return res.status(200).json({
    collectionConfigs: settings.plex.collectionConfigs || [],
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

      // Merge settings while preserving computed fields and library-specific fields
      const updatedConfig: CollectionConfig = {
        ...configToUpdate, // Preserve all existing fields including computed ones
        ...req.body, // Apply user changes
        name: processedName, // Use processed template name
        // Override customPoster with library-specific value
        customPoster:
          customPosterForThisLibrary !== undefined
            ? customPosterForThisLibrary
            : configToUpdate.customPoster,
        // Ensure computed fields stay computed:
        id: configToUpdate.id, // ID never changes
        isActive: configToUpdate.isActive, // Preserve sync service's isActive calculation
        // For linked collections, preserve library-specific fields
        libraryId: configToUpdate.libraryId, // Don't change the library assignment
        libraryName: configToUpdate.libraryName, // Don't change the library name
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

    // Clean up smart collections for configs that have them
    try {
      // Get admin user for Plex token
      const { getAdminUser } = await import(
        '@server/lib/collections/core/CollectionUtilities'
      );
      const localAdmin = await getAdminUser();

      if (!localAdmin?.plexToken) {
        logger.warn(
          'No local admin Plex token found for smart collection cleanup'
        );
        // Continue with normal collection deletion even if smart cleanup fails
      } else {
        const plexClient = new PlexAPI({
          plexToken: localAdmin.plexToken,
          plexSettings: settings.plex,
        });

        for (const config of configsToDelete) {
          if (config.smartCollectionRatingKey) {
            logger.info(
              `Deleting smart collection for config "${config.name}"`,
              {
                label: 'Collections API',
                configId: config.id,
                smartCollectionRatingKey: config.smartCollectionRatingKey,
              }
            );

            try {
              await plexClient.deleteSmartCollection(
                config.smartCollectionRatingKey
              );
              logger.debug(
                `Successfully deleted smart collection ${config.smartCollectionRatingKey}`,
                {
                  label: 'Collections API',
                  configId: config.id,
                }
              );
            } catch (error) {
              logger.warn(
                `Failed to delete smart collection ${config.smartCollectionRatingKey}`,
                {
                  label: 'Collections API',
                  configId: config.id,
                  error: error instanceof Error ? error.message : String(error),
                }
              );
              // Don't fail the whole deletion if smart collection cleanup fails
            }
          }
        }
      }
    } catch (error) {
      logger.warn('Error during smart collection cleanup', {
        label: 'Collections API',
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't fail the whole deletion if smart collection cleanup fails
    }

    // Remove the configs
    const deletedConfigIds = configsToDelete.map((c) => c.id);
    const remainingConfigs = configs.filter(
      (c) => !deletedConfigIds.includes(c.id)
    );

    // Save updated configs (auto-reordering will handle sort order cleanup)
    settings.plex.collectionConfigs = remainingConfigs;
    settings.save();

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
        isLibraryPromoted: true, // All new Agregarr collections start in promoted section
        everLibraryPromoted: true, // New collections start promoted, so mark as ever promoted
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
            priority: number;
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

        // Mark collection as synced (update needsSync status)
        settings.markCollectionSynced(id, 'collection');
        settings.save();

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
          }
        );

        return result;
      } catch (error) {
        logger.error(
          `Individual collection sync failed for ${collectionConfig.name}: ${error}`,
          {
            label: 'Individual Collection Sync',
            collectionId: id,
            error: error instanceof Error ? error.message : String(error),
          }
        );
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
 * POST /api/v1/collections/fetch-title
 * Fetch title from external collection URL
 */
collectionsRoutes.post('/fetch-title', isAuthenticated(), async (req, res) => {
  try {
    const { url, type } = req.body;

    if (!url || !type) {
      return res.status(400).json({
        status: 'error',
        message: 'URL and type are required',
      });
    }

    // Check rate limiting (per user)
    const userId = req.user?.id?.toString() || req.ip || 'anonymous';
    if (!rateLimiter.isAllowed(userId)) {
      return res.status(429).json({
        status: 'error',
        message: 'Too many requests. Please wait before trying again.',
      });
    }

    // Validate and sanitize the URL
    const validation = validateExternalUrl(url, type);
    if (!validation.isValid) {
      return res.status(400).json({
        status: 'error',
        message: validation.error,
      });
    }

    if (!validation.sanitizedUrl) {
      return res.status(400).json({
        status: 'error',
        message: 'URL sanitization failed',
      });
    }
    const sanitizedUrl = validation.sanitizedUrl;

    let title: string | null = null;
    let mediaType: 'movie' | 'tv' | 'both' | 'mixed' | null = null;
    let contentTypes: string[] = [];

    switch (type) {
      case 'trakt': {
        const TraktAPI = (await import('@server/api/trakt')).default;
        const settings = getSettings();

        if (!settings.trakt.apiKey) {
          return res.status(400).json({
            status: 'error',
            message: 'Trakt API key not configured',
          });
        }

        const traktClient = new TraktAPI(settings.trakt.apiKey);

        // Get list metadata to extract real title, then validate with items
        try {
          // First get the real list title from metadata
          const listMetadata = await traktClient.getListMetadata(sanitizedUrl);
          title = listMetadata.name || 'Trakt List';

          // Then validate list accessibility with first 10 items
          const listData = await traktClient.getCustomList(sanitizedUrl, 10);
          if (listData && listData.length >= 0) {
            // Quick media type detection from first 10 items
            if (listData.length > 0) {
              const hasMovies = listData.some(
                (item) => item.type === 'movie' || item.movie
              );
              const hasShows = listData.some(
                (item) => (item.type === 'show' || item.show) && !item.episode
              );
              const hasEpisodes = listData.some((item) => item.episode);

              contentTypes = [];
              if (hasMovies) contentTypes.push('movies');
              if (hasShows) contentTypes.push('shows');
              if (hasEpisodes) contentTypes.push('episodes');

              if (contentTypes.length > 1) {
                mediaType = 'mixed'; // New type for mixed content
              } else if (hasMovies) {
                mediaType = 'movie';
              } else if (hasShows || hasEpisodes) {
                mediaType = 'tv';
              }
            }
          }
        } catch (error) {
          return res.status(400).json({
            status: 'error',
            message: 'Invalid Trakt list URL or list not accessible',
          });
        }
        break;
      }

      case 'tmdb': {
        const TheMovieDb = (await import('@server/api/themoviedb')).default;
        const tmdbClient = new TheMovieDb();

        try {
          // Check if it's a collection URL
          const collectionMatch = sanitizedUrl.match(
            /themoviedb\.org\/collection\/(\d+)/
          );
          // Check if it's a list URL
          const listMatch = sanitizedUrl.match(/themoviedb\.org\/list\/(\d+)/);

          if (collectionMatch) {
            const collectionId = parseInt(collectionMatch[1]);
            const collection = await tmdbClient.getCollection({ collectionId });
            title = collection.name;
            mediaType = 'movie'; // TMDB collections are always movies
          } else if (listMatch) {
            const listId = listMatch[1];
            const list = await tmdbClient.getList({ listId });
            title = list.name;

            // Detect media type from list content (similar to Trakt)
            if (list.items && list.items.length > 0) {
              const hasMovies = list.items.some(
                (item) => item.media_type === 'movie' || item.title
              );
              const hasShows = list.items.some(
                (item) => item.media_type === 'tv' || item.name
              );
              if (hasMovies && hasShows) {
                mediaType = 'both';
              } else if (hasMovies) {
                mediaType = 'movie';
              } else if (hasShows) {
                mediaType = 'tv';
              } else {
                mediaType = 'both'; // Fallback if we can't determine
              }
            } else {
              mediaType = 'both'; // Fallback for empty lists
            }
          } else {
            return res.status(400).json({
              status: 'error',
              message: 'Invalid TMDB URL format',
            });
          }
        } catch (error) {
          return res.status(400).json({
            status: 'error',
            message: 'Invalid TMDB collection/list ID or not found',
          });
        }
        break;
      }

      case 'imdb': {
        // For IMDb, we'll need to scrape the title from the page
        const axios = (await import('axios')).default;

        try {
          const urlMatch = sanitizedUrl.match(/imdb\.com\/list\/(ls\d+)/);
          if (!urlMatch) {
            return res.status(400).json({
              status: 'error',
              message: 'Invalid IMDb list URL format',
            });
          }

          const response = await axios.get(sanitizedUrl, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            },
            timeout: 10000,
          });

          // Extract title from HTML
          const titleMatch = response.data.match(/<title>([^<]+)<\/title>/i);
          if (titleMatch) {
            let extractedTitle = titleMatch[1].replace(' - IMDb', '').trim();

            // Decode HTML entities (same as RandomListManager and Letterboxd)
            extractedTitle = extractedTitle
              .replace(/&lrm;/g, '') // Remove left-to-right mark
              .replace(/&rlm;/g, '') // Remove right-to-left mark
              .replace(/&bull;/g, '•') // Replace bullet entity with actual bullet
              .replace(/&ndash;/g, '–') // Replace en-dash
              .replace(/&mdash;/g, '—') // Replace em-dash
              .replace(/&hellip;/g, '…') // Replace ellipsis
              .replace(/&quot;/g, '"') // Replace quotes
              .replace(/&#39;/g, "'") // Replace apostrophe
              .replace(/&#x27;/g, "'") // Replace hex-encoded apostrophe
              .replace(/&amp;/g, '&') // Replace ampersand (do this last)
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>');

            title = extractedTitle;
          }

          // Try to detect media type from the page content by analyzing list items
          const htmlContent = response.data;

          // Try multiple approaches to find list items
          let listItemMatches = htmlContent.match(
            /<li[^>]*class="[^"]*ipc-metadata-list-summary-item[^"]*"[^>]*>.*?<\/li>/gs
          );

          // If the first pattern doesn't work, try alternative patterns
          if (!listItemMatches) {
            listItemMatches =
              htmlContent.match(
                /<div[^>]*class="[^"]*titleColumn[^"]*"[^>]*>.*?<\/div>/gs
              ) ||
              htmlContent.match(
                /<div[^>]*class="[^"]*list[^"]*item[^"]*"[^>]*>.*?<\/div>/gs
              ) ||
              [];
          }

          let movieCount = 0;
          let showCount = 0;
          let episodeCount = 0;

          // Analyze up to 1000 items to determine media type accurately
          listItemMatches.slice(0, 1000).forEach((item: string) => {
            // Look for title type indicators in the structured data or metadata
            const lowerItem = item.toLowerCase();

            // Check for movie indicators
            if (
              lowerItem.includes('titletype-movie') ||
              lowerItem.includes('feature') ||
              lowerItem.includes('film') ||
              lowerItem.includes('"@type":"movie"') ||
              lowerItem.includes('(movie)') ||
              lowerItem.includes('feature film') ||
              lowerItem.includes('short film')
            ) {
              movieCount++;
            }
            // Check for episode indicators (more specific than shows)
            else if (
              lowerItem.includes('tv episode') ||
              lowerItem.includes('"@type":"episode"') ||
              lowerItem.includes('"@type":"tvepisode"') ||
              lowerItem.includes('(tv episode)') ||
              (lowerItem.includes('season') && lowerItem.includes('episode'))
            ) {
              episodeCount++;
            }
            // Check for TV show indicators (but not episodes)
            else if (
              lowerItem.includes('titletype-tv') ||
              lowerItem.includes('tv series') ||
              lowerItem.includes('tv mini-series') ||
              lowerItem.includes('tv movie') ||
              lowerItem.includes('"@type":"tvseries"') ||
              lowerItem.includes('(tv series)') ||
              lowerItem.includes('television')
            ) {
              showCount++;
            }
          });

          // Determine media type and content types based on what we found
          contentTypes = [];
          if (movieCount > 0) contentTypes.push('movies');
          if (showCount > 0) contentTypes.push('shows');
          if (episodeCount > 0) contentTypes.push('episodes');

          const totalTvContent = showCount + episodeCount;

          if (contentTypes.length > 1) {
            mediaType = 'mixed';
          } else if (movieCount > 0 && totalTvContent === 0) {
            mediaType = 'movie';
          } else if (totalTvContent > 0 && movieCount === 0) {
            mediaType = 'tv';
          } else if (movieCount > 0 && totalTvContent > 0) {
            mediaType = 'mixed';
          } else {
            // Fallback: try to detect from page title or description
            const lowerContent = htmlContent.toLowerCase();
            if (
              lowerContent.includes('movie list') ||
              lowerContent.includes('film list')
            ) {
              mediaType = 'movie';
              contentTypes = ['movies'];
            } else if (
              lowerContent.includes('tv list') ||
              lowerContent.includes('television list') ||
              lowerContent.includes('series list')
            ) {
              mediaType = 'tv';
              contentTypes = ['shows'];
            } else {
              mediaType = 'movie'; // Default when we can't determine
              contentTypes = ['movies'];
            }
          }
        } catch (error) {
          return res.status(400).json({
            status: 'error',
            message: 'Could not fetch IMDb list title',
          });
        }
        break;
      }

      case 'letterboxd': {
        // For Letterboxd, we'll need to scrape the title from the page
        const axios = (await import('axios')).default;

        try {
          const urlMatch = sanitizedUrl.match(
            /letterboxd\.com\/([^/]+)\/list\/([^/?]+)/
          );
          if (!urlMatch) {
            return res.status(400).json({
              status: 'error',
              message: 'Invalid Letterboxd list URL format',
            });
          }

          const response = await axios.get(sanitizedUrl, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            },
            timeout: 10000,
          });

          // Extract title from HTML and clean it up
          const titleMatch = response.data.match(/<title>([^<]+)<\/title>/i);
          if (titleMatch) {
            let rawTitle = titleMatch[1];

            // Decode HTML entities
            rawTitle = rawTitle
              .replace(/&lrm;/g, '') // Remove left-to-right mark
              .replace(/&rlm;/g, '') // Remove right-to-left mark
              .replace(/&bull;/g, '•') // Replace bullet entity with actual bullet
              .replace(/&ndash;/g, '–') // Replace en-dash
              .replace(/&mdash;/g, '—') // Replace em-dash
              .replace(/&hellip;/g, '…') // Replace ellipsis
              .replace(/&quot;/g, '"') // Replace quotes
              .replace(/&#39;/g, "'") // Replace apostrophe
              .replace(/&amp;/g, '&') // Replace ampersand (do this last)
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>');

            // Extract list name (everything before " • Letterboxd" or ", a list of films by")
            const patterns = [
              /^(.*?),\s*a\s+list\s+of\s+films?\s+by/i, // ", a list of films by"
              /^(.*?)\s*•\s*Letterboxd/i, // " • Letterboxd"
              /^(.*?)\s*-\s*Letterboxd/i, // " - Letterboxd"
              /^(.*?)\s*\|\s*Letterboxd/i, // " | Letterboxd"
            ];

            for (const pattern of patterns) {
              const match = rawTitle.match(pattern);
              if (match && match[1]) {
                title = match[1].trim();
                break;
              }
            }

            // If no pattern matched, use fallback cleanup
            if (!title) {
              title = rawTitle
                .replace(/\s*•\s*Letterboxd.*$/i, '') // Remove " • Letterboxd" suffix
                .replace(/\s*-\s*Letterboxd.*$/i, '') // Remove " - Letterboxd" suffix
                .replace(/\s*\|\s*Letterboxd.*$/i, '') // Remove " | Letterboxd" suffix
                .trim();
            }
          }

          // For Letterboxd, assume movies by default since it's primarily a film platform
          mediaType = 'movie';
        } catch (error) {
          return res.status(400).json({
            status: 'error',
            message: 'Could not fetch Letterboxd list title',
          });
        }
        break;
      }

      case 'mdblist': {
        const MDBListAPI = (await import('@server/api/mdblist')).default;
        const settings = getSettings();

        if (!settings.mdblist.apiKey) {
          return res.status(400).json({
            status: 'error',
            message: 'MDBList API key not configured',
          });
        }

        const mdblistClient = new MDBListAPI(settings.mdblist.apiKey);

        try {
          // Parse URL to get username and list name
          const parsedUrl = mdblistClient.parseListUrl(sanitizedUrl);
          if (!parsedUrl) {
            return res.status(400).json({
              status: 'error',
              message: 'Invalid MDBList URL format',
            });
          }

          // Get list metadata to extract title
          if (
            parsedUrl.type === 'user' &&
            parsedUrl.username &&
            parsedUrl.listName
          ) {
            const userLists = await mdblistClient.getUserListsByUsername(
              parsedUrl.username
            );
            const targetList = userLists.find(
              (list) =>
                list.slug === parsedUrl.listName ||
                list.name.toLowerCase().replace(/\s+/g, '-') ===
                  parsedUrl.listName
            );
            if (targetList) {
              title = targetList.name;
            }
          }

          // Validate list accessibility and get data with first 10 items
          const listData = await mdblistClient.getCustomList(sanitizedUrl, {
            limit: 10,
          });

          // Quick media type detection from first 10 items
          const movies = listData.movies || [];
          const shows = listData.shows || [];

          if (movies.length > 0 && shows.length > 0) {
            mediaType = 'both';
          } else if (movies.length > 0) {
            mediaType = 'movie';
          } else if (shows.length > 0) {
            mediaType = 'tv';
          }
        } catch (error) {
          return res.status(400).json({
            status: 'error',
            message: 'Invalid MDBList list URL or list not accessible',
          });
        }
        break;
      }

      default:
        return res.status(400).json({
          status: 'error',
          message: 'Unsupported collection type',
        });
    }

    if (!title) {
      return res.status(400).json({
        status: 'error',
        message: 'Could not extract title from URL',
      });
    }

    return res.status(200).json({
      status: 'success',
      title: title,
      mediaType: mediaType,
      contentTypes: contentTypes,
    });
  } catch (error) {
    logger.error('Error fetching collection title', {
      label: 'Collections API',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });

    return res.status(500).json({
      status: 'error',
      message: 'Internal server error while fetching title',
    });
  }
});

/**
 * POST /api/v1/collections/detect-media-type
 * Comprehensively analyze media type from external collection URL
 */
collectionsRoutes.post(
  '/detect-media-type',
  isAuthenticated(),
  async (req, res) => {
    try {
      const { url, type } = req.body;

      if (!url || !type) {
        return res.status(400).json({
          status: 'error',
          message: 'URL and type are required',
        });
      }

      // Check rate limiting (per user)
      const userId = req.user?.id?.toString() || req.ip || 'anonymous';
      if (!rateLimiter.isAllowed(userId)) {
        return res.status(429).json({
          status: 'error',
          message: 'Too many requests. Please wait before trying again.',
        });
      }

      // Validate and sanitize the URL
      const validation = validateExternalUrl(url, type);
      if (!validation.isValid) {
        return res.status(400).json({
          status: 'error',
          message: validation.error,
        });
      }

      if (!validation.sanitizedUrl) {
        return res.status(400).json({
          status: 'error',
          message: 'URL sanitization failed',
        });
      }
      const sanitizedUrl = validation.sanitizedUrl;

      let mediaType: 'movie' | 'tv' | 'both' | null = null;

      switch (type) {
        case 'trakt': {
          const TraktAPI = (await import('@server/api/trakt')).default;
          const settings = getSettings();

          if (!settings.trakt.apiKey) {
            return res.status(400).json({
              status: 'error',
              message: 'Trakt API key not configured',
            });
          }

          const traktClient = new TraktAPI(settings.trakt.apiKey);

          // Comprehensive media type analysis with full list (up to 1000 items)
          try {
            const listData = await traktClient.getCustomList(
              sanitizedUrl,
              1000
            );
            if (listData && listData.length > 0) {
              const hasMovies = listData.some(
                (item) => item.type === 'movie' || item.movie
              );
              const hasShows = listData.some(
                (item) => item.type === 'show' || item.show
              );

              if (hasMovies && hasShows) {
                mediaType = 'both';
              } else if (hasMovies) {
                mediaType = 'movie';
              } else if (hasShows) {
                mediaType = 'tv';
              }
            }
          } catch (error) {
            return res.status(400).json({
              status: 'error',
              message: 'Failed to analyze list content',
            });
          }
          break;
        }

        case 'imdb': {
          // For IMDb, we'll need to scrape and analyze the comprehensive content
          const axios = (await import('axios')).default;

          try {
            const response = await axios.get(sanitizedUrl, {
              headers: {
                'User-Agent':
                  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
              },
              timeout: 10000,
            });

            const htmlContent = response.data;

            // Try multiple approaches to find list items
            let listItemMatches = htmlContent.match(
              /<li[^>]*class="[^"]*ipc-metadata-list-summary-item[^"]*"[^>]*>.*?<\/li>/gs
            );

            if (!listItemMatches) {
              listItemMatches =
                htmlContent.match(
                  /<div[^>]*class="[^"]*titleColumn[^"]*"[^>]*>.*?<\/div>/gs
                ) ||
                htmlContent.match(
                  /<div[^>]*class="[^"]*list[^"]*item[^"]*"[^>]*>.*?<\/div>/gs
                ) ||
                [];
            }

            let movieCount = 0;
            let tvCount = 0;

            // Analyze up to 1000 items to determine media type accurately
            listItemMatches.slice(0, 1000).forEach((item: string) => {
              const lowerItem = item.toLowerCase();

              // Check for movie indicators
              if (
                lowerItem.includes('titletype-movie') ||
                lowerItem.includes('feature') ||
                lowerItem.includes('film') ||
                lowerItem.includes('"@type":"movie"') ||
                lowerItem.includes('(movie)') ||
                lowerItem.includes('feature film') ||
                lowerItem.includes('short film')
              ) {
                movieCount++;
              }

              // Check for TV indicators
              if (
                lowerItem.includes('titletype-tv') ||
                lowerItem.includes('tv series') ||
                lowerItem.includes('tv episode') ||
                lowerItem.includes('tv mini-series') ||
                lowerItem.includes('tv movie') ||
                lowerItem.includes('"@type":"tvseries"') ||
                lowerItem.includes('"@type":"episode"') ||
                lowerItem.includes('(tv series)') ||
                lowerItem.includes('(tv episode)') ||
                lowerItem.includes('television')
              ) {
                tvCount++;
              }
            });

            // Determine media type based on comprehensive analysis
            if (movieCount > 0 && tvCount === 0) {
              mediaType = 'movie';
            } else if (tvCount > 0 && movieCount === 0) {
              mediaType = 'tv';
            } else if (movieCount > 0 && tvCount > 0) {
              mediaType = 'both';
            } else {
              // Fallback: try to detect from page title or description
              const lowerContent = htmlContent.toLowerCase();
              if (
                lowerContent.includes('movie list') ||
                lowerContent.includes('film list')
              ) {
                mediaType = 'movie';
              } else if (
                lowerContent.includes('tv list') ||
                lowerContent.includes('television list') ||
                lowerContent.includes('series list')
              ) {
                mediaType = 'tv';
              } else {
                mediaType = 'both'; // Default when we can't determine
              }
            }
          } catch (error) {
            return res.status(400).json({
              status: 'error',
              message: 'Failed to analyze IMDb list content',
            });
          }
          break;
        }

        case 'tmdb': {
          // TMDB collections are always movies
          mediaType = 'movie';
          break;
        }

        case 'letterboxd': {
          // Letterboxd is primarily a film platform
          mediaType = 'movie';
          break;
        }

        default:
          return res.status(400).json({
            status: 'error',
            message: 'Unsupported collection type',
          });
      }

      return res.status(200).json({
        status: 'success',
        mediaType: mediaType,
      });
    } catch (error) {
      logger.error('Error detecting media type', {
        label: 'Collections API',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      });

      return res.status(500).json({
        status: 'error',
        message: 'Internal server error while detecting media type',
      });
    }
  }
);

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

/**
 * Upload a poster image for collections
 * POST /api/v1/collections/poster
 */
collectionsRoutes.post(
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
collectionsRoutes.post(
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
collectionsRoutes.post(
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
collectionsRoutes.get('/posters', isAuthenticated(), async (req, res) => {
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
collectionsRoutes.get('/poster/:filename', async (req, res) => {
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
collectionsRoutes.delete('/poster/:filename', async (req, res) => {
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

export default collectionsRoutes;
