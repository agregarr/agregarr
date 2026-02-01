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
  /** Rotten Tomatoes critics ratings map for filtered items (tmdbId -> critics score) */
  rtRatingsMap: Map<number, number | null>;
  /** Rotten Tomatoes audience ratings map for filtered items (tmdbId -> audience score) */
  rtAudienceRatingsMap: Map<number, number | null>;
  /** Items filtered by year */
  yearFilteredItems: string[];
  /** Items filtered by low IMDb rating */
  lowRatedItems: string[];
  /** Items filtered by low Rotten Tomatoes critics rating */
  lowRatedRTItems: string[];
  /** Items filtered by low Rotten Tomatoes audience rating */
  lowRatedRTAudienceItems: string[];
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
  /** Items filtered by excluded keywords */
  excludedKeywordItems: string[];
  /** Items filtered by included keywords (when mode is include) */
  includedKeywordItems: string[];
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
    const lowRatedRTAudienceItems: string[] = [];
    const excludedGenreItems: string[] = [];
    const excludedCountryItems: string[] = [];
    const excludedLanguageItems: string[] = [];
    const excludedKeywordItems: string[] = [];
    const includedGenreItems: string[] = [];
    const includedCountryItems: string[] = [];
    const includedLanguageItems: string[] = [];
    const includedKeywordItems: string[] = [];

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
    const rtAudienceRatingsMap = new Map<number, number | null>(); // tmdbId -> audience score
    if (
      (config.minimumRottenTomatoesRating &&
        config.minimumRottenTomatoesRating > 0) ||
      (config.minimumRottenTomatoesAudienceRating &&
        config.minimumRottenTomatoesAudienceRating > 0)
    ) {
      await this.fetchRTRatings(
        yearFilteredMissingItems,
        rtRatingsMap,
        rtAudienceRatingsMap,
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

          // If rating is null or undefined (no rating found), exclude the item
          if (rating === null || rating === undefined) {
            logger.debug(
              `No IMDb rating found for ${item.title}, excluding item`,
              {
                label: serviceLabel,
                tmdbId: item.tmdbId,
                title: item.title,
              }
            );
            lowRatedItems.push(item.title);
            continue;
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
        } else {
          // If not in map (no IMDb ID found), exclude the item
          logger.debug(`No IMDb ID found for ${item.title}, excluding item`, {
            label: serviceLabel,
            tmdbId: item.tmdbId,
            title: item.title,
          });
          lowRatedItems.push(item.title);
          continue;
        }
      }

      // Check Rotten Tomatoes critics rating filter using cached ratings
      if (
        config.minimumRottenTomatoesRating &&
        config.minimumRottenTomatoesRating > 0
      ) {
        if (rtRatingsMap.has(item.tmdbId)) {
          const score = rtRatingsMap.get(item.tmdbId);

          // If score is null or undefined (no rating found), exclude the item
          if (score === null || score === undefined) {
            logger.debug(
              `No Rotten Tomatoes critics rating found for ${item.title}, excluding item`,
              {
                label: serviceLabel,
                tmdbId: item.tmdbId,
                title: item.title,
              }
            );
            lowRatedRTItems.push(item.title);
            continue;
          } else if (score < config.minimumRottenTomatoesRating) {
            // Score exists but below threshold
            logger.debug(
              `${item.title} RT critics score ${score} below minimum ${config.minimumRottenTomatoesRating}`,
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
        } else {
          // If not in map (no RT rating found), exclude the item
          logger.debug(
            `No Rotten Tomatoes critics rating found for ${item.title}, excluding item`,
            {
              label: serviceLabel,
              tmdbId: item.tmdbId,
              title: item.title,
            }
          );
          lowRatedRTItems.push(item.title);
          continue;
        }
      }

      // Check Rotten Tomatoes audience rating filter using cached ratings
      if (
        config.minimumRottenTomatoesAudienceRating &&
        config.minimumRottenTomatoesAudienceRating > 0
      ) {
        if (rtAudienceRatingsMap.has(item.tmdbId)) {
          const score = rtAudienceRatingsMap.get(item.tmdbId);

          // If score is null or undefined (no rating found), exclude the item
          if (score === null || score === undefined) {
            logger.debug(
              `No Rotten Tomatoes audience rating found for ${item.title}, excluding item`,
              {
                label: serviceLabel,
                tmdbId: item.tmdbId,
                title: item.title,
              }
            );
            lowRatedRTAudienceItems.push(item.title);
            continue;
          } else if (score < config.minimumRottenTomatoesAudienceRating) {
            // Score exists but below threshold
            logger.debug(
              `${item.title} RT audience score ${score} below minimum ${config.minimumRottenTomatoesAudienceRating}`,
              {
                label: serviceLabel,
                tmdbId: item.tmdbId,
                title: item.title,
                score,
                minimumScore: config.minimumRottenTomatoesAudienceRating,
              }
            );
            lowRatedRTAudienceItems.push(item.title);
            continue;
          }
          // else: score >= minimum, allow the item (continue processing)
        } else {
          // If not in map (no RT rating found), exclude the item
          logger.debug(
            `No Rotten Tomatoes audience rating found for ${item.title}, excluding item`,
            {
              label: serviceLabel,
              tmdbId: item.tmdbId,
              title: item.title,
            }
          );
          lowRatedRTAudienceItems.push(item.title);
          continue;
        }
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

      // Check keyword filter (supports both include and exclude modes)
      const keywordFilter = this.getKeywordFilter(config);
      if (keywordFilter && keywordFilter.values.length > 0) {
        const itemKeywords = await this.getItemKeywords(
          item.tmdbId,
          item.mediaType
        );
        const hasMatch = itemKeywords.some((keywordId) =>
          keywordFilter.values.includes(keywordId)
        );

        if (keywordFilter.mode === 'exclude' && hasMatch) {
          // EXCLUDE mode: skip items that have ANY of the selected keywords
          excludedKeywordItems.push(item.title);
          continue;
        }

        if (keywordFilter.mode === 'include' && !hasMatch) {
          // INCLUDE mode: skip items that DON'T have ANY of the selected keywords
          includedKeywordItems.push(item.title);
          continue;
        }
      }

      // Item passed all filters
      fullyFilteredItems.push(item);
    }

    // Log filtering summary if any items were filtered out
    const totalFiltered = missingItems.length - fullyFilteredItems.length;
    if (totalFiltered > 0) {
      const filterReasons: string[] = [];

      if (yearFilteredItems.length > 0) {
        filterReasons.push(`${yearFilteredItems.length} due to year`);
      }
      if (lowRatedItems.length > 0) {
        filterReasons.push(`${lowRatedItems.length} due to IMDb rating`);
      }
      if (lowRatedRTItems.length > 0) {
        filterReasons.push(
          `${lowRatedRTItems.length} due to RT critics rating`
        );
      }
      if (lowRatedRTAudienceItems.length > 0) {
        filterReasons.push(
          `${lowRatedRTAudienceItems.length} due to RT audience rating`
        );
      }
      if (excludedGenreItems.length > 0) {
        filterReasons.push(
          `${excludedGenreItems.length} due to excluded genres`
        );
      }
      if (excludedCountryItems.length > 0) {
        filterReasons.push(
          `${excludedCountryItems.length} due to excluded countries`
        );
      }
      if (excludedLanguageItems.length > 0) {
        filterReasons.push(
          `${excludedLanguageItems.length} due to excluded languages`
        );
      }
      if (includedGenreItems.length > 0) {
        filterReasons.push(
          `${includedGenreItems.length} due to included genres filter`
        );
      }
      if (includedCountryItems.length > 0) {
        filterReasons.push(
          `${includedCountryItems.length} due to included countries filter`
        );
      }
      if (includedLanguageItems.length > 0) {
        filterReasons.push(
          `${includedLanguageItems.length} due to included languages filter`
        );
      }
      if (excludedKeywordItems.length > 0) {
        filterReasons.push(
          `${excludedKeywordItems.length} due to excluded keywords`
        );
      }
      if (includedKeywordItems.length > 0) {
        filterReasons.push(
          `${includedKeywordItems.length} due to included keywords filter`
        );
      }

      logger.info(
        `Filtered ${totalFiltered}/${
          missingItems.length
        } items: ${filterReasons.join(', ')}`,
        {
          label: serviceLabel,
          originalCount: missingItems.length,
          filteredCount: fullyFilteredItems.length,
          removedCount: totalFiltered,
        }
      );
    }

    return {
      filteredItems: fullyFilteredItems,
      imdbRatingsMap,
      rtRatingsMap,
      rtAudienceRatingsMap,
      yearFilteredItems,
      lowRatedItems,
      lowRatedRTItems,
      lowRatedRTAudienceItems,
      excludedGenreItems,
      excludedCountryItems,
      excludedLanguageItems,
      includedGenreItems,
      includedCountryItems,
      includedLanguageItems,
      excludedKeywordItems,
      includedKeywordItems,
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
    audienceRatingsMap: Map<number, number | null>,
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
            let audienceScore = null;

            if (item.mediaType === 'movie' && item.year) {
              const rating = await this.rtAPI.getMovieRatings(
                item.title,
                item.year
              );
              rtRating = rating?.criticsScore ?? null;
              audienceScore = rating?.audienceScore ?? null;
              audienceRatingsMap.set(item.tmdbId, audienceScore);
            } else if (item.mediaType === 'tv' && item.year) {
              const rating = await this.rtAPI.getTVRatings(
                item.title,
                item.year
              );
              rtRating = rating?.criticsScore ?? null;
              audienceScore = rating?.audienceScore ?? null;
              audienceRatingsMap.set(item.tmdbId, audienceScore);
            }

            ratingsMap.set(item.tmdbId, rtRating);

            if (rtRating !== null) {
              logger.debug(
                `Found RT critics score ${rtRating} for ${item.title} (${item.year})`,
                {
                  label: serviceLabel,
                  tmdbId: item.tmdbId,
                  title: item.title,
                  year: item.year,
                  criticsScore: rtRating,
                }
              );
            }

            if (audienceScore !== null) {
              logger.debug(
                `Found RT audience score ${audienceScore} for ${item.title} (${item.year})`,
                {
                  label: serviceLabel,
                  tmdbId: item.tmdbId,
                  title: item.title,
                  year: item.year,
                  audienceScore: audienceScore,
                }
              );
            }
          } catch (error) {
            logger.debug(
              `Failed to get RT ratings for ${item.title}, will allow item`,
              {
                label: serviceLabel,
                tmdbId: item.tmdbId,
                title: item.title,
                error: error instanceof Error ? error.message : 'Unknown error',
              }
            );
            // Set to null to indicate we tried but failed
            ratingsMap.set(item.tmdbId, null);
            audienceRatingsMap.set(item.tmdbId, null);
          }
        })
      );

      const criticsRatingsFound = Array.from(ratingsMap.values()).filter(
        (r) => r !== null
      ).length;
      const audienceRatingsFound = Array.from(
        audienceRatingsMap.values()
      ).filter((r) => r !== null).length;
      logger.debug(
        `Cached ${
          ratingsMap.size
        } RT ratings - Critics: ${criticsRatingsFound} found, ${
          ratingsMap.size - criticsRatingsFound
        } not found | Audience: ${audienceRatingsFound} found, ${
          audienceRatingsMap.size - audienceRatingsFound
        } not found`,
        {
          label: serviceLabel,
          collection: config.name,
          totalCached: ratingsMap.size,
          criticsRatingsFound,
          criticsRatingsNotFound: ratingsMap.size - criticsRatingsFound,
          audienceRatingsFound,
          audienceRatingsNotFound:
            audienceRatingsMap.size - audienceRatingsFound,
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
   * Get genre filter config
   */
  private getGenreFilter(
    config: CollectionConfig
  ): { mode: 'exclude' | 'include'; values: number[] } | null {
    return config.filterSettings?.genres || null;
  }

  /**
   * Get country filter config
   */
  private getCountryFilter(
    config: CollectionConfig
  ): { mode: 'exclude' | 'include'; values: string[] } | null {
    return config.filterSettings?.countries || null;
  }

  /**
   * Get language filter config
   */
  private getLanguageFilter(
    config: CollectionConfig
  ): { mode: 'exclude' | 'include'; values: string[] } | null {
    return config.filterSettings?.languages || null;
  }

  /**
   * Get keyword filter config
   */
  private getKeywordFilter(
    config: CollectionConfig
  ): { mode: 'exclude' | 'include'; values: number[] } | null {
    return config.filterSettings?.keywords || null;
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
   * Get item keywords (for mode-based filtering)
   */
  private async getItemKeywords(
    tmdbId: number,
    mediaType: 'movie' | 'tv'
  ): Promise<number[]> {
    try {
      if (mediaType === 'movie') {
        const movie = await this.tmdbAPI.getMovie({ movieId: tmdbId });
        return movie.keywords?.keywords
          ? movie.keywords.keywords.map((k) => k.id)
          : [];
      } else {
        const tvShow = await this.tmdbAPI.getTvShow({ tvId: tmdbId });
        return tvShow.keywords?.results
          ? tvShow.keywords.results.map((k) => k.id)
          : [];
      }
    } catch (error) {
      return []; // Return empty array if we can't fetch keywords
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

    // Log summary of items excluded by keyword
    if (result.excludedKeywordItems.length > 0) {
      logger.info(`Items skipped due to excluded keywords`, {
        label: `${sourceLabel} Collections`,
        collection: config.name,
        count: result.excludedKeywordItems.length,
        titles: result.excludedKeywordItems.slice(0, 10),
        ...(result.excludedKeywordItems.length > 10 && {
          additionalCount: result.excludedKeywordItems.length - 10,
        }),
      });
    }

    // Log summary of items filtered by included keywords (INCLUDE mode)
    if (result.includedKeywordItems.length > 0) {
      logger.info(
        `Items skipped - did not match required keywords (include mode)`,
        {
          label: `${sourceLabel} Collections`,
          collection: config.name,
          count: result.includedKeywordItems.length,
          titles: result.includedKeywordItems.slice(0, 10),
          ...(result.includedKeywordItems.length > 10 && {
            additionalCount: result.includedKeywordItems.length - 10,
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

    // Log summary of items excluded by Rotten Tomatoes critics rating
    if (result.lowRatedRTItems.length > 0) {
      logger.info(
        `Items skipped due to Rotten Tomatoes critics rating below ${config.minimumRottenTomatoesRating}`,
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

    // Log summary of items excluded by Rotten Tomatoes audience rating
    if (result.lowRatedRTAudienceItems.length > 0) {
      logger.info(
        `Items skipped due to Rotten Tomatoes audience rating below ${config.minimumRottenTomatoesAudienceRating}`,
        {
          label: `${sourceLabel} Collections`,
          collection: config.name,
          minimumRating: config.minimumRottenTomatoesAudienceRating,
          count: result.lowRatedRTAudienceItems.length,
          titles: result.lowRatedRTAudienceItems.slice(0, 10),
          ...(result.lowRatedRTAudienceItems.length > 10 && {
            additionalCount: result.lowRatedRTAudienceItems.length - 10,
          }),
        }
      );
    }
  }
}

// Export singleton instance
export const missingItemFilterService = new MissingItemFilterService();
