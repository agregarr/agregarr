import type PlexAPI from '@server/api/plexapi';
import RadarrAPI from '@server/api/servarr/radarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import TraktAPI from '@server/api/trakt';
import { getRepository } from '@server/datasource';
import { ComingSoonItem } from '@server/entity/ComingSoonItem';
import { BaseCollectionSync } from '@server/lib/collections/core/BaseCollectionSync';
import {
  findPlexItemsByTitle,
  findPlexItemsByTmdbIds,
  getCollectionMediaType,
  type LibraryItemsCache,
} from '@server/lib/collections/core/CollectionUtilities';
import type {
  CollectionItem,
  CollectionOperationResult,
  CollectionSyncOptions,
  ComingSoonSourceData,
  ComingSoonTemplateContext,
  MissingItem,
  PlexCollection,
  SyncResult,
} from '@server/lib/collections/core/types';
import { CollectionSyncErrorType } from '@server/lib/collections/core/types';
import type { CollectionConfig } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { translatePath } from '@server/utils/pathMapping';
import fs from 'fs/promises';

/**
 * Coming Soon Collection Sync
 *
 * Creates collections of upcoming/unreleased content with placeholder files and overlay banners.
 *
 * Features:
 * - Fetches upcoming content from Radarr/Sonarr/Trakt
 * - Creates placeholder files for missing items
 * - Applies category-specific overlay banners (PREMIERES, EXPECTED, COMING SOON, REQUEST NEEDED)
 * - Cleans up placeholders when real files are added
 *
 * Supports:
 * - 'monitored' subtype: Items monitored in Radarr/Sonarr but not yet released
 * - 'trakt_anticipated' subtype: Most anticipated upcoming content from Trakt
 */
export class ComingSoonCollectionSync extends BaseCollectionSync {
  constructor() {
    super('comingsoon');
  }

  /**
   * Validate that required services are configured
   */
  protected async validateConfiguration(): Promise<void> {
    const settings = getSettings();

    const hasRadarr = settings.radarr && settings.radarr.length > 0;
    const hasSonarr = settings.sonarr && settings.sonarr.length > 0;
    const hasTrakt = !!settings.trakt.apiKey;

    if (!hasRadarr && !hasSonarr && !hasTrakt) {
      throw this.createSyncError(
        CollectionSyncErrorType.CONFIGURATION_ERROR,
        'No supported services configured for Coming Soon (need Radarr, Sonarr, or Trakt)'
      );
    }
  }

  /**
   * Process a single Coming Soon collection configuration
   */
  protected async processConfiguration(
    config: CollectionConfig,
    plexClient: PlexAPI,
    allCollections: PlexCollection[],
    processedCollectionKeys?: Set<string>,
    libraryCache?: LibraryItemsCache,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    options?: CollectionSyncOptions
  ): Promise<SyncResult> {
    try {
      // Fetch upcoming content
      let sourceData = await this.fetchSourceData(config);

      // Filter out Trakt items that are past the released window (cleanup old non-monitored items)
      const { calculateDaysSince } = await import(
        '@server/lib/comingsoon/categorization'
      );
      const releasedWindowDays = config.comingSoonReleasedDays || 7;
      const originalCount = sourceData.length;
      sourceData = sourceData.filter((item) => {
        // Only filter Trakt items that are NOT monitored
        if (item.source === 'trakt' && !item.monitored) {
          const releaseDate = item.releaseDate || item.airDate;
          if (releaseDate) {
            const daysSinceRelease = calculateDaysSince(releaseDate);
            // Exclude items released more than the configured window
            if (daysSinceRelease > releasedWindowDays) {
              logger.debug(
                `Excluding Trakt item released >${releasedWindowDays} days ago`,
                {
                  label: 'Coming Soon Collections',
                  title: item.title,
                  releaseDate,
                  daysSinceRelease,
                  releasedWindowDays,
                }
              );
              return false;
            }
          }
        }
        return true;
      });

      if (sourceData.length < originalCount) {
        logger.info('Filtered out old Trakt items', {
          label: 'Coming Soon Collections',
          originalCount,
          filteredCount: sourceData.length,
          removed: originalCount - sourceData.length,
        });
      }

      // Clean up placeholders (released items, orphaned items, stale items)
      await this.cleanupReleasedPlaceholders(
        config,
        plexClient,
        libraryCache,
        sourceData
      );

      if (sourceData.length === 0) {
        logger.warn('No upcoming content found', {
          label: 'Coming Soon Collections',
          configName: config.name,
          subtype: config.subtype,
        });
        return { created: 0, updated: 0 };
      }

      // Map to standardized format
      // Note: sourceData is already filtered by 360-day window during fetch
      const mappedResult = await this.mapSourceDataToItems(
        sourceData,
        config,
        plexClient,
        libraryCache
      );

      // Extract placeholder items before filtering (they're tracked separately)
      const { placeholderItems, ...mappedResultForFiltering } = mappedResult;

      // Apply filtering
      const { items, missingItems, mappingStats } =
        this.applyFilteringToMappedItems(mappedResultForFiltering, config);

      // Handle placeholder creation for missing items
      if (missingItems && missingItems.length > 0) {
        const newlyCreatedItems = await this.handlePlaceholderCreation(
          missingItems,
          sourceData,
          config,
          plexClient
        );

        // Add newly created placeholder items to the collection
        items.push(...newlyCreatedItems);
      }

      // Apply overlays to existing placeholder items
      if (placeholderItems && placeholderItems.length > 0) {
        logger.info('Applying overlays to existing placeholders', {
          label: 'Coming Soon Collections',
          count: placeholderItems.length,
        });

        await this.applyOverlaysToExistingPlaceholders(
          placeholderItems,
          config,
          plexClient
        );
      }

      // Apply overlays to regular items (non-placeholders like returning TV shows)
      // These are items that exist in Plex but aren't placeholders or released items
      const placeholderRatingKeys = new Set(
        placeholderItems.map((p) => p.ratingKey)
      );
      const regularItemsNeedingOverlays = items
        .filter((item) => !placeholderRatingKeys.has(item.ratingKey))
        .map((item) => {
          const sourceItem = sourceData.find((s) => s.tmdbId === item.tmdbId);
          return sourceItem ? { ratingKey: item.ratingKey, sourceItem } : null;
        })
        .filter(
          (
            item
          ): item is { ratingKey: string; sourceItem: ComingSoonSourceData } =>
            item !== null
        );

      if (regularItemsNeedingOverlays.length > 0) {
        logger.info('Applying overlays to regular Coming Soon items', {
          label: 'Coming Soon Collections',
          count: regularItemsNeedingOverlays.length,
        });

        await this.applyOverlaysToExistingPlaceholders(
          regularItemsNeedingOverlays,
          config,
          plexClient
        );
      }

      // Apply overlays to released items (real files, within configured window)
      const releasedItems = await this.getReleasedItemsWithinWindow(
        config,
        sourceData,
        libraryCache
      );
      if (releasedItems.length > 0) {
        logger.info(
          'Applying overlays to released items within configured window',
          {
            label: 'Coming Soon Collections',
            count: releasedItems.length,
            releasedWindowDays: config.comingSoonReleasedDays || 7,
          }
        );

        await this.applyOverlaysToReleasedItems(
          releasedItems,
          config,
          plexClient
        );

        // Add released items to the collection
        items.push(...releasedItems);
      }

      // Sort items by release date (closest first)
      const sortedItems = this.sortByReleaseDate(items, sourceData);

      if (sortedItems.length === 0) {
        logger.warn('No items to create collection from after filtering', {
          label: 'Coming Soon Collections',
          configName: config.name,
          originalCount: mappingStats?.original || 0,
          matched: mappingStats?.filtered || 0,
        });
        return { created: 0, updated: 0 };
      }

      // Use the media type processing strategy
      return await this.processWithMediaTypeStrategy(
        sortedItems,
        config,
        plexClient,
        allCollections,
        processedCollectionKeys,
        undefined,
        libraryCache
      );
    } catch (error) {
      logger.error('Coming Soon collection processing failed', {
        label: 'Coming Soon Collections',
        configId: config.id,
        configName: config.name,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw this.createSyncError(
        CollectionSyncErrorType.COLLECTION_ERROR,
        `Failed to process Coming Soon collection ${config.name}`,
        { configId: config.id, configName: config.name },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Create template context for Coming Soon collections
   */
  protected async createTemplateContext(
    config: CollectionConfig,
    mediaType: 'movie' | 'tv'
  ): Promise<ComingSoonTemplateContext> {
    const subtype = config.subtype as 'monitored' | 'trakt_anticipated';

    return {
      ...this.templateEngine.getDefaultContext(),
      mediaType,
      source: 'comingsoon' as const,
      statType: subtype,
      subtype,
    };
  }

  /**
   * Create or update a collection in Plex
   * Required by BaseCollectionSync
   */
  protected async createCollection(
    items: CollectionItem[],
    mediaType: 'movie' | 'tv',
    collectionName: string,
    plexClient: PlexAPI,
    allCollections: PlexCollection[],
    config: CollectionConfig,
    processedCollectionKeys?: Set<string>
  ): Promise<CollectionOperationResult> {
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
      logger.error('Failed to create Coming Soon collection', {
        label: 'Coming Soon Collections',
        configName: config.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Fetch upcoming content from configured sources
   */
  public async fetchSourceData(
    config: CollectionConfig
  ): Promise<ComingSoonSourceData[]> {
    const subtype = config.subtype || '';
    const mediaType = getCollectionMediaType(config);
    const upcomingItems: ComingSoonSourceData[] = [];

    logger.info('Fetching Coming Soon content', {
      label: 'Coming Soon Collections',
      subtype,
      mediaType,
      configName: config.name,
    });

    switch (subtype) {
      case 'monitored': {
        if (mediaType === 'movie') {
          logger.debug('Fetching monitored movies', {
            label: 'Coming Soon Collections',
          });
          const items = await this.fetchMonitoredMovies(config);
          upcomingItems.push(...items);
        }
        if (mediaType === 'tv') {
          logger.debug('Fetching monitored TV shows', {
            label: 'Coming Soon Collections',
          });
          const items = await this.fetchMonitoredShows(config);
          logger.debug('fetchMonitoredShows returned', {
            label: 'Coming Soon Collections',
            count: items.length,
          });
          upcomingItems.push(...items);
        }

        // Enrich monitored items with TMDB release dates (adds 3-month estimate for theatrical-only releases)
        await this.enrichWithTMDBReleaseDates(upcomingItems);
        break;
      }

      case 'trakt_anticipated': {
        // maxItems is required for Trakt anticipated collections
        const maxItems = config.maxItems || 50; // Default to 50 if not set

        if (mediaType === 'movie') {
          const items = await this.fetchTraktAnticipatedMovies(
            maxItems,
            config
          );
          upcomingItems.push(...items);
        }
        if (mediaType === 'tv') {
          const items = await this.fetchTraktAnticipatedShows(maxItems, config);
          upcomingItems.push(...items);
        }

        // Cross-reference with Radarr/Sonarr to mark monitored status
        await this.markMonitoredStatus(upcomingItems);
        break;
      }

      default:
        throw this.createSyncError(
          CollectionSyncErrorType.CONFIGURATION_ERROR,
          `Unknown Coming Soon subtype: ${subtype}`
        );
    }

    logger.info('Fetched Coming Soon content', {
      label: 'Coming Soon Collections',
      subtype,
      mediaType,
      count: upcomingItems.length,
    });

    // Attach releaseDateSortValue to each item for multi-source orchestrator sorting
    // This uses the same priority logic as sortByReleaseDate: Digital > Physical > Generic
    const enrichedItems = upcomingItems.map((item) => {
      let sortDate: Date | null = null;

      if (item.mediaType === 'movie') {
        // Priority: Digital > Physical > Generic (actual availability, not theatrical)
        // Do NOT use inCinemas - theatrical release doesn't mean content is available for Plex
        if (item.digitalRelease) {
          sortDate = new Date(item.digitalRelease);
        } else if (item.physicalRelease) {
          sortDate = new Date(item.physicalRelease);
        } else if (item.releaseDate) {
          sortDate = new Date(item.releaseDate);
        }
        // inCinemas deliberately excluded - we care about home availability, not theatrical
      } else if (item.mediaType === 'tv') {
        // For TV: use airDate
        if (item.airDate) {
          sortDate = new Date(item.airDate);
        }
      }

      return {
        ...item,
        releaseDateSortValue: sortDate ? sortDate.toISOString() : undefined,
      };
    });

    return enrichedItems;
  }

  /**
   * Check if a movie is truly upcoming (not already released/available)
   */
  private isMovieUpcoming(movie: {
    status?: string;
    releaseDate?: string;
    digitalRelease?: string;
    physicalRelease?: string;
    inCinemas?: string;
  }): boolean {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // If status is announced, it's definitely upcoming
    if (movie.status === 'announced') {
      return true;
    }

    // If status is released but movie has no file, check if any release date is in the future
    // This handles cases where Radarr marks it as "released" but it's not actually available yet
    const releaseDates = [
      movie.releaseDate,
      movie.digitalRelease,
      movie.physicalRelease,
      movie.inCinemas,
    ].filter(Boolean);

    for (const dateStr of releaseDates) {
      if (dateStr) {
        const releaseDate = new Date(dateStr);
        releaseDate.setHours(0, 0, 0, 0);
        if (releaseDate > today) {
          return true;
        }
      }
    }

    // If status is "released" and all dates are in the past, not upcoming
    if (movie.status === 'released') {
      return false;
    }

    // If status is inCinemas/tba/etc, consider it upcoming
    return true;
  }

  /**
   * Fetch monitored but unreleased movies from Radarr
   * Filters by configurable release window during fetch (default: 360 days)
   */
  private async fetchMonitoredMovies(
    config: CollectionConfig
  ): Promise<ComingSoonSourceData[]> {
    const settings = getSettings();
    const items: ComingSoonSourceData[] = [];

    if (!settings.radarr || settings.radarr.length === 0) {
      return items;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const maxDaysAway = config.comingSoonDays || 360;
    const maxDate = new Date(Date.now() + maxDaysAway * 24 * 60 * 60 * 1000);

    for (const radarrInstance of settings.radarr) {
      try {
        const radarrClient = new RadarrAPI({
          url: `${radarrInstance.useSsl ? 'https' : 'http'}://${
            radarrInstance.hostname
          }:${radarrInstance.port}${radarrInstance.baseUrl || ''}/api/v3`,
          apiKey: radarrInstance.apiKey,
        });

        const allMovies = await radarrClient.getMovies();

        logger.debug('Processing Radarr movies for Coming Soon', {
          label: 'Coming Soon Collections',
          instance: radarrInstance.name,
          totalMovies: allMovies.length,
        });

        // Log first movie structure for debugging
        if (allMovies.length > 0) {
          logger.debug('Sample Radarr movie structure', {
            label: 'Coming Soon Collections',
            sampleMovie: {
              title: allMovies[0].title,
              monitored: allMovies[0].monitored,
              hasFile: allMovies[0].hasFile,
              monitoredType: typeof allMovies[0].monitored,
              hasFileType: typeof allMovies[0].hasFile,
            },
          });
        }

        // Filter for monitored movies without files that are upcoming
        let monitoredCount = 0;
        let withFilesCount = 0;
        let upcomingCount = 0;

        for (const movie of allMovies) {
          if (movie.monitored) {
            monitoredCount++;
          }

          if (movie.hasFile) {
            withFilesCount++;
          }

          if (!movie.monitored || movie.hasFile) {
            continue;
          }

          // Check if movie is actually upcoming (not already released/available)
          const isUpcoming = this.isMovieUpcoming(movie);
          if (!isUpcoming) {
            continue;
          }

          // Skip movies without any release date information
          const hasReleaseDate = Boolean(
            movie.releaseDate ||
              movie.digitalRelease ||
              movie.physicalRelease ||
              movie.inCinemas
          );

          if (!hasReleaseDate) {
            logger.debug('Skipping movie without release date', {
              label: 'Coming Soon Collections',
              title: movie.title,
              tmdbId: movie.tmdbId,
            });
            continue;
          }

          // Check if release date is within 360-day window
          // CRITICAL: Apply +3 month estimate for theatrical-only releases BEFORE filtering
          let releaseDate: Date | null = null;
          let isEstimated = false;

          if (movie.digitalRelease) {
            releaseDate = new Date(movie.digitalRelease);
          } else if (movie.physicalRelease) {
            releaseDate = new Date(movie.physicalRelease);
          } else if (movie.releaseDate) {
            // Only theatrical/generic - add 3 months estimate for filtering
            const baseDate = new Date(movie.releaseDate);
            baseDate.setDate(baseDate.getDate() + 90);
            releaseDate = baseDate;
            isEstimated = true;
          }

          if (releaseDate && releaseDate > maxDate) {
            logger.debug('Filtered out movie (too far away)', {
              label: 'Coming Soon Collections',
              title: movie.title,
              releaseDate: releaseDate.toISOString(),
              isEstimated,
              daysAway: Math.round(
                (releaseDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000)
              ),
            });
            continue;
          }

          upcomingCount++;

          // Pass all release date fields - categorization will determine priority
          items.push({
            tmdbId: movie.tmdbId,
            title: movie.title,
            mediaType: 'movie',
            source: 'radarr',
            monitored: true,
            // Pass all available release dates for categorization to prioritize
            releaseDate: movie.releaseDate,
            digitalRelease: movie.digitalRelease,
            physicalRelease: movie.physicalRelease,
            inCinemas: movie.inCinemas,
            year: movie.year,
            hasFile: false, // We already filtered for !hasFile
          });
        }

        logger.debug('Fetched monitored movies from Radarr', {
          label: 'Coming Soon Collections',
          instance: radarrInstance.name,
          totalMovies: allMovies.length,
          monitoredMovies: monitoredCount,
          moviesWithFiles: withFilesCount,
          upcomingMovies: upcomingCount,
          comingSoonItems: items.length,
        });
      } catch (error) {
        logger.error('Failed to fetch from Radarr instance', {
          label: 'Coming Soon Collections',
          instance: radarrInstance.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return items;
  }

  /**
   * Fetch monitored but unreleased TV shows from Sonarr
   * Check S01E01 air date and file status for new series
   * Check next monitored season premiere for returning shows (regardless of file status)
   * Filters by configurable release window during fetch (default: 360 days)
   */
  private async fetchMonitoredShows(
    config: CollectionConfig
  ): Promise<ComingSoonSourceData[]> {
    const settings = getSettings();
    const items: ComingSoonSourceData[] = [];

    logger.debug('fetchMonitoredShows called', {
      label: 'Coming Soon Collections',
      hasSonarr: !!settings.sonarr,
      sonarrCount: settings.sonarr?.length || 0,
    });

    if (!settings.sonarr || settings.sonarr.length === 0) {
      logger.warn('No Sonarr instances configured, skipping TV show fetch', {
        label: 'Coming Soon Collections',
      });
      return items;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const maxDaysAway = config.comingSoonDays || 360;
    const maxDate = new Date(Date.now() + maxDaysAway * 24 * 60 * 60 * 1000);

    for (const sonarrInstance of settings.sonarr) {
      try {
        const sonarrClient = new SonarrAPI({
          url: `${sonarrInstance.useSsl ? 'https' : 'http'}://${
            sonarrInstance.hostname
          }:${sonarrInstance.port}${sonarrInstance.baseUrl || ''}/api/v3`,
          apiKey: sonarrInstance.apiKey,
        });

        const allSeries = await sonarrClient.getSeries();

        logger.debug('Processing Sonarr series for Coming Soon', {
          label: 'Coming Soon Collections',
          instance: sonarrInstance.name,
          totalSeries: allSeries.length,
        });

        for (const series of allSeries) {
          if (!series.monitored) {
            continue;
          }

          if (!series.id) {
            // Series doesn't have an ID yet (not added to Sonarr), skip
            continue;
          }

          try {
            // Get all episodes for this series
            const episodes = await sonarrClient.getEpisodesBySeries(series.id);

            // Find all season premieres (episode 1 of each season, excluding specials)
            const seasonPremieres = episodes.filter(
              (ep) => ep.episodeNumber === 1 && ep.seasonNumber > 0
            );

            logger.debug('Checking series for upcoming premiere', {
              label: 'Coming Soon Collections',
              seriesTitle: series.title,
              totalEpisodes: episodes.length,
              seasonPremieres: seasonPremieres.length,
              seriesMonitored: series.monitored,
            });

            // Find the next unaired monitored season premiere
            const now = new Date();
            const nextPremiere = seasonPremieres.find((ep) => {
              if (!ep.airDateUtc || !ep.monitored) {
                return false;
              }
              const airDate = new Date(ep.airDateUtc);
              const hasFile = ep.episodeFileId > 0;
              const isFuture = airDate > now;

              logger.debug('Evaluating season premiere', {
                label: 'Coming Soon Collections',
                seriesTitle: series.title,
                season: ep.seasonNumber,
                episode: ep.episodeNumber,
                airDate: ep.airDateUtc,
                monitored: ep.monitored,
                hasFile,
                isFuture,
                episodeFileId: ep.episodeFileId,
              });

              // Next premiere must be in the future and not downloaded yet
              return isFuture && !hasFile;
            });

            if (!nextPremiere || !nextPremiere.airDateUtc) {
              // No upcoming season premiere for this series
              logger.debug('No upcoming premiere found for series', {
                label: 'Coming Soon Collections',
                seriesTitle: series.title,
              });
              continue;
            }

            // Check if air date is within 360-day window
            const airDate = new Date(nextPremiere.airDateUtc);
            if (airDate > maxDate) {
              logger.debug('Filtered out show (too far away)', {
                label: 'Coming Soon Collections',
                seriesTitle: series.title,
                season: nextPremiere.seasonNumber,
                airDate: nextPremiere.airDateUtc,
                daysAway: Math.round(
                  (airDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000)
                ),
              });
              continue;
            }

            logger.info('Found upcoming season premiere', {
              label: 'Coming Soon Collections',
              seriesTitle: series.title,
              season: nextPremiere.seasonNumber,
              episode: nextPremiere.episodeNumber,
              airDate: nextPremiere.airDateUtc,
            });

            // Convert TVDB ID to TMDB ID
            let tmdbId = 0;
            try {
              const TmdbAPI = (await import('@server/api/themoviedb')).default;
              const tmdbClient = new TmdbAPI();
              const externalIdResult = await tmdbClient.getByExternalId({
                externalId: series.tvdbId,
                type: 'tvdb',
              });

              if (
                externalIdResult.tv_results &&
                externalIdResult.tv_results.length > 0
              ) {
                tmdbId = externalIdResult.tv_results[0].id;
                logger.debug('Converted TVDB ID to TMDB ID', {
                  label: 'Coming Soon Collections',
                  seriesTitle: series.title,
                  tvdbId: series.tvdbId,
                  tmdbId,
                });
              } else {
                logger.warn('Could not find TMDB ID for TVDB ID', {
                  label: 'Coming Soon Collections',
                  seriesTitle: series.title,
                  tvdbId: series.tvdbId,
                });
              }
            } catch (error) {
              logger.error('Failed to convert TVDB ID to TMDB ID', {
                label: 'Coming Soon Collections',
                seriesTitle: series.title,
                tvdbId: series.tvdbId,
                error: error instanceof Error ? error.message : String(error),
              });
            }

            // Determine if has file and when it was downloaded (for the premiere episode)
            const hasFile = nextPremiere.episodeFileId > 0;
            let downloadedDate: string | undefined;

            if (hasFile) {
              try {
                // Get the actual episode file to get the real dateAdded
                const episodeFile = await sonarrClient.getEpisodeFile(
                  nextPremiere.episodeFileId
                );
                downloadedDate = episodeFile.dateAdded;
              } catch (error) {
                logger.debug(
                  'Could not get episode file date, using series added date as fallback',
                  {
                    label: 'Coming Soon Collections',
                    seriesTitle: series.title,
                    episodeFileId: nextPremiere.episodeFileId,
                  }
                );
                // Fallback to series added date if we can't get episode file
                downloadedDate = series.added;
              }
            }

            items.push({
              tmdbId, // Converted from TVDB ID
              tvdbId: series.tvdbId,
              title: series.title,
              year: series.year,
              mediaType: 'tv',
              source: 'sonarr',
              monitored: true,
              airDate: nextPremiere.airDateUtc,
              hasFile,
              downloadedDate,
              // isReturning based purely on season number
              // Season 1 = new show (PREMIERES), Season > 1 = returning show (RETURNING)
              isReturning: nextPremiere.seasonNumber > 1,
              seasonNumber: nextPremiere.seasonNumber,
              episodeNumber: nextPremiere.episodeNumber,
            });
          } catch (error) {
            logger.warn('Failed to get episodes for series', {
              label: 'Coming Soon Collections',
              seriesTitle: series.title,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        logger.debug('Fetched monitored shows from Sonarr', {
          label: 'Coming Soon Collections',
          instance: sonarrInstance.name,
          count: items.length,
        });
      } catch (error) {
        logger.error('Failed to fetch from Sonarr instance', {
          label: 'Coming Soon Collections',
          instance: sonarrInstance.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return items;
  }

  /**
   * Fetch anticipated movies from Trakt
   * Paginates through results and filters by configurable release window during fetch (default: 360 days)
   */
  private async fetchTraktAnticipatedMovies(
    maxItems: number,
    config: CollectionConfig
  ): Promise<ComingSoonSourceData[]> {
    const settings = getSettings();
    const items: ComingSoonSourceData[] = [];

    if (!settings.trakt.apiKey) {
      return items;
    }

    try {
      const traktClient = new TraktAPI(settings.trakt.apiKey);
      const TmdbAPI = (await import('@server/api/themoviedb')).default;
      const tmdbClient = new TmdbAPI();

      const perPage = 100; // Fetch 100 per page (Trakt max)
      const maxDaysAway = config.comingSoonDays || 360;
      const maxDate = new Date(Date.now() + maxDaysAway * 24 * 60 * 60 * 1000);

      let currentPage = 1;
      let hasMorePages = true;
      let totalFetched = 0;

      while (hasMorePages && items.length < maxItems) {
        const anticipatedMovies = await traktClient.getAnticipated(
          'movies',
          perPage,
          currentPage
        );

        if (!anticipatedMovies || anticipatedMovies.length === 0) {
          hasMorePages = false;
          break;
        }

        totalFetched += anticipatedMovies.length;

        // Process each movie and check release date
        for (const item of anticipatedMovies) {
          const movie = item.movie;
          if (!movie || !movie.ids?.tmdb) {
            continue;
          }

          // Fetch release dates from TMDB to check if within 360-day window
          // CRITICAL: Apply +3 month estimate for theatrical-only releases BEFORE filtering
          let releaseDate: Date | null = null;
          let isEstimated = false;
          try {
            const movieDetails = await tmdbClient.getMovie({
              movieId: movie.ids.tmdb,
            });

            // Check for digital/physical/generic release dates
            if (movieDetails.release_dates?.results) {
              const usRelease = movieDetails.release_dates.results.find(
                (r) => r.iso_3166_1 === 'US'
              );
              if (usRelease?.release_dates) {
                for (const rd of usRelease.release_dates) {
                  // Type 4 = Digital, Type 5 = Physical
                  if ((rd.type === 4 || rd.type === 5) && rd.release_date) {
                    releaseDate = new Date(rd.release_date);
                    break;
                  }
                }
              }
            }

            // Fallback to generic release_date if no digital/physical found
            // Add 3 months estimate for theatrical-only releases
            if (!releaseDate && movieDetails.release_date) {
              const baseDate = new Date(movieDetails.release_date);
              baseDate.setDate(baseDate.getDate() + 90);
              releaseDate = baseDate;
              isEstimated = true;
            }
          } catch (error) {
            // If TMDB fetch fails, skip this item
            logger.debug('Failed to fetch TMDB data for movie', {
              label: 'Coming Soon Collections',
              title: movie.title,
              tmdbId: movie.ids.tmdb,
            });
            continue;
          }

          // Filter: only include if within 360-day window
          if (!releaseDate || releaseDate > maxDate) {
            logger.debug(
              'Filtered out movie (no release date or too far away)',
              {
                label: 'Coming Soon Collections',
                title: movie.title,
                releaseDate: releaseDate?.toISOString(),
                isEstimated,
                daysAway: releaseDate
                  ? Math.round(
                      (releaseDate.getTime() - Date.now()) /
                        (24 * 60 * 60 * 1000)
                    )
                  : null,
              }
            );
            continue;
          }

          // Add to items
          items.push({
            tmdbId: movie.ids.tmdb,
            title: movie.title,
            year: movie.year,
            mediaType: 'movie',
            source: 'trakt',
            monitored: false, // Will be updated by markMonitoredStatus
          });

          // Stop if we've reached maxItems
          if (items.length >= maxItems) {
            break;
          }
        }

        currentPage++;

        // Check if we should stop pagination
        if (anticipatedMovies.length < perPage) {
          hasMorePages = false; // Last page
        }
      }

      logger.info('Fetched anticipated movies from Trakt with date filtering', {
        label: 'Coming Soon Collections',
        totalFetched,
        validItems: items.length,
        pagesFetched: currentPage - 1,
        maxItems,
      });
    } catch (error) {
      logger.error('Failed to fetch anticipated movies from Trakt', {
        label: 'Coming Soon Collections',
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return items;
  }

  /**
   * Fetch anticipated TV shows from Trakt
   * Paginates through results and filters by configurable release window during fetch (default: 360 days)
   */
  private async fetchTraktAnticipatedShows(
    maxItems: number,
    config: CollectionConfig
  ): Promise<ComingSoonSourceData[]> {
    const settings = getSettings();
    const items: ComingSoonSourceData[] = [];

    if (!settings.trakt.apiKey) {
      return items;
    }

    try {
      const traktClient = new TraktAPI(settings.trakt.apiKey);
      const TmdbAPI = (await import('@server/api/themoviedb')).default;
      const tmdbClient = new TmdbAPI();

      const perPage = 100; // Fetch 100 per page (Trakt max)
      const maxDaysAway = config.comingSoonDays || 360;
      const maxDate = new Date(Date.now() + maxDaysAway * 24 * 60 * 60 * 1000);

      let currentPage = 1;
      let hasMorePages = true;
      let totalFetched = 0;

      while (hasMorePages && items.length < maxItems) {
        const anticipatedShows = await traktClient.getAnticipated(
          'shows',
          perPage,
          currentPage
        );

        if (!anticipatedShows || anticipatedShows.length === 0) {
          hasMorePages = false;
          break;
        }

        totalFetched += anticipatedShows.length;

        // Process each show and check air date
        for (const item of anticipatedShows) {
          const show = item.show;
          if (!show || !show.ids?.tmdb) {
            continue;
          }

          // Fetch air date from TMDB to check if within 360-day window
          let airDate: Date | null = null;
          try {
            const showDetails = await tmdbClient.getTvShow({
              tvId: show.ids.tmdb,
            });

            // Use first_air_date for new shows
            if (showDetails.first_air_date) {
              airDate = new Date(showDetails.first_air_date);
            }
          } catch (error) {
            // If TMDB fetch fails, skip this item
            logger.debug('Failed to fetch TMDB data for show', {
              label: 'Coming Soon Collections',
              title: show.title,
              tmdbId: show.ids.tmdb,
            });
            continue;
          }

          // Filter: only include if within 360-day window
          if (!airDate || airDate > maxDate) {
            logger.debug('Filtered out show (no air date or too far away)', {
              label: 'Coming Soon Collections',
              title: show.title,
              airDate: airDate?.toISOString(),
              daysAway: airDate
                ? Math.round(
                    (airDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000)
                  )
                : null,
            });
            continue;
          }

          // Add to items
          items.push({
            tmdbId: show.ids.tmdb,
            tvdbId: show.ids.tvdb,
            title: show.title,
            year: show.year,
            mediaType: 'tv',
            source: 'trakt',
            monitored: false, // Will be updated by markMonitoredStatus
          });

          // Stop if we've reached maxItems
          if (items.length >= maxItems) {
            break;
          }
        }

        currentPage++;

        // Check if we should stop pagination
        if (anticipatedShows.length < perPage) {
          hasMorePages = false; // Last page
        }
      }

      logger.info('Fetched anticipated shows from Trakt with date filtering', {
        label: 'Coming Soon Collections',
        totalFetched,
        validItems: items.length,
        pagesFetched: currentPage - 1,
        maxItems,
      });
    } catch (error) {
      logger.error('Failed to fetch anticipated shows from Trakt', {
        label: 'Coming Soon Collections',
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return items;
  }

  /**
   * Enrich items with TMDB release dates
   * Adds 3-month estimate for items with only theatrical releases
   */
  private async enrichWithTMDBReleaseDates(
    items: ComingSoonSourceData[]
  ): Promise<void> {
    const TmdbAPI = (await import('@server/api/themoviedb')).default;
    const tmdbClient = new TmdbAPI();

    for (const item of items) {
      // For monitored items from Radarr/Sonarr, apply priority logic and estimation
      if (item.monitored && item.mediaType === 'movie') {
        // Set releaseDate using priority: Digital > Physical > Theatrical (+3 months)
        if (item.digitalRelease) {
          // Use digital release date (highest priority)
          item.releaseDate = item.digitalRelease.split('T')[0];
        } else if (item.physicalRelease) {
          // Use physical release date (second priority)
          item.releaseDate = item.physicalRelease.split('T')[0];
        } else if (item.releaseDate) {
          // Only theatrical/generic - add 3 months estimate
          const originalDate = item.releaseDate;
          const baseDate = new Date(originalDate);
          baseDate.setDate(baseDate.getDate() + 90);
          item.releaseDate = baseDate.toISOString().split('T')[0];
          item.isEstimatedDate = true;

          logger.debug('Applied 3-month estimate to monitored item', {
            label: 'Coming Soon Collections',
            title: item.title,
            originalDate,
            estimatedDate: item.releaseDate,
          });
        }
        continue; // Skip TMDB fetch for monitored items - use Radarr/Sonarr data
      }

      try {
        if (item.mediaType === 'movie') {
          // Fetch movie details from TMDB (includes release_dates in append_to_response)
          const movieDetails = await tmdbClient.getMovie({
            movieId: item.tmdbId,
          });

          // Extract digital/physical/theatrical release dates from release_dates
          if (movieDetails.release_dates?.results) {
            // Find US release dates
            const usRelease = movieDetails.release_dates.results.find(
              (r) => r.iso_3166_1 === 'US'
            );
            if (usRelease?.release_dates) {
              for (const rd of usRelease.release_dates) {
                // Type 4 = Digital, Type 5 = Physical, Type 3 = Theatrical
                if (rd.type === 4 && rd.release_date) {
                  item.digitalRelease = rd.release_date;
                }
                if (rd.type === 5 && rd.release_date) {
                  item.physicalRelease = rd.release_date;
                }
                if (rd.type === 3 && rd.release_date) {
                  item.inCinemas = rd.release_date;
                }
              }
            }
          }

          // Set releaseDate using priority: Digital > Physical > Theatrical (+3 months)
          if (item.digitalRelease) {
            // Use digital release date (highest priority)
            item.releaseDate = item.digitalRelease.split('T')[0];
          } else if (item.physicalRelease) {
            // Use physical release date (second priority)
            item.releaseDate = item.physicalRelease.split('T')[0];
          } else if (movieDetails.release_date) {
            // No digital/physical - use theatrical + 3 months estimate
            const baseDate = new Date(movieDetails.release_date);
            baseDate.setDate(baseDate.getDate() + 90);
            item.releaseDate = baseDate.toISOString().split('T')[0];
            item.isEstimatedDate = true;

            logger.debug(
              'Using estimated release date (theatrical + 3 months)',
              {
                label: 'Coming Soon Collections',
                title: item.title,
                originalDate: movieDetails.release_date,
                estimatedDate: item.releaseDate,
              }
            );
          }
        } else if (item.mediaType === 'tv') {
          // Only enrich airDate if not already set (Sonarr already provides season-specific dates)
          if (!item.airDate) {
            // Fetch TV show details from TMDB
            const showDetails = await tmdbClient.getTvShow({
              tvId: item.tmdbId,
            });

            // Find the next upcoming season premiere
            const now = new Date();
            let nextSeasonAirDate: string | null = null;
            let nextSeasonNumber = 0;

            if (showDetails.seasons && showDetails.seasons.length > 0) {
              // Sort seasons by season number
              const seasons = showDetails.seasons
                .filter((s) => s.season_number > 0) // Exclude specials (season 0)
                .sort((a, b) => a.season_number - b.season_number);

              // Find the next season that hasn't aired yet
              for (const season of seasons) {
                if (season.air_date) {
                  const airDate = new Date(season.air_date);
                  if (airDate > now) {
                    nextSeasonAirDate = season.air_date;
                    nextSeasonNumber = season.season_number;
                    break;
                  }
                }
              }
            }

            if (nextSeasonAirDate) {
              item.airDate = nextSeasonAirDate;
              item.seasonNumber = nextSeasonNumber;
              item.isReturning = nextSeasonNumber > 1;

              logger.debug('Found upcoming season from TMDB for Trakt item', {
                label: 'Coming Soon Collections',
                title: item.title,
                seasonNumber: nextSeasonNumber,
                airDate: nextSeasonAirDate,
              });
            } else if (showDetails.first_air_date) {
              // Fallback to first_air_date if no future seasons found
              item.airDate = showDetails.first_air_date;
              item.seasonNumber = 1;
              item.isReturning = false;
            }
          }
        }

        logger.debug('Enriched item with TMDB release date', {
          label: 'Coming Soon Collections',
          title: item.title,
          mediaType: item.mediaType,
          releaseDate: item.releaseDate || item.airDate,
        });
      } catch (error) {
        logger.warn('Failed to fetch TMDB release date for item', {
          label: 'Coming Soon Collections',
          title: item.title,
          tmdbId: item.tmdbId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.debug('Completed TMDB release date enrichment', {
      label: 'Coming Soon Collections',
      enrichedCount: items.filter(
        (i) => !i.monitored && (i.releaseDate || i.airDate)
      ).length,
    });
  }

  /**
   * Cross-reference Trakt items with Radarr/Sonarr to mark monitored status
   * and enrich with release dates and file status
   */
  private async markMonitoredStatus(
    items: ComingSoonSourceData[]
  ): Promise<void> {
    const settings = getSettings();

    // Build maps of movie data from Radarr (keyed by TMDB ID)
    const radarrMovieMap = new Map<
      number,
      {
        monitored: boolean;
        hasFile: boolean;
        releaseDate?: string;
        digitalRelease?: string;
        physicalRelease?: string;
        inCinemas?: string;
      }
    >();

    // Build maps of show data from Sonarr (keyed by TVDB ID)
    const sonarrShowMap = new Map<
      number,
      {
        monitored: boolean;
        hasFile: boolean;
        airDate?: string;
        downloadedDate?: string;
      }
    >();

    // Fetch movie data from Radarr
    if (settings.radarr && settings.radarr.length > 0) {
      for (const radarrInstance of settings.radarr) {
        try {
          const radarrClient = new RadarrAPI({
            url: `${radarrInstance.useSsl ? 'https' : 'http'}://${
              radarrInstance.hostname
            }:${radarrInstance.port}${radarrInstance.baseUrl || ''}/api/v3`,
            apiKey: radarrInstance.apiKey,
          });

          const movies = await radarrClient.getMovies();
          for (const movie of movies) {
            radarrMovieMap.set(movie.tmdbId, {
              monitored: movie.monitored,
              hasFile: movie.hasFile,
              releaseDate: movie.releaseDate,
              digitalRelease: movie.digitalRelease,
              physicalRelease: movie.physicalRelease,
              inCinemas: movie.inCinemas,
            });
          }
        } catch (error) {
          logger.warn('Failed to fetch movies for cross-reference', {
            label: 'Coming Soon Collections',
            instance: radarrInstance.name,
          });
        }
      }
    }

    // Fetch show data from Sonarr
    if (settings.sonarr && settings.sonarr.length > 0) {
      for (const sonarrInstance of settings.sonarr) {
        try {
          const sonarrClient = new SonarrAPI({
            url: `${sonarrInstance.useSsl ? 'https' : 'http'}://${
              sonarrInstance.hostname
            }:${sonarrInstance.port}${sonarrInstance.baseUrl || ''}/api/v3`,
            apiKey: sonarrInstance.apiKey,
          });

          const allSeries = await sonarrClient.getSeries();
          for (const series of allSeries) {
            if (!series.id) continue;

            try {
              // Get S01E01 details
              const episodes = await sonarrClient.getEpisodesBySeries(
                series.id
              );
              const s01e01 = episodes.find(
                (ep) => ep.seasonNumber === 1 && ep.episodeNumber === 1
              );

              if (s01e01 && s01e01.monitored) {
                const hasFile = s01e01.episodeFileId > 0;
                let downloadedDate: string | undefined;

                if (hasFile) {
                  try {
                    const episodeFile = await sonarrClient.getEpisodeFile(
                      s01e01.episodeFileId
                    );
                    downloadedDate = episodeFile.dateAdded;
                  } catch {
                    downloadedDate = series.added;
                  }
                }

                sonarrShowMap.set(series.tvdbId, {
                  monitored: series.monitored,
                  hasFile,
                  airDate: s01e01.airDateUtc,
                  downloadedDate,
                });
              }
            } catch (error) {
              // Skip series if we can't get episode data
              logger.debug('Could not get episode data for series', {
                label: 'Coming Soon Collections',
                seriesTitle: series.title,
              });
            }
          }
        } catch (error) {
          logger.warn('Failed to fetch shows for cross-reference', {
            label: 'Coming Soon Collections',
            instance: sonarrInstance.name,
          });
        }
      }
    }

    // Enrich Trakt items with data from Radarr/Sonarr
    for (const item of items) {
      if (item.mediaType === 'movie') {
        const radarrData = radarrMovieMap.get(item.tmdbId);
        if (radarrData) {
          item.monitored = radarrData.monitored;
          item.hasFile = radarrData.hasFile;
          item.releaseDate = radarrData.releaseDate;
          item.digitalRelease = radarrData.digitalRelease;
          item.physicalRelease = radarrData.physicalRelease;
          item.inCinemas = radarrData.inCinemas;
        } else {
          // Not in Radarr
          item.monitored = false;
          item.hasFile = false;
        }
      } else if (item.tvdbId) {
        const sonarrData = sonarrShowMap.get(item.tvdbId);
        if (sonarrData) {
          item.monitored = sonarrData.monitored;
          item.hasFile = sonarrData.hasFile;
          item.airDate = sonarrData.airDate;
          item.downloadedDate = sonarrData.downloadedDate;
        } else {
          // Not in Sonarr
          item.monitored = false;
          item.hasFile = false;
        }
      }
    }

    // Fetch TMDB release dates for non-monitored items (external_request items)
    await this.enrichWithTMDBReleaseDates(items);

    logger.debug('Enriched Trakt items with Radarr/Sonarr data', {
      label: 'Coming Soon Collections',
      totalItems: items.length,
      monitored: items.filter((i) => i.monitored).length,
      needsRequest: items.filter((i) => !i.monitored).length,
      withReleaseData: items.filter((i) => i.releaseDate || i.airDate).length,
    });
  }

  /**
   * Check if a Plex item is one of our Coming Soon placeholders
   */
  private async isPlaceholderItem(
    ratingKey: string,
    mediaType: 'movie' | 'tv',
    plexClient: PlexAPI
  ): Promise<boolean> {
    try {
      const metadata = await plexClient.getMetadata(ratingKey);

      if (mediaType === 'movie') {
        // Check for {edition-Coming Soon} in the file path or edition field
        const editionTitle = (metadata as unknown as Record<string, unknown>)
          .editionTitle;
        if (
          editionTitle &&
          typeof editionTitle === 'string' &&
          editionTitle.includes('Coming Soon')
        ) {
          return true;
        }

        // Check media file path
        if (metadata.Media && metadata.Media.length > 0) {
          const media = metadata.Media[0] as unknown as Record<string, unknown>;
          const parts = media.Part as { file?: string }[] | undefined;
          if (parts && parts.length > 0) {
            const filePath = parts[0].file;
            if (filePath && filePath.includes('{edition-Coming Soon}')) {
              return true;
            }
          }
        }
      } else {
        // For TV shows, check if it only has Season 00
        const childCount = (metadata as unknown as Record<string, unknown>)
          .childCount;
        if (childCount === 1) {
          // Fetch seasons to check if it's only Season 00
          const seasons = await plexClient.getChildrenMetadata(ratingKey);
          if (seasons.length === 1 && seasons[0].index === 0) {
            return true;
          }
        }
      }

      return false;
    } catch (error) {
      logger.debug('Error checking if item is placeholder', {
        label: 'Coming Soon Collections',
        ratingKey,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Map source data to CollectionItem format
   * Identifies both real Plex items and our placeholder files, treating placeholders as "missing"
   */
  public async mapSourceDataToItems(
    sourceData: ComingSoonSourceData[],
    config: CollectionConfig,
    plexClient: PlexAPI,
    libraryCache?: LibraryItemsCache
  ): Promise<{
    items: CollectionItem[];
    missingItems: MissingItem[];
    placeholderItems: { ratingKey: string; sourceItem: ComingSoonSourceData }[];
    mappingStats: {
      total: number;
      matched: number;
      unmatched: number;
      placeholders: number;
    };
  }> {
    const items: CollectionItem[] = [];
    const missingItems: MissingItem[] = [];
    const placeholderItems: {
      ratingKey: string;
      sourceItem: ComingSoonSourceData;
    }[] = [];

    logger.info('Mapping Coming Soon items', {
      label: 'Coming Soon Collections',
      sourceCount: sourceData.length,
    });

    // Check for existing items in Plex
    const tmdbLookups = sourceData
      .filter((item) => item.tmdbId > 0)
      .map((item) => ({
        tmdbId: item.tmdbId,
        mediaType: item.mediaType,
        title: item.title,
      }));

    const matchedItemsMap = await findPlexItemsByTmdbIds(
      plexClient,
      tmdbLookups,
      config.libraryId,
      libraryCache
    );

    const tmdbToSource = new Map(sourceData.map((s) => [s.tmdbId, s]));
    const matchedTmdbIds = new Set<number>();

    // Check matched items - separate real items from our placeholders
    for (const [tmdbKey, itemData] of matchedItemsMap) {
      const tmdbId = parseInt(tmdbKey.replace('tmdb-', ''), 10);
      const sourceItem = tmdbToSource.get(tmdbId);

      if (!sourceItem) continue;

      // Check if item still exists in Plex and if it's a placeholder
      let itemExists = true;
      let isPlaceholder = false;

      try {
        await plexClient.getMetadata(itemData.ratingKey);
        // If we got here, item exists - now check if it's a placeholder
        isPlaceholder = await this.isPlaceholderItem(
          itemData.ratingKey,
          sourceItem.mediaType,
          plexClient
        );
      } catch (error) {
        // Item doesn't exist anymore (404) - treat as missing and recreate placeholder
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('404')) {
          logger.info('Item was deleted, will recreate placeholder', {
            label: 'Coming Soon Collections',
            title: sourceItem.title,
            ratingKey: itemData.ratingKey,
          });
          itemExists = false;
        } else {
          // Other error - log and treat as existing to be safe
          logger.warn('Error checking item existence, assuming it exists', {
            label: 'Coming Soon Collections',
            title: sourceItem.title,
            ratingKey: itemData.ratingKey,
            error: errorMessage,
          });
        }
      }

      if (!itemExists) {
        // Item was deleted - don't mark as matched so it will be recreated
        continue;
      }

      matchedTmdbIds.add(tmdbId);

      if (isPlaceholder) {
        // Track placeholder items separately - they need overlays
        placeholderItems.push({
          ratingKey: itemData.ratingKey,
          sourceItem,
        });

        logger.debug('Identified existing placeholder in Plex', {
          label: 'Coming Soon Collections',
          title: sourceItem.title,
          ratingKey: itemData.ratingKey,
        });
      }

      // Add to collection items regardless (both real and placeholders go in collection)
      // Include releaseDateSortValue for multi-source orchestrator sorting
      items.push({
        ratingKey: itemData.ratingKey,
        title: itemData.title,
        type: sourceItem.mediaType || 'movie',
        tmdbId: tmdbId,
        releaseDateSortValue: sourceItem.releaseDateSortValue,
      } as CollectionItem & { releaseDateSortValue?: string });
    }

    // Add missing items (not yet in Plex at all)
    for (const sourceItem of sourceData) {
      if (sourceItem.tmdbId > 0 && !matchedTmdbIds.has(sourceItem.tmdbId)) {
        // isReturning was already set in fetchMonitoredShows based on season number
        missingItems.push({
          tmdbId: sourceItem.tmdbId,
          tvdbId: sourceItem.tvdbId,
          mediaType: sourceItem.mediaType,
          title: sourceItem.title,
          year: sourceItem.year,
          originalPosition: missingItems.length + 1,
        });
      }
    }

    logger.info('Mapped Coming Soon items', {
      label: 'Coming Soon Collections',
      total: sourceData.length,
      matched: items.length,
      missing: missingItems.length,
      existingPlaceholders: placeholderItems.length,
    });

    return {
      items,
      missingItems,
      placeholderItems,
      mappingStats: {
        total: sourceData.length,
        matched: items.length,
        unmatched: missingItems.length,
        placeholders: placeholderItems.length,
      },
    };
  }

  /**
   * Retry downloading a trailer if the current file is the fallback placeholder
   * Returns true if the file was replaced, false otherwise
   */
  private async retryTrailerDownload(
    dbItem: ComingSoonItem,
    fallbackPlaceholderSize: number,
    sourceItem: ComingSoonSourceData,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    config: CollectionConfig
  ): Promise<boolean> {
    try {
      // Check if the current file size matches the fallback placeholder
      const stats = await fs.stat(dbItem.placeholderPath);

      if (stats.size !== fallbackPlaceholderSize) {
        // File size doesn't match fallback - this is a real trailer
        return false;
      }

      logger.info(
        'Detected fallback placeholder, attempting to download real trailer',
        {
          label: 'Coming Soon Collections',
          title: sourceItem.title,
          tmdbId: sourceItem.tmdbId,
        }
      );

      // Attempt to download a real trailer
      const { downloadTrailer } = await import(
        '@server/lib/comingsoon/trailerDownload'
      );
      const trailerPath = await downloadTrailer(
        sourceItem.title,
        sourceItem.year,
        sourceItem.mediaType
      );

      // Check if the downloaded trailer is different from the fallback
      const newStats = await fs.stat(trailerPath);
      if (newStats.size === fallbackPlaceholderSize) {
        // Still the fallback, no real trailer available yet
        logger.debug('No real trailer available yet, keeping fallback', {
          label: 'Coming Soon Collections',
          title: sourceItem.title,
        });
        // Clean up temp file
        try {
          await fs.unlink(trailerPath);
        } catch {
          // Ignore cleanup errors
        }
        return false;
      }

      // We have a real trailer! Replace the placeholder file
      logger.info(
        'Successfully downloaded real trailer, replacing placeholder',
        {
          label: 'Coming Soon Collections',
          title: sourceItem.title,
          oldSize: stats.size,
          newSize: newStats.size,
        }
      );

      await fs.copyFile(trailerPath, dbItem.placeholderPath);

      // Clean up temp file
      try {
        await fs.unlink(trailerPath);
      } catch (error) {
        logger.warn('Failed to clean up temp trailer file', {
          label: 'Coming Soon Collections',
          path: trailerPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      return true; // File was replaced
    } catch (error) {
      logger.debug('Failed to retry trailer download', {
        label: 'Coming Soon Collections',
        title: sourceItem.title,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Apply overlays to existing placeholder items that are already in Plex
   */
  public async applyOverlaysToExistingPlaceholders(
    placeholderItems: { ratingKey: string; sourceItem: ComingSoonSourceData }[],
    config: CollectionConfig,
    plexClient: PlexAPI
  ): Promise<void> {
    const { generateOverlayPoster } = await import(
      '@server/lib/comingsoon/overlayGenerator'
    );
    const { categorizeItem } = await import(
      '@server/lib/comingsoon/categorization'
    );
    const TmdbAPI = (await import('@server/api/themoviedb')).default;
    const tmdbClient = new TmdbAPI();
    const overlayColor = config.comingSoonOverlayColor || '#C21807';

    // Get fallback placeholder file size for comparison
    let fallbackPlaceholderSize: number | undefined;
    try {
      const path = await import('path');
      const fallbackPath = path.default.join(
        process.cwd(),
        'public',
        'assets',
        'placeholder.mp4'
      );
      const stats = await fs.stat(fallbackPath);
      fallbackPlaceholderSize = stats.size;
    } catch (error) {
      logger.warn(
        'Could not get fallback placeholder size, skipping retry logic',
        {
          label: 'Coming Soon Collections',
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }

    // Get all Coming Soon items from database (both released and unreleased)
    const repository = getRepository(ComingSoonItem);
    let dbItemsMap: Map<number, ComingSoonItem> | undefined;
    let releasedItemsMap: Map<number, ComingSoonItem> | undefined;
    try {
      const allItems = await repository.find({
        where: { configId: config.id },
      });
      // Map of ALL items (for placeholder path lookups and retry logic)
      dbItemsMap = new Map(allItems.map((item) => [item.tmdbId, item]));
      // Map of only released items (for releasedAt date tracking)
      releasedItemsMap = new Map(
        allItems
          .filter(
            (item) => item.releasedAt !== null && item.releasedAt !== undefined
          )
          .map((item) => [item.tmdbId, item])
      );
    } catch {
      // If table doesn't exist yet, skip
      dbItemsMap = new Map();
      releasedItemsMap = new Map();
    }

    // Track if we need to scan after replacing any placeholders
    let needsLibraryScan = false;

    for (const { ratingKey, sourceItem } of placeholderItems) {
      try {
        // Get database record for this item (includes both released and unreleased)
        const dbItem = dbItemsMap?.get(sourceItem.tmdbId);
        const releasedAt = releasedItemsMap?.get(sourceItem.tmdbId)?.releasedAt;

        // Check if this placeholder is using the fallback video and try to re-download
        if (fallbackPlaceholderSize && dbItem?.placeholderPath) {
          const retryResult = await this.retryTrailerDownload(
            dbItem,
            fallbackPlaceholderSize,
            sourceItem,
            config
          );
          if (retryResult) {
            needsLibraryScan = true;
          }
        }

        // Categorize the item (pass releasedAt if available)
        const category = categorizeItem(
          sourceItem,
          {
            futureDays: 360, // Look 360 days ahead
            recentDays: 7, // For possible future implementation
            futureOnly: false,
          },
          releasedAt
        );

        if (!category) {
          logger.warn('Could not categorize item for overlay', {
            label: 'Coming Soon Collections',
            title: sourceItem.title,
          });
          continue;
        }

        // Get poster URL from TMDB
        let posterUrl: string | undefined;
        if (sourceItem.mediaType === 'movie') {
          const movieDetails = await tmdbClient.getMovie({
            movieId: sourceItem.tmdbId,
          });
          posterUrl = movieDetails.poster_path
            ? `https://image.tmdb.org/t/p/original${movieDetails.poster_path}`
            : undefined;
        } else {
          const showDetails = await tmdbClient.getTvShow({
            tvId: sourceItem.tmdbId,
          });
          posterUrl = showDetails.poster_path
            ? `https://image.tmdb.org/t/p/original${showDetails.poster_path}`
            : undefined;
        }

        if (posterUrl) {
          const overlayPosterBuffer = await generateOverlayPoster({
            posterUrl,
            category,
            releaseDate: sourceItem.releaseDate || sourceItem.airDate,
            color: overlayColor,
            dateFormat: 'd mmm',
            capitalizeDates: true,
            isEstimatedDate: sourceItem.isEstimatedDate,
            seasonNumber: sourceItem.seasonNumber,
          });

          // Upload poster to Plex
          const tempPosterPath = `/tmp/comingsoon-${sourceItem.tmdbId}.jpg`;
          await fs.writeFile(tempPosterPath, overlayPosterBuffer);
          await plexClient.uploadPosterFromFile(ratingKey, tempPosterPath);
          await fs.unlink(tempPosterPath);

          logger.info('Applied overlay poster to existing placeholder', {
            label: 'Coming Soon Collections',
            title: sourceItem.title,
            category,
            ratingKey,
            releasedAt: releasedAt ? releasedAt.toISOString() : undefined,
          });

          // Save to database for cleanup tracking (if not already tracked)
          // This handles both placeholders and regular items (like returning TV shows)
          if (!dbItem) {
            const newRecord = repository.create({
              configId: config.id,
              mediaType: sourceItem.mediaType,
              tmdbId: sourceItem.tmdbId,
              tvdbId: sourceItem.tvdbId,
              title: sourceItem.title,
              year: sourceItem.year,
              releaseDate: sourceItem.releaseDate || sourceItem.airDate,
              isEstimatedDate: sourceItem.isEstimatedDate || false,
              seasonNumber: sourceItem.seasonNumber,
              source: sourceItem.source,
              // placeholderPath left undefined for regular items (not placeholder files)
              plexRatingKey: ratingKey,
            });

            await repository.save(newRecord);

            logger.debug(
              'Saved regular Coming Soon item to database for cleanup tracking',
              {
                label: 'Coming Soon Collections',
                title: sourceItem.title,
                isReturning: sourceItem.isReturning,
              }
            );
          }
        }
      } catch (error) {
        logger.error('Failed to apply overlay to existing placeholder', {
          label: 'Coming Soon Collections',
          title: sourceItem.title,
          ratingKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Trigger library scan if we replaced any fallback placeholders with real trailers
    if (needsLibraryScan) {
      logger.info(
        'Triggering library scan after replacing fallback placeholders',
        {
          label: 'Coming Soon Collections',
          libraryId: config.libraryId,
        }
      );
      try {
        await plexClient.scanLibrary(config.libraryId);
      } catch (error) {
        logger.warn(
          'Failed to trigger library scan after trailer replacements',
          {
            label: 'Coming Soon Collections',
            libraryId: config.libraryId,
            error: error instanceof Error ? error.message : String(error),
          }
        );
      }
    }
  }

  /**
   * Get released items that are within the configured post-release window (default: 7 days)
   * These are items that now have real files in Plex
   */
  private async getReleasedItemsWithinWindow(
    config: CollectionConfig,
    sourceData: ComingSoonSourceData[],
    libraryCache: LibraryItemsCache | undefined
  ): Promise<CollectionItem[]> {
    const { calculateDaysSince } = await import(
      '@server/lib/comingsoon/categorization'
    );
    const releasedItems: CollectionItem[] = [];

    // Get released items from database
    let repository;
    let dbReleasedItems: ComingSoonItem[];
    try {
      repository = getRepository(ComingSoonItem);
      dbReleasedItems = await repository.find({
        where: { configId: config.id },
      });
    } catch {
      // If table doesn't exist yet, return empty
      return [];
    }

    // Filter for items that are released and within configured window from RELEASE DATE
    const releasedWindowDays = config.comingSoonReleasedDays || 7;
    const itemsWithinWindow = dbReleasedItems.filter((item) => {
      // Must have been marked as released (real file detected)
      if (!item.releasedAt) return false;
      // Must have release date to calculate window
      if (!item.releaseDate) return false;
      // Check if release date is within configured window
      const daysSinceReleaseDate = calculateDaysSince(item.releaseDate);
      return (
        daysSinceReleaseDate >= 0 && daysSinceReleaseDate <= releasedWindowDays
      );
    });

    if (itemsWithinWindow.length === 0) {
      return [];
    }

    logger.info(
      `Found released items within ${releasedWindowDays}-day window`,
      {
        label: 'Coming Soon Collections',
        count: itemsWithinWindow.length,
        releasedWindowDays,
      }
    );

    // Find these items in Plex library cache
    for (const dbItem of itemsWithinWindow) {
      try {
        let ratingKey: string | undefined;

        if (libraryCache) {
          // Search library cache for the real item
          const allLibraries = Object.values(libraryCache);
          for (const library of allLibraries) {
            const plexItem = library.find((item) => {
              const tmdbGuid = item.Guid?.find((guid) =>
                guid.id.startsWith('tmdb://')
              );
              const tmdbMatch = tmdbGuid?.id.match(/tmdb:\/\/(\d+)/);
              const itemTmdbId = tmdbMatch ? parseInt(tmdbMatch[1], 10) : null;

              if (dbItem.mediaType === 'movie') {
                return itemTmdbId === dbItem.tmdbId;
              }

              // For TV shows, also check TVDB
              const tvdbGuid = item.Guid?.find((guid) =>
                guid.id.startsWith('tvdb://')
              );
              const tvdbMatch = tvdbGuid?.id.match(/tvdb:\/\/(\d+)/);
              const itemTvdbId = tvdbMatch ? parseInt(tvdbMatch[1], 10) : null;

              return (
                itemTmdbId === dbItem.tmdbId ||
                (dbItem.tvdbId && itemTvdbId === dbItem.tvdbId)
              );
            });

            if (plexItem) {
              ratingKey = plexItem.ratingKey;
              break;
            }
          }
        } else if (dbItem.plexRatingKey) {
          // Use stored rating key
          ratingKey = dbItem.plexRatingKey;
        }

        if (ratingKey) {
          releasedItems.push({
            ratingKey,
            title: dbItem.title,
            type: dbItem.mediaType,
            tmdbId: dbItem.tmdbId,
            releasedAt: dbItem.releasedAt,
          } as CollectionItem & { releasedAt: Date });

          logger.debug('Added released item to collection', {
            label: 'Coming Soon Collections',
            title: dbItem.title,
            tmdbId: dbItem.tmdbId,
            ratingKey,
            daysSinceReleaseDate: dbItem.releaseDate
              ? calculateDaysSince(dbItem.releaseDate)
              : 0,
            releaseDate: dbItem.releaseDate,
          });
        }
      } catch (error) {
        logger.warn('Failed to find released item in Plex', {
          label: 'Coming Soon Collections',
          title: dbItem.title,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return releasedItems;
  }

  /**
   * Apply overlays to released items (real files with "RELEASED X DAYS AGO" banners)
   */
  private async applyOverlaysToReleasedItems(
    releasedItems: (CollectionItem & { releasedAt?: Date })[],
    config: CollectionConfig,
    plexClient: PlexAPI
  ): Promise<void> {
    const { generateOverlayPoster } = await import(
      '@server/lib/comingsoon/overlayGenerator'
    );
    const { categorizeItem } = await import(
      '@server/lib/comingsoon/categorization'
    );
    const TmdbAPI = (await import('@server/api/themoviedb')).default;
    const tmdbClient = new TmdbAPI();
    const overlayColor = config.comingSoonOverlayColor || '#C21807';

    for (const item of releasedItems) {
      try {
        if (!item.releasedAt || !item.tmdbId) {
          continue;
        }

        // Get source data for this item to determine monitored status
        const repository = getRepository(ComingSoonItem);
        const dbItem = await repository.findOne({
          where: { tmdbId: item.tmdbId, configId: config.id },
        });

        if (!dbItem) {
          continue;
        }

        // Create source data object for categorization
        const sourceItem: ComingSoonSourceData = {
          tmdbId: item.tmdbId,
          tvdbId: dbItem.tvdbId,
          title: item.title,
          year: dbItem.year,
          mediaType: item.type as 'movie' | 'tv',
          source: dbItem.source,
          monitored: dbItem.source !== 'trakt', // Items from radarr/sonarr are monitored
          hasFile: true, // Released items have files
          releaseDate: dbItem.releaseDate,
        };

        // Categorize the item with releasedAt
        const category = categorizeItem(
          sourceItem,
          {
            futureDays: 360,
            recentDays: 7,
            futureOnly: false,
          },
          item.releasedAt
        );

        if (!category) {
          logger.warn('Could not categorize released item for overlay', {
            label: 'Coming Soon Collections',
            title: item.title,
          });
          continue;
        }

        // Get poster URL from TMDB
        let posterUrl: string | undefined;
        if (item.type === 'movie') {
          const movieDetails = await tmdbClient.getMovie({
            movieId: item.tmdbId,
          });
          posterUrl = movieDetails.poster_path
            ? `https://image.tmdb.org/t/p/original${movieDetails.poster_path}`
            : undefined;
        } else {
          const showDetails = await tmdbClient.getTvShow({ tvId: item.tmdbId });
          posterUrl = showDetails.poster_path
            ? `https://image.tmdb.org/t/p/original${showDetails.poster_path}`
            : undefined;
        }

        if (posterUrl) {
          const overlayPosterBuffer = await generateOverlayPoster({
            posterUrl,
            category,
            releaseDate: dbItem.releaseDate,
            color: overlayColor,
            dateFormat: 'd mmm',
            capitalizeDates: true,
            isEstimatedDate: dbItem.isEstimatedDate,
            seasonNumber: dbItem.seasonNumber,
          });

          // Upload poster to Plex
          const tempPosterPath = `/tmp/comingsoon-released-${item.tmdbId}.jpg`;
          await fs.writeFile(tempPosterPath, overlayPosterBuffer);
          await plexClient.uploadPosterFromFile(item.ratingKey, tempPosterPath);
          await fs.unlink(tempPosterPath);

          logger.info('Applied overlay poster to released item', {
            label: 'Coming Soon Collections',
            title: item.title,
            category,
            ratingKey: item.ratingKey,
            releasedAt: item.releasedAt.toISOString(),
          });
        }
      } catch (error) {
        logger.error('Failed to apply overlay to released item', {
          label: 'Coming Soon Collections',
          title: item.title,
          ratingKey: item.ratingKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Handle placeholder creation for missing Coming Soon items
   * Strategy: Create ALL files first, then trigger ONE scan, then apply overlays
   * Returns the discovered placeholder items as CollectionItems
   */
  public async handlePlaceholderCreation(
    missingItems: MissingItem[],
    sourceData: ComingSoonSourceData[],
    config: CollectionConfig,
    plexClient: PlexAPI
  ): Promise<CollectionItem[]> {
    if (missingItems.length === 0) {
      return [];
    }

    logger.info('Creating placeholders for Coming Soon items', {
      label: 'Coming Soon Collections',
      count: missingItems.length,
    });

    const overlayColor = config.comingSoonOverlayColor || '#C21807';
    const sourceMap = new Map(sourceData.map((s) => [s.tmdbId, s]));

    // Step 0: Pre-filter items - only create placeholders for items with posters available
    const TmdbAPI = (await import('@server/api/themoviedb')).default;
    const tmdbClient = new TmdbAPI();
    const itemsWithPosters: MissingItem[] = [];

    logger.info('Checking TMDB for poster availability', {
      label: 'Coming Soon Collections',
      count: missingItems.length,
    });

    for (const missingItem of missingItems) {
      const sourceItem = sourceMap.get(missingItem.tmdbId);
      if (!sourceItem) {
        continue;
      }

      try {
        let hasPoster = false;

        if (sourceItem.mediaType === 'movie') {
          const movieDetails = await tmdbClient.getMovie({
            movieId: sourceItem.tmdbId,
          });
          hasPoster = !!movieDetails.poster_path;
        } else {
          const showDetails = await tmdbClient.getTvShow({
            tvId: sourceItem.tmdbId,
          });
          hasPoster = !!showDetails.poster_path;
        }

        if (hasPoster) {
          itemsWithPosters.push(missingItem);
        } else {
          logger.info('Skipping placeholder creation - no poster available', {
            label: 'Coming Soon Collections',
            title: sourceItem.title,
            tmdbId: sourceItem.tmdbId,
            mediaType: sourceItem.mediaType,
          });
        }
      } catch (error) {
        logger.warn('Failed to check poster availability, skipping item', {
          label: 'Coming Soon Collections',
          title: sourceItem.title,
          tmdbId: sourceItem.tmdbId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (itemsWithPosters.length === 0) {
      logger.info(
        'No items with posters available, skipping placeholder creation',
        {
          label: 'Coming Soon Collections',
          originalCount: missingItems.length,
        }
      );
      return [];
    }

    logger.info('Creating placeholders for items with posters', {
      label: 'Coming Soon Collections',
      count: itemsWithPosters.length,
      skipped: missingItems.length - itemsWithPosters.length,
    });

    // Step 1: Create ALL placeholder files (without scanning/overlays)
    const createdPlaceholders: {
      sourceItem: ComingSoonSourceData;
      placeholderPath: string;
    }[] = [];

    for (const missingItem of itemsWithPosters) {
      const sourceItem = sourceMap.get(missingItem.tmdbId);
      if (!sourceItem) {
        continue;
      }

      try {
        const placeholderPath = await this.createPlaceholderFile(sourceItem);

        createdPlaceholders.push({ sourceItem, placeholderPath });

        logger.info('Created placeholder file', {
          label: 'Coming Soon Collections',
          title: sourceItem.title,
          path: placeholderPath,
        });
      } catch (error) {
        logger.error('Failed to create placeholder file', {
          label: 'Coming Soon Collections',
          title: sourceItem.title,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (createdPlaceholders.length === 0) {
      logger.warn('No placeholder files were created', {
        label: 'Coming Soon Collections',
      });
      return [];
    }

    // Step 2: Trigger ONE Plex library scan for all files
    logger.info('Triggering Plex library scan for all placeholders', {
      label: 'Coming Soon Collections',
      libraryId: config.libraryId,
      fileCount: createdPlaceholders.length,
    });

    await plexClient.scanLibrary(config.libraryId);

    // Step 3: Poll for ALL items to be discovered
    const discoveredItemsMap = await this.waitForPlexDiscovery(
      createdPlaceholders,
      config,
      plexClient
    );

    const matchedPlaceholders = createdPlaceholders.filter((placeholder) =>
      discoveredItemsMap.has(placeholder.sourceItem.tmdbId)
    );
    const unmatchedPlaceholders = createdPlaceholders.filter(
      (placeholder) => !discoveredItemsMap.has(placeholder.sourceItem.tmdbId)
    );

    if (unmatchedPlaceholders.length > 0) {
      await this.removeUnmatchedPlaceholders(
        unmatchedPlaceholders,
        config,
        plexClient
      );
    }

    // Step 4: Apply overlays to discovered items only
    if (matchedPlaceholders.length > 0) {
      await this.applyOverlaysToPlaceholders(
        matchedPlaceholders,
        config,
        plexClient,
        overlayColor,
        discoveredItemsMap
      );
    } else {
      logger.warn('No placeholders matched in Plex after creation', {
        label: 'Coming Soon Collections',
        count: createdPlaceholders.length,
      });
    }

    // Step 5: Convert discovered items to CollectionItem format
    const collectionItems: CollectionItem[] = [];
    for (const [tmdbId, plexItem] of discoveredItemsMap) {
      const sourceItem = sourceMap.get(tmdbId);
      if (sourceItem) {
        collectionItems.push({
          ratingKey: plexItem.ratingKey,
          title: plexItem.title,
          type: sourceItem.mediaType,
          tmdbId: tmdbId,
        });
      }
    }

    logger.info('Returning discovered placeholder items', {
      label: 'Coming Soon Collections',
      itemCount: collectionItems.length,
    });

    return collectionItems;
  }

  /**
   * Create just the placeholder file without scanning or applying overlays
   * Returns the path to the created file
   */
  private async createPlaceholderFile(
    sourceItem: ComingSoonSourceData
  ): Promise<string> {
    const { downloadTrailer } = await import(
      '@server/lib/comingsoon/trailerDownload'
    );
    const { createPlaceholder } = await import(
      '@server/lib/comingsoon/placeholderManager'
    );

    // 1. Download trailer
    const trailerPath = await downloadTrailer(
      sourceItem.title,
      sourceItem.year,
      sourceItem.mediaType
    );

    // 2. Get library path from Radarr/Sonarr root folders
    // For Trakt items, use Radarr/Sonarr based on media type (same as monitored items)
    const settings = getSettings();
    let libraryPath: string | undefined;

    if (sourceItem.mediaType === 'movie') {
      // For movies: use default Radarr instance, fallback to first if no default set
      if (settings.radarr && settings.radarr.length > 0) {
        const radarrInstance =
          settings.radarr.find((r) => r.isDefault) || settings.radarr[0];
        const radarrClient = new RadarrAPI({
          url: `${radarrInstance.useSsl ? 'https' : 'http'}://${
            radarrInstance.hostname
          }:${radarrInstance.port}${radarrInstance.baseUrl || ''}/api/v3`,
          apiKey: radarrInstance.apiKey,
        });

        const rootFolders = await radarrClient.getRootFolders();
        if (rootFolders.length > 0) {
          const remotePath = rootFolders[0].path;
          libraryPath = translatePath(remotePath, radarrInstance.pathMappings);

          logger.debug('Using Radarr instance for placeholder creation', {
            label: 'Coming Soon Collections',
            instance: radarrInstance.name,
            isDefault: radarrInstance.isDefault,
            rootFolder: libraryPath,
          });
        }
      }
    } else if (sourceItem.mediaType === 'tv') {
      // For TV shows: use default Sonarr instance, fallback to first if no default set
      if (settings.sonarr && settings.sonarr.length > 0) {
        const sonarrInstance =
          settings.sonarr.find((s) => s.isDefault) || settings.sonarr[0];
        const sonarrClient = new SonarrAPI({
          url: `${sonarrInstance.useSsl ? 'https' : 'http'}://${
            sonarrInstance.hostname
          }:${sonarrInstance.port}${sonarrInstance.baseUrl || ''}/api/v3`,
          apiKey: sonarrInstance.apiKey,
        });

        const rootFolders = await sonarrClient.getRootFolders();
        if (rootFolders.length > 0) {
          const remotePath = rootFolders[0].path;
          libraryPath = translatePath(remotePath, sonarrInstance.pathMappings);

          logger.debug('Using Sonarr instance for placeholder creation', {
            label: 'Coming Soon Collections',
            instance: sonarrInstance.name,
            isDefault: sonarrInstance.isDefault,
            rootFolder: libraryPath,
          });
        }
      }
    }

    if (!libraryPath) {
      throw new Error(
        `Could not determine library path for ${sourceItem.title}`
      );
    }

    // 3. Create placeholder file in library
    const result = await createPlaceholder({
      tmdbId: sourceItem.tmdbId,
      tvdbId: sourceItem.tvdbId,
      title: sourceItem.title,
      year: sourceItem.year,
      mediaType: sourceItem.mediaType,
      libraryPath,
      trailerPath,
    });

    return result.placeholderPath;
  }

  /**
   * Remove placeholders that Plex failed to match to TMDB metadata
   */
  private async removeUnmatchedPlaceholders(
    placeholders: {
      sourceItem: ComingSoonSourceData;
      placeholderPath: string;
    }[],
    config: CollectionConfig,
    plexClient: PlexAPI
  ): Promise<void> {
    const { removePlaceholder } = await import(
      '@server/lib/comingsoon/placeholderManager'
    );

    if (placeholders.length === 0) {
      return;
    }

    let removedCount = 0;

    for (const { sourceItem, placeholderPath } of placeholders) {
      try {
        await removePlaceholder(placeholderPath, sourceItem.mediaType);
        removedCount += 1;

        logger.warn('Removed placeholder that Plex could not match', {
          label: 'Coming Soon Collections',
          title: sourceItem.title,
          tmdbId: sourceItem.tmdbId,
          mediaType: sourceItem.mediaType,
          placeholderPath,
        });
      } catch (error) {
        logger.error('Failed to remove unmatched placeholder', {
          label: 'Coming Soon Collections',
          title: sourceItem.title,
          tmdbId: sourceItem.tmdbId,
          placeholderPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (removedCount > 0) {
      logger.info('Triggering Plex scan to clean up unmatched placeholders', {
        label: 'Coming Soon Collections',
        libraryId: config.libraryId,
        removedCount,
      });

      try {
        await plexClient.scanLibrary(config.libraryId);
      } catch (error) {
        logger.warn(
          'Failed to trigger cleanup scan after removing unmatched placeholders',
          {
            label: 'Coming Soon Collections',
            libraryId: config.libraryId,
            removedCount,
            error: error instanceof Error ? error.message : String(error),
          }
        );
      }
    }
  }

  /**
   * Wait for Plex to discover multiple items after a library scan
   */
  private async waitForPlexDiscovery(
    placeholders: {
      sourceItem: ComingSoonSourceData;
      placeholderPath: string;
    }[],
    config: CollectionConfig,
    plexClient: PlexAPI
  ): Promise<Map<number, { ratingKey: string; title: string }>> {
    const sourceItems = placeholders.map((p) => p.sourceItem);
    const discovered = new Map<number, { ratingKey: string; title: string }>();
    const excludedUnmatched = new Set<number>(); // Track items found by title but unmatched
    const maxAttempts = 30; // 30 attempts * 10 seconds = 5 minutes max
    const pollInterval = 10000; // 10 seconds

    // Build a map of tmdbId -> placeholderPath for cleanup
    const placeholderPathMap = new Map<number, string>();
    for (const { sourceItem, placeholderPath } of placeholders) {
      placeholderPathMap.set(sourceItem.tmdbId, placeholderPath);
    }

    // Track when items stop appearing
    let itemsStartedAppearing = false;
    let consecutiveNoDiscovery = 0; // Count of consecutive polls with no new discoveries
    const minTimeBeforeFallback = 120000; // 120 seconds (12 attempts)
    const waitCyclesAfterStop = 2; // Wait 2 more cycles after items stop

    logger.info('Polling Plex for placeholder discovery', {
      label: 'Coming Soon Collections',
      itemCount: sourceItems.length,
    });

    // Wait 10 seconds before first check to give Plex auto-detection a chance to work
    await new Promise((resolve) => setTimeout(resolve, 10000));

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const previousSize = discovered.size;

      // Build lookup array for items we haven't found yet (excluding already excluded unmatched items)
      const stillMissing = sourceItems.filter(
        (item) =>
          !discovered.has(item.tmdbId) && !excludedUnmatched.has(item.tmdbId)
      );

      if (stillMissing.length === 0) {
        logger.info('All placeholders discovered by Plex', {
          label: 'Coming Soon Collections',
          attempt,
          totalItems: sourceItems.length,
          excludedUnmatched: excludedUnmatched.size,
        });
        break;
      }

      const tmdbLookups = stillMissing.map((item) => ({
        tmdbId: item.tmdbId,
        mediaType: item.mediaType,
        title: item.title,
      }));

      // Check if Plex has discovered the items by TMDB ID
      const itemMap = await findPlexItemsByTmdbIds(
        plexClient,
        tmdbLookups,
        config.libraryId
      );

      logger.debug('Poll attempt results', {
        label: 'Coming Soon Collections',
        attempt,
        itemMapSize: itemMap.size,
        itemMapKeys: Array.from(itemMap.keys()),
        lookingFor: stillMissing.map((i) => ({
          tmdbId: i.tmdbId,
          title: i.title,
        })),
      });

      // Add newly discovered items
      for (const item of stillMissing) {
        // The key format is: tmdbId-mediaType (e.g., "66732-tv")
        const tmdbKey = `${item.tmdbId}-${item.mediaType}`;
        const plexItem = itemMap.get(tmdbKey);
        if (plexItem) {
          discovered.set(item.tmdbId, plexItem);
          logger.debug('Plex discovered placeholder', {
            label: 'Coming Soon Collections',
            title: item.title,
            attempt,
          });
        } else {
          logger.debug('Item not found in map', {
            label: 'Coming Soon Collections',
            title: item.title,
            tmdbKey,
            attempt,
          });
        }
      }

      // Track discovery progress
      if (discovered.size > previousSize) {
        // New items were discovered
        if (!itemsStartedAppearing) {
          itemsStartedAppearing = true;
          logger.info('Items started appearing in Plex', {
            label: 'Coming Soon Collections',
            attempt,
            elapsed: attempt * 10,
          });
        }
        consecutiveNoDiscovery = 0; // Reset counter
      } else if (itemsStartedAppearing) {
        // No new items found, and items had started appearing before
        consecutiveNoDiscovery++;
        logger.debug('No new discoveries this cycle', {
          label: 'Coming Soon Collections',
          attempt,
          consecutiveNoDiscovery,
        });
      }

      // Check if all found or need to continue
      if (discovered.size === sourceItems.length) {
        logger.info('All placeholders discovered by Plex', {
          label: 'Coming Soon Collections',
          attempt,
          totalItems: sourceItems.length,
        });
        break;
      }

      // Title-based fallback logic
      // After items have been appearing for at least 120 seconds (12 attempts)
      // AND items have stopped appearing for 2 consecutive cycles (20 seconds)
      const elapsedTime = attempt * pollInterval;
      const shouldAttemptFallback =
        itemsStartedAppearing &&
        elapsedTime >= minTimeBeforeFallback &&
        consecutiveNoDiscovery >= waitCyclesAfterStop;

      if (shouldAttemptFallback && stillMissing.length > 0) {
        logger.info(
          'Items stopped appearing - attempting title-based fallback search for unmatched placeholders',
          {
            label: 'Coming Soon Collections',
            attempt,
            elapsed: elapsedTime / 1000,
            stillMissingCount: stillMissing.length,
            consecutiveNoDiscovery,
          }
        );

        // Attempt title-based search for each missing item
        await this.handleUnmatchedPlaceholders(
          stillMissing,
          config,
          plexClient,
          discovered,
          excludedUnmatched,
          placeholderPathMap
        );

        // After fallback, check if we're done
        const remainingMissing = sourceItems.filter(
          (item) =>
            !discovered.has(item.tmdbId) && !excludedUnmatched.has(item.tmdbId)
        );

        if (remainingMissing.length === 0) {
          logger.info('All placeholders resolved after title-based fallback', {
            label: 'Coming Soon Collections',
            attempt,
            totalItems: sourceItems.length,
            discovered: discovered.size,
            excludedUnmatched: excludedUnmatched.size,
          });
          break;
        }
      }

      // Wait before next check (except on last attempt)
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }
    }

    if (discovered.size + excludedUnmatched.size < sourceItems.length) {
      logger.warn('Some placeholders were not resolved by Plex after polling', {
        label: 'Coming Soon Collections',
        totalItems: sourceItems.length,
        discovered: discovered.size,
        excludedUnmatched: excludedUnmatched.size,
        missing: sourceItems.length - discovered.size - excludedUnmatched.size,
      });
    }

    return discovered;
  }

  /**
   * Handle unmatched placeholders - search by title and cleanup if truly unmatched
   * This is a fallback for when Plex doesn't match items with TMDB metadata
   */
  private async handleUnmatchedPlaceholders(
    unmatchedItems: ComingSoonSourceData[],
    config: CollectionConfig,
    plexClient: PlexAPI,
    discovered: Map<number, { ratingKey: string; title: string }>,
    excludedUnmatched: Set<number>,
    placeholderPathMap: Map<number, string>
  ): Promise<void> {
    const { removePlaceholder } = await import(
      '@server/lib/comingsoon/placeholderManager'
    );

    logger.info('Attempting title-based search for unmatched items', {
      label: 'Coming Soon Collections',
      unmatchedCount: unmatchedItems.length,
    });

    let needsScan = false;

    for (const item of unmatchedItems) {
      try {
        // Search Plex by title
        const titleMatches = await findPlexItemsByTitle(
          plexClient,
          item.title,
          item.year,
          config.libraryId,
          item.mediaType
        );

        if (titleMatches.length === 0) {
          logger.debug('No title matches found in Plex', {
            label: 'Coming Soon Collections',
            title: item.title,
            year: item.year,
            tmdbId: item.tmdbId,
          });
          continue;
        }

        // Check if any matches are unmatched in Plex (no TMDB guid)
        const unmatchedInPlex = titleMatches.filter(
          (match) => !match.hasTmdbGuid
        );

        if (unmatchedInPlex.length > 0) {
          // Found the placeholder in Plex, but it's unmatched
          const match = unmatchedInPlex[0]; // Take first match
          const placeholderPath = placeholderPathMap.get(item.tmdbId);

          if (!placeholderPath) {
            logger.warn('No placeholder path found for unmatched item', {
              label: 'Coming Soon Collections',
              title: item.title,
              tmdbId: item.tmdbId,
            });
            continue;
          }

          logger.warn(
            'Found placeholder in Plex but it is unmatched (no TMDB guid) - deleting file and excluding from collection',
            {
              label: 'Coming Soon Collections',
              title: item.title,
              year: item.year,
              tmdbId: item.tmdbId,
              plexTitle: match.title,
              plexYear: match.year,
              placeholderPath,
            }
          );

          // Delete the placeholder file
          try {
            await removePlaceholder(placeholderPath, item.mediaType);
            needsScan = true;
            logger.info('Deleted unmatched placeholder file', {
              label: 'Coming Soon Collections',
              title: item.title,
              placeholderPath,
            });
          } catch (deleteError) {
            logger.error('Failed to delete unmatched placeholder file', {
              label: 'Coming Soon Collections',
              title: item.title,
              placeholderPath,
              error:
                deleteError instanceof Error
                  ? deleteError.message
                  : String(deleteError),
            });
          }

          // Mark as excluded so we don't keep trying to find it
          excludedUnmatched.add(item.tmdbId);
        } else if (titleMatches.length > 0) {
          // Found matched items - this shouldn't happen (means TMDB search failed but item is actually matched)
          const match = titleMatches[0];
          logger.info(
            'Found item by title with TMDB guid - adding to discovered (TMDB search may have been too early)',
            {
              label: 'Coming Soon Collections',
              title: item.title,
              tmdbId: item.tmdbId,
              plexTitle: match.title,
              ratingKey: match.ratingKey,
            }
          );

          // Add to discovered map
          discovered.set(item.tmdbId, {
            ratingKey: match.ratingKey,
            title: match.title,
          });
        }
      } catch (error) {
        logger.error('Error during title-based search for unmatched item', {
          label: 'Coming Soon Collections',
          title: item.title,
          tmdbId: item.tmdbId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Trigger library scan to clean up deleted placeholders from Plex database
    if (needsScan) {
      logger.info('Triggering library scan to clean up deleted placeholders', {
        label: 'Coming Soon Collections',
        libraryId: config.libraryId,
      });

      try {
        await plexClient.scanLibrary(config.libraryId);
      } catch (error) {
        logger.error('Failed to trigger library scan after cleanup', {
          label: 'Coming Soon Collections',
          libraryId: config.libraryId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info('Title-based fallback search completed', {
      label: 'Coming Soon Collections',
      totalProcessed: unmatchedItems.length,
      excluded: excludedUnmatched.size,
      additionalDiscovered: discovered.size,
    });
  }

  /**
   * Apply overlay posters to discovered placeholder items
   */
  private async applyOverlaysToPlaceholders(
    placeholders: {
      sourceItem: ComingSoonSourceData;
      placeholderPath: string;
    }[],
    config: CollectionConfig,
    plexClient: PlexAPI,
    overlayColor: string,
    preDiscoveredItems?: Map<number, { ratingKey: string; title: string }>
  ): Promise<void> {
    const { generateOverlayPoster } = await import(
      '@server/lib/comingsoon/overlayGenerator'
    );
    const TmdbAPI = (await import('@server/api/themoviedb')).default;
    const tmdbClient = new TmdbAPI();
    const repository = getRepository(ComingSoonItem);

    // First, wait for Plex to discover all items (if not already provided)
    const discoveredItems =
      preDiscoveredItems ??
      (await this.waitForPlexDiscovery(placeholders, config, plexClient));

    logger.info('Applying overlays to discovered placeholders', {
      label: 'Coming Soon Collections',
      totalItems: placeholders.length,
      discovered: discoveredItems.size,
    });

    for (const { sourceItem, placeholderPath } of placeholders) {
      const plexItem = discoveredItems.get(sourceItem.tmdbId);
      if (!plexItem) {
        logger.warn('Cannot apply overlay - item not discovered by Plex', {
          label: 'Coming Soon Collections',
          title: sourceItem.title,
        });
        continue;
      }

      try {
        // Import categorization
        const { categorizeItem } = await import(
          '@server/lib/comingsoon/categorization'
        );

        // Categorize the item
        const category = categorizeItem(sourceItem, {
          futureDays: 360,
          recentDays: 7,
          futureOnly: false,
        });

        if (!category) {
          logger.warn('Could not categorize item for overlay', {
            label: 'Coming Soon Collections',
            title: sourceItem.title,
          });
          continue;
        }

        // Get poster URL from TMDB
        let posterUrl: string | undefined;
        if (sourceItem.mediaType === 'movie') {
          const movieDetails = await tmdbClient.getMovie({
            movieId: sourceItem.tmdbId,
          });
          posterUrl = movieDetails.poster_path
            ? `https://image.tmdb.org/t/p/original${movieDetails.poster_path}`
            : undefined;
        } else {
          const showDetails = await tmdbClient.getTvShow({
            tvId: sourceItem.tmdbId,
          });
          posterUrl = showDetails.poster_path
            ? `https://image.tmdb.org/t/p/original${showDetails.poster_path}`
            : undefined;
        }

        if (posterUrl) {
          const overlayPosterBuffer = await generateOverlayPoster({
            posterUrl,
            category,
            releaseDate: sourceItem.releaseDate || sourceItem.airDate,
            color: overlayColor,
            dateFormat: 'd mmm',
            capitalizeDates: true,
            isEstimatedDate: sourceItem.isEstimatedDate,
            seasonNumber: sourceItem.seasonNumber,
          });

          // Upload poster to Plex
          const tempPosterPath = `/tmp/comingsoon-${sourceItem.tmdbId}.jpg`;
          await fs.writeFile(tempPosterPath, overlayPosterBuffer);
          await plexClient.uploadPosterFromFile(
            plexItem.ratingKey,
            tempPosterPath
          );
          await fs.unlink(tempPosterPath);

          logger.info('Applied overlay poster', {
            label: 'Coming Soon Collections',
            title: sourceItem.title,
            category,
          });
        }

        // Save placeholder to database for cleanup tracking
        const placeholderRecord = repository.create({
          configId: config.id,
          mediaType: sourceItem.mediaType,
          tmdbId: sourceItem.tmdbId,
          tvdbId: sourceItem.tvdbId,
          title: sourceItem.title,
          year: sourceItem.year,
          releaseDate: sourceItem.releaseDate,
          isEstimatedDate: sourceItem.isEstimatedDate || false,
          seasonNumber: sourceItem.seasonNumber,
          source: sourceItem.source,
          placeholderPath: placeholderPath,
          plexRatingKey: plexItem.ratingKey,
        });

        await repository.save(placeholderRecord);

        logger.debug('Saved placeholder to database', {
          label: 'Coming Soon Collections',
          title: sourceItem.title,
        });
      } catch (error) {
        logger.error('Failed to apply overlay to placeholder', {
          label: 'Coming Soon Collections',
          title: sourceItem.title,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Create a placeholder file with overlay for a Coming Soon item
   */
  private async createPlaceholderForItem(
    sourceItem: ComingSoonSourceData,
    config: CollectionConfig,
    plexClient: PlexAPI,
    overlayColor: string
  ): Promise<void> {
    const { downloadTrailer } = await import(
      '@server/lib/comingsoon/trailerDownload'
    );
    const { createPlaceholder } = await import(
      '@server/lib/comingsoon/placeholderManager'
    );
    const { generateOverlayPoster } = await import(
      '@server/lib/comingsoon/overlayGenerator'
    );

    // 1. Download trailer
    const trailerPath = await downloadTrailer(
      sourceItem.title,
      sourceItem.year,
      sourceItem.mediaType
    );

    // 2. Get library path from Radarr/Sonarr root folders
    const settings = getSettings();
    let libraryPath: string | undefined;

    if (sourceItem.mediaType === 'movie' && sourceItem.source === 'radarr') {
      // Get first accessible Radarr root folder
      if (settings.radarr && settings.radarr.length > 0) {
        const radarrInstance = settings.radarr[0];
        const radarrClient = new RadarrAPI({
          url: `${radarrInstance.useSsl ? 'https' : 'http'}://${
            radarrInstance.hostname
          }:${radarrInstance.port}${radarrInstance.baseUrl || ''}/api/v3`,
          apiKey: radarrInstance.apiKey,
        });

        const rootFolders = await radarrClient.getRootFolders();
        // Use first root folder
        if (rootFolders.length > 0) {
          const remotePath = rootFolders[0].path;
          // Translate path using configured path mappings (for cross-platform/remote setups)
          libraryPath = translatePath(remotePath, radarrInstance.pathMappings);
        }
      }
    } else if (
      sourceItem.mediaType === 'tv' &&
      sourceItem.source === 'sonarr'
    ) {
      // Get first accessible Sonarr root folder
      if (settings.sonarr && settings.sonarr.length > 0) {
        const sonarrInstance = settings.sonarr[0];
        const sonarrClient = new SonarrAPI({
          url: `${sonarrInstance.useSsl ? 'https' : 'http'}://${
            sonarrInstance.hostname
          }:${sonarrInstance.port}${sonarrInstance.baseUrl || ''}/api/v3`,
          apiKey: sonarrInstance.apiKey,
        });

        const rootFolders = await sonarrClient.getRootFolders();
        // Use first root folder
        if (rootFolders.length > 0) {
          const remotePath = rootFolders[0].path;
          // Translate path using configured path mappings (for cross-platform/remote setups)
          libraryPath = translatePath(remotePath, sonarrInstance.pathMappings);
        }
      }
    }

    if (!libraryPath) {
      logger.warn('Could not determine library path for placeholder creation', {
        label: 'Coming Soon Collections',
        title: sourceItem.title,
        mediaType: sourceItem.mediaType,
        source: sourceItem.source,
      });
      return;
    }

    // 3. Create placeholder file in library
    const result = await createPlaceholder({
      tmdbId: sourceItem.tmdbId,
      tvdbId: sourceItem.tvdbId,
      title: sourceItem.title,
      year: sourceItem.year,
      mediaType: sourceItem.mediaType,
      libraryPath,
      trailerPath,
    });

    logger.info('Created placeholder file', {
      label: 'Coming Soon Collections',
      title: sourceItem.title,
      path: result.placeholderPath,
    });

    // 4. Trigger Plex library scan to discover the new file
    logger.debug('Triggering Plex library scan', {
      label: 'Coming Soon Collections',
      title: sourceItem.title,
      libraryId: config.libraryId,
    });

    await plexClient.scanLibrary(config.libraryId);

    // 5. Poll Plex to wait for the new item to be discovered
    // We'll check every 5 seconds for up to 2 minutes
    logger.debug('Polling Plex for new item discovery', {
      label: 'Coming Soon Collections',
      title: sourceItem.title,
    });

    let plexItem: { ratingKey: string; title: string } | null = null;
    const maxAttempts = 24; // 24 attempts * 5 seconds = 2 minutes max
    const pollInterval = 5000; // 5 seconds

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Wait before checking (except first attempt)
      if (attempt > 1) {
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      } else {
        // First check after 3 seconds to give Plex a head start
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }

      // Check if Plex has discovered the item
      const itemMap = await findPlexItemsByTmdbIds(
        plexClient,
        [
          {
            tmdbId: sourceItem.tmdbId,
            mediaType: sourceItem.mediaType,
            title: sourceItem.title,
          },
        ],
        config.libraryId
      );

      const tmdbKey = `tmdb-${sourceItem.tmdbId}`;
      plexItem = itemMap.get(tmdbKey) || null;

      if (plexItem) {
        logger.info('Plex discovered placeholder file', {
          label: 'Coming Soon Collections',
          title: sourceItem.title,
          attempt,
          elapsedSeconds: attempt === 1 ? 3 : 3 + (attempt - 1) * 5,
        });
        break;
      }

      logger.debug('Plex has not discovered file yet, continuing to poll', {
        label: 'Coming Soon Collections',
        title: sourceItem.title,
        attempt,
        maxAttempts,
      });
    }

    if (!plexItem) {
      logger.warn('Plex did not discover placeholder after polling', {
        label: 'Coming Soon Collections',
        title: sourceItem.title,
        maxWaitSeconds: Math.ceil(
          ((maxAttempts - 1) * pollInterval) / 1000 + 3
        ),
      });
      return;
    }

    // 6. Generate and upload overlay poster
    // Get poster URL from TMDB
    const TmdbAPI = (await import('@server/api/themoviedb')).default;
    const tmdbClient = new TmdbAPI();

    let posterUrl: string | undefined;
    if (sourceItem.mediaType === 'movie') {
      const movieDetails = await tmdbClient.getMovie({
        movieId: sourceItem.tmdbId,
      });
      posterUrl = `https://image.tmdb.org/t/p/original${movieDetails.poster_path}`;
    } else {
      const showDetails = await tmdbClient.getTvShow({
        tvId: sourceItem.tmdbId,
      });
      posterUrl = `https://image.tmdb.org/t/p/original${showDetails.poster_path}`;
    }

    if (posterUrl) {
      // Import categorization
      const { categorizeItem } = await import(
        '@server/lib/comingsoon/categorization'
      );

      // Categorize the item
      const category = categorizeItem(sourceItem, {
        futureDays: 90,
        recentDays: 7,
        futureOnly: false,
      });

      if (!category) {
        logger.warn('Could not categorize item for overlay', {
          label: 'Coming Soon Collections',
          title: sourceItem.title,
        });
        return;
      }

      const overlayPosterBuffer = await generateOverlayPoster({
        posterUrl,
        category,
        releaseDate: sourceItem.releaseDate || sourceItem.airDate,
        color: overlayColor,
        dateFormat: 'd mmm',
        capitalizeDates: true,
        seasonNumber: sourceItem.seasonNumber,
      });

      // Upload poster to Plex
      // Save to temp file first
      const tempPosterPath = `/tmp/comingsoon-${sourceItem.tmdbId}.jpg`;
      await fs.writeFile(tempPosterPath, overlayPosterBuffer);

      await plexClient.uploadPosterFromFile(plexItem.ratingKey, tempPosterPath);

      // Clean up temp file
      await fs.unlink(tempPosterPath);

      logger.info('Uploaded overlay poster', {
        label: 'Coming Soon Collections',
        title: sourceItem.title,
      });
    }

    // 8. Save placeholder to database for cleanup tracking
    const repository = getRepository(ComingSoonItem);
    const placeholderRecord = repository.create({
      configId: config.id,
      mediaType: sourceItem.mediaType,
      tmdbId: sourceItem.tmdbId,
      tvdbId: sourceItem.tvdbId,
      title: sourceItem.title,
      year: sourceItem.year,
      releaseDate: sourceItem.releaseDate,
      isEstimatedDate: sourceItem.isEstimatedDate || false,
      seasonNumber: sourceItem.seasonNumber,
      source: sourceItem.source,
      placeholderPath: result.placeholderPath,
      plexRatingKey: plexItem.ratingKey,
    });

    await repository.save(placeholderRecord);

    logger.info('Saved Coming Soon placeholder to database', {
      label: 'Coming Soon Collections',
      title: sourceItem.title,
      id: placeholderRecord.id,
    });
  }

  /**
   * Filter source data by date range
   * Only include items within maxDaysAway from today
   */
  private filterSourceDataByDateRange(
    sourceData: ComingSoonSourceData[],
    maxDaysAway: number
  ): ComingSoonSourceData[] {
    const now = new Date();
    const maxDate = new Date(now.getTime() + maxDaysAway * 24 * 60 * 60 * 1000);

    const filteredData = sourceData.filter((item) => {
      let releaseDate: Date | null = null;

      if (item.mediaType === 'movie') {
        // Priority: Digital > Physical > Generic (actual availability, not theatrical)
        if (item.digitalRelease) {
          releaseDate = new Date(item.digitalRelease);
        } else if (item.physicalRelease) {
          releaseDate = new Date(item.physicalRelease);
        } else if (item.releaseDate) {
          releaseDate = new Date(item.releaseDate);
        }
        // inCinemas deliberately excluded - filter by availability date, not theatrical
      } else {
        if (item.airDate) {
          releaseDate = new Date(item.airDate);
        }
      }

      if (!releaseDate) return true; // Keep items without release date

      const isWithinRange = releaseDate <= maxDate;

      if (!isWithinRange) {
        logger.debug('Filtered out Coming Soon item (too far away)', {
          label: 'Coming Soon Collections',
          title: item.title,
          releaseDate: releaseDate.toISOString(),
          daysAway: Math.round(
            (releaseDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)
          ),
        });
      }

      return isWithinRange;
    });

    logger.info('Filtered Coming Soon items by date range', {
      label: 'Coming Soon Collections',
      originalCount: sourceData.length,
      filteredCount: filteredData.length,
      excludedCount: sourceData.length - filteredData.length,
      maxDaysAway,
    });

    return filteredData;
  }

  /**
   * Sort collection items by release date (closest first)
   * Items without release dates are placed at the end
   */
  private sortByReleaseDate(
    items: CollectionItem[],
    sourceData: ComingSoonSourceData[]
  ): CollectionItem[] {
    // Create a map of tmdbId to release date
    const releaseDateMap = new Map<number, Date | null>();

    for (const source of sourceData) {
      if (!source.tmdbId) continue;

      // Get the earliest available release date
      let releaseDate: Date | null = null;

      if (source.mediaType === 'movie') {
        // For movies: prioritize actual availability dates (Digital > Physical > Generic)
        // Do NOT use theatrical/cinema dates - content isn't available for Plex until home release
        if (source.digitalRelease) {
          releaseDate = new Date(source.digitalRelease);
        } else if (source.physicalRelease) {
          releaseDate = new Date(source.physicalRelease);
        } else if (source.releaseDate) {
          releaseDate = new Date(source.releaseDate);
        }
        // inCinemas deliberately excluded - theatrical release doesn't mean content is available
      } else {
        // For TV: use airDate
        if (source.airDate) {
          releaseDate = new Date(source.airDate);
        }
      }

      releaseDateMap.set(source.tmdbId, releaseDate);
    }

    logger.debug('Release date map created', {
      label: 'Coming Soon Collections',
      totalSourceItems: sourceData.length,
      itemsWithDates: Array.from(releaseDateMap.values()).filter(
        (d) => d !== null
      ).length,
      sampleTmdbIds: Array.from(releaseDateMap.keys()).slice(0, 5),
    });

    logger.debug('Items to sort', {
      label: 'Coming Soon Collections',
      totalItems: items.length,
      sampleItemTmdbIds: items.slice(0, 5).map((i) => i.tmdbId),
    });

    // Attach release dates to items for multi-source orchestrator sorting
    // This metadata is used when Coming Soon items are combined with other sources
    const itemsWithMetadata = items.map((item) => {
      const date = item.tmdbId ? releaseDateMap.get(item.tmdbId) : null;
      return {
        ...item,
        releaseDateSortValue: date ? date.toISOString() : undefined,
      } as CollectionItem & { releaseDateSortValue?: string };
    });

    // Sort items by release date
    const sortedItems = [...itemsWithMetadata].sort((a, b) => {
      const dateA = a.releaseDateSortValue
        ? new Date(a.releaseDateSortValue)
        : null;
      const dateB = b.releaseDateSortValue
        ? new Date(b.releaseDateSortValue)
        : null;

      // Debug logging for items without dates
      if (!dateA && a.tmdbId) {
        logger.warn('Item has tmdbId but no date in map', {
          label: 'Coming Soon Collections',
          title: a.title,
          tmdbId: a.tmdbId,
          mapHasKey: releaseDateMap.has(a.tmdbId),
        });
      }
      if (!dateB && b.tmdbId) {
        logger.warn('Item has tmdbId but no date in map', {
          label: 'Coming Soon Collections',
          title: b.title,
          tmdbId: b.tmdbId,
          mapHasKey: releaseDateMap.has(b.tmdbId),
        });
      }

      // Items without dates go to the end
      if (!dateA && !dateB) return 0;
      if (!dateA) return 1;
      if (!dateB) return -1;

      // Sort by closest date first
      return dateA.getTime() - dateB.getTime();
    });

    const firstItemTmdbId = sortedItems[0]?.tmdbId;
    const lastItemTmdbId = sortedItems[sortedItems.length - 1]?.tmdbId;

    // Count how many items have dates vs don't
    const itemsWithDates = sortedItems.filter(
      (item) => item.tmdbId && releaseDateMap.get(item.tmdbId)
    ).length;
    const itemsWithoutDates = sortedItems.length - itemsWithDates;

    logger.debug('Sorted Coming Soon items by release date', {
      label: 'Coming Soon Collections',
      totalItems: sortedItems.length,
      itemsWithDates,
      itemsWithoutDates,
      firstItemDate:
        firstItemTmdbId !== undefined
          ? releaseDateMap.get(firstItemTmdbId)
          : null,
      lastItemDate:
        lastItemTmdbId !== undefined
          ? releaseDateMap.get(lastItemTmdbId)
          : null,
      fullSortedOrder: sortedItems.map((item) => ({
        title: item.title,
        tmdbId: item.tmdbId,
        releaseDate: item.tmdbId ? releaseDateMap.get(item.tmdbId) : null,
      })),
    });

    return sortedItems;
  }

  /**
   * Clean up Coming Soon placeholders:
   * 1. Items that now have real files in Radarr/Sonarr (released items)
   * 2. Items no longer in source data (orphaned items)
   * 3. Items that have been placeholders for 180+ days (stale items)
   *
   * Released items are tracked for configured window (default: 7 days) with "RELEASED X DAYS AGO" overlays,
   * then original posters are restored and database records are removed.
   *
   * Orphaned and stale items are immediately removed (file + database record).
   */
  private async cleanupReleasedPlaceholders(
    config: CollectionConfig,
    plexClient: PlexAPI,
    libraryCache?: LibraryItemsCache,
    sourceData?: ComingSoonSourceData[]
  ): Promise<void> {
    let repository;
    let placeholders;

    try {
      repository = getRepository(ComingSoonItem);
      placeholders = await repository.find({ where: { configId: config.id } });
    } catch (error) {
      // If table doesn't exist yet (first run), skip cleanup
      logger.debug('Skipping placeholder cleanup - table not initialized yet', {
        label: 'Coming Soon Collections',
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    if (placeholders.length === 0) {
      return;
    }

    logger.info('Checking Coming Soon placeholders for cleanup', {
      label: 'Coming Soon Collections',
      configName: config.name,
      count: placeholders.length,
    });

    const settings = getSettings();
    let removedCount = 0;

    for (const placeholder of placeholders) {
      try {
        let hasRealFile = false;

        // Check if real file now exists
        if (placeholder.source === 'radarr' || placeholder.source === 'trakt') {
          if (
            placeholder.mediaType === 'movie' &&
            settings.radarr &&
            settings.radarr.length > 0
          ) {
            for (const radarrInstance of settings.radarr) {
              const radarrClient = new RadarrAPI({
                url: `${radarrInstance.useSsl ? 'https' : 'http'}://${
                  radarrInstance.hostname
                }:${radarrInstance.port}${radarrInstance.baseUrl || ''}/api/v3`,
                apiKey: radarrInstance.apiKey,
              });

              const movies = await radarrClient.getMovies();
              const movie = movies.find((m) => m.tmdbId === placeholder.tmdbId);

              if (movie && movie.hasFile) {
                hasRealFile = true;
                logger.info('Found real file for Coming Soon placeholder', {
                  label: 'Coming Soon Collections',
                  title: placeholder.title,
                  radarrInstance: radarrInstance.name,
                });
                break;
              }
            }
          }
        }

        if (placeholder.source === 'sonarr' || placeholder.source === 'trakt') {
          if (
            placeholder.mediaType === 'tv' &&
            settings.sonarr &&
            settings.sonarr.length > 0
          ) {
            for (const sonarrInstance of settings.sonarr) {
              const sonarrClient = new SonarrAPI({
                url: `${sonarrInstance.useSsl ? 'https' : 'http'}://${
                  sonarrInstance.hostname
                }:${sonarrInstance.port}${sonarrInstance.baseUrl || ''}/api/v3`,
                apiKey: sonarrInstance.apiKey,
              });

              const allSeries = await sonarrClient.getSeries();
              const series = allSeries.find(
                (s) => s.tvdbId === placeholder.tvdbId
              );

              if (series && series.statistics?.episodeFileCount > 0) {
                hasRealFile = true;
                logger.info('Found real file for Coming Soon placeholder', {
                  label: 'Coming Soon Collections',
                  title: placeholder.title,
                  sonarrInstance: sonarrInstance.name,
                });
                break;
              }
            }
          }
        }

        if (hasRealFile) {
          // FIX #2: Verify the real file actually exists in Plex before cleanup
          let realItemInPlex = false;
          let realItemRatingKey: string | undefined;

          if (libraryCache) {
            // Use cached library data to verify the real item exists in Plex
            const allLibraries = Object.values(libraryCache);
            for (const library of allLibraries) {
              const item = library.find((i) => {
                // Extract tmdbId from Guid array
                const tmdbGuid = i.Guid?.find((guid) =>
                  guid.id.startsWith('tmdb://')
                );
                const tmdbMatch = tmdbGuid?.id.match(/tmdb:\/\/(\d+)/);
                const itemTmdbId = tmdbMatch
                  ? parseInt(tmdbMatch[1], 10)
                  : null;

                if (placeholder.mediaType === 'movie') {
                  return itemTmdbId === placeholder.tmdbId;
                }

                // For TV shows, also check TVDB
                const tvdbGuid = i.Guid?.find((guid) =>
                  guid.id.startsWith('tvdb://')
                );
                const tvdbMatch = tvdbGuid?.id.match(/tvdb:\/\/(\d+)/);
                const itemTvdbId = tvdbMatch
                  ? parseInt(tvdbMatch[1], 10)
                  : null;

                return (
                  itemTmdbId === placeholder.tmdbId ||
                  itemTvdbId === placeholder.tvdbId
                );
              });

              if (item) {
                realItemInPlex = true;
                realItemRatingKey = item.ratingKey;
                break;
              }
            }
          } else {
            // No library cache available - assume item is in Plex if Radarr/Sonarr says hasFile
            // This is safe because the placeholder will get cleaned up on next sync when cache is available
            logger.debug(
              'Library cache not available - deferring cleanup verification',
              {
                label: 'Coming Soon Collections',
                title: placeholder.title,
              }
            );
            continue;
          }

          if (!realItemInPlex) {
            logger.info(
              'Real file exists in Radarr/Sonarr but not yet in Plex - skipping cleanup',
              {
                label: 'Coming Soon Collections',
                title: placeholder.title,
              }
            );
            continue; // Skip cleanup until Plex has scanned the file
          }

          // Mark as released if not already marked
          if (!placeholder.releasedAt) {
            placeholder.releasedAt = new Date();
            placeholder.plexRatingKey = realItemRatingKey; // Store rating key for overlay updates
            await repository.save(placeholder);

            logger.info('Marked Coming Soon item as released', {
              label: 'Coming Soon Collections',
              title: placeholder.title,
              releasedAt: placeholder.releasedAt,
            });
          }

          // Remove placeholder file (but keep database record for 7-day tracking)
          // Only try to remove if this was an actual placeholder file (not a regular item)
          if (placeholder.placeholderPath) {
            const { removePlaceholder } = await import(
              '@server/lib/comingsoon/placeholderManager'
            );

            try {
              await removePlaceholder(
                placeholder.placeholderPath,
                placeholder.mediaType
              );
              logger.info('Removed placeholder file for released item', {
                label: 'Coming Soon Collections',
                title: placeholder.title,
              });
            } catch (error) {
              // If placeholder already removed, that's okay
              if (error instanceof Error && !error.message.includes('ENOENT')) {
                logger.warn('Failed to remove placeholder file', {
                  label: 'Coming Soon Collections',
                  title: placeholder.title,
                  error: error.message,
                });
              }
            }
          } else {
            logger.debug(
              'Item was not a placeholder file, no file cleanup needed',
              {
                label: 'Coming Soon Collections',
                title: placeholder.title,
                mediaType: placeholder.mediaType,
              }
            );
          }

          removedCount++;
        } else {
          // If already marked as released, check if it's been more than configured days since RELEASE DATE
          if (placeholder.releasedAt && placeholder.releaseDate) {
            const { calculateDaysSince } = await import(
              '@server/lib/comingsoon/categorization'
            );
            const releasedWindowDays = config.comingSoonReleasedDays || 7;
            // Calculate days since the actual release date, not when file was detected
            const daysSinceReleaseDate = calculateDaysSince(
              placeholder.releaseDate
            );

            if (daysSinceReleaseDate > releasedWindowDays) {
              // More than configured window since release date - restore original poster and remove from database
              if (placeholder.plexRatingKey) {
                try {
                  const TmdbAPI = (await import('@server/api/themoviedb'))
                    .default;
                  const tmdbClient = new TmdbAPI();

                  let posterUrl: string | undefined;
                  if (placeholder.mediaType === 'movie') {
                    const movieDetails = await tmdbClient.getMovie({
                      movieId: placeholder.tmdbId,
                    });
                    posterUrl = movieDetails.poster_path
                      ? `https://image.tmdb.org/t/p/original${movieDetails.poster_path}`
                      : undefined;
                  } else {
                    const showDetails = await tmdbClient.getTvShow({
                      tvId: placeholder.tmdbId,
                    });
                    posterUrl = showDetails.poster_path
                      ? `https://image.tmdb.org/t/p/original${showDetails.poster_path}`
                      : undefined;
                  }

                  if (posterUrl) {
                    await plexClient.uploadPosterFromUrl(
                      placeholder.plexRatingKey,
                      posterUrl
                    );
                    logger.info(
                      `Reset poster to original after ${releasedWindowDays}-day window from release date`,
                      {
                        label: 'Coming Soon Collections',
                        title: placeholder.title,
                        daysSinceReleaseDate,
                        releaseDate: placeholder.releaseDate,
                        releasedWindowDays,
                      }
                    );
                  }
                } catch (error) {
                  logger.warn('Failed to reset poster to original', {
                    label: 'Coming Soon Collections',
                    title: placeholder.title,
                    ratingKey: placeholder.plexRatingKey,
                    error:
                      error instanceof Error ? error.message : String(error),
                  });
                }
              }

              // Remove from database
              await repository.remove(placeholder);
              removedCount++;

              logger.info(
                `Removed released item after ${releasedWindowDays}-day window from release date`,
                {
                  label: 'Coming Soon Collections',
                  title: placeholder.title,
                  daysSinceReleaseDate,
                  releaseDate: placeholder.releaseDate,
                  releasedWindowDays,
                }
              );
            }
          }
        }
      } catch (error) {
        logger.error('Error checking placeholder for cleanup', {
          label: 'Coming Soon Collections',
          title: placeholder.title,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Check for orphaned items (no longer in source data) and stale items (too old)
    if (sourceData && sourceData.length > 0) {
      const sourceTmdbIds = new Set(sourceData.map((item) => item.tmdbId));
      const STALE_THRESHOLD_DAYS = 180; // 6 months
      let orphanedCount = 0;
      let staleCount = 0;

      for (const placeholder of placeholders) {
        try {
          // Skip items that were already processed for release cleanup above
          if (placeholder.releasedAt) {
            continue;
          }

          const isOrphaned = !sourceTmdbIds.has(placeholder.tmdbId);
          const isStale =
            placeholder.createdAt &&
            Date.now() - placeholder.createdAt.getTime() >
              STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;

          // For orphaned items, check if they now have a real file (like returning shows that downloaded)
          if (isOrphaned && !isStale) {
            let hasRealFile = false;

            // Check if real file now exists (same logic as released items section)
            if (
              placeholder.source === 'radarr' ||
              placeholder.source === 'trakt'
            ) {
              if (
                placeholder.mediaType === 'movie' &&
                settings.radarr &&
                settings.radarr.length > 0
              ) {
                for (const radarrInstance of settings.radarr) {
                  const radarrClient = new RadarrAPI({
                    url: `${radarrInstance.useSsl ? 'https' : 'http'}://${
                      radarrInstance.hostname
                    }:${radarrInstance.port}${
                      radarrInstance.baseUrl || ''
                    }/api/v3`,
                    apiKey: radarrInstance.apiKey,
                  });

                  const movies = await radarrClient.getMovies();
                  const movie = movies.find(
                    (m) => m.tmdbId === placeholder.tmdbId
                  );

                  if (movie && movie.hasFile) {
                    hasRealFile = true;
                    break;
                  }
                }
              }
            }

            if (
              placeholder.source === 'sonarr' ||
              placeholder.source === 'trakt'
            ) {
              if (
                placeholder.mediaType === 'tv' &&
                settings.sonarr &&
                settings.sonarr.length > 0
              ) {
                for (const sonarrInstance of settings.sonarr) {
                  const sonarrClient = new SonarrAPI({
                    url: `${sonarrInstance.useSsl ? 'https' : 'http'}://${
                      sonarrInstance.hostname
                    }:${sonarrInstance.port}${
                      sonarrInstance.baseUrl || ''
                    }/api/v3`,
                    apiKey: sonarrInstance.apiKey,
                  });

                  const allSeries = await sonarrClient.getSeries();
                  const series = allSeries.find(
                    (s) => s.tvdbId === placeholder.tvdbId
                  );

                  if (series && series.statistics?.episodeFileCount > 0) {
                    hasRealFile = true;
                    break;
                  }
                }
              }
            }

            // If orphaned item now has a real file, mark as released instead of removing
            if (hasRealFile) {
              placeholder.releasedAt = new Date();
              await repository.save(placeholder);

              logger.info(
                'Marked orphaned Coming Soon item as released (has real file now)',
                {
                  label: 'Coming Soon Collections',
                  title: placeholder.title,
                  releasedAt: placeholder.releasedAt,
                }
              );

              // Will be handled by released items cleanup logic (respects configured window)
              continue;
            }
          }

          if (isOrphaned || isStale) {
            const reason = isOrphaned
              ? 'no longer in source data'
              : `stale (${STALE_THRESHOLD_DAYS}+ days old)`;

            logger.info('Removing orphaned/stale Coming Soon placeholder', {
              label: 'Coming Soon Collections',
              title: placeholder.title,
              reason,
              age: placeholder.createdAt
                ? Math.floor(
                    (Date.now() - placeholder.createdAt.getTime()) /
                      (24 * 60 * 60 * 1000)
                  )
                : 'unknown',
              source: placeholder.source,
            });

            // Remove placeholder file if this was an actual placeholder
            if (placeholder.placeholderPath) {
              const { removePlaceholder } = await import(
                '@server/lib/comingsoon/placeholderManager'
              );
              try {
                await removePlaceholder(
                  placeholder.placeholderPath,
                  placeholder.mediaType
                );
                logger.debug('Removed placeholder file', {
                  label: 'Coming Soon Collections',
                  path: placeholder.placeholderPath,
                });
              } catch (error) {
                // If file already deleted, that's okay
                if (
                  error instanceof Error &&
                  !error.message.includes('ENOENT')
                ) {
                  logger.warn('Failed to remove placeholder file', {
                    label: 'Coming Soon Collections',
                    path: placeholder.placeholderPath,
                    error: error.message,
                  });
                }
              }
            }

            // Reset poster to original TMDB poster (for all items with overlays)
            if (placeholder.plexRatingKey) {
              try {
                const TmdbAPI = (await import('@server/api/themoviedb'))
                  .default;
                const tmdbClient = new TmdbAPI();

                let posterUrl: string | undefined;
                if (placeholder.mediaType === 'movie') {
                  const movieDetails = await tmdbClient.getMovie({
                    movieId: placeholder.tmdbId,
                  });
                  posterUrl = movieDetails.poster_path
                    ? `https://image.tmdb.org/t/p/original${movieDetails.poster_path}`
                    : undefined;
                } else {
                  const showDetails = await tmdbClient.getTvShow({
                    tvId: placeholder.tmdbId,
                  });
                  posterUrl = showDetails.poster_path
                    ? `https://image.tmdb.org/t/p/original${showDetails.poster_path}`
                    : undefined;
                }

                if (posterUrl) {
                  await plexClient.uploadPosterFromUrl(
                    placeholder.plexRatingKey,
                    posterUrl
                  );
                  logger.info(
                    'Reset poster to original TMDB poster for orphaned item',
                    {
                      label: 'Coming Soon Collections',
                      title: placeholder.title,
                      ratingKey: placeholder.plexRatingKey,
                    }
                  );
                }
              } catch (error) {
                logger.warn('Failed to reset poster to original', {
                  label: 'Coming Soon Collections',
                  title: placeholder.title,
                  ratingKey: placeholder.plexRatingKey,
                  error: error instanceof Error ? error.message : String(error),
                });
              }
            }

            // Remove from database
            await repository.remove(placeholder);
            removedCount++;

            if (isOrphaned) orphanedCount++;
            if (isStale) staleCount++;

            logger.info('Removed Coming Soon placeholder from database', {
              label: 'Coming Soon Collections',
              title: placeholder.title,
              reason,
            });
          }
        } catch (error) {
          logger.error('Error removing orphaned/stale placeholder', {
            label: 'Coming Soon Collections',
            title: placeholder.title,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (orphanedCount > 0 || staleCount > 0) {
        logger.info('Orphaned/stale placeholder cleanup summary', {
          label: 'Coming Soon Collections',
          configName: config.name,
          orphaned: orphanedCount,
          stale: staleCount,
          total: orphanedCount + staleCount,
        });
      }
    }

    if (removedCount > 0) {
      logger.info('Coming Soon cleanup completed', {
        label: 'Coming Soon Collections',
        configName: config.name,
        removed: removedCount,
      });
    }
  }
}
