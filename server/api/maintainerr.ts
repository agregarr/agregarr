import type { MaintainerrSettings } from '@server/lib/settings';
import logger from '@server/logger';
import type { AxiosInstance } from 'axios';
import axios from 'axios';

export interface MaintainerrMedia {
  id: number;
  collectionId: number;
  plexId?: number; // v2 field
  mediaServerId?: string; // v3 field (renamed from plexId)
  tmdbId: number;
  addDate: string; // ISO 8601 date string
  image_path: string;
  isManual: boolean;
}

export interface MaintainerrCollection {
  id: number;
  plexId?: number; // v2 field
  mediaServerId?: string; // v3 field (renamed from plexId)
  libraryId: number;
  title: string;
  description: string;
  isActive: boolean;
  arrAction: number;
  visibleOnRecommended: boolean;
  visibleOnHome: boolean;
  deleteAfterDays: number;
  manualCollection: boolean;
  manualCollectionName: string;
  listExclusions: boolean;
  forceOverseerr: boolean;
  type: number;
  keepLogsForMonths: number;
  addDate: string;
  handledMediaAmount: number;
  lastDurationInSeconds: number;
  tautulliWatchedPercentOverride: number | null;
  radarrSettingsId: number | null;
  sonarrSettingsId: number | null;
  media: MaintainerrMedia[];
}

class MaintainerrAPI {
  private axios: AxiosInstance;

  constructor(settings: MaintainerrSettings) {
    const protocol = settings.useSsl ? 'https' : 'http';
    const port = settings.port ? `:${settings.port}` : '';
    const urlBase = settings.urlBase ?? '';

    this.axios = axios.create({
      baseURL: `${protocol}://${settings.hostname}${port}${urlBase}`,
      headers: { 'X-Api-Key': settings.apiKey },
      timeout: 30000,
    });
  }

  public async getCollections(): Promise<MaintainerrCollection[]> {
    try {
      // Try the dedicated overlay-data endpoint first (Maintainerr >= 3.4.0)
      const response = await this.axios.get<MaintainerrCollection[]>(
        '/api/collections/overlay-data'
      );
      return response.data;
    } catch (e) {
      // Fall back to the legacy endpoint (Maintainerr <= 3.3.x)
      if (axios.isAxiosError(e) && e.response?.status === 404) {
        logger.info(
          'overlay-data endpoint not available, falling back to /api/collections',
          { label: 'Maintainerr API' }
        );
        try {
          const response = await this.axios.get<MaintainerrCollection[]>(
            '/api/collections'
          );
          return response.data;
        } catch (fallbackErr) {
          logger.error(
            'Something went wrong fetching Maintainerr collections',
            {
              label: 'Maintainerr API',
              errorMessage: fallbackErr.message,
            }
          );
          throw fallbackErr;
        }
      }
      logger.error('Something went wrong fetching Maintainerr collections', {
        label: 'Maintainerr API',
        errorMessage: e.message,
      });
      throw e;
    }
  }
}

export default MaintainerrAPI;
