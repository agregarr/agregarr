import type { PlexSettings } from '@server/lib/settings';

export interface PlexStatus {
  settings: PlexSettings;
  status: number;
  message: string;
}

export interface PlexConnection {
  protocol: string;
  address: string;
  port: number;
  uri: string;
  local: boolean;
  status?: number;
  message?: string;
}

export interface PlexDevice {
  name: string;
  product: string;
  productVersion: string;
  platform: string;
  platformVersion: string;
  device: string;
  clientIdentifier: string;
  createdAt: Date;
  lastSeenAt: Date;
  provides: string[];
  owned: boolean;
  accessToken?: string;
  publicAddress?: string;
  httpsRequired?: boolean;
  synced?: boolean;
  relay?: boolean;
  dnsRebindingProtection?: boolean;
  natLoopbackSupported?: boolean;
  publicAddressMatches?: boolean;
  presence?: boolean;
  ownerID?: string;
  home?: boolean;
  sourceTitle?: string;
  connection: PlexConnection[];
}

export interface PlexHubsResponse {
  MediaContainer: {
    Hub: {
      hubKey: string;
      key: string;
      title: string;
      type: string;
      hubIdentifier: string;
      context: string;
      size: number;
      more: boolean;
      style: string;
      promoted: boolean;
      random: boolean;
      Metadata?: {
        ratingKey: string;
        key: string;
        title: string;
        type: string;
        [key: string]: unknown;
      }[];
    }[];
    size: number;
    allowSync: boolean;
    identifier: string;
    mediaTagPrefix: string;
    mediaTagVersion: number;
  };
}

// Raw Plex Hub Management API Response (based on actual logs)
export interface PlexHubManagementResponse {
  MediaContainer: {
    size: number;
    Hub: {
      identifier: string;
      title: string;
      recommendationsVisibility: 'all' | 'none';
      homeVisibility: 'all' | 'none' | 'admin';
      promotedToRecommended: boolean;
      promotedToOwnHome: boolean;
      promotedToSharedHome: boolean;
      deletable?: boolean; // Only present for custom collections
    }[];
  };
}

export interface ProcessedHubConfig {
  id: string;
  hubIdentifier: string;
  name: string;
  libraryId: string;
  libraryName: string;
  mediaType: 'movie' | 'tv' | 'both';
  isAgregarrManaged: boolean;
  isDefaultPlexHub: boolean;
  isPromotedToHub: boolean;
  sortOrderHome: number;
  sortOrderLibrary: number;
  visibilityConfig: {
    usersHome: boolean;
    serverOwnerHome: boolean;
    libraryRecommended: boolean;
  };
  isActive: boolean;
}

export interface HubDiscoveryResponse {
  success: boolean;
  discoveredConfigs: ProcessedHubConfig[];
  totalActualCollections: number;
  totalCollectionsFound: number;
  totalHubsFound: number;
}
