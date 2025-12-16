/**
 * Coming Soon feature type definitions
 */

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
  /** Maximum duration in seconds (optional, default: 300) */
  maxDuration?: number;
  /** Maximum file size in bytes (optional, default: 314572800 = 300 MB) */
  maxFileSize?: number;
}

/**
 * Metadata extracted from yt-dlp before download
 */
export interface VideoMetadata {
  /** Video duration in seconds */
  duration: number;
  /** Estimated file size in bytes */
  filesize?: number;
  /** Approximate file size in bytes (fallback if filesize not available) */
  filesize_approx?: number;
  /** Video title */
  title?: string;
  /** Video ID */
  id?: string;
}
