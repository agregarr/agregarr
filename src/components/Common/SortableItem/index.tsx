import { generateCollectionDragId } from '@app/components/Common/ReorderingSystem';
import type { CollectionFormConfig } from '@app/types/collections';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Bars3Icon } from '@heroicons/react/24/solid';
import type React from 'react';

interface SortableCollectionItemProps {
  /**
   * Collection configuration for this item
   */
  config: CollectionFormConfig;

  /**
   * Content to render inside the sortable item
   */
  children: React.ReactNode;

  /**
   * Optional CSS classes for styling
   */
  className?: string;

  /**
   * Whether to show the drag handle
   */
  showDragHandle?: boolean;

  /**
   * Position of the drag handle
   */
  dragHandlePosition?: 'left' | 'right';
}

/**
 * Sortable Collection Item Component
 *
 * A wrapper component that makes any collection item sortable within
 * the CollectionReorderingSystem. Provides drag handle and visual feedback.
 *
 * Features:
 * - Drag and drop functionality using @dnd-kit/sortable
 * - Visual feedback during drag operations
 * - Configurable drag handle position
 * - Accessible drag handle with keyboard support
 * - Consistent drag ID generation
 *
 * Usage:
 * ```tsx
 * <SortableCollectionItem config={collection}>
 *   <div>Your collection content here</div>
 * </SortableCollectionItem>
 * ```
 */
export const SortableCollectionItem: React.FC<SortableCollectionItemProps> = ({
  config,
  children,
  className = '',
  showDragHandle = true,
  dragHandlePosition = 'left',
}) => {
  const dragId = generateCollectionDragId(config);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: dragId });

  const style = {
    transform: CSS.Transform.toString(transform),
    // Only apply transition when not dragging to avoid snap effect on drop
    transition: isDragging ? 'none' : transition,
  };

  const dragHandleProps = showDragHandle
    ? {
        ...attributes,
        ...listeners,
      }
    : {};

  const DragHandle = showDragHandle ? (
    <div
      {...dragHandleProps}
      className="cursor-grab p-1 text-gray-400 transition-colors hover:text-white active:cursor-grabbing"
      aria-label="Drag to reorder"
    >
      <Bars3Icon className="h-4 w-4" />
    </div>
  ) : null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`
        ${className}
        ${isDragging ? 'z-50 opacity-50' : ''}
        ${isDragging ? 'transform-gpu' : ''}
      `}
    >
      <div
        className={`flex items-center ${
          dragHandlePosition === 'right' ? 'flex-row-reverse' : ''
        }`}
      >
        {DragHandle}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
};

export default SortableCollectionItem;
