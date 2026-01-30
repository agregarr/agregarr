import type { OverseerrWatchlistItem } from '@server/api/overseerr';
import OverseerrAPI from '@server/api/overseerr';
import RadarrAPI from '@server/api/servarr/radarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import TheMovieDb from '@server/api/themoviedb';
import type { WatchlistSyncSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

class WatchlistSync {
  public running = false;
  private cancelled = false;
  private currentStage = '';

  public get status() {
    return {
      running: this.running,
      cancelled: this.cancelled,
      currentStage: this.currentStage,
    };
  }

  public cancel(): void {
    this.cancelled = true;
  }

  public async run(): Promise<void> {
    const settings = getSettings();
    const syncSettings = settings.watchlistSync;

    // Check if watchlist sync is enabled
    if (!syncSettings.enableOwner && !syncSettings.enableUsers) {
      logger.debug('Watchlist sync not enabled', { label: 'Watchlist Sync' });
      return;
    }

    // Check if Radarr or Sonarr is configured for watchlist sync
    const isRadarrConfigured =
      syncSettings.radarr?.enabled && settings.radarr.length > 0;
    const isSonarrConfigured =
      syncSettings.sonarr?.enabled && settings.sonarr.length > 0;

    if (!isRadarrConfigured && !isSonarrConfigured) {
      logger.warn(
        'Watchlist sync enabled but no Radarr/Sonarr server selected for watchlist sync. Please select a server in watchlist sync settings.',
        {
          label: 'Watchlist Sync',
        }
      );
      return;
    }

    if (this.running) {
      logger.warn('Watchlist sync already running', {
        label: 'Watchlist Sync',
      });
      return;
    }

    this.running = true;
    this.cancelled = false;
    this.currentStage = 'Initializing';

    try {
      logger.info('Starting watchlist sync', { label: 'Watchlist Sync' });

      // Check if Overseerr is configured
      if (!settings.overseerr.hostname) {
        logger.warn('Overseerr not configured, cannot sync watchlists', {
          label: 'Watchlist Sync',
        });
        return;
      }

      const overseerrApi = new OverseerrAPI(settings.overseerr);
      const usersToSync: {
        id: number;
        displayName?: string;
        plexUsername?: string;
      }[] = [];

      // Fetch all users from Overseerr
      const { results: allOverseerrUsers } = await overseerrApi.getUsers({
        take: 9999,
      });

      // Add admin user (ID 1) if enableOwner is true
      if (syncSettings.enableOwner) {
        const adminUser = allOverseerrUsers.find((u) => u.id === 1);
        if (adminUser) {
          usersToSync.push({
            id: adminUser.id,
            displayName: adminUser.displayName || 'Admin',
            plexUsername: adminUser.plexUsername,
          });
        } else {
          logger.warn('Admin user (ID 1) not found in Overseerr', {
            label: 'Watchlist Sync',
          });
        }
      }

      // Add all non-admin users if enableUsers is true
      if (syncSettings.enableUsers) {
        const regularUsers = allOverseerrUsers
          .filter((u) => u.id !== 1) // Exclude admin if already added
          .map((u) => ({
            id: u.id,
            displayName: u.displayName || `User ${u.id}`,
            plexUsername: u.plexUsername,
          }));
        usersToSync.push(...regularUsers);
      }

      if (usersToSync.length === 0) {
        logger.warn('No users selected for watchlist sync', {
          label: 'Watchlist Sync',
        });
        return;
      }

      logger.info(`Syncing watchlists for ${usersToSync.length} user(s)`, {
        label: 'Watchlist Sync',
      });

      // Fetch Radarr/Sonarr libraries once at the start for efficiency
      let radarrMovies: Awaited<ReturnType<RadarrAPI['getMovies']>> = [];
      let sonarrSeries: Awaited<ReturnType<SonarrAPI['getSeries']>> = [];

      if (isRadarrConfigured) {
        try {
          const radarrServerId = syncSettings.radarr?.serverId;
          const radarrServer = settings.radarr.find((r) =>
            radarrServerId !== undefined
              ? r.id === radarrServerId
              : r.isDefault && !r.is4k
          );

          if (radarrServer) {
            const radarrApi = new RadarrAPI({
              url: RadarrAPI.buildUrl(radarrServer, '/api/v3'),
              apiKey: radarrServer.apiKey,
            });
            radarrMovies = await radarrApi.getMovies();
            logger.info(
              `Fetched ${radarrMovies.length} movies from Radarr for duplicate checking`,
              { label: 'Watchlist Sync' }
            );
          }
        } catch (error) {
          logger.warn(
            'Failed to fetch Radarr library, will skip duplicate checks',
            {
              label: 'Watchlist Sync',
              error: error instanceof Error ? error.message : String(error),
            }
          );
        }
      }

      if (isSonarrConfigured) {
        try {
          const sonarrServerId = syncSettings.sonarr?.serverId;
          const sonarrServer = settings.sonarr.find((s) =>
            sonarrServerId !== undefined
              ? s.id === sonarrServerId
              : s.isDefault && !s.is4k
          );

          if (sonarrServer) {
            const sonarrApi = new SonarrAPI({
              url: SonarrAPI.buildUrl(sonarrServer, '/api/v3'),
              apiKey: sonarrServer.apiKey,
            });
            sonarrSeries = await sonarrApi.getSeries();
            logger.info(
              `Fetched ${sonarrSeries.length} series from Sonarr for duplicate checking`,
              { label: 'Watchlist Sync' }
            );
          }
        } catch (error) {
          logger.warn(
            'Failed to fetch Sonarr library, will skip duplicate checks',
            {
              label: 'Watchlist Sync',
              error: error instanceof Error ? error.message : String(error),
            }
          );
        }
      }

      let totalItemsProcessed = 0;
      let totalItemsAdded = 0;

      // Process each user's watchlist
      for (const user of usersToSync) {
        if (this.cancelled) {
          logger.info('Watchlist sync cancelled', {
            label: 'Watchlist Sync',
          });
          break;
        }

        this.currentStage = `Processing ${user.displayName}'s watchlist`;

        try {
          const result = await this.syncUserWatchlist(
            user,
            syncSettings,
            overseerrApi,
            radarrMovies,
            sonarrSeries
          );
          totalItemsProcessed += result.processed;
          totalItemsAdded += result.added;
        } catch (error) {
          logger.error('Failed to sync user watchlist', {
            label: 'Watchlist Sync',
            user: user.displayName,
            error: error instanceof Error ? error.message : String(error),
          });
          // Continue with next user
        }
      }

      logger.info('Watchlist sync completed', {
        label: 'Watchlist Sync',
        itemsProcessed: totalItemsProcessed,
        itemsAdded: totalItemsAdded,
      });

      // Update last sync timestamp
      settings.watchlistSync.lastSyncAt = new Date();
      settings.watchlistSync.lastSyncError = undefined;
      settings.save();
    } catch (error) {
      logger.error('Watchlist sync failed', {
        label: 'Watchlist Sync',
        error: error instanceof Error ? error.message : String(error),
      });
      settings.watchlistSync.lastSyncError =
        error instanceof Error ? error.message : String(error);
      settings.save();
    } finally {
      this.running = false;
      this.cancelled = false;
      this.currentStage = '';
    }
  }

  private async syncUserWatchlist(
    user: { id: number; displayName?: string; plexUsername?: string },
    syncSettings: WatchlistSyncSettings,
    overseerrApi: OverseerrAPI,
    radarrMovies: Awaited<ReturnType<RadarrAPI['getMovies']>>,
    sonarrSeries: Awaited<ReturnType<SonarrAPI['getSeries']>>
  ): Promise<{ processed: number; added: number }> {
    logger.debug(`Fetching watchlist for ${user.displayName}`, {
      label: 'Watchlist Sync',
    });

    // Fetch user's watchlist from Overseerr
    const { results: allItems } = await overseerrApi.getUserWatchlist(user.id);

    logger.debug(
      `Found ${allItems.length} items in ${user.displayName}'s watchlist`,
      {
        label: 'Watchlist Sync',
      }
    );

    let itemsAdded = 0;

    // Process each item
    for (const item of allItems) {
      if (this.cancelled) break;

      try {
        if (item.mediaType === 'movie' && syncSettings.radarr?.enabled) {
          const added = await this.addMovieToRadarr(
            item,
            syncSettings,
            radarrMovies,
            user.plexUsername
          );
          if (added) itemsAdded++;
        } else if (item.mediaType === 'tv' && syncSettings.sonarr?.enabled) {
          const added = await this.addShowToSonarr(
            item,
            syncSettings,
            sonarrSeries,
            user.plexUsername
          );
          if (added) itemsAdded++;
        }
      } catch (error) {
        logger.error('Failed to add item from watchlist', {
          label: 'Watchlist Sync',
          user: user.displayName,
          title: item.title,
          mediaType: item.mediaType,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue with next item
      }
    }

    return { processed: allItems.length, added: itemsAdded };
  }

  private async addMovieToRadarr(
    item: OverseerrWatchlistItem,
    syncSettings: WatchlistSyncSettings,
    radarrMovies: Awaited<ReturnType<RadarrAPI['getMovies']>>,
    plexUsername?: string
  ): Promise<boolean> {
    const settings = getSettings();
    const radarrSettings = syncSettings.radarr;

    if (!radarrSettings || !item.tmdbId) {
      return false;
    }

    // Find the Radarr server to use
    const radarrServerId = radarrSettings.serverId;
    const radarrServer = settings.radarr.find((r) =>
      radarrServerId ? r.id === radarrServerId : r.isDefault && !r.is4k
    );

    if (!radarrServer) {
      logger.warn('No Radarr server configured for watchlist sync', {
        label: 'Watchlist Sync',
      });
      return false;
    }

    // Check if movie already exists in Radarr (using cached library)
    const existingMovie = radarrMovies.find((m) => m.tmdbId === item.tmdbId);
    if (existingMovie) {
      logger.debug('Movie already exists in Radarr, skipping', {
        label: 'Watchlist Sync',
        title: item.title,
        radarrId: existingMovie.id,
      });
      return false;
    }

    const radarrApi = new RadarrAPI({
      url: RadarrAPI.buildUrl(radarrServer, '/api/v3'),
      apiKey: radarrServer.apiKey,
    });

    // Check if movie is excluded in Radarr
    if (await this.isMovieExcluded(radarrApi, item.tmdbId)) {
      logger.debug('Movie is excluded in Radarr, skipping', {
        label: 'Watchlist Sync',
        title: item.title,
        tmdbId: item.tmdbId,
      });
      return false;
    }

    // Build tags array
    const tags = [...(radarrSettings.tags ?? radarrServer.tags ?? [])];

    // Add username tag if enabled and username is available
    if (radarrSettings.tagWithUsername && plexUsername) {
      const usernameTagId = await this.getOrCreateTag(
        radarrApi,
        plexUsername,
        'Radarr'
      );
      if (usernameTagId && !tags.includes(usernameTagId)) {
        tags.push(usernameTagId);
      }
    }

    // Add movie to Radarr
    const options = {
      title: item.title,
      qualityProfileId:
        radarrSettings.profileId ?? radarrServer.activeProfileId,
      minimumAvailability: radarrServer.minimumAvailability,
      tags: tags,
      profileId: radarrSettings.profileId ?? radarrServer.activeProfileId,
      year: 0, // Radarr will determine from TMDB
      rootFolderPath: radarrSettings.rootFolder ?? radarrServer.activeDirectory,
      tmdbId: item.tmdbId,
      monitored:
        radarrSettings.monitor ?? radarrServer.monitorByDefault ?? true,
      searchNow: radarrSettings.searchOnAdd ?? radarrServer.searchOnAdd ?? true,
    };

    await radarrApi.addMovie(options);
    logger.info('Added movie to Radarr from watchlist', {
      label: 'Watchlist Sync',
      title: item.title,
      tmdbId: item.tmdbId,
      user: plexUsername,
    });

    return true;
  }

  private async addShowToSonarr(
    item: OverseerrWatchlistItem,
    syncSettings: WatchlistSyncSettings,
    sonarrSeries: Awaited<ReturnType<SonarrAPI['getSeries']>>,
    plexUsername?: string
  ): Promise<boolean> {
    const settings = getSettings();
    const sonarrSettings = syncSettings.sonarr;

    if (!sonarrSettings || !item.tmdbId) {
      logger.debug('Skipping show without TMDB ID', {
        label: 'Watchlist Sync',
        title: item.title,
      });
      return false;
    }

    // Convert TMDB ID to TVDB ID (required by Sonarr)
    let tvdbId: number;
    try {
      const tmdb = new TheMovieDb();
      const tvShow = await tmdb.getTvShow({ tvId: item.tmdbId });

      if (!tvShow.external_ids?.tvdb_id) {
        logger.warn('No TVDB ID found for TV show', {
          label: 'Watchlist Sync',
          title: item.title,
          tmdbId: item.tmdbId,
        });
        return false;
      }

      tvdbId = tvShow.external_ids.tvdb_id;
    } catch (error) {
      logger.error('Failed to get TVDB ID for TV show', {
        label: 'Watchlist Sync',
        title: item.title,
        tmdbId: item.tmdbId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }

    // Find the Sonarr server to use
    const sonarrServerId = sonarrSettings.serverId;
    const sonarrServer = settings.sonarr.find((s) =>
      sonarrServerId ? s.id === sonarrServerId : s.isDefault && !s.is4k
    );

    if (!sonarrServer) {
      logger.warn('No Sonarr server configured for watchlist sync', {
        label: 'Watchlist Sync',
      });
      return false;
    }

    // Check if show already exists in Sonarr (using cached library)
    const existingSeries = sonarrSeries.find((s) => s.tvdbId === tvdbId);
    if (existingSeries) {
      logger.debug('Show already exists in Sonarr, skipping', {
        label: 'Watchlist Sync',
        title: item.title,
        sonarrId: existingSeries.id,
      });
      return false;
    }

    const sonarrApi = new SonarrAPI({
      url: SonarrAPI.buildUrl(sonarrServer, '/api/v3'),
      apiKey: sonarrServer.apiKey,
    });

    // Check if show is excluded in Sonarr
    if (await this.isShowExcluded(sonarrApi, tvdbId)) {
      logger.debug('Show is excluded in Sonarr, skipping', {
        label: 'Watchlist Sync',
        title: item.title,
        tvdbId: tvdbId,
      });
      return false;
    }

    // Build tags array
    const tags = [...(sonarrSettings.tags ?? sonarrServer.tags ?? [])];

    // Add username tag if enabled and username is available
    if (sonarrSettings.tagWithUsername && plexUsername) {
      const usernameTagId = await this.getOrCreateTag(
        sonarrApi,
        plexUsername,
        'Sonarr'
      );
      if (usernameTagId && !tags.includes(usernameTagId)) {
        tags.push(usernameTagId);
      }
    }

    // Add show to Sonarr
    const options = {
      tvdbid: tvdbId,
      title: item.title,
      profileId: sonarrSettings.profileId ?? sonarrServer.activeProfileId,
      languageProfileId: sonarrServer.activeLanguageProfileId,
      seasons: [], // Empty array means monitor all seasons
      seasonFolder:
        sonarrSettings.seasonFolder ?? sonarrServer.enableSeasonFolders,
      rootFolderPath: sonarrSettings.rootFolder ?? sonarrServer.activeDirectory,
      tags: tags,
      seriesType: sonarrServer.seriesType,
      monitored:
        sonarrSettings.monitor ?? sonarrServer.monitorByDefault ?? true,
      searchNow: sonarrSettings.searchOnAdd ?? sonarrServer.searchOnAdd ?? true,
    };

    await sonarrApi.addSeries(options);
    logger.info('Added show to Sonarr from watchlist', {
      label: 'Watchlist Sync',
      title: item.title,
      tmdbId: item.tmdbId,
      tvdbId: tvdbId,
      user: plexUsername,
    });

    return true;
  }

  /**
   * Get or create a tag in Radarr/Sonarr by label
   * Returns the tag ID if successful, undefined otherwise
   */
  private async getOrCreateTag(
    api: RadarrAPI | SonarrAPI,
    tagLabel: string,
    service: 'Radarr' | 'Sonarr'
  ): Promise<number | undefined> {
    try {
      const existingTags = await api.getTags();
      const existingTag = existingTags.find(
        (t) => t.label?.toLowerCase() === tagLabel.toLowerCase()
      );

      if (existingTag?.id) {
        return existingTag.id;
      }

      // Create the tag
      const newTag = await api.createTag({ label: tagLabel });
      logger.debug(`Created username tag in ${service}`, {
        label: 'Watchlist Sync',
        tagLabel,
        tagId: newTag.id,
      });
      return newTag.id;
    } catch (error) {
      // Handle 409 conflict (tag already exists - race condition)
      const status = (error as { response?: { status?: number } })?.response
        ?.status;
      if (status === 409) {
        const existingTags = await api.getTags();
        const existingTag = existingTags.find(
          (t) => t.label?.toLowerCase() === tagLabel.toLowerCase()
        );
        return existingTag?.id;
      }

      logger.warn(`Failed to create username tag in ${service}`, {
        label: 'Watchlist Sync',
        tagLabel,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  /**
   * Check if a movie is excluded in Radarr
   */
  private async isMovieExcluded(
    radarrApi: RadarrAPI,
    tmdbId: number
  ): Promise<boolean> {
    try {
      const exclusions = await radarrApi.getExclusions();
      return exclusions.some((exclusion) => exclusion.tmdbId === tmdbId);
    } catch (error) {
      logger.debug('Could not check Radarr exclusion list', {
        label: 'Watchlist Sync',
        error: error instanceof Error ? error.message : String(error),
      });
      // If we can't check exclusions, allow the item to proceed
      return false;
    }
  }

  /**
   * Check if a show is excluded in Sonarr
   */
  private async isShowExcluded(
    sonarrApi: SonarrAPI,
    tvdbId: number
  ): Promise<boolean> {
    try {
      const exclusions = await sonarrApi.getExclusions();
      return exclusions.some((exclusion) => exclusion.tvdbId === tvdbId);
    } catch (error) {
      logger.debug('Could not check Sonarr exclusion list', {
        label: 'Watchlist Sync',
        error: error instanceof Error ? error.message : String(error),
      });
      // If we can't check exclusions, allow the item to proceed
      return false;
    }
  }
}

const watchlistSync = new WatchlistSync();
export default watchlistSync;
