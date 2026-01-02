import type { FlixPatrolListItem } from '@server/api/flixpatrol';
import FlixPatrolAPI from '@server/api/flixpatrol';
import type PlexAPI from '@server/api/plexapi';
import TmdbAPI from '@server/api/themoviedb';
import { BaseCollectionSync } from '@server/lib/collections/core/BaseCollectionSync';
import {
  findPlexItemsByTmdbIds,
  getCollectionMediaType,
  processMissingItemsWithMode,
  type LibraryItemsCache,
} from '@server/lib/collections/core/CollectionUtilities';
import type {
  CollectionItem,
  CollectionSyncOptions,
  FilteringStats,
  MissingItem,
  NetworksSourceData,
  NetworksTemplateContext,
  PlexCollection,
  SyncResult,
} from '@server/lib/collections/core/types';
import { CollectionSyncErrorType } from '@server/lib/collections/core/types';
import type { CollectionConfig } from '@server/lib/settings';
import logger from '@server/logger';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

interface NetworksCollectionItem extends CollectionItem {
  rank?: number;
  platform?: string;
  metadata?: {
    libraryKey?: string;
    tmdbId?: number;
    flixpatrolUrl?: string;
    platformLogo?: {
      spriteUrl: string;
      position: string;
    };
  };
}

/**
 * Networks Collection Sync - Implementation for streaming platform top 10 lists
 *
 * Supports Netflix, HBO, Disney+, Amazon Prime, and other streaming platforms.
 * Uses web scraping via FlixPatrol since most platforms don't provide public APIs.
 */
export class NetworksCollectionSync extends BaseCollectionSync<'networks'> {
  private flixpatrolClient: FlixPatrolAPI;
  private tmdbClient: TmdbAPI;

  constructor() {
    super('networks');
    this.flixpatrolClient = new FlixPatrolAPI();
    this.tmdbClient = new TmdbAPI();
  }

  protected async validateConfiguration(): Promise<void> {
    // Networks/FlixPatrol data is public and doesn't require API keys
    // Any connectivity issues will be caught during actual fetching
  }

  /**
   * Process a single Networks collection configuration
   */
  protected async processConfiguration(
    config: CollectionConfig,
    plexClient: PlexAPI,
    allCollections: PlexCollection[],
    processedCollectionKeys?: Set<string>,
    libraryCache?: LibraryItemsCache,
    options?: CollectionSyncOptions
  ): Promise<SyncResult> {
    try {
      // Validate configuration
      if (!this.isValidNetworksConfig(config)) {
        throw this.createSyncError(
          CollectionSyncErrorType.CONFIGURATION_ERROR,
          `Invalid Networks configuration: ${config.name}`
        );
      }

      // Fetch data from FlixPatrol
      const sourceData = await this.fetchSourceData(
        config,
        options,
        libraryCache
      );

      // Map to standardized format
      const mappedResult = await this.mapSourceDataToItems(
        sourceData,
        config,
        plexClient,
        libraryCache
      );

      // Apply filtering safety net
      const { items, missingItems, mappingStats, filteringStats } =
        await this.applyFilteringToMappedItems(mappedResult, config);

      // Handle placeholder cleanup and process missing items
      const placeholderItems = await this.handlePlaceholdersAndMissingItems(
        items,
        missingItems,
        config,
        plexClient,
        libraryCache,
        missingItems && missingItems.length > 0
          ? () => this.handleAutoRequests(missingItems, config)
          : undefined
      );

      // Add placeholder items to the collection
      let finalItems = items;
      if (placeholderItems.length > 0) {
        finalItems = [...items, ...placeholderItems];
      }

      if (finalItems.length === 0) {
        logger.warn('No items to create collection from', {
          label: 'Networks Collections',
          configName: config.name,
          originalStatsCount: mappingStats?.original || 0,
          mappedCount: mappingStats?.filtered || 0,
          filteredCount: filteringStats?.filtered || 0,
          removedCount:
            (mappingStats?.removed || 0) + (filteringStats?.removed || 0),
        });
        return { created: 0, updated: 0 };
      }

      // Use the media type processing strategy
      return await this.processWithMediaTypeStrategy(
        finalItems,
        config,
        plexClient,
        allCollections,
        processedCollectionKeys,
        undefined, // userInfo
        libraryCache
      );
    } catch (error) {
      throw this.createSyncError(
        CollectionSyncErrorType.COLLECTION_ERROR,
        `Failed to process Networks collection ${config.name}`,
        { configId: config.id, configName: config.name },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Create template context for Networks collections
   */
  protected async createTemplateContext(
    config: CollectionConfig,
    mediaType: 'movie' | 'tv'
  ): Promise<NetworksTemplateContext> {
    // Extract platform name from subtype (e.g., "neon-tv_top_10" -> "neon-tv")
    const platformName = (config.subtype || '').replace(/_top_10$/, '');

    return this.templateEngine.createNetworksContext(
      mediaType,
      platformName,
      'top_10'
    ) as NetworksTemplateContext;
  }

  /**
   * Fetch data from FlixPatrol API
   */
  public async fetchSourceData(
    config: CollectionConfig,
    options?: CollectionSyncOptions,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Used in mapSourceDataToItems via processConfiguration
    libraryCache?: LibraryItemsCache
  ): Promise<NetworksSourceData[]> {
    try {
      // Extract platform name for logging
      const platformName = (config.subtype || '').replace(/_top_10$/, '');

      logger.debug(`Fetching Networks data for platform: ${platformName}`, {
        label: 'Networks Collections',
        configName: config.name,
        platform: platformName,
      });

      if (options?.apiTimeout) {
        logger.debug(`API timeout set to ${options.apiTimeout}ms`, {
          label: 'Networks Collections',
        });
      }

      const country = config.networksCountry || 'global';
      const mediaType = getCollectionMediaType(config);
      const platformData = await this.flixpatrolClient.getPlatformTop10(
        config.subtype || '', // Pass the full subtype (e.g., "neon-tv_top_10")
        country,
        mediaType
      );

      const networksData: NetworksSourceData[] = [];

      // Get the appropriate list based on media type
      let sourceItems: FlixPatrolListItem[] = [];
      if (mediaType === 'movie') {
        sourceItems = platformData.movies;
      } else if (mediaType === 'tv') {
        sourceItems = platformData.tvShows;
      } else {
        // 'both' - combine both lists
        sourceItems = [...platformData.movies, ...platformData.tvShows];
      }

      // Convert to NetworksSourceData format
      sourceItems.forEach((item) => {
        networksData.push({
          rank: item.rank,
          title: item.title,
          points: item.points,
          flixpatrolUrl: item.flixpatrolUrl,
          type: item.type,
          platform: platformData.platform,
          platformLogo: platformData.platformLogo, // Include extracted platform logo
        });
      });

      // Note: maxItems limit is now applied later in the BaseCollectionSync filtering stage
      const limitedData = networksData;

      logger.info(
        `Successfully fetched ${limitedData.length} items from ${platformData.platform}`,
        {
          label: 'Networks Collections',
          configName: config.name,
          platform: platformData.platform,
          itemCount: limitedData.length,
        }
      );

      return limitedData;
    } catch (error) {
      throw this.createSyncError(
        CollectionSyncErrorType.API_ERROR,
        `Failed to fetch data from FlixPatrol`,
        { subtype: config.subtype },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Map Networks source data to standardized collection items
   * Uses TMDB API to resolve titles to TMDB IDs, then uses standard Plex matching
   */
  public async mapSourceDataToItems(
    sourceData: NetworksSourceData[],
    config: CollectionConfig,
    plexClient?: PlexAPI,
    libraryCache?: LibraryItemsCache
  ): Promise<{
    items: NetworksCollectionItem[];
    missingItems?: MissingItem[];
    stats?: FilteringStats;
  }> {
    // Get media type from config - consistent with all other sources
    const mediaType = getCollectionMediaType(config);

    const mappedItems: NetworksCollectionItem[] = [];
    const missingItems: MissingItem[] = [];

    logger.info(
      `Starting Networks TMDB ID resolution for ${sourceData.length} items`,
      {
        label: 'Networks Collections',
        configName: config.name,
        itemsToProcess: sourceData.length,
      }
    );

    // Step 1: Resolve FlixPatrol titles to TMDB IDs
    const tmdbLookups: {
      tmdbId: number;
      mediaType: 'movie' | 'tv';
      title: string;
      year?: number;
      originalPosition: number;
      rank?: number;
      platform?: string;
      flixpatrolUrl?: string;
      platformLogo?: {
        spriteUrl: string;
        position: string;
      };
    }[] = [];

    for (let index = 0; index < sourceData.length; index++) {
      const item = sourceData[index];

      try {
        // Dual search: Search both movies AND TV shows to handle mixed "Overall" content
        const [movieResults, tvResults] = await Promise.all([
          this.tmdbClient.searchMovies({
            query: item.title,
            page: 1,
          }),
          this.tmdbClient.searchTvShows({
            query: item.title,
            page: 1,
          }),
        ]);

        // Find the best match between movie and TV results
        const bestMatch = this.chooseBestTmdbMatch(
          movieResults.results || [],
          tvResults.results || [],
          item.title,
          mediaType // Collection media type from library
        );

        if (bestMatch) {
          // CRITICAL FIX: Skip items that don't match the library type
          // When using "Overall" FlixPatrol lists in a specific library (movie or TV),
          // only include items that match that library type.
          // Example: "Shrek" (movie) in an overall list should be skipped in a TV library
          if (bestMatch.mediaType !== mediaType) {
            logger.debug(
              `Skipping ${bestMatch.mediaType} "${item.title}" - doesn't match ${mediaType} library type`,
              {
                label: 'Networks Collections',
                itemTitle: item.title,
                tmdbType: bestMatch.mediaType,
                libraryType: mediaType,
                tmdbId: bestMatch.result.id,
              }
            );
            continue; // Skip this item entirely
          }

          const tmdbTitle =
            bestMatch.mediaType === 'movie'
              ? (bestMatch.result as { title: string }).title
              : (bestMatch.result as { name: string }).name;
          const releaseDate =
            bestMatch.mediaType === 'movie'
              ? (bestMatch.result as { release_date?: string }).release_date
              : (bestMatch.result as { first_air_date?: string })
                  .first_air_date;

          // Extract year from release date
          let year: number | undefined;
          if (releaseDate) {
            year = parseInt(releaseDate.substring(0, 4));
          }

          logger.debug(`TMDB match found for: "${item.title}"`, {
            label: 'Networks Collections',
            originalTitle: item.title,
            tmdbTitle,
            tmdbId: bestMatch.result.id,
            type: bestMatch.mediaType,
            releaseDate,
            searchStrategy: 'dual_search',
            movieResultsCount: movieResults.results?.length || 0,
            tvResultsCount: tvResults.results?.length || 0,
          });

          tmdbLookups.push({
            tmdbId: bestMatch.result.id,
            mediaType: bestMatch.mediaType,
            title: item.title,
            year,
            originalPosition: index + 1,
            rank: item.rank,
            platform: item.platform,
            flixpatrolUrl: item.flixpatrolUrl,
            platformLogo: item.platformLogo, // Include platform logo info
          });
        } else {
          logger.debug(`No TMDB match found for: ${item.title}`, {
            label: 'Networks Collections',
            title: item.title,
            movieResultsCount: movieResults.results?.length || 0,
            tvResultsCount: tvResults.results?.length || 0,
            searchStrategy: 'dual_search',
          });

          // Add as missing since we can't resolve TMDB ID
          missingItems.push({
            tmdbId: 0,
            mediaType: item.type, // Keep original type as fallback
            title: item.title,
            originalPosition: index + 1,
            source: this.source,
            metadata: {
              rank: item.rank,
              platform: item.platform,
              flixpatrolUrl: item.flixpatrolUrl,
            },
          });
        }
      } catch (error) {
        logger.warn(`Failed to search TMDB for Networks item: ${item.title}`, {
          label: 'Networks Collections',
          error: error instanceof Error ? error.message : String(error),
        });

        // Add as missing on TMDB search failure
        missingItems.push({
          tmdbId: 0,
          mediaType: item.type,
          title: item.title,
          originalPosition: index + 1,
          source: this.source,
          metadata: {
            rank: item.rank,
            platform: item.platform,
            flixpatrolUrl: item.flixpatrolUrl,
          },
        });
      }

      // Be respectful to TMDB API
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    logger.info(
      `Resolved ${tmdbLookups.length}/${sourceData.length} items to TMDB IDs`,
      {
        label: 'Networks Collections',
        configName: config.name,
        resolved: tmdbLookups.length,
        total: sourceData.length,
      }
    );

    // Step 2: Use the existing Plex search with TMDB IDs
    if (tmdbLookups.length > 0 && plexClient) {
      const targetLibraryId = Array.isArray(config.libraryId)
        ? config.libraryId[0]
        : config.libraryId;

      const plexLookup = await findPlexItemsByTmdbIds(
        plexClient,
        tmdbLookups,
        targetLibraryId,
        libraryCache,
        false // Library-scoped search for collection creation
      );

      // Process items using the Plex lookup map
      for (const lookup of tmdbLookups) {
        const key = `${lookup.tmdbId}-${lookup.mediaType}`;
        const plexItem = plexLookup.get(key);

        if (plexItem) {
          mappedItems.push({
            ratingKey: plexItem.ratingKey,
            title: lookup.title,
            type: lookup.mediaType,
            tmdbId: lookup.tmdbId, // Direct property for poster generation
            year: lookup.year, // Include year for poster generation
            rank: lookup.rank,
            platform: lookup.platform,
            metadata: {
              libraryKey: plexItem.libraryKey,
              tmdbId: lookup.tmdbId,
              flixpatrolUrl: lookup.flixpatrolUrl,
              platformLogo: lookup.platformLogo, // Include platform logo metadata
            },
          });
        } else {
          // Item exists in TMDB but not in Plex
          missingItems.push({
            tmdbId: lookup.tmdbId,
            mediaType: lookup.mediaType,
            title: lookup.title,
            year: lookup.year,
            originalPosition: lookup.originalPosition,
            source: this.source,
            metadata: {
              rank: lookup.rank,
              platform: lookup.platform,
              flixpatrolUrl: lookup.flixpatrolUrl,
            },
          });
        }
      }
    }

    const stats = this.createFilteringStats(
      sourceData.length,
      mappedItems.length,
      {
        'missing from plex': missingItems.length,
        'tmdb resolution failed':
          sourceData.length - tmdbLookups.length - missingItems.length,
      }
    );

    logger.info(`Networks mapping completed`, {
      label: 'Networks Collections',
      configName: config.name,
      found: mappedItems.length,
      missing: missingItems.length,
      total: sourceData.length,
    });

    return {
      items: mappedItems,
      missingItems,
      stats,
    };
  }

  /**
   * Create collection in Plex
   */
  protected async createCollection(
    items: CollectionItem[],
    mediaType: 'movie' | 'tv',
    collectionName: string,
    plexClient: PlexAPI,
    allCollections: PlexCollection[],
    config: CollectionConfig,
    processedCollectionKeys?: Set<string>
  ) {
    try {
      // Use the standardized approach via BaseCollectionSync
      const result = await this.createOrUpdateCollectionStandardized(
        items,
        collectionName,
        mediaType,
        config,
        plexClient,
        allCollections,
        processedCollectionKeys
      );

      // Update config with rating key if we got one
      this.updateConfigWithRatingKey(config, result.collectionRatingKey);

      return {
        created: result.created,
        updated: result.updated,
        collectionRatingKey: result.collectionRatingKey,
        itemCount: result.itemCount || items.length,
        stats: result.stats,
      };
    } catch (error) {
      throw this.createSyncError(
        CollectionSyncErrorType.COLLECTION_ERROR,
        `Failed to create Networks collection ${collectionName}`,
        { collectionName, itemCount: items.length },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  // Private helper methods

  /**
   * Validate if a configuration is a valid Networks config
   */
  private isValidNetworksConfig(config: CollectionConfig): boolean {
    if (config.type !== 'networks' || !config.subtype) {
      return false;
    }

    // Dynamic validation - any subtype ending with "_top_10" is valid
    // This allows for the full range of platforms that FlixPatrol supports
    return config.subtype.endsWith('_top_10');
  }

  /**
   * Choose the best TMDB match between movie and TV results
   * Uses collection type preference and result quality scoring
   */
  private chooseBestTmdbMatch(
    movieResults: {
      title: string;
      popularity: number;
      vote_average: number;
      vote_count: number;
      release_date?: string;
      id: number;
    }[],
    tvResults: {
      name: string;
      popularity: number;
      vote_average: number;
      vote_count: number;
      first_air_date?: string;
      id: number;
    }[],
    originalTitle: string,
    collectionMediaType: 'movie' | 'tv'
  ): {
    result: {
      title?: string;
      name?: string;
      popularity: number;
      vote_average: number;
      vote_count: number;
      release_date?: string;
      first_air_date?: string;
      id: number;
    };
    mediaType: 'movie' | 'tv';
  } | null {
    // Helper function to calculate match score
    const calculateScore = (
      result: {
        title?: string;
        name?: string;
        popularity: number;
        vote_average: number;
        vote_count: number;
        release_date?: string;
        first_air_date?: string;
      },
      mediaType: 'movie' | 'tv'
    ) => {
      let score = 0;

      // Base popularity/vote score (higher is better)
      const popularity = result.popularity || 0;
      const voteAverage = result.vote_average || 0;
      const voteCount = result.vote_count || 0;

      // Weighted popularity (log scale to prevent extreme outliers)
      score += Math.log10(popularity + 1) * 10;

      // Vote quality bonus (average * log of count)
      if (voteCount > 0) {
        score += voteAverage * Math.log10(voteCount + 1) * 2;
      }

      // Title similarity bonus (exact match gets big bonus)
      const tmdbTitle = mediaType === 'movie' ? result.title : result.name;
      if (
        tmdbTitle &&
        tmdbTitle.toLowerCase() === originalTitle.toLowerCase()
      ) {
        score += 50; // Big bonus for exact title match
      }

      // Collection type preference bonus
      if (mediaType === collectionMediaType) {
        score += 25; // Prefer matches that align with collection type
      }

      // Recency bonus (newer content gets slight preference)
      const releaseDate =
        mediaType === 'movie' ? result.release_date : result.first_air_date;
      if (releaseDate) {
        const year = parseInt(releaseDate.split('-')[0]);
        if (year >= 2020) score += 10; // Recent content bonus
        if (year >= 2010) score += 5; // Modern content bonus
      }

      return score;
    };

    // Score all results
    const scoredResults: {
      result: {
        title?: string;
        name?: string;
        popularity: number;
        vote_average: number;
        vote_count: number;
        release_date?: string;
        first_air_date?: string;
        id: number;
      };
      mediaType: 'movie' | 'tv';
      score: number;
    }[] = [];

    // Score all results from both movie and TV searches
    // The best match is chosen based on title similarity, popularity, and votes
    // Library type filtering happens after the best match is chosen
    movieResults.forEach((result) => {
      scoredResults.push({
        result,
        mediaType: 'movie',
        score: calculateScore(result, 'movie'),
      });
    });

    tvResults.forEach((result) => {
      scoredResults.push({
        result,
        mediaType: 'tv',
        score: calculateScore(result, 'tv'),
      });
    });

    // Sort by score (highest first)
    scoredResults.sort((a, b) => b.score - a.score);

    // Return the best match, or null if no results
    if (scoredResults.length === 0) {
      return null;
    }

    const bestMatch = scoredResults[0];

    // Log scoring details for debugging
    logger.debug(`TMDB match scoring for "${originalTitle}"`, {
      label: 'Networks Collections',
      bestMatch: {
        title:
          bestMatch.mediaType === 'movie'
            ? bestMatch.result.title
            : bestMatch.result.name,
        type: bestMatch.mediaType,
        score: bestMatch.score,
        popularity: bestMatch.result.popularity,
        vote_average: bestMatch.result.vote_average,
        vote_count: bestMatch.result.vote_count,
      },
      totalResults: scoredResults.length,
      movieCount: movieResults.length,
      tvCount: tvResults.length,
      collectionType: collectionMediaType,
    });

    return {
      result: bestMatch.result,
      mediaType: bestMatch.mediaType,
    };
  }

  /**
   * Override autoPoster generation to use dynamic platform logos from FlixPatrol
   */
  protected async generateAutoPoster(
    collectionName: string,
    config: CollectionConfig,
    collectionRatingKey: string,
    plexClient: PlexAPI,
    items?: CollectionItem[]
  ): Promise<void> {
    // Extract platform name from subtype (e.g., "netflix_top_10" -> "netflix")
    const platformName = this.extractPlatformNameFromSubtype(
      config.subtype || ''
    );

    // Get platform logo information from the first item (they all share the same platform)
    let dynamicPlatformLogo: string | null = null;
    const networksItems = items as NetworksCollectionItem[];
    if (networksItems && networksItems.length > 0) {
      const firstItem = networksItems[0];
      if (firstItem.metadata?.platformLogo) {
        try {
          dynamicPlatformLogo = await this.extractPlatformLogoFromSprite(
            firstItem.metadata.platformLogo.spriteUrl,
            firstItem.metadata.platformLogo.position,
            platformName
          );
        } catch (logoError) {
          logger.warn(
            `Failed to extract dynamic platform logo, falling back to static`,
            {
              label: 'Networks Collections',
              platform: platformName,
              error:
                logoError instanceof Error
                  ? logoError.message
                  : String(logoError),
            }
          );
        }
      }
    }

    // Call base implementation with platform-specific overrides
    await super.generateAutoPoster(
      collectionName,
      config,
      collectionRatingKey,
      plexClient,
      items,
      undefined, // No userInfo for networks
      {
        collectionTypeOverride: platformName, // Use platform name for branding
        dynamicLogo: dynamicPlatformLogo || undefined,
      }
    );

    // Clean up the temporary dynamic logo file if created
    if (dynamicPlatformLogo && fs.existsSync(dynamicPlatformLogo)) {
      try {
        await fs.promises.unlink(dynamicPlatformLogo);
      } catch (cleanupError) {
        logger.warn(
          `Failed to cleanup dynamic logo file: ${dynamicPlatformLogo}`,
          {
            label: 'Networks Collections',
            error:
              cleanupError instanceof Error
                ? cleanupError.message
                : String(cleanupError),
          }
        );
      }
    }
  }

  /**
   * Extract clean platform name from subtype for branding
   */
  private extractPlatformNameFromSubtype(subtype: string): string {
    // Remove "_top_10" suffix and normalize to match poster generation system
    const platformName = subtype.replace(/_top_10$/, '');

    // Convert underscores to hyphens for poster generation compatibility
    // This ensures platform names match the SERVICE_LOGO_MAP in posterGeneration.ts
    return platformName.replace(/_/g, '-');
  }

  /**
   * Handle auto-requests for missing items
   */
  private async handleAutoRequests(
    missingItems: MissingItem[],
    config: CollectionConfig
  ): Promise<void> {
    // Use the unified download service
    await processMissingItemsWithMode(missingItems, config, 'networks');
  }

  /**
   * Extract individual platform logo from FlixPatrol sprite sheet
   */
  public async extractPlatformLogoFromSprite(
    spriteUrl: string,
    positionPercent: string,
    platformName: string
  ): Promise<string> {
    try {
      // Download the sprite image
      const response = await axios.get(spriteUrl, {
        responseType: 'arraybuffer',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
        timeout: 10000,
      });

      const spriteBuffer = Buffer.from(response.data);

      // Get sprite dimensions
      const spriteImage = sharp(spriteBuffer);
      const metadata = await spriteImage.metadata();

      if (!metadata.width || !metadata.height) {
        throw new Error('Could not determine sprite dimensions');
      }

      // Parse the CSS background-position percentage (e.g., "0% 9.52381%" -> [0, 9.52381])
      const positionParts = positionPercent.split(/\s+/);
      const xPercent =
        positionParts.length > 1
          ? parseFloat(positionParts[0].replace('%', ''))
          : 0;
      const yPercent =
        positionParts.length > 1
          ? parseFloat(positionParts[1].replace('%', ''))
          : parseFloat(positionPercent.replace('%', ''));

      // KISS approach: FlixPatrol sprites are likely just vertically arranged logos
      // Use the percentage to directly calculate position in the sprite

      // CSS background-position calculation:
      // background-position: X% Y% means X% of image aligns with X% of container
      // position = (containerSize - imageSize) * percentage / 100
      const containerWidth = 50; // Logo display size
      const containerHeight = 50; // Logo display size

      const xPosition = Math.round(
        (containerWidth - metadata.width) * (xPercent / 100)
      );
      const yPosition = Math.round(
        (containerHeight - metadata.height) * (yPercent / 100)
      );

      // Since the result is negative (container smaller than sprite), we crop from the absolute position
      const cropX = Math.max(0, -xPosition);
      const cropY = Math.max(0, -yPosition);

      // FlixPatrol uses 50x50px logos
      const logoWidth = 50;
      const logoHeight = 50;

      // Create output path for the extracted logo
      const outputDir = path.join(process.cwd(), 'config', 'temp');
      await fs.promises.mkdir(outputDir, { recursive: true });

      const outputPath = path.join(
        outputDir,
        `platform_${platformName}_${Date.now()}.png`
      );

      // Extract and save the logo using proper CSS background-position crop coordinates
      await spriteImage
        .extract({
          left: cropX,
          top: cropY,
          width: Math.min(logoWidth, metadata.width - cropX),
          height: Math.min(logoHeight, metadata.height - cropY),
        })
        .png()
        .toFile(outputPath);

      // Special debug logging for problematic platforms
      const logLevel = platformName.toLowerCase().includes('neon')
        ? 'info'
        : 'debug';
      logger[logLevel](`Extracted platform logo from sprite`, {
        label: 'Networks Collections',
        platform: platformName,
        spriteUrl,
        positionPercent,
        parsedPosition: `${xPercent}%, ${yPercent}%`,
        spriteDimensions: `${metadata.width}x${metadata.height}`,
        cssPosition: `x:${xPosition}, y:${yPosition}`,
        extractRegion: `left:${cropX}, top:${cropY}, ${logoWidth}x${logoHeight}`,
        outputPath,
        ...(platformName.toLowerCase().includes('neon') && {
          WARNING: 'NEON PLATFORM - CHECK IF LOGO IS CORRECT',
        }),
      });

      return outputPath;
    } catch (error) {
      logger.error(`Failed to extract platform logo from sprite`, {
        label: 'Networks Collections',
        platform: platformName,
        spriteUrl,
        positionPercent,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

export default NetworksCollectionSync;
