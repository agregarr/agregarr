import type {
  CollectionFormConfig,
  PlexHubConfig,
  PreExistingCollectionConfig,
} from '@app/types/collections';
import { toCollectionCreateRequest } from '@app/types/collections';
import { prepareLinkedConfigForEditing } from '@app/utils/collections/collectionUtils';
import axios from 'axios';
import { useState } from 'react';
import { useToasts } from 'react-toast-notifications';
import useSWR from 'swr';

/**
 * Shared hook for collection editing functionality
 * Used by both CollectionSettings and AllCollectionsView
 */
export const useCollectionEdit = () => {
  const { addToast } = useToasts();
  const { data: collectionData, mutate: revalidateCollections } = useSWR(
    '/api/v1/collections'
  );
  const { data: hubConfigs, mutate: revalidateDefaultHubs } = useSWR(
    '/api/v1/defaulthubs'
  );
  const { mutate: revalidatePreExisting } = useSWR('/api/v1/preexisting');

  // Form state
  const [showConfigForm, setShowConfigForm] = useState(false);
  const [editingConfig, setEditingConfig] =
    useState<CollectionFormConfig | null>(null);

  // Combined revalidation function
  const revalidateAll = () => {
    revalidateCollections();
    revalidateDefaultHubs();
    revalidatePreExisting();
  };

  const openEditModal = (config: CollectionFormConfig) => {
    if (!config) {
      return;
    }

    // Check if this is a hub config
    if (config.configType === 'hub') {
      // Use unified linking logic for hubs
      const hubConfigsArray = hubConfigs || [];
      const configToEdit = prepareLinkedConfigForEditing(
        config,
        hubConfigsArray
      );

      // Mark the config with its type for the form to render appropriately
      const hubConfig = {
        ...configToEdit,
        // Backend properties are already present on config object
      };
      setEditingConfig(hubConfig);
      setShowConfigForm(true);
      return;
    }

    // Regular collection editing - use unified linking logic
    const collectionConfigsArray = collectionData?.collectionConfigs || [];
    const configToEdit = prepareLinkedConfigForEditing(
      config,
      collectionConfigsArray
    );

    setEditingConfig(configToEdit);
    setShowConfigForm(true);
  };

  const saveCollectionConfig = async (
    config: CollectionFormConfig | PlexHubConfig | PreExistingCollectionConfig
  ) => {
    // Handle hub configs separately
    if ((config as CollectionFormConfig).configType === 'hub') {
      // Cast to CollectionFormConfig since form converts everything to this format
      const hubConfig = config as CollectionFormConfig;
      try {
        // Check if this is a linked hub (affects multiple libraries)
        const isLinked = Boolean(hubConfig.isLinked);

        if (isLinked && hubConfig.linkId) {
          // Update all hubs in the same link group
          const updatedHubConfigs = [...(hubConfigs || [])];

          // Find and update all hubs with the same linkId
          const linkedHubIndices = updatedHubConfigs
            .map((h, index) => ({ hub: h, index }))
            .filter(
              ({ hub }) => hub.linkId === hubConfig.linkId && hub.isLinked
            )
            .map(({ index }) => index);

          linkedHubIndices.forEach((hubIndex) => {
            // Convert back to individual hub config format
            updatedHubConfigs[hubIndex] = {
              ...updatedHubConfigs[hubIndex],
              name: hubConfig.name,
              visibilityConfig: hubConfig.visibilityConfig,
              // Keep existing linking properties
              isLinked: true,
              linkId: hubConfig.linkId,
              // Preserve individual library info
            };
          });

          // Update each linked hub using individual settings API
          for (const hubIndex of linkedHubIndices) {
            const hubConfig = updatedHubConfigs[hubIndex];
            await axios.put(
              `/api/v1/defaulthubs/${hubConfig.id}/settings`,
              hubConfig
            );
          }

          addToast(
            `Linked hub configuration saved successfully across ${
              hubConfig.libraryIds?.length || 0
            } libraries!`,
            {
              appearance: 'success',
              autoDismiss: true,
            }
          );
        } else {
          // Single hub update
          const updatedHubConfigs = (hubConfigs || []).map((h: PlexHubConfig) =>
            h.id === config.id
              ? {
                  ...h,
                  name: config.name,
                  visibilityConfig: config.visibilityConfig,
                }
              : h
          );

          // Find existing hub config
          const existingHubIndex = updatedHubConfigs.findIndex(
            (h: PlexHubConfig) => h.id === hubConfig.id
          );
          if (existingHubIndex >= 0) {
            // Convert back to hub config format
            updatedHubConfigs[existingHubIndex] = {
              hubIdentifier: hubConfig.subtype,
              name: hubConfig.name,
              libraryId: hubConfig.libraryId,
              libraryName: hubConfig.libraryName,
              mediaType:
                hubConfig.mediaType === 'movie'
                  ? 'movie'
                  : hubConfig.mediaType === 'tv'
                  ? 'tv'
                  : 'both',
              sortOrderHome: hubConfig.sortOrderHome || 1,
              sortOrderLibrary: hubConfig.sortOrderLibrary,
              visibilityConfig: hubConfig.visibilityConfig,
              isDefaultPlexHub: hubConfig.isDefaultPlexHub,
              isAgregarrManaged: hubConfig.isAgregarrManaged,
              isPromotedToHub: hubConfig.isPromotedToHub,
            };

            // Update single hub using individual settings API
            await axios.put(
              `/api/v1/defaulthubs/${updatedHubConfigs[existingHubIndex].id}/settings`,
              updatedHubConfigs[existingHubIndex]
            );

            addToast('Hub configuration saved successfully!', {
              appearance: 'success',
              autoDismiss: true,
            });
          }
        }

        await revalidateAll();
      } catch (error) {
        addToast('Failed to save hub configuration', {
          appearance: 'error',
          autoDismiss: true,
        });
      }
    } else {
      // Handle regular collection configs (and pre-existing that don't have hub routing)
      // Cast to CollectionFormConfig since we're in the collection handling branch
      const collectionConfig = config as CollectionFormConfig;
      try {
        if (!collectionData) {
          throw new Error('Collection data is not available');
        }
        const currentConfigs = (collectionData.collectionConfigs || []).map(
          (c: Partial<CollectionFormConfig>) =>
            ({ ...c } as CollectionFormConfig)
        );

        // Use individual settings API for single collection updates, or create API for new collections
        if (
          collectionConfig.id &&
          currentConfigs.find(
            (c: CollectionFormConfig) => c.id === collectionConfig.id
          )
        ) {
          // Update existing collection using individual settings API
          await axios.put(
            `/api/v1/collections/${collectionConfig.id}/settings`,
            collectionConfig
          );
        } else {
          // Create new collection using create API with clean request type
          const createRequest = toCollectionCreateRequest(collectionConfig);
          await axios.post('/api/v1/collections/create', createRequest);
        }

        await revalidateCollections();
        addToast('Collection configuration saved successfully!', {
          appearance: 'success',
          autoDismiss: true,
        });
      } catch (error) {
        addToast('Failed to save collection configuration', {
          appearance: 'error',
          autoDismiss: true,
        });
      }
    }

    // Close the form
    closeEditModal();
  };

  const deleteCollectionConfig = async (configId: string) => {
    try {
      // Use individual DELETE endpoint - handles linked collections and sort order automatically
      const response = await axios.delete(`/api/v1/collections/${configId}`);

      if (response.status === 200) {
        addToast('Collection deleted successfully!', {
          appearance: 'success',
          autoDismiss: true,
        });
        revalidateCollections(); // Revalidate SWR cache
      }
    } catch (error) {
      addToast('Failed to delete collection.', {
        appearance: 'error',
        autoDismiss: true,
      });
      throw error;
    }
  };

  const closeEditModal = () => {
    setShowConfigForm(false);
    setEditingConfig(null);
  };

  return {
    // State
    showConfigForm,
    editingConfig,

    // Actions
    openEditModal,
    closeEditModal,
    saveCollectionConfig,
    deleteCollectionConfig,
  };
};
