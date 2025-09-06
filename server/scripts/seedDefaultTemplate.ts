#!/usr/bin/env ts-node
import dataSource, { getRepository } from '@server/datasource';
import {
  PosterTemplate,
  type PosterTemplateData,
} from '@server/entity/PosterTemplate';
import logger from '@server/logger';

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

    const templateRepository = getRepository(PosterTemplate);

    // Check if default template already exists
    const existingTemplate = await templateRepository.findOne({
      where: { isDefault: true },
    });

    if (existingTemplate) {
      logger.info('Default template already exists, skipping seed');
      return;
    }

    // Create the default template data based on current auto-poster design
    const defaultTemplateData: PosterTemplateData = {
      width: 500,
      height: 750,
      background: {
        type: 'gradient',
        useSourceColors: true, // Use source colors like current system
      },
      textElements: [
        {
          id: 'collection-title',
          type: 'collection-title',
          x: 250, // centered
          y: 320, // positioned after logo section
          width: 440, // max width with padding
          height: 100,
          fontSize: 32,
          fontFamily: 'Helvetica Neue, Segoe UI, Arial, sans-serif',
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
          type: 'service-logo',
          x: 250, // centered
          y: 95, // top section
          width: 60,
          height: 60,
          grayscale: false,
        },
      ],
      contentGrid: {
        id: 'items-grid',
        x: 84, // centered: (500 - (150*2 + 16)) / 2 = 84
        y: 470, // positioned in lower section
        width: 332, // 2 columns * 150px + 1 spacing * 16px
        height: 466, // 2 rows * 225px + 1 spacing * 16px
        columns: 2,
        rows: 2,
        spacing: 16,
        cornerRadius: 6,
      },
    };

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
