import { calculateTextLayout } from '@app/components/PosterEditor/TextElement';
import { fontLoader } from '@app/utils/fontLoader';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Group, Rect, Text } from 'react-konva';
import type { OverlayElement, OverlayTextElementProps } from './types';

interface TextElementComponentProps {
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

export const TextElement: React.FC<TextElementComponentProps> = ({
  element,
  isSelected,
  onSelect,
  onDragMove,
  onDragEnd,
  onTransformEnd,
}) => {
  const props = element.properties as OverlayTextElementProps;
  const [fontLoaded, setFontLoaded] = useState(false);

  // Load custom font if needed
  useEffect(() => {
    if (props.fontFamily && !fontLoader.isFontLoaded(props.fontFamily)) {
      fontLoader
        .waitForFont(props.fontFamily.replace(/'/g, ''), 1000)
        .then(() => setFontLoaded(true))
        .catch(() => setFontLoaded(true)); // Continue with fallback
    } else {
      setFontLoaded(true);
    }
  }, [props.fontFamily]);

  // Display text (overlays just have static text)
  const displayText = props.text || 'Sample Text';

  // Calculate text layout
  const textLayout = useMemo(() => {
    if (!fontLoaded) {
      return { finalFontSize: props.fontSize, lines: [], totalHeight: 0 };
    }

    const maxLines =
      props.maxLines || Math.floor(element.height / props.fontSize);
    return calculateTextLayout(
      displayText,
      element.width,
      element.height,
      props.fontSize,
      maxLines,
      props.fontFamily,
      props.fontWeight
    );
  }, [
    displayText,
    element.width,
    element.height,
    props.fontSize,
    props.maxLines,
    props.fontFamily,
    props.fontWeight,
    fontLoaded,
  ]);

  const lineHeight = textLayout.finalFontSize * 1.1;

  // Calculate vertical centering
  const firstLineY = (element.height - textLayout.totalHeight) / 2;

  const groupRef = useRef<Konva.Group | null>(null);

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
      opacity={(props.opacity ?? 100) / 100}
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

          // Reset scale to 1 and update width/height instead
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

      {/* Text boundary box (orange checkered border) */}
      <Rect
        width={element.width}
        height={element.height}
        fill="transparent"
        stroke={isSelected ? '#ff6b35' : 'transparent'}
        strokeWidth={2}
        dash={[5, 5]}
        listening={false}
      />

      {/* Render text lines */}
      {fontLoaded &&
        textLayout.lines.map((line, index) => {
          // Konva expects fontStyle to include bold (e.g., "bold", "italic", "bold italic")
          const fontStyle =
            props.fontWeight === 'bold'
              ? props.fontStyle === 'italic'
                ? 'bold italic'
                : 'bold'
              : props.fontStyle;

          return (
            <Text
              key={`line-${index}`}
              x={0}
              y={firstLineY + index * lineHeight}
              text={line}
              fontSize={textLayout.finalFontSize}
              fontFamily={props.fontFamily}
              fontStyle={fontStyle}
              fill={props.color}
              align={props.textAlign}
              width={element.width}
              listening={false}
            />
          );
        })}
    </Group>
  );
};
