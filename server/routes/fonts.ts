import logger from '@server/logger';
import { exec } from 'child_process';
import { Router } from 'express';
import { promisify } from 'util';

const execAsync = promisify(exec);
const fontsRoutes = Router();

interface FontInfo {
  family: string;
  availableWeights: string[];
  cssValue: string;
  fontUrl?: string;
}

/**
 * Get all available fonts in the system
 */
fontsRoutes.get('/', async (req, res) => {
  try {
    // Use fc-list to get all available fonts with file paths
    const { stdout } = await execAsync('fc-list : family file');

    const fontMap = new Map<string, string>();

    // Parse fc-list output to get both family and file path
    const lines = stdout
      .trim()
      .split('\n')
      .filter((line) => line.trim());

    for (const line of lines) {
      // fc-list format: "/path/to/font.ttf: Family Name:style=Style"
      const parts = line.split(':');
      if (parts.length >= 2) {
        const filePath = parts[0].trim();
        let family = parts[1].trim();

        // Clean up family names that have commas (multiple variants)
        family = family.split(',')[0].trim();

        // Skip emoji and symbol fonts that aren't suitable for text
        if (
          family.toLowerCase().includes('emoji') ||
          family.toLowerCase().includes('symbol') ||
          family.toLowerCase().includes('noto color')
        ) {
          continue;
        }

        // Only include TTF fonts for web serving
        if (filePath.endsWith('.ttf')) {
          // Prioritize system fonts over local fonts for unified behavior
          if (
            !fontMap.has(family) ||
            filePath.startsWith('/usr/share/fonts/')
          ) {
            fontMap.set(family, filePath);
          }
        }
      }
    }

    // Convert to final format with exact CSS values and font URLs
    const fonts: FontInfo[] = [];
    for (const [family, filePath] of fontMap) {
      // Only include fonts from /usr/share/fonts/ for unified Docker/local behavior
      if (!filePath.startsWith('/usr/share/fonts/')) {
        continue;
      }

      // Store clean font name - quotes will be added during CSS/SVG generation when needed
      const cssValue = family;

      // Convert system path to web URL
      const fontUrl = filePath.replace('/usr/share/fonts/', '/fonts/');

      fonts.push({
        family,
        availableWeights: ['Regular', 'Bold'], // Simplified - assume these are available
        cssValue,
        fontUrl, // Add font URL for preloading
      });
    }

    // Sort fonts alphabetically
    fonts.sort((a, b) => a.family.localeCompare(b.family));

    logger.info(`Found ${fonts.length} font families`);

    res.json({
      fonts,
      count: fonts.length,
    });
  } catch (error) {
    logger.error('Failed to get system fonts:', error);

    // Fallback to basic fonts if fc-list fails
    const fallbackFonts: FontInfo[] = [
      {
        family: 'Arial',
        availableWeights: ['Regular', 'Bold'],
        cssValue: 'Arial, sans-serif',
      },
      {
        family: 'Helvetica',
        availableWeights: ['Regular', 'Bold'],
        cssValue: 'Helvetica, sans-serif',
      },
      {
        family: 'Georgia',
        availableWeights: ['Regular', 'Bold'],
        cssValue: 'Georgia, serif',
      },
      {
        family: 'Times New Roman',
        availableWeights: ['Regular', 'Bold'],
        cssValue: "'Times New Roman', serif",
      },
      {
        family: 'Courier New',
        availableWeights: ['Regular', 'Bold'],
        cssValue: "'Courier New', monospace",
      },
    ];

    res.json({
      fonts: fallbackFonts,
      count: fallbackFonts.length,
    });
  }
});

export default fontsRoutes;
