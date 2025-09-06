/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import type { EditorMode, PosterEditorData } from './PosterEditorModal';

// Dynamic import for Fabric.js to avoid SSR issues
let fabric: any = null;
if (typeof window !== 'undefined') {
  import('fabric').then((fabricModule: any) => {
    fabric = fabricModule.fabric;
  });
}

export interface PosterEditorCanvasRef {
  exportAsImage: () => Promise<string>;
}

interface PosterEditorCanvasProps {
  posterData: PosterEditorData;
  onChange: (data: PosterEditorData) => void;
  previewCollectionConfig?: {
    name: string;
    type?: string;
    mediaType?: 'movie' | 'tv';
  };
  mode?: EditorMode; // Made optional since it's not currently used
}

export const PosterEditorCanvas = forwardRef<
  PosterEditorCanvasRef,
  PosterEditorCanvasProps
>(function PosterEditorCanvas(
  { posterData, onChange, previewCollectionConfig },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricCanvasRef = useRef<any>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const updateTimeoutRef = useRef<NodeJS.Timeout>();

  // Debounced update for smooth dragging
  const debouncedUpdatePosterData = useCallback(() => {
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current);
    }

    updateTimeoutRef.current = setTimeout(() => {
      if (!fabricCanvasRef.current) return;

      const canvas = fabricCanvasRef.current;
      const objects = canvas.getObjects();

      const textElements: PosterEditorData['textElements'] = [];
      const iconElements: PosterEditorData['iconElements'] = [];

      objects.forEach((obj: any) => {
        if (obj.type === 'textbox' || obj.type === 'text') {
          const textElement = {
            id: obj.id || `text-${Date.now()}`,
            type: (obj.elementType === 'collection-title'
              ? 'collection-title'
              : 'custom-text') as 'collection-title' | 'custom-text',
            text: obj.text,
            x: obj.left || 0,
            y: obj.top || 0,
            width: obj.width || 100,
            height: obj.height || 40,
            fontSize: obj.fontSize || 16,
            fontFamily: obj.fontFamily || 'Arial, sans-serif',
            fontWeight: (obj.fontWeight || 'normal') as 'normal' | 'bold',
            fontStyle: (obj.fontStyle || 'normal') as 'normal' | 'italic',
            color: obj.fill || '#ffffff',
            textAlign: (obj.textAlign || 'center') as
              | 'left'
              | 'center'
              | 'right',
            maxLines: 1,
          };
          textElements.push(textElement);
        } else if (obj.elementType === 'icon') {
          const iconElement = {
            id: obj.id || `icon-${Date.now()}`,
            type: (obj.iconType || 'custom-icon') as
              | 'source-logo'
              | 'custom-icon',
            iconPath: obj.iconPath || '',
            x: obj.left || 0,
            y: obj.top || 0,
            width: obj.width || 50,
            height: obj.height || 50,
            grayscale: obj.grayscale || false,
          };
          iconElements.push(iconElement);
        }
      });

      const updatedData: PosterEditorData = {
        ...posterData,
        textElements,
        iconElements,
      };

      onChange(updatedData);
    }, 100); // Short debounce for smooth dragging
  }, [posterData, onChange]);

  // Scale to fit container while maintaining aspect ratio
  const containerWidth = 500; // Fixed container width
  const containerHeight = 600; // Fixed container height
  const availableWidth = containerWidth;
  const availableHeight = containerHeight;

  const scaleX = availableWidth / posterData.width;
  const scaleY = availableHeight / posterData.height;
  const scale = Math.min(scaleX, scaleY, 1);

  // Initialize Fabric.js canvas
  useEffect(() => {
    if (!canvasRef.current || !fabric || isInitialized) return;

    const canvas = new fabric.Canvas(canvasRef.current, {
      width: posterData.width,
      height: posterData.height,
      backgroundColor: 'transparent', // We'll handle background in render effect
      selection: true,
      preserveObjectStacking: true,
    });

    fabricCanvasRef.current = canvas;
    setIsInitialized(true);

    // Handle object modifications
    const handleObjectModified = () => {
      debouncedUpdatePosterData();
    };

    const handleObjectMoving = () => {
      debouncedUpdatePosterData();
    };

    const handleObjectScaling = () => {
      debouncedUpdatePosterData();
    };

    canvas.on('object:modified', handleObjectModified);
    canvas.on('object:moving', handleObjectMoving);
    canvas.on('object:scaling', handleObjectScaling);

    return () => {
      canvas.dispose();
      fabricCanvasRef.current = null;
      setIsInitialized(false);
    };
  }, [
    posterData.width,
    posterData.height,
    debouncedUpdatePosterData,
    isInitialized,
  ]);

  // Render canvas content based on poster data
  useEffect(() => {
    if (!fabricCanvasRef.current || !fabric || !isInitialized) return;

    const canvas = fabricCanvasRef.current;

    // Clear existing objects first
    canvas.clear();

    // Update canvas background after clearing
    if (posterData.background.type === 'gradient' && fabric) {
      const gradient = new fabric.Gradient({
        type: 'linear',
        coords: { x1: 0, y1: 0, x2: 0, y2: posterData.height },
        colorStops: [
          { offset: 0, color: posterData.background.color || '#6366f1' },
          { offset: 0.4, color: posterData.background.color || '#6366f1' },
          {
            offset: 1,
            color: posterData.background.secondaryColor || '#1e1b4b',
          },
        ],
      });
      canvas.setBackgroundColor(gradient, canvas.renderAll.bind(canvas));
    } else {
      canvas.setBackgroundColor(
        posterData.background.color || '#6366f1',
        canvas.renderAll.bind(canvas)
      );
    }

    // Add text elements
    posterData.textElements.forEach((textElement) => {
      if (!fabric) return;

      const text =
        textElement.type === 'collection-title'
          ? previewCollectionConfig?.name || 'Sample Collection'
          : textElement.text || 'Sample Text';

      const textObj = new fabric.Textbox(text, {
        left: textElement.x,
        top: textElement.y,
        width: textElement.width,
        height: textElement.height,
        fontSize: textElement.fontSize,
        fontFamily: textElement.fontFamily,
        fontWeight: textElement.fontWeight,
        fontStyle: textElement.fontStyle,
        fill: textElement.color,
        textAlign: textElement.textAlign,
        cornerSize: 8,
        transparentCorners: false,
      });

      // Add custom properties for tracking
      textObj.id = textElement.id;
      textObj.elementType = textElement.type;
      textObj.maxLines = textElement.maxLines;

      canvas.add(textObj);
    });

    // Add icon elements
    posterData.iconElements.forEach((iconElement) => {
      if (!fabric) return;

      // If this is a source-logo and we have preview collection config, load the actual service icon FOR VISUALIZATION
      if (iconElement.type === 'source-logo' && previewCollectionConfig?.type) {
        const serviceIconPath = `/services/${previewCollectionConfig.type}.svg`;

        fabric.loadSVGFromURL(
          serviceIconPath,
          (objects: any, options: any) => {
            if (!objects || objects.length === 0) {
              return;
            }
            const svgObject = fabric.util.groupSVGElements(objects, options);

            // Position and size
            svgObject.set({
              left: iconElement.x,
              top: iconElement.y,
              scaleX: iconElement.width / (svgObject.width || 1),
              scaleY: iconElement.height / (svgObject.height || 1),
              cornerSize: 8,
              transparentCorners: false,
            });

            // Apply grayscale filter if needed
            if (iconElement.grayscale) {
              svgObject.filters = [new fabric.Image.filters.Grayscale()];
              svgObject.applyFilters();
            }

            // Add custom properties for tracking
            svgObject.id = iconElement.id;
            svgObject.elementType = 'icon';
            svgObject.iconPath = serviceIconPath;
            svgObject.grayscale = iconElement.grayscale;

            canvas.add(svgObject);
            canvas.renderAll();
          },
          (item: any, object: any) => {
            // This callback is called for each SVG element
            // We can modify individual elements here if needed
            object.set('fill', iconElement.grayscale ? '#666666' : object.fill);
          }
        );
      } else {
        // For custom icons or when no preview is available, show a placeholder
        const rect = new fabric.Rect({
          left: iconElement.x,
          top: iconElement.y,
          width: iconElement.width,
          height: iconElement.height,
          fill: iconElement.grayscale ? '#666666' : '#cccccc',
          stroke: '#999999',
          strokeWidth: 2,
          rx: 4,
          ry: 4,
          cornerSize: 8,
          transparentCorners: false,
        });

        // Add custom properties for tracking
        rect.id = iconElement.id;
        rect.elementType = 'icon';
        rect.iconPath = iconElement.iconPath;
        rect.grayscale = iconElement.grayscale;

        canvas.add(rect);
      }
    });

    // Add content grid placeholder if exists
    if (posterData.contentGrid && fabric) {
      const grid = posterData.contentGrid;
      const cellWidth =
        (grid.width - (grid.columns - 1) * grid.spacing) / grid.columns;
      const cellHeight =
        (grid.height - (grid.rows - 1) * grid.spacing) / grid.rows;

      for (let row = 0; row < grid.rows; row++) {
        for (let col = 0; col < grid.columns; col++) {
          const x = grid.x + col * (cellWidth + grid.spacing);
          const y = grid.y + row * (cellHeight + grid.spacing);

          const placeholder = new fabric.Rect({
            left: x,
            top: y,
            width: cellWidth,
            height: cellHeight,
            fill: '#2d2d2d',
            stroke: '#555555',
            strokeWidth: 1,
            rx: grid.cornerRadius,
            ry: grid.cornerRadius,
            selectable: false, // Grid items aren't individually selectable
          });

          canvas.add(placeholder);
        }
      }
    }

    canvas.renderAll();
  }, [
    posterData,
    previewCollectionConfig,
    isInitialized,
    debouncedUpdatePosterData,
  ]);

  // Expose methods via ref
  useImperativeHandle(
    ref,
    () => ({
      exportAsImage: async () => {
        if (!fabricCanvasRef.current) {
          throw new Error('Canvas not initialized');
        }

        try {
          const dataURL = fabricCanvasRef.current.toDataURL({
            format: 'png',
            quality: 1,
            multiplier: 2, // Higher resolution export
          });

          return dataURL;
        } catch (error) {
          throw new Error('Failed to export canvas as image');
        }
      },
    }),
    []
  );

  if (!fabric || !isInitialized) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="text-white">Loading editor...</div>
      </div>
    );
  }

  const displayWidth = posterData.width * scale;
  const displayHeight = posterData.height * scale;

  return (
    <div className="flex h-full w-full items-center justify-center p-4">
      <div
        className="relative overflow-hidden border-2 border-stone-600 shadow-lg"
        style={{
          width: `${displayWidth}px`,
          height: `${displayHeight}px`,
        }}
      >
        <canvas
          ref={canvasRef}
          className="block"
          style={{
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            width: `${posterData.width}px`,
            height: `${posterData.height}px`,
          }}
        />
      </div>
    </div>
  );
});
