import CollectionSettings from '@app/components/Collections/Views/CollectionSettings';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import type { CollectionFormConfig, Library } from '@app/types/collections';
import type { PlexSettings } from '@server/lib/settings';
import type React from 'react';
import { useMemo } from 'react';
import useSWR from 'swr';
import LibraryReorderingContext from './LibraryReorderingContext';

interface LibraryCollectionsViewProps {
  /**
   * Optional libraries prop for testing or custom data
   */
  libraries?: Library[];
}

/**
 * Library Collections View Component
 *
 * Specialized component for managing Library collections.
 * This component encapsulates the data fetching and state management
 * specific to the Library collections context.
 *
 * Features:
 * - Optimized for Library collection management
 * - Handles data fetching and revalidation automatically
 * - Pre-configured with Library-specific filter settings
 * - Can be extended with Library-specific functionality (e.g., library grouping, media type filtering)
 */
const LibraryCollectionsView: React.FC<LibraryCollectionsViewProps> = ({
  libraries: librariesProp,
}) => {
  // Data fetching with SWR for automatic caching and revalidation
  const { data: plexSettings } = useSWR<PlexSettings>('/api/v1/settings/plex');
  const { data: plexLibraries = [] } = useSWR(
    librariesProp ? null : '/api/v1/settings/plex/libraries'
  );

  const libraries = librariesProp || plexLibraries;

  // Transform collection configs for frontend use
  const collectionConfigs = useMemo(() => {
    if (!plexSettings?.collectionConfigs) return [];
    return plexSettings.collectionConfigs.map(
      (config) => ({ ...config } as CollectionFormConfig)
    );
  }, [plexSettings?.collectionConfigs]);

  // Extract hub configs for reordering context
  const hubConfigs = useMemo(() => {
    return plexSettings?.hubConfigs || [];
  }, [plexSettings?.hubConfigs]);

  // Simple callback for CollectionSettings to notify of config updates
  // (This is used for local state synchronization, actual saving is handled by CollectionSettings)
  const handleUpdateConfigs = () => {
    // Just a callback for state sync - CollectionSettings handles the actual API calls
    // SWR revalidation will update the data automatically
  };

  // Loading state
  if (!plexSettings || !libraries) {
    return <LoadingSpinner />;
  }

  return (
    <LibraryReorderingContext
      collectionConfigs={collectionConfigs}
      hubConfigs={hubConfigs}
      libraries={libraries}
    >
      <CollectionSettings
        libraries={libraries}
        onUpdateConfigs={handleUpdateConfigs}
        filterTab="library"
      />
    </LibraryReorderingContext>
  );
};

export default LibraryCollectionsView;
