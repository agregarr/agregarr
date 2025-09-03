import TheMovieDb from '@server/api/themoviedb';
import logger from '@server/logger';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

export interface PosterGenerationConfig {
  collectionName: string;
  collectionType?: string;
  collectionSubtype?: string;
  mediaType?: 'movie' | 'tv';
  template?: string;
  items?: CollectionItemWithPoster[];
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
  accentColor: string;
}

// Color schemes based on collection types
const COLOR_SCHEMES: Record<string, ColorScheme> = {
  trakt: {
    primaryColor: '#ed2224',
    secondaryColor: '#1f1a1a', // Consistent gentle dark with red tint
    textColor: '#ffffff',
    accentColor: '#ff4444',
  },
  tmdb: {
    primaryColor: '#01b4e4',
    secondaryColor: '#0d253f', // Already good - gentle dark blue
    textColor: '#ffffff',
    accentColor: '#90cea1',
  },
  imdb: {
    primaryColor: '#f5c518',
    secondaryColor: '#1f1c0d', // Changed from pure black to gentle dark with yellow tint
    textColor: '#ffffff', // Changed to white for better contrast
    accentColor: '#f5c518',
  },
  letterboxd: {
    primaryColor: '#2c3440',
    secondaryColor: '#1a1f24', // Slightly adjusted for consistency
    textColor: '#ffffff',
    accentColor: '#00e054',
  },
  tautulli: {
    primaryColor: '#cc7b19',
    secondaryColor: '#1f1a15', // Consistent gentle dark with orange tint
    textColor: '#ffffff',
    accentColor: '#ff9933',
  },
  overseerr: {
    primaryColor: '#5a5ce6',
    secondaryColor: '#1a1a2e', // Already good - gentle dark purple
    textColor: '#ffffff',
    accentColor: '#7b7dff',
  },
  hub: {
    primaryColor: '#e5a00d',
    secondaryColor: '#1f1c15', // Consistent gentle dark with yellow tint
    textColor: '#ffffff',
    accentColor: '#ffc107',
  },
  default: {
    primaryColor: '#6366f1',
    secondaryColor: '#1e1b4b', // Already good - gentle dark indigo
    textColor: '#ffffff',
    accentColor: '#818cf8',
  },
};

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
};

/**
 * Get color scheme for a collection type
 */
function getColorScheme(collectionType?: string): ColorScheme {
  if (!collectionType) return COLOR_SCHEMES.default;
  return COLOR_SCHEMES[collectionType.toLowerCase()] || COLOR_SCHEMES.default;
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

  for (const item of items.slice(0, 4)) {
    // Only fetch first 4 items
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
 * Create a logo placeholder for services without SVG logos
 */
function createLogoPlaceholder(serviceType: string): string {
  const letter = serviceType.charAt(0).toUpperCase();
  const colorScheme = getColorScheme(serviceType);

  return `
    <circle cx="0" cy="0" r="${LOGO_SIZE / 2}" 
            fill="${colorScheme.accentColor}" opacity="0.8"/>
    <text x="0" y="6" 
          font-family="Arial, sans-serif" font-size="24" font-weight="bold"
          text-anchor="middle" fill="${colorScheme.textColor}">
      ${letter}
    </text>
  `;
}

/**
 * Process and embed SVG logo content for use in poster
 * Standardized to consistent height for all logos
 */
function embedServiceLogo(
  svgContent: string,
  x: number,
  y: number,
  targetHeight: number = LOGO_SIZE
): string {
  try {
    // Extract the svg tag and its attributes
    const svgMatch = svgContent.match(/<svg[^>]*>([\s\S]*?)<\/svg>/i);
    const svgTagMatch = svgContent.match(/<svg[^>]*>/i);

    if (!svgMatch || !svgTagMatch) {
      return createLogoPlaceholder('unknown');
    }

    const innerContent = svgMatch[1];
    const svgTag = svgTagMatch[0];

    // Extract viewBox or width/height to determine original dimensions
    let width = 100,
      height = 100; // defaults

    const viewBoxMatch = svgTag.match(/viewBox=["']([^"']+)["']/i);
    if (viewBoxMatch) {
      const viewBoxValues = viewBoxMatch[1].split(/[\s,]+/);
      if (viewBoxValues.length >= 4) {
        width = parseFloat(viewBoxValues[2]) - parseFloat(viewBoxValues[0]);
        height = parseFloat(viewBoxValues[3]) - parseFloat(viewBoxValues[1]);
      }
    } else {
      // Try to extract width and height attributes
      const widthMatch = svgTag.match(/width=["']([^"']+)["']/i);
      const heightMatch = svgTag.match(/height=["']([^"']+)["']/i);

      if (widthMatch)
        width = parseFloat(widthMatch[1].replace(/px|pt|em|rem/, ''));
      if (heightMatch)
        height = parseFloat(heightMatch[1].replace(/px|pt|em|rem/, ''));
    }

    // Calculate scale to make all logos the same HEIGHT (not size)
    // This ensures consistent vertical presence regardless of aspect ratio
    const heightScale = targetHeight / height;
    const scaledWidth = width * heightScale;

    // Create a group with the logo content, scaled to consistent height
    return `
      <g transform="translate(${x}, ${y})">
        <g transform="scale(${heightScale}) translate(${
      -scaledWidth / (2 * heightScale)
    }, ${-targetHeight / (2 * heightScale)})">
          ${innerContent}
        </g>
      </g>
    `;
  } catch (error) {
    logger.warn('Failed to embed SVG logo:', error);
    return createLogoPlaceholder('unknown');
  }
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
 * Create multi-line text with proper word wrapping
 */
function createWrappedText(
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  fontSize: number,
  fill: string,
  filter?: string
): string {
  const lines = wrapTextKeepWords(text, maxWidth, fontSize);
  const lineHeight = fontSize * 1.1; // Tighter line height for cleaner look

  // Start from the provided Y position (no centering - position downward from Y)
  const startY = y;

  return lines
    .map((line, index) => {
      const escapedLine = escapeXml(line);
      const lineY = startY + index * lineHeight + fontSize; // Add fontSize to account for text baseline

      return `
      <text x="${x}" y="${lineY}" 
            font-family="Helvetica Neue, Segoe UI, Arial, sans-serif" 
            font-size="${fontSize}" 
            font-weight="600"
            text-anchor="middle" 
            fill="${fill}"
            ${filter ? ` filter="${filter}"` : ''}
            letter-spacing="-0.01em">
        ${escapedLine}
      </text>
    `;
    })
    .join('');
}

/**
 * Create poster grid with item images
 */
function createPosterGrid(
  items: CollectionItemWithPoster[],
  startX: number,
  startY: number
): string {
  if (!items.length) return '';

  const spacing = 16; // Space between posters - increased for better spacing
  const itemWidth = ITEM_POSTER_WIDTH;
  const itemHeight = ITEM_POSTER_HEIGHT;

  return items
    .slice(0, 4)
    .map((item, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const x = startX + col * (itemWidth + spacing);
      const y = startY + row * (itemHeight + spacing);

      if (item.posterUrl) {
        return `
        <g transform="translate(${x}, ${y})">
          <!-- Poster shadow -->
          <rect x="2" y="4" 
                width="${itemWidth}" 
                height="${itemHeight}" 
                fill="rgba(0,0,0,0.2)" 
                rx="6"/>
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
                rx="6"/>
        </g>
      `;
      } else {
        // Fallback placeholder
        return `
        <g transform="translate(${x}, ${y})">
          <!-- Placeholder shadow -->
          <rect x="2" y="4" 
                width="${itemWidth}" 
                height="${itemHeight}" 
                fill="rgba(0,0,0,0.15)" 
                rx="6"/>
          <!-- Placeholder background -->
          <rect x="0" y="0" 
                width="${itemWidth}" 
                height="${itemHeight}" 
                fill="rgba(255,255,255,0.08)" 
                stroke="rgba(255,255,255,0.15)" 
                stroke-width="1"
                rx="6"/>
          <!-- Placeholder text -->
          <text x="${itemWidth / 2}" y="${itemHeight / 2}" 
                font-family="Helvetica Neue, Segoe UI, Arial, sans-serif" 
                font-size="11" 
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
      `;
      }
    })
    .join('');
}

/**
 * Generate SVG poster content with new layout
 */
async function generatePosterSVG(
  config: PosterGenerationConfig
): Promise<string> {
  const colorScheme = getColorScheme(config.collectionType);
  const { collectionName, collectionType, items = [] } = config;

  // Fixed layout sections with consistent proportions
  const topBuffer = 35; // Fixed buffer above logo
  const logoSectionHeight = topBuffer + LOGO_SIZE + 30; // Total space for logo section with bottom spacing
  const logoY = topBuffer + LOGO_SIZE / 2; // Logo centered in top portion of its section

  const titleSectionStart = logoSectionHeight;
  const titleSectionHeight = 100; // Fixed height for title section (reduced to fit better)
  const titleSectionEnd = titleSectionStart + titleSectionHeight;

  const gridSectionStart = titleSectionEnd;
  const bottomBuffer = 35; // Fixed buffer at bottom (same as top for even spacing)
  const gridSectionHeight = POSTER_HEIGHT - gridSectionStart - bottomBuffer;

  // Title area calculations - text will shrink to fit
  const titleAreaHeight = titleSectionHeight - 20; // Leave some padding in title section
  const maxTitleWidth = POSTER_WIDTH - 60; // Padding on sides

  // Dynamic font sizing to better fill the space
  let fontSize = Math.min(50, Math.max(18, titleAreaHeight / 2));
  let textLines = wrapTextKeepWords(collectionName, maxTitleWidth, fontSize);
  let lineHeight = fontSize * 1.1;
  let textBlockHeight = textLines.length * lineHeight;

  // Reduce font size if text doesn't fit
  while (textBlockHeight > titleAreaHeight && fontSize > 14) {
    fontSize -= 1;
    textLines = wrapTextKeepWords(collectionName, maxTitleWidth, fontSize);
    lineHeight = fontSize * 1.1;
    textBlockHeight = textLines.length * lineHeight;
  }

  // Position title to better fill its section
  const titleY = titleSectionStart; // Start right at the beginning of title section

  // Load service logo with improved positioning
  let logoContent = '';
  if (collectionType && collectionType !== 'hub') {
    const logoSvg = await loadServiceLogo(collectionType);
    if (logoSvg) {
      logoContent = embedServiceLogo(
        logoSvg,
        POSTER_WIDTH / 2,
        logoY,
        LOGO_SIZE
      );
    } else {
      logoContent = `
        <g transform="translate(${POSTER_WIDTH / 2}, ${logoY})">
          ${createLogoPlaceholder(collectionType)}
        </g>
      `;
    }
  }

  // Fetch poster URLs if items are provided
  let itemsWithPosters: CollectionItemWithPoster[] = [];
  if (items.length > 0) {
    try {
      itemsWithPosters = await fetchTMDbPosterUrls(items);
      // Download and convert images to base64 for embedding, keep original URL as fallback
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

  // Calculate poster grid positioning within its fixed section
  const totalGridWidth = ITEM_POSTER_WIDTH * 2 + 16; // 2 posters + 1 spacing
  const totalGridHeight = ITEM_POSTER_HEIGHT * 2 + 16; // 2 rows + 1 spacing
  const gridX = (POSTER_WIDTH - totalGridWidth) / 2; // Center horizontally
  const gridY = gridSectionStart + (gridSectionHeight - totalGridHeight) / 2; // Center in grid section

  const posterGridContent = createPosterGrid(itemsWithPosters, gridX, gridY);

  return `
    <svg width="${POSTER_WIDTH}" height="${POSTER_HEIGHT}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
      <defs>
        <linearGradient id="backgroundGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:${
            colorScheme.secondaryColor
          };stop-opacity:1" />
          <stop offset="40%" style="stop-color:${
            colorScheme.primaryColor
          };stop-opacity:0.85" />
          <stop offset="100%" style="stop-color:${
            colorScheme.secondaryColor
          };stop-opacity:1" />
        </linearGradient>
        <filter id="textShadow">
          <feDropShadow dx="1" dy="2" stdDeviation="2" flood-color="#000000" flood-opacity="0.4"/>
        </filter>
        <filter id="logoGlow">
          <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#000000" flood-opacity="0.2"/>
        </filter>
        <filter id="posterShadow">
          <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000000" flood-opacity="0.25"/>
        </filter>
        <radialGradient id="overlayGradient" cx="50%" cy="0%" r="120%">
          <stop offset="0%" style="stop-color:rgba(255,255,255,0.1);stop-opacity:1" />
          <stop offset="100%" style="stop-color:rgba(0,0,0,0.1);stop-opacity:1" />
        </radialGradient>
      </defs>

      <!-- Background -->
      <rect width="${POSTER_WIDTH}" height="${POSTER_HEIGHT}" fill="url(#backgroundGradient)"/>
      
      <!-- Subtle overlay for depth -->
      <rect width="${POSTER_WIDTH}" height="${POSTER_HEIGHT}" fill="url(#overlayGradient)" opacity="0.6"/>
      
      <!-- Service logo (fixed at top with glow) -->
      <g filter="url(#logoGlow)">
        ${logoContent}
      </g>
      
      <!-- Collection name (responsive sizing with improved shadow) -->
      ${createWrappedText(
        collectionName,
        POSTER_WIDTH / 2,
        titleY,
        maxTitleWidth,
        fontSize,
        colorScheme.textColor,
        'url(#textShadow)'
      )}
      
      <!-- Poster grid with shadow -->
      <g filter="url(#posterShadow)">
        ${posterGridContent}
      </g>
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
    });

    // Generate SVG content
    const svgContent = await generatePosterSVG(config);

    // Convert SVG to PNG using Sharp
    const buffer = await sharp(Buffer.from(svgContent))
      .png({ quality: 90 })
      .toBuffer();

    logger.info('Poster generated successfully', {
      name: config.collectionName,
      bufferSize: buffer.length,
    });

    return buffer;
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
