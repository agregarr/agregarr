import TheMovieDb from '@server/api/themoviedb';
import { getRepository } from '@server/datasource';
import type {
  ContentGridProps,
  LayeredElement,
  PersonElementProps,
  PosterTemplateData,
  RasterElementProps,
  SVGElementProps,
  TextElementProps,
} from '@server/entity/PosterTemplate';
import { PosterTemplate } from '@server/entity/PosterTemplate';
import { getTmdbLanguage } from '@server/lib/settings';
import logger from '@server/logger';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { loadIconFile } from './iconManager';
import { applyTemplate } from './posterTemplates';
import { sourceColorsService } from './services/SourceColorsService';

// Import Canvas with fallback handling
interface CanvasModule {
  createCanvas: (
    width: number,
    height: number
  ) => {
    getContext: (type: '2d') => {
      font: string;
      measureText: (text: string) => {
        width: number;
        fontBoundingBoxAscent?: number;
        fontBoundingBoxDescent?: number;
      };
    };
  };
}

let canvasModule: CanvasModule | null = null;
let canvasInitialized = false;

/**
 * Initialize canvas module with proper Fontconfig setup
 */
async function initializeCanvas(): Promise<void> {
  if (canvasInitialized) return;

  try {
    const canvas = await import('canvas');
    // Initialize Fontconfig properly before any font operations
    if (canvas && typeof canvas === 'object') {
      canvasModule = canvas as unknown as CanvasModule;
      canvasInitialized = true;
    }
  } catch (error) {
    logger.debug(
      'Canvas module not available, text measurement will use estimation fallback'
    );
    canvasInitialized = true; // Mark as attempted
  }
}

// Cache for base64 converted images to avoid re-processing
// Only cache local files (file:// URLs) to avoid memory bloat with TMDB URLs
const base64Cache = new Map<string, string>();
const MAX_CACHE_SIZE = 200; // Limit cache to 200 items

/**
 * Clear the base64 cache if it gets too large
 */
function maintainCacheSize(): void {
  if (base64Cache.size > MAX_CACHE_SIZE) {
    // Remove oldest entries (first in, first out)
    const keysToDelete = Array.from(base64Cache.keys()).slice(
      0,
      base64Cache.size - MAX_CACHE_SIZE
    );
    keysToDelete.forEach((key) => base64Cache.delete(key));
    logger.debug(`Cleared ${keysToDelete.length} items from base64 cache`);
  }
}

export interface PosterGenerationConfig {
  collectionName: string;
  collectionType?: string;
  collectionSubtype?: string;
  mediaType?: 'movie' | 'tv';
  template?: string;
  items?: CollectionItemWithPoster[];
  autoPosterTemplate?: number | null; // Template ID for auto-generated posters
  templateData?: PosterTemplateData; // Template data for customized colors and layout
  dynamicLogo?: string; // Path to dynamic logo file
  personImageUrl?: string; // Dynamic person image (e.g., director portrait)
  libraryId?: string; // Library ID for per-library TMDB language setting
}

export interface CollectionItemWithPoster {
  title: string;
  type: 'movie' | 'tv';
  tmdbId?: number;
  year?: number;
  posterUrl?: string;
  episodeInfo?: {
    season?: number;
    episode?: number;
    episodeTitle?: string;
  };
  metadata?: {
    libraryKey?: string;
    showTmdbId?: number;
    [key: string]: unknown;
  };
}

export interface ColorScheme {
  primaryColor: string;
  secondaryColor: string;
  textColor: string;
}

const POSTER_WIDTH = 1000;
const POSTER_HEIGHT = 1500;
const LOGO_SIZE = 60;
const ITEM_POSTER_WIDTH = 300; // Width for individual item posters in the grid
const ITEM_POSTER_HEIGHT = 450; // Height for individual item posters (1.5 aspect ratio)

// Path to service logos
const LOGOS_PATH = path.join(process.cwd(), 'public', 'services');

// Service type to logo file mapping
const SERVICE_LOGO_MAP: Record<string, string> = {
  trakt: 'trakt.svg',
  tmdb: 'tmdb.svg',
  imdb: 'imdb.svg',
  mdblist: 'mdblist.svg',
  letterboxd: 'letterboxd.svg',
  tautulli: 'tautulli.svg',
  overseerr: 'overseerr.svg',
  anilist: 'anilist.svg',
  myanimelist: 'myanimelist.svg',
  plex: 'plex.svg',
  'multi-source': 'os_icon.svg', // Use Agregarr icon for multi-source collections
  comingsoon: 'os_icon.svg', // Use Agregarr icon for coming soon collections
  radarrtag: 'radarr.svg', // Radarr tag collections use Radarr logo
  sonarrtag: 'sonarr.svg', // Sonarr tag collections use Sonarr logo
  // Streaming Platform Logo Mappings
  netflix: 'netflix.svg',
  hbo: 'hbo.svg',
  disney: 'disney.svg',
  'amazon-prime': 'amazon-prime.svg',
  'apple-tv': 'apple-tv.svg',
  paramount: 'paramount.svg',
  peacock: 'peacock.svg',
  crunchyroll: 'crunchyroll.svg',
  'discovery-plus': 'discovery-plus.svg',
  hulu: 'hulu.svg',
};

/**
 * Get color scheme for a collection type, with optional template customization
 */
async function getColorScheme(
  collectionType?: string,
  templateData?: PosterTemplateData
): Promise<ColorScheme> {
  // If template uses source colors, get from database/defaults
  if (templateData?.background?.useSourceColors) {
    return await sourceColorsService.getSourceColorScheme(collectionType);
  }

  // Template doesn't use source colors, use template's custom colors
  if (templateData?.background?.color) {
    return {
      primaryColor: templateData.background.color,
      secondaryColor:
        templateData.background.secondaryColor || templateData.background.color,
      textColor: '#ffffff', // Default text color for custom backgrounds
    };
  }

  // Final fallback to source colors service
  return await sourceColorsService.getSourceColorScheme(collectionType);
}

/**
 * Fetch poster URLs from TMDB for collection items
 */
async function fetchTMDbPosterUrls(
  items: CollectionItemWithPoster[],
  libraryId?: string
): Promise<CollectionItemWithPoster[]> {
  const language = await getTmdbLanguage(libraryId);
  const tmdb = new TheMovieDb({ originalLanguage: language });
  const itemsWithPosters: CollectionItemWithPoster[] = [];

  logger.debug(
    `Fetching TMDB posters for ${items.length} items with language: ${language}`
  );

  for (const item of items) {
    // Skip items that already have a poster URL (e.g., from local storage)
    if (item.posterUrl) {
      logger.debug(
        `Skipping ${item.title} - already has poster URL: ${item.posterUrl}`
      );
      itemsWithPosters.push(item);
      continue;
    }

    let posterUrl: string | undefined;

    logger.debug(`Processing item: ${item.title}`, {
      type: item.type,
      tmdbId: item.tmdbId,
      year: item.year,
    });

    if (item.tmdbId) {
      try {
        if (item.type === 'movie') {
          // Fetch images from TMDB images endpoint for proper language filtering
          const images = await tmdb.getMovieImages({
            movieId: item.tmdbId,
            language,
          });

          // Find poster in selected language, fallback to main poster from movie details
          const poster = images.posters.find((p) => p.iso_639_1 === language);

          if (poster) {
            posterUrl = `https://image.tmdb.org/t/p/w300${poster.file_path}`;
            logger.debug(
              `Found movie poster for ${item.title} (language: ${poster.iso_639_1}): ${posterUrl}`
            );
          } else {
            // Fallback to main poster from movie details
            const movie = await tmdb.getMovie({ movieId: item.tmdbId });
            if (movie.poster_path) {
              posterUrl = `https://image.tmdb.org/t/p/w300${movie.poster_path}`;
              logger.debug(
                `Using default movie poster for ${item.title}: ${posterUrl}`
              );
            } else {
              logger.debug(`No poster found for movie ${item.title}`);
            }
          }
        } else if (item.type === 'tv') {
          // Check if this is an episode with season info and show TMDB ID
          if (item.episodeInfo?.season && item.metadata?.showTmdbId) {
            // For episodes/seasons, fall back to the show's poster
            // (TMDB doesn't have per-season images endpoint)
            const images = await tmdb.getTvShowImages({
              tvId: item.metadata.showTmdbId,
              language,
            });

            const poster = images.posters.find((p) => p.iso_639_1 === language);

            if (poster) {
              posterUrl = `https://image.tmdb.org/t/p/w300${poster.file_path}`;
              logger.debug(
                `Found show poster for episode ${item.title} (language: ${poster.iso_639_1}): ${posterUrl}`
              );
            } else {
              // Fallback to main poster from TV show details
              const tvShow = await tmdb.getTvShow({
                tvId: item.metadata.showTmdbId,
              });
              if (tvShow.poster_path) {
                posterUrl = `https://image.tmdb.org/t/p/w300${tvShow.poster_path}`;
                logger.debug(
                  `Using default show poster for episode ${item.title}: ${posterUrl}`
                );
              } else {
                logger.debug(`No poster found for episode ${item.title}`);
              }
            }
          } else {
            // This is a regular TV show (not an episode)
            const images = await tmdb.getTvShowImages({
              tvId: item.tmdbId,
              language,
            });

            const poster = images.posters.find((p) => p.iso_639_1 === language);

            if (poster) {
              posterUrl = `https://image.tmdb.org/t/p/w300${poster.file_path}`;
              logger.debug(
                `Found TV poster for ${item.title} (language: ${poster.iso_639_1}): ${posterUrl}`
              );
            } else {
              // Fallback to main poster from TV show details
              const tvShow = await tmdb.getTvShow({ tvId: item.tmdbId });
              if (tvShow.poster_path) {
                posterUrl = `https://image.tmdb.org/t/p/w300${tvShow.poster_path}`;
                logger.debug(
                  `Using default TV poster for ${item.title}: ${posterUrl}`
                );
              } else {
                logger.debug(`No poster found for TV show ${item.title}`);
              }
            }
          }
        }
      } catch (error) {
        logger.warn(`Failed to fetch TMDB poster for ${item.title}:`, error);
      }
    } else {
      logger.debug(`No TMDB ID available for ${item.title}`);
    }

    // Only include items that have a valid poster URL
    // Items without posters are excluded so next items in list can fill the grid
    if (posterUrl) {
      itemsWithPosters.push({ ...item, posterUrl });
    } else {
      logger.debug(
        `Excluding ${item.title} from poster grid - no poster available from TMDb`
      );
    }
  }

  logger.debug(
    `Returning ${itemsWithPosters.length} items with valid posters (from ${items.length} total items)`
  );
  return itemsWithPosters;
}

/**
 * Download and convert image to base64 for SVG embedding with retry logic
 * Preserves transparency for PNG images
 */
async function downloadImageAsBase64(
  url: string,
  retries = 2
): Promise<string | null> {
  // Handle data URIs directly (already encoded)
  if (url.startsWith('data:')) {
    return url;
  }

  // Check cache first
  if (base64Cache.has(url)) {
    const cachedResult = base64Cache.get(url);
    if (cachedResult !== undefined) {
      logger.debug(`Using cached base64 for: ${url}`);
      return cachedResult;
    }
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      let buffer: Buffer;

      // Handle local file:// URLs
      if (url.startsWith('file://')) {
        const filePath = url.replace('file://', '');
        if (!fs.existsSync(filePath)) {
          logger.warn(`Local poster file not found: ${filePath}`);
          return null;
        }
        buffer = fs.readFileSync(filePath);
        logger.debug(`Read local file: ${filePath}`);
      } else {
        // Handle remote HTTP/HTTPS URLs
        const response = await axios.get(url, {
          responseType: 'arraybuffer',
          timeout: 10000, // 10 second timeout
          headers: {
            'User-Agent': 'Agregarr/1.0',
          },
        });
        buffer = Buffer.from(response.data);
      }

      // Check if image has alpha channel (transparency)
      const image = sharp(buffer);
      const metadata = await image.metadata();
      const hasAlpha =
        metadata.channels === 4 ||
        (metadata.channels === 2 && metadata.format === 'png');

      let processedBuffer: Buffer;
      let mimeType: string;

      if (hasAlpha || metadata.format === 'png') {
        // Preserve transparency by using PNG format
        processedBuffer = await image
          .png({ quality: 90, compressionLevel: 6 })
          .resize(ITEM_POSTER_WIDTH, ITEM_POSTER_HEIGHT, {
            fit: 'cover',
            position: 'center',
          })
          .toBuffer();
        mimeType = 'image/png';
      } else {
        // Use JPEG for images without transparency
        processedBuffer = await image
          .jpeg({ quality: 85 })
          .resize(ITEM_POSTER_WIDTH, ITEM_POSTER_HEIGHT, {
            fit: 'cover',
            position: 'center',
          })
          .toBuffer();
        mimeType = 'image/jpeg';
      }

      const base64Result = `data:${mimeType};base64,${processedBuffer.toString(
        'base64'
      )}`;

      // Only cache local files to avoid memory bloat
      if (url.startsWith('file://')) {
        base64Cache.set(url, base64Result);
        maintainCacheSize();
      }

      return base64Result;
    } catch (error) {
      if (attempt < retries) {
        const delay = Math.pow(2, attempt) * 1000; // Exponential backoff: 1s, 2s
        logger.debug(
          `Retrying image download in ${delay}ms (attempt ${attempt + 1}/${
            retries + 1
          }): ${url}`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        logger.warn(
          `Failed to download image after ${retries + 1} attempts ${url}:`,
          error
        );
        return null;
      }
    }
  }
  return null;
}

/**
 * Load SVG logo content from filesystem
 */
async function loadServiceLogo(serviceType: string): Promise<string | null> {
  try {
    const logoFilename = SERVICE_LOGO_MAP[serviceType.toLowerCase()];
    if (!logoFilename) {
      logger.debug(
        `No logo mapping found for service type: ${serviceType}, using Agregarr logo as fallback`
      );
      // Fallback to Agregarr logo for unknown source types
      const fallbackLogoPath = path.join(LOGOS_PATH, 'os_icon.svg');
      if (fs.existsSync(fallbackLogoPath)) {
        const svgContent = await fs.promises.readFile(fallbackLogoPath, 'utf8');
        return svgContent;
      }
      return null;
    }

    const logoPath = path.join(LOGOS_PATH, logoFilename);
    if (!fs.existsSync(logoPath)) {
      logger.warn(`Logo file not found: ${logoPath}`);
      return null;
    }

    const svgContent = await fs.promises.readFile(logoPath, 'utf8');
    logger.debug(`Loaded logo for service type: ${serviceType}`, { logoPath });
    return svgContent;
  } catch (error) {
    logger.warn(`Failed to load logo for service type: ${serviceType}`, error);
    return null;
  }
}

/**
 * Load dynamic logo from FlixPatrol extraction (PNG file)
 */
async function loadDynamicLogo(
  dynamicLogoPath: string
): Promise<string | null> {
  try {
    if (!fs.existsSync(dynamicLogoPath)) {
      logger.debug(`Dynamic logo file not found: ${dynamicLogoPath}`);
      return null;
    }

    // Convert PNG to base64 data URI and embed in SVG
    const logoBuffer = await fs.promises.readFile(dynamicLogoPath);
    const base64Data = logoBuffer.toString('base64');
    const mimeType = 'image/png';

    // Create an SVG wrapper for the PNG image
    const svgContent = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50" width="50" height="50">
        <image href="data:${mimeType};base64,${base64Data}" width="50" height="50" x="0" y="0"/>
      </svg>
    `;

    logger.debug(`Loaded dynamic logo: ${dynamicLogoPath}`);
    return svgContent.trim();
  } catch (error) {
    logger.warn(`Failed to load dynamic logo: ${dynamicLogoPath}`, error);
    return null;
  }
}

/**
 * Create a logo placeholder for services without SVG logos
 */
// Legacy function - kept for potential future use
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function createLogoPlaceholder(serviceType: string): Promise<string> {
  const letter = serviceType.charAt(0).toUpperCase();
  const colorScheme = await getColorScheme(serviceType);

  return `
    <circle cx="0" cy="0" r="${LOGO_SIZE / 2}"
            fill="${colorScheme.primaryColor}" opacity="0.8"/>
    <text x="0" y="6"
          font-family="Arial, sans-serif" font-size="24" font-weight="bold"
          text-anchor="middle" dominant-baseline="central" fill="${
            colorScheme.textColor
          }">
      ${letter}
    </text>
  `;
}

/**
 * Escape XML/SVG special characters in text
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;') // Must be first
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Cache for text width measurements to avoid re-measuring
const textWidthCache = new Map<string, number>();
const MAX_TEXT_CACHE_SIZE = 1000;

/**
 * Clear text width cache if it gets too large
 */
function maintainTextWidthCacheSize(): void {
  if (textWidthCache.size > MAX_TEXT_CACHE_SIZE) {
    // Remove oldest entries (first half)
    const keysToDelete = Array.from(textWidthCache.keys()).slice(
      0,
      Math.floor(textWidthCache.size / 2)
    );
    keysToDelete.forEach((key) => textWidthCache.delete(key));
    logger.debug(`Cleared ${keysToDelete.length} items from text width cache`);
  }
}

/**
 * Get accurate text width using Node.js Canvas API
 * Falls back to estimation if Canvas measurement fails
 */
function getTextWidth(
  text: string,
  fontSize: number,
  fontFamily = 'Arial',
  fontWeight = 'normal'
): number {
  // Create cache key
  const cacheKey = `${text}|${fontSize}|${fontFamily}|${fontWeight}`;

  // Check cache first
  if (textWidthCache.has(cacheKey)) {
    const cachedValue = textWidthCache.get(cacheKey);
    if (cachedValue !== undefined) {
      return cachedValue;
    }
  }

  // Initialize canvas module if needed
  initializeCanvas();

  // Check if canvas module is available
  if (canvasModule && canvasModule.createCanvas) {
    try {
      // Use Canvas for accurate measurement
      const canvas = canvasModule.createCanvas(1, 1); // Small canvas just for text measurement
      const ctx = canvas.getContext('2d');

      // Set font properties - quote font family if it contains spaces (same as SVG)
      const quotedFontFamily = fontFamily.includes(' ')
        ? `'${fontFamily}'`
        : fontFamily;
      const fontStyle = `${fontWeight} ${fontSize}px ${quotedFontFamily}`;
      ctx.font = fontStyle;

      // Measure text width
      const metrics = ctx.measureText(text);
      const measuredWidth = metrics.width;

      // Add 5% safety margin for accurate measurement
      const finalWidth = measuredWidth * 1.05;

      // Cache the result
      textWidthCache.set(cacheKey, finalWidth);
      maintainTextWidthCacheSize();

      logger.debug(
        `Measured text width: "${text}" with font "${fontStyle}" = ${finalWidth}px`
      );
      return finalWidth;
    } catch (error) {
      // Fallback to estimation if Canvas measurement fails
      logger.warn(
        `Canvas text measurement failed, falling back to estimation:`,
        error
      );
      return getEstimatedTextWidth(text, fontSize);
    }
  } else {
    // Canvas not available, use estimation
    logger.debug(
      `Canvas module not available, using text width estimation for: "${text}"`
    );
    return getEstimatedTextWidth(text, fontSize);
  }
}

/**
 * Get actual font metrics for precise vertical positioning
 */
function getFontMetrics(
  fontSize: number,
  fontFamily = 'Arial',
  fontWeight = 'normal'
): { ascent: number; descent: number; height: number } {
  // Initialize canvas module if needed
  initializeCanvas();

  // Check if canvas module is available
  if (canvasModule && canvasModule.createCanvas) {
    try {
      // Use Canvas for accurate font measurement
      const canvas = canvasModule.createCanvas(1, 1); // Small canvas just for font measurement
      const ctx = canvas.getContext('2d');

      // Set font properties - quote font family if it contains spaces (same as SVG)
      const quotedFontFamily = fontFamily.includes(' ')
        ? `'${fontFamily}'`
        : fontFamily;
      const fontStyle = `${fontWeight} ${fontSize}px ${quotedFontFamily}`;
      ctx.font = fontStyle;

      // Measure a representative character to get font metrics
      const metrics = ctx.measureText('Àj'); // Character with ascender and descender

      // Extract font metrics from TextMetrics (Node Canvas supports these)
      if (metrics.fontBoundingBoxAscent && metrics.fontBoundingBoxDescent) {
        return {
          ascent: metrics.fontBoundingBoxAscent,
          descent: metrics.fontBoundingBoxDescent,
          height:
            metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent,
        };
      }

      // Fallback: estimate from font size for older canvas implementations
      return {
        ascent: fontSize * 0.8, // Typical ascender ratio
        descent: fontSize * 0.2, // Typical descender ratio
        height: fontSize,
      };
    } catch (error) {
      // Fallback to estimation if Canvas measurement fails
      logger.warn(
        `Canvas font metrics measurement failed, falling back to estimation:`,
        error
      );
    }
  }

  // Final fallback: estimate from font size
  return {
    ascent: fontSize * 0.8,
    descent: fontSize * 0.2,
    height: fontSize,
  };
}

/**
 * Fallback text width estimation for when Canvas measurement is unavailable
 */
function getEstimatedTextWidth(text: string, fontSize: number): number {
  // Conservative character width estimation that works across different fonts
  let totalWidth = 0;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    let charWidth = 0.6; // Conservative default

    // Simplified character width categories for cross-font compatibility
    if (char === ' ') {
      charWidth = 0.3; // Space
    } else if (/[.,;:!]/.test(char)) {
      charWidth = 0.3; // Punctuation
    } else if (/['""`]/.test(char)) {
      charWidth = 0.25; // Quotes
    } else if (/[il1|]/.test(char)) {
      charWidth = 0.3; // Narrow characters
    } else if (/[fjtI]/.test(char)) {
      charWidth = 0.4; // Semi-narrow characters
    } else if (/[MW@]/.test(char)) {
      charWidth = 0.9; // Wide characters
    } else if (/[mw]/.test(char)) {
      charWidth = 0.8; // Medium-wide lowercase
    } else if (/[ABCDEFGHIJKLNOPQRSTUVXYZ]/.test(char)) {
      charWidth = 0.7; // Regular uppercase
    } else if (/[abcdefghknopqrsuvxyz]/.test(char)) {
      charWidth = 0.6; // Regular lowercase
    } else if (/[0-9]/.test(char)) {
      charWidth = 0.6; // Numbers (most fonts use tabular figures)
    } else {
      charWidth = 0.65; // Everything else (symbols, etc.)
    }

    totalWidth += charWidth * fontSize;
  }

  // Add 25% safety margin to account for font differences and prevent clipping
  return totalWidth * 1.25;
}

/**
 * Wrap text to fit within specified width, keeping whole words intact
 */
function wrapTextKeepWords(
  text: string,
  maxWidth: number,
  fontSize: number,
  fontFamily = 'Arial',
  fontWeight = 'normal'
): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const lineWidth = getTextWidth(testLine, fontSize, fontFamily, fontWeight);

    if (lineWidth <= maxWidth) {
      currentLine = testLine;
    } else {
      // Line would be too wide, start a new line
      if (currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        // Single word is too wide, but keep it anyway
        currentLine = word;
      }
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [text];
}

/**
 * Create wrapped text with template-driven positioning and typography
 */
function createTemplateWrappedText(
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fontSize: number,
  color: string,
  fontFamily: string,
  fontWeight: string,
  fontStyle: string,
  textAlign: string,
  maxLines: number
): string {
  // Start with the given font size and shrink if needed
  let currentFontSize = fontSize;
  let lines: string[] = [];
  let limitedLines: string[] = [];
  let lineHeight: number;
  let totalTextHeight: number;

  // Iteratively reduce font size until text fits within height bounds
  do {
    lines = wrapTextKeepWords(
      text,
      width,
      currentFontSize,
      fontFamily,
      fontWeight
    );
    limitedLines = lines.slice(0, maxLines);
    lineHeight = currentFontSize * 1.1;
    totalTextHeight = limitedLines.length * lineHeight;

    // If text fits within height, we're done
    if (totalTextHeight <= height) {
      break;
    }

    // Otherwise, reduce font size by 5% and try again
    currentFontSize *= 0.95;

    // Prevent infinite loop - minimum font size of 8px
    if (currentFontSize < 8) {
      break;
    }
  } while (totalTextHeight > height);

  // Calculate precise visual centering using actual font metrics
  const fontMetrics = getFontMetrics(currentFontSize, fontFamily, fontWeight);

  // Calculate the actual visual height of all text lines using font metrics
  const totalVisualHeight =
    (limitedLines.length - 1) * lineHeight + fontMetrics.height;

  // Center the visual text content within the available height
  const visualCenterY = y + (height - totalVisualHeight) / 2;
  const textBlockStartY = visualCenterY; // Position at top edge (text-before-edge matches Fabric.js originY: 'top')

  let textAnchor = 'start';
  let textX = x;
  if (textAlign === 'center') {
    textAnchor = 'middle';
    textX = x + width / 2;
  } else if (textAlign === 'right') {
    textAnchor = 'end';
    textX = x + width;
  }

  return limitedLines
    .map((line, index) => {
      const lineY = textBlockStartY + index * lineHeight;
      return `
        <text x="${textX}" y="${lineY}"
              font-family="'${fontFamily}'"
              font-size="${currentFontSize}"
              font-weight="${fontWeight}"
              font-style="${fontStyle}"
              text-anchor="${textAnchor}"
              dominant-baseline="text-before-edge"
              fill="${color}"
              filter="url(#textShadow)">
          ${escapeXml(line)}
        </text>
      `;
    })
    .join('');
}

/**
 * Embed service logo with template-driven positioning and sizing
 */
function embedTemplateServiceLogo(
  logoSvg: string,
  x: number,
  y: number,
  width: number,
  height: number,
  grayscale: boolean
): string {
  const grayscaleFilter = grayscale ? 'filter="grayscale(100%)"' : '';

  // Extract actual logo dimensions from SVG
  let logoWidth = 100; // fallback
  let logoHeight = 100; // fallback

  // Try to get dimensions from viewBox first (most reliable)
  const viewBoxMatch = logoSvg.match(/viewBox=["']([^"']+)["']/i);
  if (viewBoxMatch) {
    const viewBoxValues = viewBoxMatch[1].split(/[\s,]+/);
    if (viewBoxValues.length >= 4) {
      logoWidth = parseFloat(viewBoxValues[2]) - parseFloat(viewBoxValues[0]);
      logoHeight = parseFloat(viewBoxValues[3]) - parseFloat(viewBoxValues[1]);
    }
  } else {
    // Fallback to width/height attributes
    const widthMatch = logoSvg.match(/width=["']?([^"'\s>]+)/i);
    const heightMatch = logoSvg.match(/height=["']?([^"'\s>]+)/i);
    if (widthMatch) logoWidth = parseFloat(widthMatch[1]);
    if (heightMatch) logoHeight = parseFloat(heightMatch[1]);
  }

  // Calculate scale to fit height (Y dimension) while maintaining aspect ratio
  const scaleY = height / logoHeight;
  const scale = scaleY; // Scale to match template height, let width adjust to maintain aspect ratio

  // Calculate final dimensions and centering offset
  const scaledWidth = logoWidth * scale;
  const scaledHeight = logoHeight * scale;
  const offsetX = (width - scaledWidth) / 2;
  const offsetY = (height - scaledHeight) / 2;

  // Clean the SVG content by removing XML declaration, comments, DOCTYPE, and SVG tags
  const cleanSvgContent = logoSvg
    .replace(/<\?xml[^>]*\?>/gi, '') // Remove XML declaration
    .replace(/<!--[\s\S]*?-->/gi, '') // Remove comments
    .replace(/<!DOCTYPE[^>]*>/gi, '') // Remove DOCTYPE
    .replace(/<svg[^>]*>|<\/svg>/gi, '') // Remove SVG tags
    .trim();

  return `
    <g transform="translate(${x + offsetX}, ${
    y + offsetY
  }) scale(${scale})" ${grayscaleFilter}>
      ${cleanSvgContent}
    </g>
  `;
}

/**
 * Create logo placeholder with template-driven positioning
 */
function createTemplateLogoPlaceholder(
  serviceType: string,
  centerX: number,
  centerY: number,
  width: number,
  height: number
): string {
  const displayName =
    serviceType.charAt(0).toUpperCase() + serviceType.slice(1);
  const fontSize = Math.min(width / 6, height / 6);

  return `
    <g transform="translate(${centerX}, ${centerY})">
      <!-- Placeholder circle -->
      <circle r="${Math.min(width, height) / 3}"
              fill="rgba(255,255,255,0.1)"
              stroke="rgba(255,255,255,0.2)"
              stroke-width="2"/>
      <!-- Placeholder text -->
      <text text-anchor="middle"
            dominant-baseline="central"
            font-family="Helvetica Neue, Segoe UI, Arial, sans-serif"
            font-size="${fontSize}"
            font-weight="600"
            fill="rgba(255,255,255,0.7)">
        ${escapeXml(displayName)}
      </text>
    </g>
  `;
}

/**
 * Generate background content from template data
 */
async function generateTemplateBackground(
  backgroundConfig: {
    type: 'color' | 'gradient' | 'radial';
    color?: string;
    secondaryColor?: string;
    intensity?: number;
    useSourceColors?: boolean;
  },
  colorScheme: ColorScheme
): Promise<{ defs: string; background: string }> {
  if (backgroundConfig.type === 'gradient') {
    const primaryColor = backgroundConfig.useSourceColors
      ? colorScheme.primaryColor
      : backgroundConfig.color || '#6366f1';
    const secondaryColor = backgroundConfig.useSourceColors
      ? colorScheme.secondaryColor
      : backgroundConfig.secondaryColor || primaryColor;

    return {
      defs: `
        <linearGradient id="templateGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:${secondaryColor};stop-opacity:1" />
          <stop offset="40%" style="stop-color:${primaryColor};stop-opacity:0.85" />
          <stop offset="100%" style="stop-color:${secondaryColor};stop-opacity:1" />
        </linearGradient>
      `,
      background: `<rect width="${POSTER_WIDTH}" height="${POSTER_HEIGHT}" fill="url(#templateGradient)"/>`,
    };
  } else if (backgroundConfig.type === 'radial') {
    const primaryColor = backgroundConfig.useSourceColors
      ? colorScheme.primaryColor
      : backgroundConfig.color || '#6366f1';
    const secondaryColor = backgroundConfig.useSourceColors
      ? colorScheme.secondaryColor
      : backgroundConfig.secondaryColor || primaryColor;

    // Calculate radius based on intensity (0-100)
    const intensity = (backgroundConfig.intensity || 50) / 100;
    const radiusPercent = 30 + intensity * 70; // 30% to 100% based on intensity

    return {
      defs: `
        <radialGradient id="templateRadialGradient" cx="50%" cy="50%" r="${radiusPercent}%">
          <stop offset="0%" style="stop-color:${primaryColor};stop-opacity:1" />
          <stop offset="100%" style="stop-color:${secondaryColor};stop-opacity:1" />
        </radialGradient>
      `,
      background: `<rect width="${POSTER_WIDTH}" height="${POSTER_HEIGHT}" fill="url(#templateRadialGradient)"/>`,
    };
  } else {
    // Solid color background
    const backgroundColor = backgroundConfig.useSourceColors
      ? colorScheme.primaryColor
      : backgroundConfig.color || '#6366f1';

    return {
      defs: '',
      background: `<rect width="${POSTER_WIDTH}" height="${POSTER_HEIGHT}" fill="${backgroundColor}"/>`,
    };
  }
}

/**
 * Generate text elements from template data
 */
async function generateTemplateTextElements(
  textElements: {
    id: string;
    type: 'collection-title' | 'custom-text';
    text?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    fontSize: number;
    fontFamily: string;
    fontWeight: string;
    fontStyle: string;
    color: string;
    textAlign: string;
    maxLines?: number;
    textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  }[],
  collectionName: string
): Promise<string> {
  const elements: string[] = [];

  for (const element of textElements) {
    const text =
      element.type === 'collection-title' ? collectionName : element.text || '';
    const transform = element.textTransform || 'none';
    const applyTransform = (value: string): string => {
      switch (transform) {
        case 'uppercase':
          return value.toUpperCase();
        case 'lowercase':
          return value.toLowerCase();
        case 'capitalize':
          return value.replace(/\b\w/g, (c) => c.toUpperCase());
        default:
          return value;
      }
    };
    const finalText = applyTransform(text);

    // Handle text wrapping based on element dimensions
    // Use line height (fontSize * 1.1) for accurate calculation to match createTemplateWrappedText
    const lineHeight = element.fontSize * 1.1;
    const maxLines =
      element.maxLines || Math.floor(element.height / lineHeight);
    const wrappedText = createTemplateWrappedText(
      finalText,
      element.x,
      element.y,
      element.width,
      element.height,
      element.fontSize,
      element.color,
      element.fontFamily,
      element.fontWeight,
      element.fontStyle,
      element.textAlign,
      maxLines
    );

    elements.push(wrappedText);
  }

  return elements.join('');
}

/**
 * Generate content grid from template data
 */
async function generateTemplateContentGrid(
  gridConfig: {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    columns: number;
    rows: number;
    spacing: number;
    cornerRadius: number;
  },
  itemsWithPosters: CollectionItemWithPoster[]
): Promise<string> {
  if (!itemsWithPosters.length) return '';

  const { x, y, width, height, columns, rows, spacing, cornerRadius } =
    gridConfig;
  const maxItems = columns * rows;
  const items = itemsWithPosters.slice(0, maxItems);

  // Calculate individual item dimensions
  const itemWidth = (width - spacing * (columns - 1)) / columns;
  const itemHeight = (height - spacing * (rows - 1)) / rows;

  const gridElements: string[] = [];

  items.forEach((item, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const itemX = x + col * (itemWidth + spacing);
    const itemY = y + row * (itemHeight + spacing);

    if (item.posterUrl) {
      gridElements.push(`
        <g transform="translate(${itemX}, ${itemY})" filter="url(#contentShadow)">
          <!-- Poster shadow -->
          <rect x="2" y="4"
                width="${itemWidth}"
                height="${itemHeight}"
                fill="rgba(0,0,0,0.2)"
                rx="${cornerRadius}"/>
          <!-- Poster image -->
          <image xlink:href="${item.posterUrl}"
                 x="0" y="0"
                 width="${itemWidth}"
                 height="${itemHeight}"
                 preserveAspectRatio="xMidYMid slice"/>
          <!-- Border -->
          <rect x="0" y="0"
                width="${itemWidth}"
                height="${itemHeight}"
                fill="none"
                stroke="rgba(255,255,255,0.15)"
                stroke-width="1"
                rx="${cornerRadius}"/>
        </g>
      `);
    } else {
      // Fallback placeholder
      gridElements.push(`
        <g transform="translate(${itemX}, ${itemY})">
          <!-- Placeholder shadow -->
          <rect x="2" y="4"
                width="${itemWidth}"
                height="${itemHeight}"
                fill="rgba(0,0,0,0.15)"
                rx="${cornerRadius}"/>
          <!-- Placeholder background -->
          <rect x="0" y="0"
                width="${itemWidth}"
                height="${itemHeight}"
                fill="rgba(255,255,255,0.08)"
                stroke="rgba(255,255,255,0.15)"
                stroke-width="1"
                rx="${cornerRadius}"/>
          <!-- Placeholder text -->
          <text x="${itemWidth / 2}" y="${itemHeight / 2}"
                font-family="Helvetica Neue, Segoe UI, Arial, sans-serif"
                font-size="${Math.min(itemWidth / 8, itemHeight / 12)}"
                font-weight="500"
                text-anchor="middle"
                fill="rgba(255,255,255,0.5)"
                dominant-baseline="central">
            ${escapeXml(
              item.title.length > 14
                ? item.title.substring(0, 14) + '...'
                : item.title
            )}
          </text>
        </g>
      `);
    }
  });

  return gridElements.join('');
}

/**
 * Embed a raster icon (PNG/JPG) in SVG format
 */
async function embedRasterIconInSVG(
  iconPath: string,
  element: {
    x: number;
    y: number;
    width: number;
    height: number;
    cornerRadius?: number;
  }
): Promise<string | null> {
  try {
    const urlMatch = iconPath.match(/\/api\/v1\/posters\/icons\/(\w+)\/(.+)/);
    if (!urlMatch) {
      logger.warn(`Icon path does not match expected format: ${iconPath}`);
      return null;
    }

    const [, iconType, filename] = urlMatch;

    // Only process non-SVG files in this function
    if (filename.toLowerCase().endsWith('.svg')) {
      return null;
    }

    const buffer = await loadIconFile(filename, iconType as 'user' | 'system');

    // Check if image has alpha channel (transparency)
    const image = sharp(buffer);
    const metadata = await image.metadata();
    const hasAlpha =
      metadata.channels === 4 ||
      (metadata.channels === 2 && metadata.format === 'png');

    let processedBuffer: Buffer;
    let mimeType: string;

    if (hasAlpha || metadata.format === 'png') {
      // Preserve transparency by using PNG format
      processedBuffer = await image
        .png({ quality: 90, compressionLevel: 6 })
        .resize(Math.round(element.width), Math.round(element.height), {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .toBuffer();
      mimeType = 'image/png';
    } else {
      // Use JPEG for images without transparency
      processedBuffer = await image
        .jpeg({ quality: 85 })
        .resize(Math.round(element.width), Math.round(element.height), {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .toBuffer();
      mimeType = 'image/jpeg';
    }

    const base64 = processedBuffer.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64}`;

    const result = `
      <image
        x="${element.x}"
        y="${element.y}"
        width="${element.width}"
        height="${element.height}"
        xlink:href="${dataUrl}"
        preserveAspectRatio="xMidYMid meet"
        ${
          element.cornerRadius
            ? `rx="${element.cornerRadius}" ry="${element.cornerRadius}"`
            : ''
        }
      />
    `;

    return result;
  } catch (error) {
    logger.error(`Failed to embed raster icon ${iconPath}:`, error);
    return null;
  }
}

/**
 * Embed an SVG icon in SVG format
 */
async function embedSVGIconInSVG(
  iconPath: string,
  element: {
    x: number;
    y: number;
    width: number;
    height: number;
  }
): Promise<string | null> {
  try {
    const urlMatch = iconPath.match(/\/api\/v1\/posters\/icons\/(\w+)\/(.+)/);
    if (!urlMatch) {
      logger.warn(`SVG icon path does not match expected format: ${iconPath}`);
      return null;
    }

    const [, iconType, filename] = urlMatch;

    // Only process SVG files in this function
    if (!filename.toLowerCase().endsWith('.svg')) {
      return null;
    }

    const buffer = await loadIconFile(filename, iconType as 'user' | 'system');
    const svgContent = buffer.toString('utf-8');

    // Extract actual SVG dimensions and viewBox from the SVG
    let svgWidth = 100; // fallback
    let svgHeight = 100; // fallback
    let viewBoxMinX = 0;
    let viewBoxMinY = 0;

    // Try to get dimensions from viewBox first (most reliable)
    const viewBoxMatch = svgContent.match(/viewBox=["']([^"']+)["']/i);
    if (viewBoxMatch) {
      const viewBoxValues = viewBoxMatch[1].split(/[\s,]+/);
      if (viewBoxValues.length >= 4) {
        viewBoxMinX = parseFloat(viewBoxValues[0]);
        viewBoxMinY = parseFloat(viewBoxValues[1]);
        svgWidth = parseFloat(viewBoxValues[2]);
        svgHeight = parseFloat(viewBoxValues[3]);
      }
    } else {
      // Fallback to width/height attributes
      const widthMatch = svgContent.match(/width=["']?([^"'\s>]+)/i);
      const heightMatch = svgContent.match(/height=["']?([^"'\s>]+)/i);
      if (widthMatch) svgWidth = parseFloat(widthMatch[1]);
      if (heightMatch) svgHeight = parseFloat(heightMatch[1]);
    }

    // Calculate scale to fit the element dimensions while maintaining aspect ratio
    const scaleX = element.width / svgWidth;
    const scaleY = element.height / svgHeight;
    const scale = Math.min(scaleX, scaleY); // Use minimum to ensure it fits within bounds

    // Calculate final dimensions and centering offset
    const scaledWidth = svgWidth * scale;
    const scaledHeight = svgHeight * scale;
    const offsetX = (element.width - scaledWidth) / 2;
    const offsetY = (element.height - scaledHeight) / 2;

    // Extract the inner content (remove outer <svg> tag)
    const svgMatch = svgContent.match(/<svg[^>]*>(.*)<\/svg>/s);
    const innerSvg = svgMatch ? svgMatch[1] : svgContent;

    // Clean the SVG content by removing XML declaration, comments, and DOCTYPE
    const cleanInnerSvg = innerSvg
      .replace(/<\?xml[^>]*\?>/gi, '') // Remove XML declaration
      .replace(/<!--[\s\S]*?-->/gi, '') // Remove comments
      .replace(/<!DOCTYPE[^>]*>/gi, '') // Remove DOCTYPE
      .trim();

    // Build transform: translate to position, scale, then translate viewBox offset
    // This ensures the SVG's coordinate system is properly aligned
    const result = `
      <g transform="translate(${element.x + offsetX}, ${
      element.y + offsetY
    }) scale(${scale}) translate(${-viewBoxMinX}, ${-viewBoxMinY})">
        ${cleanInnerSvg}
      </g>
    `;

    return result;
  } catch (error) {
    logger.error(`Failed to embed SVG icon ${iconPath}:`, error);
    return null;
  }
}

/**
 * Generate raster elements from the new separated data structure
 */
async function generateRasterElements(
  rasterElements: {
    id: string;
    type: 'raster-image';
    imagePath: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }[]
): Promise<string> {
  const elements: string[] = [];

  for (const element of rasterElements) {
    try {
      const iconContent = await embedRasterIconInSVG(
        element.imagePath,
        element
      );
      if (iconContent) {
        const wrappedContent = `<g filter="url(#iconShadow)">${iconContent}</g>`;
        elements.push(wrappedContent);
      } else {
        logger.warn(
          `Failed to embed raster icon for element ${element.id}: ${element.imagePath}`
        );
      }
    } catch (error) {
      logger.warn(`Failed to embed raster image ${element.imagePath}:`, error);
    }
  }

  return elements.join('');
}

/**
 * Generate SVG elements from the new separated data structure
 */
async function generateSVGElements(
  svgElements: {
    id: string;
    type: 'source-logo' | 'svg-icon' | 'custom-icon';
    iconPath?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    grayscale: boolean;
  }[],
  collectionType?: string,
  dynamicLogo?: string
): Promise<string> {
  const elements: string[] = [];

  for (const element of svgElements) {
    if (element.type === 'source-logo' && collectionType) {
      // Priority: Local SVG service logo first, then dynamic logo as fallback
      let logoSvg = await loadServiceLogo(collectionType);

      // If no local SVG found and we have a dynamic logo, use that
      if (!logoSvg && dynamicLogo) {
        logoSvg = await loadDynamicLogo(dynamicLogo);
      }

      if (logoSvg) {
        const logoContent = embedTemplateServiceLogo(
          logoSvg,
          element.x,
          element.y,
          element.width,
          element.height,
          element.grayscale
        );
        elements.push(`<g filter="url(#iconShadow)">${logoContent}</g>`);
      } else {
        // Placeholder if no logo found
        const placeholder = createTemplateLogoPlaceholder(
          collectionType,
          element.x + element.width / 2,
          element.y + element.height / 2,
          element.width,
          element.height
        );
        elements.push(`<g filter="url(#iconShadow)">${placeholder}</g>`);
      }
    } else if (
      (element.type === 'svg-icon' || element.type === 'custom-icon') &&
      element.iconPath
    ) {
      // Handle custom SVG icons
      try {
        const iconContent = await embedSVGIconInSVG(element.iconPath, element);
        if (iconContent) {
          const wrappedContent = `<g filter="url(#iconShadow)">${iconContent}</g>`;
          elements.push(wrappedContent);
        }
      } catch (error) {
        logger.warn(`Failed to embed SVG icon ${element.iconPath}:`, error);
      }
    }
  }

  return elements.join('');
}

/**
 * Generate unified layered elements from the new layering system
 */
async function generateUnifiedLayeredElements(
  elements: LayeredElement[],
  collectionName: string,
  collectionType?: string,
  dynamicLogo?: string,
  itemsWithPosters: CollectionItemWithPoster[] = [],
  personImageBase64?: string,
  personImageUrl?: string
): Promise<string> {
  // Sort elements by layer order to ensure proper rendering sequence
  const sortedElements = [...elements].sort(
    (a, b) => a.layerOrder - b.layerOrder
  );

  const renderedElements: string[] = [];

  for (const element of sortedElements) {
    try {
      let elementContent = '';

      switch (element.type) {
        case 'raster': {
          const props = element.properties as RasterElementProps;
          elementContent = await generateRasterElement(element, props);
          break;
        }
        case 'svg': {
          const props = element.properties as SVGElementProps;
          elementContent = await generateSVGElement(
            element,
            props,
            collectionType,
            dynamicLogo
          );
          break;
        }
        case 'text': {
          const props = element.properties as TextElementProps;
          elementContent = await generateTextElement(
            element,
            props,
            collectionName
          );
          break;
        }
        case 'content-grid': {
          const props = element.properties as ContentGridProps;
          elementContent = await generateContentGridElement(
            element,
            props,
            itemsWithPosters
          );
          break;
        }
        case 'person': {
          const props = element.properties as PersonElementProps;
          elementContent = await generatePersonElement(
            element,
            props,
            personImageBase64,
            personImageUrl
          );
          break;
        }
      }

      if (elementContent) {
        // Apply rotation if specified
        if (element.rotation && element.rotation !== 0) {
          // Calculate rotation center (center of element bounding box)
          const centerX = element.x + element.width / 2;
          const centerY = element.y + element.height / 2;

          // Wrap element in a group with rotation transform
          elementContent = `<g transform="rotate(${element.rotation} ${centerX} ${centerY})">${elementContent}</g>`;
        }

        renderedElements.push(elementContent);
      }
    } catch (error) {
      logger.warn(
        `Failed to render element ${element.id} of type ${element.type}:`,
        error
      );
    }
  }

  return renderedElements.join('');
}

/**
 * Generate raster element content
 */
async function generateRasterElement(
  element: LayeredElement,
  props: RasterElementProps
): Promise<string> {
  if (!props.imagePath) {
    return '';
  }

  return await generateRasterElements([
    {
      id: element.id,
      type: 'raster-image',
      imagePath: props.imagePath,
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
    },
  ]);
}

/**
 * Generate person element content (e.g., director portrait backdrops)
 */
async function generatePersonElement(
  element: LayeredElement,
  props: PersonElementProps,
  personImageBase64?: string,
  personImageUrl?: string
): Promise<string> {
  const imageHref = personImageBase64 || personImageUrl || props.imagePath;

  if (!imageHref) {
    return '';
  }

  const overlayOpacity = Math.min(1, Math.max(0, props.overlayOpacity ?? 0.55));
  const overlayColor = props.overlayColor || 'rgba(0,0,0,0.6)';

  return `
    <g>
      <image xlink:href="${imageHref}"
             x="${element.x}" y="${element.y}"
             width="${element.width}" height="${element.height}"
             preserveAspectRatio="xMidYMid slice"/>
      ${
        overlayOpacity > 0
          ? `<rect x="${element.x}" y="${element.y}"
                   width="${element.width}" height="${element.height}"
                   fill="${overlayColor}"
                   opacity="${overlayOpacity}"/>`
          : ''
      }
    </g>
  `;
}

/**
 * Generate SVG element content
 */
async function generateSVGElement(
  element: LayeredElement,
  props: SVGElementProps,
  collectionType?: string,
  dynamicLogo?: string
): Promise<string> {
  return await generateSVGElements(
    [
      {
        id: element.id,
        type: props.iconType,
        iconPath: props.iconPath,
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        grayscale: props.grayscale,
      },
    ],
    collectionType,
    dynamicLogo
  );
}

/**
 * Generate text element content
 */
async function generateTextElement(
  element: LayeredElement,
  props: TextElementProps,
  collectionName: string
): Promise<string> {
  return await generateTemplateTextElements(
    [
      {
        id: element.id,
        type: props.elementType,
        text: props.text,
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        fontSize: props.fontSize,
        fontFamily: props.fontFamily,
        fontWeight: props.fontWeight,
        fontStyle: props.fontStyle,
        color: props.color,
        textAlign: props.textAlign,
        maxLines: props.maxLines,
        textTransform: props.textTransform,
      },
    ],
    collectionName
  );
}

/**
 * Generate content grid element content
 */
async function generateContentGridElement(
  element: LayeredElement,
  props: ContentGridProps,
  itemsWithPosters: CollectionItemWithPoster[]
): Promise<string> {
  return await generateTemplateContentGrid(
    {
      id: element.id,
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      columns: props.columns,
      rows: props.rows,
      spacing: props.spacing,
      cornerRadius: props.cornerRadius,
    },
    itemsWithPosters
  );
}

/**
 * Generate SVG poster content with new unified layering system or legacy layout
 */
export async function generatePosterSVG(
  config: PosterGenerationConfig
): Promise<string> {
  const { collectionName, collectionType, items = [], templateData } = config;

  // Template data is required for the new system
  if (!templateData) {
    throw new Error('Template data is required for poster generation');
  }

  // Get color scheme from template data
  const colorScheme = await getColorScheme(collectionType, templateData);

  // Fetch and prepare collection items for content grid

  // Fetch poster URLs if items are provided and there's a content grid
  let itemsWithPosters: CollectionItemWithPoster[] = [];
  let hasContentGrid = false;

  // Check for content grid in unified elements
  if (templateData.elements) {
    hasContentGrid = templateData.elements.some(
      (el) => el.type === 'content-grid'
    );
  }

  if (items.length > 0 && hasContentGrid) {
    try {
      // Find grid config to determine max items
      let maxItems = 12; // Default fallback

      if (templateData.elements) {
        const gridElement = templateData.elements.find(
          (el) => el.type === 'content-grid'
        );
        if (gridElement) {
          const gridProps = gridElement.properties as ContentGridProps;
          maxItems = gridProps.columns * gridProps.rows;
        }
      }

      // Fetch more items than needed to account for items without posters
      // This ensures we fill the grid even if some items don't have TMDb posters
      const fetchLimit = Math.min(items.length, maxItems * 2);
      const allFetchedItems = await fetchTMDbPosterUrls(
        items.slice(0, fetchLimit),
        config.libraryId
      );

      // Take only the items we need for the grid (already filtered to have posters)
      itemsWithPosters = allFetchedItems.slice(0, maxItems);

      // Download and convert images to base64 for embedding
      for (const item of itemsWithPosters) {
        if (item.posterUrl) {
          const originalUrl = item.posterUrl;
          const base64Image = await downloadImageAsBase64(originalUrl);
          if (base64Image) {
            item.posterUrl = base64Image;
            logger.debug(`Successfully converted to base64: ${item.title}`);
          } else {
            // Keep original TMDB URL as fallback when base64 conversion fails
            logger.debug(`Using fallback URL for: ${item.title}`);
            item.posterUrl = originalUrl;
          }
        }
      }
    } catch (error) {
      logger.warn('Failed to fetch poster URLs for items:', error);
    }
  }

  // Fetch person image for person layers if provided
  let personImageBase64: string | undefined;
  if (config.personImageUrl) {
    try {
      personImageBase64 =
        (await downloadImageAsBase64(config.personImageUrl)) || undefined;
    } catch (error) {
      logger.warn('Failed to fetch person image for poster:', error);
    }
  }

  // Generate background based on template data
  const backgroundContent = await generateTemplateBackground(
    templateData.background,
    colorScheme
  );

  // Auto-migrate templates to unified system and use unified layering system
  const migratedTemplateData =
    templateData.migrated && templateData.elements
      ? templateData
      : templateData; // Auto-migration happens in PosterTemplate.getTemplateData()

  // Force all templates to use unified layering system
  if (!migratedTemplateData.elements) {
    throw new Error(
      'Template data must have unified elements array. Auto-migration should have occurred.'
    );
  }

  logger.debug('Using unified layering system for rendering');
  const elementsContent = await generateUnifiedLayeredElements(
    migratedTemplateData.elements,
    collectionName,
    collectionType,
    config.dynamicLogo,
    itemsWithPosters,
    personImageBase64,
    config.personImageUrl
  );

  return `
    <svg width="${POSTER_WIDTH}" height="${POSTER_HEIGHT}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
      <defs>
        <filter id="textShadow">
          <feDropShadow dx="1" dy="2" stdDeviation="2" flood-color="#000000" flood-opacity="0.4"/>
        </filter>
        <filter id="iconShadow">
          <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#000000" flood-opacity="0.2"/>
        </filter>
        <filter id="contentShadow">
          <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000000" flood-opacity="0.25"/>
        </filter>
        ${backgroundContent.defs}
      </defs>

      <!-- Layer 1: Background -->
      ${backgroundContent.background}

      <!-- Elements (unified or legacy layered) -->
      ${elementsContent}
    </svg>
  `;
}

/**
 * Generate a poster image buffer from configuration
 */
export async function generatePosterBuffer(
  config: PosterGenerationConfig
): Promise<Buffer> {
  try {
    logger.info('Generating poster', {
      name: config.collectionName,
      type: config.collectionType,
      subtype: config.collectionSubtype,
      mediaType: config.mediaType,
      templateId: config.autoPosterTemplate,
    });

    // Template-based poster generation (undefined/null = default template, number = specific template)
    try {
      let templateId = config.autoPosterTemplate;

      // If autoPosterTemplate is undefined or null, find and use the default template
      if (
        config.autoPosterTemplate === undefined ||
        config.autoPosterTemplate === null
      ) {
        const templateRepository = getRepository(PosterTemplate);

        const defaultTemplate = await templateRepository.findOne({
          where: { isDefault: true, isActive: true },
          order: { updatedAt: 'DESC' },
        });

        if (!defaultTemplate) {
          logger.warn(
            'No default template found, falling back to legacy SVG generation'
          );
          // Fall through to default SVG generation
        } else {
          templateId = defaultTemplate.id;
          logger.debug('Using default template for poster generation', {
            templateId: defaultTemplate.id,
            templateName: defaultTemplate.name,
          });
        }
      }

      // Generate using template system if we have a valid template ID
      if (templateId) {
        const buffer = await applyTemplate(templateId, {
          collectionName: config.collectionName,
          collectionType: config.collectionType || 'custom',
          mediaType: config.mediaType || 'movie',
          items: config.items || [],
          dynamicLogo: config.dynamicLogo,
          personImageUrl: config.personImageUrl,
        });

        logger.info('Poster generated successfully using template', {
          name: config.collectionName,
          templateId,
          bufferSize: buffer.length,
        });

        return buffer;
      } else {
        throw new Error('No valid template ID found for poster generation');
      }
    } catch (templateError) {
      logger.error('Failed to generate poster using template', {
        templateId: config.autoPosterTemplate,
        error:
          templateError instanceof Error
            ? templateError.message
            : String(templateError),
      });
      throw new Error(
        `Template generation failed: ${
          templateError instanceof Error
            ? templateError.message
            : String(templateError)
        }`
      );
    }
  } catch (error) {
    logger.error('Failed to generate poster', {
      config,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error('Failed to generate poster');
  }
}

/**
 * Get a cache key for poster generation configuration (legacy - now using hash-based filenames)
 */
export function getPosterCacheKey(config: PosterGenerationConfig): string {
  const configString = JSON.stringify({
    name: config.collectionName,
    type: config.collectionType || '',
    subtype: config.collectionSubtype || '',
    mediaType: config.mediaType || '',
    template: config.template || '',
  });

  // Simple hash for cache key (used for logging/debugging only)
  let hash = 0;
  for (let i = 0; i < configString.length; i++) {
    const char = configString.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }

  return `generated_${Math.abs(hash).toString(36)}`;
}
