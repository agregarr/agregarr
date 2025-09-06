export interface SourceColorScheme {
  primaryColor: string;
  secondaryColor: string;
  textColor: string;
  accentColor: string;
}

// Default color schemes based on collection source types
export const DEFAULT_SOURCE_COLORS: Record<string, SourceColorScheme> = {
  trakt: {
    primaryColor: '#ed2224',
    secondaryColor: '#1f1a1a',
    textColor: '#ffffff',
    accentColor: '#ff4444',
  },
  tmdb: {
    primaryColor: '#01b4e4',
    secondaryColor: '#0d253f',
    textColor: '#ffffff',
    accentColor: '#90cea1',
  },
  imdb: {
    primaryColor: '#f5c518',
    secondaryColor: '#1f1c0d',
    textColor: '#ffffff',
    accentColor: '#f5c518',
  },
  letterboxd: {
    primaryColor: '#2c3440',
    secondaryColor: '#1a1f24',
    textColor: '#ffffff',
    accentColor: '#00e054',
  },
  tautulli: {
    primaryColor: '#cc7b19',
    secondaryColor: '#1f1a15',
    textColor: '#ffffff',
    accentColor: '#ff9933',
  },
  overseerr: {
    primaryColor: '#5a5ce6',
    secondaryColor: '#1a1a2e',
    textColor: '#ffffff',
    accentColor: '#7b7dff',
  },
  hub: {
    primaryColor: '#e5a00d',
    secondaryColor: '#1f1c15',
    textColor: '#ffffff',
    accentColor: '#ffc107',
  },
  default: {
    primaryColor: '#6366f1',
    secondaryColor: '#1e1b4b',
    textColor: '#ffffff',
    accentColor: '#818cf8',
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
