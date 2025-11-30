import ImdbRatingsAPI from '@server/api/imdbRatings';
import RottenTomatoes from '@server/api/rottentomatoes';
import TheMovieDb from '@server/api/themoviedb';
import type { TmdbTvEpisodeResult } from '@server/api/themoviedb/interfaces';
import type { MissingItem } from '@server/lib/collections/core/types';
import type { CollectionConfig } from '@server/lib/settings';
import logger from '@server/logger';

/**
 * Results from filtering missing items
 */
export interface FilteredMissingItemsResult {
  /** Items that passed all filters */
  filteredItems: MissingItem[];
  /** IMDb ratings map for filtered items (tmdbId -> rating) */
  imdbRatingsMap: Map<number, number | null>;
  /** Rotten Tomatoes ratings map for filtered items (tmdbId -> critics score) */
  rtRatingsMap: Map<number, number | null>;
  /** Items filtered by year */
  yearFilteredItems: string[];
  /** Items filtered by low IMDb rating */
  lowRatedItems: string[];
  /** Items filtered by low Rotten Tomatoes rating */
  lowRatedRTItems: string[];
  /** Items filtered by excluded genres */
  excludedGenreItems: string[];
  /** Items filtered by excluded countries */
  excludedCountryItems: string[];
  /** Items filtered by excluded languages */
  excludedLanguageItems: string[];
  /** Items filtered by included genres (when mode is include) */
  includedGenreItems: string[];
  /** Items filtered by included countries (when mode is include) */
  includedCountryItems: string[];
  /** Items filtered by included languages (when mode is include) */
  includedLanguageItems: string[];
}

/**
 * Shared filtering service for missing items
 *
 * Provides common filtering logic for both auto-request and direct download services
 */
export class MissingItemFilterService {
  private tmdbAPI: TheMovieDb;
  private imdbRatingsAPI: ImdbRatingsAPI;
  private rtAPI: RottenTomatoes;

  constructor() {
    this.tmdbAPI = new TheMovieDb();
    this.imdbRatingsAPI = new ImdbRatingsAPI();
    this.rtAPI = new RottenTomatoes();
  }

  /**
   * Filter missing items based on collection configuration
   *
   * @param missingItems - Items to filter
   * @param config - Collection configuration with filter settings
   * @param serviceLabel - Label for logging (e.g., 'Auto Request Service', 'Direct Download Service')
   * @returns Filtered items with tracking arrays for logging
   */
  public async filterMissingItems(
    missingItems: MissingItem[],
    config: CollectionConfig,
    serviceLabel: string
  ): Promise<FilteredMissingItemsResult> {
    // Track filtered items for summary logging
    const yearFilteredItems: string[] = [];
    const lowRatedItems: string[] = [];
    const lowRatedRTItems: string[] = [];
    const excludedGenreItems: string[] = [];
    const excludedCountryItems: string[] = [];
    const excludedLanguageItems: string[] = [];
    const includedGenreItems: string[] = [];
    const includedCountryItems: string[] = [];
    const includedLanguageItems: string[] = [];

    // Step 1: Filter by media type and minimum year
    const yearFilteredMissingItems = missingItems.filter((item) => {
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
              label: serviceLabel,
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
          label: serviceLabel,
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

    // Step 2: Bulk fetch IMDb ratings if filter is enabled
    const imdbRatingsMap = new Map<number, number | null>(); // tmdbId -> rating
    if (config.minimumImdbRating && config.minimumImdbRating > 0) {
      await this.bulkFetchImdbRatings(
        yearFilteredMissingItems,
        imdbRatingsMap,
        config,
        serviceLabel
      );
    }

    // Step 2.5: Fetch Rotten Tomatoes ratings if filter is enabled
    const rtRatingsMap = new Map<number, number | null>(); // tmdbId -> critics score
    if (
      config.minimumRottenTomatoesRating &&
      config.minimumRottenTomatoesRating > 0
    ) {
      await this.fetchRTRatings(
        yearFilteredMissingItems,
        rtRatingsMap,
        config,
        serviceLabel
      );
    }

    // Step 3: Apply all filters (IMDb rating, RT rating, genres, countries)
    const fullyFilteredItems: MissingItem[] = [];

    for (const item of yearFilteredMissingItems) {
      // Check IMDb rating filter using cached ratings
      if (config.minimumImdbRating && config.minimumImdbRating > 0) {
        if (imdbRatingsMap.has(item.tmdbId)) {
          const rating = imdbRatingsMap.get(item.tmdbId);

          // If rating is null or undefined (no rating found), allow the item
          if (rating === null || rating === undefined) {
            logger.debug(
              `No IMDb rating found for ${item.title}, allowing item`,
              {
                label: serviceLabel,
                tmdbId: item.tmdbId,
                title: item.title,
              }
            );
          } else if (rating < config.minimumImdbRating) {
            // Rating exists but below threshold
            logger.debug(
              `${item.title} rating ${rating} below minimum ${config.minimumImdbRating}`,
              {
                label: serviceLabel,
                tmdbId: item.tmdbId,
                title: item.title,
                rating,
                minimumRating: config.minimumImdbRating,
              }
            );
            lowRatedItems.push(item.title);
            continue;
          }
          // else: rating >= minimum, allow the item (continue processing)
        }
        // If not in map (no IMDb ID found), allow the item (continue processing)
      }

      // Check Rotten Tomatoes rating filter using cached ratings
      if (
        config.minimumRottenTomatoesRating &&
        config.minimumRottenTomatoesRating > 0
      ) {
        if (rtRatingsMap.has(item.tmdbId)) {
          const score = rtRatingsMap.get(item.tmdbId);

          // If score is null or undefined (no rating found), allow the item
          if (score === null || score === undefined) {
            logger.debug(
              `No Rotten Tomatoes rating found for ${item.title}, allowing item`,
              {
                label: serviceLabel,
                tmdbId: item.tmdbId,
                title: item.title,
              }
            );
          } else if (score < config.minimumRottenTomatoesRating) {
            // Score exists but below threshold
            logger.debug(
              `${item.title} RT score ${score} below minimum ${config.minimumRottenTomatoesRating}`,
              {
                label: serviceLabel,
                tmdbId: item.tmdbId,
                title: item.title,
                score,
                minimumScore: config.minimumRottenTomatoesRating,
              }
            );
            lowRatedRTItems.push(item.title);
            continue;
          }
          // else: score >= minimum, allow the item (continue processing)
        }
        // If not in map (no RT rating found), allow the item (continue processing)
      }

      // Check genre filter (supports both include and exclude modes)
      const genreFilter = this.getGenreFilter(config);
      if (genreFilter && genreFilter.values.length > 0) {
        const itemGenres = await this.getItemGenres(
          item.tmdbId,
          item.mediaType
        );
        const hasMatch = itemGenres.some((genreId) =>
          genreFilter.values.includes(genreId)
        );

        if (genreFilter.mode === 'exclude' && hasMatch) {
          // EXCLUDE mode: skip items that have ANY of the selected genres
          excludedGenreItems.push(item.title);
          continue;
        }

        if (genreFilter.mode === 'include' && !hasMatch) {
          // INCLUDE mode: skip items that DON'T have ANY of the selected genres
          includedGenreItems.push(item.title);
          continue;
        }
      }

      // Check country filter (supports both include and exclude modes)
      const countryFilter = this.getCountryFilter(config);
      if (countryFilter && countryFilter.values.length > 0) {
        const itemCountries = await this.getItemCountries(
          item.tmdbId,
          item.mediaType
        );
        const hasMatch = itemCountries.some((country) =>
          countryFilter.values.includes(country)
        );

        if (countryFilter.mode === 'exclude' && hasMatch) {
          // EXCLUDE mode: skip items that have ANY of the selected countries
          excludedCountryItems.push(item.title);
          continue;
        }

        if (countryFilter.mode === 'include' && !hasMatch) {
          // INCLUDE mode: skip items that DON'T have ANY of the selected countries
          includedCountryItems.push(item.title);
          continue;
        }
      }

      // Check language filter (supports both include and exclude modes)
      const languageFilter = this.getLanguageFilter(config);
      if (languageFilter && languageFilter.values.length > 0) {
        const itemLanguages = await this.getItemLanguages(
          item.tmdbId,
          item.mediaType
        );
        const hasMatch = itemLanguages.some((lang) =>
          languageFilter.values.includes(lang)
        );

        if (languageFilter.mode === 'exclude' && hasMatch) {
          // EXCLUDE mode: skip items that have ANY of the selected languages
          excludedLanguageItems.push(item.title);
          continue;
        }

        if (languageFilter.mode === 'include' && !hasMatch) {
          // INCLUDE mode: skip items that DON'T have ANY of the selected languages
          includedLanguageItems.push(item.title);
          continue;
        }
      }

      // Item passed all filters
      fullyFilteredItems.push(item);
    }

    return {
      filteredItems: fullyFilteredItems,
      imdbRatingsMap,
      rtRatingsMap,
      yearFilteredItems,
      lowRatedItems,
      lowRatedRTItems,
      excludedGenreItems,
      excludedCountryItems,
      excludedLanguageItems,
      includedGenreItems,
      includedCountryItems,
      includedLanguageItems,
    };
  }

  /**
   * Bulk fetch IMDb ratings for missing items
   */
  private async bulkFetchImdbRatings(
    items: MissingItem[],
    ratingsMap: Map<number, number | null>,
    config: CollectionConfig,
    serviceLabel: string
  ): Promise<void> {
    try {
      // First, fetch all IMDb IDs from TMDB
      const tmdbToImdbMap = new Map<number, string>(); // tmdbId -> imdbId

      await Promise.all(
        items.map(async (item) => {
          try {
            let imdbId: string | undefined;
            if (item.mediaType === 'movie') {
              const movie = await this.tmdbAPI.getMovie({
                movieId: item.tmdbId,
              });
              imdbId = movie.imdb_id;
            } else if (item.mediaType === 'tv') {
              const tvShow = await this.tmdbAPI.getTvShow({
                tvId: item.tmdbId,
              });
              imdbId = tvShow.external_ids?.imdb_id;
            }

            if (imdbId) {
              tmdbToImdbMap.set(item.tmdbId, imdbId);
            }
          } catch (error) {
            logger.debug(
              `Failed to get IMDb ID for TMDB ${item.tmdbId}, will allow item`,
              {
                label: serviceLabel,
                error: error instanceof Error ? error.message : 'Unknown error',
              }
            );
          }
        })
      );

      // Bulk fetch all IMDb ratings
      if (tmdbToImdbMap.size > 0) {
        const imdbIds = Array.from(tmdbToImdbMap.values());
        logger.debug(`Bulk fetching ${imdbIds.length} IMDb ratings`, {
          label: serviceLabel,
          collection: config.name,
          count: imdbIds.length,
        });

        const ratings = await this.imdbRatingsAPI.getRatings(imdbIds);

        // Map ratings back to TMDB IDs
        const imdbToRating = new Map<string, number | null>();
        ratings.forEach((r) => {
          imdbToRating.set(r.imdbId, r.rating);
        });

        // Create final TMDB ID -> rating map
        tmdbToImdbMap.forEach((imdbId, tmdbId) => {
          const rating = imdbToRating.get(imdbId) ?? null;
          ratingsMap.set(tmdbId, rating);
        });

        logger.debug(`Cached ${ratingsMap.size} IMDb ratings for filtering`, {
          label: serviceLabel,
          collection: config.name,
          cachedCount: ratingsMap.size,
        });
      }
    } catch (error) {
      logger.warn(
        `Failed to bulk fetch IMDb ratings, will skip rating filter`,
        {
          label: serviceLabel,
          collection: config.name,
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );
    }
  }

  /**
   * Fetch Rotten Tomatoes ratings for missing items (via parallel title/year searches)
   */
  private async fetchRTRatings(
    items: MissingItem[],
    ratingsMap: Map<number, number | null>,
    config: CollectionConfig,
    serviceLabel: string
  ): Promise<void> {
    try {
      logger.debug(
        `Fetching Rotten Tomatoes ratings for ${items.length} items`,
        {
          label: serviceLabel,
          collection: config.name,
          count: items.length,
        }
      );

      // Fetch RT ratings for each item (RT uses title/year search)
      await Promise.all(
        items.map(async (item) => {
          try {
            let rtRating = null;

            if (item.mediaType === 'movie' && item.year) {
              const rating = await this.rtAPI.getMovieRatings(
                item.title,
                item.year
              );
              rtRating = rating?.criticsScore ?? null;
            } else if (item.mediaType === 'tv' && item.year) {
              const rating = await this.rtAPI.getTVRatings(
                item.title,
                item.year
              );
              rtRating = rating?.criticsScore ?? null;
            }

            ratingsMap.set(item.tmdbId, rtRating);

            if (rtRating !== null) {
              logger.debug(
                `Found RT rating ${rtRating} for ${item.title} (${item.year})`,
                {
                  label: serviceLabel,
                  tmdbId: item.tmdbId,
                  title: item.title,
                  year: item.year,
                  rating: rtRating,
                }
              );
            }
          } catch (error) {
            logger.debug(
              `Failed to get RT rating for ${item.title}, will allow item`,
              {
                label: serviceLabel,
                tmdbId: item.tmdbId,
                title: item.title,
                error: error instanceof Error ? error.message : 'Unknown error',
              }
            );
            // Set to null to indicate we tried but failed
            ratingsMap.set(item.tmdbId, null);
          }
        })
      );

      const ratingsFound = Array.from(ratingsMap.values()).filter(
        (r) => r !== null
      ).length;
      logger.debug(
        `Cached ${ratingsMap.size} RT ratings (${ratingsFound} found, ${
          ratingsMap.size - ratingsFound
        } not found)`,
        {
          label: serviceLabel,
          collection: config.name,
          totalCached: ratingsMap.size,
          ratingsFound,
          ratingsNotFound: ratingsMap.size - ratingsFound,
        }
      );
    } catch (error) {
      logger.warn(`Failed to fetch RT ratings, will skip rating filter`, {
        label: serviceLabel,
        collection: config.name,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Normalize genre filter config (backward compatible with old excludedGenres format)
   */
  private getGenreFilter(
    config: CollectionConfig
  ): { mode: 'exclude' | 'include'; values: number[] } | null {
    // New format takes precedence
    if (config.filterSettings?.genres) {
      return config.filterSettings.genres;
    }
    // Fall back to old format
    if (config.excludedGenres && config.excludedGenres.length > 0) {
      return { mode: 'exclude', values: config.excludedGenres };
    }
    return null;
  }

  /**
   * Normalize country filter config (backward compatible with old excludedCountries format)
   */
  private getCountryFilter(
    config: CollectionConfig
  ): { mode: 'exclude' | 'include'; values: string[] } | null {
    // New format takes precedence
    if (config.filterSettings?.countries) {
      return config.filterSettings.countries;
    }
    // Fall back to old format
    if (config.excludedCountries && config.excludedCountries.length > 0) {
      return { mode: 'exclude', values: config.excludedCountries };
    }
    return null;
  }

  /**
   * Normalize language filter config (backward compatible with old excludedLanguages format)
   */
  private getLanguageFilter(
    config: CollectionConfig
  ): { mode: 'exclude' | 'include'; values: string[] } | null {
    // New format takes precedence
    if (config.filterSettings?.languages) {
      return config.filterSettings.languages;
    }
    // Fall back to old format
    if (config.excludedLanguages && config.excludedLanguages.length > 0) {
      return { mode: 'exclude', values: config.excludedLanguages };
    }
    return null;
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
          label: 'Missing Item Filter Service',
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
          label: 'Missing Item Filter Service',
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );
      return false; // If we can't check countries, don't exclude the item
    }
  }

  /**
   * Check if an item has any excluded spoken languages
   */
  private async hasExcludedLanguages(
    tmdbId: number,
    mediaType: 'movie' | 'tv',
    excludedLanguages: string[]
  ): Promise<boolean> {
    try {
      if (mediaType === 'movie') {
        const movie = await this.tmdbAPI.getMovie({ movieId: tmdbId });
        // Movies use spoken_languages array
        if (movie.spoken_languages) {
          return movie.spoken_languages.some((language) =>
            excludedLanguages.includes(language.iso_639_1)
          );
        }
        return false;
      } else {
        const tvShow = await this.tmdbAPI.getTvShow({ tvId: tmdbId });
        // TV shows use spoken_languages array
        if (tvShow.spoken_languages) {
          return tvShow.spoken_languages.some((language) =>
            excludedLanguages.includes(language.iso_639_1)
          );
        }
        return false;
      }
    } catch (error) {
      logger.warn(
        `Failed to check spoken languages for TMDB ID ${tmdbId}, allowing item`,
        {
          label: 'Missing Item Filter Service',
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );
      return false; // If we can't check languages, don't exclude the item
    }
  }

  /**
   * Get item genres (for mode-based filtering)
   */
  private async getItemGenres(
    tmdbId: number,
    mediaType: 'movie' | 'tv'
  ): Promise<number[]> {
    try {
      if (mediaType === 'movie') {
        const movie = await this.tmdbAPI.getMovie({ movieId: tmdbId });
        return movie.genres.map((g) => g.id);
      } else {
        const tvShow = await this.tmdbAPI.getTvShow({ tvId: tmdbId });
        return tvShow.genres.map((g) => g.id);
      }
    } catch (error) {
      return []; // Return empty array if we can't fetch genres
    }
  }

  /**
   * Get item countries (for mode-based filtering)
   */
  private async getItemCountries(
    tmdbId: number,
    mediaType: 'movie' | 'tv'
  ): Promise<string[]> {
    try {
      if (mediaType === 'movie') {
        const movie = await this.tmdbAPI.getMovie({ movieId: tmdbId });
        return movie.production_countries
          ? movie.production_countries.map((c) => c.iso_3166_1)
          : [];
      } else {
        const tvShow = await this.tmdbAPI.getTvShow({ tvId: tmdbId });
        return tvShow.origin_country || [];
      }
    } catch (error) {
      return []; // Return empty array if we can't fetch countries
    }
  }

  /**
   * Get item languages (for mode-based filtering)
   */
  private async getItemLanguages(
    tmdbId: number,
    mediaType: 'movie' | 'tv'
  ): Promise<string[]> {
    try {
      if (mediaType === 'movie') {
        const movie = await this.tmdbAPI.getMovie({ movieId: tmdbId });
        return movie.spoken_languages
          ? movie.spoken_languages.map((l) => l.iso_639_1)
          : [];
      } else {
        const tvShow = await this.tmdbAPI.getTvShow({ tvId: tmdbId });
        return tvShow.spoken_languages
          ? tvShow.spoken_languages.map((l) => l.iso_639_1)
          : [];
      }
    } catch (error) {
      return []; // Return empty array if we can't fetch languages
    }
  }

  /**
   * Get the number of seasons for a TV show
   */
  public async getTvSeasonCount(tmdbId: number): Promise<number> {
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
          label: 'Missing Item Filter Service',
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );
      return 1; // Default to 1 season if we can't determine
    }
  }

  /**
   * Get all seasons with their air status
   * @returns Array of season objects with season number and whether they have aired
   */
  public async getTvSeasonsWithAirStatus(
    tmdbId: number
  ): Promise<{ seasonNumber: number; hasAired: boolean }[]> {
    try {
      const tmdb = new (await import('@server/api/themoviedb')).default();
      const tvShow = await tmdb.getTvShow({ tvId: tmdbId });

      if (!tvShow.seasons || tvShow.seasons.length === 0) {
        return [];
      }

      const now = new Date();
      const seasonsWithStatus: { seasonNumber: number; hasAired: boolean }[] =
        [];

      for (const season of tvShow.seasons) {
        // Skip season 0 (specials)
        if (season.season_number === 0) {
          continue;
        }

        // If season has an air_date, check if it's in the past
        if (season.air_date) {
          const seasonAirDate = new Date(season.air_date);
          seasonsWithStatus.push({
            seasonNumber: season.season_number,
            hasAired: seasonAirDate <= now,
          });
        } else {
          // If no air_date on season, we need to check individual episodes
          try {
            const seasonDetails = await tmdb.getTvSeason({
              tvId: tmdbId,
              seasonNumber: season.season_number,
            });

            // Check if ANY episode has aired
            const hasAnyEpisodeAired = seasonDetails.episodes.some(
              (ep: TmdbTvEpisodeResult) => {
                if (!ep.air_date) return false;
                const epAirDate = new Date(ep.air_date);
                return epAirDate <= now;
              }
            );

            seasonsWithStatus.push({
              seasonNumber: season.season_number,
              hasAired: hasAnyEpisodeAired,
            });
          } catch (error) {
            logger.warn(
              `Failed to get episode details for season ${season.season_number}, assuming not aired`,
              {
                label: 'Missing Item Filter Service',
                tmdbId,
                seasonNumber: season.season_number,
                error: error instanceof Error ? error.message : 'Unknown error',
              }
            );
            // If we can't determine, assume not aired (safer default)
            seasonsWithStatus.push({
              seasonNumber: season.season_number,
              hasAired: false,
            });
          }
        }
      }

      return seasonsWithStatus;
    } catch (error) {
      logger.warn(`Failed to get season air status for TMDB ID ${tmdbId}`, {
        label: 'Missing Item Filter Service',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }

  /**
   * Select which seasons to download based on grab order mode
   * @param tmdbId - TMDB ID of the TV show
   * @param limit - Number of seasons to grab (0 = all)
   * @param grabOrder - Order mode: 'first', 'latest', or 'airing'
   * @returns Array of season numbers in ascending order
   */
  public async selectSeasonsToGrab(
    tmdbId: number,
    limit: number,
    grabOrder: 'first' | 'latest' | 'airing' = 'first'
  ): Promise<number[]> {
    const seasonCount = await this.getTvSeasonCount(tmdbId);

    // If no limit, return all seasons (1 to seasonCount)
    if (limit === 0 || limit >= seasonCount) {
      return Array.from({ length: seasonCount }, (_, i) => i + 1);
    }

    // MODE 1: "first" - grab first N seasons (original behavior)
    if (grabOrder === 'first') {
      return Array.from({ length: limit }, (_, i) => i + 1);
    }

    // MODE 2: "latest" - grab N most recent seasons (including unreleased)
    if (grabOrder === 'latest') {
      const startSeason = Math.max(1, seasonCount - limit + 1);
      return Array.from({ length: limit }, (_, i) => startSeason + i);
    }

    // MODE 3: "airing" - grab N most recently AIRED seasons
    if (grabOrder === 'airing') {
      const seasonsWithStatus = await this.getTvSeasonsWithAirStatus(tmdbId);

      // Filter to only aired seasons
      const airedSeasons = seasonsWithStatus
        .filter((s) => s.hasAired)
        .map((s) => s.seasonNumber)
        .sort((a, b) => a - b); // Sort ascending

      if (airedSeasons.length === 0) {
        // No seasons have aired yet, fall back to first season
        logger.debug(
          `No aired seasons found for TMDB ${tmdbId}, falling back to season 1`,
          {
            label: 'Missing Item Filter Service',
          }
        );
        return [1];
      }

      // Take the last N aired seasons
      const selectedSeasons = airedSeasons.slice(-limit);

      return selectedSeasons; // Already sorted ascending
    }

    // Fallback (should never reach here)
    return Array.from({ length: limit }, (_, i) => i + 1);
  }

  /**
   * Log filtering summary for excluded items
   */
  public logFilteringSummary(
    result: FilteredMissingItemsResult,
    config: CollectionConfig,
    source: string
  ): void {
    const sourceLabel = source.charAt(0).toUpperCase() + source.slice(1);

    // Log summary of items excluded by genre
    if (result.excludedGenreItems.length > 0) {
      logger.info(`Items skipped due to excluded genres`, {
        label: `${sourceLabel} Collections`,
        collection: config.name,
        count: result.excludedGenreItems.length,
        titles: result.excludedGenreItems.slice(0, 10),
        ...(result.excludedGenreItems.length > 10 && {
          additionalCount: result.excludedGenreItems.length - 10,
        }),
      });
    }

    // Log summary of items excluded by country
    if (result.excludedCountryItems.length > 0) {
      logger.info(`Items skipped due to excluded countries`, {
        label: `${sourceLabel} Collections`,
        collection: config.name,
        count: result.excludedCountryItems.length,
        titles: result.excludedCountryItems.slice(0, 10),
        ...(result.excludedCountryItems.length > 10 && {
          additionalCount: result.excludedCountryItems.length - 10,
        }),
      });
    }

    // Log summary of items excluded by language
    if (result.excludedLanguageItems.length > 0) {
      logger.info(`Items skipped due to excluded languages`, {
        label: `${sourceLabel} Collections`,
        collection: config.name,
        count: result.excludedLanguageItems.length,
        titles: result.excludedLanguageItems.slice(0, 10),
        ...(result.excludedLanguageItems.length > 10 && {
          additionalCount: result.excludedLanguageItems.length - 10,
        }),
      });
    }

    // Log summary of items filtered by included genres (INCLUDE mode)
    if (result.includedGenreItems.length > 0) {
      logger.info(
        `Items skipped - did not match required genres (include mode)`,
        {
          label: `${sourceLabel} Collections`,
          collection: config.name,
          count: result.includedGenreItems.length,
          titles: result.includedGenreItems.slice(0, 10),
          ...(result.includedGenreItems.length > 10 && {
            additionalCount: result.includedGenreItems.length - 10,
          }),
        }
      );
    }

    // Log summary of items filtered by included countries (INCLUDE mode)
    if (result.includedCountryItems.length > 0) {
      logger.info(
        `Items skipped - did not match required countries (include mode)`,
        {
          label: `${sourceLabel} Collections`,
          collection: config.name,
          count: result.includedCountryItems.length,
          titles: result.includedCountryItems.slice(0, 10),
          ...(result.includedCountryItems.length > 10 && {
            additionalCount: result.includedCountryItems.length - 10,
          }),
        }
      );
    }

    // Log summary of items filtered by included languages (INCLUDE mode)
    if (result.includedLanguageItems.length > 0) {
      logger.info(
        `Items skipped - did not match required languages (include mode)`,
        {
          label: `${sourceLabel} Collections`,
          collection: config.name,
          count: result.includedLanguageItems.length,
          titles: result.includedLanguageItems.slice(0, 10),
          ...(result.includedLanguageItems.length > 10 && {
            additionalCount: result.includedLanguageItems.length - 10,
          }),
        }
      );
    }

    // Log summary of items excluded by IMDb rating
    if (result.lowRatedItems.length > 0) {
      logger.info(
        `Items skipped due to IMDb rating below ${config.minimumImdbRating}`,
        {
          label: `${sourceLabel} Collections`,
          collection: config.name,
          minimumRating: config.minimumImdbRating,
          count: result.lowRatedItems.length,
          titles: result.lowRatedItems.slice(0, 10),
          ...(result.lowRatedItems.length > 10 && {
            additionalCount: result.lowRatedItems.length - 10,
          }),
        }
      );
    }

    // Log summary of items excluded by Rotten Tomatoes rating
    if (result.lowRatedRTItems.length > 0) {
      logger.info(
        `Items skipped due to Rotten Tomatoes rating below ${config.minimumRottenTomatoesRating}`,
        {
          label: `${sourceLabel} Collections`,
          collection: config.name,
          minimumRating: config.minimumRottenTomatoesRating,
          count: result.lowRatedRTItems.length,
          titles: result.lowRatedRTItems.slice(0, 10),
          ...(result.lowRatedRTItems.length > 10 && {
            additionalCount: result.lowRatedRTItems.length - 10,
          }),
        }
      );
    }
  }
}

// Export singleton instance
export const missingItemFilterService = new MissingItemFilterService();
