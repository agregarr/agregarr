import type { CollectionFormConfig } from '@app/types/collections';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import type React from 'react';

export interface ReorderingContext {
  /**
   * Current collection context (home, recommended, library)
   */
  context: 'home' | 'recommended' | 'library';

  /**
   * Array of collection configurations to reorder
   */
  collections: CollectionFormConfig[];

  /**
   * Callback when collections are reordered
   */
  onReorder: (
    libraryId: string,
    reorderedConfigs: CollectionFormConfig[]
  ) => void;

  /**
   * Whether this reordering should sync across contexts
   */
  syncAcrossContexts?: boolean;

  /**
   * Library ID for context (used for grouping and saving)
   */
  libraryId: string;
}

interface CollectionReorderingSystemProps {
  /**
   * Reordering context configuration
   */
  reorderingContext: ReorderingContext;

  /**
   * Child components that will be wrapped with drag and drop
   */
  children: React.ReactNode;
}

/**
 * Shared Collection Reordering System
 *
 * This component provides consistent drag-and-drop reordering functionality
 * across all collection contexts (Home, Recommended, Library).
 *
 * Features:
 * - Drag and drop using @dnd-kit
 * - Context-aware sort order updates (sortOrderHome vs sortOrderLibrary)
 * - Support for mixed collection types (collections, hubs, pre-existing)
 * - Consistent drag ID generation for different config types
 * - Keyboard accessibility
 *
 * Usage:
 * ```tsx
 * <CollectionReorderingSystem reorderingContext={context}>
 *   {collections.map(config => (
 *     <SortableCollectionItem key={generateDragId(config)} config={config} />
 *   ))}
 * </CollectionReorderingSystem>
 * ```
 */
export const CollectionReorderingSystem: React.FC<
  CollectionReorderingSystemProps
> = ({ reorderingContext, children }) => {
  const { context, collections, onReorder, libraryId } = reorderingContext;

  // Sensors for drag and drop interaction
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  /**
   * Generate consistent drag ID for different config types
   * This ensures proper identification during drag operations
   */
  const generateDragId = (config: CollectionFormConfig): string => {
    const isHub = config.type === 'hub';
    return isHub
      ? config.id.toString()
      : `${config.id}-${
          Array.isArray(config.libraryId)
            ? config.libraryId[0]
            : config.libraryId || 'all'
        }`;
  };

  /**
   * Handle drag end event and reorder collections
   */
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return; // No change needed
    }

    // Find old and new indices
    const oldIndex = collections.findIndex((config) => {
      return generateDragId(config) === active.id;
    });

    const newIndex = collections.findIndex((config) => {
      return generateDragId(config) === over.id;
    });

    if (oldIndex === -1 || newIndex === -1) {
      return; // Invalid indices
    }

    // Reorder the collections array
    const newConfigs = arrayMove(collections, oldIndex, newIndex);

    // Update sort orders based on context
    const updatedConfigs = newConfigs.map((config, index) => {
      if (context === 'home' || context === 'recommended') {
        return {
          ...config,
          sortOrderHome: index,
          // Preserve existing sortOrderLibrary
          sortOrderLibrary: config.sortOrderLibrary,
        };
      } else {
        return {
          ...config,
          sortOrderLibrary: index,
          // Preserve existing sortOrderHome
          sortOrderHome: config.sortOrderHome,
        };
      }
    });

    // Trigger reorder callback
    onReorder(libraryId, updatedConfigs);
  };

  // Generate drag IDs for all collections
  const dragIds = collections.map(generateDragId);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={dragIds} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
};

/**
 * Utility function to generate drag ID (exported for use in sortable items)
 */
export const generateCollectionDragId = (
  config: CollectionFormConfig
): string => {
  const isHub = config.type === 'hub';
  return isHub
    ? config.id.toString()
    : `${config.id}-${
        Array.isArray(config.libraryId)
          ? config.libraryId[0]
          : config.libraryId || 'all'
      }`;
};

export default CollectionReorderingSystem;
