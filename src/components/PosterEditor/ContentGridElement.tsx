import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Circle, Group, Image, Rect } from 'react-konva';
import type {
  ContentGridProps,
  LayeredElement,
  PreviewCollectionConfig,
} from './PosterEditorModal';

// Pulsating dots loading indicator
const LoadingDots: React.FC<{
  x: number;
  y: number;
  dotSize: number;
}> = ({ x, y, dotSize }) => {
  const [activeDot, setActiveDot] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveDot((prev) => (prev + 1) % 3);
    }, 300);
    return () => clearInterval(interval);
  }, []);

  const spacing = dotSize * 2.5;
  const startX = x - spacing;

  return (
    <>
      {[0, 1, 2].map((i) => (
        <Circle
          key={i}
          x={startX + i * spacing}
          y={y}
          radius={dotSize}
          fill={activeDot === i ? '#d1d5db' : '#6b7280'}
          listening={false}
        />
      ))}
    </>
  );
};

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
  const [loadedImages, setLoadedImages] = useState<(HTMLImageElement | null)[]>(
    []
  );
  const [isLoading, setIsLoading] = useState(false);

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

  // Load poster images when posterUrls change
  const posterUrls = useMemo(
    () => previewCollectionConfig?.posterUrls || [],
    [previewCollectionConfig?.posterUrls]
  );
  useEffect(() => {
    if (posterUrls.length === 0) {
      setLoadedImages([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const images: (HTMLImageElement | null)[] = new Array(
      posterUrls.length
    ).fill(null);
    let loadedCount = 0;

    posterUrls.forEach((url, index) => {
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        images[index] = img;
        loadedCount++;
        // Update state when all images are loaded or on each load for progressive display
        setLoadedImages([...images]);
        if (loadedCount === posterUrls.length) {
          setIsLoading(false);
        }
      };
      img.onerror = () => {
        images[index] = null;
        loadedCount++;
        setLoadedImages([...images]);
        if (loadedCount === posterUrls.length) {
          setIsLoading(false);
        }
      };
      img.src = url;
    });

    return () => {
      // Cleanup - cancel image loads
      images.forEach((img) => {
        if (img) {
          img.onload = null;
          img.onerror = null;
        }
      });
    };
  }, [posterUrls]);

  // Check if we have any loaded images
  const hasImages = loadedImages.some((img) => img !== null);

  // Show loading if: fetching poster URLs OR loading images
  const isPreviewSelected = !!previewCollectionConfig?.name;
  const showLoading =
    isPreviewSelected && (isLoading || posterUrls.length === 0);

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
      {gridCells.cells.map((cell, index) => {
        const image = loadedImages[index];

        if (image && hasImages) {
          // Calculate scale to fill the cell while maintaining aspect ratio
          const scale = Math.max(
            cell.width / image.width,
            cell.height / image.height
          );
          const scaledWidth = image.width * scale;
          const scaledHeight = image.height * scale;
          // Center the image in the cell
          const offsetX = (scaledWidth - cell.width) / 2;
          const offsetY = (scaledHeight - cell.height) / 2;

          return (
            <Group key={`cell-${index}`} x={cell.x} y={cell.y}>
              {/* Clip group to cell bounds */}
              <Group
                clipX={0}
                clipY={0}
                clipWidth={cell.width}
                clipHeight={cell.height}
              >
                <Image
                  image={image}
                  x={-offsetX}
                  y={-offsetY}
                  width={scaledWidth}
                  height={scaledHeight}
                  listening={false}
                />
              </Group>
              {/* Border overlay */}
              <Rect
                width={cell.width}
                height={cell.height}
                fill="transparent"
                stroke="#6b7280"
                strokeWidth={1}
                cornerRadius={props.cornerRadius}
                listening={false}
              />
            </Group>
          );
        }

        // Show loading indicator or grey placeholder
        const cellCenterX = cell.x + cell.width / 2;
        const cellCenterY = cell.y + cell.height / 2;
        const dotSize = Math.min(cell.width, cell.height) * 0.03;

        return (
          <Group key={`cell-${index}`}>
            {/* Grey background */}
            <Rect
              x={cell.x}
              y={cell.y}
              width={cell.width}
              height={cell.height}
              fill="#374151"
              stroke="#6b7280"
              strokeWidth={1}
              cornerRadius={props.cornerRadius}
              listening={false}
            />
            {/* Loading dots - show when fetching URLs or loading images */}
            {showLoading && (
              <LoadingDots x={cellCenterX} y={cellCenterY} dotSize={dotSize} />
            )}
          </Group>
        );
      })}

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
