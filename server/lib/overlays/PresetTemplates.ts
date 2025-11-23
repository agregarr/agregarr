import { getRepository } from '@server/datasource';
import type {
  ApplicationCondition,
  OverlayTemplateData,
} from '@server/entity/OverlayTemplate';
import { OverlayTemplate } from '@server/entity/OverlayTemplate';
import logger from '@server/logger';

/**
 * Preset overlay templates that ship with Agregarr
 * Canvas size: 1000x1500 pixels (standard poster ratio)
 * */
export const PRESET_TEMPLATES: {
  name: string;
  description: string;
  type: 'rating' | 'metadata' | 'technical' | 'status' | 'generic';
  templateData: OverlayTemplateData;
  applicationCondition?: ApplicationCondition;
}[] = [
  // ========================================
  // RATING TEMPLATES
  // ========================================
  {
    name: 'IMDb Rating',
    description: 'Shows IMDb rating in top-left corner',
    type: 'rating',
    // No condition - will automatically skip if imdbRating is undefined
    templateData: {
      width: 1000,
      height: 1500,
      elements: [
        {
          id: 'imdb-badge-bg',
          layerOrder: 0,
          type: 'tile',
          x: 0,
          y: 0,
          width: 162,
          height: 155,
          properties: {
            fillColor: '#000000',
            fillOpacity: 50,
            borderRadius: 15,
          },
        },
        {
          id: 'imdb-rating',
          layerOrder: 1,
          type: 'variable',
          x: 16,
          y: 59,
          width: 127,
          height: 108,
          properties: {
            segments: [{ type: 'variable', field: 'imdbRating' }],
            fontSize: 60,
            fontFamily: 'Inter',
            fontWeight: 'bold',
            fontStyle: 'normal',
            color: '#ffffff',
            textAlign: 'center',
          },
        },
        {
          id: 'imdb-logo',
          layerOrder: 2,
          type: 'svg',
          x: 16,
          y: -18,
          width: 130,
          height: 130,
          properties: {
            iconType: 'custom-icon',
            iconPath: '/api/v1/posters/icons/system/plain-imdb.svg',
            opacity: 100,
            grayscale: false,
          },
        },
      ],
    },
  },

  {
    name: 'Rotten Tomatoes Rating',
    description: 'Shows RT critics score in top-left corner',
    type: 'rating',
    // No condition - will automatically skip if rtCriticsScore is undefined
    templateData: {
      width: 1000,
      height: 1500,
      elements: [
        {
          id: 'rt-badge-bg',
          layerOrder: 0,
          type: 'tile',
          x: 0,
          y: 155,
          width: 162,
          height: 155,
          properties: {
            fillColor: '#000000',
            fillOpacity: 50,
            borderRadius: 15,
          },
        },
        {
          id: 'rt-rating',
          layerOrder: 1,
          type: 'variable',
          x: 16,
          y: 220,
          width: 127,
          height: 108,
          properties: {
            segments: [{ type: 'variable', field: 'rtCriticsScore' }],
            fontSize: 60,
            fontFamily: 'Inter',
            fontWeight: 'bold',
            fontStyle: 'normal',
            color: '#ffffff',
            textAlign: 'center',
          },
        },
        {
          id: 'rt-logo',
          layerOrder: 2,
          type: 'svg',
          x: 26.5,
          y: 147,
          width: 106,
          height: 106,
          properties: {
            iconType: 'custom-icon',
            iconPath: '/api/v1/posters/icons/system/rt_fresh.svg',
            opacity: 100,
            grayscale: false,
          },
        },
      ],
    },
  },

  // ========================================
  // TECHNICAL TEMPLATES
  // ========================================
  {
    name: '4K Resolution',
    description: 'Shows 4K badge for ultra HD content',
    type: 'technical',
    applicationCondition: {
      field: 'resolution',
      operator: 'in',
      value: ['4k', '2160'],
    },
    templateData: {
      width: 1000,
      height: 1500,
      elements: [
        {
          id: '4k-text',
          layerOrder: 0,
          type: 'text',
          x: -15.920978364650237,
          y: 1375.596586146406,
          width: 191,
          height: 161,
          properties: {
            text: '4K',
            fontSize: 104,
            fontFamily: 'Inter',
            fontWeight: 'bold',
            fontStyle: 'normal',
            color: '#f1f505',
            textAlign: 'center',
          },
        },
      ],
    },
  },

  // ========================================
  // COMING SOON TEMPLATES
  // ========================================
  {
    name: 'Coming Soon',
    description: 'Top banner showing COMING SOON for monitored items',
    type: 'status',
    applicationCondition: {
      and: [
        { field: 'isMonitored', operator: 'eq', value: true },
        { field: 'daysUntilRelease', operator: 'lte', value: 30 }, // Only ≤30 days
      ],
    },
    templateData: {
      width: 1000,
      height: 1500,
      elements: [
        {
          id: 'coming-soon-banner-bg',
          layerOrder: 0,
          type: 'tile',
          x: 0,
          y: 0,
          width: 1000,
          height: 95,
          properties: {
            fillColor: '#DC2626',
            fillOpacity: 75,
            borderRadius: 0,
          },
        },
        {
          id: 'coming-soon-text',
          layerOrder: 1,
          type: 'text',
          x: 0,
          y: -25.5,
          width: 1000,
          height: 146,
          properties: {
            text: 'COMING SOON',
            fontSize: 74,
            fontFamily: 'Inter',
            fontWeight: 'bold',
            fontStyle: 'normal',
            color: '#FFFFFF',
            textAlign: 'center',
          },
        },
      ],
    },
  },

  // Request Needed (Top Banner) - For unmonitored items
  {
    name: 'Request Needed',
    description: 'Top banner showing REQUEST NEEDED for unmonitored items',
    type: 'status',
    applicationCondition: {
      field: 'isMonitored',
      operator: 'eq',
      value: false,
    },
    templateData: {
      width: 1000,
      height: 1500,
      elements: [
        {
          id: 'request-banner-bg',
          layerOrder: 0,
          type: 'tile',
          x: 0,
          y: 0,
          width: 1000,
          height: 95,
          properties: {
            fillColor: '#EA580C',
            fillOpacity: 75,
            borderRadius: 0,
          },
        },
        {
          id: 'request-text',
          layerOrder: 1,
          type: 'text',
          x: 0,
          y: -25.5,
          width: 1000,
          height: 146,
          properties: {
            text: 'REQUEST NEEDED',
            fontSize: 74,
            fontFamily: 'Inter',
            fontWeight: 'bold',
            fontStyle: 'normal',
            color: '#FFFFFF',
            textAlign: 'center',
          },
        },
      ],
    },
  },

  // ========================================
  // BOTTOM BANNERS - Countdown/Date/Status for placeholders
  // ========================================

  // Returning Soon - TV S02+ - SEASON N countdown
  {
    name: 'Returning Soon',
    description: 'Bottom banner for returning TV shows (S02+) with countdown',
    type: 'status',
    applicationCondition: {
      and: [
        { field: 'daysUntilRelease', operator: 'gt', value: 0 },
        { field: 'seasonNumber', operator: 'gt', value: 1 },
        { field: 'mediaType', operator: 'eq', value: 'show' },
      ],
    },
    templateData: {
      width: 1000,
      height: 1500,
      elements: [
        {
          id: 'returning-banner-bg',
          layerOrder: 0,
          type: 'tile',
          x: 0,
          y: 1405,
          width: 1000,
          height: 95,
          properties: {
            fillColor: '#7C3AED',
            fillOpacity: 75,
            borderRadius: 0,
          },
        },
        {
          id: 'season-countdown',
          layerOrder: 1,
          type: 'variable',
          x: 0,
          y: 1382,
          width: 1000,
          height: 141,
          properties: {
            segments: [
              { type: 'text', value: 'SEASON ' },
              { type: 'variable', field: 'seasonNumber' },
              { type: 'text', value: ' IN ' },
              { type: 'variable', field: 'daysUntilRelease' },
              { type: 'text', value: ' DAYS' },
            ],
            fontSize: 74,
            fontFamily: 'Inter',
            fontWeight: 'bold',
            fontStyle: 'normal',
            color: '#FFFFFF',
            textAlign: 'center',
          },
        },
      ],
    },
  },

  // ========================================
  // MONITORED RELEASES - FUTURE (not yet released)
  // ========================================

  // Coming Soon (Monitored) -  >30 days - Single bottom banner
  {
    name: 'Coming Soon (Monitored) - Far Out',
    description: 'Single banner for monitored releases more than 30 days away',
    type: 'status',
    applicationCondition: {
      and: [
        { field: 'daysUntilRelease', operator: 'gt', value: 30 },
        { field: 'isMonitored', operator: 'eq', value: true },
        // Exclude returning TV shows (handled by separate template)
        {
          or: [
            { field: 'mediaType', operator: 'neq', value: 'show' },
            { field: 'seasonNumber', operator: 'lte', value: 1 },
          ],
        },
      ],
    },
    templateData: {
      width: 1000,
      height: 1500,
      elements: [
        {
          id: 'countdown-banner-bg',
          layerOrder: 0,
          type: 'tile',
          x: 0,
          y: 1405,
          width: 1000,
          height: 95,
          properties: {
            fillColor: '#DC2626',
            fillOpacity: 75,
            borderRadius: 0,
          },
        },
        {
          id: 'countdown-text',
          layerOrder: 1,
          type: 'variable',
          x: 0,
          y: 1382,
          width: 1000,
          height: 141,
          properties: {
            segments: [
              { type: 'text', value: 'RELEASING IN ' },
              { type: 'variable', field: 'daysUntilRelease' },
              { type: 'text', value: ' DAYS' },
            ],
            fontSize: 74,
            fontFamily: 'Inter',
            fontWeight: 'bold',
            fontStyle: 'normal',
            color: '#FFFFFF',
            textAlign: 'center',
          },
        },
      ],
    },
  },

  // Far Future Date Display >30 days - Bottom banner with formatted date
  {
    name: 'Far Future Release Date',
    description:
      'Bottom banner showing formatted date for releases >30 days away',
    type: 'status',
    applicationCondition: {
      and: [
        { field: 'daysUntilRelease', operator: 'gt', value: 30 },
        // Exclude returning TV shows (handled by "Returning Soon" template)
        {
          or: [
            { field: 'mediaType', operator: 'neq', value: 'show' },
            { field: 'seasonNumber', operator: 'lte', value: 1 },
          ],
        },
      ],
    },
    templateData: {
      width: 1000,
      height: 1500,
      elements: [
        {
          id: 'date-banner-bg',
          layerOrder: 0,
          type: 'tile',
          x: 0,
          y: 1405,
          width: 1000,
          height: 95,
          properties: {
            fillColor: '#DC2626',
            fillOpacity: 75,
            borderRadius: 0,
          },
        },
        {
          id: 'date-text',
          layerOrder: 1,
          type: 'variable',
          x: 0,
          y: 1382,
          width: 1000,
          height: 141,
          properties: {
            segments: [
              { type: 'text', value: 'RELEASING ' },
              { type: 'variable', field: 'releaseDate' },
            ],
            fontSize: 74,
            fontFamily: 'Inter',
            fontWeight: 'bold',
            fontStyle: 'normal',
            color: '#FFFFFF',
            textAlign: 'center',
          },
        },
      ],
    },
  },

  // Countdown (Monitored, 2-30 days) - Bottom banner only
  {
    name: 'Countdown (Monitored)',
    description:
      'Bottom countdown banner for monitored releases within 30 days',
    type: 'status',
    applicationCondition: {
      and: [
        { field: 'daysUntilRelease', operator: 'gt', value: 1 },
        { field: 'daysUntilRelease', operator: 'lte', value: 30 },
        { field: 'isMonitored', operator: 'eq', value: true },
        // Exclude returning TV shows (handled by separate template)
        {
          or: [
            { field: 'mediaType', operator: 'neq', value: 'show' },
            { field: 'seasonNumber', operator: 'lte', value: 1 },
          ],
        },
      ],
    },
    templateData: {
      width: 1000,
      height: 1500,
      elements: [
        {
          id: 'countdown-banner-bg',
          layerOrder: 0,
          type: 'tile',
          x: 0,
          y: 1405,
          width: 1000,
          height: 95,
          properties: {
            fillColor: '#DC2626',
            fillOpacity: 75,
            borderRadius: 0,
          },
        },
        {
          id: 'countdown-text',
          layerOrder: 1,
          type: 'variable',
          x: 0,
          y: 1382,
          width: 1000,
          height: 141,
          properties: {
            segments: [
              { type: 'text', value: 'RELEASING IN ' },
              { type: 'variable', field: 'daysUntilRelease' },
              { type: 'text', value: ' DAYS' },
            ],
            fontSize: 74,
            fontFamily: 'Inter',
            fontWeight: 'bold',
            fontStyle: 'normal',
            color: '#FFFFFF',
            textAlign: 'center',
          },
        },
      ],
    },
  },

  // Tomorrow (Monitored) - Bottom banner only
  {
    name: 'Releasing Tomorrow (Monitored)',
    description: 'Bottom banner for monitored releases coming tomorrow',
    type: 'status',
    applicationCondition: {
      and: [
        { field: 'daysUntilRelease', operator: 'eq', value: 1 },
        { field: 'isMonitored', operator: 'eq', value: true },
        // Exclude returning TV shows (handled by separate template)
        {
          or: [
            { field: 'mediaType', operator: 'neq', value: 'show' },
            { field: 'seasonNumber', operator: 'lte', value: 1 },
          ],
        },
      ],
    },
    templateData: {
      width: 1000,
      height: 1500,
      elements: [
        {
          id: 'tomorrow-banner-bg',
          layerOrder: 0,
          type: 'tile',
          x: 0,
          y: 1405,
          width: 1000,
          height: 95,
          properties: {
            fillColor: '#DC2626',
            fillOpacity: 75,
            borderRadius: 0,
          },
        },
        {
          id: 'tomorrow-text',
          layerOrder: 1,
          type: 'text',
          x: 0,
          y: 1382,
          width: 1000,
          height: 141,
          properties: {
            text: 'RELEASING TOMORROW',
            fontSize: 74,
            fontFamily: 'Inter',
            fontWeight: 'bold',
            fontStyle: 'normal',
            color: '#FFFFFF',
            textAlign: 'center',
          },
        },
      ],
    },
  },

  // Today (Monitored) - Bottom banner only
  {
    name: 'Releasing Today (Monitored)',
    description: 'Bottom banner for monitored releases coming today',
    type: 'status',
    applicationCondition: {
      and: [
        { field: 'daysUntilRelease', operator: 'eq', value: 0 },
        { field: 'isMonitored', operator: 'eq', value: true },
        { field: 'downloaded', operator: 'eq', value: false },
        // Exclude returning TV shows (handled by separate template)
        {
          or: [
            { field: 'mediaType', operator: 'neq', value: 'show' },
            { field: 'seasonNumber', operator: 'lte', value: 1 },
          ],
        },
      ],
    },
    templateData: {
      width: 1000,
      height: 1500,
      elements: [
        {
          id: 'today-banner-bg',
          layerOrder: 0,
          type: 'tile',
          x: 0,
          y: 1405,
          width: 1000,
          height: 95,
          properties: {
            fillColor: '#DC2626',
            fillOpacity: 75,
            borderRadius: 0,
          },
        },
        {
          id: 'today-text',
          layerOrder: 1,
          type: 'text',
          x: 0,
          y: 1382,
          width: 1000,
          height: 141,
          properties: {
            text: 'RELEASING TODAY',
            fontSize: 74,
            fontFamily: 'Inter',
            fontWeight: 'bold',
            fontStyle: 'normal',
            color: '#FFFFFF',
            textAlign: 'center',
          },
        },
      ],
    },
  },

  // ========================================
  // MONITORED RELEASES - ALREADY RELEASED (waiting for download)
  // ========================================

  // Awaiting Download - Bottom banner only
  {
    name: 'Awaiting Download',
    description:
      'Bottom banner for released monitored content awaiting download',
    type: 'status',
    applicationCondition: {
      and: [
        // Must NOT have daysUntilRelease (that's for future items)
        {
          or: [
            { field: 'daysUntilRelease', operator: 'lte', value: 0 },
            { field: 'daysAgo', operator: 'gte', value: 0 },
          ],
        },
        { field: 'isMonitored', operator: 'eq', value: true },
        { field: 'downloaded', operator: 'eq', value: false },
      ],
    },
    templateData: {
      width: 1000,
      height: 1500,
      elements: [
        {
          id: 'awaiting-banner-bg',
          layerOrder: 0,
          type: 'tile',
          x: 0,
          y: 1405,
          width: 1000,
          height: 95,
          properties: {
            fillColor: '#DC2626',
            fillOpacity: 75,
            borderRadius: 0,
          },
        },
        {
          id: 'awaiting-text',
          layerOrder: 1,
          type: 'text',
          x: 0,
          y: 1382,
          width: 1000,
          height: 141,
          properties: {
            text: 'AWAITING DOWNLOAD',
            fontSize: 74,
            fontFamily: 'Inter',
            fontWeight: 'bold',
            fontStyle: 'normal',
            color: '#FFFFFF',
            textAlign: 'center',
          },
        },
      ],
    },
  },

  // ========================================
  // DOWNLOADED CONTENT (recently released with file)
  // ========================================

  // New Release (downloaded) - Single bottom banner
  {
    name: 'New Release',
    description:
      'Single banner showing days since release for downloaded content',
    type: 'status',
    applicationCondition: {
      and: [
        { field: 'downloaded', operator: 'eq', value: true },
        { field: 'daysAgo', operator: 'gte', value: 0 },
        { field: 'daysAgo', operator: 'lte', value: 7 }, // Only show for 7 days
        { field: 'isMonitored', operator: 'eq', value: true }, // Only for monitored items
      ],
    },
    templateData: {
      width: 1000,
      height: 1500,
      elements: [
        {
          id: 'released-banner-bg',
          layerOrder: 0,
          type: 'tile',
          x: 0,
          y: 1405,
          width: 1000,
          height: 95,
          properties: {
            fillColor: '#10B981',
            fillOpacity: 75,
            borderRadius: 0,
          },
        },
        {
          id: 'released-text',
          layerOrder: 1,
          type: 'variable',
          x: 0,
          y: 1382,
          width: 1000,
          height: 141,
          properties: {
            segments: [
              { type: 'text', value: 'RELEASED ' },
              { type: 'variable', field: 'daysAgo' },
              { type: 'text', value: ' DAYS AGO' },
            ],
            fontSize: 74,
            fontFamily: 'Inter',
            fontWeight: 'bold',
            fontStyle: 'normal',
            color: '#FFFFFF',
            textAlign: 'center',
          },
        },
      ],
    },
  },

  // ========================================
  // REQUEST NEEDED TEMPLATES
  // ========================================

  // Countdown (Unmonitored, 2-30 days) - Bottom banner only (ORANGE)
  {
    name: 'Countdown (Unmonitored)',
    description:
      'Bottom countdown banner for unmonitored releases 2-30 days away',
    type: 'status',
    applicationCondition: {
      and: [
        { field: 'daysUntilRelease', operator: 'gt', value: 1 },
        { field: 'daysUntilRelease', operator: 'lte', value: 30 },
        { field: 'isMonitored', operator: 'eq', value: false },
      ],
    },
    templateData: {
      width: 1000,
      height: 1500,
      elements: [
        {
          id: 'countdown-banner-bg',
          layerOrder: 0,
          type: 'tile',
          x: 0,
          y: 1405,
          width: 1000,
          height: 95,
          properties: {
            fillColor: '#EA580C',
            fillOpacity: 75,
            borderRadius: 0,
          },
        },
        {
          id: 'countdown-text',
          layerOrder: 1,
          type: 'variable',
          x: 0,
          y: 1382,
          width: 1000,
          height: 141,
          properties: {
            segments: [
              { type: 'text', value: 'RELEASING IN ' },
              { type: 'variable', field: 'daysUntilRelease' },
              { type: 'text', value: ' DAYS' },
            ],
            fontSize: 74,
            fontFamily: 'Inter',
            fontWeight: 'bold',
            fontStyle: 'normal',
            color: '#FFFFFF',
            textAlign: 'center',
          },
        },
      ],
    },
  },

  // Tomorrow (Unmonitored) - Bottom banner only (ORANGE)
  {
    name: 'Releasing Tomorrow (Unmonitored)',
    description: 'Bottom banner for unmonitored releases coming tomorrow',
    type: 'status',
    applicationCondition: {
      and: [
        { field: 'daysUntilRelease', operator: 'eq', value: 1 },
        { field: 'isMonitored', operator: 'eq', value: false },
      ],
    },
    templateData: {
      width: 1000,
      height: 1500,
      elements: [
        {
          id: 'tomorrow-banner-bg',
          layerOrder: 0,
          type: 'tile',
          x: 0,
          y: 1405,
          width: 1000,
          height: 95,
          properties: {
            fillColor: '#EA580C',
            fillOpacity: 75,
            borderRadius: 0,
          },
        },
        {
          id: 'tomorrow-text',
          layerOrder: 1,
          type: 'text',
          x: 0,
          y: 1382,
          width: 1000,
          height: 141,
          properties: {
            text: 'RELEASING TOMORROW',
            fontSize: 74,
            fontFamily: 'Inter',
            fontWeight: 'bold',
            fontStyle: 'normal',
            color: '#FFFFFF',
            textAlign: 'center',
          },
        },
      ],
    },
  },

  // Today (Unmonitored) - Bottom banner only (ORANGE)
  {
    name: 'Releasing Today (Unmonitored)',
    description: 'Bottom banner for unmonitored releases coming today',
    type: 'status',
    applicationCondition: {
      and: [
        { field: 'daysUntilRelease', operator: 'eq', value: 0 },
        { field: 'isMonitored', operator: 'eq', value: false },
      ],
    },
    templateData: {
      width: 1000,
      height: 1500,
      elements: [
        {
          id: 'today-banner-bg',
          layerOrder: 0,
          type: 'tile',
          x: 0,
          y: 1405,
          width: 1000,
          height: 95,
          properties: {
            fillColor: '#EA580C',
            fillOpacity: 75,
            borderRadius: 0,
          },
        },
        {
          id: 'today-text',
          layerOrder: 1,
          type: 'text',
          x: 0,
          y: 1382,
          width: 1000,
          height: 141,
          properties: {
            text: 'RELEASING TODAY',
            fontSize: 74,
            fontFamily: 'Inter',
            fontWeight: 'bold',
            fontStyle: 'normal',
            color: '#FFFFFF',
            textAlign: 'center',
          },
        },
      ],
    },
  },

  // Released Days Ago (Unmonitored) - Bottom banner only (ORANGE)
  {
    name: 'Released Days Ago (Unmonitored)',
    description:
      'Bottom banner showing days since release for unmonitored content',
    type: 'status',
    applicationCondition: {
      and: [
        { field: 'daysAgo', operator: 'gte', value: 0 },
        { field: 'isMonitored', operator: 'eq', value: false },
      ],
    },
    templateData: {
      width: 1000,
      height: 1500,
      elements: [
        {
          id: 'released-banner-bg',
          layerOrder: 0,
          type: 'tile',
          x: 0,
          y: 1405,
          width: 1000,
          height: 95,
          properties: {
            fillColor: '#EA580C',
            fillOpacity: 75,
            borderRadius: 0,
          },
        },
        {
          id: 'released-text',
          layerOrder: 1,
          type: 'variable',
          x: 0,
          y: 1382,
          width: 1000,
          height: 141,
          properties: {
            segments: [
              { type: 'text', value: 'RELEASED ' },
              { type: 'variable', field: 'daysAgo' },
              { type: 'text', value: ' DAYS AGO' },
            ],
            fontSize: 74,
            fontFamily: 'Inter',
            fontWeight: 'bold',
            fontStyle: 'normal',
            color: '#FFFFFF',
            textAlign: 'center',
          },
        },
      ],
    },
  },
];

/**
 * Service for creating and syncing preset overlay templates in the database
 */
class PresetTemplateServiceClass {
  async createPresetTemplates(): Promise<void> {
    const templateRepository = getRepository(OverlayTemplate);

    for (const preset of PRESET_TEMPLATES) {
      // Check if preset already exists
      const existingTemplate = await templateRepository.findOne({
        where: { name: preset.name, isDefault: true },
      });

      if (existingTemplate) {
        // Update existing preset template to sync any changes
        existingTemplate.description = preset.description;
        existingTemplate.type = preset.type;
        existingTemplate.setTemplateData(preset.templateData);

        if (preset.applicationCondition) {
          existingTemplate.setApplicationCondition(preset.applicationCondition);
        } else {
          existingTemplate.applicationCondition = null;
        }

        await templateRepository.save(existingTemplate);

        logger.debug(`Updated preset template: ${preset.name}`, {
          label: 'PresetTemplates',
        });
        continue;
      }

      // Create new preset template
      const newTemplate = templateRepository.create({
        name: preset.name,
        description: preset.description,
        type: preset.type,
        templateData: JSON.stringify(preset.templateData),
        isDefault: true,
        isActive: true,
      });

      // Set application condition if provided
      if (preset.applicationCondition) {
        newTemplate.setApplicationCondition(preset.applicationCondition);
      }

      await templateRepository.save(newTemplate);

      logger.info(`Created preset template: ${preset.name}`, {
        label: 'PresetTemplates',
      });
    }
  }
}

export const presetTemplateService = new PresetTemplateServiceClass();
