import type { CollectionFormConfig, Library } from '@app/types/collections';
import type { PlexHubConfig } from '@server/lib/settings';
import type React from 'react';

interface HomeReorderingContextProps {
  collectionConfigs: CollectionFormConfig[];
  hubConfigs: PlexHubConfig[];
  libraries: Library[];
  children: React.ReactNode;
}

/**
 * Home Collections Reordering Context
 *
 * Simple wrapper that provides Home-specific reordering behavior.
 * This context ensures Home screen collections use the 'home' context
 * for the shared reordering system.
 */
export const HomeReorderingContext: React.FC<HomeReorderingContextProps> = ({
  children,
}) => {
  // Note: The actual reordering logic is handled by CollectionSettings
  // using the shared useCollectionReordering hook with activeTab context.
  // This wrapper exists for future Home-specific enhancements if needed.

  return <div className="home-reordering-context">{children}</div>;
};

export default HomeReorderingContext;
