import { getRepository } from '@server/datasource';
import {
  PosterTemplate,
  type PosterTemplateData,
} from '@server/entity/PosterTemplate';
import logger from '@server/logger';
import sharp from 'sharp';
import {
  type CollectionItemWithPoster,
  type PosterGenerationConfig,
} from './posterGeneration';

export interface TemplatePreviewConfig {
  templateId: number;
  collectionName: string;
  collectionType?: string;
  collectionSubtype?: string;
  mediaType?: 'movie' | 'tv';
  items?: CollectionItemWithPoster[];
}

export interface TemplateValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate a poster template data structure
 */
export function validateTemplateData(
  templateData: PosterTemplateData
): TemplateValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate canvas dimensions
  if (!templateData.width || templateData.width <= 0) {
    errors.push('Template width must be a positive number');
  }
  if (!templateData.height || templateData.height <= 0) {
    errors.push('Template height must be a positive number');
  }

  // Validate background configuration
  if (!templateData.background) {
    errors.push('Background configuration is required');
  } else {
    if (!['color', 'gradient'].includes(templateData.background.type)) {
      errors.push('Background type must be "color" or "gradient"');
    }
    if (
      templateData.background.type === 'gradient' &&
      !templateData.background.secondaryColor &&
      !templateData.background.useSourceColors
    ) {
      warnings.push(
        'Gradient background should have a secondary color or use source colors'
      );
    }

    // Validate source colors structure if present
    if (
      templateData.background.useSourceColors &&
      templateData.background.sourceColors
    ) {
      Object.entries(templateData.background.sourceColors).forEach(
        ([sourceType, colors]) => {
          if (!colors || typeof colors !== 'object') {
            errors.push(
              `Invalid color configuration for source type: ${sourceType}`
            );
            return;
          }

          const requiredColors: (keyof typeof colors)[] = [
            'primaryColor',
            'secondaryColor',
            'textColor',
          ];
          requiredColors.forEach((colorKey) => {
            const colorValue = colors[colorKey];
            if (!colorValue || !colorValue.match(/^#[0-9a-fA-F]{6}$/)) {
              warnings.push(
                `Invalid or missing ${colorKey} for source type: ${sourceType}`
              );
            }
          });
        }
      );
    }
  }

  // Validate text elements
  if (!Array.isArray(templateData.textElements)) {
    templateData.textElements = [];
  }

  templateData.textElements.forEach((textElement, index) => {
    if (!textElement.id) {
      errors.push(`Text element ${index} missing required id`);
    }
    if (!['collection-title', 'custom-text'].includes(textElement.type)) {
      errors.push(
        `Text element ${index} has invalid type: ${textElement.type}`
      );
    }
    if (textElement.type === 'custom-text' && !textElement.text) {
      warnings.push(`Custom text element ${index} has no text content`);
    }
    if (textElement.fontSize <= 0) {
      errors.push(`Text element ${index} font size must be positive`);
    }
    if (!textElement.color || !textElement.color.match(/^#[0-9a-fA-F]{6}$/)) {
      warnings.push(`Text element ${index} color should be a valid hex color`);
    }
  });

  // Validate icon elements
  if (!Array.isArray(templateData.iconElements)) {
    templateData.iconElements = [];
  }

  templateData.iconElements.forEach((iconElement, index) => {
    if (!iconElement.id) {
      errors.push(`Icon element ${index} missing required id`);
    }
    if (!['source-logo', 'custom-icon'].includes(iconElement.type)) {
      errors.push(
        `Icon element ${index} has invalid type: ${iconElement.type}`
      );
    }
    if (iconElement.type === 'custom-icon' && !iconElement.iconPath) {
      warnings.push(`Custom icon element ${index} has no icon path`);
    }
    if (iconElement.width <= 0 || iconElement.height <= 0) {
      errors.push(`Icon element ${index} width and height must be positive`);
    }
  });

  // Validate content grid (optional)
  if (templateData.contentGrid) {
    const grid = templateData.contentGrid;
    if (!grid.id) {
      errors.push('Content grid missing required id');
    }
    if (grid.columns <= 0 || grid.rows <= 0) {
      errors.push('Content grid columns and rows must be positive');
    }
    if (grid.width <= 0 || grid.height <= 0) {
      errors.push('Content grid width and height must be positive');
    }
    if (grid.spacing < 0) {
      warnings.push('Content grid spacing should not be negative');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Apply a template to generate a poster using collection data
 */
export async function applyTemplate(
  templateId: number,
  config: {
    collectionName: string;
    collectionType?: string;
    collectionSubtype?: string;
    mediaType?: 'movie' | 'tv';
    items?: CollectionItemWithPoster[];
    dynamicLogo?: string;
  }
): Promise<Buffer> {
  const templateRepository = getRepository(PosterTemplate);

  const template = await templateRepository.findOne({
    where: { id: templateId, isActive: true },
  });

  if (!template) {
    throw new Error(`Template ${templateId} not found`);
  }

  const templateData = template.getTemplateData();

  // Validate template before applying
  const validation = validateTemplateData(templateData);
  if (!validation.isValid) {
    throw new Error(
      `Template validation failed: ${validation.errors.join(', ')}`
    );
  }

  // Convert template to poster generation config
  const posterConfig: PosterGenerationConfig = {
    collectionName: config.collectionName,
    collectionType: config.collectionType,
    collectionSubtype: config.collectionSubtype,
    mediaType: config.mediaType,
    items: config.items || [],
    // Add template reference for future template-aware generation
    template: `template-${templateId}`,
    // Pass template data for color customization
    templateData: templateData,
    // Pass through dynamic logo if available
    dynamicLogo: config.dynamicLogo,
  };

  // Generate poster directly using SVG system to avoid recursion
  const { generatePosterSVG } = await import('./posterGeneration');
  const svgContent = await generatePosterSVG(posterConfig);

  // Convert SVG to PNG buffer
  const sharp = (await import('sharp')).default;
  const buffer = await sharp(Buffer.from(svgContent))
    .png({ quality: 90 })
    .toBuffer();

  return buffer;
}

/**
 * Generate a preview of a template with sample data
 */
export async function generateTemplatePreview(
  templateId: number,
  previewConfig?: Partial<TemplatePreviewConfig>
): Promise<Buffer> {
  const sampleItems: CollectionItemWithPoster[] = [
    {
      title: 'Sample Movie 1',
      type: 'movie',
      tmdbId: 550,
      year: 1999,
    },
    {
      title: 'Sample Movie 2',
      type: 'movie',
      tmdbId: 155,
      year: 2008,
    },
    {
      title: 'Sample TV Show 1',
      type: 'tv',
      tmdbId: 1399,
      year: 2011,
    },
    {
      title: 'Sample TV Show 2',
      type: 'tv',
      tmdbId: 1396,
      year: 2008,
    },
  ];

  const config = {
    collectionName: previewConfig?.collectionName || 'Sample Collection',
    collectionType: previewConfig?.collectionType || 'trakt',
    collectionSubtype: previewConfig?.collectionSubtype,
    mediaType: previewConfig?.mediaType || ('movie' as const),
    items: previewConfig?.items || sampleItems,
  };

  return await applyTemplate(templateId, config);
}

/**
 * Create a thumbnail version of a poster buffer
 */
export async function createPosterThumbnail(
  posterBuffer: Buffer,
  maxWidth = 200,
  maxHeight = 300
): Promise<Buffer> {
  try {
    return await sharp(posterBuffer)
      .resize(maxWidth, maxHeight, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 85 })
      .toBuffer();
  } catch (error) {
    logger.error('Failed to create poster thumbnail:', error);
    throw new Error('Failed to create poster thumbnail');
  }
}

/**
 * Get all available template types for filtering/organization
 */
export function getTemplateTypes(): string[] {
  return [
    'trakt',
    'tmdb',
    'imdb',
    'letterboxd',
    'tautulli',
    'overseerr',
    'hub',
    'multi-source',
    // Streaming platforms (networks)
    'netflix',
    'hbo',
    'disney',
    'amazon-prime',
    'apple-tv',
    'paramount',
    'peacock',
    'crunchyroll',
    'discovery-plus',
    'hulu',
    'default',
  ];
}

/**
 * Sanitize template data by removing invalid elements and fixing common issues
 */
export function sanitizeTemplateData(
  templateData: Partial<PosterTemplateData>
): PosterTemplateData {
  const sanitized: PosterTemplateData = {
    width: Math.max(100, templateData.width || 500),
    height: Math.max(100, templateData.height || 750),
    background: {
      type: ['color', 'gradient'].includes(templateData.background?.type || '')
        ? (templateData.background?.type as 'color' | 'gradient')
        : 'color',
      color: templateData.background?.color || '#6366f1',
      secondaryColor: templateData.background?.secondaryColor,
      useSourceColors: Boolean(templateData.background?.useSourceColors),
      sourceColors: templateData.background?.sourceColors
        ? Object.fromEntries(
            Object.entries(templateData.background.sourceColors)
              .filter(([, colors]) => colors && typeof colors === 'object')
              .map(([sourceType, colors]) => [
                sourceType,
                {
                  primaryColor: colors.primaryColor?.match(/^#[0-9a-fA-F]{6}$/)
                    ? colors.primaryColor
                    : '#6366f1',
                  secondaryColor: colors.secondaryColor?.match(
                    /^#[0-9a-fA-F]{6}$/
                  )
                    ? colors.secondaryColor
                    : '#1e1b4b',
                  textColor: colors.textColor?.match(/^#[0-9a-fA-F]{6}$/)
                    ? colors.textColor
                    : '#ffffff',
                },
              ])
          )
        : undefined,
    },
    textElements: Array.isArray(templateData.textElements)
      ? templateData.textElements
          .filter((el) => el.id && el.type)
          .map((el) => ({
            ...el,
            fontSize: Math.max(8, el.fontSize || 16),
            color: el.color?.match(/^#[0-9a-fA-F]{6}$/) ? el.color : '#ffffff',
            fontFamily: el.fontFamily || 'Arial, sans-serif',
            fontWeight: ['normal', 'bold'].includes(el.fontWeight || '')
              ? (el.fontWeight as 'normal' | 'bold')
              : 'normal',
            fontStyle: ['normal', 'italic'].includes(el.fontStyle || '')
              ? (el.fontStyle as 'normal' | 'italic')
              : 'normal',
            textAlign: ['left', 'center', 'right'].includes(el.textAlign || '')
              ? (el.textAlign as 'left' | 'center' | 'right')
              : 'center',
          }))
      : [],
    iconElements: Array.isArray(templateData.iconElements)
      ? templateData.iconElements
          .filter((el) => el.id && el.type)
          .map((el) => ({
            ...el,
            width: Math.max(10, el.width || 50),
            height: Math.max(10, el.height || 50),
            grayscale: Boolean(el.grayscale),
          }))
      : [],
    contentGrid: templateData.contentGrid
      ? {
          ...templateData.contentGrid,
          columns: Math.max(1, templateData.contentGrid.columns || 2),
          rows: Math.max(1, templateData.contentGrid.rows || 2),
          spacing: Math.max(0, templateData.contentGrid.spacing || 8),
          cornerRadius: Math.max(0, templateData.contentGrid.cornerRadius || 4),
        }
      : undefined,
  };

  return sanitized;
}
