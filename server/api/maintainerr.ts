import type { MaintainerrSettings } from '@server/lib/settings';
import logger from '@server/logger';
import type { AxiosInstance } from 'axios';
import axios from 'axios';

export interface MaintainerrMedia {
  id: number;
  collectionId: number;
  plexId: number;
  tmdbId: number;
  addDate: string; // ISO 8601 date string
  image_path: string;
  isManual: boolean;
}

export interface MaintainerrCollection {
  id: number;
  plexId: number;
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
      const response = await this.axios.get<MaintainerrCollection[]>(
        '/api/collections'
      );
      return response.data;
    } catch (e) {
      logger.error('Something went wrong fetching Maintainerr collections', {
        label: 'Maintainerr API',
        errorMessage: e.message,
      });
      throw e;
    }
  }
}

export default MaintainerrAPI;
