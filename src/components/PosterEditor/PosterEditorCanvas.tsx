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
  currentlyEditingSource?: string; // Source type currently being edited in toolbar
  snapToGuides?: boolean; // Enable snapping to guidelines
}

export const PosterEditorCanvas = forwardRef<
  PosterEditorCanvasRef,
  PosterEditorCanvasProps
>(function PosterEditorCanvas(
  {
    posterData,
    onChange,
    previewCollectionConfig,
    currentlyEditingSource,
    snapToGuides = false,
  },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricCanvasRef = useRef<any>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const updateTimeoutRef = useRef<NodeJS.Timeout>();
  const isUserInteracting = useRef(false);

  // Debounced update for smooth dragging
  const debouncedUpdatePosterData = useCallback(() => {
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current);
    }

    updateTimeoutRef.current = setTimeout(() => {
      if (!fabricCanvasRef.current) return;

      isUserInteracting.current = true;
      const canvas = fabricCanvasRef.current;
      const objects = canvas.getObjects();

      const textElements: PosterEditorData['textElements'] = [];
      const iconElements: PosterEditorData['iconElements'] = [];
      let contentGrid: PosterEditorData['contentGrid'] = posterData.contentGrid;

      objects.forEach((obj: any) => {
        // Skip text preview objects (they have selectable: false and evented: false)
        if (
          obj.type === 'text' &&
          obj.selectable === false &&
          obj.evented === false
        ) {
          return; // Skip preview text objects
        }

        if (
          obj.type === 'rect' &&
          (obj.elementType === 'collection-title' ||
            obj.elementType === 'custom-text')
        ) {
          // Handle text area boundaries
          const textElement = {
            id: obj.id || `text-${Date.now()}`,
            type: (obj.elementType === 'collection-title'
              ? 'collection-title'
              : 'custom-text') as 'collection-title' | 'custom-text',
            text:
              obj.elementType === 'collection-title'
                ? undefined
                : 'Sample Text',
            x: obj.left || 0,
            y: obj.top || 0,
            width: Math.round((obj.width || 100) * (obj.scaleX || 1)),
            height: Math.round((obj.height || 40) * (obj.scaleY || 1)),
            fontSize: obj.fontSize || 16,
            fontFamily: obj.fontFamily || 'Arial, sans-serif',
            fontWeight: (obj.fontWeight || 'normal') as 'normal' | 'bold',
            fontStyle: (obj.fontStyle || 'normal') as 'normal' | 'italic',
            color: obj.textColor || '#ffffff',
            textAlign: 'center' as const, // Always center-aligned
            maxLines: obj.maxLines || 2,
          };
          textElements.push(textElement);
        } else if (obj.elementType === 'icon') {
          // Get the actual displayed size (including any manual scaling)
          const scaledWidth = obj.getScaledWidth();
          const scaledHeight = obj.getScaledHeight();

          const iconElement = {
            id: obj.id || `icon-${Date.now()}`,
            type: (obj.iconType || 'custom-icon') as
              | 'source-logo'
              | 'custom-icon',
            iconPath: obj.iconPath || '',
            x: obj.left || 0,
            y: obj.top || 0,
            // Use the actual scaled dimensions so sliders reflect manual resizing
            width: Math.round(scaledWidth),
            height: Math.round(scaledHeight),
          };
          iconElements.push(iconElement);
        } else if (obj.elementType === 'contentGrid') {
          // Update content grid position and size when moved/resized
          const scaledWidth = obj.getScaledWidth();
          const scaledHeight = obj.getScaledHeight();

          contentGrid = {
            ...(posterData.contentGrid || {
              id: '',
              columns: 1,
              rows: 1,
              spacing: 0,
              cornerRadius: 0,
            }),
            x: obj.left || 0,
            y: obj.top || 0,
            width: scaledWidth,
            height: scaledHeight,
          };
        }
      });

      const updatedData: PosterEditorData = {
        ...posterData,
        textElements,
        iconElements,
        contentGrid,
      };

      onChange(updatedData);

      // Reset flag after a delay to allow external updates again
      setTimeout(() => {
        isUserInteracting.current = false;
      }, 200);
    }, 100); // Short debounce for smooth dragging
  }, [posterData, onChange]);

  // Scale to fit container while maintaining aspect ratio
  const containerWidth = 500; // Fixed container width
  const containerHeight = 600; // Fixed container height
  const bufferSize = 40; // Add 40px buffer on all sides
  const availableWidth = containerWidth - bufferSize * 2;
  const availableHeight = containerHeight - bufferSize * 2;

  const scaleX = availableWidth / posterData.width;
  const scaleY = availableHeight / posterData.height;
  const scale = Math.min(scaleX, scaleY, 1);

  // Initialize Fabric.js canvas
  useEffect(() => {
    if (!canvasRef.current || !fabric) {
      return;
    }

    // Dispose existing canvas if it exists
    if (fabricCanvasRef.current) {
      fabricCanvasRef.current.dispose();
      fabricCanvasRef.current = null;
      setIsInitialized(false);
    }

    const canvas = new fabric.Canvas(canvasRef.current, {
      width: posterData.width,
      height: posterData.height,
      backgroundColor: 'transparent', // We'll handle background in render effect
      selection: true,
      preserveObjectStacking: true,
    });

    fabricCanvasRef.current = canvas;
    setIsInitialized(true);

    return () => {
      canvas.dispose();
      fabricCanvasRef.current = null;
      setIsInitialized(false);
    };
  }, [posterData.width, posterData.height]);

  // Set up event handlers separately to avoid dependency issues
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !fabric) return;

    // Handle object modifications
    const handleObjectModified = (e: any) => {
      // Clear snap lines when object is no longer being moved
      canvas.getObjects().forEach((obj: any) => {
        if (obj.isSnapLine) {
          canvas.remove(obj);
        }
      });

      // Update text preview when text area boundary is modified
      const modifiedObj = e.target;
      if (
        modifiedObj.type === 'rect' &&
        (modifiedObj.elementType === 'collection-title' ||
          modifiedObj.elementType === 'custom-text')
      ) {
        const textPreview = modifiedObj.textPreview;
        if (textPreview) {
          // Update preview position to stay centered in the boundary
          textPreview.set({
            left:
              modifiedObj.left + (modifiedObj.width * modifiedObj.scaleX) / 2,
            top:
              modifiedObj.top + (modifiedObj.height * modifiedObj.scaleY) / 2,
          });
          canvas.renderAll();
        }
      }

      canvas.renderAll();
      debouncedUpdatePosterData();
    };

    const handleObjectMoving = (e: any) => {
      // Always update poster data when moving
      debouncedUpdatePosterData();

      // Update text preview position when text area boundary is moved
      const textAreaObj = e.target;
      if (
        textAreaObj.type === 'rect' &&
        (textAreaObj.elementType === 'collection-title' ||
          textAreaObj.elementType === 'custom-text')
      ) {
        const textPreview = textAreaObj.textPreview;
        if (textPreview) {
          // Update preview position to stay centered in the boundary
          textPreview.set({
            left: textAreaObj.left + textAreaObj.width / 2,
            top: textAreaObj.top + textAreaObj.height / 2,
          });
          canvas.renderAll();
        }
      }

      if (!snapToGuides) {
        return;
      }
      const movingObj = e.target;
      const canvasWidth = canvas.getWidth();
      const canvasHeight = canvas.getHeight();
      const snapThreshold = 8;

      // Get moving object bounds
      const objLeft = movingObj.left;
      const objTop = movingObj.top;
      const objWidth = movingObj.getScaledWidth();
      const objHeight = movingObj.getScaledHeight();
      const objCenterX = objLeft + objWidth / 2;
      const objCenterY = objTop + objHeight / 2;
      const objRight = objLeft + objWidth;
      const objBottom = objTop + objHeight;

      let newLeft = objLeft;
      let newTop = objTop;
      const snapLines: any[] = [];

      // Canvas edge and center snapping
      // Horizontal snapping
      if (Math.abs(objLeft) < snapThreshold) {
        newLeft = 0; // Snap to left edge
        snapLines.push({ type: 'vertical', position: 0 });
      } else if (Math.abs(objRight - canvasWidth) < snapThreshold) {
        newLeft = canvasWidth - objWidth; // Snap to right edge
        snapLines.push({ type: 'vertical', position: canvasWidth });
      } else if (Math.abs(objCenterX - canvasWidth / 2) < snapThreshold) {
        newLeft = (canvasWidth - objWidth) / 2; // Snap to horizontal center
        snapLines.push({ type: 'vertical', position: canvasWidth / 2 });
      }

      // Vertical snapping
      if (Math.abs(objTop) < snapThreshold) {
        newTop = 0; // Snap to top edge
        snapLines.push({ type: 'horizontal', position: 0 });
      } else if (Math.abs(objBottom - canvasHeight) < snapThreshold) {
        newTop = canvasHeight - objHeight; // Snap to bottom edge
        snapLines.push({ type: 'horizontal', position: canvasHeight });
      } else if (Math.abs(objCenterY - canvasHeight / 2) < snapThreshold) {
        newTop = (canvasHeight - objHeight) / 2; // Snap to vertical center
        snapLines.push({ type: 'horizontal', position: canvasHeight / 2 });
      }

      // Object-to-object snapping
      const otherObjects = canvas
        .getObjects()
        .filter((o: any) => o !== movingObj && !o.isSnapLine);

      for (const otherObj of otherObjects) {
        const otherLeft = otherObj.left || 0;
        const otherTop = otherObj.top || 0;
        const otherWidth = otherObj.getScaledWidth();
        const otherHeight = otherObj.getScaledHeight();
        const otherCenterX = otherLeft + otherWidth / 2;
        const otherCenterY = otherTop + otherHeight / 2;
        const otherRight = otherLeft + otherWidth;
        const otherBottom = otherTop + otherHeight;

        // Horizontal alignment with other objects
        if (Math.abs(objLeft - otherLeft) < snapThreshold) {
          newLeft = otherLeft;
          snapLines.push({ type: 'vertical', position: otherLeft });
        } else if (Math.abs(objRight - otherRight) < snapThreshold) {
          newLeft = otherRight - objWidth;
          snapLines.push({ type: 'vertical', position: otherRight });
        } else if (Math.abs(objCenterX - otherCenterX) < snapThreshold) {
          newLeft = otherCenterX - objWidth / 2;
          snapLines.push({ type: 'vertical', position: otherCenterX });
        }

        // Vertical alignment with other objects
        if (Math.abs(objTop - otherTop) < snapThreshold) {
          newTop = otherTop;
          snapLines.push({ type: 'horizontal', position: otherTop });
        } else if (Math.abs(objBottom - otherBottom) < snapThreshold) {
          newTop = otherBottom - objHeight;
          snapLines.push({ type: 'horizontal', position: otherBottom });
        } else if (Math.abs(objCenterY - otherCenterY) < snapThreshold) {
          newTop = otherCenterY - objHeight / 2;
          snapLines.push({ type: 'horizontal', position: otherCenterY });
        }
      }

      // Apply snapping
      movingObj.set({
        left: newLeft,
        top: newTop,
      });

      // Clear existing snap lines
      canvas.getObjects().forEach((obj: any) => {
        if (obj.isSnapLine) {
          canvas.remove(obj);
        }
      });

      // Draw snap lines
      snapLines.forEach((line) => {
        let snapLine: any;
        if (line.type === 'vertical') {
          snapLine = new fabric.Line(
            [line.position, 0, line.position, canvasHeight],
            {
              stroke: '#ff6b35',
              strokeWidth: 2,
              strokeDashArray: [5, 5],
              selectable: false,
              evented: false,
              excludeFromExport: true,
              opacity: 1,
            }
          );
        } else {
          snapLine = new fabric.Line(
            [0, line.position, canvasWidth, line.position],
            {
              stroke: '#ff6b35',
              strokeWidth: 2,
              strokeDashArray: [5, 5],
              selectable: false,
              evented: false,
              excludeFromExport: true,
              opacity: 1,
            }
          );
        }
        snapLine.isSnapLine = true;
        canvas.add(snapLine);
        canvas.bringToFront(snapLine);
      });

      canvas.renderAll();
    };

    const handleObjectScaling = () => {
      debouncedUpdatePosterData();
    };

    const handleMouseUp = () => {
      // Clear snap lines when mouse is released
      canvas.getObjects().forEach((obj: any) => {
        if (obj.isSnapLine) {
          canvas.remove(obj);
        }
      });
      canvas.renderAll();
    };

    const handleSelection = () => {
      // Clear snap lines when selecting objects
      canvas.getObjects().forEach((obj: any) => {
        if (obj.isSnapLine) {
          canvas.remove(obj);
        }
      });
      canvas.renderAll();
    };

    canvas.on('object:modified', handleObjectModified);
    canvas.on('object:moving', handleObjectMoving);
    canvas.on('object:scaling', handleObjectScaling);
    canvas.on('mouse:up', handleMouseUp);
    canvas.on('selection:created', handleSelection);
    canvas.on('selection:updated', handleSelection);

    return () => {
      canvas.off('object:modified', handleObjectModified);
      canvas.off('object:moving', handleObjectMoving);
      canvas.off('object:scaling', handleObjectScaling);
      canvas.off('mouse:up', handleMouseUp);
      canvas.off('selection:created', handleSelection);
      canvas.off('selection:updated', handleSelection);
    };
  }, [snapToGuides, debouncedUpdatePosterData]);

  // Render canvas content based on poster data
  useEffect(() => {
    if (!fabricCanvasRef.current || !fabric || !isInitialized) return;

    // Skip re-rendering if user is currently interacting with objects
    if (isUserInteracting.current) {
      return;
    }

    const canvas = fabricCanvasRef.current;

    // Clear existing objects first
    canvas.clear();

    // Determine colors to use - priority: currently editing source > selected preview collection > defaults
    let primaryColor = posterData.background.color || '#6366f1';
    let secondaryColor = posterData.background.secondaryColor || '#1e1b4b';

    if (
      posterData.background.useSourceColors &&
      posterData.background.sourceColors
    ) {
      // If we're actively editing a source, show that source's colors
      // Otherwise, show the preview collection's colors
      const sourceToPreview =
        currentlyEditingSource || previewCollectionConfig?.type;

      if (
        sourceToPreview &&
        posterData.background.sourceColors[sourceToPreview]
      ) {
        const sourceColors =
          posterData.background.sourceColors[sourceToPreview];
        primaryColor = sourceColors.primaryColor || primaryColor;
        secondaryColor = sourceColors.secondaryColor || secondaryColor;
      }
    }

    // Update canvas background after clearing
    if (posterData.background.type === 'gradient' && fabric) {
      const intensity = (posterData.background.intensity || 50) / 100; // Convert to 0-1 range
      const centerPoint = 0.5 - intensity * 0.3; // More intense = tighter center
      const gradient = new fabric.Gradient({
        type: 'linear',
        coords: { x1: 0, y1: 0, x2: 0, y2: posterData.height },
        colorStops: [
          { offset: 0, color: secondaryColor },
          { offset: centerPoint, color: primaryColor },
          { offset: 1 - centerPoint, color: primaryColor },
          { offset: 1, color: secondaryColor },
        ],
      });
      canvas.setBackgroundColor(gradient, canvas.renderAll.bind(canvas));
    } else if (posterData.background.type === 'radial' && fabric) {
      const intensity = (posterData.background.intensity || 50) / 100; // Convert to 0-1 range
      const radius =
        Math.max(posterData.width, posterData.height) * (0.3 + intensity * 0.7); // 30% to 100% based on intensity
      const gradient = new fabric.Gradient({
        type: 'radial',
        coords: {
          x1: posterData.width / 2,
          y1: posterData.height / 2,
          x2: posterData.width / 2,
          y2: posterData.height / 2,
          r1: 0,
          r2: radius,
        },
        colorStops: [
          { offset: 0, color: primaryColor },
          { offset: 1, color: secondaryColor },
        ],
      });
      canvas.setBackgroundColor(gradient, canvas.renderAll.bind(canvas));
    } else {
      canvas.setBackgroundColor(primaryColor, canvas.renderAll.bind(canvas));
    }

    // Add text elements
    posterData.textElements.forEach((textElement) => {
      if (!fabric) return;

      const text =
        textElement.type === 'collection-title'
          ? previewCollectionConfig?.name || 'Sample Collection'
          : textElement.text || 'Sample Text';

      // Determine text color - priority: currently editing source > selected preview collection > default
      let textColor = textElement.color;
      if (
        posterData.background.useSourceColors &&
        posterData.background.sourceColors
      ) {
        const sourceToPreview =
          currentlyEditingSource || previewCollectionConfig?.type;
        if (
          sourceToPreview &&
          posterData.background.sourceColors[sourceToPreview]
        ) {
          const sourceColors =
            posterData.background.sourceColors[sourceToPreview];
          textColor = sourceColors.textColor || textColor;
        }
      }

      // Create a resizable text area container (just the boundary)
      const textAreaBoundary = new fabric.Rect({
        left: textElement.x,
        top: textElement.y,
        width: textElement.width,
        height: textElement.height,
        fill: 'transparent',
        stroke: '#ff6b35',
        strokeWidth: 2,
        strokeDashArray: [5, 5],
        cornerSize: 8,
        transparentCorners: false,
        hasRotatingPoint: false,
      });

      // Add custom properties for tracking
      textAreaBoundary.id = textElement.id;
      textAreaBoundary.elementType = textElement.type;
      textAreaBoundary.maxLines = textElement.maxLines;
      textAreaBoundary.fontSize = textElement.fontSize;
      textAreaBoundary.fontFamily = textElement.fontFamily;
      textAreaBoundary.fontWeight = textElement.fontWeight;
      textAreaBoundary.fontStyle = textElement.fontStyle;
      textAreaBoundary.textColor = textColor;

      // Create preview text that shows how text will wrap
      const createPreviewText = () => {
        // Simple text wrapping estimation for preview
        const words = text.split(' ');
        const lines: string[] = [];
        let currentLine = '';
        const avgCharWidth = textElement.fontSize * 0.6;
        const maxCharsPerLine = Math.floor(
          (textElement.width - 20) / avgCharWidth
        ); // 20px padding

        for (const word of words) {
          const testLine = currentLine ? `${currentLine} ${word}` : word;
          if (testLine.length <= maxCharsPerLine) {
            currentLine = testLine;
          } else {
            if (currentLine) {
              lines.push(currentLine);
              currentLine = word;
            } else {
              currentLine = word; // Word too long but keep it
            }
          }
        }
        if (currentLine) lines.push(currentLine);

        // Limit to maxLines
        const limitedLines = lines.slice(0, textElement.maxLines || 2);
        if (lines.length > limitedLines.length) {
          const lastLine = limitedLines[limitedLines.length - 1];
          limitedLines[limitedLines.length - 1] = lastLine.slice(0, -3) + '...';
        }

        return limitedLines.join('\n');
      };

      const previewText = createPreviewText();

      // Create the preview text object (center-aligned within the boundary)
      const textPreview = new fabric.Text(previewText, {
        left: textElement.x + textElement.width / 2,
        top: textElement.y + textElement.height / 2,
        fontSize: textElement.fontSize,
        fontFamily: textElement.fontFamily,
        fontWeight: textElement.fontWeight,
        fontStyle: textElement.fontStyle,
        fill: textColor,
        textAlign: 'center',
        originX: 'center',
        originY: 'center',
        selectable: false,
        evented: false,
        opacity: 0.8, // Slightly transparent to show it's preview
      });

      // Store reference to preview text for updates
      textAreaBoundary.textPreview = textPreview;

      // Add both to canvas
      canvas.add(textAreaBoundary);
      canvas.add(textPreview);
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

            // Use the parsed SVG dimensions from options for proper scaling
            const svgWidth = options.width || svgObject.width || 1;
            const svgHeight = options.height || svgObject.height || 1;

            // Calculate scale to fit within desired dimensions while preserving aspect ratio
            const scale = Math.min(
              iconElement.width / svgWidth,
              iconElement.height / svgHeight
            );

            // Position and size
            svgObject.set({
              left: iconElement.x,
              top: iconElement.y,
              scaleX: scale,
              scaleY: scale,
              cornerSize: 8,
              transparentCorners: false,
            });

            // Add custom properties for tracking
            svgObject.id = iconElement.id;
            svgObject.elementType = 'icon';
            svgObject.iconPath = serviceIconPath;
            svgObject.iconType = iconElement.type;
            // Store original intended dimensions (not scaled dimensions)
            svgObject.originalWidth = iconElement.width;
            svgObject.originalHeight = iconElement.height;

            canvas.add(svgObject);
            canvas.renderAll();
          },
          () => {
            // This callback is called for each SVG element
            // We can modify individual elements here if needed
          }
        );
      } else if (iconElement.type === 'custom-icon' && iconElement.iconPath) {
        // Load custom icon from the provided path
        fabric.loadSVGFromURL(
          iconElement.iconPath,
          (objects: any, options: any) => {
            if (!objects || objects.length === 0) {
              return; // Don't add anything if icon fails to load
            }
            const svgObject = fabric.util.groupSVGElements(objects, options);
            // Use the parsed SVG dimensions from options for proper scaling
            const svgWidth = options.width || svgObject.width || 1;
            const svgHeight = options.height || svgObject.height || 1;
            // Calculate scale to fit within desired dimensions while preserving aspect ratio
            const scale = Math.min(
              iconElement.width / svgWidth,
              iconElement.height / svgHeight
            );
            // Position and size
            svgObject.set({
              left: iconElement.x,
              top: iconElement.y,
              scaleX: scale,
              scaleY: scale,
              cornerSize: 8,
              transparentCorners: false,
            });
            // Add custom properties for tracking
            svgObject.id = iconElement.id;
            svgObject.elementType = 'icon';
            svgObject.iconPath = iconElement.iconPath;
            svgObject.iconType = iconElement.type;
            // Store original intended dimensions (not scaled dimensions)
            svgObject.originalWidth = iconElement.width;
            svgObject.originalHeight = iconElement.height;
            canvas.add(svgObject);
            canvas.renderAll();
          },
          () => {
            // This callback is called for each SVG element
            // We can modify individual elements here if needed
          }
        );
      } else if (
        iconElement.type === 'source-logo' &&
        !previewCollectionConfig?.type
      ) {
        // Only show placeholder for source-logo when no preview collection is selected
        const rect = new fabric.Rect({
          left: iconElement.x,
          top: iconElement.y,
          width: iconElement.width,
          height: iconElement.height,
          fill: '#cccccc',
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
        rect.iconType = iconElement.type;
        // Store original intended dimensions (not scaled dimensions)
        rect.originalWidth = iconElement.width;
        rect.originalHeight = iconElement.height;

        canvas.add(rect);
      }
    });

    // Add content grid placeholder if exists
    if (posterData.contentGrid && fabric) {
      const grid = posterData.contentGrid;

      // Calculate cell dimensions with proper poster aspect ratio (2:3)
      const availableWidth = grid.width - (grid.columns - 1) * grid.spacing;

      // Use 2:3 aspect ratio for poster cells (width:height = 2:3)
      const cellWidth = availableWidth / grid.columns;
      const cellHeight = cellWidth * 1.5; // 2:3 ratio means height = width * 1.5
      const actualCellHeight = cellHeight;

      const gridElements = [];

      for (let row = 0; row < grid.rows; row++) {
        for (let col = 0; col < grid.columns; col++) {
          const x = col * (cellWidth + grid.spacing);
          const y = row * (actualCellHeight + grid.spacing);

          const placeholder = new fabric.Rect({
            left: x,
            top: y,
            width: cellWidth,
            height: actualCellHeight,
            fill: '#2d2d2d',
            stroke: '#555555',
            strokeWidth: 1,
            rx: grid.cornerRadius,
            ry: grid.cornerRadius,
            selectable: false, // Individual cells aren't selectable
          });

          gridElements.push(placeholder);
        }
      }

      // Create a group from all grid elements to make it draggable as a unit
      const gridGroup = new fabric.Group(gridElements, {
        left: grid.x,
        top: grid.y,
        cornerSize: 8,
        transparentCorners: false,
        selectable: true,
      });

      // Add custom properties for tracking
      gridGroup.id = grid.id;
      gridGroup.elementType = 'contentGrid';
      // Store original intended dimensions
      gridGroup.originalWidth = grid.width;
      gridGroup.originalHeight = grid.height;
      gridGroup.gridColumns = grid.columns;
      gridGroup.gridRows = grid.rows;
      gridGroup.gridSpacing = grid.spacing;
      gridGroup.gridCornerRadius = grid.cornerRadius;

      canvas.add(gridGroup);
    }

    canvas.renderAll();
  }, [
    posterData,
    previewCollectionConfig,
    isInitialized,
    debouncedUpdatePosterData,
    currentlyEditingSource,
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

  if (!fabric) {
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
        {!isInitialized && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-stone-800 bg-opacity-75">
            <div className="text-white">Initializing canvas...</div>
          </div>
        )}
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
