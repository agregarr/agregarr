import TheMovieDb from '@server/api/themoviedb';
import type { PosterTemplateData } from '@server/entity/PosterTemplate';
import logger from '@server/logger';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { applyTemplate } from './posterTemplates';
import { sourceColorsService } from './services/SourceColorsService';

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
}

export interface CollectionItemWithPoster {
  title: string;
  type: 'movie' | 'tv';
  tmdbId?: number;
  year?: number;
  posterUrl?: string;
}

export interface ColorScheme {
  primaryColor: string;
  secondaryColor: string;
  textColor: string;
}

const POSTER_WIDTH = 500;
const POSTER_HEIGHT = 750;
const LOGO_SIZE = 60;
const ITEM_POSTER_WIDTH = 150; // Width for individual item posters in the grid
const ITEM_POSTER_HEIGHT = 225; // Height for individual item posters (1.5 aspect ratio)

// Path to service logos
const LOGOS_PATH = path.join(process.cwd(), 'public', 'services');

// Service type to logo file mapping
const SERVICE_LOGO_MAP: Record<string, string> = {
  trakt: 'trakt.svg',
  tmdb: 'tmdb.svg',
  imdb: 'imdb.svg',
  letterboxd: 'letterboxd.svg',
  tautulli: 'tautulli.svg',
  overseerr: 'overseerr.svg',
  plex: 'plex.svg',
  'multi-source': 'os_icon.svg', // Use Agregarr icon for multi-source collections
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
  items: CollectionItemWithPoster[]
): Promise<CollectionItemWithPoster[]> {
  const tmdb = new TheMovieDb();
  const itemsWithPosters: CollectionItemWithPoster[] = [];

  logger.debug(`Fetching TMDB posters for ${items.length} items`);

  for (const item of items) {
    let posterUrl: string | undefined;

    logger.debug(`Processing item: ${item.title}`, {
      type: item.type,
      tmdbId: item.tmdbId,
      year: item.year,
    });

    if (item.tmdbId) {
      try {
        if (item.type === 'movie') {
          const movieDetails = await tmdb.getMovie({ movieId: item.tmdbId });
          if (movieDetails.poster_path) {
            posterUrl = `https://image.tmdb.org/t/p/w300${movieDetails.poster_path}`;
            logger.debug(`Found movie poster for ${item.title}: ${posterUrl}`);
          } else {
            logger.debug(`No poster_path found for movie ${item.title}`);
          }
        } else if (item.type === 'tv') {
          const tvDetails = await tmdb.getTvShow({ tvId: item.tmdbId });
          if (tvDetails.poster_path) {
            posterUrl = `https://image.tmdb.org/t/p/w300${tvDetails.poster_path}`;
            logger.debug(`Found TV poster for ${item.title}: ${posterUrl}`);
          } else {
            logger.debug(`No poster_path found for TV show ${item.title}`);
          }
        }
      } catch (error) {
        logger.warn(`Failed to fetch TMDB poster for ${item.title}:`, error);
      }
    } else {
      logger.debug(`No TMDB ID available for ${item.title}`);
    }

    itemsWithPosters.push({ ...item, posterUrl });
  }

  logger.debug(
    `Returning ${itemsWithPosters.length} items, ${
      itemsWithPosters.filter((i) => i.posterUrl).length
    } with posters`
  );
  return itemsWithPosters;
}

/**
 * Download and convert image to base64 for SVG embedding with retry logic
 */
async function downloadImageAsBase64(
  url: string,
  retries = 2
): Promise<string | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 10000, // 10 second timeout
        headers: {
          'User-Agent': 'Agregarr/1.0',
        },
      });
      const buffer = Buffer.from(response.data);

      // Convert to JPEG and resize to optimize
      const processedBuffer = await sharp(buffer)
        .jpeg({ quality: 85 })
        .resize(ITEM_POSTER_WIDTH, ITEM_POSTER_HEIGHT, {
          fit: 'cover',
          position: 'center',
        })
        .toBuffer();

      return `data:image/jpeg;base64,${processedBuffer.toString('base64')}`;
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
      logger.debug(`No logo mapping found for service type: ${serviceType}`);
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
          text-anchor="middle" fill="${colorScheme.textColor}">
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

/**
 * Get actual text width using a more accurate character width mapping for Arial Bold
 */
function getTextWidth(text: string, fontSize: number): number {
  // Conservative character width estimation for Arial Bold
  // Using generous values to prevent clipping - better to wrap early than clip
  const charWidths: Record<string, number> = {
    // Wide characters - increased significantly
    M: 0.85,
    W: 1.1,
    m: 0.85,
    w: 0.85,
    // Medium-wide characters - increased
    A: 0.8,
    B: 0.8,
    C: 0.85,
    D: 0.85,
    G: 0.9,
    H: 0.85,
    N: 0.85,
    O: 0.9,
    Q: 0.9,
    R: 0.85,
    U: 0.85,
    V: 0.8,
    X: 0.8,
    Y: 0.8,
    Z: 0.8,
    a: 0.7,
    b: 0.7,
    c: 0.65,
    d: 0.7,
    e: 0.7,
    g: 0.7,
    h: 0.7,
    n: 0.7,
    o: 0.7,
    p: 0.7,
    q: 0.7,
    r: 0.45,
    u: 0.7,
    v: 0.65,
    x: 0.65,
    y: 0.65,
    z: 0.65,
    // Numbers - increased
    '0': 0.7,
    '1': 0.7,
    '2': 0.7,
    '3': 0.7,
    '4': 0.7,
    '5': 0.7,
    '6': 0.7,
    '7': 0.7,
    '8': 0.7,
    '9': 0.7,
    // Medium characters - increased
    E: 0.8,
    F: 0.75,
    I: 0.4,
    J: 0.65,
    K: 0.8,
    L: 0.7,
    P: 0.8,
    S: 0.8,
    T: 0.75,
    f: 0.4,
    i: 0.35,
    j: 0.35,
    k: 0.65,
    l: 0.35,
    s: 0.65,
    t: 0.4,
    // Special characters - increased
    ' ': 0.4,
    '.': 0.4,
    ',': 0.4,
    ':': 0.4,
    ';': 0.4,
    '!': 0.4,
    '?': 0.7,
    '&': 0.8,
    "'": 0.3,
    '"': 0.5,
    '-': 0.45,
    _: 0.7,
    '(': 0.45,
    ')': 0.45,
    '[': 0.4,
    ']': 0.4,
    '{': 0.45,
    '}': 0.45,
    '|': 0.35,
    '/': 0.4,
    '\\': 0.4,
    '@': 1.2,
    '#': 0.7,
    $: 0.7,
    '%': 1.0,
    '^': 0.6,
    '*': 0.5,
    '+': 0.7,
    '=': 0.7,
    '<': 0.7,
    '>': 0.7,
  };

  let totalWidth = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const charWidth = charWidths[char] || 0.7; // More generous default for unknown characters
    totalWidth += charWidth * fontSize;
  }

  // Add 10% safety margin to prevent clipping
  return totalWidth * 1.1;
}

/**
 * Wrap text to fit within specified width, keeping whole words intact
 */
function wrapTextKeepWords(
  text: string,
  maxWidth: number,
  fontSize: number
): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const lineWidth = getTextWidth(testLine, fontSize);

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
    lines = wrapTextKeepWords(text, width, currentFontSize);
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

  // Calculate vertical centering - center the text block within the available height
  const textBlockStartY = y + (height - totalTextHeight) / 2 + currentFontSize;

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
              font-family="${fontFamily}"
              font-size="${currentFontSize}"
              font-weight="${fontWeight}"
              font-style="${fontStyle}"
              text-anchor="${textAnchor}"
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
    type: 'color' | 'gradient';
    color?: string;
    secondaryColor?: string;
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
  }[],
  collectionName: string
): Promise<string> {
  const elements: string[] = [];

  for (const element of textElements) {
    const text =
      element.type === 'collection-title' ? collectionName : element.text || '';

    // Handle text wrapping based on element dimensions
    const maxLines =
      element.maxLines || Math.floor(element.height / element.fontSize);
    const wrappedText = createTemplateWrappedText(
      text,
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
 * Generate icon elements from template data
 */
async function generateTemplateIconElements(
  iconElements: {
    id: string;
    type: 'source-logo' | 'custom-icon';
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

  for (const element of iconElements) {
    if (element.type === 'source-logo' && collectionType) {
      // Priority: Local assets first, then dynamic logo as fallback
      let logoSvg = await loadServiceLogo(collectionType);

      // If no local asset found and we have a dynamic logo, use that
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
        // Fallback placeholder
        const placeholder = createTemplateLogoPlaceholder(
          collectionType,
          element.x + element.width / 2,
          element.y + element.height / 2,
          element.width,
          element.height
        );
        elements.push(`<g filter="url(#iconShadow)">${placeholder}</g>`);
      }
    } else if (element.type === 'custom-icon' && element.iconPath) {
      // Handle custom icons (future feature)
      // For now, skip custom icons
    }
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
 * Generate SVG poster content with new layout
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

  // Fetch poster URLs if items are provided
  let itemsWithPosters: CollectionItemWithPoster[] = [];
  if (items.length > 0 && templateData.contentGrid) {
    try {
      // Limit items to what the grid can display
      const maxItems =
        templateData.contentGrid.columns * templateData.contentGrid.rows;
      itemsWithPosters = await fetchTMDbPosterUrls(items.slice(0, maxItems));

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

  // Generate background based on template data
  const backgroundContent = await generateTemplateBackground(
    templateData.background,
    colorScheme
  );

  // Generate text elements from template data
  const textElements = await generateTemplateTextElements(
    templateData.textElements,
    collectionName
  );

  // Generate icon elements from template data
  const iconElements = await generateTemplateIconElements(
    templateData.iconElements,
    collectionType,
    config.dynamicLogo
  );

  // Generate content grid from template data
  const contentGridContent = templateData.contentGrid
    ? await generateTemplateContentGrid(
        templateData.contentGrid,
        itemsWithPosters
      )
    : '';

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

      <!-- Background -->
      ${backgroundContent.background}

      <!-- Text elements -->
      ${textElements}

      <!-- Icon elements -->
      ${iconElements}

      <!-- Content grid -->
      ${contentGridContent}
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

    // If template-based poster generation is enabled (null = default template, number = specific template)
    if (config.autoPosterTemplate !== undefined) {
      try {
        let templateId = config.autoPosterTemplate;

        // If autoPosterTemplate is null, find and use the default template
        if (config.autoPosterTemplate === null) {
          const { getRepository } = await import('@server/datasource');
          const { PosterTemplate } = await import(
            '@server/entity/PosterTemplate'
          );
          const templateRepository = getRepository(PosterTemplate);

          const defaultTemplate = await templateRepository.findOne({
            where: { isDefault: true, isActive: true },
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
          });

          logger.info('Poster generated successfully using template', {
            name: config.collectionName,
            templateId,
            bufferSize: buffer.length,
          });

          return buffer;
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
    }

    // If no autoPosterTemplate specified, this should not happen in the current system
    throw new Error(
      'No auto poster template specified - all poster generation must use templates'
    );
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
