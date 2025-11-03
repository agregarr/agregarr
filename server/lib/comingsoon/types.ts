/**
 * Coming Soon feature type definitions
 */

export type ComingSoonCategory =
  | 'tv_future' // S01E01 hasn't aired yet
  | 'tv_aired' // S01E01 aired but not downloaded
  | 'tv_new' // Recently downloaded (past N days)
  | 'tv_returning' // Returning show - next season premiere hasn't aired yet
  | 'tv_released_monitored' // Released and downloaded (monitored), within 7-day window
  | 'tv_released_request' // Released and downloaded (not monitored), within 7-day window
  | 'movie_future' // Upcoming release
  | 'movie_released' // Released but not downloaded
  | 'movie_released_monitored' // Released and downloaded (monitored), within 7-day window
  | 'movie_released_request' // Released and downloaded (not monitored), within 7-day window
  | 'external_monitored' // In Radarr/Sonarr, waiting
  | 'external_request'; // NOT in Radarr/Sonarr

/**
 * Banner text types
 */
export type BannerTextType =
  | 'PREMIERES' // TV Future shows
  | 'EXPECTED' // Future movies
  | 'COMING SOON' // Aired/Released but not available
  | 'NEW' // Recently added
  | 'RETURNING' // Returning shows (next season)
  | 'TRENDING' // Trending content
  | 'REQUEST NEEDED' // Not monitored
  | 'AWAITING DOWNLOAD'; // Monitored but not downloaded yet

/**
 * Banner position on poster
 */
export type BannerPosition = 'top' | 'bottom';

/**
 * Date format options
 */
export type DateFormat = 'd mmm' | 'mmm d' | 'yyyy-mm-dd';

/**
 * Configuration for a single banner
 */
export interface BannerConfig {
  /** Banner text */
  text: string;
  /** Should show date (will use countdown/formatted date logic) */
  showDate: boolean;
  /** Position on poster */
  position: BannerPosition;
}

/**
 * Options for generating overlay posters
 */
export interface OverlayOptions {
  /** Original poster URL */
  posterUrl: string;
  /** Category of the Coming Soon item */
  category: ComingSoonCategory;
  /** Release/air date (ISO string) - if provided, may show countdown/date */
  releaseDate?: string;
  /** Hex color for overlay text */
  color: string;
  /** Date format for display (default: 'd mmm') */
  dateFormat?: DateFormat;
  /** Whether to capitalize date text (default: true) */
  capitalizeDates?: boolean;
  /** Whether the release date is an estimate (adds ~ prefix) */
  isEstimatedDate?: boolean;
  /** Season number for TV shows (used in returning show banners) */
  seasonNumber?: number;
}

/**
 * Options for creating placeholder files
 */
export interface PlaceholderOptions {
  /** TMDB ID for metadata matching */
  tmdbId: number;
  /** TVDB ID for TV shows */
  tvdbId?: number;
  /** Item title */
  title: string;
  /** Release year */
  year?: number;
  /** Media type */
  mediaType: 'movie' | 'tv';
  /** Plex library path where placeholder should be created */
  libraryPath: string;
  /** Path to downloaded trailer file */
  trailerPath: string;
}

/**
 * Result of placeholder creation
 */
export interface PlaceholderResult {
  /** Full path to created placeholder file */
  placeholderPath: string;
  /** Filename created */
  filename: string;
}

/**
 * Options for downloading YouTube trailers
 */
export interface TrailerDownloadOptions {
  /** Movie/show title */
  title: string;
  /** Release year */
  year?: number;
  /** Output path for downloaded file */
  outputPath: string;
  /** Maximum duration in seconds (optional, default: 180) */
  maxDuration?: number;
}

/**
 * Re-export ComingSoonSourceData as the unified type for categorization
 * This eliminates the duplicate UpcomingItem interface
 */
export type { ComingSoonSourceData } from '@server/lib/collections/core/types';

/**
 * Options for Coming Soon categorization
 */
export interface CategorizationOptions {
  /** Days to look ahead for upcoming content (default: 30) */
  futureDays?: number;
  /** Days to look back for recently added content (default: 7) */
  recentDays?: number;
  /** Include theatrical release dates for movies (default: false) */
  includeInCinemas?: boolean;
  /** Only show future content, exclude already aired/released (default: false) */
  futureOnly?: boolean;
}
