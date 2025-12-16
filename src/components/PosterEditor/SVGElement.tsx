import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { useEffect, useRef, useState } from 'react';
import { Group, Image, Rect } from 'react-konva';
import type {
  LayeredElement,
  PreviewCollectionConfig,
  SVGElementProps as SVGProps,
} from './PosterEditorModal';

interface SVGElementComponentProps {
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

export const SVGElement: React.FC<SVGElementComponentProps> = ({
  element,
  previewCollectionConfig,
  isSelected,
  onSelect,
  onDragMove,
  onDragEnd,
  onTransformEnd,
}) => {
  const props = element.properties as SVGProps;
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const groupRef = useRef<Konva.Group | null>(null);

  // Determine SVG path
  const svgPath =
    props.iconType === 'source-logo'
      ? previewCollectionConfig?.type
        ? `/services/${previewCollectionConfig.type}.svg`
        : '/services/os_icon.svg' // Agregarr logo as placeholder
      : props.iconPath || '';

  // Load SVG as image
  useEffect(() => {
    if (!svgPath || svgPath.trim() === '') {
      setImage(null);
      return;
    }

    const img = new window.Image();
    img.onload = () => {
      setImage(img);
    };
    img.onerror = () => {
      setImage(null);
    };
    img.src = svgPath;

    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [svgPath]);

  if (!image) {
    // Show placeholder rectangle while loading
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
          onDragEnd(
            node.x() - element.width / 2,
            node.y() - element.height / 2
          );
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

  // Calculate scale to fit HEIGHT (matching server-side logic for SVG logos)
  // Server scales to match height exactly, letting width adjust to maintain aspect ratio
  const scale = element.height / image.height;

  // Calculate scaled dimensions and centering offset (matching server-side logic)
  const scaledWidth = image.width * scale;
  const scaledHeight = image.height * scale;
  const offsetX = (element.width - scaledWidth) / 2;
  const offsetY = (element.height - scaledHeight) / 2;

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
