import { getRepository } from '@server/datasource';
import {
  PosterTemplate,
  type ContentGridProps,
  type PosterTemplateData,
  type TextElementProps,
} from '@server/entity/PosterTemplate';
import logger from '@server/logger';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import {
  type CollectionItemWithPoster,
  type PosterGenerationConfig,
} from './posterGeneration';

export interface TemplatePreviewConfig {
  templateId: number;
  collectionName: string;
  collectionType?: string;
  collectionSubtype?: string;
  mediaType?: 'movie' | 'tv';
  items?: CollectionItemWithPoster[];
  personImageUrl?: string;
}

export interface TemplateValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

interface LocalPosterItem {
  title: string;
  type: 'movie' | 'tv';
  tmdbId: number;
  year: number;
  filename: string;
  posterPath: string;
}


/**
 * Load local poster mapping for preview rendering
 */
function loadLocalPosterMapping(): LocalPosterItem[] {
  try {
    const mappingPath = path.join(
      process.cwd(),
      'public',
      'preview-posters',
      'poster-mapping.json'
    );
    if (!fs.existsSync(mappingPath)) {
      logger.warn(
        'Local poster mapping file not found, falling back to TMDB fetching'
      );
      return [];
    }

    const mappingData = fs.readFileSync(mappingPath, 'utf8');
    const posterItems: LocalPosterItem[] = JSON.parse(mappingData);

    logger.debug(`Loaded ${posterItems.length} local preview posters`);
    return posterItems;
  } catch (error) {
    logger.warn(
      'Failed to load local poster mapping, falling back to TMDB fetching:',
      error
    );
    return [];
  }
}

/**
 * Validate a poster template data structure
 */
export function validateTemplateData(
  templateData: PosterTemplateData
): TemplateValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate canvas dimensions
  if (!templateData.width || templateData.width <= 0) {
    errors.push('Template width must be a positive number');
  }
  if (!templateData.height || templateData.height <= 0) {
    errors.push('Template height must be a positive number');
  }

  // Validate background configuration
  if (!templateData.background) {
    errors.push('Background configuration is required');
  } else {
    if (
      !['color', 'gradient', 'radial'].includes(templateData.background.type)
    ) {
      errors.push('Background type must be "color", "gradient", or "radial"');
    }
    if (
      (templateData.background.type === 'gradient' ||
        templateData.background.type === 'radial') &&
      !templateData.background.secondaryColor &&
      !templateData.background.useSourceColors
    ) {
      warnings.push(
        'Gradient background should have a secondary color or use source colors'
      );
    }

    // Note: sourceColors are now stored in SourceColors table, not in templates
  }

  // Validate unified elements array (all templates should be migrated)
  if (!Array.isArray(templateData.elements)) {
    errors.push('Elements must be an array');
  } else {
    templateData.elements.forEach((element, index) => {
      if (!element.id) {
        errors.push(`Element ${index} missing required id`);
      }
      if (
        !['text', 'raster', 'svg', 'content-grid', 'person'].includes(
          element.type
        )
      ) {
        errors.push(`Element ${index} has invalid type: ${element.type}`);
      }
      if (typeof element.layerOrder !== 'number') {
        errors.push(`Element ${index} missing valid layerOrder`);
      }
      if (typeof element.x !== 'number' || typeof element.y !== 'number') {
        errors.push(`Element ${index} missing valid position coordinates`);
      }
      if (
        typeof element.width !== 'number' ||
        typeof element.height !== 'number' ||
        element.width <= 0 ||
        element.height <= 0
      ) {
        errors.push(`Element ${index} missing valid dimensions`);
      }
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
  warnings,
};
}

/**
 * Ensure textTransform defaults are present (and apply Person Spotlight uppercase fallback)
 */
function normalizeTextTransforms(
  templateData: PosterTemplateData,
  templateName?: string
): PosterTemplateData {
  if (!Array.isArray(templateData.elements)) {
    return templateData;
  }

  const prefersUppercase =
    templateName?.toLowerCase().includes('person spotlight') ||
    templateName?.toLowerCase().includes('director spotlight');

  const normalizedElements = templateData.elements.map((el) => {
    if (el.type !== 'text') {
      return el;
    }

    const props = el.properties as TextElementProps;
    const textTransform =
      props.textTransform ??
      (prefersUppercase && props.elementType === 'collection-title'
        ? 'uppercase'
        : 'none');

    return {
      ...el,
      properties: {
        ...props,
        textTransform,
      },
    };
  });

  return {
    ...templateData,
    elements: normalizedElements,
  };
}

/**
 * Apply a template to generate a poster using collection data
 */
export async function applyTemplate(
  templateId: number,
  config: {
    collectionName: string;
    collectionType?: string;
    collectionSubtype?: string;
    mediaType?: 'movie' | 'tv';
    items?: CollectionItemWithPoster[];
    dynamicLogo?: string;
    personImageUrl?: string;
  }
): Promise<Buffer> {
  const templateRepository = getRepository(PosterTemplate);

  const template = await templateRepository.findOne({
    where: { id: templateId, isActive: true },
  });

  if (!template) {
    throw new Error(`Template ${templateId} not found`);
  }

  const templateData = normalizeTextTransforms(
    template.getTemplateData(),
    template.name
  );

  // Validate template before applying
  const validation = validateTemplateData(templateData);
  if (!validation.isValid) {
    throw new Error(
      `Template validation failed: ${validation.errors.join(', ')}`
    );
  }

  // Convert template to poster generation config
  const posterConfig: PosterGenerationConfig = {
    collectionName: config.collectionName,
    collectionType: config.collectionType,
    collectionSubtype: config.collectionSubtype,
    mediaType: config.mediaType,
    items: config.items || [],
    // Add template reference for future template-aware generation
    template: `template-${templateId}`,
    // Pass template data for color customization
    templateData: templateData,
    // Pass through dynamic logo if available
    dynamicLogo: config.dynamicLogo,
    personImageUrl: config.personImageUrl,
  };

  // Generate poster directly using SVG system to avoid recursion
  const { generatePosterSVG } = await import('./posterGeneration');
  const svgContent = await generatePosterSVG(posterConfig);

  // Convert SVG to PNG buffer
  const sharp = (await import('sharp')).default;
  const buffer = await sharp(Buffer.from(svgContent))
    .png({ quality: 90 })
    .toBuffer();

  return buffer;
}

/**
 * Generate a preview of a template with sample data
 */
export async function generateTemplatePreview(
  templateId: number,
  previewConfig?: Partial<TemplatePreviewConfig>
): Promise<Buffer> {
  // Get the template to check content grid configuration
  const templateRepository = getRepository(PosterTemplate);
  const template = await templateRepository.findOne({
    where: { id: templateId, isActive: true },
  });

  if (!template) {
    throw new Error(`Template ${templateId} not found`);
  }

<<<<<<< HEAD
  const templateData = normalizeTextTransforms(
    template.getTemplateData(),
    template.name
  );
=======
  const templateData = template.getTemplateData();
>>>>>>> cbc458e (feat: enhance image handling in poster generation and add support for person image URLs in templates)
  const hasPersonLayer =
    Array.isArray(templateData.elements) &&
    templateData.elements.some((el) => el.type === 'person');

  // Generate enough sample items to fill the content grid
  let gridSize = 0;

  if (templateData.elements) {
    // Unified system - find content-grid elements and calculate total size
    const contentGridElements = templateData.elements.filter(
      (el) => el.type === 'content-grid'
    );
    if (contentGridElements.length > 0) {
      // Sum up all content grid sizes (in case there are multiple grids)
      gridSize = contentGridElements.reduce((total, element) => {
        const props = element.properties as ContentGridProps;
        return total + (props.columns || 2) * (props.rows || 2);
      }, 0);
    }
  }

  // Fallback to 4 if no content grids found
  if (gridSize === 0) {
    gridSize = 4;
  }

  logger.debug(`Template grid size calculated: ${gridSize} items needed`);

  // Load local poster mapping for fast preview rendering
  const localPosters = loadLocalPosterMapping();

  let sampleItems: CollectionItemWithPoster[] = [];
  let personImageUrl: string | undefined = previewConfig?.personImageUrl;

  if (localPosters.length > 0) {
    // Use local posters for much faster preview rendering
    logger.debug(`Using ${localPosters.length} local posters for preview`);

    const localSampleItems: CollectionItemWithPoster[] = [];
    for (let i = 0; i < gridSize; i++) {
      const localPoster = localPosters[i % localPosters.length];
      // Use absolute file path instead of URL path
      const absoluteFilePath = path.join(
        process.cwd(),
        'public',
        'preview-posters',
        localPoster.filename
      );
      localSampleItems.push({
        title:
          i >= localPosters.length
            ? `${localPoster.title} ${Math.floor(i / localPosters.length) + 1}`
            : localPoster.title,
        type: localPoster.type,
        tmdbId: localPoster.tmdbId,
        year: localPoster.year,
        posterUrl: `file://${absoluteFilePath}`, // Use file:// protocol for local files
      });
    }
    sampleItems = localSampleItems;
    // Prefer a real image for person layers; fall back to first local poster
    // Do not auto-assign a person image for previews; keep empty unless explicitly provided
  } else {
    // Fallback to hardcoded list if local posters aren't available
    logger.warn('Local posters not available, falling back to hardcoded list');

    const baseSampleItems = [
      // Popular Movies (50 items)
      {
        title: 'The Dark Knight',
        type: 'movie' as const,
        tmdbId: 155,
        year: 2008,
      },
      { title: 'Inception', type: 'movie' as const, tmdbId: 27205, year: 2010 },
      {
        title: 'Interstellar',
        type: 'movie' as const,
        tmdbId: 157336,
        year: 2014,
      },
      { title: 'The Matrix', type: 'movie' as const, tmdbId: 603, year: 1999 },
      { title: 'Fight Club', type: 'movie' as const, tmdbId: 550, year: 1999 },
      {
        title: 'Pulp Fiction',
        type: 'movie' as const,
        tmdbId: 680,
        year: 1994,
      },
      {
        title: 'The Godfather',
        type: 'movie' as const,
        tmdbId: 238,
        year: 1972,
      },
      { title: 'Goodfellas', type: 'movie' as const, tmdbId: 769, year: 1990 },
      {
        title: 'The Departed',
        type: 'movie' as const,
        tmdbId: 1422,
        year: 2006,
      },
      { title: 'Joker', type: 'movie' as const, tmdbId: 475557, year: 2019 },
      {
        title: 'Avengers: Endgame',
        type: 'movie' as const,
        tmdbId: 299534,
        year: 2019,
      },
      {
        title: 'Spider-Man: No Way Home',
        type: 'movie' as const,
        tmdbId: 634649,
        year: 2021,
      },
      {
        title: 'Top Gun: Maverick',
        type: 'movie' as const,
        tmdbId: 361743,
        year: 2022,
      },
      { title: 'Dune', type: 'movie' as const, tmdbId: 438631, year: 2021 },
      {
        title: 'No Time to Die',
        type: 'movie' as const,
        tmdbId: 370172,
        year: 2021,
      },
      {
        title: 'The Batman',
        type: 'movie' as const,
        tmdbId: 414906,
        year: 2022,
      },
      { title: 'Parasite', type: 'movie' as const, tmdbId: 496243, year: 2019 },
      {
        title: 'La La Land',
        type: 'movie' as const,
        tmdbId: 313369,
        year: 2016,
      },
      {
        title: 'Mad Max: Fury Road',
        type: 'movie' as const,
        tmdbId: 76341,
        year: 2015,
      },
      {
        title: 'Blade Runner 2049',
        type: 'movie' as const,
        tmdbId: 335984,
        year: 2017,
      },
      {
        title: 'Once Upon a Time in Hollywood',
        type: 'movie' as const,
        tmdbId: 466272,
        year: 2019,
      },
      { title: '1917', type: 'movie' as const, tmdbId: 530915, year: 2019 },
      {
        title: 'Ford v Ferrari',
        type: 'movie' as const,
        tmdbId: 359724,
        year: 2019,
      },
      {
        title: 'Knives Out',
        type: 'movie' as const,
        tmdbId: 546554,
        year: 2019,
      },
      {
        title: 'Everything Everywhere All at Once',
        type: 'movie' as const,
        tmdbId: 545611,
        year: 2022,
      },
      {
        title: 'The Wolf of Wall Street',
        type: 'movie' as const,
        tmdbId: 106646,
        year: 2013,
      },
      {
        title: 'Django Unchained',
        type: 'movie' as const,
        tmdbId: 68718,
        year: 2012,
      },
      { title: 'Get Out', type: 'movie' as const, tmdbId: 419430, year: 2017 },
      {
        title: 'Hereditary',
        type: 'movie' as const,
        tmdbId: 493922,
        year: 2018,
      },
      {
        title: 'Midsommar',
        type: 'movie' as const,
        tmdbId: 530385,
        year: 2019,
      },
      {
        title: 'The Grand Budapest Hotel',
        type: 'movie' as const,
        tmdbId: 120467,
        year: 2014,
      },
      {
        title: 'Moonlight',
        type: 'movie' as const,
        tmdbId: 376867,
        year: 2016,
      },
      { title: 'Whiplash', type: 'movie' as const, tmdbId: 244786, year: 2014 },
      {
        title: 'Ex Machina',
        type: 'movie' as const,
        tmdbId: 264660,
        year: 2014,
      },
      {
        title: 'Baby Driver',
        type: 'movie' as const,
        tmdbId: 390043,
        year: 2017,
      },
      {
        title: 'John Wick',
        type: 'movie' as const,
        tmdbId: 245891,
        year: 2014,
      },
      {
        title: 'The Social Network',
        type: 'movie' as const,
        tmdbId: 37799,
        year: 2010,
      },
      {
        title: 'There Will Be Blood',
        type: 'movie' as const,
        tmdbId: 7345,
        year: 2007,
      },
      {
        title: 'No Country for Old Men',
        type: 'movie' as const,
        tmdbId: 6977,
        year: 2007,
      },
      { title: 'Zodiac', type: 'movie' as const, tmdbId: 1271, year: 2007 },
      {
        title: 'Shutter Island',
        type: 'movie' as const,
        tmdbId: 11324,
        year: 2010,
      },
      {
        title: 'The Prestige',
        type: 'movie' as const,
        tmdbId: 1124,
        year: 2006,
      },
      {
        title: 'Casino Royale',
        type: 'movie' as const,
        tmdbId: 36557,
        year: 2006,
      },
      { title: 'Iron Man', type: 'movie' as const, tmdbId: 1726, year: 2008 },
      {
        title: 'The Avengers',
        type: 'movie' as const,
        tmdbId: 24428,
        year: 2012,
      },
      {
        title: 'Guardians of the Galaxy',
        type: 'movie' as const,
        tmdbId: 118340,
        year: 2014,
      },
      {
        title: 'Black Panther',
        type: 'movie' as const,
        tmdbId: 284054,
        year: 2018,
      },
      {
        title: 'Thor: Ragnarok',
        type: 'movie' as const,
        tmdbId: 284053,
        year: 2017,
      },
      {
        title: 'Captain America: The Winter Soldier',
        type: 'movie' as const,
        tmdbId: 100402,
        year: 2014,
      },
      {
        title: 'Doctor Strange',
        type: 'movie' as const,
        tmdbId: 284052,
        year: 2016,
      },

      // Popular TV Shows (50 items)
      { title: 'Breaking Bad', type: 'tv' as const, tmdbId: 1396, year: 2008 },
      {
        title: 'Game of Thrones',
        type: 'tv' as const,
        tmdbId: 1399,
        year: 2011,
      },
      { title: 'The Sopranos', type: 'tv' as const, tmdbId: 1398, year: 1999 },
      { title: 'The Office', type: 'tv' as const, tmdbId: 2316, year: 2005 },
      {
        title: 'Stranger Things',
        type: 'tv' as const,
        tmdbId: 66732,
        year: 2016,
      },
      {
        title: 'The Mandalorian',
        type: 'tv' as const,
        tmdbId: 82856,
        year: 2019,
      },
      { title: 'The Crown', type: 'tv' as const, tmdbId: 73375, year: 2016 },
      {
        title: 'House of Cards',
        type: 'tv' as const,
        tmdbId: 1425,
        year: 2013,
      },
      {
        title: 'Orange Is the New Black',
        type: 'tv' as const,
        tmdbId: 46317,
        year: 2013,
      },
      { title: 'Narcos', type: 'tv' as const, tmdbId: 63351, year: 2015 },
      {
        title: 'Better Call Saul',
        type: 'tv' as const,
        tmdbId: 60059,
        year: 2015,
      },
      {
        title: 'The Walking Dead',
        type: 'tv' as const,
        tmdbId: 1402,
        year: 2010,
      },
      { title: 'Westworld', type: 'tv' as const, tmdbId: 63247, year: 2016 },
      {
        title: 'True Detective',
        type: 'tv' as const,
        tmdbId: 46648,
        year: 2014,
      },
      { title: 'Fargo', type: 'tv' as const, tmdbId: 60622, year: 2014 },
      { title: 'The Wire', type: 'tv' as const, tmdbId: 1438, year: 2002 },
      { title: 'Mad Men', type: 'tv' as const, tmdbId: 1104, year: 2007 },
      { title: 'Lost', type: 'tv' as const, tmdbId: 4607, year: 2004 },
      { title: 'Sherlock', type: 'tv' as const, tmdbId: 19885, year: 2010 },
      { title: 'Friends', type: 'tv' as const, tmdbId: 1668, year: 1994 },
      {
        title: 'The Big Bang Theory',
        type: 'tv' as const,
        tmdbId: 1418,
        year: 2007,
      },
      {
        title: 'How I Met Your Mother',
        type: 'tv' as const,
        tmdbId: 1100,
        year: 2005,
      },
      {
        title: 'Parks and Recreation',
        type: 'tv' as const,
        tmdbId: 8592,
        year: 2009,
      },
      {
        title: 'Brooklyn Nine-Nine',
        type: 'tv' as const,
        tmdbId: 48891,
        year: 2013,
      },
      {
        title: 'The Good Place',
        type: 'tv' as const,
        tmdbId: 66573,
        year: 2016,
      },
      { title: 'Community', type: 'tv' as const, tmdbId: 18347, year: 2009 },
      {
        title: 'Arrested Development',
        type: 'tv' as const,
        tmdbId: 4589,
        year: 2003,
      },
      {
        title: 'Peaky Blinders',
        type: 'tv' as const,
        tmdbId: 60574,
        year: 2013,
      },
      { title: 'Money Heist', type: 'tv' as const, tmdbId: 71446, year: 2017 },
      { title: 'Dark', type: 'tv' as const, tmdbId: 70523, year: 2017 },
      { title: 'Mindhunter', type: 'tv' as const, tmdbId: 67744, year: 2017 },
      { title: 'Ozark', type: 'tv' as const, tmdbId: 69740, year: 2017 },
      { title: 'The Witcher', type: 'tv' as const, tmdbId: 71912, year: 2019 },
      { title: 'The Boys', type: 'tv' as const, tmdbId: 76479, year: 2019 },
      { title: 'Euphoria', type: 'tv' as const, tmdbId: 85552, year: 2019 },
      { title: 'Succession', type: 'tv' as const, tmdbId: 76331, year: 2018 },
      {
        title: "The Handmaid's Tale",
        type: 'tv' as const,
        tmdbId: 69478,
        year: 2017,
      },
      { title: 'Black Mirror', type: 'tv' as const, tmdbId: 42009, year: 2011 },
      {
        title: 'Rick and Morty',
        type: 'tv' as const,
        tmdbId: 60625,
        year: 2013,
      },
      {
        title: 'BoJack Horseman',
        type: 'tv' as const,
        tmdbId: 61222,
        year: 2014,
      },
      { title: 'The Simpsons', type: 'tv' as const, tmdbId: 456, year: 1989 },
      { title: 'South Park', type: 'tv' as const, tmdbId: 2190, year: 1997 },
      { title: 'Family Guy', type: 'tv' as const, tmdbId: 1434, year: 1999 },
      { title: 'Dexter', type: 'tv' as const, tmdbId: 1405, year: 2006 },
      { title: 'House', type: 'tv' as const, tmdbId: 1408, year: 2004 },
      { title: 'Homeland', type: 'tv' as const, tmdbId: 1407, year: 2011 },
      { title: '24', type: 'tv' as const, tmdbId: 1995, year: 2001 },
      { title: 'Prison Break', type: 'tv' as const, tmdbId: 2288, year: 2005 },
      { title: 'Suits', type: 'tv' as const, tmdbId: 37680, year: 2011 },
      { title: 'Vikings', type: 'tv' as const, tmdbId: 44217, year: 2013 },
    ];

    // Generate enough items to fill the grid, cycling through base items if needed
    const fallbackSampleItems: CollectionItemWithPoster[] = [];
    for (let i = 0; i < gridSize; i++) {
      const baseItem = baseSampleItems[i % baseSampleItems.length];
      fallbackSampleItems.push({
        ...baseItem,
        title:
          i >= baseSampleItems.length
            ? `${baseItem.title} ${Math.floor(i / baseSampleItems.length) + 1}`
            : baseItem.title,
      });
    }
    sampleItems = fallbackSampleItems;
    // Do not auto-assign a person image for previews; keep empty unless explicitly provided
  }

  const config = {
    collectionName: previewConfig?.collectionName || 'Sample Collection',
    collectionType: previewConfig?.collectionType || 'trakt',
    collectionSubtype: previewConfig?.collectionSubtype,
    mediaType: previewConfig?.mediaType || ('movie' as const),
    items: previewConfig?.items || sampleItems,
    // Do not auto-assign a person image for previews
    personImageUrl: previewConfig?.personImageUrl || personImageUrl,
  };

  return await applyTemplate(templateId, config);
}

/**
 * Create a thumbnail version of a poster buffer
 */
export async function createPosterThumbnail(
  posterBuffer: Buffer,
  maxWidth = 200,
  maxHeight = 300
): Promise<Buffer> {
  try {
    return await sharp(posterBuffer)
      .resize(maxWidth, maxHeight, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 85 })
      .toBuffer();
  } catch (error) {
    logger.error('Failed to create poster thumbnail:', error);
    throw new Error('Failed to create poster thumbnail');
  }
}

/**
 * Get all available template types for filtering/organization
 */
export function getTemplateTypes(): string[] {
  return [
    'trakt',
    'tmdb',
    'imdb',
    'letterboxd',
    'tautulli',
    'overseerr',
    'hub',
    'multi-source',
    // Streaming platforms (networks)
    'netflix',
    'hbo',
    'disney',
    'amazon-prime',
    'apple-tv',
    'paramount',
    'peacock',
    'crunchyroll',
    'discovery-plus',
    'hulu',
    'default',
  ];
}

/**
 * Sanitize template data by removing invalid elements and fixing common issues
 */
export function sanitizeTemplateData(
  templateData: Partial<PosterTemplateData>
): PosterTemplateData {
  // All templates should be in migrated format after startup migration
  return {
    width: Math.max(100, templateData.width || 1000),
    height: Math.max(100, templateData.height || 1500),
    background: {
      type: ['color', 'gradient', 'radial'].includes(
        templateData.background?.type || ''
      )
        ? (templateData.background?.type as 'color' | 'gradient' | 'radial')
        : 'color',
      color: templateData.background?.color || '#6366f1',
      secondaryColor: templateData.background?.secondaryColor,
      intensity: templateData.background?.intensity,
      useSourceColors: Boolean(templateData.background?.useSourceColors),
    },
    elements: Array.isArray(templateData.elements)
      ? templateData.elements
          .filter((el) => el.id && el.type && typeof el.layerOrder === 'number')
          .map((el) => ({
            ...el,
            x: typeof el.x === 'number' ? el.x : 0,
            y: typeof el.y === 'number' ? el.y : 0,
            width: Math.max(10, el.width || 50),
            height: Math.max(10, el.height || 50),
            layerOrder: Math.max(0, el.layerOrder || 0),
          }))
      : [],
    migrated: true, // Always true since startup migration handles legacy data
  };
}
