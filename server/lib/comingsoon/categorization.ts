/**
 * - TV: Future (S01E01 not aired), Aired (S01E01 aired, no file), New (possible future implementation)
 * - Movies: Future (upcoming release), Released (released but not downloaded)
 * - External: Monitored (in Radarr/Sonarr) vs Request Needed (not in Radarr/Sonarr)
 */

import logger from '@server/logger';
import type {
  BannerConfig,
  CategorizationOptions,
  ComingSoonCategory,
  ComingSoonSourceData,
} from './types';

/**
 * Get current date normalized to start of day (UTC)
 */
function getNow(): Date {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  return now;
}

/**
 * Parse ISO date string and normalize to start of day (UTC)
 */
function parseDate(isoString: string): Date {
  const date = new Date(isoString);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

/**
 * Calculate days since a past date (UTC)
 * Returns positive number for dates in the past, negative for future dates
 */
export function calculateDaysSince(date: Date | string): number {
  const targetDate =
    typeof date === 'string' ? parseDate(date) : new Date(date);
  targetDate.setUTCHours(0, 0, 0, 0);

  const today = getNow();
  const diffTime = today.getTime() - targetDate.getTime();
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Categorize a TV show based on air date and file status
 *
 * Logic:
 * 1. RELEASED (with real file, within 7 days of air date): TV show aired and has real file, air date within 7 days ago
 * 2. FUTURE: S01E01 hasn't aired yet (airDate > NOW, isNewSeries)
 * 3. RETURNING: Next season premiere hasn't aired yet (airDate > NOW, isReturning, seasonNumber > 1)
 * 4. AIRED: Episode has aired but no file (airDate <= NOW, !hasFile)
 * 5. NEW: Episode has file and was downloaded recently (hasFile, downloadedDate within recentDays)
 */
export function categorizeTVShow(
  item: ComingSoonSourceData,
  options: CategorizationOptions = {},
  releasedAt?: Date
): ComingSoonCategory | null {
  const { recentDays = 7, futureOnly = false } = options;

  // Must have air date
  if (!item.airDate) {
    logger.debug('TV show missing air date, skipping categorization', {
      label: 'Coming Soon Categorization',
      title: item.title,
    });
    return null;
  }

  const now = getNow();
  const airDate = parseDate(item.airDate);

  // Check if item has real file and aired within 7 days (releasedAt indicates real file exists)
  if (releasedAt && airDate <= now) {
    const daysSinceAirDate = calculateDaysSince(airDate);

    if (daysSinceAirDate <= 7) {
      // Item aired within last 7 days and has real file
      // Check if monitored to determine which category
      return item.monitored ? 'tv_released_monitored' : 'tv_released_request';
    }
    // If more than 7 days since air date, item should be excluded from collection
    return null;
  }

  // NEW: Recently downloaded
  if (item.hasFile && item.downloadedDate) {
    const downloadedDate = parseDate(item.downloadedDate);

    const cutoffDate = new Date(now);
    cutoffDate.setDate(cutoffDate.getDate() - recentDays);

    if (downloadedDate >= cutoffDate) {
      return 'tv_new';
    }
  }

  // FUTURE episodes (not aired yet)
  if (airDate > now) {
    // RETURNING: Season premiere for returning show (season > 1)
    if (item.isReturning) {
      logger.debug('Categorized as tv_returning', {
        label: 'Coming Soon Categorization',
        title: item.title,
        seasonNumber: item.seasonNumber,
        airDate: item.airDate,
        isReturning: item.isReturning,
      });
      return 'tv_returning';
    }
    // FUTURE: New series (S01E01)
    return 'tv_future';
  }

  // AIRED: Episode has aired but no file
  if (!futureOnly && !item.hasFile) {
    logger.debug('Categorized as tv_aired', {
      label: 'Coming Soon Categorization',
      title: item.title,
      seasonNumber: item.seasonNumber,
      airDate: item.airDate,
      isReturning: item.isReturning,
      hasFile: item.hasFile,
      airDateInPast: airDate <= now,
    });
    return 'tv_aired';
  }

  return null;
}

/**
 * 1. Digital release (preferred)
 * 2. Physical release
 * 3. Theatrical release (only if includeInCinemas is true)
 *
 * Returns the best available date based on priority
 */
export function determineMovieReleaseDate(
  item: ComingSoonSourceData,
  includeInCinemas = false
): { date: string; type: 'digital' | 'physical' | 'cinema' } | null {
  // Priority 1: Digital release (streaming/VOD) - Most important for users
  if (item.digitalRelease) {
    return { date: item.digitalRelease, type: 'digital' };
  }

  // Priority 2: Physical release (Blu-ray/DVD)
  if (item.physicalRelease) {
    return { date: item.physicalRelease, type: 'physical' };
  }

  // Priority 3: Theatrical release (only if explicitly enabled)
  if (includeInCinemas && item.inCinemas) {
    return { date: item.inCinemas, type: 'cinema' };
  }

  // Fallback: Generic releaseDate field
  if (item.releaseDate) {
    return { date: item.releaseDate, type: 'digital' };
  }

  return null;
}

/**
 * Categorize a movie based on release date and file status
 *
 * Logic:
 * 1. RELEASED (with real file, within 7 days of release date): Movie released and has real file, release date within 7 days ago
 * 2. FUTURE: Release date in future (releaseDate > NOW)
 * 3. RELEASED: Released but no file (releaseDate <= NOW, !hasFile)
 */
export function categorizeMovie(
  item: ComingSoonSourceData,
  options: CategorizationOptions = {},
  releasedAt?: Date
): ComingSoonCategory | null {
  const { includeInCinemas = false, futureOnly = false } = options;

  // Determine best release date
  const releaseInfo = determineMovieReleaseDate(item, includeInCinemas);

  if (!releaseInfo) {
    logger.debug('Movie missing release date, skipping categorization', {
      label: 'Coming Soon Categorization',
      title: item.title,
    });
    return null;
  }

  const now = getNow();
  const releaseDate = parseDate(releaseInfo.date);

  // Check if item has real file and released within 7 days (releasedAt indicates real file exists)
  if (releasedAt && releaseDate <= now) {
    const daysSinceReleaseDate = calculateDaysSince(releaseDate);

    if (daysSinceReleaseDate <= 7) {
      // Item released within last 7 days and has real file
      // Check if monitored to determine which category
      return item.monitored
        ? 'movie_released_monitored'
        : 'movie_released_request';
    }
    // If more than 7 days since release date, item should be excluded from collection
    return null;
  }

  // FUTURE: Upcoming release
  if (releaseDate > now) {
    return 'movie_future';
  }

  // RELEASED: Already released but no file
  if (!futureOnly && !item.hasFile) {
    return 'movie_released';
  }

  return null;
}

/**
 * Categorize external content based on monitored status
 *
 * 1. EXTERNAL_MONITORED: In Radarr/Sonarr, monitored, waiting for file
 * 2. EXTERNAL_REQUEST: NOT in Radarr/Sonarr (needs user request)
 *
 * Excludes items released more than 7 days ago (if not added to Radarr/Sonarr, remove from collection)
 */
export function categorizeTrending(
  item: ComingSoonSourceData
): ComingSoonCategory | null {
  const releaseDate = item.releaseDate || item.airDate;

  // Check if item was released more than 7 days ago
  if (releaseDate) {
    const daysSinceRelease = calculateDaysSince(releaseDate);

    // If released more than 7 days ago and still not monitored, exclude from collection
    if (daysSinceRelease > 7) {
      return null;
    }
  }

  // Categorize based on monitored status
  if (item.monitored) {
    return 'external_monitored';
  } else {
    return 'external_request';
  }
}

/**
 * Main categorization function - routes to appropriate categorizer
 */
export function categorizeItem(
  item: ComingSoonSourceData,
  options: CategorizationOptions = {},
  releasedAt?: Date
): ComingSoonCategory | null {
  // Trakt items that are monitored in Radarr/Sonarr should use the same
  // categorization logic as items from the 'monitored' subtype
  if (item.source === 'trakt' && item.monitored) {
    // Route to regular TV/Movie categorization
    if (item.mediaType === 'tv') {
      return categorizeTVShow(item, options, releasedAt);
    }
    if (item.mediaType === 'movie') {
      return categorizeMovie(item, options, releasedAt);
    }
  }

  // Non-monitored Trakt items use trending categorization (REQUEST NEEDED)
  if (item.source === 'trakt') {
    return categorizeTrending(item);
  }

  // TV shows
  if (item.mediaType === 'tv') {
    return categorizeTVShow(item, options, releasedAt);
  }

  // Movies
  if (item.mediaType === 'movie') {
    return categorizeMovie(item, options, releasedAt);
  }

  return null;
}

/**
 * Check if an item should be included based on its category and options
 */
export function shouldIncludeItem(
  category: ComingSoonCategory | null,
  options: CategorizationOptions = {}
): boolean {
  if (!category) {
    return false;
  }

  const { futureOnly = false } = options;

  // If futureOnly is enabled, exclude aired/released content
  if (futureOnly) {
    if (category === 'tv_aired' || category === 'movie_released') {
      return false;
    }
  }

  return true;
}

/**
 * Get banner text for a given category
 *
 * - tv_future → "PREMIERES"
 * - tv_aired → "COMING SOON"
 * - tv_new → "NEW"
 * - tv_returning → "RETURNING"
 * - movie_future → "EXPECTED"
 * - movie_released → "COMING SOON"
 * - external_monitored → "COMING SOON" and countdown
 * - external_request → "REQUEST NEEDED"
 */
export function getBannerText(
  category: ComingSoonCategory,
  hasDate = false
): string {
  switch (category) {
    case 'tv_future':
      return 'PREMIERES';
    case 'tv_aired':
      return 'COMING SOON';
    case 'tv_new':
      return 'NEW';
    case 'tv_returning':
      return 'RETURNING';
    case 'movie_future':
      return 'EXPECTED';
    case 'movie_released':
      return 'COMING SOON';
    case 'external_monitored':
      return hasDate ? 'TRENDING' : 'TRENDING';
    case 'external_request':
      return 'REQUEST NEEDED';
    default:
      return 'COMING SOON';
  }
}

/**
 * Get banner position for a given category
 *
 * - TV shows: bottom
 * - Movies: top
 */
export function getBannerPosition(
  category: ComingSoonCategory
): 'top' | 'bottom' {
  if (category.startsWith('tv_')) {
    return 'bottom';
  } else {
    return 'top';
  }
}

/**
 * Get overlay color for a given category
 *
 * - external_request: Darker Agregarr orange
 * - all others: red (default color from config)
 */
export function getOverlayColor(
  category: ComingSoonCategory,
  defaultColor = '#C21807'
): string {
  if (category === 'external_request') {
    return '#ea580c'; // Darker Agregarr orange for "REQUEST NEEDED"
  }
  return defaultColor;
}

/**
 * Check if category should show a date
 *
 * - tv_future: YES (air date)
 * - tv_aired: NO
 * - tv_new: NO
 * - tv_returning: YES (next season premiere date)
 * - movie_future: YES (release date)
 * - movie_released: NO
 * - external_monitored: YES (if available)
 * - external_request: NO
 */
export function shouldShowDate(category: ComingSoonCategory): boolean {
  return (
    category === 'tv_future' ||
    category === 'tv_returning' ||
    category === 'movie_future' ||
    category === 'external_monitored'
  );
}

/**
 * Get dual banner configuration for a given category
 *
 * Dual banner logic based on days until release:
 * - >30 days: Bottom only "RELEASING [DATE]"
 * - ≤30 days: Top "COMING SOON" + Bottom "RELEASING [DATE]"
 * - Request needed: Top "REQUEST NEEDED" + Bottom "RELEASING [DATE]"
 * - Aired/Released (waiting): Top "COMING SOON" + Bottom "AWAITING DOWNLOAD"
 * - Returning TV (S02+): Bottom only "SEASON N COMING [DATE]"
 * - Recently downloaded: Bottom only "NEW"
 * - Released with file (monitored): Bottom only "RELEASED [X DAYS AGO]" (days since release date)
 * - Released with file (not monitored): Top "REQUEST NEEDED" + Bottom "RELEASED [X DAYS AGO]" (days since release date)
 */
export function getDualBannerConfig(
  category: ComingSoonCategory,
  releaseDate: string | undefined,
  seasonNumber?: number
): BannerConfig[] {
  const banners: BannerConfig[] = [];

  // Calculate days until release for future items
  let daysUntil: number | null = null;
  if (releaseDate) {
    const now = getNow();
    const release = parseDate(releaseDate);
    const diffTime = release.getTime() - now.getTime();
    daysUntil = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  switch (category) {
    case 'tv_future':
    case 'movie_future':
    case 'external_monitored':
      // Future items: Banner logic based on days until release
      if (daysUntil !== null && daysUntil > 30) {
        // >30 days: Bottom only "RELEASING [DATE]"
        banners.push({ text: 'RELEASING', showDate: true, position: 'bottom' });
      } else if (daysUntil !== null && daysUntil >= 0) {
        // ≤30 days: Top "COMING SOON" + Bottom "RELEASING [DATE]"
        banners.push({ text: 'COMING SOON', showDate: false, position: 'top' });
        banners.push({ text: 'RELEASING', showDate: true, position: 'bottom' });
      }
      break;

    case 'tv_aired':
    case 'movie_released':
      // Aired/Released but no file, monitored → Top "COMING SOON" + Bottom "AWAITING DOWNLOAD"
      banners.push({ text: 'COMING SOON', showDate: false, position: 'top' });
      banners.push({
        text: 'AWAITING DOWNLOAD',
        showDate: false,
        position: 'bottom',
      });
      break;

    case 'tv_new':
      // Recently downloaded → Bottom only "NEW"
      banners.push({ text: 'NEW', showDate: false, position: 'bottom' });
      break;

    case 'tv_returning':
      // Returning (S02+) not aired, monitored → Bottom only "SEASON N [DATE/COUNTDOWN]"
      if (seasonNumber && seasonNumber > 1) {
        banners.push({
          text: `SEASON ${seasonNumber}`,
          showDate: true,
          position: 'bottom',
        });
      } else {
        // Fallback if season number not provided
        banners.push({ text: 'RETURNING', showDate: true, position: 'bottom' });
      }
      break;

    case 'external_request':
      // NOT in Radarr/Sonarr → Top "REQUEST NEEDED" + Bottom banner depends on release date
      banners.push({
        text: 'REQUEST NEEDED',
        showDate: false,
        position: 'top',
      });

      if (releaseDate) {
        const daysSinceRelease = calculateDaysSince(releaseDate);

        if (daysSinceRelease >= 0) {
          // Already released (today or in the past) → Show "RELEASED X DAYS AGO"
          if (daysSinceRelease === 0) {
            banners.push({
              text: 'RELEASED TODAY',
              showDate: false,
              position: 'bottom',
            });
          } else {
            banners.push({
              text: `RELEASED_DAYS_AGO:${daysSinceRelease}`,
              showDate: false,
              position: 'bottom',
            });
          }
        } else if (daysUntil !== null && daysUntil >= 0) {
          // Future release → Show "RELEASING [DATE]"
          banners.push({
            text: 'RELEASING',
            showDate: true,
            position: 'bottom',
          });
        }
      }
      break;

    case 'tv_released_monitored':
    case 'movie_released_monitored':
      // Released with real file (monitored) → Bottom only "RELEASED [X DAYS AGO]"
      // Calculate days since the actual release date, not when file was detected
      if (releaseDate) {
        const daysSinceRelease = calculateDaysSince(releaseDate);
        banners.push({
          text: `RELEASED_DAYS_AGO:${daysSinceRelease}`,
          showDate: false,
          position: 'bottom',
        });
      } else {
        banners.push({
          text: 'RELEASED',
          showDate: false,
          position: 'bottom',
        });
      }
      break;

    case 'tv_released_request':
    case 'movie_released_request':
      // Released with real file (not monitored) → Top "REQUEST NEEDED" + Bottom "RELEASED [X DAYS AGO]"
      // Calculate days since the actual release date, not when file was detected
      banners.push({
        text: 'REQUEST NEEDED',
        showDate: false,
        position: 'top',
      });
      if (releaseDate) {
        const daysSinceRelease = calculateDaysSince(releaseDate);
        banners.push({
          text: `RELEASED_DAYS_AGO:${daysSinceRelease}`,
          showDate: false,
          position: 'bottom',
        });
      } else {
        banners.push({
          text: 'RELEASED',
          showDate: false,
          position: 'bottom',
        });
      }
      break;

    default:
      banners.push({
        text: 'COMING SOON',
        showDate: false,
        position: 'bottom',
      });
  }

  return banners;
}
