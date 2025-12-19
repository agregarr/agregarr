import logger from '@server/logger';
import type { MigrationInterface, QueryRunner } from 'typeorm';

interface LayeredElement {
  id: string;
  layerOrder: number;
  type: 'text' | 'raster' | 'svg' | 'content-grid';
  x: number;
  y: number;
  width: number;
  height: number;
  properties: {
    fontSize?: number;
    spacing?: number;
    cornerRadius?: number;
    [key: string]: unknown;
  };
}

interface PosterTemplateData {
  width: number;
  height: number;
  background: {
    type: 'color' | 'gradient' | 'radial';
    color?: string;
    secondaryColor?: string;
    intensity?: number;
    useSourceColors?: boolean;
  };
  elements: LayeredElement[];
  migrated: boolean;
}

interface SavedPosterData extends PosterTemplateData {
  contentItems?: {
    id: string;
    posterUrl: string;
    x: number;
    y: number;
    width: number;
    height: number;
    cornerRadius: number;
  }[];
}

/**
 * Legacy template data structure (pre-v1.3.2)
 * This is for templates that failed to migrate from the app-level migration
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
  elements?: LayeredElement[];
  migrated?: boolean;
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
 * Layer order constants for converting legacy templates
 */
const DEFAULT_LAYER_ORDERS = {
  RASTER: 10,
  CONTENT_GRID: 20,
  SVG: 30,
  TEXT: 40,
};

const LAYER_ORDER_SPACING = 1;

/**
 * Convert legacy template format to unified format
 * (Inline version of migrateLegacyTemplateData from posterTemplateMigrationV132.ts)
 */
function convertLegacyToUnified(
  templateData: LegacyTemplateData
): LayeredElement[] {
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
        },
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
            },
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
            },
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
          },
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
        },
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
      },
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
        },
      };
      elements.push(element);
      currentTextOrder += LAYER_ORDER_SPACING;
    });
  }

  // Sort elements by layer order
  elements.sort((a, b) => a.layerOrder - b.layerOrder);

  return elements;
}

export class ScalePosterTemplatesTo1000x15001764183954558
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Scale PosterTemplate records from 500x750 to 1000x1500
    const posterTemplates = await queryRunner.query(
      `SELECT id, templateData FROM poster_template`
    );

    for (const template of posterTemplates) {
      const data = JSON.parse(template.templateData) as LegacyTemplateData;

      // Only migrate templates that are 500x750
      if (data.width === 500 && data.height === 750) {
        // Check if template has elements array (unified format)
        // If not, convert from legacy format inline
        if (!data.elements || !Array.isArray(data.elements)) {
          logger.info(
            `Converting legacy poster template (id: ${template.id}) from old format to unified format`
          );
          data.elements = convertLegacyToUnified(data);
          data.migrated = true;
        }

        // Scale canvas dimensions
        data.width = 1000;
        data.height = 1500;

        // Scale all elements
        data.elements = data.elements.map((element) => ({
          ...element,
          x: element.x * 2,
          y: element.y * 2,
          width: element.width * 2,
          height: element.height * 2,
          properties: {
            ...element.properties,
            // Scale text font size
            ...(element.type === 'text' && element.properties.fontSize
              ? { fontSize: element.properties.fontSize * 2 }
              : {}),
            // Scale content grid spacing and corner radius
            ...(element.type === 'content-grid'
              ? {
                  ...(element.properties.spacing
                    ? { spacing: element.properties.spacing * 2 }
                    : {}),
                  ...(element.properties.cornerRadius
                    ? { cornerRadius: element.properties.cornerRadius * 2 }
                    : {}),
                }
              : {}),
          },
        }));

        await queryRunner.query(
          `UPDATE poster_template SET templateData = ? WHERE id = ?`,
          [JSON.stringify(data), template.id]
        );
      }
    }

    // Scale SavedPoster records from 500x750 to 1000x1500
    const savedPosters = await queryRunner.query(
      `SELECT id, posterData FROM saved_poster`
    );

    for (const poster of savedPosters) {
      const data = JSON.parse(poster.posterData) as
        | SavedPosterData
        | LegacyTemplateData;

      // Only migrate posters that are 500x750
      if (data.width === 500 && data.height === 750) {
        // Check if poster has elements array (unified format)
        // If not, convert from legacy format inline
        if (!data.elements || !Array.isArray(data.elements)) {
          logger.info(
            `Converting legacy saved poster (id: ${poster.id}) from old format to unified format`
          );
          data.elements = convertLegacyToUnified(data as LegacyTemplateData);
          (data as SavedPosterData).migrated = true;
        }

        // Scale canvas dimensions
        data.width = 1000;
        data.height = 1500;

        // Scale all elements
        data.elements = data.elements.map((element) => ({
          ...element,
          x: element.x * 2,
          y: element.y * 2,
          width: element.width * 2,
          height: element.height * 2,
          properties: {
            ...element.properties,
            // Scale text font size
            ...(element.type === 'text' && element.properties.fontSize
              ? { fontSize: element.properties.fontSize * 2 }
              : {}),
            // Scale content grid spacing and corner radius
            ...(element.type === 'content-grid'
              ? {
                  ...(element.properties.spacing
                    ? { spacing: element.properties.spacing * 2 }
                    : {}),
                  ...(element.properties.cornerRadius
                    ? { cornerRadius: element.properties.cornerRadius * 2 }
                    : {}),
                }
              : {}),
          },
        }));

        // Scale content items if they exist (SavedPoster specific)
        if ('contentItems' in data && data.contentItems) {
          data.contentItems = data.contentItems.map((item) => ({
            ...item,
            x: item.x * 2,
            y: item.y * 2,
            width: item.width * 2,
            height: item.height * 2,
            cornerRadius: item.cornerRadius * 2,
          }));
        }

        await queryRunner.query(
          `UPDATE saved_poster SET posterData = ? WHERE id = ?`,
          [JSON.stringify(data), poster.id]
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Scale PosterTemplate records from 1000x1500 back to 500x750
    const posterTemplates = await queryRunner.query(
      `SELECT id, templateData FROM poster_template`
    );

    for (const template of posterTemplates) {
      const data: PosterTemplateData = JSON.parse(template.templateData);

      // Only revert templates that are 1000x1500
      if (data.width === 1000 && data.height === 1500) {
        // Skip if template doesn't have elements array (shouldn't happen, but be defensive)
        if (!data.elements || !Array.isArray(data.elements)) {
          logger.warn(
            `Skipping poster template (id: ${template.id}) during rollback - missing elements array`
          );
          continue;
        }

        // Scale canvas dimensions back
        data.width = 500;
        data.height = 750;

        // Scale all elements back
        data.elements = data.elements.map((element) => ({
          ...element,
          x: element.x / 2,
          y: element.y / 2,
          width: element.width / 2,
          height: element.height / 2,
          properties: {
            ...element.properties,
            // Scale text font size back
            ...(element.type === 'text' && element.properties.fontSize
              ? { fontSize: element.properties.fontSize / 2 }
              : {}),
            // Scale content grid spacing and corner radius back
            ...(element.type === 'content-grid'
              ? {
                  ...(element.properties.spacing
                    ? { spacing: element.properties.spacing / 2 }
                    : {}),
                  ...(element.properties.cornerRadius
                    ? { cornerRadius: element.properties.cornerRadius / 2 }
                    : {}),
                }
              : {}),
          },
        }));

        await queryRunner.query(
          `UPDATE poster_template SET templateData = ? WHERE id = ?`,
          [JSON.stringify(data), template.id]
        );
      }
    }

    // Scale SavedPoster records from 1000x1500 back to 500x750
    const savedPosters = await queryRunner.query(
      `SELECT id, posterData FROM saved_poster`
    );

    for (const poster of savedPosters) {
      const data: SavedPosterData = JSON.parse(poster.posterData);

      // Only revert posters that are 1000x1500
      if (data.width === 1000 && data.height === 1500) {
        // Skip if poster doesn't have elements array (shouldn't happen, but be defensive)
        if (!data.elements || !Array.isArray(data.elements)) {
          logger.warn(
            `Skipping saved poster (id: ${poster.id}) during rollback - missing elements array`
          );
          continue;
        }

        // Scale canvas dimensions back
        data.width = 500;
        data.height = 750;

        // Scale all elements back
        data.elements = data.elements.map((element) => ({
          ...element,
          x: element.x / 2,
          y: element.y / 2,
          width: element.width / 2,
          height: element.height / 2,
          properties: {
            ...element.properties,
            // Scale text font size back
            ...(element.type === 'text' && element.properties.fontSize
              ? { fontSize: element.properties.fontSize / 2 }
              : {}),
            // Scale content grid spacing and corner radius back
            ...(element.type === 'content-grid'
              ? {
                  ...(element.properties.spacing
                    ? { spacing: element.properties.spacing / 2 }
                    : {}),
                  ...(element.properties.cornerRadius
                    ? { cornerRadius: element.properties.cornerRadius / 2 }
                    : {}),
                }
              : {}),
          },
        }));

        // Scale content items back if they exist
        if (data.contentItems) {
          data.contentItems = data.contentItems.map((item) => ({
            ...item,
            x: item.x / 2,
            y: item.y / 2,
            width: item.width / 2,
            height: item.height / 2,
            cornerRadius: item.cornerRadius / 2,
          }));
        }

        await queryRunner.query(
          `UPDATE saved_poster SET posterData = ? WHERE id = ?`,
          [JSON.stringify(data), poster.id]
        );
      }
    }
  }
}
