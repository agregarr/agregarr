import { useMemo } from 'react';
import { Rect, Text } from 'react-konva';
import type {
  PosterEditorData,
  PreviewCollectionConfig,
} from './PosterEditorModal';

interface BackgroundProps {
  posterData: PosterEditorData;
  currentlyEditingSource?: string;
  previewCollectionConfig?: PreviewCollectionConfig;
  sourceColorsData?: {
    sourceColors: Record<
      string,
      {
        primaryColor: string;
        secondaryColor: string;
        textColor: string;
      }
    >;
    sourceTypes: string[];
  };
}

export const Background: React.FC<BackgroundProps> = ({
  posterData,
  currentlyEditingSource,
  previewCollectionConfig,
  sourceColorsData,
}) => {
  // Determine colors to use - priority: currently editing source > selected preview collection > defaults
  const { primaryColor, secondaryColor, showPlaceholder } = useMemo(() => {
    let primary = posterData.background.color || '#6366f1';
    let secondary = posterData.background.secondaryColor || '#1e1b4b';
    let placeholder = false;

    if (posterData.background.useSourceColors) {
      const sourceToPreview =
        currentlyEditingSource || previewCollectionConfig?.type;

      if (sourceToPreview) {
        // Priority 1: Use local unsaved changes if they exist
        if (posterData.background.sourceColors?.[sourceToPreview]) {
          const localColors =
            posterData.background.sourceColors[sourceToPreview];
          primary = localColors.primaryColor || primary;
          secondary = localColors.secondaryColor || secondary;
        }
        // Priority 2: Fall back to saved colors from database
        else if (sourceColorsData?.sourceColors?.[sourceToPreview]) {
          const sourceColors = sourceColorsData.sourceColors[sourceToPreview];
          primary = sourceColors.primaryColor || primary;
          secondary = sourceColors.secondaryColor || secondary;
        }
      } else {
        // Show placeholder when using source colors but not customizing AND no preview collection selected
        placeholder = true;
      }
    }

    return {
      primaryColor: primary,
      secondaryColor: secondary,
      showPlaceholder: placeholder,
    };
  }, [
    posterData.background,
    currentlyEditingSource,
    previewCollectionConfig?.type,
    sourceColorsData,
  ]);

  // Generate gradient fill pattern
  const fillPattern = useMemo(() => {
    if (posterData.background.type === 'gradient') {
      const intensity = (posterData.background.intensity || 50) / 100;
      const centerPoint = 0.5 - intensity * 0.3;

      // Linear gradient
      return {
        fillLinearGradientStartPoint: { x: 0, y: 0 },
        fillLinearGradientEndPoint: { x: 0, y: posterData.height },
        fillLinearGradientColorStops: [
          0,
          secondaryColor,
          centerPoint,
          primaryColor,
          1 - centerPoint,
          primaryColor,
          1,
          secondaryColor,
        ],
      };
    } else if (posterData.background.type === 'radial') {
      const intensity = (posterData.background.intensity || 50) / 100;
      const radius =
        Math.max(posterData.width, posterData.height) * (0.3 + intensity * 0.7);

      // Radial gradient
      return {
        fillRadialGradientStartPoint: {
          x: posterData.width / 2,
          y: posterData.height / 2,
        },
        fillRadialGradientEndPoint: {
          x: posterData.width / 2,
          y: posterData.height / 2,
        },
        fillRadialGradientStartRadius: 0,
        fillRadialGradientEndRadius: radius,
        fillRadialGradientColorStops: [0, primaryColor, 1, secondaryColor],
      };
    }

    // Solid color
    return {
      fill: primaryColor,
    };
  }, [
    posterData.background.type,
    posterData.background.intensity,
    posterData.width,
    posterData.height,
    primaryColor,
    secondaryColor,
  ]);

  // "Source Colours" placeholder text elements
  const placeholderElements = useMemo(() => {
    if (!showPlaceholder) return [];

    const elements: {
      x: number;
      y: number;
      text: string;
    }[] = [];
    const spacing = 120;

    for (let x = 0; x < posterData.width; x += spacing) {
      for (let y = 0; y < posterData.height; y += spacing) {
        elements.push({
          x: x + spacing / 2,
          y: y + spacing / 2,
          text: 'Source Colours',
        });
      }
    }

    return elements;
  }, [showPlaceholder, posterData.width, posterData.height]);

  return (
    <>
      {/* Background rectangle */}
      {showPlaceholder ? (
        <Rect
          x={0}
          y={0}
          width={posterData.width}
          height={posterData.height}
          fill="#374151"
        />
      ) : (
        <Rect
          x={0}
          y={0}
          width={posterData.width}
          height={posterData.height}
          {...fillPattern}
        />
      )}

      {/* Placeholder overlay text */}
      {showPlaceholder &&
        placeholderElements.map((element, index) => (
          <Text
            key={`placeholder-${index}`}
            x={element.x}
            y={element.y}
            text={element.text}
            fontSize={24}
            fontFamily="Arial, sans-serif"
            fill="#6b7280"
            opacity={0.15}
            offsetX={60} // Center horizontally (approx half of text width)
            offsetY={12} // Center vertically (approx half of text height)
            rotation={-25}
            listening={false} // Don't capture events
          />
        ))}
    </>
  );
};
