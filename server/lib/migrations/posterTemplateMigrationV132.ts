import { getRepository } from '@server/datasource';
import {
  PosterTemplate,
  type ContentGridProps,
  type LayeredElement,
  type PosterTemplateData,
  type RasterElementProps,
  type SVGElementProps,
  type TextElementProps,
} from '@server/entity/PosterTemplate';
import logger from '@server/logger';

/**
 * Legacy template data structure for migration purposes
 */
interface LegacyTemplateData {
  width: number;
  height: number;
  background: {
    type: 'color' | 'gradient';
    color?: string;
    secondaryColor?: string;
    useSourceColors?: boolean;
  };

  // New unified system (may exist if partially migrated)
  elements?: LayeredElement[];
  migrated?: boolean;

  // Legacy element arrays we're migrating FROM
  textElements?: {
    id: string;
    type: 'collection-title' | 'custom-text';
    text?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    fontSize: number;
    fontFamily: string;
    fontWeight: 'normal' | 'bold';
    fontStyle: 'normal' | 'italic';
    color: string;
    textAlign: 'left' | 'center' | 'right';
    maxLines?: number;
  }[];

  iconElements?: {
    id: string;
    type: 'source-logo' | 'custom-icon';
    iconPath?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    grayscale: boolean;
  }[];

  rasterElements?: {
    id: string;
    type: 'raster-image';
    imagePath: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }[];

  svgElements?: {
    id: string;
    type: 'source-logo' | 'svg-icon';
    iconPath?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    grayscale: boolean;
  }[];

  contentGrid?: {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    columns: number;
    rows: number;
    spacing: number;
    cornerRadius: number;
  };
}

/**
 * Default layer order assignments for migrating elements to unified system
 */
const DEFAULT_LAYER_ORDERS = {
  RASTER: 10,
  CONTENT_GRID: 20,
  SVG: 30,
  TEXT: 40,
};

const LAYER_ORDER_SPACING = 1;

/**
 * Migrates all poster templates to unified layering system for v1.3.2
 * Converts legacy template data structure to new unified format
 */
export async function runPosterTemplateMigration(): Promise<void> {
  try {
    const templateRepository = getRepository(PosterTemplate);
    const allTemplates = await templateRepository.find();

    if (allTemplates.length === 0) {
      logger.info('No poster templates found, skipping migration');
      return;
    }

    let migratedCount = 0;
    let alreadyMigratedCount = 0;
    let errorCount = 0;

    for (const template of allTemplates) {
      try {
        // Get raw template data without validation (migration might not be complete yet)
        const templateData = JSON.parse(
          template.templateData
        ) as LegacyTemplateData;

        // Skip if already migrated
        if (templateData.migrated && templateData.elements) {
          alreadyMigratedCount++;
          continue;
        }

        // Migrate to unified format
        const migratedData = migrateLegacyTemplateData(templateData);

        // Save migrated template (directly set templateData to avoid validation)
        template.templateData = JSON.stringify(migratedData);
        await templateRepository.save(template);

        migratedCount++;

        logger.debug(`Migrated poster template: ${template.name}`, {
          templateId: template.id,
          elementsCount: migratedData.elements?.length || 0,
        });
      } catch (error) {
        errorCount++;
        logger.error(`Failed to migrate poster template: ${template.name}`, {
          templateId: template.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info('Poster template migration completed', {
      label: 'Poster Template Migration v1.3.2',
      totalTemplates: allTemplates.length,
      migrated: migratedCount,
      alreadyMigrated: alreadyMigratedCount,
      errors: errorCount,
    });

    if (errorCount > 0) {
      logger.warn(
        `${errorCount} templates failed to migrate - check logs for details`
      );
    }
  } catch (error) {
    logger.error('Poster template migration failed:', error);
    throw error;
  }
}

/**
 * Converts legacy template data to unified layered format
 */
export function migrateLegacyTemplateData(
  templateData: LegacyTemplateData
): PosterTemplateData {
  const elements: LayeredElement[] = [];
  let currentRasterOrder = DEFAULT_LAYER_ORDERS.RASTER;
  let currentSVGOrder = DEFAULT_LAYER_ORDERS.SVG;
  let currentTextOrder = DEFAULT_LAYER_ORDERS.TEXT;

  // Migrate raster elements
  if (templateData.rasterElements) {
    templateData.rasterElements.forEach((rasterElement) => {
      const element: LayeredElement = {
        id: rasterElement.id,
        layerOrder: currentRasterOrder,
        type: 'raster',
        x: rasterElement.x,
        y: rasterElement.y,
        width: rasterElement.width,
        height: rasterElement.height,
        properties: {
          imagePath: rasterElement.imagePath,
        } as RasterElementProps,
      };
      elements.push(element);
      currentRasterOrder += LAYER_ORDER_SPACING;
    });
  }

  // Migrate legacy iconElements (detect raster vs SVG by file extension)
  if (templateData.iconElements) {
    const rasterExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

    templateData.iconElements.forEach((iconElement) => {
      if (iconElement.iconPath) {
        const isRaster = rasterExtensions.some((ext) =>
          iconElement.iconPath?.toLowerCase().endsWith(ext)
        );

        if (isRaster) {
          // Migrate as raster element
          const element: LayeredElement = {
            id: iconElement.id,
            layerOrder: currentRasterOrder,
            type: 'raster',
            x: iconElement.x,
            y: iconElement.y,
            width: iconElement.width,
            height: iconElement.height,
            properties: {
              imagePath: iconElement.iconPath,
            } as RasterElementProps,
          };
          elements.push(element);
          currentRasterOrder += LAYER_ORDER_SPACING;
        } else {
          // Migrate as SVG element
          const iconType =
            iconElement.type === 'custom-icon' ? 'svg-icon' : iconElement.type;
          const element: LayeredElement = {
            id: iconElement.id,
            layerOrder: currentSVGOrder,
            type: 'svg',
            x: iconElement.x,
            y: iconElement.y,
            width: iconElement.width,
            height: iconElement.height,
            properties: {
              iconType,
              iconPath: iconElement.iconPath,
              grayscale: iconElement.grayscale || false,
            } as SVGElementProps,
          };
          elements.push(element);
          currentSVGOrder += LAYER_ORDER_SPACING;
        }
      } else {
        // Icon without path - treat as SVG placeholder
        const iconType =
          iconElement.type === 'custom-icon' ? 'svg-icon' : iconElement.type;
        const element: LayeredElement = {
          id: iconElement.id,
          layerOrder: currentSVGOrder,
          type: 'svg',
          x: iconElement.x,
          y: iconElement.y,
          width: iconElement.width,
          height: iconElement.height,
          properties: {
            iconType,
            iconPath: iconElement.iconPath,
            grayscale: iconElement.grayscale || false,
          } as SVGElementProps,
        };
        elements.push(element);
        currentSVGOrder += LAYER_ORDER_SPACING;
      }
    });
  }

  // Migrate svgElements
  if (templateData.svgElements) {
    templateData.svgElements.forEach((svgElement) => {
      const element: LayeredElement = {
        id: svgElement.id,
        layerOrder: currentSVGOrder,
        type: 'svg',
        x: svgElement.x,
        y: svgElement.y,
        width: svgElement.width,
        height: svgElement.height,
        properties: {
          iconType: svgElement.type,
          iconPath: svgElement.iconPath,
          grayscale: svgElement.grayscale,
        } as SVGElementProps,
      };
      elements.push(element);
      currentSVGOrder += LAYER_ORDER_SPACING;
    });
  }

  // Migrate content grid (if exists)
  if (templateData.contentGrid) {
    const element: LayeredElement = {
      id: templateData.contentGrid.id,
      layerOrder: DEFAULT_LAYER_ORDERS.CONTENT_GRID,
      type: 'content-grid',
      x: templateData.contentGrid.x,
      y: templateData.contentGrid.y,
      width: templateData.contentGrid.width,
      height: templateData.contentGrid.height,
      properties: {
        columns: templateData.contentGrid.columns,
        rows: templateData.contentGrid.rows,
        spacing: templateData.contentGrid.spacing,
        cornerRadius: templateData.contentGrid.cornerRadius,
      } as ContentGridProps,
    };
    elements.push(element);
  }

  // Migrate text elements
  if (templateData.textElements) {
    templateData.textElements.forEach((textElement) => {
      const element: LayeredElement = {
        id: textElement.id,
        layerOrder: currentTextOrder,
        type: 'text',
        x: textElement.x,
        y: textElement.y,
        width: textElement.width,
        height: textElement.height,
        properties: {
          elementType: textElement.type,
          text: textElement.text,
          fontSize: textElement.fontSize,
          fontFamily: textElement.fontFamily,
          fontWeight: textElement.fontWeight,
          fontStyle: textElement.fontStyle,
          color: textElement.color,
          textAlign: textElement.textAlign,
          maxLines: textElement.maxLines,
        } as TextElementProps,
      };
      elements.push(element);
      currentTextOrder += LAYER_ORDER_SPACING;
    });
  }

  // Sort elements by layer order
  elements.sort((a, b) => a.layerOrder - b.layerOrder);

  // Return clean migrated data (remove legacy fields)
  return {
    width: templateData.width,
    height: templateData.height,
    background: templateData.background,
    elements,
    migrated: true,
  };
}
