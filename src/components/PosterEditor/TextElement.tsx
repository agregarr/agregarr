import { fontLoader } from '@app/utils/fontLoader';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Group, Rect, Text } from 'react-konva';
import type {
  LayeredElement,
  TextElementProps as TextProps,
} from './PosterEditorModal';

interface TextElementComponentProps {
  element: LayeredElement;
  previewCollectionConfig?: {
    name: string;
    type?: string;
    mediaType?: 'movie' | 'tv';
  };
  isSelected: boolean;
  onSelect: (node: Konva.Node) => void;
  onDragMove: (node: Konva.Node) => void;
  onDragEnd: (x: number, y: number) => void;
  onTransformEnd: (x: number, y: number, width: number, height: number) => void;
}

// Text width calculation (mirrors server-side logic)
function getTextWidth(
  text: string,
  fontSize: number,
  fontFamily = 'Arial',
  fontWeight = 'normal'
): number {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (ctx) {
      const quotedFontFamily = fontFamily.includes(' ')
        ? `'${fontFamily}'`
        : fontFamily;
      ctx.font = `${fontWeight} ${fontSize}px ${quotedFontFamily}`;
      const metrics = ctx.measureText(text);
      return metrics.width * 1.05; // 5% safety margin
    }
  } catch (error) {
    // Fall through to estimation
  }

  // Fallback: Conservative character width estimation
  let totalWidth = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    let charWidth = 0.6;

    if (char === ' ') charWidth = 0.3;
    else if (/[.,;:!]/.test(char)) charWidth = 0.3;
    else if (/['""`]/.test(char)) charWidth = 0.25;
    else if (/[il1|]/.test(char)) charWidth = 0.3;
    else if (/[fjtI]/.test(char)) charWidth = 0.4;
    else if (/[MW@]/.test(char)) charWidth = 0.9;
    else if (/[mw]/.test(char)) charWidth = 0.8;
    else if (/[ABCDEFGHIJKLNOPQRSTUVXYZ]/.test(char)) charWidth = 0.7;
    else if (/[abcdefghknopqrsuvxyz]/.test(char)) charWidth = 0.6;
    else if (/[0-9]/.test(char)) charWidth = 0.6;
    else charWidth = 0.65;

    totalWidth += charWidth * fontSize;
  }

  return totalWidth * 1.25; // 25% safety margin
}

// Text wrapping (mirrors server-side logic)
function wrapTextKeepWords(
  text: string,
  maxWidth: number,
  fontSize: number,
  fontFamily = 'Arial',
  fontWeight = 'normal'
): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const lineWidth = getTextWidth(testLine, fontSize, fontFamily, fontWeight);

    if (lineWidth <= maxWidth) {
      currentLine = testLine;
    } else {
      if (currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = word;
      }
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [text];
}

// Get actual font metrics for precise vertical positioning (matching server-side logic)
function getFontMetrics(
  fontSize: number,
  fontFamily = 'Arial',
  fontWeight = 'normal'
): { ascent: number; descent: number; height: number } {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (ctx) {
      const quotedFontFamily = fontFamily.includes(' ')
        ? `'${fontFamily}'`
        : fontFamily;
      ctx.font = `${fontWeight} ${fontSize}px ${quotedFontFamily}`;

      // Measure a representative character to get font metrics
      const metrics = ctx.measureText('Àj'); // Character with ascender and descender

      // Extract font metrics from TextMetrics
      if (
        metrics.fontBoundingBoxAscent !== undefined &&
        metrics.fontBoundingBoxDescent !== undefined
      ) {
        return {
          ascent: metrics.fontBoundingBoxAscent,
          descent: metrics.fontBoundingBoxDescent,
          height:
            metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent,
        };
      }
    }
  } catch (error) {
    // Fall through to estimation
  }

  // Fallback: estimate from font size
  return {
    ascent: fontSize * 0.8,
    descent: fontSize * 0.2,
    height: fontSize,
  };
}

// Calculate optimal font size and text layout (matching server-side logic)
function calculateTextLayout(
  text: string,
  width: number,
  height: number,
  fontSize: number,
  maxLines: number,
  fontFamily = 'Arial',
  fontWeight = 'normal'
): { finalFontSize: number; lines: string[]; totalHeight: number } {
  let currentFontSize = fontSize;
  let lines: string[] = [];
  let limitedLines: string[] = [];
  let lineHeight: number;
  let totalTextHeight: number;

  do {
    lines = wrapTextKeepWords(
      text,
      width,
      currentFontSize,
      fontFamily,
      fontWeight
    );
    limitedLines = lines.slice(0, maxLines);
    lineHeight = currentFontSize * 1.1;

    // Calculate precise visual height using font metrics (matching server-side)
    const fontMetrics = getFontMetrics(currentFontSize, fontFamily, fontWeight);
    totalTextHeight =
      (limitedLines.length - 1) * lineHeight + fontMetrics.height;

    if (totalTextHeight <= height) {
      break;
    }

    currentFontSize *= 0.95;

    if (currentFontSize < 8) {
      break;
    }
  } while (totalTextHeight > height);

  return {
    finalFontSize: currentFontSize,
    lines: limitedLines,
    totalHeight: totalTextHeight,
  };
}

export const TextElement: React.FC<TextElementComponentProps> = ({
  element,
  previewCollectionConfig,
  isSelected,
  onSelect,
  onDragMove,
  onDragEnd,
  onTransformEnd,
}) => {
  const props = element.properties as TextProps;
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

  // Determine display text
  const displayText =
    props.elementType === 'collection-title'
      ? previewCollectionConfig?.name || 'Collection Title'
      : props.text || 'Sample Text';

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

          // Reset scale to 1 and update width/height instead
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
