export interface SourceColorScheme {
  primaryColor: string;
  secondaryColor: string;
  textColor: string;
}

// Default color schemes based on collection source types
export const DEFAULT_SOURCE_COLORS: Record<string, SourceColorScheme> = {
  trakt: {
    primaryColor: '#ed2224',
    secondaryColor: '#1f1a1a',
    textColor: '#ffffff',
  },
  tmdb: {
    primaryColor: '#01b4e4',
    secondaryColor: '#0d253f',
    textColor: '#ffffff',
  },
  imdb: {
    primaryColor: '#f5c518',
    secondaryColor: '#1f1c0d',
    textColor: '#ffffff',
  },
  letterboxd: {
    primaryColor: '#2c3440',
    secondaryColor: '#1a1f24',
    textColor: '#ffffff',
  },
  mdblist: {
    primaryColor: '#4283c9',
    secondaryColor: '#1a2e42',
    textColor: '#ffffff',
  },
  tautulli: {
    primaryColor: '#cc7b19',
    secondaryColor: '#1f1a15',
    textColor: '#ffffff',
  },
  overseerr: {
    primaryColor: '#5a5ce6',
    secondaryColor: '#1a1a2e',
    textColor: '#ffffff',
  },
  anilist: {
    primaryColor: '#02a9ff',
    secondaryColor: '#0d1f2e',
    textColor: '#ffffff',
  },
  myanimelist: {
    primaryColor: '#2e51a2',
    secondaryColor: '#0d1a2e',
    textColor: '#ffffff',
  },
  hub: {
    primaryColor: '#e5a00d',
    secondaryColor: '#1f1c15',
    textColor: '#ffffff',
  },
  // Streaming Platform Color Schemes
  netflix: {
    primaryColor: '#e50914',
    secondaryColor: '#1a0c0d',
    textColor: '#ffffff',
  },
  hbo: {
    primaryColor: '#9146ff',
    secondaryColor: '#1a1625',
    textColor: '#ffffff',
  },
  disney: {
    primaryColor: '#113ccf',
    secondaryColor: '#0d1a24',
    textColor: '#ffffff',
  },
  'amazon-prime': {
    primaryColor: '#00a8e1',
    secondaryColor: '#0d1a21',
    textColor: '#ffffff',
  },
  'apple-tv': {
    primaryColor: '#1d1d1f',
    secondaryColor: '#161617',
    textColor: '#ffffff',
  },
  paramount: {
    primaryColor: '#0064ff',
    secondaryColor: '#0d1a2e',
    textColor: '#ffffff',
  },
  peacock: {
    primaryColor: '#005da0',
    secondaryColor: '#0d1920',
    textColor: '#ffffff',
  },
  crunchyroll: {
    primaryColor: '#ff6c00',
    secondaryColor: '#1f1512',
    textColor: '#ffffff',
  },
  'discovery-plus': {
    primaryColor: '#005aff',
    secondaryColor: '#0d1a2e',
    textColor: '#ffffff',
  },
  hulu: {
    primaryColor: '#1ce783',
    secondaryColor: '#0d1f16',
    textColor: '#ffffff',
  },
  max: {
    primaryColor: '#0024ff',
    secondaryColor: '#0d1326',
    textColor: '#ffffff',
  },
  discovery: {
    primaryColor: '#005aff',
    secondaryColor: '#0d1a2e',
    textColor: '#ffffff',
  },
  'multi-source': {
    primaryColor: '#e65100', // Agregarr orange/brand color
    secondaryColor: '#1c1917', // Matches UI bg-stone-900
    textColor: '#ffffff',
  },
  comingsoon: {
    primaryColor: '#e65100', // Agregarr orange/brand color
    secondaryColor: '#1c1917', // Matches UI bg-stone-900
    textColor: '#ffffff',
  },
  radarrtag: {
    primaryColor: '#ffc230', // Radarr yellow/gold
    secondaryColor: '#1f1c0d',
    textColor: '#ffffff',
  },
  sonarrtag: {
    primaryColor: '#2c7fb8', // Sonarr blue
    secondaryColor: '#0d1a2e',
    textColor: '#ffffff',
  },
  default: {
    primaryColor: '#e65100', // Agregarr orange/brand color (fallback for unknown sources)
    secondaryColor: '#1c1917', // Matches UI bg-stone-900
    textColor: '#ffffff',
  },
};

/**
 * Get color scheme for a source type, with fallback to custom colors
 */
export function getSourceColorScheme(
  sourceType?: string,
  customSourceColors?: Record<string, SourceColorScheme>
): SourceColorScheme {
  if (!sourceType) return DEFAULT_SOURCE_COLORS.default;

  // Use custom colors if provided, otherwise fall back to defaults
  const customColors = customSourceColors?.[sourceType.toLowerCase()];
  if (customColors) {
    return customColors;
  }

  return (
    DEFAULT_SOURCE_COLORS[sourceType.toLowerCase()] ||
    DEFAULT_SOURCE_COLORS.default
  );
}

/**
 * Get all available source types
 */
export function getAvailableSourceTypes(): string[] {
  return Object.keys(DEFAULT_SOURCE_COLORS).filter((key) => key !== 'default');
}
