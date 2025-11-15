import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { Box } from 'konva/lib/shapes/Transformer';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { Layer, Stage, Transformer } from 'react-konva';
import { Background } from './Background';
import { ContentGridElement } from './ContentGridElement';
import { ImageElement } from './ImageElement';
import type {
  EditorMode,
  LayeredElement,
  PosterEditorData,
} from './PosterEditorModal';
import { SVGElement } from './SVGElement';
import { TextElement } from './TextElement';
import { SnapLines, useSnapToGuides } from './useSnapToGuides';

export interface PosterCanvasRef {
  exportAsImage: () => Promise<string>;
}

interface PosterCanvasProps {
  posterData: PosterEditorData;
  onChange: (data: PosterEditorData) => void;
  previewCollectionConfig?: {
    name: string;
    type?: string;
    mediaType?: 'movie' | 'tv';
  };
  mode?: EditorMode;
  currentlyEditingSource?: string;
  snapToGuides?: boolean;
  selectedElementId?: string;
  onElementSelect?: (elementId: string | undefined) => void;
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
  aspectRatioLocked?: Record<string, boolean>;
}

export const PosterCanvas = forwardRef<PosterCanvasRef, PosterCanvasProps>(
  function PosterCanvas(
    {
      posterData,
      onChange,
      previewCollectionConfig,
      currentlyEditingSource,
      snapToGuides = false,
      selectedElementId,
      onElementSelect,
      sourceColorsData,
      aspectRatioLocked = {},
    },
    ref
  ) {
    const stageRef = useRef<Konva.Stage>(null);
    const transformerRef = useRef<Konva.Transformer>(null);
    const [selectedShapeRef, setSelectedShapeRef] = useState<Konva.Node | null>(
      null
    );

    // Snap-to-guides functionality
    const { snapLines, calculateSnap, clearSnapLines, updateSnapLines } =
      useSnapToGuides(posterData.width, posterData.height, snapToGuides);

    // Scale to fit container while maintaining aspect ratio
    const containerWidth = 500;
    const containerHeight = 600;
    const bufferSize = 40;
    const availableWidth = containerWidth - bufferSize * 2;
    const availableHeight = containerHeight - bufferSize * 2;

    const scaleX = availableWidth / posterData.width;
    const scaleY = availableHeight / posterData.height;
    const scale = Math.min(scaleX, scaleY, 1);

    const displayWidth = posterData.width * scale;
    const displayHeight = posterData.height * scale;

    // Sort elements by layer order for rendering
    const sortedElements = [...posterData.elements].sort(
      (a, b) => a.layerOrder - b.layerOrder
    );

    // Handle element selection
    const handleSelect = useCallback(
      (elementId: string, shapeNode: Konva.Node) => {
        setSelectedShapeRef(shapeNode);
        // Notify parent of selection change
        if (onElementSelect) {
          onElementSelect(elementId);
        }
      },
      [onElementSelect]
    );

    // Handle element drag move (for snapping)
    const handleDragMove = useCallback(
      (node: Konva.Node) => {
        if (!snapToGuides) return;

        const stage = node.getStage();
        if (!stage) return;

        const allNodes = stage
          .find('Group')
          .filter((n: Konva.Node) => n !== node && n.id());
        const snapResult = calculateSnap(node, allNodes);

        // Apply snap position
        node.position({
          x: snapResult.x,
          y: snapResult.y,
        });

        // Update snap lines
        updateSnapLines(snapResult.snapLines);
      },
      [snapToGuides, calculateSnap, updateSnapLines]
    );

    // Handle element drag end
    const handleDragEnd = useCallback(
      (elementId: string, x: number, y: number) => {
        const updatedElements = posterData.elements.map((el) =>
          el.id === elementId ? { ...el, x, y } : el
        );
        onChange({ ...posterData, elements: updatedElements });

        // Clear snap lines
        clearSnapLines();
      },
      [posterData, onChange, clearSnapLines]
    );

    // Handle element transform end
    const handleTransformEnd = useCallback(
      (
        elementId: string,
        x: number,
        y: number,
        width: number,
        height: number
      ) => {
        const updatedElements = posterData.elements.map((el) =>
          el.id === elementId ? { ...el, x, y, width, height } : el
        );
        onChange({ ...posterData, elements: updatedElements });
      },
      [posterData, onChange]
    );

    // Update transformer when selection changes
    useEffect(() => {
      if (transformerRef.current && selectedShapeRef) {
        transformerRef.current.nodes([selectedShapeRef]);

        // Configure aspect ratio locking
        const elementId = selectedShapeRef.id();
        const shouldLockAspectRatio = aspectRatioLocked[elementId] ?? true;

        transformerRef.current.keepRatio(shouldLockAspectRatio);
        transformerRef.current.getLayer()?.batchDraw();
      }
    }, [selectedShapeRef, aspectRatioLocked]);

    // Expose export method via ref
    useImperativeHandle(
      ref,
      () => ({
        exportAsImage: async () => {
          if (!stageRef.current) {
            throw new Error('Stage not initialized');
          }

          try {
            const dataURL = stageRef.current.toDataURL({
              pixelRatio: 2, // Higher resolution export (2x)
            });

            return dataURL;
          } catch (error) {
            throw new Error('Failed to export canvas as image');
          }
        },
      }),
      []
    );

    // Render element based on type
    const renderElement = (element: LayeredElement) => {
      const isSelected = element.id === selectedElementId;
      const shapeProps = {
        key: element.id,
        element,
        previewCollectionConfig,
        isSelected,
        onSelect: (node: Konva.Node) => handleSelect(element.id, node),
        onDragMove: handleDragMove,
        onDragEnd: (x: number, y: number) => handleDragEnd(element.id, x, y),
        onTransformEnd: (x: number, y: number, width: number, height: number) =>
          handleTransformEnd(element.id, x, y, width, height),
      };

      switch (element.type) {
        case 'text':
          return <TextElement {...shapeProps} />;
        case 'raster':
          return <ImageElement {...shapeProps} />;
        case 'svg':
          return <SVGElement {...shapeProps} />;
        case 'content-grid':
          return <ContentGridElement {...shapeProps} />;
        default:
          return null;
      }
    };

    return (
      <div className="flex h-full w-full items-center justify-center p-4">
        <div
          className="relative overflow-hidden border-2 border-stone-600 shadow-lg"
          style={{
            width: `${displayWidth}px`,
            height: `${displayHeight}px`,
          }}
        >
          <Stage
            ref={stageRef}
            width={posterData.width}
            height={posterData.height}
            scaleX={scale}
            scaleY={scale}
            onClick={(e: KonvaEventObject<MouseEvent>) => {
              // Deselect when clicking on empty area
              if (e.target === e.target.getStage()) {
                setSelectedShapeRef(null);
                if (onElementSelect) {
                  onElementSelect(undefined);
                }
              }
            }}
          >
            <Layer>
              {/* Background */}
              <Background
                posterData={posterData}
                currentlyEditingSource={currentlyEditingSource}
                previewCollectionConfig={previewCollectionConfig}
                sourceColorsData={sourceColorsData}
              />

              {/* Elements sorted by layer order */}
              {sortedElements.map(renderElement)}

              {/* Snap-to-guide lines */}
              <SnapLines
                lines={snapLines}
                canvasWidth={posterData.width}
                canvasHeight={posterData.height}
              />

              {/* Transformer for selected element */}
              <Transformer
                ref={transformerRef}
                boundBoxFunc={(oldBox: Box, newBox: Box) => {
                  // Prevent element from being resized too small
                  if (newBox.width < 10 || newBox.height < 10) {
                    return oldBox;
                  }
                  return newBox;
                }}
              />
            </Layer>
          </Stage>
        </div>
      </div>
    );
  }
);
