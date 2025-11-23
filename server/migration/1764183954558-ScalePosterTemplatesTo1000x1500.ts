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

export class ScalePosterTemplatesTo1000x15001764183954558
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Scale PosterTemplate records from 500x750 to 1000x1500
    const posterTemplates = await queryRunner.query(
      `SELECT id, templateData FROM poster_template`
    );

    for (const template of posterTemplates) {
      const data: PosterTemplateData = JSON.parse(template.templateData);

      // Only migrate templates that are 500x750
      if (data.width === 500 && data.height === 750) {
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
      const data: SavedPosterData = JSON.parse(poster.posterData);

      // Only migrate posters that are 500x750
      if (data.width === 500 && data.height === 750) {
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

        // Scale content items if they exist
        if (data.contentItems) {
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
