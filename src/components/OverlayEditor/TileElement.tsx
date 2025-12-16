import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { useRef } from 'react';
import { Group, Rect } from 'react-konva';
import type { OverlayElement, OverlayTileElementProps } from './types';

interface TileElementComponentProps {
  element: OverlayElement;
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

export const TileElement: React.FC<TileElementComponentProps> = ({
  element,
  isSelected,
  onSelect,
  onDragMove,
  onDragEnd,
  onTransformEnd,
}) => {
  const props = element.properties as OverlayTileElementProps;
  const groupRef = useRef<Konva.Group | null>(null);

  // Determine corner radii (with backward compatibility)
  let cornerRadius: number | number[];

  if (props.lockCorners || props.borderRadius !== undefined) {
    // Locked mode or legacy - all corners same
    const radius = props.borderRadiusTopLeft ?? props.borderRadius ?? 0;
    cornerRadius = radius;
  } else {
    // Unlocked mode - individual corners [top-left, top-right, bottom-right, bottom-left]
    cornerRadius = [
      props.borderRadiusTopLeft ?? 0,
      props.borderRadiusTopRight ?? 0,
      props.borderRadiusBottomRight ?? 0,
      props.borderRadiusBottomLeft ?? 0,
    ];
  }

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
      {/* Main tile rectangle */}
      <Rect
        width={element.width}
        height={element.height}
        fill={props.fillColor}
        opacity={props.fillOpacity / 100}
        stroke={props.borderColor}
        strokeWidth={props.borderWidth || 0}
        cornerRadius={cornerRadius}
        listening={false}
      />

      {/* Selection indicator */}
      {isSelected && (
        <Rect
          width={element.width}
          height={element.height}
          fill="transparent"
          stroke="#ff6b35"
          strokeWidth={2}
          cornerRadius={cornerRadius}
          listening={false}
        />
      )}

      {/* Hit area for interaction */}
      <Rect
        width={element.width}
        height={element.height}
        fill="rgba(0,0,0,0.01)"
        listening={true}
      />
    </Group>
  );
};
