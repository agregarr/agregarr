import type {
  CollectionFormConfig,
  PlexHubConfig,
  PreExistingCollectionConfig,
} from '@app/types/collections';
import { CollectionType } from '@app/types/collections';
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
    const librariesResponse = await axios.get('/api/v1/settings/plex/library', {
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

      addToast('No Plex hubs found to import.', {
        autoDismiss: true,
        appearance: 'info',
      });
      return;
    }

    // Get existing hub configurations from separate APIs
    const [existingHubsResponse, existingPreExistingResponse] =
      await Promise.all([
        axios.get('/api/v1/defaulthubs'),
        axios.get('/api/v1/preexisting'),
      ]);
    const existingHubConfigs = existingHubsResponse.data || [];
    const existingPreExistingConfigs = existingPreExistingResponse.data || [];

    // Filter out hubs that are already configured using the proper hub ID format
    const existingHubIds = new Set(
      existingHubConfigs.map((hub: PlexHubConfig) => hub.id)
    );
    const existingPreExistingIds = new Set(
      existingPreExistingConfigs.map(
        (hub: PreExistingCollectionConfig) => hub.id
      )
    );

    const newHubs = (discoveredHubConfigs || []).filter(
      (hub: PlexHubConfig) => !existingHubIds.has(hub.id)
    );

    const newPreExistingCollections = (
      discoveredPreExistingConfigs || []
    ).filter(
      (hub: PreExistingCollectionConfig) => !existingPreExistingIds.has(hub.id)
    );

    if (newHubs.length === 0 && newPreExistingCollections.length === 0) {
      // No new configs to add, but still need to refresh UI for any updates to existing configs
      revalidateAll();

      addToast('All available Plex hubs are already configured.', {
        autoDismiss: true,
        appearance: 'info',
      });
      return;
    }

    // Use discovery APIs for new configurations with proper timing
    const discoveryPromises = [];

    if (newHubs.length > 0) {
      discoveryPromises.push(
        axios.post('/api/v1/defaulthubs/discover', {
          hubConfigs: newHubs,
        })
      );
    }

    if (newPreExistingCollections.length > 0) {
      discoveryPromises.push(
        axios.post('/api/v1/preexisting/discover', {
          preExistingCollectionConfigs: newPreExistingCollections,
        })
      );
    }

    // Wait for all discovery operations to complete with 10 second timeout
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Discovery timeout')), 10000)
    );

    try {
      await Promise.race([Promise.all(discoveryPromises), timeoutPromise]);
    } catch (error) {
      if (error instanceof Error && error.message === 'Discovery timeout') {
        // Discovery timed out, proceed with refresh anyway
      } else {
        throw error; // Re-throw other errors
      }
    }

    // Wait a bit more to ensure backend processing is complete
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Now revalidate to get the fresh data
    revalidateAll();

    // Calculate summary for comprehensive results
    const libraries = librariesResponse.data || [];

    // Show comprehensive results
    const totalHubs = allDiscoveredConfigs.filter(
      (c: PlexHubConfig) => c.collectionType === CollectionType.DEFAULT_PLEX_HUB
    ).length;
    const totalCollections = allDiscoveredConfigs.filter(
      (c: PlexHubConfig) => c.collectionType !== CollectionType.DEFAULT_PLEX_HUB
    ).length;
    const totalNewConfigs = newHubs.length + newPreExistingCollections.length;

    addToast(
      `Discovery complete! Synced ${libraries.length} libraries and imported ${totalNewConfigs} new configurations (${totalHubs} hubs, ${totalCollections} collections).`,
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
