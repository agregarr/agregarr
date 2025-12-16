import { useCanvasHandlers } from '@app/components/PosterEditor/PosterCanvas';
import {
  SnapLines,
  useSnapToGuides,
} from '@app/components/PosterEditor/useSnapToGuides';
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
import { Layer, Rect, Stage, Transformer } from 'react-konva';
import { RasterElement } from './RasterElement';
import { SVGElement } from './SVGElement';
import { TextElement } from './TextElement';
import { TileElement } from './TileElement';
import type {
  OverlayElement,
  OverlayRenderContext,
  OverlayTemplateData,
} from './types';
import { VariableElement } from './VariableElement';

export interface OverlayCanvasRef {
  exportAsImage: () => Promise<string>;
}

interface OverlayCanvasProps {
  overlayData: OverlayTemplateData;
  onChange: (data: OverlayTemplateData) => void;
  renderContext?: OverlayRenderContext;
  snapToGuides?: boolean;
  selectedElementId?: string;
  onElementSelect?: (elementId: string | undefined) => void;
  aspectRatioLocked?: Record<string, boolean>;
  backgroundImageUrl?: string;
  previewOverlays?: OverlayTemplateData[]; // Other overlays to preview alongside current
}

export const OverlayCanvas = forwardRef<OverlayCanvasRef, OverlayCanvasProps>(
  function OverlayCanvas(
    {
      overlayData,
      onChange,
      renderContext,
      snapToGuides = false,
      selectedElementId,
      onElementSelect,
      aspectRatioLocked = {},
      backgroundImageUrl,
      previewOverlays = [],
    },
    ref
  ) {
    // Get elements directly from overlayData
    const elements = overlayData.elements;

    const stageRef = useRef<Konva.Stage>(null);
    const transformerRef = useRef<Konva.Transformer>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [backgroundImage, setBackgroundImage] =
      useState<HTMLImageElement | null>(null);
    const [containerSize, setContainerSize] = useState({
      width: 500,
      height: 600,
    });
    const [showTransformer, setShowTransformer] = useState(true);

    // Measure container size
    useEffect(() => {
      const updateSize = () => {
        if (containerRef.current) {
          setContainerSize({
            width: containerRef.current.clientWidth,
            height: containerRef.current.clientHeight,
          });
        }
      };
      updateSize();
      window.addEventListener('resize', updateSize);
      return () => window.removeEventListener('resize', updateSize);
    }, []);

    // Snap-to-guides functionality
    const { snapLines, calculateSnap, clearSnapLines, updateSnapLines } =
      useSnapToGuides(overlayData.width, overlayData.height, snapToGuides);

    // Helper to update elements
    const updateElements = useCallback(
      (newElements: OverlayElement[]) => {
        onChange({
          ...overlayData,
          elements: newElements,
        });
      },
      [overlayData, onChange]
    );

    // Use shared canvas handlers
    const {
      selectedShapeRef,
      handleSelect,
      handleDragMove,
      handleDragEnd,
      handleTransformEnd,
    } = useCanvasHandlers(
      elements,
      updateElements,
      snapToGuides,
      calculateSnap,
      updateSnapLines,
      clearSnapLines,
      onElementSelect
    );

    // Load background image (preview poster)
    useEffect(() => {
      if (backgroundImageUrl) {
        const img = new window.Image();
        img.crossOrigin = 'anonymous';
        img.src = backgroundImageUrl;
        img.onload = () => setBackgroundImage(img);
        img.onerror = () => setBackgroundImage(null);
      } else {
        setBackgroundImage(null);
      }
    }, [backgroundImageUrl]);

    // Scale to fit container while maintaining aspect ratio
    const containerWidth = containerSize.width;
    const containerHeight = containerSize.height;
    const bufferSize = 20;
    const availableWidth = containerWidth - bufferSize * 2;
    const availableHeight = containerHeight - bufferSize * 2;

    const scaleX = availableWidth / overlayData.width;
    const scaleY = availableHeight / overlayData.height;
    const scale = Math.min(scaleX, scaleY, 1);

    const displayWidth = overlayData.width * scale;
    const displayHeight = overlayData.height * scale;

    // Sort elements by layer order for rendering
    const sortedElements = [...elements].sort(
      (a, b) => a.layerOrder - b.layerOrder
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
    const renderElement = (element: OverlayElement) => {
      const isSelected = element.id === selectedElementId;
      const shapeProps = {
        key: element.id,
        element,
        isSelected,
        onSelect: (node: Konva.Node) => {
          handleSelect(element.id, node);
          setShowTransformer(true); // Show transformer when element is clicked
        },
        onDragMove: handleDragMove,
        onDragEnd: (x: number, y: number) => handleDragEnd(element.id, x, y),
        onTransformEnd: (
          x: number,
          y: number,
          width: number,
          height: number,
          rotation: number
        ) => handleTransformEnd(element.id, x, y, width, height, rotation),
      };

      switch (element.type) {
        case 'text':
          return <TextElement {...shapeProps} />;
        case 'tile':
          return <TileElement {...shapeProps} />;
        case 'variable':
          return (
            <VariableElement {...shapeProps} renderContext={renderContext} />
          );
        case 'raster':
          return <RasterElement {...shapeProps} />;
        case 'svg':
          return <SVGElement {...shapeProps} />;
        default:
          return null;
      }
    };

    // Render preview overlay element (non-interactive, for previewing other overlays)
    const renderPreviewElement = (
      element: OverlayElement,
      overlayIndex: number
    ) => {
      // No-op functions for non-interactive preview elements
      const noop = () => undefined;
      const previewProps = {
        key: `preview-${overlayIndex}-${element.id}`,
        element: { ...element, id: `preview-${overlayIndex}-${element.id}` },
        isSelected: false,
        onSelect: noop,
        onDragMove: noop,
        onDragEnd: noop,
        onTransformEnd: noop,
      };

      switch (element.type) {
        case 'text':
          return <TextElement {...previewProps} />;
        case 'tile':
          return <TileElement {...previewProps} />;
        case 'variable':
          return (
            <VariableElement {...previewProps} renderContext={renderContext} />
          );
        case 'raster':
          return <RasterElement {...previewProps} />;
        case 'svg':
          return <SVGElement {...previewProps} />;
        default:
          return null;
      }
    };

    return (
      <div
        ref={containerRef}
        className="flex h-full w-full items-center justify-center"
      >
        <div
          className="relative overflow-hidden border-2 border-stone-600 shadow-lg"
          style={{
            width: `${displayWidth}px`,
            height: `${displayHeight}px`,
          }}
        >
          <Stage
            ref={stageRef}
            width={overlayData.width}
            height={overlayData.height}
            scaleX={scale}
            scaleY={scale}
            onClick={(e: KonvaEventObject<MouseEvent>) => {
              // Hide transformer when clicking on empty area
              const clickedOnStage = e.target === e.currentTarget;
              if (clickedOnStage) {
                setShowTransformer(false);
              }
            }}
          >
            <Layer>
              {/* Background - preview poster or checkerboard */}
              {backgroundImage ? (
                <Rect
                  x={0}
                  y={0}
                  width={overlayData.width}
                  height={overlayData.height}
                  fillPatternImage={backgroundImage}
                  fillPatternScaleX={overlayData.width / backgroundImage.width}
                  fillPatternScaleY={
                    overlayData.height / backgroundImage.height
                  }
                  listening={false}
                />
              ) : (
                <Rect
                  x={0}
                  y={0}
                  width={overlayData.width}
                  height={overlayData.height}
                  fill="#1a1a1a"
                  listening={false}
                />
              )}

              {/* Preview overlays (rendered first, non-interactive) */}
              {previewOverlays.map((overlay, overlayIndex) => {
                const sortedPreviewElements = [...overlay.elements].sort(
                  (a, b) => a.layerOrder - b.layerOrder
                );
                return sortedPreviewElements.map((element) =>
                  renderPreviewElement(element, overlayIndex)
                );
              })}

              {/* Elements sorted by layer order */}
              {sortedElements.map(renderElement)}

              {/* Snap-to-guide lines */}
              <SnapLines
                lines={snapLines}
                canvasWidth={overlayData.width}
                canvasHeight={overlayData.height}
              />

              {/* Transformer for selected element */}
              {showTransformer && (
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
              )}
            </Layer>
          </Stage>
        </div>
      </div>
    );
  }
);
