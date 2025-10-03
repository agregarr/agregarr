import OverseerrAPI, {
  type OverseerrMediaRequest,
} from '@server/api/overseerr';
import TheMovieDb from '@server/api/themoviedb';
import { getRepository } from '@server/datasource';
import { MissingItemRequest } from '@server/entity/MissingItemRequest';
import type { User } from '@server/entity/User';
import type {
  AutoRequestResult,
  MissingItem,
} from '@server/lib/collections/core/types';
import type { CollectionConfig } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import type { ServiceType } from './ServiceUserManager';
import { ServiceUserManager } from './ServiceUserManager';
import { syncCacheService } from './SyncCacheService';

/**
 * Shared auto-request service for all collection sync implementations
 *
 * Handles the common auto-request functionality that can be reused across
 * different collection sources (Trakt, TMDB, IMDb, etc.)
 */
export class AutoRequestService {
  private serviceUserManager: ServiceUserManager;
  private overseerrAPI: OverseerrAPI | null = null;
  private missingItemRepository = getRepository(MissingItemRequest);
  private tmdbAPI: TheMovieDb;

  constructor() {
    this.serviceUserManager = new ServiceUserManager();
    this.tmdbAPI = new TheMovieDb();
  }

  /**
   * Get or initialize Overseerr API client
   */
  private getOverseerrAPI(): OverseerrAPI {
    if (!this.overseerrAPI) {
      const settings = getSettings();
      const overseerrSettings = settings.overseerr;

      if (!overseerrSettings?.hostname || !overseerrSettings?.apiKey) {
        throw new Error('Overseerr API settings not configured');
      }

      this.overseerrAPI = new OverseerrAPI(overseerrSettings);
    }
    return this.overseerrAPI;
  }

  /**
   * Process auto-requests for missing items from any collection source
   *
   * @param missingItems - Items that are missing from Plex
   * @param config - Collection configuration with auto-request settings
   * @param source - Source type for logging and service user selection
   * @returns Promise with auto-request results
   */
  public async processAutoRequests(
    missingItems: MissingItem[],
    config: CollectionConfig,
    source: 'trakt' | 'tmdb' | 'imdb' | 'letterboxd' | 'mdblist' | 'networks'
  ): Promise<AutoRequestResult> {
    // Only proceed if auto-request is enabled
    if (!config.searchMissingMovies && !config.searchMissingTV) {
      return {
        autoApproved: 0,
        manualApproval: 0,
        alreadyRequested: 0,
        skipped: 0,
        total: 0,
      };
    }

    // Filter items based on config settings
    const yearFilteredItems: string[] = [];
    const filteredMissingItems = missingItems.filter((item) => {
      // Check media type
      if (item.mediaType === 'movie' && !config.searchMissingMovies)
        return false;
      if (item.mediaType === 'tv' && !config.searchMissingTV) return false;
      if (item.mediaType !== 'movie' && item.mediaType !== 'tv') return false;

      // Check minimum year filter
      if (config.minimumYear && config.minimumYear > 0) {
        if (!item.year) {
          logger.debug(
            `Item "${item.title}" has no year data, allowing through year filter`,
            {
              label: 'Auto Request Service',
              collection: config.name,
              tmdbId: item.tmdbId,
            }
          );
        } else if (item.year < config.minimumYear) {
          yearFilteredItems.push(
            `${item.title} (${item.year}) - below minimum ${config.minimumYear}`
          );
          return false;
        }
      }

      return true;
    });

    // Log year filtering summary
    if (yearFilteredItems.length > 0) {
      logger.info(
        `Filtered ${yearFilteredItems.length} items due to minimum year (${config.minimumYear})`,
        {
          label: 'Auto Request Service',
          collection: config.name,
          minimumYear: config.minimumYear,
          filteredCount: yearFilteredItems.length,
          examples: yearFilteredItems.slice(0, 5),
          ...(yearFilteredItems.length > 5 && {
            additionalCount: yearFilteredItems.length - 5,
          }),
        }
      );
    }

    if (filteredMissingItems.length === 0) {
      return {
        autoApproved: 0,
        manualApproval: 0,
        alreadyRequested: 0,
        skipped: 0,
        total: 0,
      };
    }

    try {
      // Note: We no longer create separate users upfront.
      // Users are created dynamically with appropriate permissions per request.

      // OPTIMIZATION: Use cached requests if available, otherwise fetch fresh data
      let allRequestsResults: OverseerrMediaRequest[];

      if (syncCacheService.getIsInitialized()) {
        allRequestsResults = syncCacheService.getOverseerrRequests();

        logger.debug(
          `Using cached Overseerr requests (${allRequestsResults.length} requests)`,
          {
            label: 'Auto Request Service',
            cachedRequests: allRequestsResults.length,
          }
        );
      } else {
        // Fallback to fresh API call if cache not available
        const overseerrAPI = this.getOverseerrAPI();
        const allRequests = await overseerrAPI.getRequests({ take: 2000 });
        allRequestsResults = allRequests.results;

        logger.debug(
          `Cache not available, fetched fresh Overseerr requests (${allRequestsResults.length} requests)`,
          {
            label: 'Auto Request Service',
            freshRequests: allRequestsResults.length,
          }
        );
      }

      let autoApprovedRequests = 0;
      let manualApprovalRequests = 0;
      let alreadyRequestedCount = 0;
      let skippedRequests = 0;
      const maxSeasons = Number(config.maxSeasonsToRequest) || 3;

      // Track declined items for summary logging
      const previouslyDeclinedItems: string[] = [];
      const tooManySeasons: string[] = [];
      const excludedGenreItems: string[] = [];
      const excludedCountryItems: string[] = [];

      for (const item of filteredMissingItems) {
        try {
          // Check if request already exists using cached requests
          const existingRequest = this.checkExistingRequestFromCache(
            item.tmdbId,
            item.mediaType,
            allRequestsResults
          );
          if (existingRequest) {
            alreadyRequestedCount++;
            continue;
          }

          // Check excluded genres
          if (config.excludedGenres && config.excludedGenres.length > 0) {
            const hasExcluded = await this.hasExcludedGenres(
              item.tmdbId,
              item.mediaType,
              config.excludedGenres
            );
            if (hasExcluded) {
              excludedGenreItems.push(item.title);
              skippedRequests++;
              continue;
            }
          }

          // Check excluded countries
          if (config.excludedCountries && config.excludedCountries.length > 0) {
            const hasExcluded = await this.hasExcludedCountries(
              item.tmdbId,
              item.mediaType,
              config.excludedCountries
            );
            if (hasExcluded) {
              excludedCountryItems.push(item.title);
              skippedRequests++;
              continue;
            }
          }

          // Check season limit for ALL TV shows first (regardless of auto-approve setting)
          if (item.mediaType === 'tv') {
            const seasonCount = await this.getTvSeasonCount(item.tmdbId);

            if (seasonCount > maxSeasons) {
              // Track TV shows that exceed the season limit
              tooManySeasons.push(item.title);
              skippedRequests++;
              continue;
            }
          }

          // Determine if this request should be auto-approved
          let autoApprove = false;
          let requestType = 'manual-approval';

          if (item.mediaType === 'movie' && config.autoApproveMovies) {
            autoApprove = true;
            requestType = 'auto-approved';
          } else if (item.mediaType === 'tv' && config.autoApproveTV) {
            // Auto-approve TV shows (season limit already checked above)
            autoApprove = true;
            requestType = 'auto-approved';
          }

          // Get service user with dynamic permissions based on auto-approve decision
          const serviceUserToUse = await this.getServiceUserForRequest(
            source as ServiceType,
            config.name, // Use collection name as collection type
            autoApprove
          );

          // For manual approval requests, check if this item was previously declined by this service user
          if (!autoApprove) {
            if (
              this.wasPreviouslyDeclinedFromCache(
                item.tmdbId,
                item.mediaType,
                serviceUserToUse,
                allRequestsResults
              )
            ) {
              previouslyDeclinedItems.push(item.title);
              skippedRequests++;
              continue;
            }
          }

          // Create the actual request via Overseerr API
          const overseerrAPI = this.getOverseerrAPI();

          // For TV shows, request seasons based on seasonsPerShowLimit
          let seasons: number[] | 'all' | undefined;
          if (item.mediaType === 'tv') {
            const seasonsLimit = config.seasonsPerShowLimit;

            if (seasonsLimit && seasonsLimit > 0) {
              // Request only the first X seasons
              const seasonNumbers = [];
              for (let i = 1; i <= seasonsLimit; i++) {
                seasonNumbers.push(i);
              }
              seasons = seasonNumbers;

              logger.debug(
                `Limiting ${
                  item.title
                } to first ${seasonsLimit} seasons: [${seasonNumbers.join(
                  ', '
                )}]`,
                {
                  label: 'Auto Request Service',
                  collection: config.name,
                }
              );
            } else {
              // Use 'all' to request all available seasons (matches old working implementation)
              seasons = 'all';
            }
          }

          const userIdToUse =
            serviceUserToUse.externalOverseerrId || serviceUserToUse.id;

          await overseerrAPI.createRequest({
            mediaId: item.tmdbId,
            mediaType: item.mediaType,
            seasons,
            is4k: false,
            userId: userIdToUse,
          });

          // Fetch poster from TMDB
          let posterPath: string | undefined;
          try {
            posterPath = await this.fetchTmdbPoster(
              item.tmdbId,
              item.mediaType
            );
          } catch (error) {
            logger.debug(`Failed to fetch poster for ${item.title}`, {
              label: 'Auto Request Service',
              tmdbId: item.tmdbId,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }

          // Track the missing item request
          await this.trackMissingItemRequest({
            tmdbId: item.tmdbId,
            mediaType: item.mediaType,
            title: item.title,
            posterPath,
            year: item.year,
            collectionName: config.name,
            collectionSource: source,
            collectionSubtype: undefined, // Could be expanded later for granular tracking
            requestService: 'overseerr',
            requestMethod: autoApprove ? 'auto' : 'manual',
            requestStatus: autoApprove ? 'approved' : 'pending',
            requestedBy: serviceUserToUse,
            requestedAt: new Date(),
          });

          if (requestType.includes('auto-approved')) {
            autoApprovedRequests++;
          } else {
            manualApprovalRequests++;
          }

          logger.debug(
            `Created ${requestType} request for ${item.mediaType}: ${item.title} (TMDB: ${item.tmdbId})`,
            {
              label: `${
                source.charAt(0).toUpperCase() + source.slice(1)
              } Collections`,
              config: config.name,
            }
          );
        } catch (error) {
          logger.warn(
            `Failed to create auto-request for ${item.title}: ${error}`,
            {
              label: `${
                source.charAt(0).toUpperCase() + source.slice(1)
              } Collections`,
            }
          );
        }
      }

      // Log summary of declined items
      if (previouslyDeclinedItems.length > 0) {
        logger.info(`Items skipped due to previous decline`, {
          label: `${
            source.charAt(0).toUpperCase() + source.slice(1)
          } Collections`,
          collection: config.name,
          count: previouslyDeclinedItems.length,
          titles: previouslyDeclinedItems.slice(0, 10), // Limit to first 10 titles
          ...(previouslyDeclinedItems.length > 10 && {
            additionalCount: previouslyDeclinedItems.length - 10,
          }),
        });
      }

      // Log summary of items with too many seasons
      if (tooManySeasons.length > 0) {
        logger.info(
          `TV shows skipped due to exceeding ${maxSeasons} season limit`,
          {
            label: `${
              source.charAt(0).toUpperCase() + source.slice(1)
            } Collections`,
            collection: config.name,
            count: tooManySeasons.length,
            titles: tooManySeasons.slice(0, 10), // Limit to first 10 titles
            ...(tooManySeasons.length > 10 && {
              additionalCount: tooManySeasons.length - 10,
            }),
          }
        );
      }

      // Log summary of items excluded by genre
      if (excludedGenreItems.length > 0) {
        logger.info(`Items skipped due to excluded genres`, {
          label: `${
            source.charAt(0).toUpperCase() + source.slice(1)
          } Collections`,
          collection: config.name,
          count: excludedGenreItems.length,
          titles: excludedGenreItems.slice(0, 10), // Limit to first 10 titles
          ...(excludedGenreItems.length > 10 && {
            additionalCount: excludedGenreItems.length - 10,
          }),
        });
      }

      // Log summary of items excluded by country
      if (excludedCountryItems.length > 0) {
        logger.info(`Items skipped due to excluded countries`, {
          label: `${
            source.charAt(0).toUpperCase() + source.slice(1)
          } Collections`,
          collection: config.name,
          count: excludedCountryItems.length,
          titles: excludedCountryItems.slice(0, 10), // Limit to first 10 titles
          ...(excludedCountryItems.length > 10 && {
            additionalCount: excludedCountryItems.length - 10,
          }),
        });
      }

      const totalRequests = autoApprovedRequests + manualApprovalRequests;
      if (totalRequests > 0) {
        logger.info(
          `${
            source.charAt(0).toUpperCase() + source.slice(1)
          } collection auto-requests created for ${
            config.name
          }: ${autoApprovedRequests} auto-approved, ${manualApprovalRequests} manual approval${
            skippedRequests > 0 ? `, ${skippedRequests} skipped` : ''
          }`,
          {
            label: `${
              source.charAt(0).toUpperCase() + source.slice(1)
            } Collections`,
          }
        );
      }

      return {
        autoApproved: autoApprovedRequests,
        manualApproval: manualApprovalRequests,
        alreadyRequested: alreadyRequestedCount,
        skipped: skippedRequests,
        total: filteredMissingItems.length,
      };
    } catch (error) {
      logger.error(
        `Failed to handle auto-requests for ${source} collection ${config.name}: ${error}`,
        {
          label: `${
            source.charAt(0).toUpperCase() + source.slice(1)
          } Collections`,
        }
      );
      throw error;
    }
  }

  /**
   * Get service user for request based on auto-approve setting
   */
  private async getServiceUserForRequest(
    source: ServiceType,
    collectionType: string | undefined,
    autoApprove: boolean
  ): Promise<User> {
    return this.serviceUserManager.getOrCreateServiceUserForRequest(
      source,
      collectionType,
      autoApprove
    );
  }

  /**
   * Check if a request already exists for the given media (DEPRECATED - use cached version)
   */
  private async checkExistingRequest(
    tmdbId: number,
    mediaType: 'movie' | 'tv'
  ): Promise<boolean> {
    try {
      // OPTIMIZATION: Use cached requests if available
      if (syncCacheService.getIsInitialized()) {
        const cachedRequests = syncCacheService.getOverseerrRequests();
        return this.checkExistingRequestFromCache(
          tmdbId,
          mediaType,
          cachedRequests
        );
      }

      // Fallback to fresh API call
      const overseerrAPI = this.getOverseerrAPI();
      const requests = await overseerrAPI.getRequests({ take: 1000 });

      const existingRequest = requests.results.find(
        (request) =>
          request.media.tmdbId === tmdbId &&
          request.type === mediaType &&
          request.status !== 3 // 3 = DECLINED status in Overseerr
      );

      return !!existingRequest;
    } catch (error) {
      logger.warn(`Failed to check existing request for TMDB ID ${tmdbId}`, {
        label: 'Auto Request Service',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Check if a request already exists for the given media using cached requests
   * OPTIMIZED: No API calls, uses pre-fetched data
   */
  private checkExistingRequestFromCache(
    tmdbId: number,
    mediaType: 'movie' | 'tv',
    cachedRequests: OverseerrMediaRequest[]
  ): boolean {
    const existingRequest = cachedRequests.find(
      (request) =>
        request.media.tmdbId === tmdbId &&
        request.type === mediaType &&
        request.status !== 3 // 3 = DECLINED status in Overseerr
    );

    return !!existingRequest;
  }

  /**
   * Get the number of seasons for a TV show
   */
  private async getTvSeasonCount(tmdbId: number): Promise<number> {
    try {
      const tmdb = new (await import('@server/api/themoviedb')).default();
      const tvShow = await tmdb.getTvShow({ tvId: tmdbId });
      // Filter out season 0 (specials) when counting
      return (
        tvShow.seasons?.filter((season) => season.season_number > 0).length || 1
      );
    } catch (error) {
      logger.warn(
        `Failed to get season count for TMDB ID ${tmdbId}, assuming 1 season`,
        {
          label: 'Auto Request Service',
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );
      return 1; // Default to 1 season if we can't determine
    }
  }

  /**
   * Check if an item has any excluded genres
   */
  private async hasExcludedGenres(
    tmdbId: number,
    mediaType: 'movie' | 'tv',
    excludedGenres: number[]
  ): Promise<boolean> {
    try {
      if (mediaType === 'movie') {
        const movie = await this.tmdbAPI.getMovie({ movieId: tmdbId });
        return movie.genres.some((genre) => excludedGenres.includes(genre.id));
      } else {
        const tvShow = await this.tmdbAPI.getTvShow({ tvId: tmdbId });
        return tvShow.genres.some((genre) => excludedGenres.includes(genre.id));
      }
    } catch (error) {
      logger.warn(
        `Failed to check genres for TMDB ID ${tmdbId}, allowing item`,
        {
          label: 'Auto Request Service',
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );
      return false; // If we can't check genres, don't exclude the item
    }
  }

  /**
   * Check if an item has any excluded origin countries
   */
  private async hasExcludedCountries(
    tmdbId: number,
    mediaType: 'movie' | 'tv',
    excludedCountries: string[]
  ): Promise<boolean> {
    try {
      if (mediaType === 'movie') {
        const movie = await this.tmdbAPI.getMovie({ movieId: tmdbId });
        // Movies use production_countries array
        if (movie.production_countries) {
          return movie.production_countries.some((country) =>
            excludedCountries.includes(country.iso_3166_1)
          );
        }
        return false;
      } else {
        const tvShow = await this.tmdbAPI.getTvShow({ tvId: tmdbId });
        // TV shows use origin_country array
        if (tvShow.origin_country) {
          return tvShow.origin_country.some((country) =>
            excludedCountries.includes(country)
          );
        }
        return false;
      }
    } catch (error) {
      logger.warn(
        `Failed to check origin countries for TMDB ID ${tmdbId}, allowing item`,
        {
          label: 'Auto Request Service',
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );
      return false; // If we can't check countries, don't exclude the item
    }
  }

  /**
   * Check if a request was previously declined by this specific service user (DEPRECATED - use cached version)
   */
  private async wasPreviouslyDeclined(
    tmdbId: number,
    mediaType: 'movie' | 'tv',
    serviceUser: User
  ): Promise<boolean> {
    try {
      // OPTIMIZATION: Use cached requests if available
      if (syncCacheService.getIsInitialized()) {
        const cachedRequests = syncCacheService.getOverseerrRequests();
        return this.wasPreviouslyDeclinedFromCache(
          tmdbId,
          mediaType,
          serviceUser,
          cachedRequests
        );
      }

      // Fallback to fresh API call
      const overseerrAPI = this.getOverseerrAPI();

      // Get requests by this service user (use external ID if available)
      const requests = await overseerrAPI.getRequests({
        requestedBy: serviceUser.externalOverseerrId || serviceUser.id,
        take: 1000,
      });

      const existingDeclinedRequest = requests.results.find(
        (request) =>
          request.media.tmdbId === tmdbId &&
          request.type === mediaType &&
          request.status === 3 && // 3 = DECLINED status in Overseerr
          !request.is4k
      );

      return !!existingDeclinedRequest;
    } catch (error) {
      logger.warn(`Failed to check declined status for TMDB ID ${tmdbId}`, {
        label: 'Auto Request Service',
        tmdbId,
        mediaType,
        serviceUserId: serviceUser.id,
        serviceUserName: serviceUser.displayName,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false; // If we can't check, allow the request
    }
  }

  /**
   * Check if a request was previously declined by this specific service user using cached requests
   * OPTIMIZED: No API calls, uses pre-fetched data
   */
  private wasPreviouslyDeclinedFromCache(
    tmdbId: number,
    mediaType: 'movie' | 'tv',
    serviceUser: User,
    cachedRequests: OverseerrMediaRequest[]
  ): boolean {
    const serviceUserId = serviceUser.externalOverseerrId || serviceUser.id;

    const existingDeclinedRequest = cachedRequests.find(
      (request) =>
        request.media.tmdbId === tmdbId &&
        request.type === mediaType &&
        request.status === 3 && // 3 = DECLINED status in Overseerr
        !request.is4k &&
        request.requestedBy?.id === serviceUserId
    );

    return !!existingDeclinedRequest;
  }

  /**
   * Track a missing item request in the database
   */
  private async trackMissingItemRequest(data: {
    tmdbId: number;
    mediaType: 'movie' | 'tv';
    title: string;
    posterPath?: string;
    year?: number;
    collectionName: string;
    collectionSource: string;
    collectionSubtype?: string;
    requestService: string;
    requestMethod: string;
    requestStatus: 'pending' | 'approved' | 'declined' | 'available';
    requestedBy: User;
    requestedAt: Date;
  }): Promise<void> {
    try {
      const missingItemRequest = new MissingItemRequest({
        tmdbId: data.tmdbId,
        mediaType: data.mediaType,
        title: data.title,
        posterPath: data.posterPath,
        year: data.year,
        collectionName: data.collectionName,
        collectionSource: data.collectionSource,
        collectionSubtype: data.collectionSubtype,
        requestService: data.requestService,
        requestMethod: data.requestMethod,
        requestStatus: data.requestStatus,
        requestedBy: data.requestedBy,
        requestedById: data.requestedBy.id,
        requestedAt: data.requestedAt,
      });

      await this.missingItemRepository.save(missingItemRequest);

      logger.debug(
        `Tracked missing item request: ${data.title} (${data.mediaType})`,
        {
          label: 'Missing Item Tracking',
          tmdbId: data.tmdbId,
          collection: data.collectionName,
          source: data.collectionSource,
          service: data.requestService,
          method: data.requestMethod,
          status: data.requestStatus,
        }
      );
    } catch (error) {
      logger.warn(`Failed to track missing item request for ${data.title}`, {
        label: 'Missing Item Tracking',
        tmdbId: data.tmdbId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Fetch poster path from TMDB
   */
  private async fetchTmdbPoster(
    tmdbId: number,
    mediaType: 'movie' | 'tv'
  ): Promise<string | undefined> {
    try {
      const tmdb = new (await import('@server/api/themoviedb')).default();

      if (mediaType === 'movie') {
        const movie = await tmdb.getMovie({ movieId: tmdbId });
        return movie.poster_path || undefined;
      } else {
        const tvShow = await tmdb.getTvShow({ tvId: tmdbId });
        return tvShow.poster_path || undefined;
      }
    } catch (error) {
      logger.debug(`Failed to fetch TMDB poster for ${mediaType} ${tmdbId}`, {
        label: 'Auto Request Service',
        tmdbId,
        mediaType,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return undefined;
    }
  }

  /**
   * Sync status of missing item requests with Overseerr
   */
  public async syncMissingItemStatus(): Promise<void> {
    try {
      const repository = getRepository(MissingItemRequest);

      // Get all non-final status requests from the last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const activeRequests = await repository
        .createQueryBuilder('missing_item')
        .leftJoinAndSelect('missing_item.requestedBy', 'user')
        .where('missing_item.requestStatus IN (:...statuses)', {
          statuses: ['pending', 'approved', 'processing'],
        })
        .andWhere('missing_item.createdAt >= :date', { date: thirtyDaysAgo })
        .getMany();

      const overseerrAPI = this.getOverseerrAPI();
      let updated = 0;

      // OPTIMIZATION: Use cached requests if available, otherwise fetch fresh data
      let allRequestsResults: OverseerrMediaRequest[];

      if (syncCacheService.getIsInitialized()) {
        allRequestsResults = syncCacheService.getOverseerrRequests();

        logger.debug(
          `Using cached Overseerr requests for status sync (${allRequestsResults.length} requests)`,
          {
            label: 'Missing Item Status Sync',
            cachedRequests: allRequestsResults.length,
          }
        );
      } else {
        // Fallback to fresh API call if cache not available
        const allRequests = await overseerrAPI.getRequests({ take: 2000 });
        allRequestsResults = allRequests.results;

        logger.debug(
          `Cache not available for status sync, fetched fresh requests (${allRequestsResults.length} requests)`,
          {
            label: 'Missing Item Status Sync',
            freshRequests: allRequestsResults.length,
          }
        );
      }

      for (const missingItem of activeRequests) {
        try {
          // Find matching request in the cached results instead of making individual API calls
          const overseerrRequest = allRequestsResults.find(
            (req) =>
              req.media.tmdbId === missingItem.tmdbId &&
              req.type === missingItem.mediaType &&
              req.requestedBy?.id ===
                (missingItem.requestedBy?.externalOverseerrId ||
                  missingItem.requestedBy?.id)
          );

          if (overseerrRequest) {
            let newStatus:
              | 'pending'
              | 'approved'
              | 'declined'
              | 'available'
              | 'processing'
              | 'failed'
              | 'partially_available' = 'pending';

            // MediaRequestStatus enum values
            switch (overseerrRequest.status) {
              case 1: // PENDING
                newStatus = 'pending';
                break;
              case 2: // APPROVED
                newStatus = 'approved';
                break;
              case 3: // DECLINED
                newStatus = 'declined';
                break;
              case 4: // FAILED
                newStatus = 'failed';
                break;
              case 5: // COMPLETED
                // For completed requests, check if media is actually available
                newStatus = 'processing'; // Default to processing until we check media status
                break;
              default:
                // Log unknown status for debugging
                logger.warn(
                  `Unknown Overseerr request status: ${overseerrRequest.status}`,
                  {
                    label: 'Missing Item Status Sync',
                    tmdbId: missingItem.tmdbId,
                    requestId: overseerrRequest.id,
                    status: overseerrRequest.status,
                  }
                );
                newStatus = 'pending';
            }

            // For completed/approved requests, also check media availability status
            if (newStatus === 'processing' || newStatus === 'approved') {
              try {
                const media = await overseerrAPI.getMediaByTmdbId(
                  missingItem.tmdbId
                );
                if (media) {
                  // MediaStatus enum values
                  switch (media.status) {
                    case 5: // AVAILABLE
                      newStatus = 'available';
                      break;
                    case 4: // PARTIALLY_AVAILABLE
                      newStatus = 'partially_available';
                      break;
                    case 3: // PROCESSING
                      newStatus = 'processing';
                      break;
                    case 2: // PENDING
                      newStatus =
                        newStatus === 'approved' ? 'approved' : 'pending';
                      break;
                    default:
                      // Keep the request status if media status is unknown
                      break;
                  }
                }
              } catch (error) {
                // If we can't get media status, keep the request status
                logger.debug(
                  `Could not get media status for ${missingItem.title}`,
                  {
                    label: 'Missing Item Status Sync',
                    tmdbId: missingItem.tmdbId,
                    error:
                      error instanceof Error ? error.message : 'Unknown error',
                  }
                );
              }
            }

            if (newStatus !== missingItem.requestStatus) {
              await repository.update(missingItem.id, {
                requestStatus: newStatus,
                overseerrRequestId: overseerrRequest.id,
              });
              updated++;

              logger.debug(
                `Updated missing item status: ${missingItem.title} -> ${newStatus}`,
                {
                  label: 'Missing Item Status Sync',
                  tmdbId: missingItem.tmdbId,
                  oldStatus: missingItem.requestStatus,
                  newStatus,
                }
              );
            }
          }
        } catch (error) {
          logger.warn(`Failed to sync status for ${missingItem.title}`, {
            label: 'Missing Item Status Sync',
            tmdbId: missingItem.tmdbId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      if (updated > 0) {
        logger.info(
          `Missing item status sync completed: ${updated} items updated`,
          {
            label: 'Missing Item Status Sync',
          }
        );
      }
    } catch (error) {
      logger.error(`Failed to sync missing item status: ${error}`, {
        label: 'Missing Item Status Sync',
      });
    }
  }
}

// Export singleton instance
export const autoRequestService = new AutoRequestService();
