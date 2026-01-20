/**
 * Overlay element interface matching server entity
 * Uses absolute positioning (pixels) like PosterTemplate
 */
export interface OverlayElement {
  id: string;
  layerOrder: number;
  type: 'text' | 'tile' | 'variable' | 'raster' | 'svg';
  x: number; // Absolute pixels
  y: number; // Absolute pixels
  width: number; // Absolute pixels
  height: number; // Absolute pixels
  rotation?: number; // Rotation in degrees (0-360)
  properties:
    | OverlayTextElementProps
    | OverlayTileElementProps
    | OverlayVariableElementProps
    | OverlayRasterElementProps
    | OverlaySVGElementProps;
}

export interface OverlayTextElementProps {
  text: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  color: string;
  textAlign: 'left' | 'center' | 'right';
  maxLines?: number;
  opacity?: number; // 0-100
}

export interface OverlayTileElementProps {
  fillColor: string;
  fillOpacity: number;
  borderColor?: string;
  borderWidth?: number;
  borderRadius?: number; // Deprecated - use individual corners
  borderRadiusTopLeft?: number;
  borderRadiusTopRight?: number;
  borderRadiusBottomLeft?: number;
  borderRadiusBottomRight?: number;
  lockCorners?: boolean; // When true, all corners use topLeft value
}

/**
 * Segment in a variable element (for composing dynamic text)
 */
export interface OverlayVariableSegment {
  type: 'text' | 'variable';
  value?: string; // For type='text' - static text content
  field?: string; // For type='variable' - field name from context (e.g., 'seasonNumber', 'daysUntilRelease')
  format?: string; // For type='variable' with date fields - date format string (e.g., 'YYYY-MM-DD', 'MMM DD')
}

/**
 * Variable element - compose dynamic text from multiple segments
 * Example segments for "SEASON 2 IN 14 DAYS":
 * - { type: 'text', value: 'SEASON ' }
 * - { type: 'variable', field: 'seasonNumber' }
 * - { type: 'text', value: ' IN ' }
 * - { type: 'variable', field: 'daysUntilRelease' }
 * - { type: 'text', value: ' DAYS' }
 */
export interface OverlayVariableElementProps {
  segments: OverlayVariableSegment[]; // Array of text and variable segments
  fontSize: number;
  fontFamily: string;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  color: string;
  textAlign: 'left' | 'center' | 'right';
  opacity?: number; // 0-100
}

export interface OverlayRasterElementProps {
  imagePath: string;
  opacity?: number;
}

export interface OverlaySVGElementProps {
  iconType: 'service-logo' | 'custom-icon' | 'dynamic-icon';
  iconPath?: string;
  dynamicIconField?: string;
  grayscale?: boolean;
  opacity?: number;
}

/**
 * Overlay template data - single visual design
 * One template = One visual design = One application condition
 */
export interface OverlayTemplateData {
  width: number;
  height: number;
  elements: OverlayElement[];
}

/**
 * Application condition for when to apply an overlay template
 * Uses a flat section-based structure for better UX
 *
 * Structure reads naturally:
 * - Section 1: (rule1 AND rule2 AND rule3)
 * - OR/AND (section operator)
 * - Section 2: (rule4 OR rule5)
 *
 * Example: Show overlay when (views=0 AND dateAdded<X) OR (rating>8)
 */
export interface ApplicationCondition {
  sections: ConditionSection[];
}

/**
 * A section contains rules that combine with AND or OR
 * sectionOperator determines how this section connects to the PREVIOUS section
 */
export interface ConditionSection {
  sectionOperator?: 'and' | 'or'; // How this section combines with previous section (omitted for first section)
  rules: ConditionRule[];
}

/**
 * A single condition rule (field/operator/value)
 * ruleOperator determines how this rule connects to the PREVIOUS rule in the section
 */
export interface ConditionRule {
  ruleOperator?: 'and' | 'or'; // How this rule combines with previous rule (omitted for first rule in section)
  field: string; // e.g., 'imdbRating', 'resolution', 'daysUntilRelease'
  operator:
    | 'eq' // equals
    | 'neq' // not equals
    | 'gt' // greater than
    | 'gte' // greater than or equal
    | 'lt' // less than
    | 'lte' // less than or equal
    | 'in' // value in array
    | 'contains' // string contains
    | 'notContains' // string does not contain
    | 'regex' // regex match
    | 'begins' // string begins with
    | 'ends' // string ends with
    | 'exists'; // field exists (has non-null/undefined value)
  value: string | number | boolean | (string | number)[];
}

/**
 * Context for rendering overlay dynamic fields
 * Used for live preview in the editor
 * Matches server/lib/overlays/OverlayTemplateRenderer.ts OverlayRenderContext
 */
export interface OverlayRenderContext {
  // Ratings (from IMDb API / RT API / Plex)
  imdbRating?: number;
  imdbTop250Rank?: number; // IMDb Top 250 ranking (1-250 for movies, 1-250 for TV)
  isImdbTop250?: boolean; // True if item is in IMDb Top 250 list
  rtCriticsScore?: number;
  rtAudienceScore?: number;
  rtCertifiedFresh?: boolean; // True if Rotten Tomatoes Certified Fresh
  plexUserRating?: number; // Plex user rating (0-10 scale where 10 = 5 stars)
  // metacriticScore?: number; // TODO: Implement Metacritic integration

  // TMDB Metadata
  title?: string;
  year?: number;
  director?: string;
  studio?: string;
  network?: string; // For TV shows
  genre?: string;
  runtime?: number;
  runtimeHHMM?: string; // Runtime formatted as "2h 16m"
  tmdbStatus?: string; // TV show status: 'Returning Series', 'Planned', 'Pilot', 'In Production', 'Ended', 'Cancelled'

  // Plex Media Info (from actual file analysis)
  resolution?: string; // '4K', '1080p', '720p'
  width?: number; // Video width in pixels
  height?: number; // Video height in pixels
  aspectRatio?: number; // Aspect ratio (e.g., 2.35)

  // Video specs
  videoCodec?: string; // 'hevc', 'h264', 'av1'
  videoProfile?: string; // 'main', 'high'
  videoFrameRate?: string; // '23.976', '24', '30'
  bitDepth?: number; // 8, 10, 12
  hdr?: boolean; // HDR10/HDR10+
  dolbyVision?: boolean; // Dolby Vision
  dolbyVisionProfile?: number; // Dolby Vision Profile (5, 7, 8, etc.)
  colorTrc?: string; // Color transfer characteristic (e.g., 'smpte2084' for HDR10, 'arib' for HLG)

  // Audio specs
  audioCodec?: string; // 'truehd', 'dts', 'aac'
  audioChannels?: number; // 2, 6, 8
  audioChannelLayout?: string; // '5.1', '7.1', 'atmos'
  audioFormat?: string; // Full display title (e.g., 'English (Dolby TrueHD Atmos 7.1)')

  // Audio language info
  audioLanguage?: string; // Primary audio track language name (e.g., 'English', 'German')
  audioLanguageCode?: string; // Primary audio track language code (e.g., 'en', 'de')
  audioLanguages?: string[]; // Array of all audio track languages
  audioLanguageCodes?: string[]; // Array of all audio track language codes

  // Subtitle info
  subtitleLanguages?: string[]; // Array of all subtitle languages
  subtitleLanguageCodes?: string[]; // Array of all subtitle language codes
  hasSubtitles?: boolean; // Whether any subtitle tracks are present

  // File info
  container?: string; // 'mkv', 'mp4'
  bitrate?: number; // In kbps
  fileSize?: number; // In bytes
  filePath?: string; // Full file path

  // Playback stats
  viewCount?: number; // Number of times played
  lastPlayed?: Date; // Last playback date
  dateAdded?: Date; // Date added to Plex
  daysSinceAdded?: number; // Days since item was added to Plex
  daysSinceLastPlayed?: number; // Days since item was last played

  // Status fields (for Coming Soon / New Release)
  // PRIMARY RELEASE DATE - Smart calculated field
  // MOVIES: Earliest of Digital/Physical > Theatrical (+90 days estimate)
  // TV SHOWS: Series premiere date (NOT next episode!)
  releaseDate?: string;
  daysUntilRelease?: number; // Days until releaseDate
  daysAgo?: number; // Days since releaseDate

  // TV SHOWS - Episode/Season countdowns (separate from releaseDate)
  nextEpisodeAirDate?: string; // Raw date for ANY next episode (including mid-season)
  daysUntilNextEpisode?: number; // Calculated days until ANY next episode
  nextSeasonAirDate?: string; // Raw date for SEASON PREMIERES only (episode 1)
  daysUntilNextSeason?: number; // Calculated days until next SEASON PREMIERE only
  daysAgoNextSeason?: number; // Days since next season premiered (only if nextSeasonAirDate is in the past)

  // Episode information
  seasonNumber?: number;
  episodeNumber?: number;
  episodeLabel?: string; // "SERIES FINALE", "SEASON FINALE", or "EPISODE X"

  // Monitoring status
  isMonitored?: boolean;
  inRadarr?: boolean;
  inSonarr?: boolean;
  downloaded?: boolean;
  radarrTags?: string[]; // Array of Radarr tag names
  sonarrTags?: string[]; // Array of Sonarr tag names

  // Maintainerr integration
  daysUntilAction?: number; // Days until Maintainerr takes action (negative = overdue)

  // Item metadata
  isPlaceholder: boolean; // true = Coming Soon item, false = real item in Plex
  mediaType: 'movie' | 'show';

  // Legacy/Deprecated fields
  status?: string;

  // Allow additional fields
  [key: string]: string | number | boolean | Date | string[] | undefined;
}

/**
 * Available variable fields organized by category
 * Used for the variable picker in the layer panel
 */
export const AVAILABLE_VARIABLES = {
  ratings: [
    { field: 'imdbRating', label: 'IMDb Rating', example: '8.7' },
    { field: 'imdbTop250Rank', label: 'IMDb Top 250 Rank', example: '42' },
    { field: 'isImdbTop250', label: 'Is IMDb Top 250', example: 'true' },
    { field: 'rtCriticsScore', label: 'RT Critics Score', example: '88' },
    { field: 'rtAudienceScore', label: 'RT Audience Score', example: '85' },
    { field: 'rtCertifiedFresh', label: 'RT Certified Fresh', example: 'true' },
    { field: 'plexUserRating', label: 'Plex User Rating', example: '8' },
    // { field: 'metacriticScore', label: 'Metacritic Score', example: '73' }, // TODO: Implement Metacritic integration
  ],
  metadata: [
    { field: 'title', label: 'Title', example: 'The Matrix' },
    { field: 'year', label: 'Year', example: '1999' },
    { field: 'director', label: 'Director', example: 'Lana Wachowski' },
    { field: 'studio', label: 'Studio', example: 'Warner Bros.' },
    { field: 'network', label: 'Network (TV)', example: 'AMC' },
    { field: 'genre', label: 'Genre', example: 'Sci-Fi' },
    { field: 'runtime', label: 'Runtime (min)', example: '136' },
    { field: 'runtimeHHMM', label: 'Runtime (HHMM)', example: '2h 16m' },
    {
      field: 'tmdbStatus',
      label: 'TMDB Status (TV)',
      example: 'RETURNING',
    },
  ],
  video: [
    { field: 'resolution', label: 'Resolution', example: '4K' },
    { field: 'width', label: 'Width (px)', example: '3840' },
    { field: 'height', label: 'Height (px)', example: '2160' },
    { field: 'aspectRatio', label: 'Aspect Ratio', example: '2.35' },
    { field: 'videoCodec', label: 'Video Codec', example: 'hevc' },
    { field: 'videoProfile', label: 'Video Profile', example: 'main' },
    { field: 'videoFrameRate', label: 'Frame Rate', example: '23.976' },
    { field: 'bitDepth', label: 'Bit Depth', example: '10' },
    { field: 'hdr', label: 'HDR', example: 'true' },
    { field: 'dolbyVision', label: 'Dolby Vision', example: 'true' },
    {
      field: 'dolbyVisionProfile',
      label: 'Dolby Vision Profile',
      example: '7',
    },
    {
      field: 'colorTrc',
      label: 'Color Transfer',
      example: 'smpte2084',
    },
  ],
  audio: [
    {
      field: 'audioFormat',
      label: 'Audio Format',
      example: 'Dolby TrueHD Atmos 7.1',
    },
    { field: 'audioCodec', label: 'Audio Codec', example: 'truehd' },
    { field: 'audioChannels', label: 'Audio Channels', example: '8' },
    { field: 'audioChannelLayout', label: 'Channel Layout', example: '7.1' },
  ],
  language: [
    {
      field: 'audioLanguage',
      label: 'Audio Language (Primary)',
      example: 'English',
    },
    {
      field: 'audioLanguageCode',
      label: 'Audio Language Code (Primary)',
      example: 'en',
    },
    {
      field: 'audioLanguages',
      label: 'Audio Languages (All)',
      example: 'English, German',
    },
    {
      field: 'audioLanguageCodes',
      label: 'Audio Language Codes (All)',
      example: 'en, de',
    },
    {
      field: 'subtitleLanguages',
      label: 'Subtitle Languages',
      example: 'English, German, French',
    },
    {
      field: 'subtitleLanguageCodes',
      label: 'Subtitle Language Codes',
      example: 'en, de, fr',
    },
    { field: 'hasSubtitles', label: 'Has Subtitles', example: 'true' },
  ],
  file: [
    { field: 'container', label: 'Container', example: 'mkv' },
    { field: 'bitrate', label: 'Bitrate (kbps)', example: '15000' },
    { field: 'fileSize', label: 'File Size (bytes)', example: '4500000000' },
    { field: 'filePath', label: 'File Path', example: '/movies/Inception.mkv' },
  ],
  playback: [
    { field: 'viewCount', label: 'View Count', example: '5' },
    { field: 'lastPlayed', label: 'Last Played', example: '2024-01-15' },
    { field: 'dateAdded', label: 'Date Added', example: '2024-01-01' },
    { field: 'daysSinceAdded', label: 'Days Since Added', example: '14' },
    {
      field: 'daysSinceLastPlayed',
      label: 'Days Since Last Played',
      example: '7',
    },
  ],
  'coming-soon': [
    { field: 'releaseDate', label: 'Release Date', example: 'JAN 15' },
    { field: 'daysUntilRelease', label: 'Days Until Release', example: '14' },
    {
      field: 'daysAgo',
      label: 'Days Since Release (incl. release day)',
      example: '3',
    },
    {
      field: 'nextEpisodeAirDate',
      label: 'Next Episode Air Date (TV)',
      example: 'JAN 22',
    },
    {
      field: 'daysUntilNextEpisode',
      label: 'Days Until Next Episode (TV)',
      example: '7',
    },
    {
      field: 'nextSeasonAirDate',
      label: 'Next Season Premiere Date (TV)',
      example: 'FEB 05',
    },
    {
      field: 'daysUntilNextSeason',
      label: 'Days Until Next Season (TV)',
      example: '45',
    },
    {
      field: 'daysAgoNextSeason',
      label: 'Days Since Next Season Premiered (TV)',
      example: '7',
    },
    { field: 'seasonNumber', label: 'Season Number', example: '5' },
    { field: 'episodeNumber', label: 'Episode Number', example: '16' },
    {
      field: 'episodeLabel',
      label: 'Episode Label',
      example: 'SERIES FINALE',
    },
  ],
  status: [
    {
      field: 'isPlaceholder',
      label: 'Is Placeholder (Coming Soon)',
      example: 'true',
    },
    { field: 'isMonitored', label: 'Is Monitored', example: 'true' },
    { field: 'inRadarr', label: 'In Radarr', example: 'true' },
    { field: 'inSonarr', label: 'In Sonarr', example: 'true' },
    { field: 'downloaded', label: 'Downloaded', example: 'true' },
    { field: 'radarrTags', label: 'Radarr Tags', example: 'english-audio' },
    { field: 'sonarrTags', label: 'Sonarr Tags', example: 'german-audio' },
    {
      field: 'daysUntilAction',
      label: 'Days Until Maintainerr Action',
      example: '5',
    },
  ],
};

/**
 * Condition fields organized by category for the conditions dropdown
 * Different organization than AVAILABLE_VARIABLES - optimized for condition selection
 */
export const CONDITION_FIELD_CATEGORIES = {
  'TMDB Data': [
    { field: 'title', label: 'Title', example: 'The Matrix' },
    { field: 'year', label: 'Year', example: '1999' },
    { field: 'director', label: 'Director', example: 'Lana Wachowski' },
    { field: 'studio', label: 'Studio', example: 'Warner Bros.' },
    { field: 'network', label: 'Network (TV)', example: 'AMC' },
    { field: 'genre', label: 'Genre', example: 'Sci-Fi' },
    { field: 'runtime', label: 'Runtime (min)', example: '136' },
    { field: 'runtimeHHMM', label: 'Runtime (HHMM)', example: '2h 16m' },
    {
      field: 'tmdbStatus',
      label: 'TMDB Status (TV)',
      example: 'RETURNING',
    },
  ],
  'Plex Data': [
    { field: 'resolution', label: 'Resolution', example: '4K' },
    { field: 'width', label: 'Width (px)', example: '3840' },
    { field: 'height', label: 'Height (px)', example: '2160' },
    { field: 'aspectRatio', label: 'Aspect Ratio', example: '2.35' },
    { field: 'videoCodec', label: 'Video Codec', example: 'hevc' },
    { field: 'videoProfile', label: 'Video Profile', example: 'main' },
    { field: 'videoFrameRate', label: 'Frame Rate', example: '23.976' },
    { field: 'bitDepth', label: 'Bit Depth', example: '10' },
    { field: 'hdr', label: 'HDR', example: 'true' },
    { field: 'dolbyVision', label: 'Dolby Vision', example: 'true' },
    {
      field: 'dolbyVisionProfile',
      label: 'Dolby Vision Profile',
      example: '7',
    },
    {
      field: 'colorTrc',
      label: 'Color Transfer',
      example: 'smpte2084',
    },
    {
      field: 'audioFormat',
      label: 'Audio Format',
      example: 'Dolby TrueHD Atmos 7.1',
    },
    { field: 'audioCodec', label: 'Audio Codec', example: 'truehd' },
    { field: 'audioChannels', label: 'Audio Channels', example: '8' },
    { field: 'audioChannelLayout', label: 'Channel Layout', example: '7.1' },
    {
      field: 'audioLanguage',
      label: 'Audio Language (Primary)',
      example: 'English',
    },
    {
      field: 'audioLanguageCode',
      label: 'Audio Language Code (Primary)',
      example: 'en',
    },
    {
      field: 'audioLanguages',
      label: 'Audio Languages (All)',
      example: 'English, German',
    },
    {
      field: 'audioLanguageCodes',
      label: 'Audio Language Codes (All)',
      example: 'en, de',
    },
    {
      field: 'subtitleLanguages',
      label: 'Subtitle Languages',
      example: 'English, German, French',
    },
    {
      field: 'subtitleLanguageCodes',
      label: 'Subtitle Language Codes',
      example: 'en, de, fr',
    },
    { field: 'hasSubtitles', label: 'Has Subtitles', example: 'true' },
    { field: 'container', label: 'Container', example: 'mkv' },
    { field: 'bitrate', label: 'Bitrate (kbps)', example: '15000' },
    { field: 'fileSize', label: 'File Size (bytes)', example: '4500000000' },
    { field: 'filePath', label: 'File Path', example: '/movies/Inception.mkv' },
    { field: 'viewCount', label: 'View Count', example: '5' },
    { field: 'lastPlayed', label: 'Last Played', example: '2024-01-15' },
    { field: 'dateAdded', label: 'Date Added', example: '2024-01-01' },
    { field: 'daysSinceAdded', label: 'Days Since Added', example: '14' },
    {
      field: 'daysSinceLastPlayed',
      label: 'Days Since Last Played',
      example: '7',
    },
  ],
  Ratings: [
    { field: 'imdbRating', label: 'IMDb Rating', example: '8.7' },
    { field: 'imdbTop250Rank', label: 'IMDb Top 250 Rank', example: '42' },
    { field: 'isImdbTop250', label: 'Is IMDb Top 250', example: 'true' },
    { field: 'rtCriticsScore', label: 'RT Critics Score', example: '88' },
    { field: 'rtAudienceScore', label: 'RT Audience Score', example: '85' },
    { field: 'rtCertifiedFresh', label: 'RT Certified Fresh', example: 'true' },
    { field: 'plexUserRating', label: 'Plex User Rating', example: '8' },
    // { field: 'metacriticScore', label: 'Metacritic Score', example: '73' }, // TODO: Implement Metacritic integration
  ],
  Status: [
    { field: 'mediaType', label: 'Media Type (movie/show)', example: 'movie' },
    {
      field: 'isPlaceholder',
      label: 'Is Placeholder (Coming Soon)',
      example: 'true',
    },
    { field: 'daysUntilRelease', label: 'Days Until Release', example: '14' },
    {
      field: 'daysAgo',
      label: 'Days Since Release (incl. release day)',
      example: '3',
    },
    {
      field: 'nextEpisodeAirDate',
      label: 'Next Episode Air Date (TV)',
      example: 'JAN 22',
    },
    {
      field: 'daysUntilNextEpisode',
      label: 'Days Until Next Episode (TV)',
      example: '7',
    },
    {
      field: 'nextSeasonAirDate',
      label: 'Next Season Premiere Date (TV)',
      example: 'FEB 05',
    },
    {
      field: 'daysUntilNextSeason',
      label: 'Days Until Next Season (TV)',
      example: '45',
    },
    {
      field: 'daysAgoNextSeason',
      label: 'Days Since Next Season Premiered (TV)',
      example: '7',
    },
    { field: 'seasonNumber', label: 'Season Number', example: '5' },
    { field: 'episodeNumber', label: 'Episode Number', example: '16' },
    { field: 'episodeLabel', label: 'Episode Label', example: 'SERIES FINALE' },
    { field: 'isMonitored', label: 'Is Monitored', example: 'true' },
    { field: 'inRadarr', label: 'In Radarr', example: 'true' },
    { field: 'inSonarr', label: 'In Sonarr', example: 'true' },
    { field: 'downloaded', label: 'Downloaded', example: 'true' },
    { field: 'radarrTags', label: 'Radarr Tags', example: 'english-audio' },
    { field: 'sonarrTags', label: 'Sonarr Tags', example: 'german-audio' },
    {
      field: 'daysUntilAction',
      label: 'Days Until Maintainerr Action',
      example: '5',
    },
  ],
};

/**
 * Get template type based on condition field
 * Used for auto-categorization when creating new templates
 */
export function getTemplateTypeFromConditionField(field: string): string {
  // Check each category
  for (const [category, fields] of Object.entries(CONDITION_FIELD_CATEGORIES)) {
    if (fields.some((f) => f.field === field)) {
      switch (category) {
        case 'TMDB Data':
          return 'metadata';
        case 'Plex Data':
          return 'technical';
        case 'Ratings':
          return 'rating';
        case 'Status':
          return 'status';
      }
    }
  }
  return 'generic';
}

/**
 * Preview poster info from API
 */
export interface PreviewPosterInfo {
  id: string;
  type: 'movie' | 'tv';
  tmdbId: number;
  filename: string;
  url: string;
}

/**
 * Sample preview context for testing overlay templates (fallback if API fails)
 */
export const SAMPLE_PREVIEW_CONTEXTS: {
  movie: OverlayRenderContext;
  tv: OverlayRenderContext;
} = {
  movie: {
    title: 'The Matrix',
    year: 1999,
    imdbRating: 8.7,
    imdbTop250Rank: 19,
    isImdbTop250: true,
    rtCriticsScore: 88,
    rtAudienceScore: 85,
    rtCertifiedFresh: true,
    plexUserRating: 8,
    // metacriticScore: 73, // TODO: Implement Metacritic integration
    director: 'Lana Wachowski',
    studio: 'Warner Bros.',
    genre: 'Sci-Fi',
    resolution: '4K',
    width: 3840,
    height: 2160,
    aspectRatio: 2.35,
    videoCodec: 'hevc',
    videoProfile: 'main',
    videoFrameRate: '23.976',
    bitDepth: 10,
    hdr: true,
    dolbyVision: true,
    dolbyVisionProfile: 7,
    colorTrc: 'smpte2084',
    audioFormat: 'English (Dolby TrueHD Atmos 7.1)',
    audioCodec: 'truehd',
    audioChannels: 8,
    audioChannelLayout: '7.1',
    audioLanguage: 'English',
    audioLanguageCode: 'en',
    audioLanguages: ['English', 'German'],
    audioLanguageCodes: ['en', 'de'],
    subtitleLanguages: ['English', 'German', 'French'],
    subtitleLanguageCodes: ['en', 'de', 'fr'],
    hasSubtitles: true,
    container: 'mkv',
    bitrate: 15000,
    fileSize: 4500000000,
    viewCount: 5,
    daysSinceAdded: 14,
    daysSinceLastPlayed: 3,
    releaseDate: '2025-02-15', // Primary release date (digital)
    daysUntilRelease: 14,
    runtime: 136,
    runtimeHHMM: '2h 16m',
    isMonitored: true,
    inRadarr: true,
    downloaded: false,
    daysUntilAction: 5,
    isPlaceholder: true,
    mediaType: 'movie',
  },
  tv: {
    title: 'Breaking Bad',
    year: 2008,
    imdbRating: 9.5,
    imdbTop250Rank: 2,
    isImdbTop250: true,
    rtCriticsScore: 96,
    rtAudienceScore: 98,
    // rtCertifiedFresh not included - TV shows don't have Certified Fresh in RT API
    plexUserRating: 10,
    // metacriticScore: 96, // TODO: Implement Metacritic integration
    seasonNumber: 5,
    episodeNumber: 16,
    episodeLabel: 'SERIES FINALE',
    network: 'AMC',
    genre: 'Drama',
    runtime: 47,
    runtimeHHMM: '47m',
    tmdbStatus: 'ENDED',
    resolution: '1080p',
    width: 1920,
    height: 1080,
    aspectRatio: 1.78,
    videoCodec: 'h264',
    videoProfile: 'high',
    videoFrameRate: '23.976',
    bitDepth: 8,
    audioFormat: 'English (DTS-HD MA 5.1)',
    audioCodec: 'dts',
    audioChannels: 6,
    audioChannelLayout: '5.1',
    audioLanguage: 'English',
    audioLanguageCode: 'en',
    audioLanguages: ['English'],
    audioLanguageCodes: ['en'],
    subtitleLanguages: ['English', 'Spanish'],
    subtitleLanguageCodes: ['en', 'es'],
    hasSubtitles: true,
    container: 'mkv',
    bitrate: 8000,
    fileSize: 3000000000,
    viewCount: 12,
    daysSinceAdded: 120,
    daysSinceLastPlayed: 7,
    releaseDate: '2008-01-20', // Series premiere (NOT next episode)
    nextEpisodeAirDate: '2025-01-22', // Next episode (any episode, including mid-season)
    daysUntilNextEpisode: 7, // Days until next episode
    nextSeasonAirDate: '2025-02-05', // Next SEASON premiere (episode 1 only)
    daysUntilNextSeason: 45, // Days until next season
    daysAgoNextSeason: undefined, // Not set when season hasn't aired yet
    daysAgo: 0,
    isMonitored: true,
    inSonarr: true,
    downloaded: true,
    daysUntilAction: 12,
    isPlaceholder: false,
    mediaType: 'show',
  },
};
