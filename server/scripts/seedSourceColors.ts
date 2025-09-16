#!/usr/bin/env ts-node
import dataSource, { getRepository } from '@server/datasource';
import { SourceColors } from '@server/entity/SourceColors';
import { DEFAULT_SOURCE_COLORS } from '@server/lib/sourceColors';
import logger from '@server/logger';

/**
 * Seeds the database with default source colors
 * These can then be customized by users through the UI
 */
async function seedSourceColors() {
  try {
    // Initialize database connection
    if (!dataSource.isInitialized) {
      await dataSource.initialize();
    }

    const sourceColorsRepository = getRepository(SourceColors);

    // Check if any source colors already exist
    const existingCount = await sourceColorsRepository.count();
    if (existingCount > 0) {
      logger.info(
        `Source colors already exist (${existingCount} entries), skipping seed`
      );
      return;
    }

    // Seed default source colors
    const sourceColorEntries: SourceColors[] = [];

    Object.entries(DEFAULT_SOURCE_COLORS).forEach(([sourceType, colors]) => {
      // Skip the 'default' entry as it's a fallback, not a specific source
      if (sourceType === 'default') return;

      const sourceColors = new SourceColors({
        sourceType,
        primaryColor: colors.primaryColor,
        secondaryColor: colors.secondaryColor,
        textColor: colors.textColor,
        isDefault: true, // Mark as system defaults
      });

      sourceColorEntries.push(sourceColors);
    });

    await sourceColorsRepository.save(sourceColorEntries);

    logger.info(
      `Successfully seeded ${sourceColorEntries.length} source colors`,
      {
        sources: sourceColorEntries.map((entry) => entry.sourceType),
      }
    );
  } catch (error) {
    logger.error('Failed to seed source colors:', error);
    throw error;
  }
}

// Run the seed if called directly
if (require.main === module) {
  seedSourceColors()
    .then(() => {
      logger.info('Source colors seed completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Source colors seed failed:', error);
      process.exit(1);
    });
}

export { seedSourceColors };
