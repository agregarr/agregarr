import type {
  CollectionFormConfig,
  PlexHubConfig,
  PreExistingCollectionConfig,
} from '@app/types/collections';
import axios from 'axios';
import type { AddToast } from 'react-toast-notifications';

interface DiscoverPlexHubsParams {
  localCollectionConfigs: CollectionFormConfig[];
  localHubConfigs: PlexHubConfig[];
  localPreExistingConfigs: PreExistingCollectionConfig[];
  setLocalCollectionConfigs: (configs: CollectionFormConfig[]) => void;
  setLocalHubConfigs: (configs: PlexHubConfig[]) => void;
  setLocalPreExistingConfigs: (configs: PreExistingCollectionConfig[]) => void;
  setDiscoveringHubs: (discovering: boolean) => void;
  revalidateAll: () => void;
  addToast: AddToast;
}

export const discoverPlexHubs = async (params: DiscoverPlexHubsParams) => {
  const {
    localCollectionConfigs,
    localHubConfigs,
    localPreExistingConfigs,
    setLocalCollectionConfigs,
    setLocalHubConfigs,
    setLocalPreExistingConfigs,
    setDiscoveringHubs,
    revalidateAll,
    addToast,
  } = params;

  setDiscoveringHubs(true);
  try {
    // First sync libraries to ensure they're up to date
    await axios.get('/api/v1/settings/plex/library', {
      params: { sync: true },
    });

    // Then discover hubs and collections
    // Use unified discovery endpoint for cross-type detection and conflict resolution
    const response = await axios.get('/api/v1/discovery/hubs/scan');
    const {
      discoveredHubConfigs,
      discoveredPreExistingConfigs,
      validationResults,
    } = response.data;

    // Apply validation results to mark missing collections
    if (validationResults) {
      // Mark missing collections
      const updatedCollections = localCollectionConfigs.map((config) => ({
        ...config,
        missing:
          validationResults.missingCollections?.includes(config.id) || false,
      }));
      setLocalCollectionConfigs(updatedCollections);

      // Mark missing hubs
      const updatedHubs = localHubConfigs.map((config) => ({
        ...config,
        missing: validationResults.missingHubs?.includes(config.id) || false,
      }));
      setLocalHubConfigs(updatedHubs);

      // Mark missing pre-existing collections
      const updatedPreExisting = localPreExistingConfigs.map((config) => ({
        ...config,
        missing:
          validationResults.missingPreExisting?.includes(config.id) || false,
      }));
      setLocalPreExistingConfigs(updatedPreExisting);

      // Log validation results
      const totalMissing =
        (validationResults.missingCollections?.length || 0) +
        (validationResults.missingHubs?.length || 0) +
        (validationResults.missingPreExisting?.length || 0);
      if (totalMissing > 0) {
        addToast(
          `Validation complete: ${totalMissing} missing collection${
            totalMissing !== 1 ? 's' : ''
          } detected`,
          {
            autoDismiss: true,
            appearance: 'warning',
          }
        );
      }
    }

    // Combine both arrays for processing
    const allDiscoveredConfigs = [
      ...(discoveredHubConfigs || []),
      ...(discoveredPreExistingConfigs || []),
    ];

    if (allDiscoveredConfigs.length === 0) {
      // No new hubs found, but still need to refresh UI for any updates to existing configs
      revalidateAll();

      // Check if there are existing configs already - if so, everything is already imported
      const totalExistingConfigs =
        (validationResults?.hubsValidated || 0) +
        (validationResults?.preExistingValidated || 0);

      if (totalExistingConfigs > 0) {
        // There are existing configs, so everything is already imported
        const existingHubs = validationResults?.hubsValidated || 0;
        const existingPreExisting =
          validationResults?.preExistingValidated || 0;
        addToast(
          `All ${totalExistingConfigs} Plex ${
            totalExistingConfigs === 1
              ? 'hub/collection has'
              : 'hubs/collections have'
          } already been imported! (${existingHubs} ${
            existingHubs === 1 ? 'hub' : 'hubs'
          }, ${existingPreExisting} ${
            existingPreExisting === 1 ? 'collection' : 'collections'
          })`,
          {
            autoDismiss: true,
            appearance: 'success',
          }
        );
      } else {
        // No existing configs and nothing discovered - truly nothing found
        addToast('No Plex hubs found to import.', {
          autoDismiss: true,
          appearance: 'info',
        });
      }
      return;
    }

    // Backend has already saved the discovered configs (updateSettings: true)
    // Just revalidate to get the fresh data and show success
    revalidateAll();

    // Calculate summary for comprehensive results
    const hubsFound = discoveredHubConfigs?.length || 0;
    const collectionsFound = discoveredPreExistingConfigs?.length || 0;
    const totalFound = allDiscoveredConfigs.length;

    // Calculate total counts (existing + new)
    const totalHubs = (validationResults?.hubsValidated || 0) + hubsFound;
    const totalCollections =
      (validationResults?.preExistingValidated || 0) + collectionsFound;

    addToast(
      `Imported ${totalFound} new ${
        totalFound === 1 ? 'hub/collection' : 'hubs/collections'
      }! (${hubsFound} ${
        hubsFound === 1 ? 'hub' : 'hubs'
      }, ${collectionsFound} ${
        collectionsFound === 1 ? 'collection' : 'collections'
      }, total: ${totalHubs} ${
        totalHubs === 1 ? 'hub' : 'hubs'
      }, ${totalCollections} ${
        totalCollections === 1 ? 'collection' : 'collections'
      })`,
      {
        autoDismiss: true,
        appearance: 'success',
      }
    );
  } catch (error) {
    addToast(
      'Failed to discover Plex hubs. Please check your Plex connection.',
      {
        autoDismiss: true,
        appearance: 'error',
      }
    );
  } finally {
    setDiscoveringHubs(false);
  }
};
