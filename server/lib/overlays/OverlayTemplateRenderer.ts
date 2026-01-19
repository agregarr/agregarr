import type {
  ApplicationCondition,
  OverlayElement,
  OverlayRasterElementProps,
  OverlaySVGElementProps,
  OverlayTemplateData,
  OverlayTextElementProps,
  OverlayTileElementProps,
  OverlayVariableElementProps,
} from '@server/entity/OverlayTemplate';
import logger from '@server/logger';
import sharp from 'sharp';

/**
 * Evaluate an application condition against the render context
 * Returns true if condition is met (or if no condition specified)
 *
 * Uses flat section/rule structure:
 * - Evaluate each section by combining its rules with their ruleOperators
 * - Combine sections using their sectionOperators
 */
export function evaluateCondition(
  condition: ApplicationCondition | undefined,
  context: OverlayRenderContext
): boolean {
  if (!condition || !condition.sections || condition.sections.length === 0) {
    return true; // No condition = always apply
  }

  // Evaluate first section
  let result = evaluateSection(condition.sections[0], context);

  // Combine remaining sections using their sectionOperators
  for (let i = 1; i < condition.sections.length; i++) {
    const section = condition.sections[i];
    const sectionResult = evaluateSection(section, context);

    if (section.sectionOperator === 'and') {
      result = result && sectionResult;
    } else {
      // Default to OR if not specified
      result = result || sectionResult;
    }
  }

  return result;
}

/**
 * Evaluate a single section by combining its rules
 */
function evaluateSection(
  section: {
    rules: {
      ruleOperator?: 'and' | 'or';
      field: string;
      operator: string;
      value: unknown;
    }[];
  },
  context: OverlayRenderContext
): boolean {
  if (!section.rules || section.rules.length === 0) {
    return true; // Empty section = always true
  }

  // Evaluate first rule
  let result = evaluateRule(section.rules[0], context);

  // Combine remaining rules using their ruleOperators
  for (let i = 1; i < section.rules.length; i++) {
    const rule = section.rules[i];
    const ruleResult = evaluateRule(rule, context);

    if (rule.ruleOperator === 'or') {
      result = result || ruleResult;
    } else {
      // Default to AND if not specified
      result = result && ruleResult;
    }
  }

  return result;
}

/**
 * Evaluate condition and return detailed results for debugging
 * Returns the same boolean result as evaluateCondition, plus detailed evaluation info
 */
export function evaluateConditionDetailed(
  condition: ApplicationCondition | undefined,
  context: OverlayRenderContext
): {
  matched: boolean;
  sectionResults: {
    sectionIndex: number;
    sectionOperator?: 'and' | 'or';
    matched: boolean;
    ruleResults: {
      ruleIndex: number;
      ruleOperator?: 'and' | 'or';
      field: string;
      operator: string;
      value: unknown;
      actualValue: unknown;
      matched: boolean;
    }[];
  }[];
} {
  if (!condition || !condition.sections || condition.sections.length === 0) {
    return {
      matched: true,
      sectionResults: [],
    };
  }

  const sectionResults = condition.sections.map((section, sectionIndex) => {
    const ruleResults = section.rules.map((rule, ruleIndex) => {
      const actualValue = context[rule.field];
      const matched = evaluateRule(rule, context);

      return {
        ruleIndex,
        ruleOperator: rule.ruleOperator,
        field: rule.field,
        operator: rule.operator,
        value: rule.value,
        actualValue,
        matched,
      };
    });

    // Determine section match based on rule operator logic
    let sectionMatched = ruleResults[0]?.matched ?? true;
    for (let i = 1; i < ruleResults.length; i++) {
      const ruleResult = ruleResults[i];
      if (ruleResult.ruleOperator === 'or') {
        sectionMatched = sectionMatched || ruleResult.matched;
      } else {
        // Default to AND
        sectionMatched = sectionMatched && ruleResult.matched;
      }
    }

    return {
      sectionIndex,
      sectionOperator: section.sectionOperator,
      matched: sectionMatched,
      ruleResults,
    };
  });

  // Determine overall match based on section operator logic
  let overallMatched = sectionResults[0]?.matched ?? true;
  for (let i = 1; i < sectionResults.length; i++) {
    const sectionResult = sectionResults[i];
    if (sectionResult.sectionOperator === 'and') {
      overallMatched = overallMatched && sectionResult.matched;
    } else {
      // Default to OR
      overallMatched = overallMatched || sectionResult.matched;
    }
  }

  return {
    matched: overallMatched,
    sectionResults,
  };
}

/**
 * Evaluate a single rule (field/operator/value comparison)
 */
function evaluateRule(
  rule: { field: string; operator: string; value: unknown },
  context: OverlayRenderContext
): boolean {
  const value = context[rule.field];
  const conditionValue = rule.value;

  // Handle undefined/null values specially based on operator
  if (value === undefined || value === null) {
    // For 'neq' (not equal), missing/null IS different from any defined value
    // e.g., "downloaded != true" should match when downloaded is undefined
    if (rule.operator === 'neq') {
      return conditionValue !== undefined && conditionValue !== null;
    }
    // For 'exists', we need to evaluate based on the presence/absence of value
    if (rule.operator === 'exists') {
      // value is null/undefined, so field does NOT exist
      // Return true if conditionValue is false (checking for non-existence)
      return conditionValue === false;
    }
    // For all other operators (eq, gt, gte, lt, lte, contains, in, etc.)
    // undefined/null means the condition can't be evaluated, so false
    return false;
  }

  switch (rule.operator) {
    case 'eq':
      // For array fields (like radarrTags/sonarrTags), check if array contains the value
      if (Array.isArray(value) && typeof conditionValue === 'string') {
        return value.some(
          (item) =>
            typeof item === 'string' &&
            item.toLowerCase() === conditionValue.toLowerCase()
        );
      }
      // Case-insensitive comparison for strings
      if (typeof value === 'string' && typeof conditionValue === 'string') {
        return value.toLowerCase() === conditionValue.toLowerCase();
      }
      return value === conditionValue;
    case 'neq':
      // For array fields, check if array does NOT contain the value
      if (Array.isArray(value) && typeof conditionValue === 'string') {
        return !value.some(
          (item) =>
            typeof item === 'string' &&
            item.toLowerCase() === conditionValue.toLowerCase()
        );
      }
      // Case-insensitive comparison for strings
      if (typeof value === 'string' && typeof conditionValue === 'string') {
        return value.toLowerCase() !== conditionValue.toLowerCase();
      }
      return value !== conditionValue;
    case 'gt':
      return (
        typeof value === 'number' &&
        typeof conditionValue === 'number' &&
        value > conditionValue
      );
    case 'gte':
      return (
        typeof value === 'number' &&
        typeof conditionValue === 'number' &&
        value >= conditionValue
      );
    case 'lt':
      return (
        typeof value === 'number' &&
        typeof conditionValue === 'number' &&
        value < conditionValue
      );
    case 'lte':
      return (
        typeof value === 'number' &&
        typeof conditionValue === 'number' &&
        value <= conditionValue
      );
    case 'in':
      // Case-insensitive comparison for string arrays
      if (typeof value === 'string' && Array.isArray(conditionValue)) {
        return conditionValue.some(
          (item) =>
            typeof item === 'string' &&
            item.toLowerCase() === value.toLowerCase()
        );
      }
      return (
        Array.isArray(conditionValue) &&
        conditionValue.includes(value as string | number)
      );
    case 'contains':
      // For array fields, check if array contains the value
      if (Array.isArray(value) && typeof conditionValue === 'string') {
        return value.some(
          (item) =>
            typeof item === 'string' &&
            item.toLowerCase().includes(conditionValue.toLowerCase())
        );
      }
      return (
        typeof value === 'string' &&
        typeof conditionValue === 'string' &&
        value.toLowerCase().includes(conditionValue.toLowerCase())
      );
    case 'regex':
      if (typeof value === 'string' && typeof conditionValue === 'string') {
        try {
          const regex = new RegExp(conditionValue, 'i');
          return regex.test(value);
        } catch {
          return false;
        }
      }
      return false;
    case 'begins':
      return (
        typeof value === 'string' &&
        typeof conditionValue === 'string' &&
        value.toLowerCase().startsWith(conditionValue.toLowerCase())
      );
    case 'ends':
      return (
        typeof value === 'string' &&
        typeof conditionValue === 'string' &&
        value.toLowerCase().endsWith(conditionValue.toLowerCase())
      );
    case 'exists':
      // Check if field has a non-null/undefined value
      // conditionValue should be boolean: true = exists, false = not exists
      if (typeof conditionValue === 'boolean') {
        const hasValue = value !== undefined && value !== null;
        return conditionValue ? hasValue : !hasValue;
      }
      return false;
    default:
      return false;
  }
}

/**
 * Metadata context for dynamic field replacement
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

  // File info
  container?: string; // 'mkv', 'mp4'
  bitrate?: number; // In kbps
  fileSize?: number; // In bytes
  filePath?: string; // Full file path

  // Playback stats
  viewCount?: number; // Number of times played
  lastPlayed?: Date; // Last playback date
  dateAdded?: Date; // Date added to Plex

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
  hasFile?: boolean; // Whether *arr reports item has files
  downloaded?: boolean; // Derived from hasFile for monitored items, or !isPlaceholder for others
  radarrTags?: string[]; // Array of Radarr tag names
  sonarrTags?: string[]; // Array of Sonarr tag names

  // Maintainerr integration
  daysUntilAction?: number; // Days until Maintainerr takes action (negative = overdue)

  // Item metadata
  isPlaceholder: boolean; // true = Coming Soon item, false = real item in Plex
  mediaType: 'movie' | 'show';

  // Future extensibility
  [key: string]: string | number | boolean | Date | string[] | undefined;
}

/**
 * Service for rendering overlay templates onto posters
 */
class OverlayTemplateRendererService {
  /**
   * Check if all required variables are available in the context
   */
  private hasRequiredVariables(
    elements: OverlayElement[],
    context: OverlayRenderContext
  ): boolean {
    // Find all variable elements in the template
    const variableElements = elements.filter((el) => el.type === 'variable');

    // If no variable elements, overlay can be applied
    if (variableElements.length === 0) {
      return true;
    }

    // Check if all variable segments have values available in context
    for (const element of variableElements) {
      const props = element.properties as OverlayVariableElementProps;

      // Check all variable segments in this element
      for (const segment of props.segments) {
        if (segment.type === 'variable' && segment.field) {
          const value = context[segment.field];

          // If any required variable is missing, skip entire overlay
          if (value === undefined || value === null) {
            return false;
          }
        }
      }
    }

    return true;
  }

  /**
   * Render overlay template onto a poster
   */
  async renderOverlay(
    posterBuffer: Buffer,
    templateData: OverlayTemplateData,
    context: OverlayRenderContext
  ): Promise<Buffer> {
    try {
      const elements = templateData.elements;

      // Check if all required variables are available
      // If any variable is missing, return original poster unchanged
      if (!this.hasRequiredVariables(elements, context)) {
        logger.debug('Skipping overlay - required data not available', {
          label: 'OverlayRenderer',
        });
        return posterBuffer;
      }

      // Get poster dimensions
      const posterMetadata = await sharp(posterBuffer).metadata();
      const posterWidth = posterMetadata.width || 500;
      const posterHeight = posterMetadata.height || 750;

      // Calculate scale factors from template canvas to actual poster
      // Use uniform scaling to prevent overlay drift on non-standard aspect ratios
      // (e.g., 1000x1426 instead of standard 2:3 ratio like 2000x3000)
      const scaleX = posterWidth / templateData.width;
      const scaleY = posterHeight / templateData.height;
      const scale = Math.min(scaleX, scaleY);

      // Calculate offsets to center the template on non-standard posters
      const offsetX = (posterWidth - templateData.width * scale) / 2;
      const offsetY = (posterHeight - templateData.height * scale) / 2;

      logger.debug('Rendering overlay template', {
        label: 'OverlayRenderer',
        posterDimensions: `${posterWidth}x${posterHeight}`,
        templateDimensions: `${templateData.width}x${templateData.height}`,
        scaleFactor: scale.toFixed(2),
        offsets: `${offsetX.toFixed(1)},${offsetY.toFixed(1)}`,
        elementCount: elements.length,
      });

      // Create base composite from poster
      let composite = sharp(posterBuffer);

      // Sort elements by layer order (bottom to top)
      const sortedElements = [...elements].sort(
        (a, b) => a.layerOrder - b.layerOrder
      );

      // Render each element as an overlay
      const overlays: sharp.OverlayOptions[] = [];

      for (const element of sortedElements) {
        const overlayBuffer = await this.renderElement(
          element,
          posterWidth,
          posterHeight,
          templateData.width,
          templateData.height,
          context
        );

        if (overlayBuffer) {
          // Get overlay buffer metadata
          const overlayMeta = await sharp(overlayBuffer).metadata();
          let overlayWidth = overlayMeta.width ?? 0;
          let overlayHeight = overlayMeta.height ?? 0;

          let safeOverlayBuffer = overlayBuffer;

          // Ensure overlay dimensions never exceed the base poster size
          if (
            overlayWidth > posterWidth ||
            overlayHeight > posterHeight ||
            overlayWidth === 0 ||
            overlayHeight === 0
          ) {
            safeOverlayBuffer = await sharp(overlayBuffer)
              .resize({
                width: Math.min(overlayWidth || posterWidth, posterWidth),
                height: Math.min(overlayHeight || posterHeight, posterHeight),
                fit: 'inside',
              })
              .toBuffer();

            // Recalculate dimensions after resize to ensure correct positioning
            const safeMeta = await sharp(safeOverlayBuffer).metadata();
            overlayWidth = safeMeta.width ?? overlayWidth;
            overlayHeight = safeMeta.height ?? overlayHeight;
          }

          // Scale position from template coordinates to poster coordinates
          // Use uniform scaling with offsets to handle non-standard aspect ratios
          const scaledElementWidth = Math.round(element.width * scale);
          const scaledElementHeight = Math.round(element.height * scale);

          // Calculate the center position where this element should be
          // Apply offsets to center overlays on non-standard posters
          const centerX = Math.round(
            offsetX + element.x * scale + scaledElementWidth / 2
          );
          const centerY = Math.round(
            offsetY + element.y * scale + scaledElementHeight / 2
          );

          // Position the rotated buffer so its center aligns with the element center
          const left = centerX - Math.round(overlayWidth / 2);
          const top = centerY - Math.round(overlayHeight / 2);

          overlays.push({
            input: safeOverlayBuffer,
            left,
            top,
          });
        }
      }

      // Apply all overlays
      if (overlays.length > 0) {
        composite = composite.composite(overlays);
      }

      // Convert to WebP with high quality for optimal file size
      // WebP provides 25-35% better compression than JPEG at same quality
      // (Plex has file size limits around 10-11MB)
      return await composite.webp({ quality: 92 }).toBuffer();
    } catch (error) {
      logger.error('Failed to render overlay template', {
        label: 'OverlayRenderer',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Render a single overlay element
   */
  private async renderElement(
    element: OverlayElement,
    posterWidth: number,
    posterHeight: number,
    templateWidth: number,
    templateHeight: number,
    context: OverlayRenderContext
  ): Promise<Buffer | null> {
    try {
      let buffer: Buffer | null = null;

      switch (element.type) {
        case 'text':
          buffer = await this.renderTextElement(
            element,
            posterWidth,
            posterHeight,
            templateWidth,
            templateHeight
          );
          break;
        case 'tile':
          buffer = await this.renderTileElement(
            element,
            posterWidth,
            posterHeight,
            templateWidth,
            templateHeight
          );
          break;
        case 'variable':
          buffer = await this.renderVariableElement(
            element,
            posterWidth,
            posterHeight,
            templateWidth,
            templateHeight,
            context
          );
          break;
        case 'svg':
          buffer = await this.renderSVGElement(
            element,
            posterWidth,
            posterHeight,
            templateWidth,
            templateHeight
          );
          break;
        case 'raster':
          buffer = await this.renderRasterElement(
            element,
            posterWidth,
            posterHeight,
            templateWidth,
            templateHeight
          );
          break;
        default:
          logger.warn('Unknown element type', {
            label: 'OverlayRenderer',
            type: element.type,
          });
          return null;
      }

      // Apply rotation if specified
      if (buffer && element.rotation && element.rotation !== 0) {
        buffer = await this.applyRotation(buffer, element.rotation);
      }

      return buffer;
    } catch (error) {
      logger.error('Failed to render element', {
        label: 'OverlayRenderer',
        elementType: element.type,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Apply rotation to an element buffer
   */
  private async applyRotation(
    buffer: Buffer,
    rotation: number
  ): Promise<Buffer> {
    try {
      // For rotation, we need to rotate the image
      // Sharp's rotate() automatically expands the canvas to fit rotated content
      return await sharp(buffer)
        .rotate(rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .toBuffer();
    } catch (error) {
      logger.warn('Failed to apply rotation, returning unrotated buffer', {
        label: 'OverlayRenderer',
        rotation,
        error: error instanceof Error ? error.message : String(error),
      });
      return buffer;
    }
  }

  /**
   * Render pure text element (no background, no dynamic fields)
   */
  private async renderTextElement(
    element: OverlayElement,
    posterWidth: number,
    posterHeight: number,
    templateWidth: number,
    templateHeight: number
  ): Promise<Buffer> {
    const props = element.properties as OverlayTextElementProps;

    // Calculate uniform scale factor to handle non-standard aspect ratios
    const scaleX = posterWidth / templateWidth;
    const scaleY = posterHeight / templateHeight;
    const scale = Math.min(scaleX, scaleY);

    // Scale dimensions from template to poster using uniform scale
    const width = Math.round(element.width * scale);
    const height = Math.round(element.height * scale);
    const fontSize = Math.round(props.fontSize * scale);

    // Create SVG for text rendering
    const svg = `
      <svg width="${width}" height="${height}">
        <text
          x="${
            props.textAlign === 'center'
              ? '50%'
              : props.textAlign === 'right'
              ? '100%'
              : '0'
          }"
          y="50%"
          font-family="'${props.fontFamily}'"
          font-size="${fontSize}"
          font-weight="${props.fontWeight}"
          font-style="${props.fontStyle}"
          fill="${props.color}"
          fill-opacity="${(props.opacity ?? 100) / 100}"
          text-anchor="${
            props.textAlign === 'center'
              ? 'middle'
              : props.textAlign === 'right'
              ? 'end'
              : 'start'
          }"
          dominant-baseline="middle"
        >
          ${this.escapeXml(props.text)}
        </text>
      </svg>
    `;

    return await sharp(Buffer.from(svg)).png().toBuffer();
  }

  /**
   * Render tile element (decorative rectangle)
   */
  private async renderTileElement(
    element: OverlayElement,
    posterWidth: number,
    posterHeight: number,
    templateWidth: number,
    templateHeight: number
  ): Promise<Buffer> {
    const props = element.properties as OverlayTileElementProps;

    // Calculate uniform scale factor to handle non-standard aspect ratios
    const scaleX = posterWidth / templateWidth;
    const scaleY = posterHeight / templateHeight;
    const scale = Math.min(scaleX, scaleY);

    // Scale dimensions from template to poster using uniform scale
    const width = Math.round(element.width * scale);
    const height = Math.round(element.height * scale);
    const borderWidth = props.borderWidth
      ? Math.round(props.borderWidth * scale)
      : 0;

    // Determine corner radii (with backward compatibility)
    let radiusTopLeft = 0;
    let radiusTopRight = 0;
    let radiusBottomLeft = 0;
    let radiusBottomRight = 0;

    if (props.lockCorners || props.borderRadius !== undefined) {
      // Locked mode or legacy borderRadius - all corners same
      const baseRadius = props.borderRadiusTopLeft ?? props.borderRadius ?? 0;
      const scaledRadius = Math.round(baseRadius * scale);
      radiusTopLeft = scaledRadius;
      radiusTopRight = scaledRadius;
      radiusBottomLeft = scaledRadius;
      radiusBottomRight = scaledRadius;
    } else {
      // Unlocked mode - individual corners
      radiusTopLeft = props.borderRadiusTopLeft
        ? Math.round(props.borderRadiusTopLeft * scale)
        : 0;
      radiusTopRight = props.borderRadiusTopRight
        ? Math.round(props.borderRadiusTopRight * scale)
        : 0;
      radiusBottomLeft = props.borderRadiusBottomLeft
        ? Math.round(props.borderRadiusBottomLeft * scale)
        : 0;
      radiusBottomRight = props.borderRadiusBottomRight
        ? Math.round(props.borderRadiusBottomRight * scale)
        : 0;
    }

    // Create SVG path for rectangle with individual corner radii
    const path = this.createRoundedRectPath(
      width,
      height,
      radiusTopLeft,
      radiusTopRight,
      radiusBottomRight,
      radiusBottomLeft
    );

    const svg = `
      <svg width="${width}" height="${height}">
        <path
          d="${path}"
          fill="${props.fillColor}"
          fill-opacity="${props.fillOpacity / 100}"
          ${
            borderWidth > 0 && props.borderColor
              ? `stroke="${props.borderColor}"`
              : ''
          }
          ${borderWidth > 0 ? `stroke-width="${borderWidth}"` : ''}
        />
      </svg>
    `;

    return await sharp(Buffer.from(svg)).png().toBuffer();
  }

  /**
   * Create SVG path for rounded rectangle with individual corner radii
   */
  private createRoundedRectPath(
    width: number,
    height: number,
    radiusTopLeft: number,
    radiusTopRight: number,
    radiusBottomRight: number,
    radiusBottomLeft: number
  ): string {
    // Clamp radii to not exceed half the width/height
    const maxRadiusX = width / 2;
    const maxRadiusY = height / 2;

    const rtl = Math.min(radiusTopLeft, maxRadiusX, maxRadiusY);
    const rtr = Math.min(radiusTopRight, maxRadiusX, maxRadiusY);
    const rbr = Math.min(radiusBottomRight, maxRadiusX, maxRadiusY);
    const rbl = Math.min(radiusBottomLeft, maxRadiusX, maxRadiusY);

    // SVG path for rounded rectangle
    // Move to top-left corner (after arc)
    // Draw line to top-right corner arc
    // Arc around top-right
    // Draw line to bottom-right corner arc
    // Arc around bottom-right
    // Draw line to bottom-left corner arc
    // Arc around bottom-left
    // Draw line back to top-left arc
    // Arc around top-left
    // Close path

    return `
      M ${rtl} 0
      L ${width - rtr} 0
      Q ${width} 0 ${width} ${rtr}
      L ${width} ${height - rbr}
      Q ${width} ${height} ${width - rbr} ${height}
      L ${rbl} ${height}
      Q 0 ${height} 0 ${height - rbl}
      L 0 ${rtl}
      Q 0 0 ${rtl} 0
      Z
    `.trim();
  }

  /**
   * Render variable element by composing text from multiple segments
   * Returns null if any required variable has no value (for partial rendering)
   */
  private async renderVariableElement(
    element: OverlayElement,
    posterWidth: number,
    posterHeight: number,
    templateWidth: number,
    templateHeight: number,
    context: OverlayRenderContext
  ): Promise<Buffer | null> {
    const props = element.properties as OverlayVariableElementProps;

    // Build display text by concatenating all segments
    let displayText = '';

    for (const segment of props.segments) {
      if (segment.type === 'text') {
        // Static text segment - use value as-is
        displayText += segment.value || '';
      } else if (segment.type === 'variable' && segment.field) {
        // Variable segment - look up value in context
        const variableValue = context[segment.field];

        // If any variable has no value, don't render this element (partial rendering)
        if (variableValue === undefined || variableValue === null) {
          return null;
        }

        // Format the value based on type
        let formattedValue = '';

        // Check if this is a date field with custom format
        const isDateField = [
          'releaseDate',
          'nextEpisodeAirDate',
          'nextSeasonAirDate',
          'lastPlayed',
          'dateAdded',
        ].includes(segment.field);

        if (
          isDateField &&
          (typeof variableValue === 'string' || variableValue instanceof Date)
        ) {
          // Use date formatting - use specified format or default to 'MMM DD'
          const { formatDate } = await import('@server/utils/dateHelpers');
          formattedValue = formatDate(
            variableValue,
            segment.format || 'MMM DD'
          );
        } else if (typeof variableValue === 'number') {
          // Format ratings/scores appropriately
          if (segment.field === 'imdbRating') {
            // IMDb ratings should show decimal (e.g., 8.7)
            formattedValue = variableValue.toFixed(1);
          } else if (
            segment.field.includes('Score') ||
            segment.field.includes('Rating')
          ) {
            // RT scores are percentages - no decimal needed (e.g., 89)
            formattedValue = Math.round(variableValue).toString();
          } else {
            formattedValue = variableValue.toString();
          }
        } else {
          formattedValue = String(variableValue);
        }

        displayText += formattedValue;
      }
    }

    // Calculate uniform scale factor to handle non-standard aspect ratios
    const scaleX = posterWidth / templateWidth;
    const scaleY = posterHeight / templateHeight;
    const scale = Math.min(scaleX, scaleY);

    // Scale dimensions from template to poster using uniform scale
    const width = Math.round(element.width * scale);
    const height = Math.round(element.height * scale);
    const fontSize = Math.round(props.fontSize * scale);

    // Create SVG for text rendering
    const svg = `
      <svg width="${width}" height="${height}">
        <text
          x="${
            props.textAlign === 'center'
              ? '50%'
              : props.textAlign === 'right'
              ? '100%'
              : '0'
          }"
          y="50%"
          font-family="'${props.fontFamily}'"
          font-size="${fontSize}"
          font-weight="${props.fontWeight}"
          font-style="${props.fontStyle}"
          fill="${props.color}"
          fill-opacity="${(props.opacity ?? 100) / 100}"
          text-anchor="${
            props.textAlign === 'center'
              ? 'middle'
              : props.textAlign === 'right'
              ? 'end'
              : 'start'
          }"
          dominant-baseline="middle"
        >
          ${this.escapeXml(displayText)}
        </text>
      </svg>
    `;

    return await sharp(Buffer.from(svg)).png().toBuffer();
  }

  /**
   * Render SVG icon element
   */
  private async renderSVGElement(
    element: OverlayElement,
    posterWidth: number,
    posterHeight: number,
    templateWidth: number,
    templateHeight: number
    // context parameter reserved for future dynamic field support
  ): Promise<Buffer | null> {
    const props = element.properties as OverlaySVGElementProps;

    // Calculate uniform scale factor to handle non-standard aspect ratios
    const scaleX = posterWidth / templateWidth;
    const scaleY = posterHeight / templateHeight;
    const scale = Math.min(scaleX, scaleY);

    // Scale dimensions from template to poster using uniform scale
    const width = Math.round(element.width * scale);
    const height = Math.round(element.height * scale);

    // Load SVG file
    if (props.iconPath) {
      try {
        // Parse icon path URL to get type and filename
        // Format: /api/v1/posters/icons/{type}/{filename}
        const urlMatch = props.iconPath.match(
          /\/api\/v1\/posters\/icons\/(\w+)\/(.+)/
        );
        if (!urlMatch) {
          logger.warn('Icon path does not match expected format', {
            label: 'OverlayRenderer',
            iconPath: props.iconPath,
          });
          return null;
        }

        const [, iconType, filename] = urlMatch;

        // Load icon file using iconManager (same as poster template editor)
        const { loadIconFile } = await import('@server/lib/iconManager');
        const svgBuffer = await loadIconFile(
          filename,
          iconType as 'user' | 'system'
        );

        return await sharp(svgBuffer)
          .resize(width, height, {
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          })
          .png()
          .toBuffer();
      } catch (error) {
        logger.error('Failed to load SVG icon', {
          label: 'OverlayRenderer',
          iconPath: props.iconPath,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    }

    return null;
  }

  /**
   * Render raster image element
   */
  private async renderRasterElement(
    element: OverlayElement,
    posterWidth: number,
    posterHeight: number,
    templateWidth: number,
    templateHeight: number
    // context parameter reserved for future dynamic field support
  ): Promise<Buffer | null> {
    const props = element.properties as OverlayRasterElementProps;

    // Calculate uniform scale factor to handle non-standard aspect ratios
    const scaleX = posterWidth / templateWidth;
    const scaleY = posterHeight / templateHeight;
    const scale = Math.min(scaleX, scaleY);

    // Scale dimensions from template to poster using uniform scale
    const width = Math.round(element.width * scale);
    const height = Math.round(element.height * scale);

    // Load raster image
    if (props.imagePath) {
      try {
        // Parse image path URL to get type and filename
        // Format: /api/v1/posters/icons/{type}/{filename}
        const urlMatch = props.imagePath.match(
          /\/api\/v1\/posters\/icons\/(\w+)\/(.+)/
        );
        if (!urlMatch) {
          logger.warn('Image path does not match expected format', {
            label: 'OverlayRenderer',
            imagePath: props.imagePath,
          });
          return null;
        }

        const [, iconType, filename] = urlMatch;

        // Load image file using iconManager (same as poster template editor)
        const { loadIconFile } = await import('@server/lib/iconManager');
        const imageBuffer = await loadIconFile(
          filename,
          iconType as 'user' | 'system'
        );

        // Resize with 'contain' to maintain aspect ratio (match editor behavior)
        return await sharp(imageBuffer)
          .resize(width, height, {
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          })
          .png()
          .toBuffer();
      } catch (error) {
        logger.error('Failed to load raster image', {
          label: 'OverlayRenderer',
          imagePath: props.imagePath,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    }

    return null;
  }

  /**
   * Escape XML special characters for SVG text
   */
  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}

export const overlayTemplateRenderer = new OverlayTemplateRendererService();
