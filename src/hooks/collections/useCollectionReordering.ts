import type {
  CollectionFormConfig,
  FormConfigType,
} from '@app/types/collections';
import type {
  PlexHubConfig,
  PreExistingCollectionConfig,
} from '@server/lib/settings';
import axios from 'axios';
import { useCallback, useState } from 'react';
import { useToasts } from 'react-toast-notifications';
import useSWR from 'swr';

type MixedCollectionItem = (
  | CollectionFormConfig
  | PlexHubConfig
  | PreExistingCollectionConfig
) & {
  configType: FormConfigType;
  position: number;
};

export interface UseCollectionReorderingProps {
  /**
   * Current context for reordering (affects which sort order to update)
   */
  context: 'home' | 'recommended' | 'library';

  /**
   * Collection configurations for immediate updates
   */
  collectionConfigs: CollectionFormConfig[];

  /**
   * Hub configurations for immediate updates
   */
  hubConfigs: PlexHubConfig[];

  /**
   * Pre-existing collection configurations for immediate updates
   */
  preExistingConfigs: PreExistingCollectionConfig[];
}

export interface UseCollectionReorderingReturn {
  /**
   * TRUE unified reordering function for mixed collection lists
   */
  handleReorderItems: (
    libraryId: string,
    mixedItems: MixedCollectionItem[],
    itemTypeName: string
  ) => Promise<void>;

  /**
   * Current local state for collection configs (for immediate UI updates)
   */
  localCollectionConfigs: CollectionFormConfig[];

  /**
   * Current local state for hub configs (for immediate UI updates)
   */
  localHubConfigs: PlexHubConfig[];

  /**
   * Current local state for pre-existing configs (for immediate UI updates)
   */
  localPreExistingConfigs: PreExistingCollectionConfig[];

  /**
   * Update local collection configs state
   */
  setLocalCollectionConfigs: (configs: CollectionFormConfig[]) => void;

  /**
   * Update local hub configs state
   */
  setLocalHubConfigs: (configs: PlexHubConfig[]) => void;

  /**
   * Update local pre-existing configs state
   */
  setLocalPreExistingConfigs: (configs: PreExistingCollectionConfig[]) => void;
}

/**
 * Clean Collection Reordering Hook
 *
 * This hook provides separate reordering functions for each collection type:
 * - Collections (CollectionFormConfig)
 * - Default Hubs (PlexHubConfig)
 * - Pre-existing Collections (PreExistingCollectionConfig)
 *
 * Each type is handled independently with its own API endpoint and logic.
 * No more complex type conversion or unified handling.
 */
export const useCollectionReordering = ({
  context,
  collectionConfigs,
  hubConfigs,
  preExistingConfigs,
}: UseCollectionReorderingProps): UseCollectionReorderingReturn => {
  const { addToast } = useToasts();
  const { mutate: revalidateCollections } = useSWR('/api/v1/collections');
  const { mutate: revalidateDefaultHubs } = useSWR('/api/v1/defaulthubs');
  const { mutate: revalidatePreExisting } = useSWR('/api/v1/preexisting');

  // Local state for immediate UI updates during drag operations - each type separate
  const [localCollectionConfigs, setLocalCollectionConfigs] =
    useState<CollectionFormConfig[]>(collectionConfigs);
  const [localHubConfigs, setLocalHubConfigs] =
    useState<PlexHubConfig[]>(hubConfigs);
  const [localPreExistingConfigs, setLocalPreExistingConfigs] =
    useState<PreExistingCollectionConfig[]>(preExistingConfigs);

  /**
   * Unified reordering function for all collection types
   * This eliminates race conditions and code duplication
   */
  const handleReorderItems = useCallback(
    async (
      libraryId: string,
      mixedItems: MixedCollectionItem[],
      itemTypeName: string
    ) => {
      try {
        // Call TRUE unified reorder API
        await axios.post('/api/v1/reorder', {
          libraryId,
          mixedItems,
          context,
        });

        // Single revalidation of all data sources
        await Promise.all([
          revalidateCollections(),
          revalidateDefaultHubs(),
          revalidatePreExisting(),
        ]);

        addToast(`${itemTypeName} reordered successfully!`, {
          autoDismiss: true,
          appearance: 'success',
        });
      } catch (error) {
        // Restore original state on error
        setLocalCollectionConfigs(collectionConfigs);
        setLocalHubConfigs(hubConfigs);
        setLocalPreExistingConfigs(preExistingConfigs);

        addToast(`Failed to reorder ${itemTypeName.toLowerCase()}: ${error}`, {
          autoDismiss: true,
          appearance: 'error',
        });
      }
    },
    [
      context,
      addToast,
      revalidateCollections,
      revalidateDefaultHubs,
      revalidatePreExisting,
      collectionConfigs,
      hubConfigs,
      preExistingConfigs,
    ]
  );

  return {
    handleReorderItems,
    localCollectionConfigs,
    localHubConfigs,
    localPreExistingConfigs,
    setLocalCollectionConfigs,
    setLocalHubConfigs,
    setLocalPreExistingConfigs,
  };
};
