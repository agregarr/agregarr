import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { useEffect, useRef, useState } from 'react';
import { Group, Image, Rect } from 'react-konva';
import type { LayeredElement, RasterElementProps } from './PosterEditorModal';

interface ImageElementProps {
  element: LayeredElement;
  isSelected: boolean;
  onSelect: (node: Konva.Node) => void;
  onDragMove: (node: Konva.Node) => void;
  onDragEnd: (x: number, y: number) => void;
  onTransformEnd: (x: number, y: number, width: number, height: number) => void;
}

export const ImageElement: React.FC<ImageElementProps> = ({
  element,
  isSelected,
  onSelect,
  onDragMove,
  onDragEnd,
  onTransformEnd,
}) => {
  const props = element.properties as RasterElementProps;
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const groupRef = useRef<Konva.Group | null>(null);

  // Load image
  useEffect(() => {
    if (!props.imagePath || props.imagePath.trim() === '') {
      setImage(null);
      return;
    }

    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      setImage(img);
    };
    img.onerror = () => {
      setImage(null);
    };
    img.src = props.imagePath;

    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [props.imagePath]);

  if (!image) {
    // Show placeholder rectangle while loading
    return (
      <Group
        ref={groupRef}
        id={element.id}
        x={element.x}
        y={element.y}
        width={element.width}
        height={element.height}
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
          onDragEnd(node.x(), node.y());
        }}
      >
        {/* Hit area for loading state */}
        <Rect
          width={element.width}
          height={element.height}
          fill="rgba(0,0,0,0.01)"
          listening={true}
        />
        <Rect
          width={element.width}
          height={element.height}
          fill="#374151"
          stroke={isSelected ? '#ff6b35' : '#6b7280'}
          strokeWidth={2}
          listening={false}
        />
      </Group>
    );
  }

  // Calculate scale to fit image within bounds (matching server-side logic)
  const scale = Math.min(
    element.width / image.width,
    element.height / image.height
  );

  // Calculate scaled dimensions and centering offset (matching server-side logic)
  const scaledWidth = image.width * scale;
  const scaledHeight = image.height * scale;
  const offsetX = (element.width - scaledWidth) / 2;
  const offsetY = (element.height - scaledHeight) / 2;

  return (
    <Group
      ref={groupRef}
      id={element.id}
      x={element.x}
      y={element.y}
      width={element.width}
      height={element.height}
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
        onDragEnd(node.x(), node.y());
      }}
      onTransformEnd={() => {
        const node = groupRef.current;
        if (node) {
          const scaleX = node.scaleX();
          const scaleY = node.scaleY();

          node.scaleX(1);
          node.scaleY(1);

          onTransformEnd(
            node.x(),
            node.y(),
            Math.round(element.width * scaleX),
            Math.round(element.height * scaleY)
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

      <Image
        image={image}
        x={offsetX}
        y={offsetY}
        width={image.width}
        height={image.height}
        scaleX={scale}
        scaleY={scale}
        listening={false}
      />
      {isSelected && (
        <Rect
          width={element.width}
          height={element.height}
          fill="transparent"
          stroke="#ff6b35"
          strokeWidth={2}
          listening={false}
        />
      )}
    </Group>
  );
};
