import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { useMemo, useRef } from 'react';
import { Group, Rect } from 'react-konva';
import type {
  ContentGridProps,
  LayeredElement,
  PreviewCollectionConfig,
} from './PosterEditorModal';

interface ContentGridElementProps {
  element: LayeredElement;
  previewCollectionConfig?: PreviewCollectionConfig;
  isSelected: boolean;
  onSelect: (node: Konva.Node) => void;
  onDragMove: (node: Konva.Node) => void;
  onDragEnd: (x: number, y: number) => void;
  onTransformEnd: (
    x: number,
    y: number,
    width: number,
    height: number,
    rotation: number
  ) => void;
}

export const ContentGridElement: React.FC<ContentGridElementProps> = ({
  element,
  previewCollectionConfig,
  isSelected,
  onSelect,
  onDragMove,
  onDragEnd,
  onTransformEnd,
}) => {
  const props = element.properties as ContentGridProps;
  const groupRef = useRef<Konva.Group | null>(null);

  // Calculate grid cells
  const gridCells = useMemo(() => {
    const availableWidth = element.width - (props.columns - 1) * props.spacing;
    const cellWidth = availableWidth / props.columns;
    const cellHeight = cellWidth * 1.5; // 2:3 aspect ratio for posters

    const cells: { x: number; y: number; width: number; height: number }[] = [];

    for (let row = 0; row < props.rows; row++) {
      for (let col = 0; col < props.columns; col++) {
        cells.push({
          x: col * (cellWidth + props.spacing),
          y: row * (cellHeight + props.spacing),
          width: cellWidth,
          height: cellHeight,
        });
      }
    }

    return { cells, cellWidth, cellHeight };
  }, [element.width, props.columns, props.rows, props.spacing]);

  // Use different styling when preview collection is available
  const isPreviewMode = !!previewCollectionConfig?.name;

  return (
    <Group
      ref={groupRef}
      id={element.id}
      x={element.x + element.width / 2}
      y={element.y + element.height / 2}
      offsetX={element.width / 2}
      offsetY={element.height / 2}
      width={element.width}
      height={element.height}
      rotation={element.rotation || 0}
      draggable
      onClick={() => {
        if (groupRef.current) {
          onSelect(groupRef.current);
        }
      }}
      onTap={() => {
        if (groupRef.current) {
          onSelect(groupRef.current);
        }
      }}
      onDragMove={() => {
        if (groupRef.current) {
          onDragMove(groupRef.current);
        }
      }}
      onDragEnd={(e: KonvaEventObject<DragEvent>) => {
        const node = e.target;
        onDragEnd(node.x() - element.width / 2, node.y() - element.height / 2);
      }}
      onTransformEnd={() => {
        const node = groupRef.current;
        if (node) {
          const scaleX = node.scaleX();
          const scaleY = node.scaleY();
          const rotation = node.rotation();

          const newWidth = Math.round(element.width * scaleX);
          const newHeight = Math.round(element.height * scaleY);

          node.scaleX(1);
          node.scaleY(1);

          onTransformEnd(
            node.x() - newWidth / 2,
            node.y() - newHeight / 2,
            newWidth,
            newHeight,
            rotation
          );
        }
      }}
    >
      {/* Hit area - nearly transparent rect to make entire bounding box clickable */}
      <Rect
        width={element.width}
        height={element.height}
        fill="rgba(0,0,0,0.01)"
        listening={true}
      />

      {/* Render grid cells */}
      {gridCells.cells.map((cell, index) => (
        <Rect
          key={`cell-${index}`}
          x={cell.x}
          y={cell.y}
          width={cell.width}
          height={cell.height}
          fill={isPreviewMode ? '#2563eb' : '#374151'}
          stroke={isPreviewMode ? '#3b82f6' : '#6b7280'}
          strokeWidth={1}
          cornerRadius={props.cornerRadius}
          listening={false}
        />
      ))}

      {/* Selection border */}
      {isSelected && (
        <Rect
          width={element.width}
          height={element.height}
          fill="transparent"
          stroke="#ff6b35"
          strokeWidth={2}
          dash={[5, 5]}
          listening={false}
        />
      )}
    </Group>
  );
};
