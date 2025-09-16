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
