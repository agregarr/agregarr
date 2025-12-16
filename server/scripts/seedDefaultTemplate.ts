#!/usr/bin/env ts-node
import dataSource, { getRepository } from '@server/datasource';
import {
  PosterTemplate,
  type ContentGridProps,
  type PosterTemplateData,
  type SVGElementProps,
  type TextElementProps,
} from '@server/entity/PosterTemplate';
import logger from '@server/logger';
import { seedSourceColors } from './seedSourceColors';

/**
 * Seeds the database with a default poster template
 * This recreates the current auto-poster design as a template
 */
async function seedDefaultTemplate() {
  try {
    // Initialize database connection
    if (!dataSource.isInitialized) {
      await dataSource.initialize();
    }

    // First, ensure source colors are seeded (templates depend on them)
    await seedSourceColors();

    const templateRepository = getRepository(PosterTemplate);

    // Create the default template data in unified format
    const defaultTemplateData: PosterTemplateData = {
      width: 1000,
      height: 1500,
      background: {
        type: 'gradient',
        color: '#6366f1',
        secondaryColor: '#1e1b4b',
        useSourceColors: true, // Use global source colors from SourceColors table
      },
      elements: [
        // Service logo (layer 10) - scaled 2x from original 500x750
        {
          id: 'service-logo',
          layerOrder: 10,
          type: 'svg',
          x: 446,
          y: 68,
          width: 124,
          height: 124,
          properties: {
            iconType: 'source-logo',
            grayscale: false,
          } as SVGElementProps,
        },
        // Content grid (layer 20) - scaled 2x from original 500x750
        {
          id: 'items-grid',
          layerOrder: 20,
          type: 'content-grid',
          x: 182,
          y: 454,
          width: 648,
          height: 956,
          properties: {
            columns: 2,
            rows: 2,
            spacing: 32,
            cornerRadius: 8,
          } as ContentGridProps,
        },
        // Collection title (layer 40) - scaled 2x from original 500x750
        {
          id: 'collection-title',
          layerOrder: 40,
          type: 'text',
          x: 64,
          y: 222,
          width: 880,
          height: 200,
          properties: {
            elementType: 'collection-title',
            fontSize: 80,
            fontFamily: 'Inter',
            fontWeight: 'bold',
            fontStyle: 'normal',
            color: '#ffffff',
            textAlign: 'center',
            maxLines: 6,
          } as TextElementProps,
        },
      ],
      migrated: true,
    };

    // Check if default template already exists
    const existingTemplate = await templateRepository.findOne({
      where: { isDefault: true },
    });

    if (existingTemplate) {
      // Update the existing template with new data
      existingTemplate.setTemplateData(defaultTemplateData);
      await templateRepository.save(existingTemplate);
      logger.info('Default poster template refreshed', {
        templateId: existingTemplate.id,
        name: existingTemplate.name,
      });
      return;
    }

    const defaultTemplate = new PosterTemplate({
      name: 'Default Agregarr Template',
      description:
        'The original Agregarr auto-poster design converted to a template',
      isDefault: true,
      isActive: true,
    });

    defaultTemplate.setTemplateData(defaultTemplateData);

    await templateRepository.save(defaultTemplate);

    logger.info('Successfully seeded default poster template', {
      templateId: defaultTemplate.id,
      name: defaultTemplate.name,
    });
  } catch (error) {
    logger.error('Failed to seed default template:', error);
    throw error;
  }
}

// Run the seed if called directly
if (require.main === module) {
  seedDefaultTemplate()
    .then(() => {
      logger.info('Seed completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Seed failed:', error);
      process.exit(1);
    });
}

export { seedDefaultTemplate };
