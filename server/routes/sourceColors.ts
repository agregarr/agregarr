import { getRepository } from '@server/datasource';
import {
  SourceColors,
  type SourceColorScheme,
} from '@server/entity/SourceColors';
import { sourceColorsService } from '@server/lib/services/SourceColorsService';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';

const sourceColorsRoutes = Router();

/**
 * GET /api/v1/source-colors
 * Get all source colors (database + defaults)
 */
sourceColorsRoutes.get('/', isAuthenticated(), async (req, res) => {
  try {
    const sourceColors = await sourceColorsService.getAllSourceColors();
    const response = {
      sourceColors,
      sourceTypes: Object.keys(sourceColors),
    };
    res.status(200).json(response);
  } catch (error) {
    logger.error('Failed to get source colors:', error);
    res.status(500).json({ error: 'Failed to get source colors' });
  }
});

/**
 * GET /api/v1/source-colors/:sourceType
 * Get specific source color scheme
 */
sourceColorsRoutes.get('/:sourceType', isAuthenticated(), async (req, res) => {
  try {
    const { sourceType } = req.params;
    const colorScheme = await sourceColorsService.getSourceColorScheme(
      sourceType
    );
    res.status(200).json(colorScheme);
  } catch (error) {
    logger.error(
      `Failed to get source colors for ${req.params.sourceType}:`,
      error
    );
    res.status(500).json({ error: 'Failed to get source colors' });
  }
});

/**
 * PUT /api/v1/source-colors/:sourceType
 * Update source colors for a specific source type
 */
sourceColorsRoutes.put('/:sourceType', isAuthenticated(), async (req, res) => {
  try {
    const { sourceType } = req.params;
    const { primaryColor, secondaryColor, textColor }: SourceColorScheme =
      req.body;

    // Validate input
    if (!primaryColor || !secondaryColor || !textColor) {
      return res.status(400).json({
        error:
          'Missing required fields: primaryColor, secondaryColor, textColor',
      });
    }

    // Validate hex color format
    const hexColorRegex = /^#[0-9a-fA-F]{6}$/;
    if (
      !hexColorRegex.test(primaryColor) ||
      !hexColorRegex.test(secondaryColor) ||
      !hexColorRegex.test(textColor)
    ) {
      return res.status(400).json({
        error: 'Colors must be valid hex format (#RRGGBB)',
      });
    }

    const colors: SourceColorScheme = {
      primaryColor,
      secondaryColor,
      textColor,
    };

    await sourceColorsService.updateSourceColors(sourceType, colors);

    res.status(200).json({
      message: `Source colors updated for ${sourceType}`,
      colors,
    });
  } catch (error) {
    logger.error(
      `Failed to update source colors for ${req.params.sourceType}:`,
      error
    );
    res.status(500).json({ error: 'Failed to update source colors' });
  }
});

/**
 * DELETE /api/v1/source-colors/:sourceType
 * Reset specific source type to defaults
 */
sourceColorsRoutes.delete(
  '/:sourceType',
  isAuthenticated(),
  async (req, res) => {
    try {
      const { sourceType } = req.params;
      const sourceColorsRepository = getRepository(SourceColors);

      await sourceColorsRepository.delete({
        sourceType: sourceType.toLowerCase(),
      });

      // Get the default colors that will now be used
      const defaultColors = await sourceColorsService.getSourceColorScheme(
        sourceType
      );

      res.status(200).json({
        message: `Source colors reset to defaults for ${sourceType}`,
        colors: defaultColors,
      });
    } catch (error) {
      logger.error(
        `Failed to reset source colors for ${req.params.sourceType}:`,
        error
      );
      res.status(500).json({ error: 'Failed to reset source colors' });
    }
  }
);

/**
 * GET /api/v1/source-colors/export
 * Export all source color schemes as JSON
 */
sourceColorsRoutes.get('/export', isAuthenticated(), async (req, res) => {
  try {
    const sourceColors = await sourceColorsService.getAllSourceColors();

    const exportData = {
      sourceColors,
      exportedAt: new Date().toISOString(),
      version: '1.0',
    };

    // Set headers for file download
    res.set({
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="source_colors.json"',
    });

    res.json(exportData);
  } catch (error) {
    logger.error('Failed to export source colors:', error);
    res.status(500).json({ error: 'Failed to export source colors' });
  }
});

/**
 * POST /api/v1/source-colors/import
 * Import source color schemes from JSON
 */
sourceColorsRoutes.post('/import', isAuthenticated(), async (req, res) => {
  try {
    const { sourceColors, version } = req.body;

    if (!sourceColors) {
      return res.status(400).json({
        error: 'Source colors data is required',
      });
    }

    // Validate version compatibility
    if (version && version !== '1.0') {
      return res.status(400).json({
        error: `Unsupported version: ${version}. This version of Agregarr supports version 1.0.`,
      });
    }

    // Validate sourceColors structure
    if (typeof sourceColors !== 'object') {
      return res.status(400).json({
        error: 'Invalid source colors format',
      });
    }

    // Validate each color scheme
    const hexColorRegex = /^#[0-9a-fA-F]{6}$/;
    for (const [sourceType, colorScheme] of Object.entries(sourceColors)) {
      if (typeof colorScheme !== 'object' || !colorScheme) {
        return res.status(400).json({
          error: `Invalid color scheme for ${sourceType}`,
        });
      }

      const { primaryColor, secondaryColor, textColor } =
        colorScheme as SourceColorScheme;

      if (!primaryColor || !secondaryColor || !textColor) {
        return res.status(400).json({
          error: `Missing color values for ${sourceType}`,
        });
      }

      if (
        !hexColorRegex.test(primaryColor) ||
        !hexColorRegex.test(secondaryColor) ||
        !hexColorRegex.test(textColor)
      ) {
        return res.status(400).json({
          error: `Invalid hex color format for ${sourceType}`,
        });
      }
    }

    // Import all color schemes
    let importCount = 0;
    for (const [sourceType, colorScheme] of Object.entries(sourceColors)) {
      const colors = colorScheme as SourceColorScheme;
      await sourceColorsService.updateSourceColors(sourceType, colors);
      importCount++;
    }

    logger.info('Imported source colors', {
      count: importCount,
      sourceTypes: Object.keys(sourceColors),
      userId: req.user?.id,
    });

    // Return updated colors
    const updatedColors = await sourceColorsService.getAllSourceColors();

    res.status(200).json({
      message: `Successfully imported ${importCount} source color schemes`,
      importCount,
      sourceColors: updatedColors,
    });
  } catch (error) {
    logger.error('Failed to import source colors:', error);
    res.status(500).json({ error: 'Failed to import source colors' });
  }
});

/**
 * POST /api/v1/source-colors/reset
 * Reset all source colors to defaults
 */
sourceColorsRoutes.post('/reset', isAuthenticated(), async (req, res) => {
  try {
    await sourceColorsService.resetToDefaults();
    const defaultColors = await sourceColorsService.getAllSourceColors();

    res.status(200).json({
      message: 'All source colors reset to defaults',
      colors: defaultColors,
    });
  } catch (error) {
    logger.error('Failed to reset all source colors:', error);
    res.status(500).json({ error: 'Failed to reset source colors' });
  }
});

export default sourceColorsRoutes;
