import type {
  OverlayTemplateData,
  OverlayVariableElementProps,
} from '@server/entity/OverlayTemplate';
import { createHash } from 'crypto';

/**
 * Calculate SHA-256 hash of any input object
 * Ensures deterministic serialization for consistent hashing
 * Uses a custom replacer to handle undefined values and ensure deterministic key ordering
 */
function calculateInputHash(input: unknown): string {
  // Custom replacer function for deterministic serialization
  const replacer = (_key: string, value: unknown) => {
    // Convert undefined to null so it's preserved in the hash
    if (value === undefined) {
      return null;
    }

    // For objects (but not arrays), sort keys for deterministic ordering
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const sorted: Record<string, unknown> = {};
      const keys = Object.keys(value).sort();
      for (const key of keys) {
        sorted[key] = (value as Record<string, unknown>)[key];
      }
      return sorted;
    }

    return value;
  };

  const normalized = JSON.stringify(input, replacer);
  return createHash('sha256').update(normalized).digest('hex');
}

/**
 * Extract field names from application condition rules recursively
 */
function extractFieldsFromCondition(
  condition:
    | {
        sections?: {
          rules?: { field?: string }[];
          sectionOperator?: string;
        }[];
      }
    | null
    | undefined
): Set<string> {
  const fields = new Set<string>();

  if (!condition || !condition.sections) {
    return fields;
  }

  for (const section of condition.sections) {
    if (section.rules) {
      for (const rule of section.rules) {
        if (rule.field) {
          fields.add(rule.field);
        }
      }
    }
  }

  return fields;
}

/**
 * Extract all context field names used by overlay templates
 * Examines both variable elements AND application conditions
 * This ensures hash changes when any field affecting overlay rendering changes
 */
export function extractUsedContextFields(
  templateDataArray: OverlayTemplateData[],
  applicationConditions?: (
    | {
        sections?: {
          rules?: { field?: string }[];
          sectionOperator?: string;
        }[];
      }
    | null
    | undefined
  )[]
): Set<string> {
  const usedFields = new Set<string>();

  // Extract fields from variable elements (for rendering)
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

  // Extract fields from application conditions (for template matching)
  // These fields affect WHICH templates apply, so they must be in the hash
  if (applicationConditions) {
    for (const condition of applicationConditions) {
      const conditionFields = extractFieldsFromCondition(condition);
      for (const field of conditionFields) {
        usedFields.add(field);
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
 * Includes template data so poster regenerates when template is modified
 */
export function calculatePosterInputHash(config: {
  templateId: number | null;
  templateData?: unknown; // Include template configuration for change detection
  itemIds: string[];
  collectionName?: string;
  mediaType?: string;
  collectionType?: string;
  collectionSubtype?: string;
  additionalContext?: Record<string, unknown>;
}): string {
  return calculateInputHash({
    templateId: config.templateId,
    templateData: config.templateData, // Hash the actual template content
    itemIds: [...config.itemIds].sort(), // Ensure sorted for consistency
    collectionName: config.collectionName,
    mediaType: config.mediaType,
    collectionType: config.collectionType,
    collectionSubtype: config.collectionSubtype,
    additionalContext: config.additionalContext,
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
