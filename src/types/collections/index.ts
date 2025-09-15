/**
 * Collection configuration types for the Plex Collections UI
 * Extracted from SettingsPlex.tsx to improve maintainability
 */
// Types extracted from server to avoid importing server-side modules in client

export enum CollectionType {
  DEFAULT_PLEX_HUB = 'default_plex_hub', // Built-in Plex algorithmic hubs
  AGREGARR_CREATED = 'agregarr_created', // Agregarr-managed collections
  PRE_EXISTING = 'pre_existing', // Pre-existing Plex collections
}

export interface PlexHubConfig {
  id: string; // Generated unique identifier
  hubIdentifier: string; // Plex hub identifier (e.g., "movie.recentlyadded")
  name: string; // Display name (e.g., "Recently Added Movies")
  libraryId: string; // Library ID this hub belongs to
  libraryName: string; // Library display name
  mediaType: 'movie' | 'tv'; // Media type (hubs are always single type)
  sortOrderHome: number; // Position on Plex home screen
  sortOrderLibrary: number; // Position in library (0 for A-Z section, 1+ for promoted section)
  isLibraryPromoted: boolean; // true = promoted section (uses exclamation marks), false = A-Z section
  visibilityConfig: {
    usersHome: boolean;
    serverOwnerHome: boolean;
    libraryRecommended: boolean;
  };
  isActive: boolean; // Whether hub is currently active (computed from time restrictions)
  collectionType: CollectionType;
  missing?: boolean; // True if hub no longer exists in Plex
  // Sync status tracking fields
  lastSyncedAt?: string; // ISO string timestamp of last successful sync to Plex
  lastModifiedAt?: string; // ISO string timestamp when config was last modified
  needsSync?: boolean; // true if modified since last sync
  isLinked?: boolean; // True if hub is actively linked to other hubs (set by backend linking logic)
  linkId?: number; // Group ID for linked hubs (set by backend linking logic)
  isUnlinked?: boolean; // True if this hub was deliberately unlinked and should not be grouped with siblings
  everLibraryPromoted?: boolean; // True if this hub has ever been promoted to the promoted section (once true, stays true until sortTitle reset)
  isPromotedToHub?: boolean; // True if hub exists as a promotable item in Plex (appears in hub management list)
  // Time restriction settings - all hub types can have time restrictions
  timeRestriction?: {
    alwaysActive: boolean; // If true, hub is always active (default)
    removeFromPlexWhenInactive?: boolean; // If true, completely remove from Plex when inactive (not available for default Plex hubs)
    inactiveVisibilityConfig?: {
      usersHome: boolean;
      serverOwnerHome: boolean;
      libraryRecommended: boolean;
    }; // Visibility settings to use when hub is inactive (only used if removeFromPlexWhenInactive is false)
    dateRanges?: readonly {
      startDate: string; // DD-MM format (e.g., "05-12" for 5th December)
      endDate: string; // DD-MM format (e.g., "26-12" for 26th December)
    }[];
    weeklySchedule?: {
      monday: boolean;
      tuesday: boolean;
      wednesday: boolean;
      thursday: boolean;
      friday: boolean;
      saturday: boolean;
      sunday: boolean;
    };
  };
}

export interface PreExistingCollectionConfig {
  id: string; // Generated unique identifier
  collectionRatingKey: string; // Plex collection rating key (e.g., "35954")
  name: string; // Display name from Plex
  libraryId: string; // Library ID this collection belongs to
  libraryName: string; // Library display name
  mediaType: MediaType; // Media type based on library type
  titleSort?: string; // Plex sortTitle field for alphabetical ordering
  sortOrderHome: number; // Position on Plex home screen
  sortOrderLibrary: number; // Position in library (0 for A-Z section, 1+ for promoted section)
  isLibraryPromoted: boolean; // true = promoted section (uses exclamation marks), false = A-Z section
  visibilityConfig: {
    usersHome: boolean;
    serverOwnerHome: boolean;
    libraryRecommended: boolean;
  };
  isActive: boolean; // Whether collection is currently active (computed from time restrictions)
  // Simplified categorization system (consistent with PlexHubConfig)
  collectionType: CollectionType;
  missing?: boolean; // True if collection no longer exists in Plex
  // Sync status tracking fields
  lastSyncedAt?: string; // ISO string timestamp of last successful sync to Plex
  lastModifiedAt?: string; // ISO string timestamp when config was last modified
  needsSync?: boolean; // true if modified since last sync
  isLinked?: boolean; // True if collection is actively linked to other collections (set by backend linking logic)
  linkId?: number; // Group ID for linked collections (set by backend linking logic)
  isUnlinked?: boolean; // True if this collection was deliberately unlinked and should not be grouped with siblings
  everLibraryPromoted?: boolean; // True if this collection has ever been promoted to the promoted section (once true, stays true until sortTitle reset)
  isPromotedToHub?: boolean; // True if collection exists as a promotable hub in Plex (appears in hub management list)
  // Time restriction settings
  timeRestriction?: {
    alwaysActive: boolean; // If true, collection is always active (default)
    removeFromPlexWhenInactive?: boolean; // If true, completely remove from Plex when inactive
    inactiveVisibilityConfig?: {
      usersHome: boolean;
      serverOwnerHome: boolean;
      libraryRecommended: boolean;
    }; // Visibility settings to use when collection is inactive
    dateRanges?: readonly {
      startDate: string; // DD-MM format (e.g., "05-12" for 5th December)
      endDate: string; // DD-MM format (e.g., "26-12" for 26th December)
    }[];
    weeklySchedule?: {
      monday: boolean;
      tuesday: boolean;
      wednesday: boolean;
      thursday: boolean;
      friday: boolean;
      saturday: boolean;
      sunday: boolean;
    };
  };
  // Custom poster support
  customPoster?: string | Record<string, string>; // Path to custom poster image file, or per-library poster mapping
}

// Form metadata type for identifying config handling behavior
export type FormConfigType = 'collection' | 'hub' | 'preExisting';

export interface CollectionFormConfig {
  readonly id: string; // Generated unique identifier
  readonly name: string; // User-entered collection name
  readonly type?:
    | 'overseerr'
    | 'tautulli'
    | 'trakt'
    | 'tmdb'
    | 'imdb'
    | 'letterboxd'
    | 'networks'
    | 'multi-source';
  readonly subtype?: string; // Specific option like 'users', 'most_popular_plays', etc. - optional for hubs/pre-existing
  readonly timePeriod?: 'daily' | 'weekly' | 'monthly' | 'all'; // Time period for Trakt time-based subtypes
  readonly configType?: FormConfigType; // Metadata for form behavior identification
  readonly template?: string; // Collection title template (for preset templates or single media type) - optional for hubs/pre-existing
  readonly customMovieTemplate?: string; // Custom template for movie collections when mediaType is 'both'
  readonly customTVTemplate?: string; // Custom template for TV collections when mediaType is 'both'
  readonly visibilityConfig: {
    usersHome: boolean;
    serverOwnerHome: boolean;
    libraryRecommended: boolean;
  };
  readonly isActive: boolean; // Whether collection is currently active (time restrictions met) - computed by backend
  readonly missing?: boolean; // True if collection no longer exists in Plex
  // Sync status tracking fields
  readonly lastSyncedAt?: string; // ISO string timestamp of last successful sync to Plex
  readonly lastModifiedAt?: string; // ISO string timestamp when config was last modified
  readonly needsSync?: boolean; // true if modified since last sync
  readonly maxItems?: number; // Optional for hubs/pre-existing
  readonly mediaType?: MediaType;
  readonly libraryId: string; // Selected library ID - each config is for exactly one library
  readonly libraryName: string; // Selected library name for display
  readonly libraryIds?: string[]; // Temporary field for form UI when editing linked configs
  readonly libraryNames?: string[]; // Temporary field for form UI when editing linked configs
  readonly sortOrderHome?: number; // Order for Plex home screen (creation time based)
  readonly sortOrderLibrary?: number; // Order for Plex library tab (0 for A-Z section, 1+ for promoted section)
  readonly isLibraryPromoted?: boolean; // true = promoted section (uses exclamation marks), false = A-Z section (defaults to true for Agregarr collections)
  readonly collectionRatingKey?: string; // Plex collection rating key for reordering (e.g., "35955")
  readonly isLinked?: boolean; // True if collection is actively linked to other collections
  readonly linkId?: number; // Group ID for linked collections (preserved even when isLinked=false)
  readonly customSyncSchedule?: CustomSyncSchedule; // Individual sync timing
  readonly isMultiSource?: boolean; // Enable multi-source mode
  readonly sources?: readonly CollectionSourceConfig[]; // Array of source configurations
  readonly combineMode?: MultiSourceCombineMode; // How to combine multiple sources

  readonly [key: string]:
    | string
    | number
    | boolean
    | string[]
    | Record<string, string>
    | null
    | {
        usersHome: boolean;
        serverOwnerHome: boolean;
        libraryRecommended: boolean;
      }
    | {
        readonly alwaysActive: boolean;
        readonly removeFromPlexWhenInactive?: boolean;
        readonly inactiveVisibilityConfig?: {
          usersHome: boolean;
          serverOwnerHome: boolean;
          libraryRecommended: boolean;
        };
        readonly dateRanges?: readonly {
          readonly startDate: string;
          readonly endDate: string;
        }[];
        readonly weeklySchedule?: {
          readonly monday: boolean;
          readonly tuesday: boolean;
          readonly wednesday: boolean;
          readonly thursday: boolean;
          readonly friday: boolean;
          readonly saturday: boolean;
          readonly sunday: boolean;
        };
      }
    | readonly CollectionSourceConfig[] // Multi-source configs
    | { enabled: boolean; intervalHours: number } // Custom sync schedule
    | MultiSourceCombineMode // Combine mode
    | undefined;
  readonly customDays?: number; // Number of days for Tautulli collections
  readonly minimumPlays?: number; // Minimum play count for Tautulli collections (defaults to 3 if not set, 1-100)
  readonly tautulliStatType?: 'plays' | 'duration'; // Tautulli stat type
  // Download mode settings
  readonly downloadMode?: 'overseerr' | 'direct'; // Download mode: overseerr (requests) or direct (*arr)
  readonly searchMissingMovies?: boolean; // Auto-request missing movies
  readonly searchMissingTV?: boolean; // Auto-request missing TV shows
  readonly autoApproveMovies?: boolean; // Auto-approve movie requests
  readonly autoApproveTV?: boolean; // Auto-approve TV show requests
  readonly maxSeasonsToRequest?: number; // Max seasons for auto-approval
  readonly seasonsPerShowLimit?: number; // Limit each TV show to only the first X seasons (0 = all seasons)
  readonly maxPositionToProcess?: number; // Only process items in positions 1-X (0 = no limit)
  // Trakt custom list fields
  readonly traktCustomListUrl?: string; // Custom Trakt list URL
  // TMDb custom list fields
  readonly tmdbCustomListUrl?: string; // Custom TMDb list/collection URL
  // IMDb custom list fields
  readonly imdbCustomListUrl?: string; // Custom IMDb list URL
  // Letterboxd custom list fields
  readonly letterboxdCustomListUrl?: string; // Custom Letterboxd list URL
  // Networks fields
  readonly networksCountry?: string; // Selected country for Networks collections
  // Generic ordering options (applicable to all collection types)
  readonly reverseOrder?: boolean; // Reverse the order of items from the source
  readonly randomizeOrder?: boolean; // Randomize the order of items (mutually exclusive with reverseOrder)

  // Backend properties (from PlexHubConfig) - Present on hub configs from API
  readonly collectionType?: CollectionType; // Simplified categorization system
  readonly isUnlinked?: boolean; // True if this hub was deliberately unlinked
  everLibraryPromoted?: boolean; // True if this collection has ever been promoted to the promoted section (once true, stays true until sortTitle reset)
  readonly isPromotedToHub?: boolean; // True if collection exists as a promotable hub in Plex (appears in hub management list)

  // Hub-specific properties (present when config represents a hub)
  readonly hubIdentifier?: string; // Plex hub identifier (e.g., "movie.recentlyadded")

  // Poster settings
  readonly customPoster?: string | Record<string, string>; // Path to custom poster image file, or per-library poster mapping
  readonly autoPoster?: boolean; // Auto-generate poster during sync (only available for Overseerr user collections)
  readonly autoPosterTemplate?: number | null; // Template ID for auto-generated posters (null for default template)
  // Time restriction settings
  readonly timeRestriction?: {
    readonly alwaysActive: boolean; // If true, collection is always active (default)
    readonly removeFromPlexWhenInactive?: boolean; // If true, completely remove from Plex when inactive (old behavior)
    readonly inactiveVisibilityConfig?: {
      usersHome: boolean;
      serverOwnerHome: boolean;
      libraryRecommended: boolean;
    };
    readonly dateRanges?: readonly {
      readonly startDate: string; // DD-MM format (e.g., "05-12" for 5th December)
      readonly endDate: string; // DD-MM format (e.g., "26-12" for 26th December)
    }[];
    readonly weeklySchedule?: {
      readonly monday: boolean;
      readonly tuesday: boolean;
      readonly wednesday: boolean;
      readonly thursday: boolean;
      readonly friday: boolean;
      readonly saturday: boolean;
      readonly sunday: boolean;
    };
  };
}

/**
 * Collection configuration for creation requests
 * Excludes backend-computed fields like isActive
 * Matches CollectionConfigCreate OpenAPI schema
 */
export interface CollectionConfigCreateRequest {
  readonly id: string; // Empty string for new collections (backend assigns sequential number)
  readonly name: string; // User-entered collection name
  readonly type?:
    | 'overseerr'
    | 'tautulli'
    | 'trakt'
    | 'tmdb'
    | 'imdb'
    | 'letterboxd'
    | 'networks'
    | 'multi-source';
  readonly subtype?: string;
  readonly template?: string;
  readonly customMovieTemplate?: string;
  readonly customTVTemplate?: string;
  readonly visibilityConfig: {
    usersHome: boolean;
    serverOwnerHome: boolean;
    libraryRecommended: boolean;
  };
  // Note: isActive is NOT included - backend computes from timeRestriction
  readonly maxItems?: number;
  readonly mediaType?: MediaType;
  readonly libraryId: string;
  readonly libraryName: string;
  readonly sortOrderHome?: number;
  readonly sortOrderLibrary?: number;
  readonly customDays?: number;
  readonly minimumPlays?: number;
  readonly tautulliStatType?: 'plays' | 'duration';
  readonly searchMissingMovies?: boolean;
  readonly searchMissingTV?: boolean;
  readonly autoApproveMovies?: boolean;
  readonly autoApproveTV?: boolean;
  readonly maxSeasonsToRequest?: number;
  readonly traktCustomListUrl?: string;
  readonly tmdbCustomListUrl?: string;
  readonly imdbCustomListUrl?: string;
  readonly letterboxdCustomListUrl?: string;
  readonly networksCountry?: string;
  readonly reverseOrder?: boolean;
  readonly randomizeOrder?: boolean;
  readonly timeRestriction?: {
    readonly alwaysActive: boolean;
    readonly removeFromPlexWhenInactive?: boolean;
    readonly inactiveVisibilityConfig?: {
      usersHome: boolean;
      serverOwnerHome: boolean;
      libraryRecommended: boolean;
    };
    readonly dateRanges?: readonly {
      readonly startDate: string;
      readonly endDate: string;
    }[];
    readonly weeklySchedule?: {
      readonly monday: boolean;
      readonly tuesday: boolean;
      readonly wednesday: boolean;
      readonly thursday: boolean;
      readonly friday: boolean;
      readonly saturday: boolean;
      readonly sunday: boolean;
    };
  };
  readonly customPoster?: string | Record<string, string>;
  readonly autoPoster?: boolean; // Auto-generate poster during sync (only available for Overseerr user collections)
  readonly autoPosterTemplate?: number | null; // Template ID for auto-generated posters (null for default template)
  // Multi-source fields
  readonly isMultiSource?: boolean;
  readonly sources?: readonly CollectionSourceConfig[];
  readonly combineMode?: MultiSourceCombineMode;
  readonly customSyncSchedule?: CustomSyncSchedule;
}

/**
 * Convert CollectionFormConfig to CollectionConfigCreateRequest
 * Strips out backend-computed fields for clean API calls
 */
export const toCollectionCreateRequest = (
  config: CollectionFormConfig
): CollectionConfigCreateRequest => {
  return {
    id: config.id || '', // Empty string for new collections
    name: config.name,
    type: config.type,
    subtype: config.subtype,
    template: config.template,
    customMovieTemplate: config.customMovieTemplate,
    customTVTemplate: config.customTVTemplate,
    visibilityConfig: config.visibilityConfig,
    // Explicitly exclude isActive - backend computes this
    maxItems: config.maxItems,
    mediaType: config.mediaType,
    libraryId: config.libraryId,
    libraryName: config.libraryName,
    sortOrderHome: config.sortOrderHome,
    sortOrderLibrary: config.sortOrderLibrary,
    customDays: config.customDays,
    minimumPlays: config.minimumPlays,
    tautulliStatType: config.tautulliStatType,
    searchMissingMovies: config.searchMissingMovies,
    searchMissingTV: config.searchMissingTV,
    autoApproveMovies: config.autoApproveMovies,
    autoApproveTV: config.autoApproveTV,
    maxSeasonsToRequest: config.maxSeasonsToRequest,
    traktCustomListUrl: config.traktCustomListUrl,
    tmdbCustomListUrl: config.tmdbCustomListUrl,
    imdbCustomListUrl: config.imdbCustomListUrl,
    letterboxdCustomListUrl: config.letterboxdCustomListUrl,
    networksCountry: config.networksCountry,
    reverseOrder: config.reverseOrder,
    randomizeOrder: config.randomizeOrder,
    timeRestriction: config.timeRestriction,
    customPoster: config.customPoster,
    autoPoster: config.autoPoster,
    autoPosterTemplate: config.autoPosterTemplate,
    // Multi-source fields
    isMultiSource: config.isMultiSource,
    sources: config.sources,
    combineMode: config.combineMode,
    customSyncSchedule: config.customSyncSchedule,
  };
};

/**
 * CollectionFormConfig with additional metadata for form editing
 * These properties are computed/added when configs are passed to forms
 */
export interface CollectionFormConfigForEditing extends CollectionFormConfig {
  readonly libraryIds?: string[]; // Temporary field for form UI when editing linked configs
  readonly libraryNames?: string[]; // Temporary field for form UI when editing linked configs
}

/**
 * Simple hash function to convert hubIdentifier strings to consistent numeric group IDs
 */
export function hash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash) + 1000; // Add 1000 to avoid conflicts with user collection group IDs
}

/**
 * Utility functions for determining collection states
 * These replace the inconsistent computed properties
 */
export const CollectionFormConfigUtils = {
  /**
   * Check if this is a pre-existing (user-created) collection
   */
  isPreExisting: (config: CollectionFormConfig): boolean => {
    return config.collectionType === CollectionType.PRE_EXISTING;
  },

  /**
   * Check if this is a built-in Plex hub
   */
  isDefaultPlexHub: (config: CollectionFormConfig): boolean => {
    return config.collectionType === CollectionType.DEFAULT_PLEX_HUB;
  },

  /**
   * Check if enhanced form should be shown
   * Enhanced form is shown for: pre-existing collections, default Plex hubs, or linked configs
   */
  shouldShowEnhancedForm: (config: CollectionFormConfigForEditing): boolean => {
    return (
      CollectionFormConfigUtils.isPreExisting(config) ||
      CollectionFormConfigUtils.isDefaultPlexHub(config) ||
      Boolean(config.isLinked)
    );
  },

  /**
   * Check if collection can be linked to other libraries
   */
  canLinkCollection: (config: CollectionFormConfigForEditing): boolean => {
    // Can't link if already linked
    if (config.isLinked) return false;

    // Pre-existing collections cannot be linked - they're existing Plex collections not created by us
    if (CollectionFormConfigUtils.isPreExisting(config)) return false;

    // Allow linking for Agregarr-created collections and default Plex hubs
    return true;
  },
};

export interface TemplatePreset {
  label: string;
  value: string;
}

export interface VisibilityCheckboxState {
  enabled: boolean;
  label: string;
  description?: string;
}

export interface SubtypeOption {
  label: string;
  value: string;
  description?: string;
}

export interface Library {
  readonly key: string;
  readonly name: string;
  readonly type: 'movie' | 'show';
}

export interface CollectionConfigFormProps {
  config: CollectionFormConfig | PlexHubConfig | PreExistingCollectionConfig;
  onSave: (
    config: CollectionFormConfig | PlexHubConfig | PreExistingCollectionConfig
  ) => void;
  onCancel: () => void;
  onUnlink?: (
    config: CollectionFormConfig | PlexHubConfig | PreExistingCollectionConfig
  ) => void;
  onLink?: (
    config: CollectionFormConfig | PlexHubConfig | PreExistingCollectionConfig
  ) => void;
  isEditing?: boolean;
  libraries: Library[];
  // Additional data needed for link/unlink detection
  allCollectionConfigs?: CollectionFormConfig[];
  allHubConfigs?: PlexHubConfig[];
}

export interface CollectionSettingsProps {
  libraries?: Library[]; // Optional - component can fetch directly from Plex
  onUpdateConfigs: (configs: CollectionFormConfig[]) => void;
  filterTab?: 'home' | 'recommended' | 'library'; // Filter to show only specific tab content
}

// PlexHubConfig is now defined above to match the server interface while avoiding client-side imports

export type CollectionSourceType =
  | 'overseerr'
  | 'tautulli'
  | 'trakt'
  | 'tmdb'
  | 'imdb'
  | 'letterboxd'
  | 'networks'
  | 'multi-source';
export type MediaType = 'movie' | 'tv';

/**
 * Collection config for API submission - excludes read-only fields computed by backend
 */
export type CollectionConfigForSubmission = Omit<
  CollectionFormConfig,
  'isActive' | 'missing'
>;

/**
 * Hub config for API submission - excludes only truly computed fields
 * isActive is computed by backend based on time restrictions and current time
 * collectionType is determined during discovery
 * missing is computed during validation/discovery
 * All other fields (including isLinked/linkId) should be preserved
 */
export type PlexHubConfigForSubmission = Omit<
  PlexHubConfig,
  'isActive' | 'collectionType' | 'missing'
>;

/**
 * Pre-existing collection config for API submission - excludes only truly computed fields
 * isActive is computed by backend based on time restrictions and current time
 * collectionType is determined during discovery
 * missing is computed during validation/discovery
 * All other fields (including isLinked/linkId) should be preserved
 */
export type PreExistingCollectionConfigForSubmission = Omit<
  PreExistingCollectionConfig,
  'isActive' | 'collectionType' | 'missing'
>;

/**
 * Multi-Source Collection Configuration Types
 * Support for collections that combine multiple list sources
 */

/**
 * Individual source configuration for multi-source collections
 */
export interface CollectionSourceConfig {
  readonly id: string; // Unique identifier for this source within the collection
  readonly type: CollectionSourceType;
  readonly subtype?: string;
  readonly customUrl?: string; // For custom lists (Trakt, TMDb, IMDb, Letterboxd)
  readonly timePeriod?: 'daily' | 'weekly' | 'monthly' | 'all';
  readonly priority: number; // Order priority when combining (0 = highest)
  readonly isExpanded?: boolean; // UI state for expandable sections

  // Tautulli-specific configuration (per source)
  readonly customDays?: number; // Number of days to look back for statistics
  readonly minimumPlays?: number; // Minimum play count required
  // Networks-specific configuration
  readonly networksCountry?: string; // Selected country for Networks collections
}

/**
 * Multi-source combining modes
 */
export type MultiSourceCombineMode =
  | 'interleaved'
  | 'list_order'
  | 'randomised'
  | 'cycle_lists';

/**
 * Custom sync schedule configuration
 */
export interface CustomSyncSchedule {
  readonly enabled: boolean;
  readonly intervalHours: number; // Supports decimals (e.g., 0.5, 1.5, 2.5)
}

/**
 * Distinct multi-source collection configuration type
 * According to Orchestrator Method plan: multi-source is a separate collection type
 */
export interface MultiSourceCollectionConfig {
  // Copy essential fields from CollectionFormConfig
  readonly id: string;
  readonly name: string;
  readonly type: 'multi-source'; // Distinct type
  readonly visibilityConfig: {
    usersHome: boolean;
    serverOwnerHome: boolean;
    libraryRecommended: boolean;
  };
  readonly mediaType?: 'movie' | 'tv';
  readonly libraryId: string;
  readonly libraryName: string;
  readonly maxItems?: number;
  readonly template?: string;
  // Multi-source specific fields
  readonly sources: readonly SourceDefinition[]; // Required sources array
  readonly combineMode: MultiSourceCombineMode; // Required combine mode
  readonly customSyncSchedule?: CustomSyncSchedule;
  // Optional fields from parent
  readonly isActive?: boolean;
  readonly sortOrderHome?: number;
  readonly sortOrderLibrary?: number;
  readonly isLibraryPromoted?: boolean;
  readonly timeRestriction?: {
    readonly alwaysActive: boolean;
    readonly removeFromPlexWhenInactive?: boolean;
    readonly inactiveVisibilityConfig?: {
      usersHome: boolean;
      serverOwnerHome: boolean;
      libraryRecommended: boolean;
    };
  };
  readonly customPoster?: string | Record<string, string>;
  readonly autoPoster?: boolean;
}

/**
 * Valid source types for multi-source collections (excludes 'hub' and 'multi-source')
 */
export type MultiSourceType =
  | 'trakt'
  | 'tmdb'
  | 'imdb'
  | 'letterboxd'
  | 'tautulli'
  | 'overseerr'
  | 'networks';

/**
 * Source definition for multi-source collections
 * Alias for CollectionSourceConfig with stricter typing
 */
export interface SourceDefinition {
  readonly id: string;
  readonly type: MultiSourceType;
  readonly subtype: string;
  readonly customUrl?: string;
  readonly timePeriod?: 'daily' | 'weekly' | 'monthly' | 'all';
  readonly customDays?: number;
  readonly minimumPlays?: number;
  readonly priority: number;
  readonly networksCountry?: string; // Selected country for Networks collections
}

/**
 * Extended CollectionFormConfig with multi-source support (backward compatibility)
 * Uses intersection type to avoid index signature conflicts
 */
export type MultiSourceCollectionFormConfig = CollectionFormConfig & {
  readonly isMultiSource?: boolean; // Enable multi-source mode
  readonly sources?: readonly CollectionSourceConfig[]; // Array of source configurations
  readonly combineMode?: MultiSourceCombineMode; // How to combine multiple sources
  readonly customSyncSchedule?: CustomSyncSchedule; // Individual sync timing
};

/**
 * Extended CollectionConfigCreateRequest with multi-source support
 */
export interface MultiSourceCollectionConfigCreateRequest
  extends CollectionConfigCreateRequest {
  readonly isMultiSource?: boolean;
  readonly sources?: readonly CollectionSourceConfig[];
  readonly combineMode?: MultiSourceCombineMode;
  readonly customSyncSchedule?: CustomSyncSchedule;
}
