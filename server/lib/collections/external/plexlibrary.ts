/**
 * Plex Library Collection Sync
 *
 * Creates smart collections based on Plex library metadata (e.g., directors).
 */

import type PlexAPI from '@server/api/plexapi';
import TheMovieDb from '@server/api/themoviedb';
import axios from 'axios';
import { BaseCollectionSync } from '@server/lib/collections/core/BaseCollectionSync';
import {
  getCollectionMediaType,
  type LibraryItemsCache,
} from '@server/lib/collections/core/CollectionUtilities';
import type {
  CollectionItem,
  CollectionOperationResult,
  CollectionSourceData,
  CollectionSyncOptions,
  CollectionVisibilityConfig,
  FilteringStats,
  MissingItem,
  PlexCollection,
  PlexLabel,
  SyncResult,
} from '@server/lib/collections/core/types';
import { CollectionSyncErrorType } from '@server/lib/collections/core/types';
import { getTmdbLanguage, type CollectionConfig } from '@server/lib/settings';
import logger from '@server/logger';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';

type DirectorTmdbInfo = {
  tmdbPersonId: number;
  profilePath?: string;
  biography?: string;
};

const DIRECTOR_POSTER_WIDTH = 1000;
const DIRECTOR_POSTER_HEIGHT = 1500;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export class PlexLibraryCollectionSync extends BaseCollectionSync {
  constructor() {
    super('plex_library');
  }

  private sanitizeDirectorNameForLabel(name: string): string {
    const sanitized = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return sanitized || 'director';
  }

  private buildDirectorLabel(
    configId: string,
    slug: string | number
  ): string {
    const suffix = String(slug).toLowerCase();
    return `AgregarrAutoDirector-${configId}-${suffix}`;
  }

  private async addDirectorLabel(
    plexClient: PlexAPI,
    collectionRatingKey: string,
    label: string
  ): Promise<void> {
    try {
      await plexClient.addLabelToCollection(collectionRatingKey, label);
    } catch (labelError) {
      logger.warn(`Failed to add label "${label}" to director collection`, {
        label: 'Plex Library Collections',
        collectionRatingKey,
        error:
          labelError instanceof Error ? labelError.message : String(labelError),
      });
    }
  }

  private async fetchTmdbDirectorInfo(
    directorName: string
  ): Promise<DirectorTmdbInfo | null> {
    try {
      const tmdbClient = new TheMovieDb({
        originalLanguage: getTmdbLanguage(),
      });

      const searchResults = await tmdbClient.searchMulti({
        query: directorName,
        language: getTmdbLanguage(),
      });

      const personResult =
        searchResults.results.find(
          (result: { media_type?: string; name?: string }) =>
            result.media_type === 'person' &&
            result.name?.toLowerCase() === directorName.toLowerCase()
        ) ||
        searchResults.results.find(
          (result: { media_type?: string }) => result.media_type === 'person'
        );

      if (!personResult || !('id' in personResult)) {
        logger.debug(
          `No TMDB match found for director "${directorName}", skipping media lookups`,
          {
            label: 'Plex Library Collections',
            directorName,
          }
        );
        return null;
      }

      const personId = Number((personResult as any).id);

      const personDetails = await tmdbClient.getPerson({
        personId,
        language: getTmdbLanguage(),
      });

      return {
        tmdbPersonId: personId,
        profilePath:
          (personResult as any).profile_path || personDetails.profile_path || undefined,
        biography: personDetails.biography || undefined,
      };
    } catch (error) {
      logger.warn(
        `Failed to fetch TMDB director info for "${directorName}"`,
        {
          label: 'Plex Library Collections',
          directorName,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return null;
    }
  }

  private wrapDirectorName(name: string, maxLineLength = 16): string[] {
    const words = name.trim().split(/\s+/);
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (candidate.length <= maxLineLength) {
        currentLine = candidate;
      } else if (currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        // Single very long word - keep as is
        lines.push(candidate);
        currentLine = '';
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    if (lines.length > 2) {
      return [lines[0], lines.slice(1).join(' ')];
    }

    return lines;
  }

  private buildDirectorOverlaySvg(directorName: string): Buffer {
    const lines = this.wrapDirectorName(directorName.toUpperCase());
    const longestLine = lines.reduce((max, line) => Math.max(max, line.length), 0);

    let fontSize = 88;
    if (longestLine > 14) fontSize = 80;
    if (longestLine > 18) fontSize = 72;
    if (longestLine > 22) fontSize = 64;

    const lineHeight = fontSize * 1.05;
    const titleX = 70;
    const titleStartY = 150;
    const titleSvg = lines
      .map(
        (line, index) => `
          <text x="${titleX}" y="${titleStartY + index * lineHeight}"
                font-family="Helvetica Neue, Segoe UI, Arial, sans-serif"
                font-size="${fontSize}"
                font-weight="700"
                fill="#ffffff"
                letter-spacing="2"
                filter="url(#shadow)"
                dominant-baseline="hanging">
            ${escapeXml(line)}
          </text>`
      )
      .join('');

    const collectionY = titleStartY + lineHeight * lines.length + 60;
    const ruleY = collectionY + 16;
    const ruleEndX = DIRECTOR_POSTER_WIDTH - 80;

    const svg = `
      <svg width="${DIRECTOR_POSTER_WIDTH}" height="${DIRECTOR_POSTER_HEIGHT}" viewBox="0 0 ${DIRECTOR_POSTER_WIDTH} ${DIRECTOR_POSTER_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="topFade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#000" stop-opacity="0.75"/>
            <stop offset="45%" stop-color="#000" stop-opacity="0.35"/>
            <stop offset="80%" stop-color="#000" stop-opacity="0.05"/>
            <stop offset="100%" stop-color="#000" stop-opacity="0"/>
          </linearGradient>
          <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="6" stdDeviation="12" flood-color="#000" flood-opacity="0.4"/>
          </filter>
        </defs>
        <rect width="100%" height="100%" fill="url(#topFade)"/>
        ${titleSvg}
        <text x="${titleX}" y="${collectionY}"
              font-family="Helvetica Neue, Segoe UI, Arial, sans-serif"
              font-size="42"
              font-weight="600"
              fill="rgba(255,255,255,0.7)"
              letter-spacing="6"
              filter="url(#shadow)"
              dominant-baseline="hanging">
          COLLECTION
        </text>
        <line x1="${titleX}" y1="${ruleY}" x2="${ruleEndX}" y2="${ruleY}"
              stroke="rgba(255,255,255,0.35)"
              stroke-width="3"
              stroke-linecap="round"/>
      </svg>
    `;

    return Buffer.from(svg);
  }

  private async generateDirectorPosterWithOverlay(
    directorName: string,
    imageUrl: string
  ): Promise<string | null> {
    let tempPosterPath: string | null = null;

    try {
      const response = await axios.get<ArrayBuffer>(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 20000,
      });

      const baseImage = await sharp(Buffer.from(response.data))
        .resize(DIRECTOR_POSTER_WIDTH, DIRECTOR_POSTER_HEIGHT, {
          fit: 'cover',
          position: 'centre',
        })
        .jpeg({ quality: 92 })
        .toBuffer();

      const overlay = this.buildDirectorOverlaySvg(directorName);
      const composite = await sharp(baseImage)
        .composite([{ input: overlay, top: 0, left: 0 }])
        .jpeg({ quality: 92 })
        .toBuffer();

      const tempDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), 'agregarr-director-')
      );
      const safeName = this.sanitizeDirectorNameForLabel(directorName) || 'director';
      tempPosterPath = path.join(tempDir, `${safeName}.jpg`);

      await fs.promises.writeFile(tempPosterPath, composite);
      return tempPosterPath;
    } catch (error) {
      logger.warn('Failed to generate stylized director poster, falling back to TMDB image', {
        label: 'Plex Library Collections',
        directorName,
        imageUrl,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async cleanupTempPoster(tempPath: string | null): Promise<void> {
    if (!tempPath) return;
    try {
      await fs.promises.rm(path.dirname(tempPath), { recursive: true, force: true });
    } catch (cleanupError) {
      logger.debug('Failed to clean up temp director poster', {
        label: 'Plex Library Collections',
        tempPath,
        error:
          cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError),
      });
    }
  }

  private async uploadTmdbDirectorPoster(
    directorName: string,
    collectionName: string,
    collectionRatingKey: string,
    plexClient: PlexAPI,
    directorInfo?: DirectorTmdbInfo
  ): Promise<boolean> {
    try {
      const info =
        directorInfo ?? (await this.fetchTmdbDirectorInfo(directorName));
      const profilePath = info?.profilePath;

      if (!profilePath) {
        logger.warn(
          `TMDB director result has no poster for "${directorName}", skipping TMDB poster`,
          {
            label: 'Plex Library Collections',
            collectionName,
          }
        );
        return false;
      }

      const tmdbPosterUrl = `https://image.tmdb.org/t/p/original${profilePath}`;
      const posterManager = plexClient['posterManager'];

      logger.debug(
        `Preparing stylized TMDB director poster for "${collectionName}" from ${tmdbPosterUrl}`,
        {
          label: 'Plex Library Collections',
          collectionName,
          tmdbPosterUrl,
          collectionRatingKey,
        }
      );

      let overlayPosterPath: string | null = null;

      try {
        overlayPosterPath = await this.generateDirectorPosterWithOverlay(
          directorName,
          tmdbPosterUrl
        );

        if (overlayPosterPath) {
          await posterManager.uploadPosterFromFile(
            collectionRatingKey,
            overlayPosterPath
          );
          await posterManager.lockPoster(collectionRatingKey);

          logger.info(
            `Successfully uploaded stylized TMDB director poster for "${collectionName}"`,
            {
              label: 'Plex Library Collections',
              collectionName,
            }
          );

          return true;
        }
      } catch (overlayError) {
        logger.warn(
          'Failed to upload stylized TMDB director poster, falling back to raw image',
          {
            label: 'Plex Library Collections',
            collectionName,
            error:
              overlayError instanceof Error
                ? overlayError.message
                : String(overlayError),
          }
        );
      } finally {
        await this.cleanupTempPoster(overlayPosterPath);
      }

      logger.debug(
        `Uploading raw TMDB director poster for "${collectionName}" (no overlay)`,
        {
          label: 'Plex Library Collections',
          collectionName,
          tmdbPosterUrl,
          collectionRatingKey,
        }
      );

      await posterManager.uploadPosterFromUrl(
        collectionRatingKey,
        tmdbPosterUrl
      );
      await posterManager.lockPoster(collectionRatingKey);

      logger.info(
        `Successfully uploaded TMDB director poster for "${collectionName}"`,
        {
          label: 'Plex Library Collections',
        }
      );

      return true;
    } catch (error) {
      logger.error(
        `Error uploading TMDB director poster for "${collectionName}", will fallback to auto-poster if enabled`,
        {
          label: 'Plex Library Collections',
          error: error instanceof Error ? error.message : String(error),
          directorName,
          collectionName,
        }
      );
      return false;
    }
  }

  private async setDirectorBioAsDescription(
    directorName: string,
    collectionRatingKey: string,
    plexClient: PlexAPI,
    directorInfo?: DirectorTmdbInfo
  ): Promise<boolean> {
    try {
      const info =
        directorInfo ?? (await this.fetchTmdbDirectorInfo(directorName));
      const biography = info?.biography;

      if (!biography) {
        logger.debug(
          `No TMDB biography found for director "${directorName}", skipping description`,
          {
            label: 'Plex Library Collections',
            directorName,
          }
        );
        return false;
      }

      const paragraphs = biography.split('\n\n').filter((p) => p.trim());
      let bioText = '';

      for (const paragraph of paragraphs) {
        if ((bioText + paragraph).length > 500) {
          break;
        }
        bioText += (bioText ? '\n\n' : '') + paragraph;
      }

      if (!bioText) {
        logger.debug(
          `Biography truncated to empty string for director "${directorName}", skipping description`,
          {
            label: 'Plex Library Collections',
            directorName,
          }
        );
        return false;
      }

      await plexClient.updateSummary(collectionRatingKey, bioText);

      logger.debug(
        `Successfully set bio description for director "${directorName}" collection`,
        {
          label: 'Plex Library Collections',
          directorName,
          bioLength: bioText.length,
        }
      );

      return true;
    } catch (error) {
      logger.warn(
        `Failed to set bio description for director "${directorName}"`,
        {
          label: 'Plex Library Collections',
          directorName,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return false;
    }
  }

  private async applyDirectorMetadata(
    plexClient: PlexAPI,
    collectionRatingKey: string,
    collectionName: string,
    directorLabel: string,
    mediaType: 'movie' | 'tv',
    config: CollectionConfig
  ): Promise<void> {
    const visibilityConfig: CollectionVisibilityConfig = {
      usersHome: config.visibilityConfig?.usersHome ?? false,
      serverOwnerHome: config.visibilityConfig?.serverOwnerHome ?? false,
      libraryRecommended: config.visibilityConfig?.libraryRecommended ?? false,
      isActive: config.isActive ?? true,
    };

    await this.updateCollectionMetadata(plexClient, collectionRatingKey, {
      collectionName,
      mediaType,
      visibilityConfig,
      customLabel: directorLabel,
      sortOrderLibrary: config.sortOrderLibrary,
      isLibraryPromoted: config.isLibraryPromoted,
      customPoster: config.customPoster,
      libraryKey: config.libraryId,
      config,
    });
  }

  protected async validateConfiguration(): Promise<void> {
    // No external API dependencies - just needs Plex
  }

  protected async createTemplateContext(
    config: CollectionConfig,
    _mediaType: 'movie' | 'tv'
  ): Promise<Record<string, unknown>> {
    return {
      source: 'plex_library',
      subtype: config.subtype,
      // Per-director collections use the director name as the title; expose placeholders
      director: '{director}',
      name: '{director}',
      collectionName: '{director}',
    };
  }

  public async fetchSourceData(
    _config: CollectionConfig,
    _options?: CollectionSyncOptions,
    _libraryCache?: LibraryItemsCache
  ): Promise<CollectionSourceData[]> {
    return [];
  }

  public async mapSourceDataToItems(
    _sourceData: CollectionSourceData[],
    _config: CollectionConfig,
    _plexClient?: PlexAPI,
    _libraryCache?: LibraryItemsCache
  ): Promise<{
    items: CollectionItem[];
    missingItems?: MissingItem[];
    stats?: FilteringStats;
  }> {
    return {
      items: [],
      missingItems: [],
      stats: { original: 0, filtered: 0, removed: 0 },
    };
  }

  protected async createCollection(
    _items: CollectionItem[],
    _mediaType: 'movie' | 'tv',
    _collectionName: string,
    _plexClient: PlexAPI,
    _allCollections: PlexCollection[],
    _config: CollectionConfig,
    _processedCollectionKeys?: Set<string>
  ): Promise<CollectionOperationResult> {
    return {
      created: 0,
      updated: 0,
      itemCount: 0,
    };
  }

  /**
   * Process directors collection - creates collections for top directors
   */
  protected async processConfiguration(
    config: CollectionConfig,
    plexClient: PlexAPI,
    allCollections: PlexCollection[],
    processedCollectionKeys?: Set<string>,
    _libraryCache?: LibraryItemsCache,
    _options?: CollectionSyncOptions
  ): Promise<SyncResult> {
    const mediaType = getCollectionMediaType(config);
    const subtype = config.subtype;
    if (!subtype || subtype !== 'directors') {
      throw this.createSyncError(
        CollectionSyncErrorType.CONFIGURATION_ERROR,
        `Invalid plex_library subtype: ${subtype}. Currently only 'directors' is supported.`
      );
    }

    const depth = 50; // Top N directors
    const limit = 30; // Max items per director
    const minimumItems = config.directorMinimumItems || 5; // Minimum threshold

    logger.info('Processing directors collection', {
      label: 'Plex Library Collections',
      configName: config.name,
      libraryId: config.libraryId,
      depth,
      limit,
      minimumItems,
    });

    const directorLabelPrefix = `AgregarrAutoDirector-${config.id}-`;

    try {
      // Fetch top directors from library
      const directors = await plexClient.getLibraryDirectors(
        config.libraryId,
        depth * 2 // Fetch extra in case some don't meet minimum threshold
      );

      // Filter directors by minimum items threshold
      const qualifyingDirectors = directors.filter(
        (d) => d.count >= minimumItems
      );

      // Limit to depth
      const topDirectors = qualifyingDirectors.slice(0, depth);

      logger.info(
        `Creating collections for ${topDirectors.length} directors (${qualifyingDirectors.length} qualified, ${directors.length} total)`,
        {
          label: 'Plex Library Collections',
          configName: config.name,
          topDirectors: topDirectors.map((d) => `${d.name} (${d.count} items)`),
        }
      );

      let created = 0;
      let updated = 0;
      let deleted = 0;

      for (const director of topDirectors) {
        try {
          const collectionName = director.name;
          const directorInfo =
            (await this.fetchTmdbDirectorInfo(director.name)) ?? undefined;
          const labelSuffix =
            directorInfo?.tmdbPersonId?.toString() ??
            this.sanitizeDirectorNameForLabel(director.name);
          const directorLabel = this.buildDirectorLabel(
            config.id,
            directorInfo?.tmdbPersonId ?? labelSuffix
          );

          const existingCollection = allCollections.find(
            (c) =>
              c.title === collectionName && c.libraryKey === config.libraryId
          );

          let collectionRatingKey: string | null = null;

          if (existingCollection) {
            collectionRatingKey = existingCollection.ratingKey;
            updated++;
          } else {
            collectionRatingKey =
              await plexClient['smartCollectionManager'].createDirectorCollection(
                collectionName,
                config.libraryId,
                mediaType,
                director.name,
                limit
              );

            if (collectionRatingKey) {
              created++;
            } else {
              logger.warn(
                `Failed to create collection for director: ${director.name}`,
                {
                  label: 'Plex Library Collections',
                }
              );
              continue;
            }
          }

          // Tag collection so discovery recognizes it as Agregarr-managed
          await this.addDirectorLabel(
            plexClient,
            collectionRatingKey,
            directorLabel
          );

          // Track by rating key so cleanup doesn't treat it as unmanaged
          processedCollectionKeys?.add(collectionRatingKey);

          // Set director bio as collection description (custom summaries will override this later)
          await this.setDirectorBioAsDescription(
            director.name,
            collectionRatingKey,
            plexClient,
            directorInfo
          );

          // Apply the same metadata/ordering handling used by standard collections
          await this.applyDirectorMetadata(
            plexClient,
            collectionRatingKey,
            collectionName,
            directorLabel,
            mediaType,
            config
          );

          const shouldGeneratePoster = config.autoPoster ?? true;

          // Try TMDB director poster, then auto-poster fallback
          if (config.useTmdbDirectorPoster) {
            const tmdbPosterUploaded = await this.uploadTmdbDirectorPoster(
              director.name,
              collectionName,
              collectionRatingKey,
              plexClient,
              directorInfo
            );

            if (!tmdbPosterUploaded && shouldGeneratePoster) {
              await this.generateAutoPoster(
                collectionName,
                config,
                collectionRatingKey,
                plexClient
              );
            }
          } else if (shouldGeneratePoster) {
            await this.generateAutoPoster(
              collectionName,
              config,
              collectionRatingKey,
              plexClient
            );
          }
        } catch (error) {
          logger.error(`Error creating collection for director ${director.name}`, {
            label: 'Plex Library Collections',
            directorName: director.name,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Remove any previously created director collections that are now outside the depth limit
      const topDirectorNames = new Set(
        topDirectors.map((director) => director.name.toLowerCase())
      );
      const managedCollections = allCollections.filter((collection) => {
        if (collection.libraryKey !== config.libraryId) {
          return false;
        }

        const labels = Array.isArray(collection.labels) ? collection.labels : [];

        return labels.some((label: string | PlexLabel) => {
          const labelText = typeof label === 'string' ? label : label.tag;
          if (!labelText) return false;
          const normalized = labelText.toLowerCase();
          return normalized.startsWith(directorLabelPrefix.toLowerCase());
        });
      });

      for (const collection of managedCollections) {
        if (topDirectorNames.has(collection.title.toLowerCase())) {
          continue;
        }

        try {
          await plexClient.deleteCollection(collection.ratingKey);
          deleted++;
          logger.info(
            `Removed director collection outside current limit: ${collection.title}`,
            {
              label: 'Plex Library Collections',
              collectionName: collection.title,
              ratingKey: collection.ratingKey,
              libraryId: config.libraryId,
            }
          );
        } catch (deleteError) {
          logger.warn(
            `Failed to delete outdated director collection "${collection.title}"`,
            {
              label: 'Plex Library Collections',
              error:
                deleteError instanceof Error
                  ? deleteError.message
                  : String(deleteError),
              ratingKey: collection.ratingKey,
              libraryId: config.libraryId,
            }
          );
        }
      }

      logger.info('Directors collection sync completed', {
        label: 'Plex Library Collections',
        configName: config.name,
        created,
        updated,
        deleted,
        total: topDirectors.length,
      });

      return {
        created,
        updated,
        details: deleted ? { deleted } : undefined,
      };
    } catch (error) {
      logger.error('Failed to process directors collection', {
        label: 'Plex Library Collections',
        configName: config.name,
        error: error instanceof Error ? error.message : String(error),
      });

      throw this.createSyncError(
        CollectionSyncErrorType.API_ERROR,
        `Failed to fetch directors from library: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}

export const plexLibraryCollectionSync = new PlexLibraryCollectionSync();
export default plexLibraryCollectionSync;
