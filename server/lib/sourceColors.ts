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
  hub: {
    primaryColor: '#e5a00d',
    secondaryColor: '#1f1c15',
    textColor: '#ffffff',
  },
  default: {
    primaryColor: '#6366f1',
    secondaryColor: '#1e1b4b',
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
