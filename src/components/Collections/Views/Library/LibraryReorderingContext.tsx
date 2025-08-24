import type { CollectionFormConfig, Library } from '@app/types/collections';
import type { PlexHubConfig } from '@server/lib/settings';
import type React from 'react';

interface LibraryReorderingContextProps {
  collectionConfigs: CollectionFormConfig[];
  hubConfigs: PlexHubConfig[];
  libraries: Library[];
  children: React.ReactNode;
}

/**
 * Library Collections Reordering Context
 *
 * Simple wrapper that provides Library-specific reordering behavior.
 * This context ensures Library screen collections use the 'library' context
 * for the shared reordering system.
 */
export const LibraryReorderingContext: React.FC<
  LibraryReorderingContextProps
> = ({ children }) => {
  // Note: The actual reordering logic is handled by CollectionSettings
  // using the shared useCollectionReordering hook with activeTab context.
  // This wrapper exists for future Library-specific enhancements if needed.

  return <div className="library-reordering-context">{children}</div>;
};

export default LibraryReorderingContext;
