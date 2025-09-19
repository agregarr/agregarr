#!/usr/bin/env ts-node
import dataSource, { getRepository } from '@server/datasource';
import {
  PosterTemplate,
  type PosterTemplateData,
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

    // Create the default template data based on current architecture
    const defaultTemplateData: PosterTemplateData = {
      width: 500,
      height: 750,
      background: {
        type: 'gradient',
        color: '#6366f1',
        secondaryColor: '#1e1b4b',
        useSourceColors: true, // Use global source colors from SourceColors table
      },
      textElements: [
        {
          id: 'collection-title',
          type: 'collection-title',
          x: 32,
          y: 111,
          width: 440,
          height: 100,
          fontSize: 32,
          fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
          fontWeight: 'bold',
          fontStyle: 'normal',
          color: '#ffffff',
          textAlign: 'center',
          maxLines: 3,
        },
      ],
      iconElements: [
        {
          id: 'service-logo',
          type: 'source-logo',
          x: 223,
          y: 34,
          width: 62,
          height: 62,
          grayscale: false,
        },
      ],
      contentGrid: {
        id: 'items-grid',
        x: 91,
        y: 227,
        width: 324,
        height: 478,
        columns: 2,
        rows: 2,
        spacing: 16,
        cornerRadius: 4,
      },
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
