import logger from '@server/logger';
import axios from 'axios';
import sharp from 'sharp';
import { getDualBannerConfig, getOverlayColor } from './categorization';
import type { DateFormat, OverlayOptions } from './types';

/**
 * Calculate days until a future date (UTC)
 */
function calculateDaysUntil(isoDate: string): number {
  const releaseDate = new Date(isoDate);
  const today = new Date();

  releaseDate.setUTCHours(0, 0, 0, 0);
  today.setUTCHours(0, 0, 0, 0);

  const diffTime = releaseDate.getTime() - today.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Format date with configurable format (possible future extension)
 *
 * Supported formats:
 * - "d mmm" → "15 OCT" (default)
 * - "mmm d" → "OCT 15"
 * - "yyyy-mm-dd" → "2025-10-15"
 */
function formatDate(
  isoDate: string,
  format: DateFormat = 'd mmm',
  capitalize = true
): string {
  const date = new Date(isoDate);

  let formatted: string;

  switch (format) {
    case 'd mmm': {
      const month = date.toLocaleString('en-US', { month: 'short' });
      const day = date.getDate();
      formatted = `${day} ${month}`;
      break;
    }
    case 'mmm d': {
      const month = date.toLocaleString('en-US', { month: 'short' });
      const day = date.getDate();
      formatted = `${month} ${day}`;
      break;
    }
    case 'yyyy-mm-dd': {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      formatted = `${year}-${month}-${day}`;
      break;
    }
    default: {
      // Default to "d mmm"
      const month = date.toLocaleString('en-US', { month: 'short' });
      const day = date.getDate();
      formatted = `${day} ${month}`;
    }
  }

  return capitalize ? formatted.toUpperCase() : formatted;
}

/**
 * Estimate text width for Fira Code Bold monospaced font
 * Fira Code is a monospaced font, so all characters have the same width
 */
function estimateTextWidth(
  text: string,
  fontSize: number,
  letterSpacing: number
): number {
  // Fira Code Bold is monospaced: each character is exactly 0.6 of the font size in width
  // This is the standard monospace ratio for programming fonts
  const charWidth = fontSize * 0.6;
  // Total width = (characters * fixed width) + (letter spacing between characters)
  return text.length * charWidth + (text.length - 1) * letterSpacing;
}

/**
 * Create SVG text overlay with rounded banner sitting on a thin strip
 * Uses percentage-based sizing relative to poster dimensions for consistent appearance
 * @param text - Text to display
 * @param posterWidth - Width of the poster
 * @param posterHeight - Height of the poster
 * @param backgroundColor - Background color for the banner (hex color)
 * @param position - Position of the banner (top or bottom)
 */
function createTextOverlaySVG(
  text: string,
  posterWidth: number,
  posterHeight: number,
  backgroundColor: string,
  position: 'top' | 'bottom'
): string {
  // Use actual poster dimensions for the SVG canvas
  const svgWidth = posterWidth;

  // Font size as percentage of poster height (4% gives good readable size)
  const fontSize = posterHeight * 0.04;

  // Banner height as percentage of poster height (reduced for tighter monospace font)
  const boxHeight = posterHeight * 0.045;

  // Letter spacing for monospace (slightly tighter)
  const letterSpacing = fontSize * 0.04;

  // Padding and radius scale with font size (reduced for tighter fit)
  const bannerPadding = fontSize * 0.35;
  const radius = fontSize * 0.2;

  // Calculate banner width based on text (using correct letter spacing)
  const textWidth = estimateTextWidth(text, fontSize, letterSpacing);
  const bannerWidth = textWidth + bannerPadding * 2;

  // Center the banner horizontally
  const bannerX = (svgWidth - bannerWidth) / 2;

  // Vertical offset to move text down (compensate for Fira Code's baseline)
  const textYOffset = fontSize * 0.15;

  if (position === 'bottom') {
    // Bottom: rounded top corners only (bottom edge touches poster edge)
    return `
      <svg width="${svgWidth}" height="${boxHeight}" viewBox="0 0 ${svgWidth} ${boxHeight}">
        <path
          d="M ${bannerX + radius},0
             L ${bannerX + bannerWidth - radius},0
             Q ${bannerX + bannerWidth},0 ${bannerX + bannerWidth},${radius}
             L ${bannerX + bannerWidth},${boxHeight}
             L ${bannerX},${boxHeight}
             L ${bannerX},${radius}
             Q ${bannerX},0 ${bannerX + radius},0
             Z"
          fill="${backgroundColor}"
        />
        <text
          x="${svgWidth / 2}"
          y="${boxHeight / 2 + textYOffset}"
          font-family="Fira Code, monospace"
          font-size="${fontSize}"
          font-weight="700"
          fill="#FFFFFF"
          text-anchor="middle"
          dominant-baseline="middle"
          letter-spacing="${letterSpacing}"
        >${text}</text>
      </svg>
    `;
  } else {
    // Top: rounded bottom corners only (top edge touches poster edge)
    return `
      <svg width="${svgWidth}" height="${boxHeight}" viewBox="0 0 ${svgWidth} ${boxHeight}">
        <path
          d="M ${bannerX},0
             L ${bannerX + bannerWidth},0
             L ${bannerX + bannerWidth},${boxHeight - radius}
             Q ${bannerX + bannerWidth},${boxHeight} ${
      bannerX + bannerWidth - radius
    },${boxHeight}
             L ${bannerX + radius},${boxHeight}
             Q ${bannerX},${boxHeight} ${bannerX},${boxHeight - radius}
             Z"
          fill="${backgroundColor}"
        />
        <text
          x="${svgWidth / 2}"
          y="${boxHeight / 2 + textYOffset}"
          font-family="Fira Code, monospace"
          font-size="${fontSize}"
          font-weight="700"
          fill="#FFFFFF"
          text-anchor="middle"
          dominant-baseline="middle"
          letter-spacing="${letterSpacing}"
        >${text}</text>
      </svg>
    `;
  }
}

/**
 * Download poster with retry logic
 */
async function downloadPosterWithRetry(
  posterUrl: string,
  maxRetries = 3
): Promise<Buffer> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.debug('Downloading poster from URL', {
        label: 'Coming Soon Overlay',
        url: posterUrl,
        attempt,
        maxRetries,
      });

      const response = await axios.get(posterUrl, {
        responseType: 'arraybuffer',
        timeout: 10000, // 10 second timeout
      });

      return Buffer.from(response.data);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logger.warn('Failed to download poster, retrying...', {
        label: 'Coming Soon Overlay',
        url: posterUrl,
        attempt,
        maxRetries,
        error: lastError.message,
      });

      // Wait before retrying (exponential backoff)
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  throw lastError || new Error('Failed to download poster after retries');
}

/**
 * Generate overlay poster with dual banner support
 *
 * New dual banner logic:
 * - New movies/TV (S01): Top "COMING SOON" + Bottom "PREMIERES/EXPECTED [DATE]"
 * - Aired/Released (waiting): Top "COMING SOON" + Bottom "AWAITING DOWNLOAD"
 * - Returning TV (S02+): Bottom only "RETURNING [DATE]"
 * - Request needed: Top "REQUEST NEEDED" + Bottom "PREMIERES/EXPECTED [DATE]"
 * - Trending monitored: Top "COMING SOON" + Bottom "TRENDING [DATE]"
 * - Released with file (monitored): Bottom only "RELEASED [X DAYS AGO]" (days since release date)
 * - Released with file (not monitored): Top "REQUEST NEEDED" + Bottom "RELEASED [X DAYS AGO]" (days since release date)
 */
export async function generateOverlayPoster(
  options: OverlayOptions
): Promise<Buffer> {
  const {
    posterUrl,
    category,
    releaseDate,
    color: defaultColor,
    dateFormat = 'd mmm',
    capitalizeDates = true,
    isEstimatedDate = false,
    seasonNumber,
  } = options;

  try {
    // 1. Get dual banner configuration based on category and release date
    const bannerConfigs = getDualBannerConfig(
      category,
      releaseDate,
      seasonNumber
    );
    const overlayColor = getOverlayColor(category, defaultColor);

    logger.debug('Generating overlay with dual banner configuration', {
      label: 'Coming Soon Overlay',
      category,
      bannerCount: bannerConfigs.length,
      overlayColor,
    });

    // 2. Download original poster with retry logic
    const posterBuffer = await downloadPosterWithRetry(posterUrl);

    // 3. Get poster dimensions
    const metadata = await sharp(posterBuffer).metadata();
    const width = metadata.width || 600;
    const height = metadata.height || 900;

    logger.debug('Poster dimensions detected', {
      label: 'Coming Soon Overlay',
      width,
      height,
    });

    // 4. Create overlay layers for each banner
    const overlays: sharp.OverlayOptions[] = [];
    const overlayHeight = Math.round(height * 0.045);

    for (const bannerConfig of bannerConfigs) {
      let bannerText = bannerConfig.text;

      // Handle "RELEASED_DAYS_AGO:X" format
      if (bannerText.startsWith('RELEASED_DAYS_AGO:')) {
        const daysAgo = parseInt(bannerText.split(':')[1], 10);
        if (daysAgo === 0) {
          bannerText = 'RELEASED TODAY';
        } else if (daysAgo === 1) {
          bannerText = 'RELEASED 1 DAY AGO';
        } else {
          bannerText = `RELEASED ${daysAgo} DAYS AGO`;
        }
      }
      // If banner should show date and we have one, format it appropriately
      else if (bannerConfig.showDate && releaseDate) {
        const daysUntil = calculateDaysUntil(releaseDate);

        // Use countdown for short timeframes, formatted date for longer
        if (daysUntil < 0) {
          bannerText = 'RELEASED';
        } else if (daysUntil === 0) {
          bannerText = `${bannerConfig.text} TODAY`;
        } else if (daysUntil === 1) {
          bannerText = `${bannerConfig.text} TOMORROW`;
        } else if (daysUntil <= 30) {
          // Show countdown for items within 30 days
          bannerText = `${bannerConfig.text} IN ${daysUntil} DAYS`;
        } else {
          // Show formatted date for items beyond 30 days
          const formattedDate = formatDate(
            releaseDate,
            dateFormat,
            capitalizeDates
          );
          // Add ~ prefix for estimated dates
          const datePrefix = isEstimatedDate ? '~' : '';
          bannerText = `${bannerConfig.text} ${datePrefix}${formattedDate}`;
        }
      }

      // Create SVG for this banner
      const svg = createTextOverlaySVG(
        bannerText,
        width,
        height,
        overlayColor,
        bannerConfig.position
      );

      // Render SVG to PNG
      const svgBuffer = Buffer.from(svg);
      const renderedOverlay = await sharp(svgBuffer).png().toBuffer();

      // Position the banner
      if (bannerConfig.position === 'bottom') {
        overlays.push({
          input: renderedOverlay,
          top: height - overlayHeight,
          left: 0,
        });
      } else {
        overlays.push({
          input: renderedOverlay,
          top: 0,
          left: 0,
        });
      }

      logger.debug('Added overlay banner', {
        label: 'Coming Soon Overlay',
        text: bannerText,
        position: bannerConfig.position,
        color: overlayColor,
      });
    }

    // 5. Composite all overlay layers onto poster
    const result = await sharp(posterBuffer)
      .composite(overlays)
      .jpeg()
      .toBuffer();

    logger.info('Successfully generated overlay poster', {
      label: 'Coming Soon Overlay',
      category,
      bannerCount: bannerConfigs.length,
      outputSize: result.length,
    });

    return result;
  } catch (error) {
    logger.error('Failed to generate overlay poster', {
      label: 'Coming Soon Overlay',
      error: error instanceof Error ? error.message : String(error),
      posterUrl,
      category,
    });
    throw error;
  }
}
