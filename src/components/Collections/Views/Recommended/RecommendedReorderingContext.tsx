import type { CollectionFormConfig, Library } from '@app/types/collections';
import type { PlexHubConfig } from '@server/lib/settings';
import type React from 'react';

interface RecommendedReorderingContextProps {
  collectionConfigs: CollectionFormConfig[];
  hubConfigs: PlexHubConfig[];
  libraries: Library[];
  children: React.ReactNode;
}

/**
 * Recommended Collections Reordering Context
 *
 * Simple wrapper that provides Recommended-specific reordering behavior.
 * This context ensures Recommended screen collections use the 'recommended' context
 * for the shared reordering system.
 */
export const RecommendedReorderingContext: React.FC<
  RecommendedReorderingContextProps
> = ({ children }) => {
  // Note: The actual reordering logic is handled by CollectionSettings
  // using the shared useCollectionReordering hook with activeTab context.
  // This wrapper exists for future Recommended-specific enhancements if needed.

  return <div className="recommended-reordering-context">{children}</div>;
};

export default RecommendedReorderingContext;
