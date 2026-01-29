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
            borderRadiusBottomLeft: 0,
            borderRadiusBottomRight: 5,
            borderRadiusTopLeft: 0,
            borderRadiusTopRight: 0,
            lockCorners: false,
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
            borderRadiusBottomLeft: 0,
            borderRadiusBottomRight: 10,
            borderRadiusTopLeft: 0,
            borderRadiusTopRight: 5,
            lockCorners: false,
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

  {
    name: 'Rotten Tomatoes Certified Fresh',
    description: 'Shows RT Certified Fresh logo in bottom-right corner',
    type: 'rating',
    applicationCondition: {
      sections: [
        {
          rules: [
            {
              field: 'rtCertifiedFresh',
              operator: 'eq',
              value: true,
            },
          ],
        },
      ],
    },
    templateData: {
      width: 1000,
      height: 1500,
      elements: [
        {
          id: 'rt-certified-fresh-logo',
          layerOrder: 0,
          type: 'raster',
          x: 787,
          y: 1285,
          width: 200,
          height: 200,
          properties: {
            imagePath: '/api/v1/posters/icons/system/rt_certified_fresh.png',
            opacity: 100,
          },
        },
      ],
    },
  },

  {
    name: 'Rotten Tomatoes Verified Hot',
    description: 'Shows RT Verified Hot logo above Certified Fresh position',
    type: 'rating',
    applicationCondition: {
      sections: [
        {
          rules: [
            {
              field: 'rtVerifiedHot',
              operator: 'eq',
              value: true,
            },
          ],
        },
      ],
    },
    templateData: {
      width: 1000,
      height: 1500,
      elements: [
        {
          id: 'rt-verified-hot-logo',
          layerOrder: 0,
          type: 'raster',
          x: 787,
          y: 1070,
          width: 200,
          height: 200,
          properties: {
            imagePath: '/api/v1/posters/icons/system/rt_verified_hot.png',
            opacity: 100,
          },
        },
      ],
    },
  },

  // ========================================
  // PLACEHOLDER OVERLAY (applies to all placeholder items)
  // ========================================
  {
    name: 'Placeholder Overlay',
    description: '25% opacity darkening overlay for all placeholder items',
    type: 'status',
    applicationCondition: {
      sections: [
        {
          rules: [{ field: 'isPlaceholder', operator: 'eq', value: true }],
        },
      ],
    },
    templateData: {
      width: 1000,
      height: 1500,
      elements: [
        {
          id: 'placeholder-overlay',
          layerOrder: 0,
          type: 'tile',
          x: 0,
          y: 0,
          width: 1000,
          height: 1500,
          properties: {
            fillColor: '#000000',
            fillOpacity: 25,
            borderRadius: 0,
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
      sections: [
        {
          // Monitored items with upcoming release (movies, TV series premieres)
          rules: [
            { field: 'isMonitored', operator: 'eq', value: true },
            {
              ruleOperator: 'and',
              field: 'daysUntilRelease',
              operator: 'lte',
              value: 30,
            }, // Only ≤30 days
          ],
        },
        {
          // OR monitored TV shows with upcoming season premiere (e.g., Season 2 when Season 1 doesn't exist)
          sectionOperator: 'or',
          rules: [
            { field: 'isMonitored', operator: 'eq', value: true },
            {
              ruleOperator: 'and',
              field: 'daysUntilNextSeason',
              operator: 'lte',
              value: 30,
            }, // Only ≤30 days
          ],
        },
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

  // Request Needed (Top Banner) - For items not in Plex and not monitored
  {
    name: 'Request Needed',
    description:
      'Top banner showing REQUEST NEEDED for items not downloaded and either not in *arr or not monitored',
    type: 'status',
    applicationCondition: {
      sections: [
        {
          rules: [
            // Not downloaded (placeholder or not in Plex)
            { field: 'downloaded', operator: 'eq', value: false },
          ],
        },
        {
          // AND (not in Radarr OR not monitored)
          sectionOperator: 'and',
          rules: [
            { field: 'inRadarr', operator: 'eq', value: false },
            {
              ruleOperator: 'or',
              field: 'isMonitored',
              operator: 'eq',
              value: false,
            },
          ],
        },
      ],
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
  // MONITORED RELEASES - ALREADY RELEASED (waiting for download)
  // ========================================

  // Awaiting Download - Top banner (released but not downloaded yet)
  {
    name: 'Awaiting Download',
    description:
      'Top banner for released monitored content in *arr awaiting download',
    type: 'status',
    applicationCondition: {
      sections: [
        {
          // MOVIES: Released (daysAgo >= 0), not downloaded, monitored, in Radarr
          rules: [
            { field: 'mediaType', operator: 'neq', value: 'show' },
            {
              ruleOperator: 'and',
              field: 'daysAgo',
              operator: 'gte',
              value: 0,
            },
            {
              ruleOperator: 'and',
              field: 'downloaded',
              operator: 'eq',
              value: false,
            },
            {
              ruleOperator: 'and',
              field: 'isMonitored',
              operator: 'eq',
              value: true,
            },
            {
              ruleOperator: 'and',
              field: 'inRadarr',
              operator: 'eq',
              value: true,
            },
          ],
        },
        {
          // OR TV SHOWS: Monitored season has aired (daysAgoNextSeason >= 0), not downloaded, monitored, in Sonarr
          sectionOperator: 'or',
          rules: [
            { field: 'mediaType', operator: 'eq', value: 'show' },
            {
              ruleOperator: 'and',
              field: 'daysAgoNextSeason',
              operator: 'gte',
              value: 0,
            },
            {
              ruleOperator: 'and',
              field: 'downloaded',
              operator: 'eq',
              value: false,
            },
            {
              ruleOperator: 'and',
              field: 'isMonitored',
              operator: 'eq',
              value: true,
            },
            {
              ruleOperator: 'and',
              field: 'inSonarr',
              operator: 'eq',
              value: true,
            },
          ],
        },
        {
          // OR TV SHOWS: Already released (daysAgo >= 0), not downloaded, monitored, in Sonarr (fallback for shows without daysAgoNextSeason)
          sectionOperator: 'or',
          rules: [
            { field: 'mediaType', operator: 'eq', value: 'show' },
            {
              ruleOperator: 'and',
              field: 'daysAgo',
              operator: 'gte',
              value: 0,
            },
            {
              ruleOperator: 'and',
              field: 'downloaded',
              operator: 'eq',
              value: false,
            },
            {
              ruleOperator: 'and',
              field: 'isMonitored',
              operator: 'eq',
              value: true,
            },
            {
              ruleOperator: 'and',
              field: 'inSonarr',
              operator: 'eq',
              value: true,
            },
          ],
        },
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
          id: 'awaiting-text',
          layerOrder: 1,
          type: 'text',
          x: 0,
          y: -25.5,
          width: 1000,
          height: 146,
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
  // TECHNICAL TEMPLATES
  // ========================================
  {
    name: '4K Resolution',
    description: 'Shows 4K badge for ultra HD content',
    type: 'technical',
    applicationCondition: {
      sections: [
        {
          rules: [
            { field: 'resolution', operator: 'in', value: ['4k', '2160'] },
          ],
        },
      ],
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

  // HDR10
  {
    name: 'HDR10',
    description: 'Shows HDR10 logo for HDR content without Dolby Vision',
    type: 'technical',
    applicationCondition: {
      sections: [
        {
          rules: [{ field: 'hdr', operator: 'eq', value: true }],
        },
      ],
    },
    templateData: {
      width: 1000,
      height: 1500,
      elements: [
        {
          id: 'hdr-logo',
          layerOrder: 0,
          type: 'svg',
          x: 0,
          y: 310.50617627005715,
          width: 163,
          height: 77,
          properties: {
            iconType: 'custom-icon',
            iconPath: '/api/v1/posters/icons/system/hdr.svg',
            opacity: 100,
            grayscale: false,
          },
        },
      ],
    },
  },

  // Dolby Vision
  {
    name: 'Dolby Vision',
    description: 'Shows Dolby Vision logo for any DoVi profile',
    type: 'technical',
    applicationCondition: {
      sections: [
        {
          rules: [{ field: 'dolbyVision', operator: 'eq', value: true }],
        },
      ],
    },
    templateData: {
      width: 1000,
      height: 1500,
      elements: [
        {
          id: 'dovi-background',
          layerOrder: 0,
          type: 'tile',
          x: -5.5246784801583,
          y: 390.50433315836005,
          width: 169,
          height: 85,
          properties: {
            fillColor: '#BCB8B8',
            fillOpacity: 40,
            borderColor: '#FFFFFF',
            borderWidth: 0,
            lockCorners: true,
            borderRadiusTopLeft: 10,
          },
        },
        {
          id: 'dovi-logo',
          layerOrder: 1,
          type: 'raster',
          x: 5.9753215198417,
          y: 384.50433315836005,
          width: 146,
          height: 97,
          properties: {
            imagePath: '/api/v1/posters/icons/system/dolbyVision.png',
            opacity: 100,
          },
        },
      ],
    },
  },

  // ========================================
  // BOTTOM BANNERS - Countdown/Date/Status for placeholders
  // ========================================

  // Returning Soon - TV S02+ - SEASON N countdown (2+ days away)
  {
    name: 'Returning Soon (Monitored)',
    description:
      'Bottom banner for returning TV shows (S02+) monitored in Sonarr with countdown',
    type: 'status',
    applicationCondition: {
      sections: [
        {
          rules: [
            { field: 'daysUntilNextSeason', operator: 'gt', value: 1 },
            {
              ruleOperator: 'and',
              field: 'seasonNumber',
              operator: 'gt',
              value: 1,
            },
            {
              ruleOperator: 'and',
              field: 'mediaType',
              operator: 'eq',
              value: 'show',
            },
            {
              ruleOperator: 'and',
              field: 'inSonarr',
              operator: 'eq',
              value: true,
            },
            {
              ruleOperator: 'and',
              field: 'isMonitored',
              operator: 'eq',
              value: true,
            },
          ],
        },
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
            fillColor: '#DC2626',
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
              { type: 'variable', field: 'daysUntilNextSeason' },
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

  {
    name: 'Returning Soon (Unmonitored)',
    description:
      'Bottom banner for returning TV shows (S02+) not monitored or not in Sonarr',
    type: 'status',
    applicationCondition: {
      sections: [
        {
          // (>1 day AND S02+ AND show) AND NOT inSonarr
          rules: [
            { field: 'daysUntilNextSeason', operator: 'gt', value: 1 },
            {
              ruleOperator: 'and',
              field: 'seasonNumber',
              operator: 'gt',
              value: 1,
            },
            {
              ruleOperator: 'and',
              field: 'mediaType',
              operator: 'eq',
              value: 'show',
            },
            {
              ruleOperator: 'and',
              field: 'inSonarr',
              operator: 'eq',
              value: false,
            },
          ],
        },
        {
          // OR (>1 day AND S02+ AND show) AND NOT monitored
          sectionOperator: 'or',
          rules: [
            { field: 'daysUntilNextSeason', operator: 'gt', value: 1 },
            {
              ruleOperator: 'and',
              field: 'seasonNumber',
              operator: 'gt',
              value: 1,
            },
            {
              ruleOperator: 'and',
              field: 'mediaType',
              operator: 'eq',
              value: 'show',
            },
            {
              ruleOperator: 'and',
              field: 'isMonitored',
              operator: 'eq',
              value: false,
            },
          ],
        },
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
            fillColor: '#EA580C',
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
              { type: 'variable', field: 'daysUntilNextSeason' },
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

  // Returning Tomorrow - TV S02+ - SEASON N TOMORROW
  {
    name: 'Returning Tomorrow (Monitored)',
    description:
      'Bottom banner for returning TV shows (S02+) monitored in Sonarr releasing tomorrow',
    type: 'status',
    applicationCondition: {
      sections: [
        {
          rules: [
            { field: 'daysUntilNextSeason', operator: 'eq', value: 1 },
            {
              ruleOperator: 'and',
              field: 'seasonNumber',
              operator: 'gt',
              value: 1,
            },
            {
              ruleOperator: 'and',
              field: 'mediaType',
              operator: 'eq',
              value: 'show',
            },
            {
              ruleOperator: 'and',
              field: 'inSonarr',
              operator: 'eq',
              value: true,
            },
            {
              ruleOperator: 'and',
              field: 'isMonitored',
              operator: 'eq',
              value: true,
            },
          ],
        },
      ],
    },
    templateData: {
      width: 1000,
      height: 1500,
      elements: [
        {
          id: 'returning-tomorrow-banner-bg',
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
          id: 'season-tomorrow-text',
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
              { type: 'text', value: ' TOMORROW' },
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

  {
    name: 'Returning Tomorrow (Unmonitored)',
    description:
      'Bottom banner for returning TV shows (S02+) releasing tomorrow not monitored or not in Sonarr',
    type: 'status',
    applicationCondition: {
      sections: [
        {
          // (tomorrow AND S02+ AND show) AND NOT inSonarr
          rules: [
            { field: 'daysUntilNextSeason', operator: 'eq', value: 1 },
            {
              ruleOperator: 'and',
              field: 'seasonNumber',
              operator: 'gt',
              value: 1,
            },
            {
              ruleOperator: 'and',
              field: 'mediaType',
              operator: 'eq',
              value: 'show',
            },
            {
              ruleOperator: 'and',
              field: 'inSonarr',
              operator: 'eq',
              value: false,
            },
          ],
        },
        {
          // OR (tomorrow AND S02+ AND show) AND NOT monitored
          sectionOperator: 'or',
          rules: [
            { field: 'daysUntilNextSeason', operator: 'eq', value: 1 },
            {
              ruleOperator: 'and',
              field: 'seasonNumber',
              operator: 'gt',
              value: 1,
            },
            {
              ruleOperator: 'and',
              field: 'mediaType',
              operator: 'eq',
              value: 'show',
            },
            {
              ruleOperator: 'and',
              field: 'isMonitored',
              operator: 'eq',
              value: false,
            },
          ],
        },
      ],
    },
    templateData: {
      width: 1000,
      height: 1500,
      elements: [
        {
          id: 'returning-tomorrow-banner-bg',
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
          id: 'season-tomorrow-text',
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
              { type: 'text', value: ' TOMORROW' },
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

  // Returning Today - TV S02+ - SEASON N TODAY (not downloaded)
  {
    name: 'Returning Today (Monitored)',
    description:
      'Bottom banner for returning TV shows (S02+) monitored in Sonarr releasing today',
    type: 'status',
    applicationCondition: {
      sections: [
        {
          rules: [
            { field: 'daysAgo', operator: 'eq', value: 0 },
            {
              ruleOperator: 'and',
              field: 'seasonNumber',
              operator: 'gt',
              value: 1,
            },
            {
              ruleOperator: 'and',
              field: 'mediaType',
              operator: 'eq',
              value: 'show',
            },
            {
              ruleOperator: 'and',
              field: 'inSonarr',
              operator: 'eq',
              value: true,
            },
            {
              ruleOperator: 'and',
              field: 'isMonitored',
              operator: 'eq',
              value: true,
            },
          ],
        },
      ],
    },
    templateData: {
      width: 1000,
      height: 1500,
      elements: [
        {
          id: 'returning-today-banner-bg',
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
          id: 'season-today-text',
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
              { type: 'text', value: ' TODAY' },
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

  {
    name: 'Returning Today (Unmonitored)',
    description:
      'Bottom banner for returning TV shows (S02+) releasing today not monitored or not in Sonarr',
    type: 'status',
    applicationCondition: {
      sections: [
        {
          // (today AND S02+ AND show) AND NOT inSonarr
          rules: [
            { field: 'daysAgo', operator: 'eq', value: 0 },
            {
              ruleOperator: 'and',
              field: 'seasonNumber',
              operator: 'gt',
              value: 1,
            },
            {
              ruleOperator: 'and',
              field: 'mediaType',
              operator: 'eq',
              value: 'show',
            },
            {
              ruleOperator: 'and',
              field: 'inSonarr',
              operator: 'eq',
              value: false,
            },
          ],
        },
        {
          // OR (today AND S02+ AND show) AND NOT monitored
          sectionOperator: 'or',
          rules: [
            { field: 'daysAgo', operator: 'eq', value: 0 },
            {
              ruleOperator: 'and',
              field: 'seasonNumber',
              operator: 'gt',
              value: 1,
            },
            {
              ruleOperator: 'and',
              field: 'mediaType',
              operator: 'eq',
              value: 'show',
            },
            {
              ruleOperator: 'and',
              field: 'isMonitored',
              operator: 'eq',
              value: false,
            },
          ],
        },
      ],
    },
    templateData: {
      width: 1000,
      height: 1500,
      elements: [
        {
          id: 'returning-today-banner-bg',
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
          id: 'season-today-text',
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
              { type: 'text', value: ' TODAY' },
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

  // Far Future Date Display >30 days - Bottom banner with formatted date
  {
    name: 'Far Future Release Date (Monitored)',
    description:
      'Bottom banner showing formatted date for monitored releases >30 days away in Radarr/Sonarr',
    type: 'status',
    applicationCondition: {
      sections: [
        {
          // Movies: >30 days, monitored, not a show, in Radarr
          rules: [
            { field: 'daysUntilRelease', operator: 'gt', value: 30 },
            {
              ruleOperator: 'and',
              field: 'isMonitored',
              operator: 'eq',
              value: true,
            },
            {
              ruleOperator: 'and',
              field: 'mediaType',
              operator: 'neq',
              value: 'show',
            },
            {
              ruleOperator: 'and',
              field: 'inRadarr',
              operator: 'eq',
              value: true,
            },
          ],
        },
        {
          // OR TV S01: >30 days, monitored, season <= 1, in Sonarr
          sectionOperator: 'or',
          rules: [
            { field: 'daysUntilRelease', operator: 'gt', value: 30 },
            {
              ruleOperator: 'and',
              field: 'isMonitored',
              operator: 'eq',
              value: true,
            },
            {
              ruleOperator: 'and',
              field: 'seasonNumber',
              operator: 'lte',
              value: 1,
            },
            {
              ruleOperator: 'and',
              field: 'inSonarr',
              operator: 'eq',
              value: true,
            },
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

  {
    name: 'Far Future Release Date (Unmonitored)',
    description:
      'Bottom banner showing formatted date for releases >30 days away not monitored or not in *arr',
    type: 'status',
    applicationCondition: {
      sections: [
        {
          // Movies: (>30 days AND movie) AND NOT inRadarr
          rules: [
            { field: 'daysUntilRelease', operator: 'gt', value: 30 },
            {
              ruleOperator: 'and',
              field: 'mediaType',
              operator: 'neq',
              value: 'show',
            },
            {
              ruleOperator: 'and',
              field: 'inRadarr',
              operator: 'eq',
              value: false,
            },
          ],
        },
        {
          // OR (>30 days AND movie) AND NOT monitored
          sectionOperator: 'or',
          rules: [
            { field: 'daysUntilRelease', operator: 'gt', value: 30 },
            {
              ruleOperator: 'and',
              field: 'mediaType',
              operator: 'neq',
              value: 'show',
            },
            {
              ruleOperator: 'and',
              field: 'isMonitored',
              operator: 'eq',
              value: false,
            },
          ],
        },
        {
          // OR TV S01: (>30 days AND season <= 1) AND NOT inSonarr
          sectionOperator: 'or',
          rules: [
            { field: 'daysUntilRelease', operator: 'gt', value: 30 },
            {
              ruleOperator: 'and',
              field: 'seasonNumber',
              operator: 'lte',
              value: 1,
            },
            {
              ruleOperator: 'and',
              field: 'inSonarr',
              operator: 'eq',
              value: false,
            },
          ],
        },
        {
          // OR (>30 days AND season <= 1) AND NOT monitored
          sectionOperator: 'or',
          rules: [
            { field: 'daysUntilRelease', operator: 'gt', value: 30 },
            {
              ruleOperator: 'and',
              field: 'seasonNumber',
              operator: 'lte',
              value: 1,
            },
            {
              ruleOperator: 'and',
              field: 'isMonitored',
              operator: 'eq',
              value: false,
            },
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
            fillColor: '#EA580C',
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
      'Bottom countdown banner for monitored releases within 30 days in Radarr/Sonarr',
    type: 'status',
    applicationCondition: {
      sections: [
        {
          rules: [
            // Base condition: 2-30 days until release
            { field: 'daysUntilRelease', operator: 'gt', value: 1 },
            {
              ruleOperator: 'and',
              field: 'daysUntilRelease',
              operator: 'lte',
              value: 30,
            },
            // AND monitored
            {
              ruleOperator: 'and',
              field: 'isMonitored',
              operator: 'eq',
              value: true,
            },
            // AND ((movie in Radarr) OR (TV S01 in Sonarr))
            {
              ruleOperator: 'and',
              field: 'mediaType',
              operator: 'neq',
              value: 'show',
            },
            {
              ruleOperator: 'and',
              field: 'inRadarr',
              operator: 'eq',
              value: true,
            },
          ],
        },
        {
          // OR TV Season 1
          sectionOperator: 'or',
          rules: [
            { field: 'daysUntilRelease', operator: 'gt', value: 1 },
            {
              ruleOperator: 'and',
              field: 'daysUntilRelease',
              operator: 'lte',
              value: 30,
            },
            {
              ruleOperator: 'and',
              field: 'isMonitored',
              operator: 'eq',
              value: true,
            },
            {
              ruleOperator: 'and',
              field: 'seasonNumber',
              operator: 'lte',
              value: 1,
            },
            {
              ruleOperator: 'and',
              field: 'inSonarr',
              operator: 'eq',
              value: true,
            },
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

  // ========================================
  // REQUEST NEEDED TEMPLATES
  // ========================================

  // Countdown (Unmonitored, 2-30 days) - Bottom banner only (ORANGE)
  {
    name: 'Countdown (Unmonitored)',
    description:
      'Bottom countdown banner for releases 2-30 days away not monitored or not in *arr',
    type: 'status',
    applicationCondition: {
      sections: [
        {
          // Movies: (2-30 days AND movie) AND NOT inRadarr
          rules: [
            { field: 'daysUntilRelease', operator: 'gt', value: 1 },
            {
              ruleOperator: 'and',
              field: 'daysUntilRelease',
              operator: 'lte',
              value: 30,
            },
            {
              ruleOperator: 'and',
              field: 'mediaType',
              operator: 'neq',
              value: 'show',
            },
            {
              ruleOperator: 'and',
              field: 'inRadarr',
              operator: 'eq',
              value: false,
            },
          ],
        },
        {
          // OR (2-30 days AND movie) AND NOT monitored
          sectionOperator: 'or',
          rules: [
            { field: 'daysUntilRelease', operator: 'gt', value: 1 },
            {
              ruleOperator: 'and',
              field: 'daysUntilRelease',
              operator: 'lte',
              value: 30,
            },
            {
              ruleOperator: 'and',
              field: 'mediaType',
              operator: 'neq',
              value: 'show',
            },
            {
              ruleOperator: 'and',
              field: 'isMonitored',
              operator: 'eq',
              value: false,
            },
          ],
        },
        {
          // OR TV S01: (2-30 days AND season <= 1) AND NOT inSonarr
          sectionOperator: 'or',
          rules: [
            { field: 'daysUntilRelease', operator: 'gt', value: 1 },
            {
              ruleOperator: 'and',
              field: 'daysUntilRelease',
              operator: 'lte',
              value: 30,
            },
            {
              ruleOperator: 'and',
              field: 'seasonNumber',
              operator: 'lte',
              value: 1,
            },
            {
              ruleOperator: 'and',
              field: 'inSonarr',
              operator: 'eq',
              value: false,
            },
          ],
        },
        {
          // OR (2-30 days AND season <= 1) AND NOT monitored
          sectionOperator: 'or',
          rules: [
            { field: 'daysUntilRelease', operator: 'gt', value: 1 },
            {
              ruleOperator: 'and',
              field: 'daysUntilRelease',
              operator: 'lte',
              value: 30,
            },
            {
              ruleOperator: 'and',
              field: 'seasonNumber',
              operator: 'lte',
              value: 1,
            },
            {
              ruleOperator: 'and',
              field: 'isMonitored',
              operator: 'eq',
              value: false,
            },
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

  // Tomorrow (Monitored) - Bottom banner only
  {
    name: 'Releasing Tomorrow (Monitored)',
    description:
      'Bottom banner for monitored releases coming tomorrow in Radarr/Sonarr',
    type: 'status',
    applicationCondition: {
      sections: [
        {
          // Movies: tomorrow, monitored, not a show, in Radarr
          rules: [
            { field: 'daysUntilRelease', operator: 'eq', value: 1 },
            {
              ruleOperator: 'and',
              field: 'isMonitored',
              operator: 'eq',
              value: true,
            },
            {
              ruleOperator: 'and',
              field: 'mediaType',
              operator: 'neq',
              value: 'show',
            },
            {
              ruleOperator: 'and',
              field: 'inRadarr',
              operator: 'eq',
              value: true,
            },
          ],
        },
        {
          // OR TV S01: tomorrow, monitored, season <= 1, in Sonarr
          sectionOperator: 'or',
          rules: [
            { field: 'daysUntilRelease', operator: 'eq', value: 1 },
            {
              ruleOperator: 'and',
              field: 'isMonitored',
              operator: 'eq',
              value: true,
            },
            {
              ruleOperator: 'and',
              field: 'seasonNumber',
              operator: 'lte',
              value: 1,
            },
            {
              ruleOperator: 'and',
              field: 'inSonarr',
              operator: 'eq',
              value: true,
            },
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

  // Tomorrow (Unmonitored) - Bottom banner only (ORANGE)
  {
    name: 'Releasing Tomorrow (Unmonitored)',
    description:
      'Bottom banner for releases coming tomorrow not monitored or not in *arr',
    type: 'status',
    applicationCondition: {
      sections: [
        {
          // Movies: (tomorrow AND movie) AND NOT inRadarr
          rules: [
            { field: 'daysUntilRelease', operator: 'eq', value: 1 },
            {
              ruleOperator: 'and',
              field: 'mediaType',
              operator: 'neq',
              value: 'show',
            },
            {
              ruleOperator: 'and',
              field: 'inRadarr',
              operator: 'eq',
              value: false,
            },
          ],
        },
        {
          // OR (tomorrow AND movie) AND NOT monitored
          sectionOperator: 'or',
          rules: [
            { field: 'daysUntilRelease', operator: 'eq', value: 1 },
            {
              ruleOperator: 'and',
              field: 'mediaType',
              operator: 'neq',
              value: 'show',
            },
            {
              ruleOperator: 'and',
              field: 'isMonitored',
              operator: 'eq',
              value: false,
            },
          ],
        },
        {
          // OR TV S01: (tomorrow AND season <= 1) AND NOT inSonarr
          sectionOperator: 'or',
          rules: [
            { field: 'daysUntilRelease', operator: 'eq', value: 1 },
            {
              ruleOperator: 'and',
              field: 'seasonNumber',
              operator: 'lte',
              value: 1,
            },
            {
              ruleOperator: 'and',
              field: 'inSonarr',
              operator: 'eq',
              value: false,
            },
          ],
        },
        {
          // OR (tomorrow AND season <= 1) AND NOT monitored
          sectionOperator: 'or',
          rules: [
            { field: 'daysUntilRelease', operator: 'eq', value: 1 },
            {
              ruleOperator: 'and',
              field: 'seasonNumber',
              operator: 'lte',
              value: 1,
            },
            {
              ruleOperator: 'and',
              field: 'isMonitored',
              operator: 'eq',
              value: false,
            },
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

  // Just Released (Monitored) - Bottom banner for downloaded items released today
  {
    name: 'Just Released (Monitored)',
    description:
      'Bottom banner for monitored releases downloaded today in Radarr/Sonarr',
    type: 'status',
    applicationCondition: {
      sections: [
        {
          // Movies: today, downloaded, monitored, not a show, in Radarr
          rules: [
            { field: 'daysAgo', operator: 'eq', value: 0 },
            {
              ruleOperator: 'and',
              field: 'downloaded',
              operator: 'eq',
              value: true,
            },
            {
              ruleOperator: 'and',
              field: 'isMonitored',
              operator: 'eq',
              value: true,
            },
            {
              ruleOperator: 'and',
              field: 'mediaType',
              operator: 'neq',
              value: 'show',
            },
            {
              ruleOperator: 'and',
              field: 'inRadarr',
              operator: 'eq',
              value: true,
            },
          ],
        },
        {
          // OR TV S01: today, downloaded, monitored, season <= 1, in Sonarr
          sectionOperator: 'or',
          rules: [
            { field: 'daysAgo', operator: 'eq', value: 0 },
            {
              ruleOperator: 'and',
              field: 'downloaded',
              operator: 'eq',
              value: true,
            },
            {
              ruleOperator: 'and',
              field: 'isMonitored',
              operator: 'eq',
              value: true,
            },
            {
              ruleOperator: 'and',
              field: 'seasonNumber',
              operator: 'lte',
              value: 1,
            },
            {
              ruleOperator: 'and',
              field: 'inSonarr',
              operator: 'eq',
              value: true,
            },
          ],
        },
      ],
    },
    templateData: {
      width: 1000,
      height: 1500,
      elements: [
        {
          id: 'just-released-banner-bg',
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
          id: 'just-released-text',
          layerOrder: 1,
          type: 'text',
          x: 0,
          y: 1382,
          width: 1000,
          height: 141,
          properties: {
            text: 'JUST RELEASED',
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

  // Releasing Today (Monitored) - Bottom banner for not-yet-downloaded items releasing today
  {
    name: 'Releasing Today (Monitored)',
    description:
      'Bottom banner for monitored releases releasing today in Radarr/Sonarr (awaiting download)',
    type: 'status',
    applicationCondition: {
      sections: [
        {
          // Movies: today, NOT downloaded, monitored, not a show, in Radarr
          rules: [
            { field: 'daysAgo', operator: 'eq', value: 0 },
            {
              ruleOperator: 'and',
              field: 'downloaded',
              operator: 'eq',
              value: false,
            },
            {
              ruleOperator: 'and',
              field: 'isMonitored',
              operator: 'eq',
              value: true,
            },
            {
              ruleOperator: 'and',
              field: 'mediaType',
              operator: 'neq',
              value: 'show',
            },
            {
              ruleOperator: 'and',
              field: 'inRadarr',
              operator: 'eq',
              value: true,
            },
          ],
        },
        {
          // OR TV S01: today, NOT downloaded, monitored, season <= 1, in Sonarr
          sectionOperator: 'or',
          rules: [
            { field: 'daysAgo', operator: 'eq', value: 0 },
            {
              ruleOperator: 'and',
              field: 'downloaded',
              operator: 'eq',
              value: false,
            },
            {
              ruleOperator: 'and',
              field: 'isMonitored',
              operator: 'eq',
              value: true,
            },
            {
              ruleOperator: 'and',
              field: 'seasonNumber',
              operator: 'lte',
              value: 1,
            },
            {
              ruleOperator: 'and',
              field: 'inSonarr',
              operator: 'eq',
              value: true,
            },
          ],
        },
      ],
    },
    templateData: {
      width: 1000,
      height: 1500,
      elements: [
        {
          id: 'releasing-today-banner-bg',
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
          id: 'releasing-today-text',
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

  // Today (Unmonitored) - Bottom banner only (ORANGE)
  {
    name: 'Releasing Today (Unmonitored)',
    description:
      'Bottom banner for releases released today not monitored or not in *arr',
    type: 'status',
    applicationCondition: {
      sections: [
        {
          // Movies: (today AND movie) AND NOT inRadarr
          rules: [
            { field: 'daysAgo', operator: 'eq', value: 0 },
            {
              ruleOperator: 'and',
              field: 'mediaType',
              operator: 'neq',
              value: 'show',
            },
            {
              ruleOperator: 'and',
              field: 'inRadarr',
              operator: 'eq',
              value: false,
            },
          ],
        },
        {
          // OR (today AND movie) AND NOT monitored
          sectionOperator: 'or',
          rules: [
            { field: 'daysAgo', operator: 'eq', value: 0 },
            {
              ruleOperator: 'and',
              field: 'mediaType',
              operator: 'neq',
              value: 'show',
            },
            {
              ruleOperator: 'and',
              field: 'isMonitored',
              operator: 'eq',
              value: false,
            },
          ],
        },
        {
          // OR TV S01: (today AND season <= 1) AND NOT inSonarr
          sectionOperator: 'or',
          rules: [
            { field: 'daysAgo', operator: 'eq', value: 0 },
            {
              ruleOperator: 'and',
              field: 'seasonNumber',
              operator: 'lte',
              value: 1,
            },
            {
              ruleOperator: 'and',
              field: 'inSonarr',
              operator: 'eq',
              value: false,
            },
          ],
        },
        {
          // OR (today AND season <= 1) AND NOT monitored
          sectionOperator: 'or',
          rules: [
            { field: 'daysAgo', operator: 'eq', value: 0 },
            {
              ruleOperator: 'and',
              field: 'seasonNumber',
              operator: 'lte',
              value: 1,
            },
            {
              ruleOperator: 'and',
              field: 'isMonitored',
              operator: 'eq',
              value: false,
            },
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

  // ========================================
  // DOWNLOADED CONTENT (recently released with file)
  // ========================================

  // Released Yesterday (Monitored) - Bottom banner
  {
    name: 'Released Yesterday (Monitored)',
    description:
      'Bottom banner for downloaded monitored content released yesterday in Radarr/Sonarr',
    type: 'status',
    applicationCondition: {
      sections: [
        {
          // Movies: downloaded, yesterday, monitored, in Radarr
          rules: [
            { field: 'downloaded', operator: 'eq', value: true },
            {
              ruleOperator: 'and',
              field: 'daysAgo',
              operator: 'eq',
              value: 1,
            },
            {
              ruleOperator: 'and',
              field: 'isMonitored',
              operator: 'eq',
              value: true,
            },
            {
              ruleOperator: 'and',
              field: 'inRadarr',
              operator: 'eq',
              value: true,
            },
          ],
        },
        {
          // OR TV: downloaded, yesterday, monitored, in Sonarr
          sectionOperator: 'or',
          rules: [
            { field: 'downloaded', operator: 'eq', value: true },
            {
              ruleOperator: 'and',
              field: 'daysAgo',
              operator: 'eq',
              value: 1,
            },
            {
              ruleOperator: 'and',
              field: 'isMonitored',
              operator: 'eq',
              value: true,
            },
            {
              ruleOperator: 'and',
              field: 'inSonarr',
              operator: 'eq',
              value: true,
            },
          ],
        },
      ],
    },
    templateData: {
      width: 1000,
      height: 1500,
      elements: [
        {
          id: 'yesterday-banner-bg',
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
          id: 'yesterday-text',
          layerOrder: 1,
          type: 'text',
          x: 0,
          y: 1382,
          width: 1000,
          height: 141,
          properties: {
            text: 'RELEASED YESTERDAY',
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

  // Released Yesterday (Unmonitored) - Bottom banner
  {
    name: 'Released Yesterday (Unmonitored)',
    description:
      'Bottom banner for downloaded content released yesterday not monitored or not in *arr',
    type: 'status',
    applicationCondition: {
      sections: [
        {
          // Movies: (downloaded AND yesterday) AND NOT inRadarr
          rules: [
            { field: 'downloaded', operator: 'eq', value: true },
            {
              ruleOperator: 'and',
              field: 'daysAgo',
              operator: 'eq',
              value: 1,
            },
            {
              ruleOperator: 'and',
              field: 'inRadarr',
              operator: 'eq',
              value: false,
            },
          ],
        },
        {
          // OR (downloaded AND yesterday) AND NOT monitored
          sectionOperator: 'or',
          rules: [
            { field: 'downloaded', operator: 'eq', value: true },
            {
              ruleOperator: 'and',
              field: 'daysAgo',
              operator: 'eq',
              value: 1,
            },
            {
              ruleOperator: 'and',
              field: 'isMonitored',
              operator: 'eq',
              value: false,
            },
          ],
        },
        {
          // OR TV: (downloaded AND yesterday) AND NOT inSonarr
          sectionOperator: 'or',
          rules: [
            { field: 'downloaded', operator: 'eq', value: true },
            {
              ruleOperator: 'and',
              field: 'daysAgo',
              operator: 'eq',
              value: 1,
            },
            {
              ruleOperator: 'and',
              field: 'inSonarr',
              operator: 'eq',
              value: false,
            },
          ],
        },
        {
          // OR (downloaded AND yesterday) AND NOT monitored
          sectionOperator: 'or',
          rules: [
            { field: 'downloaded', operator: 'eq', value: true },
            {
              ruleOperator: 'and',
              field: 'daysAgo',
              operator: 'eq',
              value: 1,
            },
            {
              ruleOperator: 'and',
              field: 'isMonitored',
              operator: 'eq',
              value: false,
            },
          ],
        },
      ],
    },
    templateData: {
      width: 1000,
      height: 1500,
      elements: [
        {
          id: 'yesterday-banner-bg',
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
          id: 'yesterday-text',
          layerOrder: 1,
          type: 'text',
          x: 0,
          y: 1382,
          width: 1000,
          height: 141,
          properties: {
            text: 'RELEASED YESTERDAY',
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

  // New Release (downloaded) - Single bottom banner
  {
    name: 'Released Days Ago (Monitored)',
    description:
      'Single banner showing days since release for downloaded monitored content in Radarr/Sonarr',
    type: 'status',
    applicationCondition: {
      sections: [
        {
          // Movies: downloaded, 2-7 days ago, monitored, in Radarr
          rules: [
            { field: 'downloaded', operator: 'eq', value: true },
            {
              ruleOperator: 'and',
              field: 'daysAgo',
              operator: 'gt',
              value: 1,
            },
            {
              ruleOperator: 'and',
              field: 'daysAgo',
              operator: 'lte',
              value: 7,
            },
            {
              ruleOperator: 'and',
              field: 'isMonitored',
              operator: 'eq',
              value: true,
            },
            {
              ruleOperator: 'and',
              field: 'inRadarr',
              operator: 'eq',
              value: true,
            },
          ],
        },
        {
          // OR TV: downloaded, 2-7 days ago, monitored, in Sonarr
          sectionOperator: 'or',
          rules: [
            { field: 'downloaded', operator: 'eq', value: true },
            {
              ruleOperator: 'and',
              field: 'daysAgo',
              operator: 'gt',
              value: 1,
            },
            {
              ruleOperator: 'and',
              field: 'daysAgo',
              operator: 'lte',
              value: 7,
            },
            {
              ruleOperator: 'and',
              field: 'isMonitored',
              operator: 'eq',
              value: true,
            },
            {
              ruleOperator: 'and',
              field: 'inSonarr',
              operator: 'eq',
              value: true,
            },
          ],
        },
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
            fillColor: '#DC2626',
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

  // Released Days Ago (Unmonitored) - Bottom banner only (ORANGE)
  {
    name: 'Released Days Ago (Unmonitored)',
    description:
      'Bottom banner showing days since release for downloaded content not monitored or not in *arr',
    type: 'status',
    applicationCondition: {
      sections: [
        {
          // Movies: (downloaded AND 2-7 days ago) AND NOT inRadarr
          rules: [
            { field: 'downloaded', operator: 'eq', value: true },
            {
              ruleOperator: 'and',
              field: 'daysAgo',
              operator: 'gt',
              value: 1,
            },
            {
              ruleOperator: 'and',
              field: 'daysAgo',
              operator: 'lte',
              value: 7,
            },
            {
              ruleOperator: 'and',
              field: 'inRadarr',
              operator: 'eq',
              value: false,
            },
          ],
        },
        {
          // OR (downloaded AND 2-7 days ago) AND NOT monitored
          sectionOperator: 'or',
          rules: [
            { field: 'downloaded', operator: 'eq', value: true },
            {
              ruleOperator: 'and',
              field: 'daysAgo',
              operator: 'gt',
              value: 1,
            },
            {
              ruleOperator: 'and',
              field: 'daysAgo',
              operator: 'lte',
              value: 7,
            },
            {
              ruleOperator: 'and',
              field: 'isMonitored',
              operator: 'eq',
              value: false,
            },
          ],
        },
        {
          // OR TV: (downloaded AND 2-7 days ago) AND NOT inSonarr
          sectionOperator: 'or',
          rules: [
            { field: 'downloaded', operator: 'eq', value: true },
            {
              ruleOperator: 'and',
              field: 'daysAgo',
              operator: 'gt',
              value: 1,
            },
            {
              ruleOperator: 'and',
              field: 'daysAgo',
              operator: 'lte',
              value: 7,
            },
            {
              ruleOperator: 'and',
              field: 'inSonarr',
              operator: 'eq',
              value: false,
            },
          ],
        },
        {
          // OR (downloaded AND 2-7 days ago) AND NOT monitored
          sectionOperator: 'or',
          rules: [
            { field: 'downloaded', operator: 'eq', value: true },
            {
              ruleOperator: 'and',
              field: 'daysAgo',
              operator: 'gt',
              value: 1,
            },
            {
              ruleOperator: 'and',
              field: 'daysAgo',
              operator: 'lte',
              value: 7,
            },
            {
              ruleOperator: 'and',
              field: 'isMonitored',
              operator: 'eq',
              value: false,
            },
          ],
        },
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

  // ========================================
  // MAINTAINERR INTEGRATION
  // ========================================

  // Maintainerr - Deleting Soon
  {
    name: 'Maintainerr Deleting Soon',
    description:
      'Bottom banner showing countdown for items marked for deletion by Maintainerr',
    type: 'status',
    applicationCondition: {
      sections: [
        {
          rules: [{ field: 'daysUntilAction', operator: 'gte', value: 0 }],
        },
      ],
    },
    templateData: {
      width: 1000,
      height: 1500,
      elements: [
        {
          id: 'maintainerr-deleting-banner-bg',
          layerOrder: 0,
          type: 'tile',
          x: 0,
          y: 1405,
          width: 1000,
          height: 95,
          properties: {
            fillColor: '#F59E0B',
            fillOpacity: 100,
            borderRadius: 0,
          },
        },
        {
          id: 'maintainerr-deleting-text',
          layerOrder: 1,
          type: 'variable',
          x: 0,
          y: 1382,
          width: 1000,
          height: 141,
          properties: {
            segments: [
              { type: 'text', value: 'DELETING IN ' },
              { type: 'variable', field: 'daysUntilAction' },
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
  // TV SHOW STATUS
  // ========================================

  // TV Show Status - Top banner showing TMDB status
  {
    name: 'TV Show Status',
    description:
      'Top banner displaying TV show status (Returning Series, Ended, Cancelled, etc.) - TV shows only, for items already in library',
    type: 'status',
    applicationCondition: {
      sections: [
        {
          rules: [
            { field: 'mediaType', operator: 'eq', value: 'show' },
            {
              ruleOperator: 'and',
              field: 'downloaded',
              operator: 'eq',
              value: true,
            },
            {
              ruleOperator: 'and',
              field: 'isPlaceholder',
              operator: 'eq',
              value: false,
            },
          ],
        },
      ],
    },
    templateData: {
      width: 1000,
      height: 1500,
      elements: [
        {
          id: 'status-banner-bg',
          layerOrder: 0,
          type: 'tile',
          x: 0,
          y: 0,
          width: 1000,
          height: 95,
          properties: {
            fillColor: '#1F2937',
            fillOpacity: 85,
            borderRadius: 0,
          },
        },
        {
          id: 'status-text',
          layerOrder: 1,
          type: 'variable',
          x: 0,
          y: -25.5,
          width: 1000,
          height: 146,
          properties: {
            segments: [{ type: 'variable', field: 'tmdbStatus' }],
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

    // Get current preset names for cleanup comparison
    const currentPresetNames = PRESET_TEMPLATES.map((p) => p.name);

    // Find all existing default templates in database
    const allDefaultTemplates = await templateRepository.find({
      where: { isDefault: true },
    });

    // Clean up deleted presets (templates removed from PRESET_TEMPLATES array)
    for (const dbTemplate of allDefaultTemplates) {
      if (!currentPresetNames.includes(dbTemplate.name)) {
        // Remove references from library configs before deleting template
        const { getRepository: getRepo } = await import('@server/datasource');
        const { OverlayLibraryConfig } = await import(
          '@server/entity/OverlayLibraryConfig'
        );
        const configRepository = getRepo(OverlayLibraryConfig);
        const configs = await configRepository.find();

        for (const config of configs) {
          const originalLength = config.enabledOverlays.length;
          config.enabledOverlays = config.enabledOverlays.filter(
            (overlay) => overlay.templateId !== dbTemplate.id
          );

          // Only save if we actually removed something
          if (config.enabledOverlays.length !== originalLength) {
            await configRepository.save(config);
            logger.debug(
              `Removed deleted preset "${dbTemplate.name}" from library config "${config.libraryName}"`,
              {
                label: 'PresetTemplates',
              }
            );
          }
        }

        // Delete the template
        await templateRepository.remove(dbTemplate);
        logger.info(`Deleted removed preset template: ${dbTemplate.name}`, {
          label: 'PresetTemplates',
        });
      }
    }

    // Create or update presets
    for (const [index, preset] of PRESET_TEMPLATES.entries()) {
      // Check if preset already exists
      const existingTemplate = await templateRepository.findOne({
        where: { name: preset.name, isDefault: true },
      });

      if (existingTemplate) {
        // Update existing preset template to sync any changes
        existingTemplate.displayOrder = index; // Sync order from array position
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
        displayOrder: index, // Set order from array position
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
