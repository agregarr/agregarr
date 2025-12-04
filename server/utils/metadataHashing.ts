import type {
  OverlayTemplateData,
  OverlayVariableElementProps,
} from '@server/entity/OverlayTemplate';
import { createHash } from 'crypto';

/**
 * Calculate SHA-256 hash of any input object
 * Ensures deterministic serialization for consistent hashing
 */
function calculateInputHash(input: unknown): string {
  const normalized = JSON.stringify(input, Object.keys(input as object).sort());
  return createHash('sha256').update(normalized).digest('hex');
}

/**
 * Extract all context field names used by overlay templates
 * Examines variable elements to find which fields are actually referenced
 */
export function extractUsedContextFields(
  templateDataArray: OverlayTemplateData[]
): Set<string> {
  const usedFields = new Set<string>();

  for (const templateData of templateDataArray) {
    for (const element of templateData.elements) {
      if (element.type === 'variable') {
        const props = element.properties as OverlayVariableElementProps;
        for (const segment of props.segments) {
          if (segment.type === 'variable' && segment.field) {
            usedFields.add(segment.field);
          }
        }
      }
    }
  }

  // Always include mediaType and isPlaceholder as they're fundamental to overlay rendering
  usedFields.add('mediaType');
  usedFields.add('isPlaceholder');

  return usedFields;
}

/**
 * Calculate hash for auto-generated poster inputs
 * Includes item IDs so poster regenerates when collection contents change
 */
export function calculatePosterInputHash(config: {
  templateId: number | null;
  itemIds: string[];
  collectionName: string;
  mediaType?: string;
  collectionType?: string;
  collectionSubtype?: string;
}): string {
  return calculateInputHash({
    ...config,
    itemIds: [...config.itemIds].sort(), // Ensure sorted for consistency
  });
}

/**
 * Calculate hash for wallpaper inputs (filename is sufficient)
 */
export function calculateWallpaperInputHash(filename: string): string {
  return createHash('sha256').update(filename).digest('hex');
}

/**
 * Calculate hash for theme inputs (filename is sufficient)
 */
export function calculateThemeInputHash(filename: string): string {
  return createHash('sha256').update(filename).digest('hex');
}

/**
 * Calculate hash for overlay inputs
 * Only includes context fields that are actually used by the templates
 * This prevents unnecessary regeneration when unused fields change
 */
export function calculateOverlayInputHash(config: {
  templateIds: number[];
  usedFields: Set<string>;
  context: Record<string, unknown>;
}): string {
  // Extract only the context fields that are actually used
  const relevantContext: Record<string, unknown> = {};
  for (const field of config.usedFields) {
    relevantContext[field] = config.context[field];
  }

  return calculateInputHash({
    templateIds: [...config.templateIds].sort(), // Ensure sorted for consistency
    context: relevantContext, // Only include fields actually used by templates
  });
}
