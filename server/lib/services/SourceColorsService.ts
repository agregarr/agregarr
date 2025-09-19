import { getRepository } from '@server/datasource';
import {
  SourceColors,
  type SourceColorScheme,
} from '@server/entity/SourceColors';
import { DEFAULT_SOURCE_COLORS } from '@server/lib/sourceColors';
import logger from '@server/logger';

export class SourceColorsService {
  private sourceColorsRepository = getRepository(SourceColors);

  /**
   * Get color scheme for a source type, checking database first, then falling back to defaults
   */
  async getSourceColorScheme(sourceType?: string): Promise<SourceColorScheme> {
    if (!sourceType) {
      return this.getDefaultColorScheme();
    }

    try {
      // Check database for user-customized colors
      const sourceColors = await this.sourceColorsRepository.findOne({
        where: { sourceType: sourceType.toLowerCase() },
      });

      if (sourceColors) {
        return sourceColors.getColorScheme();
      }

      // Fall back to hardcoded defaults
      return (
        DEFAULT_SOURCE_COLORS[sourceType.toLowerCase()] ||
        DEFAULT_SOURCE_COLORS.default
      );
    } catch (error) {
      logger.error(`Failed to get source colors for ${sourceType}:`, error);
      return (
        DEFAULT_SOURCE_COLORS[sourceType.toLowerCase()] ||
        DEFAULT_SOURCE_COLORS.default
      );
    }
  }

  /**
   * Get all source colors from database, with fallback to defaults
   */
  async getAllSourceColors(): Promise<Record<string, SourceColorScheme>> {
    try {
      const dbColors = await this.sourceColorsRepository.find();
      const colorMap: Record<string, SourceColorScheme> = {};

      // Start with defaults
      Object.entries(DEFAULT_SOURCE_COLORS).forEach(([sourceType, colors]) => {
        colorMap[sourceType] = colors;
      });

      // Override with database values
      dbColors.forEach((dbColor) => {
        colorMap[dbColor.sourceType] = dbColor.getColorScheme();
      });

      return colorMap;
    } catch (error) {
      logger.error('Failed to get all source colors:', error);
      return DEFAULT_SOURCE_COLORS;
    }
  }

  /**
   * Update source colors for a specific source type
   */
  async updateSourceColors(
    sourceType: string,
    colors: SourceColorScheme
  ): Promise<void> {
    try {
      let sourceColors = await this.sourceColorsRepository.findOne({
        where: { sourceType: sourceType.toLowerCase() },
      });

      if (sourceColors) {
        // Update existing
        sourceColors.primaryColor = colors.primaryColor;
        sourceColors.secondaryColor = colors.secondaryColor;
        sourceColors.textColor = colors.textColor;
      } else {
        // Create new
        sourceColors = new SourceColors({
          sourceType: sourceType.toLowerCase(),
          primaryColor: colors.primaryColor,
          secondaryColor: colors.secondaryColor,
          textColor: colors.textColor,
          isDefault: false,
        });
      }

      await this.sourceColorsRepository.save(sourceColors);
      logger.info(`Updated source colors for ${sourceType}`, colors);
    } catch (error) {
      logger.error(`Failed to update source colors for ${sourceType}:`, error);
      throw error;
    }
  }

  /**
   * Reset source colors to defaults
   */
  async resetToDefaults(): Promise<void> {
    try {
      // Clear all custom colors
      await this.sourceColorsRepository.clear();
      logger.info('Reset all source colors to defaults');
    } catch (error) {
      logger.error('Failed to reset source colors:', error);
      throw error;
    }
  }

  /**
   * Get default color scheme
   */
  private getDefaultColorScheme(): SourceColorScheme {
    return DEFAULT_SOURCE_COLORS.default;
  }
}

// Export singleton instance
export const sourceColorsService = new SourceColorsService();
