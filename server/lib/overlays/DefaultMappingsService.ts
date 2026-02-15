import type { IconMapping } from '@server/entity/OverlayTemplate';
import fs from 'fs';
import path from 'path';

/**
 * Default icon mappings for each field type.
 * These are the system defaults that ship with the app.
 * Users can override these with their own mappings.
 */

// Base path for default mapped icons (served from /assets/mapped-icons/)
const MAPPED_ICONS_BASE = '/assets/mapped-icons';

/**
 * Get all available flag codes from the flags directory
 */
function getAvailableFlagCodes(): string[] {
  try {
    const flagsDir = path.join(
      process.cwd(),
      'public',
      'assets',
      'mapped-icons',
      'flags'
    );
    if (!fs.existsSync(flagsDir)) {
      return [];
    }
    const files = fs.readdirSync(flagsDir);
    return files
      .filter((f) => f.endsWith('.svg'))
      .map((f) => f.replace('.svg', ''));
  } catch {
    return [];
  }
}

/**
 * Get all available language codes from the languages directory
 */
function getAvailableLanguageCodes(): string[] {
  try {
    const languagesDir = path.join(
      process.cwd(),
      'public',
      'assets',
      'mapped-icons',
      'languages'
    );
    if (!fs.existsSync(languagesDir)) {
      return [];
    }
    const files = fs.readdirSync(languagesDir);
    return files
      .filter((f) => f.endsWith('.svg'))
      .map((f) => f.replace('.svg', ''));
  } catch {
    return [];
  }
}

/**
 * Get all available network names from the networks directory
 */
function getAvailableNetworks(): string[] {
  try {
    const networksDir = path.join(
      process.cwd(),
      'public',
      'assets',
      'mapped-icons',
      'networks'
    );
    if (!fs.existsSync(networksDir)) {
      return [];
    }
    const files = fs.readdirSync(networksDir);
    return files
      .filter((f) => f.endsWith('.png'))
      .map((f) => f.replace('.png', ''));
  } catch {
    return [];
  }
}

/**
 * Get all available studio names
 */
function getAvailableStudios(): string[] {
  try {
    const dir = path.join(
      process.cwd(),
      'public',
      'assets',
      'mapped-icons',
      'studios'
    );
    if (!fs.existsSync(dir)) {
      return [];
    }
    const files = fs.readdirSync(dir);
    return files
      .filter((f) => f.endsWith('.png'))
      .map((f) => f.replace('.png', ''));
  } catch {
    return [];
  }
}

/**
 * Get all available resolution names
 */
function getAvailableResolutions(): string[] {
  try {
    const dir = path.join(
      process.cwd(),
      'public',
      'assets',
      'mapped-icons',
      'resolution'
    );
    if (!fs.existsSync(dir)) {
      return [];
    }
    const files = fs.readdirSync(dir);
    return files
      .filter((f) => f.endsWith('.png'))
      .map((f) => f.replace('.png', ''));
  } catch {
    return [];
  }
}

/**
 * Get all available audio codec names
 */
function getAvailableAudioCodecs(): string[] {
  try {
    const dir = path.join(
      process.cwd(),
      'public',
      'assets',
      'mapped-icons',
      'audio-codec'
    );
    if (!fs.existsSync(dir)) {
      return [];
    }
    const files = fs.readdirSync(dir);
    return files
      .filter((f) => f.endsWith('.png'))
      .map((f) => f.replace('.png', ''));
  } catch {
    return [];
  }
}

/**
 * Build country flag mappings
 * Maps ISO 3166-1 alpha-2 country codes to flag icons
 * Since TMDB returns country codes like "US", "GB", "DE" and our flags are named
 * the same way (US.svg, GB.svg, DE.svg), this is a direct mapping
 */
function buildCountryFlagMappings(): IconMapping[] {
  const flagCodes = getAvailableFlagCodes();
  return flagCodes.map((code) => ({
    value: code, // ISO country code (e.g., "US", "GB", "DE")
    iconPath: `${MAPPED_ICONS_BASE}/flags/${code}.svg`,
  }));
}

/**
 * Build language code mappings
 * Maps ISO 639-1 language codes to language icons
 * Plex/TMDB uses lowercase codes like "en", "de", "fr"
 */
function buildLanguageMappings(): IconMapping[] {
  const languageCodes = getAvailableLanguageCodes();
  return languageCodes.map((code) => ({
    value: code, // ISO 639-1 language code (e.g., "en", "de", "fr")
    iconPath: `${MAPPED_ICONS_BASE}/languages/${code}.svg`,
  }));
}

/**
 * Build network mappings
 * Maps TV network names to network logo icons
 */
function buildNetworkMappings(): IconMapping[] {
  const networks = getAvailableNetworks();
  return networks.map((network) => ({
    value: network, // Network name (e.g., "HBO", "Netflix", "ABC")
    iconPath: `${MAPPED_ICONS_BASE}/networks/${network}.png`,
  }));
}

/**
 * Build studio mappings
 */
function buildStudioMappings(): IconMapping[] {
  const studios = getAvailableStudios();
  return studios.map((studio) => ({
    value: studio,
    iconPath: `${MAPPED_ICONS_BASE}/studios/${studio}.png`,
  }));
}

/**
 * Build resolution mappings
 */
function buildResolutionMappings(): IconMapping[] {
  const resolutions = getAvailableResolutions();
  return resolutions.map((res) => ({
    value: res,
    iconPath: `${MAPPED_ICONS_BASE}/resolution/${res}.png`,
  }));
}

/**
 * Build audio codec mappings
 */
function buildAudioCodecMappings(): IconMapping[] {
  const codecs = getAvailableAudioCodecs();
  return codecs.map((codec) => ({
    value: codec,
    iconPath: `${MAPPED_ICONS_BASE}/audio-codec/${codec}.png`,
  }));
}

/**
 * Get available country directories under content-ratings
 */
export function getAvailableContentRatingCountries(): string[] {
  try {
    const dir = path.join(
      process.cwd(),
      'public',
      'assets',
      'mapped-icons',
      'content-ratings'
    );
    if (!fs.existsSync(dir)) {
      return [];
    }
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/**
 * Build content rating mappings for a specific country
 * Scans /public/assets/mapped-icons/content-ratings/{country}/ for icon files
 */
function buildContentRatingMappings(country: string): IconMapping[] {
  try {
    const dir = path.join(
      process.cwd(),
      'public',
      'assets',
      'mapped-icons',
      'content-ratings',
      country
    );
    if (!fs.existsSync(dir)) {
      return [];
    }
    const files = fs.readdirSync(dir);
    return files
      .filter((f) => f.endsWith('.png') || f.endsWith('.svg'))
      .map((f) => ({
        value: f.replace(/\.(png|svg)$/, ''),
        iconPath: `${MAPPED_ICONS_BASE}/content-ratings/${country}/${f}`,
      }));
  } catch {
    return [];
  }
}

/**
 * Default mappings registry - organized by field name
 */
const DEFAULT_MAPPINGS: Record<string, IconMapping[]> = {
  // Country fields - use flag icons
  originCountry: buildCountryFlagMappings(),
  originCountries: buildCountryFlagMappings(),
  productionCountry: buildCountryFlagMappings(),
  productionCountries: buildCountryFlagMappings(),

  // Language fields - use language code icons (maps ISO 639-1 codes like "en", "de")
  audioLanguageCode: buildLanguageMappings(),
  audioLanguageCodes: buildLanguageMappings(),
  subtitleLanguageCodes: buildLanguageMappings(),

  // Network field - TV network logos
  network: buildNetworkMappings(),

  // Studio field - Movie/TV studio logos
  studio: buildStudioMappings(),

  // Resolution mappings
  resolution: buildResolutionMappings(),

  // Audio codec mappings
  audioCodec: buildAudioCodecMappings(),
};

/**
 * Get default mappings for a specific field
 * Handles dynamic contentRating:{country} fields
 */
export function getDefaultMappings(field: string): IconMapping[] {
  // Check static mappings first
  if (DEFAULT_MAPPINGS[field]) {
    return DEFAULT_MAPPINGS[field];
  }

  // Handle contentRating:{country} dynamically
  const contentRatingMatch = field.match(/^contentRating:(.+)$/);
  if (contentRatingMatch) {
    return buildContentRatingMappings(contentRatingMatch[1]);
  }

  return [];
}

/**
 * Get all fields that have default mappings
 */
export function getFieldsWithDefaults(): string[] {
  const staticFields = Object.keys(DEFAULT_MAPPINGS).filter(
    (key) => DEFAULT_MAPPINGS[key].length > 0
  );

  // Add content rating country fields
  const countries = getAvailableContentRatingCountries();
  const contentRatingFields = countries
    .filter((country) => buildContentRatingMappings(country).length > 0)
    .map((country) => `contentRating:${country}`);

  return [...staticFields, ...contentRatingFields];
}

/**
 * Check if a field has default mappings available
 */
export function hasDefaultMappings(field: string): boolean {
  if ((DEFAULT_MAPPINGS[field]?.length || 0) > 0) {
    return true;
  }

  // Handle contentRating:{country} dynamically
  const contentRatingMatch = field.match(/^contentRating:(.+)$/);
  if (contentRatingMatch) {
    return buildContentRatingMappings(contentRatingMatch[1]).length > 0;
  }

  return false;
}
