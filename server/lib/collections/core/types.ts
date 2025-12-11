import type {
  OverseerrMediaRequest,
  OverseerrUser,
} from '@server/api/overseerr';
import type PlexAPI from '@server/api/plexapi';
import type { PlexCollectionItem } from '@server/api/plexapi';
import type { User } from '@server/entity/User';
import type { TemplateContext } from '@server/lib/collections/utils/TemplateEngine';
import type { CollectionConfig } from '@server/lib/settings';
import type { LibraryItemsCache } from './CollectionUtilities';

/**
 * Standard interface for collection items across all sources
 */
export interface CollectionItem {
  /** Plex rating key (unique identifier within Plex) */
  ratingKey: string;
  /** Display title of the item */
  title: string;
  /** Media type (movie or tv) */
  type: 'movie' | 'tv';
  /** Release year for movies, first air year for TV */
  year?: number;
  /** Optional TMDB ID for external identification */
  tmdbId?: number;
  /** Optional IMDb ID for external identification and rating lookups */
  imdbId?: string;
  /** Optional IMDb rating (0-10 scale) for sorting */
  imdbRating?: number;
  /** Optional poster URL from source (e.g., AniList coverImage) */
  posterUrl?: string;
  /** Optional additional metadata */
  metadata?: Record<string, unknown>;
  /** Episode-specific information (for individual episodes in collections) */
  episodeInfo?: {
    season?: number;
    episode?: number;
    episodeTitle?: string;
  };
}

/**
 * Plex label structure
 */
export interface PlexLabel {
  /** Label tag/name */
  tag: string;
  /** Additional metadata */
  [key: string]: unknown;
}

/**
 * Plex collection data structure
 */
export interface PlexCollection {
  /** Collection rating key */
  ratingKey: string;
  /** Collection title */
  title: string;
  /** Collection type */
  type: string;
  /** Library key (section ID) this collection belongs to */
  libraryKey?: string;
  /** Library name this collection belongs to */
  libraryName?: string;
  /** Collection summary/description */
  summary?: string;
  /** Collection thumb/poster */
  thumb?: string;
  /** Collection art */
  art?: string;
  /** Number of children in collection */
  childCount?: number;
  /** Collection labels */
  labels?: (string | PlexLabel)[];
  /** Collection items */
  children?: PlexCollectionItem[];
  /** Additional metadata */
  [key: string]: unknown;
}

/**
 * Individual item within a Plex collection
 */
/**
 * Use API type directly for Plex collection items
 */
export type { PlexCollectionItem };
/**
 * Use API types directly
 */
export type { OverseerrUser, OverseerrMediaRequest };

/**
 * Result of a collection sync operation
 */
export interface SyncResult {
  /** Number of collections created */
  created: number;
  /** Number of collections updated */
  updated: number;
  /** Optional error information */
  error?: string;
  /** Optional additional details */
  details?: Record<string, unknown>;
}

/**
 * Result of collection processing with detailed statistics
 */
export interface ProcessingResult extends SyncResult {
  /** Items that were processed successfully */
  processedItems: number;
  /** Items that were skipped (already exist, filtered out, etc.) */
  skippedItems: number;
  /** Items that failed to process */
  failedItems: number;
  /** Total items attempted */
  totalItems: number;
}

/**
 * Collection visibility configuration
 */
export interface CollectionVisibilityConfig {
  /** Show on shared users' home screens */
  usersHome: boolean;
  /** Show on server owner's home screen */
  serverOwnerHome: boolean;
  /** Show in library recommended section */
  libraryRecommended: boolean;
  /** Whether collection/hub is currently active (time restrictions met) */
  isActive: boolean;
}

/**
 * Media type options for collections
 */
export type MediaType = 'movie' | 'tv' | 'both';

/**
 * Collection source types
 */
export type CollectionSource =
  | 'overseerr'
  | 'tautulli'
  | 'trakt'
  | 'tmdb'
  | 'imdb'
  | 'letterboxd'
  | 'mdblist'
 | 'networks'
 | 'originals'
 | 'anilist'
 | 'myanimelist'
  | 'plex'
  | 'radarrtag'
  | 'sonarrtag'
  | 'comingsoon'
  | 'filtered_hub'
  | 'multi-source';

/**
 * Source types that can produce missing items for placeholders/auto-download
 * (excludes meta-sources like overseerr, tautulli, comingsoon, filtered_hub, multi-source)
 */
export type ItemProducingSource =
  | 'radarr'
  | 'sonarr'
  | 'trakt'
  | 'tmdb'
  | 'imdb'
  | 'letterboxd'
  | 'mdblist'
  | 'anilist'
  | 'myanimelist'
  | 'networks'
  | 'originals'
  | 'radarrtag'
  | 'sonarrtag';

/**
 * Configuration for creating/updating collections in Plex
 */
export interface CollectionCreateConfig {
  /** Items to include in the collection */
  items: CollectionItem[];
  /** Media type filter */
  mediaType: 'movie' | 'tv';
  /** Collection name */
  name: string;
  /** Visibility setting */
  visibility: CollectionVisibilityConfig;
  /** Custom label for identification */
  customLabel?: string;
  /** Custom poster image path */
  customPoster?: string | Record<string, string>;
  /** User context for the collection */
  user: Partial<User>;
  /** Whether this is a source-specific collection (Trakt, Tautulli, etc.) */
  isSourceCollection?: boolean;
}

/**
 * Result of collection creation/update operation
 */
export interface CollectionOperationResult {
  /** Number of collections created */
  created: number;
  /** Number of collections updated */
  updated: number;
  /** Plex rating key of the collection (if created/updated) */
  collectionRatingKey?: string;
  /** Number of items in the collection */
  itemCount: number;
  /** Optional update statistics */
  stats?: {
    added: number;
    removed: number;
    reordered: boolean;
  };
  /** Optional error information */
  error?: string;
}

/**
 * Parameters for auto-request functionality
 */
export interface AutoRequestConfig {
  /** Enable auto-requesting for movies */
  searchMissingMovies: boolean;
  /** Enable auto-requesting for TV shows */
  searchMissingTV: boolean;
  /** Auto-approve movie requests */
  autoApproveMovies: boolean;
  /** Auto-approve TV show requests */
  autoApproveTV: boolean;
  /** Maximum seasons to auto-approve for TV shows */
  maxSeasonsToRequest: number;
  /** Limit each TV show to only the first X seasons */
  seasonsPerShowLimit?: number;
  /** Order to grab seasons: first, latest, or airing */
  seasonGrabOrder?: 'first' | 'latest' | 'airing';
}

/**
 * Item missing from Plex that could be auto-requested or turned into a placeholder
 */
export interface MissingItem {
  /** TMDB ID */
  tmdbId: number;
  /** TVDB ID (primarily for anime) */
  tvdbId?: number;
  /** Media type */
  mediaType: 'movie' | 'tv';
  /** Display title */
  title: string;
  /** Release year for movies, first air year for TV */
  year?: number;
  /** Position in the original source list (1-based) */
  originalPosition: number;
  /** Optional additional metadata */
  metadata?: Record<string, unknown>;
  // Placeholder-related fields (for createPlaceholdersForMissing feature)
  /** Generic/fallback release date (ISO string) */
  releaseDate?: string;
  /** Digital/streaming release date (ISO string) - Priority 1 for movies */
  digitalRelease?: string;
  /** Blu-ray/DVD release date (ISO string) - Priority 2 for movies */
  physicalRelease?: string;
  /** Theatrical release date (ISO string) - Priority 3 for movies */
  inCinemas?: string;
  /** Episode air date for TV shows (ISO string) */
  airDate?: string;
  /** True if releaseDate is an estimate (e.g., theatrical + 3 months) */
  isEstimatedDate?: boolean;
  /** Season number for TV shows */
  seasonNumber?: number;
  /** Episode number for TV shows */
  episodeNumber?: number;
  /** Whether item is monitored in Radarr/Sonarr */
  monitored?: boolean;
  /** Source of the missing item data - REQUIRED for proper tracking */
  source: ItemProducingSource;
}

/**
 * Result of auto-request processing
 */
export interface AutoRequestResult {
  /** Number of requests created with auto-approval */
  autoApproved: number;
  /** Number of requests created requiring manual approval */
  manualApproval: number;
  /** Number of items that already had requests */
  alreadyRequested: number;
  /** Number of items skipped (declined previously, etc.) */
  skipped: number;
  /** Total items processed */
  total: number;
}

/**
 * Base interface that all collection sync classes should implement
 */
export interface CollectionSyncInterface {
  /**
   * Process collections for this source
   *
   * @param collectionConfigs - Collection configurations to process
   * @param plexClient - Plex API client
   * @param allCollections - Existing collections from Plex
   * @param processedCollectionKeys - Set to track processed collection keys
   * @returns Promise resolving to sync result
   */
  processCollections(
    collectionConfigs: CollectionConfig[],
    plexClient: PlexAPI,
    allCollections: PlexCollection[],
    processedCollectionKeys?: Set<string>,
    libraryCache?: LibraryItemsCache
  ): Promise<SyncResult>;
}

/**
 * Filtering statistics for data processing
 */
export interface FilteringStats {
  /** Original number of items before filtering */
  original: number;
  /** Number of items after initial filtering */
  filtered: number;
  /** Number of items removed during filtering */
  removed: number;
  /** Optional breakdown of removal reasons */
  removalReasons?: Record<string, number>;
}

/**
 * Template context for name generation
 */
export interface TemplateContextBase {
  /** Media type for the collection */
  mediaType?: 'movie' | 'tv' | 'both';
  /** Collection source type */
  source?: CollectionSource;
  /** Time range in days */
  days?: number;
  /** Custom days parameter */
  customdays?: number;
  /** Server name */
  servername?: string;
  /** Collection subtype label */
  subtype?: string;
}

/**
 * Source-specific template contexts for type safety
 */

export interface TraktTemplateContext extends TemplateContext {
  /** Trakt-specific stat type */
  statType?: 'trending' | 'popular' | 'watched' | 'custom';
}

export interface MDBListTemplateContext extends TemplateContext {
  /** MDBList-specific list type */
  listType?: 'top' | 'user_lists' | 'custom';
}

export interface TautulliTemplateContext extends TemplateContext {
  /** Tautulli-specific stat type */
  statType?: 'plays' | 'duration' | 'users';
  /** Number of custom days for Tautulli collections */
  customdays?: number;
}

export interface OverseerrTemplateContext extends TemplateContext {
  /** Overseerr-specific stat type */
  statType?: 'requests' | 'users' | 'recent';
  /** User context for user-specific collections */
  username?: string;
  displayName?: string;
  nickname?: string;
}

export interface TmdbTemplateContext extends TemplateContext {
  /** TMDB-specific stat type */
  statType?: 'popular' | 'top_rated' | 'trending' | 'now_playing' | 'upcoming';
}

export interface TmdbFranchiseTemplateContext extends TemplateContext {
  franchiseName: string;
  franchiseId: number;
  movieCount: number;
  mediaType: 'movie';
}

export interface ImdbTemplateContext extends TemplateContext {
  /** IMDB-specific stat type */
  statType?: 'top_250' | 'popular' | 'most_popular' | 'custom';
}

export interface LetterboxdTemplateContext extends TemplateContext {
  /** Letterboxd list URL */
  listUrl: string;
  /** Letterboxd list name extracted from URL */
  listName: string;
}

export interface NetworksTemplateContext extends TemplateContext {
  /** Streaming platform */
  platform?: string;
  /** Network-specific stat type */
  statType?: 'top_10';
}

export interface OriginalsTemplateContext extends TemplateContext {
  /** Streaming platform */
  platform?: string;
}

export interface RadarrTagTemplateContext extends TemplateContext {
  /** Collection source type */
  source?: 'radarrtag';
  /** Tag label from Radarr */
  tagLabel?: string;
}

export interface SonarrTagTemplateContext extends TemplateContext {
  /** Collection source type */
  source?: 'sonarrtag';
  /** Tag label from Sonarr */
  tagLabel?: string;
}

export interface ComingSoonTemplateContext extends TemplateContext {
  /** Collection source type */
  source?: 'comingsoon';
  /** Coming Soon specific stat type */
  statType?: 'monitored' | 'trakt_anticipated' | 'tmdb_anticipated';
}

export interface RecentlyAddedTemplateContext extends TemplateContext {
  /** Collection source type */
  source?: 'recently_added';
}

/**
 * Union type for all possible template contexts
 */
export type SourceTemplateContext =
  | TraktTemplateContext
  | MDBListTemplateContext
  | TautulliTemplateContext
  | OverseerrTemplateContext
  | TmdbTemplateContext
  | TmdbFranchiseTemplateContext
  | ImdbTemplateContext
  | LetterboxdTemplateContext
  | NetworksTemplateContext
  | OriginalsTemplateContext
  | RadarrTagTemplateContext
  | SonarrTagTemplateContext
  | ComingSoonTemplateContext
  | RecentlyAddedTemplateContext;

/**
 * Source data interfaces for fetchSourceData return types
 */

export type TraktSourceData =
  // Wrapped format from mixed media endpoints
  | {
      movie?: {
        ids: { tmdb: number };
        title: string;
        year?: number;
      };
      show?: {
        ids: { tmdb: number };
        title: string;
        year?: number;
      };
      episode?: {
        season: number;
        number: number;
        title: string;
        ids: {
          trakt: number;
          tvdb: number;
          tmdb: number;
        };
        show?: {
          ids: { tmdb: number };
          title: string;
          year?: number;
        };
      };
    }
  // Raw format from media-specific endpoints
  | {
      title: string;
      year: number;
      ids: {
        trakt: number;
        slug: string;
        tvdb?: number;
        imdb?: string;
        tmdb: number;
        tvrage?: number;
        anilist?: number;
      };
    };

export interface MDBListSourceData {
  item: {
    id: number; // TMDB ID
    title: string;
    mediatype: 'movie' | 'show';
    rank?: number;
    release_year?: number;
  };
  mediaType: 'movie' | 'tv';
}

export interface TautulliSourceData {
  rating_key?: string;
  grandparent_rating_key?: string;
  title?: string;
  grandparent_title?: string;
  total_plays?: number;
  plays?: number;
  media_type?: string;
  users_watched?: string | number; // Unique viewer count (string for most_watched, number for most_popular)
  year?: number;
  tmdb_id?: number;
  duration?: number;
  last_played?: number;
}

export interface OverseerrSourceData {
  id: number;
  title: string;
  media_type: 'movie' | 'tv';
  tmdb_id: number;
  year?: number;
  status: number;
  created_at: string;
  user?: {
    id: number;
    username: string;
    displayName: string;
  };
}

export interface TmdbSourceData {
  id: number;
  title?: string;
  name?: string;
  media_type?: 'movie' | 'tv';
  release_date?: string;
  first_air_date?: string;
  overview?: string;
  vote_average?: number;
}

export interface TmdbFranchiseSourceData {
  franchiseId: number;
  franchiseName: string;
  franchisePosterPath?: string;
  franchiseBackdropPath?: string;
  movies: {
    tmdbId: number;
    title: string;
    releaseDate?: string;
  }[];
}

export interface ImdbSourceData {
  imdbId: string;
  title: string;
  year?: number;
  type: 'movie' | 'tv';
  tmdbId?: number;
  showTmdbId?: number; // For episodes: the parent show's TMDB ID
  isEpisode?: boolean; // True if this is an individual episode
  episodeInfo?: {
    episodeTitle?: string;
    season?: number;
    episode?: number;
  };
}

export interface LetterboxdSourceData {
  title: string;
  year: number;
  letterboxdUrl: string;
  tmdbId: number;
  mediaType: 'movie';
}

export interface AniListSourceData {
  title: string;
  anilistId?: number;
  raw: unknown; // The raw AniListMedia object from the API
}

export interface MyAnimeListSourceData {
  title: string;
  malId: number;
  rank: number;
  raw: unknown; // The raw MAL anime object from the API
}

export interface NetworksSourceData {
  rank: number;
  title: string;
  points?: string;
  flixpatrolUrl?: string;
  type: 'movie' | 'tv';
  platform: string;
  platformLogo?: {
    spriteUrl: string;
    position: string;
  };
}

/**
 * Radarr tag source data (movies with specific tags)
 */
export interface RadarrTagSourceData {
  movie: {
    ids: { tmdb: number };
    title: string;
    year?: number;
  };
  tagLabel: string;
}

/**
 * Sonarr tag source data (TV shows with specific tags)
 */
export interface SonarrTagSourceData {
  series: {
    ids: { tvdb: number; tmdb?: number };
    title: string;
    year?: number;
  };
  tagLabel: string;
}

/**
 * Placeholder source data (for createPlaceholdersForMissing feature)
 * Used by any collection type that supports placeholder creation
 */
export interface PlaceholderSourceData {
  tmdbId: number;
  tvdbId?: number; // For TV shows
  title: string;
  year?: number;

  // Movie release dates (from Radarr)
  releaseDate?: string; // ISO date string - generic/fallback release date
  digitalRelease?: string; // Digital/streaming release date (Priority 1)
  physicalRelease?: string; // Blu-ray/DVD release date (Priority 2)
  inCinemas?: string; // Theatrical release date (Priority 3, optional)

  mediaType: 'movie' | 'tv';
  source: ItemProducingSource;
  monitored: boolean; // True if item is in Radarr/Sonarr
  posterUrl?: string; // Poster URL from source
  airDate?: string; // Episode air date (S01E01 for new shows, next season premiere for returning shows)
  releaseType?: 'digital' | 'physical' | 'cinema'; // Movie release type (determined after priority logic)
  hasFile?: boolean; // Whether episode has file (for NEW detection)
  downloadedDate?: string; // When file was downloaded (for NEW detection)
  isReturning?: boolean; // True if this is a returning show (has previous episodes)
  seasonNumber?: number; // Season number of the upcoming episode
  episodeNumber?: number; // Episode number of the upcoming episode
  releaseDateSortValue?: string; // ISO date string for sorting (set during fetchSourceData)
  isEstimatedDate?: boolean; // True if releaseDate is an estimate (theatrical + 3 months)
}

/**
 * @deprecated Use PlaceholderSourceData instead
 */
export type ComingSoonSourceData = PlaceholderSourceData;

/**
 * Recently Added source data (smart collection that excludes placeholders)
 */
export interface RecentlyAddedSourceData {
  // Recently Added doesn't fetch external data - it creates a smart Plex collection
  // This interface is here for type consistency
  placeholder?: never;
}

/**
 * Union type for all possible source data
 */
export type CollectionSourceData =
  | TraktSourceData
  | MDBListSourceData
  | TautulliSourceData
  | OverseerrSourceData
  | TmdbSourceData
  | ImdbSourceData
  | LetterboxdSourceData
  | NetworksSourceData
  | AniListSourceData
  | MyAnimeListSourceData
  | RadarrTagSourceData
  | SonarrTagSourceData
  | PlaceholderSourceData
  | RecentlyAddedSourceData;

/**
 * Error types that can occur during collection sync
 */
export enum CollectionSyncErrorType {
  /** Configuration error (missing API keys, invalid settings) */
  CONFIGURATION_ERROR = 'configuration_error',
  /** External API error (Plex, Trakt, Tautulli) */
  API_ERROR = 'api_error',
  /** Database error */
  DATABASE_ERROR = 'database_error',
  /** Permission error */
  PERMISSION_ERROR = 'permission_error',
  /** Template processing error */
  TEMPLATE_ERROR = 'template_error',
  /** Collection creation error */
  COLLECTION_ERROR = 'collection_error',
  /** Auto-request error */
  AUTO_REQUEST_ERROR = 'auto_request_error',
  /** Unknown error */
  UNKNOWN_ERROR = 'unknown_error',
}

/**
 * Structured error information for collection sync operations
 */
export interface CollectionSyncError {
  /** Error type */
  type: CollectionSyncErrorType;
  /** Human-readable error message */
  message: string;
  /** Technical error details */
  details?: Record<string, unknown>;
  /** Original error object */
  originalError?: Error;
  /** Context where the error occurred */
  context?: {
    source?: CollectionSource;
    configId?: number;
    configName?: string;
    operation?: string;
  };
}

/**
 * Options for collection sync operations
 */
export interface CollectionSyncOptions {
  /** Whether to perform a dry run (no actual changes) */
  dryRun?: boolean;
  /** Whether to skip auto-request processing */
  skipAutoRequests?: boolean;
  /** Error callback */
  onError?: (error: CollectionSyncError) => void;
  /** Maximum number of items to process per collection */
  maxItemsPerCollection?: number;
  /** Timeout for external API calls in milliseconds */
  apiTimeout?: number;
}

/**
 * Batch operation result for processing multiple collections
 */
export interface BatchSyncResult {
  /** Results for each collection source */
  results: Record<CollectionSource, SyncResult>;
  /** Overall statistics */
  totals: SyncResult;
  /** Processing time in milliseconds */
  processingTime: number;
  /** Errors encountered during processing */
  errors: CollectionSyncError[];
}

/**
 * Cache entry for collection data
 */
export interface CollectionCacheEntry<T = unknown> {
  /** Cached data */
  data: T;
  /** Timestamp when cached */
  timestamp: number;
  /** Expiration time in milliseconds */
  expiresIn: number;
  /** Cache key */
  key: string;
}

/**
 * Collection sync state for tracking long-running operations
 */
export interface CollectionSyncState {
  /** Whether a sync is currently running */
  isRunning: boolean;
  /** Start time of current sync */
  startTime?: number;
  /** Last sync completion time */
  lastSyncTime?: number;
  /** Last sync result */
  lastSyncResult?: BatchSyncResult;
}

/**
 * Date range for time-based collection restrictions
 */
export interface DateRange {
  /** Start date in DD-MM format (e.g., "05-12" for 5th December) */
  readonly startDate: string;
  /** End date in DD-MM format (e.g., "26-12" for 26th December) */
  readonly endDate: string;
}

/**
 * Days of the week for time-based collection restrictions
 */
export interface WeeklySchedule {
  /** Monday */
  readonly monday: boolean;
  /** Tuesday */
  readonly tuesday: boolean;
  /** Wednesday */
  readonly wednesday: boolean;
  /** Thursday */
  readonly thursday: boolean;
  /** Friday */
  readonly friday: boolean;
  /** Saturday */
  readonly saturday: boolean;
  /** Sunday */
  readonly sunday: boolean;
}

/**
 * Time restriction configuration for collections
 */
export interface TimeRestriction {
  /** Whether the collection is always active (no time restrictions) */
  readonly alwaysActive: boolean;
  /** Optional date ranges when collection should be active (repeated annually) */
  readonly dateRanges?: readonly DateRange[];
  /** Optional days of the week when collection should be active */
  readonly weeklySchedule?: WeeklySchedule;
}

/**
 * Result of time restriction evaluation
 */
export interface TimeRestrictionResult {
  /** Whether the collection should be active at this time */
  isActive: boolean;
  /** Reason for the current state */
  reason:
    | 'always_active'
    | 'date_range_match'
    | 'weekly_schedule_match'
    | 'both_match'
    | 'no_match';
  /** Next activation time if currently inactive */
  nextActivation?: Date;
  /** Next deactivation time if currently active */
  nextDeactivation?: Date;
}

/**
 * User collections data structure used throughout the collections system
 */
export interface UserCollections {
  user: OverseerrUser;
  movies: CollectionItem[];
  tv: CollectionItem[];
  // Index signature to allow dynamic access by media type
  [key: string]: OverseerrUser | CollectionItem[];
}

/**
 * Map of user collections keyed by user Plex ID strings
 */
export interface UserCollectionsMap {
  [userPlexId: string]: UserCollections;
}

/**
 * Hub configuration data structure
 */
export interface HubConfig {
  id: number;
  type: string;
  title: string;
  key: string;
  size: number;
  more: boolean;
  style: string;
  promoted: boolean;
  hubIdentifier: string;
  context: string;
  visibility: {
    usersHome: boolean;
    serverOwnerHome: boolean;
    libraryRecommended: boolean;
  };
  libraryId: string;
  orderingPosition?: number;
}

/**
 * Ordering item structure for Plex hub and collection ordering
 */
export interface OrderingItem {
  id: string;
  type: 'collection' | 'hub';
  title: string;
  orderingPosition: number;
}

/**
 * Generic API response wrapper for external services
 */
export interface ApiResponse<T = unknown> {
  data: T;
  success: boolean;
  error?: string;
  status?: number;
}

// All types and interfaces are exported individually above
