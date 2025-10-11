/* eslint-disable @typescript-eslint/no-explicit-any */
import { fontLoader } from '@app/utils/fontLoader';
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
  selectedElementId?: string; // ID of element selected in LayerPanel
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
  aspectRatioLocked?: Record<string, boolean>; // Aspect ratio lock state for elements
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
    selectedElementId,
    sourceColorsData,
    aspectRatioLocked = {},
  },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricCanvasRef = useRef<any>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const updateTimeoutRef = useRef<NodeJS.Timeout>();
  const isUserInteracting = useRef(false);
  const isExternalUpdate = useRef(false);
  const posterDataRef = useRef<PosterEditorData>(posterData);

  // Keep ref up to date
  useEffect(() => {
    posterDataRef.current = posterData;
  }, [posterData]);

  // Unified system update functions that work with posterData.elements[]
  const updateElement = useCallback(
    (
      elementId: string,
      updates: Partial<{ x: number; y: number; width: number; height: number }>
    ) => {
      if (!posterData.elements) return;

      const newElements = posterData.elements.map((element) =>
        element.id === elementId ? { ...element, ...updates } : element
      );
      onChange({ ...posterData, elements: newElements });
    },
    [posterData, onChange]
  );

  const updateElementProperties = useCallback(
    (elementId: string, propertyUpdates: any) => {
      if (!posterData.elements) return;

      const newElements = posterData.elements.map((element) =>
        element.id === elementId
          ? {
              ...element,
              properties: { ...element.properties, ...propertyUpdates },
            }
          : element
      );
      onChange({ ...posterData, elements: newElements });
    },
    [posterData, onChange]
  );

  // Safe render function that checks canvas validity
  const safeRenderAll = useCallback((canvas: any) => {
    if (
      !canvas ||
      !fabricCanvasRef.current ||
      canvas !== fabricCanvasRef.current
    ) {
      return;
    }
    try {
      // Check if canvas context still exists
      const ctx = canvas.getContext('2d');
      if (ctx) {
        canvas.renderAll();
      }
    } catch (error) {
      // Ignore render errors on disposed canvas
    }
  }, []);

  // Unified element rendering functions
  const renderRasterElement = useCallback(
    (canvas: any, element: any) => {
      if (!fabric) return;

      const props = element.properties;
      if (!props.imagePath || props.imagePath.trim() === '') {
        return;
      }

      fabric.Image.fromURL(
        props.imagePath,
        (imgObject: any) => {
          if (!imgObject) return;

          const scale = Math.min(
            element.width / imgObject.width,
            element.height / imgObject.height
          );

          imgObject.set({
            left: element.x,
            top: element.y,
            scaleX: scale,
            scaleY: scale,
            cornerSize: 8,
            transparentCorners: false,
            // Fix for uniScaleKey undefined error
            uniformScaling: true,
            hasControls: true,
          });

          imgObject.id = element.id;
          imgObject.elementType = 'raster';
          imgObject.imagePath = props.imagePath;
          imgObject.originalWidth = element.width;
          imgObject.originalHeight = element.height;
          imgObject.layerOrder = element.layerOrder;

          canvas.add(imgObject);
          safeRenderAll(canvas);
        },
        { crossOrigin: 'anonymous' }
      );
    },
    [safeRenderAll]
  );

  const renderSVGElement = useCallback(
    (canvas: any, element: any, previewCollectionConfig: any) => {
      if (!fabric) return;

      const props = element.properties;

      if (props.iconType === 'source-logo') {
        // Handle source logo (dynamic based on preview collection)
        let serviceIconPath: string;

        if (previewCollectionConfig?.type) {
          // If we have a preview collection, show that specific source's logo
          serviceIconPath = `/services/${previewCollectionConfig.type}.svg`;
        } else {
          // If no preview collection, show Agregarr logo as placeholder
          serviceIconPath = `/services/os_icon.svg`;
        }

        fabric.loadSVGFromURL(serviceIconPath, (objects: any, options: any) => {
          const svgObject = fabric.util.groupSVGElements(objects, options);
          if (!svgObject) return;

          const scale = Math.min(
            element.width / svgObject.width,
            element.height / svgObject.height
          );

          svgObject.set({
            left: element.x,
            top: element.y,
            scaleX: scale,
            scaleY: scale,
            cornerSize: 8,
            transparentCorners: false,
            // Fix for uniScaleKey undefined error
            uniformScaling: true,
            hasControls: true,
          });

          svgObject.id = element.id;
          svgObject.elementType = 'svg';
          svgObject.iconPath = serviceIconPath;
          svgObject.iconType = props.iconType;
          svgObject.originalWidth = element.width;
          svgObject.originalHeight = element.height;
          svgObject.layerOrder = element.layerOrder;

          canvas.add(svgObject);
          safeRenderAll(canvas);
        });
      } else if (props.iconPath) {
        // Handle custom SVG
        fabric.loadSVGFromURL(props.iconPath, (objects: any, options: any) => {
          const svgObject = fabric.util.groupSVGElements(objects, options);
          if (!svgObject) return;

          const scale = Math.min(
            element.width / svgObject.width,
            element.height / svgObject.height
          );

          svgObject.set({
            left: element.x,
            top: element.y,
            scaleX: scale,
            scaleY: scale,
            cornerSize: 8,
            transparentCorners: false,
            // Fix for uniScaleKey undefined error
            uniformScaling: true,
            hasControls: true,
          });

          svgObject.id = element.id;
          svgObject.elementType = 'svg';
          svgObject.iconPath = props.iconPath;
          svgObject.iconType = props.iconType;
          svgObject.originalWidth = element.width;
          svgObject.originalHeight = element.height;
          svgObject.layerOrder = element.layerOrder;

          canvas.add(svgObject);
          safeRenderAll(canvas);
        });
      }
    },
    [safeRenderAll]
  );

  // Enhanced text width calculation with canvas measurement fallback
  const getTextWidth = useCallback(
    (
      text: string,
      fontSize: number,
      fontFamily = 'Arial',
      fontWeight = 'normal'
    ): number => {
      // Try to use browser's actual text measurement for maximum accuracy
      try {
        // Create a temporary canvas for text measurement
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        if (ctx) {
          // Set font properties to match what will be rendered
          const quotedFontFamily = fontFamily.includes(' ')
            ? `'${fontFamily}'`
            : fontFamily;
          ctx.font = `${fontWeight} ${fontSize}px ${quotedFontFamily}`;

          // Measure the text width
          const metrics = ctx.measureText(text);
          const measuredWidth = metrics.width;

          // Add 5% safety margin for accurate measurement (same as server-side Canvas measurement)
          return measuredWidth * 1.05;
        }
      } catch (error) {
        // Fall back to estimation if canvas measurement fails
      }

      // Fallback: Conservative character width estimation (mirrors server-side fallback)
      let totalWidth = 0;

      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        let charWidth = 0.6; // Conservative default

        // Simplified character width categories for cross-font compatibility
        if (char === ' ') {
          charWidth = 0.3; // Space
        } else if (/[.,;:!]/.test(char)) {
          charWidth = 0.3; // Punctuation
        } else if (/['""`]/.test(char)) {
          charWidth = 0.25; // Quotes
        } else if (/[il1|]/.test(char)) {
          charWidth = 0.3; // Narrow characters
        } else if (/[fjtI]/.test(char)) {
          charWidth = 0.4; // Semi-narrow characters
        } else if (/[MW@]/.test(char)) {
          charWidth = 0.9; // Wide characters
        } else if (/[mw]/.test(char)) {
          charWidth = 0.8; // Medium-wide lowercase
        } else if (/[ABCDEFGHIJKLNOPQRSTUVXYZ]/.test(char)) {
          charWidth = 0.7; // Regular uppercase
        } else if (/[abcdefghknopqrsuvxyz]/.test(char)) {
          charWidth = 0.6; // Regular lowercase
        } else if (/[0-9]/.test(char)) {
          charWidth = 0.6; // Numbers (most fonts use tabular figures)
        } else {
          charWidth = 0.65; // Everything else (symbols, etc.)
        }

        totalWidth += charWidth * fontSize;
      }

      // Add 25% safety margin to account for font differences and prevent clipping
      return totalWidth * 1.25;
    },
    []
  );

  // Get actual font metrics for precise vertical positioning
  const getFontMetrics = useCallback(
    (
      fontSize: number,
      fontFamily = 'Arial',
      fontWeight = 'normal'
    ): { ascent: number; descent: number; height: number } => {
      try {
        // Create a temporary canvas for font measurement
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        if (ctx) {
          // Set font properties to match what will be rendered
          const quotedFontFamily = fontFamily.includes(' ')
            ? `'${fontFamily}'`
            : fontFamily;
          ctx.font = `${fontWeight} ${fontSize}px ${quotedFontFamily}`;

          // Measure a representative character to get font metrics
          const metrics = ctx.measureText('Àj'); // Character with ascender and descender

          // Extract font metrics from TextMetrics (modern browsers)
          if (metrics.fontBoundingBoxAscent && metrics.fontBoundingBoxDescent) {
            return {
              ascent: metrics.fontBoundingBoxAscent,
              descent: metrics.fontBoundingBoxDescent,
              height:
                metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent,
            };
          }

          // Fallback: estimate from font size for older browsers
          return {
            ascent: fontSize * 0.8, // Typical ascender ratio
            descent: fontSize * 0.2, // Typical descender ratio
            height: fontSize,
          };
        }
      } catch (error) {
        // Error measuring font - use fallback
      }

      // Final fallback: estimate from font size
      return {
        ascent: fontSize * 0.8,
        descent: fontSize * 0.2,
        height: fontSize,
      };
    },
    []
  );

  // Client-side text wrapping (mirrors server-side logic)
  const wrapTextKeepWords = useCallback(
    (
      text: string,
      maxWidth: number,
      fontSize: number,
      fontFamily = 'Arial',
      fontWeight = 'normal'
    ): string[] => {
      const words = text.split(' ');
      const lines: string[] = [];
      let currentLine = '';

      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const lineWidth = getTextWidth(
          testLine,
          fontSize,
          fontFamily,
          fontWeight
        );

        if (lineWidth <= maxWidth) {
          currentLine = testLine;
        } else {
          // Line would be too wide, start a new line
          if (currentLine) {
            lines.push(currentLine);
            currentLine = word;
          } else {
            // Single word is too wide, but keep it anyway
            currentLine = word;
          }
        }
      }

      if (currentLine) {
        lines.push(currentLine);
      }

      return lines.length > 0 ? lines : [text];
    },
    [getTextWidth]
  );

  // Calculate optimal font size and text layout
  const calculateTextLayout = useCallback(
    (
      text: string,
      width: number,
      height: number,
      fontSize: number,
      maxLines: number,
      fontFamily = 'Arial',
      fontWeight = 'normal'
    ): { finalFontSize: number; lines: string[]; totalHeight: number } => {
      // Start with the given font size and shrink if needed
      let currentFontSize = fontSize;
      let lines: string[] = [];
      let limitedLines: string[] = [];
      let lineHeight: number;
      let totalTextHeight: number;

      // Iteratively reduce font size until text fits within height bounds
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
        totalTextHeight = limitedLines.length * lineHeight;

        // If text fits within height, we're done
        if (totalTextHeight <= height) {
          break;
        }

        // Otherwise, reduce font size by 5% and try again
        currentFontSize *= 0.95;

        // Prevent infinite loop - minimum font size of 8px
        if (currentFontSize < 8) {
          break;
        }
      } while (totalTextHeight > height);

      return {
        finalFontSize: currentFontSize,
        lines: limitedLines,
        totalHeight: totalTextHeight,
      };
    },
    [wrapTextKeepWords]
  );

  const renderTextElement = useCallback(
    async (canvas: any, element: any, previewCollectionConfig: any) => {
      if (!fabric) return;

      const props = element.properties;
      const displayText =
        props.elementType === 'collection-title'
          ? previewCollectionConfig?.name || 'Collection Title'
          : props.text || 'Sample Text';

      // Ensure font is loaded before creating text element
      try {
        if (props.fontFamily && !fontLoader.isFontLoaded(props.fontFamily)) {
          // Wait for font to be available with timeout
          await fontLoader.waitForFont(
            props.fontFamily.replace(/'/g, ''),
            1000
          );
        }
      } catch (error) {
        // Font loading failed - continue with default font
      }

      // Preload font before using it
      if ('fonts' in document) {
        document.fonts
          .load(`${props.fontSize}px ${props.fontFamily}`)
          .catch(() => {
            // Font loading failed - continue with default
          });
      }

      // Calculate optimal text layout
      const maxLines =
        props.maxLines || Math.floor(element.height / props.fontSize);
      const textLayout = calculateTextLayout(
        displayText,
        element.width,
        element.height,
        props.fontSize,
        maxLines,
        props.fontFamily,
        props.fontWeight
      );

      // Create text boundary rectangle (checkered border, resizable)
      const textBoundary = new fabric.Rect({
        left: element.x,
        top: element.y,
        width: element.width,
        height: element.height,
        fill: 'transparent',
        stroke: '#ff6b35', // Orange border
        strokeWidth: 2,
        strokeDashArray: [5, 5], // Checkered/dashed border
        cornerSize: 8,
        transparentCorners: false,
        selectable: true,
        hasControls: true,
        // Fix for uniScaleKey undefined error
        uniformScaling: false, // Text areas can be resized non-uniformly
      });

      // Set element properties for identification and updates
      textBoundary.id = element.id;
      textBoundary.elementType = props.elementType; // 'collection-title' or 'custom-text'
      textBoundary.type = 'rect'; // Fabric.js object type

      // Create multi-line text preview with precise font-metric-based centering
      const lineHeight = textLayout.finalFontSize * 1.1;

      // Get actual font metrics for this specific font
      const fontMetrics = getFontMetrics(
        textLayout.finalFontSize,
        props.fontFamily,
        props.fontWeight
      );

      // Calculate the actual visual height of all text lines
      const totalVisualHeight =
        (textLayout.lines.length - 1) * lineHeight + fontMetrics.height;

      // Center the visual text content within the available height using font metrics
      const visualCenterY = (element.height - totalVisualHeight) / 2;
      const firstLineY = visualCenterY; // Position at top of text (Fabric.js originY: 'top')

      // Create individual text lines without grouping to avoid positioning issues
      textLayout.lines.forEach((line, index) => {
        let textX = element.x; // Absolute positioning like backend
        let textAnchor = 'left';

        if (props.textAlign === 'center') {
          textX = element.x + element.width / 2;
          textAnchor = 'center';
        } else if (props.textAlign === 'right') {
          textX = element.x + element.width;
          textAnchor = 'end';
        }

        const lineY = element.y + firstLineY + index * lineHeight;

        const textLine = new fabric.Text(line, {
          left: textX,
          top: lineY,
          fontSize: textLayout.finalFontSize,
          fontFamily: props.fontFamily,
          fontWeight: props.fontWeight,
          fontStyle: props.fontStyle,
          fill: props.color,
          originX: textAnchor,
          originY: 'top',
          selectable: false,
          hasControls: false,
          evented: false,
        });

        // Store metadata for identification and updates
        textLine.id = `${element.id}_line_${index}`;
        textLine.parentElementId = element.id;
        textLine.elementType = props.elementType;
        textLine.lineIndex = index;
        textLine.layerOrder = element.layerOrder;

        canvas.add(textLine);
      });

      // Store layout info for updates on boundary
      textBoundary.originalText = displayText;
      textBoundary.textLayout = textLayout;

      // Add boundary to canvas
      canvas.add(textBoundary);

      // Store layerOrder on boundary
      textBoundary.layerOrder = element.layerOrder;

      safeRenderAll(canvas);
    },
    [safeRenderAll, calculateTextLayout, getFontMetrics]
  );

  const renderContentGridElement = useCallback(
    (canvas: any, element: any, previewCollectionConfig: any) => {
      if (!fabric) return;

      const props = element.properties;
      const gridElements: any[] = [];

      // Calculate cell dimensions maintaining poster aspect ratio (2:3)
      const availableWidth =
        element.width - (props.columns - 1) * props.spacing;
      const cellWidth = availableWidth / props.columns;
      const cellHeight = cellWidth * 1.5; // 2:3 aspect ratio for posters

      // Calculate the actual grid height needed
      const requiredHeight =
        cellHeight * props.rows + (props.rows - 1) * props.spacing;

      for (let row = 0; row < props.rows; row++) {
        for (let col = 0; col < props.columns; col++) {
          // Use different styling when preview collection is available
          const isPreviewMode = previewCollectionConfig?.name;
          const placeholder = new fabric.Rect({
            left: col * (cellWidth + props.spacing),
            top: row * (cellHeight + props.spacing),
            width: cellWidth,
            height: cellHeight,
            fill: isPreviewMode ? '#2563eb' : '#374151', // Blue when preview available
            stroke: isPreviewMode ? '#3b82f6' : '#6b7280',
            strokeWidth: 1,
            rx: props.cornerRadius,
            ry: props.cornerRadius,
          });
          gridElements.push(placeholder);
        }
      }

      const gridGroup = new fabric.Group(gridElements, {
        left: element.x,
        top: element.y,
        cornerSize: 8,
        transparentCorners: false,
        selectable: true,
        // Fix for uniScaleKey undefined error
        uniformScaling: true,
        hasControls: true,
      });

      gridGroup.id = element.id;
      gridGroup.elementType = 'contentGrid';
      gridGroup.originalWidth = element.width;
      gridGroup.originalHeight = requiredHeight; // Use calculated height
      gridGroup.gridColumns = props.columns;
      gridGroup.gridRows = props.rows;
      gridGroup.gridSpacing = props.spacing;
      gridGroup.gridCornerRadius = props.cornerRadius;
      gridGroup.layerOrder = element.layerOrder;

      canvas.add(gridGroup);
      safeRenderAll(canvas);
    },
    [safeRenderAll]
  );

  // Debounced wrapper for targeted updates to prevent excessive calls during dragging
  const debouncedTargetedUpdate = useCallback((updateFn: () => void) => {
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current);
    }

    updateTimeoutRef.current = setTimeout(() => {
      if (!fabricCanvasRef.current) return;

      // Set interaction flag BEFORE calling update function
      isUserInteracting.current = true;
      updateFn();

      // Don't automatically reset the flag - let it be reset by mouse up events
      // This prevents canvas rebuilds during ongoing interactions
    }, 150); // Shorter debounce since we're only updating specific elements
  }, []);

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

    // Clear any pending operations first
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current);
      updateTimeoutRef.current = undefined;
    }

    // Dispose existing canvas if it exists
    if (fabricCanvasRef.current) {
      try {
        // Stop all rendering operations before disposal
        fabricCanvasRef.current.off(); // Remove all event listeners
        fabricCanvasRef.current.renderOnAddRemove = false;
        fabricCanvasRef.current.dispose();
      } catch (error) {
        // Ignore disposal errors
      } finally {
        fabricCanvasRef.current = null;
        setIsInitialized(false);
      }
    }

    const canvas = new fabric.Canvas(canvasRef.current, {
      width: posterData.width,
      height: posterData.height,
      backgroundColor: 'transparent', // We'll handle background in render effect
      selection: true,
      preserveObjectStacking: true,
      renderOnAddRemove: true,
      // Fix for uniScaleKey undefined error - set default uniform scaling key
      uniScaleKey: 'shiftKey',
    });

    fabricCanvasRef.current = canvas;
    setIsInitialized(true);

    return () => {
      // Clear any pending debounced updates to prevent accessing disposed canvas
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
        updateTimeoutRef.current = undefined;
      }

      try {
        if (canvas) {
          canvas.off(); // Remove all event listeners
          canvas.renderOnAddRemove = false;
          canvas.dispose();
        }
      } catch (error) {
        // Ignore disposal errors
      } finally {
        fabricCanvasRef.current = null;
        setIsInitialized(false);
      }
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

      // Defensive check to prevent uniScaleKey undefined errors
      if (!modifiedObj || typeof modifiedObj.set !== 'function') {
        return;
      }
      if (
        modifiedObj.type === 'rect' &&
        (modifiedObj.elementType === 'collection-title' ||
          modifiedObj.elementType === 'custom-text')
      ) {
        if (modifiedObj.originalText) {
          try {
            // Calculate new dimensions after scaling
            const scaledWidth = modifiedObj.width * modifiedObj.scaleX;
            const scaledHeight = modifiedObj.height * modifiedObj.scaleY;

            // Find the element properties from posterData to get font settings
            const element = posterDataRef.current.elements?.find(
              (el) => el.id === modifiedObj.id
            );
            if (element && element.type === 'text') {
              const props = element.properties as any;
              const maxLines =
                props.maxLines || Math.floor(scaledHeight / props.fontSize);

              // Recalculate text layout with new dimensions
              const newTextLayout = calculateTextLayout(
                modifiedObj.originalText,
                scaledWidth,
                scaledHeight,
                props.fontSize,
                maxLines,
                props.fontFamily,
                props.fontWeight
              );

              // Remove old text lines associated with this element
              const textLinesToRemove = canvas
                .getObjects()
                .filter((obj: any) => obj.parentElementId === modifiedObj.id);
              textLinesToRemove.forEach((line: any) => canvas.remove(line));

              // Create new text lines with updated layout (font-metric-based centering)
              const lineHeight = newTextLayout.finalFontSize * 1.1;
              const fontMetrics = getFontMetrics(
                newTextLayout.finalFontSize,
                props.fontFamily,
                props.fontWeight
              );
              const totalVisualHeight =
                (newTextLayout.lines.length - 1) * lineHeight +
                fontMetrics.height;
              const visualCenterY = (scaledHeight - totalVisualHeight) / 2;
              const firstLineY = visualCenterY;

              newTextLayout.lines.forEach((line, index) => {
                let textX = modifiedObj.left;
                let textAnchor = 'left';

                if (props.textAlign === 'center') {
                  textX = modifiedObj.left + scaledWidth / 2;
                  textAnchor = 'center';
                } else if (props.textAlign === 'right') {
                  textX = modifiedObj.left + scaledWidth;
                  textAnchor = 'end';
                }

                const lineY = modifiedObj.top + firstLineY + index * lineHeight;

                const textLine = new fabric.Text(line, {
                  left: textX,
                  top: lineY,
                  fontSize: newTextLayout.finalFontSize,
                  fontFamily: props.fontFamily,
                  fontWeight: props.fontWeight,
                  fontStyle: props.fontStyle,
                  fill: props.color,
                  originX: textAnchor,
                  originY: 'top',
                  selectable: false,
                  hasControls: false,
                  evented: false,
                });

                // Store metadata for identification
                textLine.id = `${element.id}_line_${index}`;
                textLine.parentElementId = element.id;
                textLine.elementType = props.elementType;
                textLine.lineIndex = index;
                textLine.layerOrder = element.layerOrder;

                canvas.add(textLine);
              });

              // Update layout info on boundary
              modifiedObj.textLayout = newTextLayout;
            }

            safeRenderAll(canvas);
          } catch (error) {
            // Error updating text preview - handled silently
          }
        }
      }

      safeRenderAll(canvas);

      // Use unified system updates for element position/size changes
      if (modifiedObj.id && modifiedObj.elementType) {
        debouncedTargetedUpdate(() => {
          const updates = {
            x: modifiedObj.left || 0,
            y: modifiedObj.top || 0,
            width: Math.round(
              (modifiedObj.width || 100) * (modifiedObj.scaleX || 1)
            ),
            height: Math.round(
              (modifiedObj.height || 40) * (modifiedObj.scaleY || 1)
            ),
          };

          updateElement(modifiedObj.id, updates);
        });
      }
    };

    const handleObjectMoving = (e: any) => {
      // Use unified system updates for moving objects
      const movingObj = e.target;
      if (movingObj.id && movingObj.elementType) {
        debouncedTargetedUpdate(() => {
          const updates = {
            x: movingObj.left || 0,
            y: movingObj.top || 0,
          };

          updateElement(movingObj.id, updates);
        });
      }

      // Update text preview position when text area boundary is moved (but not during scaling)
      const textAreaObj = e.target;
      if (
        textAreaObj.type === 'rect' &&
        (textAreaObj.elementType === 'collection-title' ||
          textAreaObj.elementType === 'custom-text')
      ) {
        if (textAreaObj.textLayout) {
          // Update individual text lines position to match boundary position
          const scaledWidth = textAreaObj.width * textAreaObj.scaleX;
          const scaledHeight = textAreaObj.height * textAreaObj.scaleY;
          const lineHeight = textAreaObj.textLayout.finalFontSize * 1.1;

          // Find element to get font properties for metrics calculation
          const element = posterDataRef.current.elements?.find(
            (el) => el.id === textAreaObj.id
          );
          if (element && element.type === 'text') {
            const props = element.properties as any;
            const fontMetrics = getFontMetrics(
              textAreaObj.textLayout.finalFontSize,
              props.fontFamily,
              props.fontWeight
            );
            const totalVisualHeight =
              (textAreaObj.textLayout.lines.length - 1) * lineHeight +
              fontMetrics.height;
            const visualCenterY = (scaledHeight - totalVisualHeight) / 2;
            const firstLineY = visualCenterY;

            // Update each text line position
            const textLines = canvas
              .getObjects()
              .filter((obj: any) => obj.parentElementId === textAreaObj.id);
            textLines.forEach((textLine: any, index: number) => {
              let textX = textAreaObj.left;
              let textAnchor = 'left';

              if (props.textAlign === 'center') {
                textX = textAreaObj.left + scaledWidth / 2;
                textAnchor = 'center';
              } else if (props.textAlign === 'right') {
                textX = textAreaObj.left + scaledWidth;
                textAnchor = 'end';
              }

              const lineY = textAreaObj.top + firstLineY + index * lineHeight;

              textLine.set({
                left: textX,
                top: lineY,
                originX: textAnchor,
              });
            });
          }

          safeRenderAll(canvas);
        }
      }

      if (!snapToGuides) {
        return;
      }
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

      safeRenderAll(canvas);
    };

    const handleObjectScaling = (e: any) => {
      const scalingObj = e.target;

      // Defensive check to prevent uniScaleKey undefined errors
      if (!scalingObj || typeof scalingObj.set !== 'function') {
        return;
      }

      // Apply snap-to-guides for corner dragging if enabled
      if (snapToGuides) {
        const canvasWidth = canvas.getWidth();
        const canvasHeight = canvas.getHeight();
        const snapThreshold = 8;

        // Get current object bounds
        const objLeft = scalingObj.left;
        const objTop = scalingObj.top;
        const objWidth = scalingObj.getScaledWidth();
        const objHeight = scalingObj.getScaledHeight();
        const objRight = objLeft + objWidth;
        const objBottom = objTop + objHeight;

        let newScaleX = scalingObj.scaleX;
        let newScaleY = scalingObj.scaleY;
        const snapLines: any[] = [];

        // Check if this element should maintain aspect ratio
        const shouldMaintainAspectRatio =
          (scalingObj.id && aspectRatioLocked[scalingObj.id]) ?? true;

        // Helper function to apply aspect ratio for corner handles
        const applyAspectRatio = (corner: string, scaleXChange: boolean) => {
          if (
            shouldMaintainAspectRatio &&
            ['tl', 'tr', 'bl', 'br'].includes(corner)
          ) {
            if (scaleXChange) {
              newScaleY = newScaleX;
            } else {
              newScaleX = newScaleY;
            }
          }
        };

        // Determine which corner is being dragged
        const activeCorner = canvas.getActiveObject()?.__corner;

        // Apply snapping based on which corner is being dragged
        if (activeCorner) {
          // Canvas edge and center snapping for corners

          // Right edge snapping (for corners with right handles: tr, mr, br)
          if (
            ['tr', 'mr', 'br'].includes(activeCorner) &&
            Math.abs(objRight - canvasWidth) < snapThreshold
          ) {
            const targetRight = canvasWidth;
            const newWidth = targetRight - objLeft;
            newScaleX = newWidth / scalingObj.width;

            applyAspectRatio(activeCorner, true);

            snapLines.push({ type: 'vertical', position: canvasWidth });
          }

          // Left edge snapping (for corners with left handles: tl, ml, bl)
          if (
            ['tl', 'ml', 'bl'].includes(activeCorner) &&
            Math.abs(objLeft) < snapThreshold
          ) {
            const currentRight = objLeft + objWidth;
            const newWidth = currentRight;
            newScaleX = newWidth / scalingObj.width;

            applyAspectRatio(activeCorner, true);

            snapLines.push({ type: 'vertical', position: 0 });
          }

          // Horizontal center snapping (for corners that affect width)
          if (
            ['tr', 'mr', 'br'].includes(activeCorner) &&
            Math.abs(objRight - canvasWidth / 2) < snapThreshold
          ) {
            const targetRight = canvasWidth / 2;
            const newWidth = targetRight - objLeft;
            newScaleX = newWidth / scalingObj.width;

            applyAspectRatio(activeCorner, true);

            snapLines.push({ type: 'vertical', position: canvasWidth / 2 });
          }
          if (
            ['tl', 'ml', 'bl'].includes(activeCorner) &&
            Math.abs(objLeft - canvasWidth / 2) < snapThreshold
          ) {
            const targetLeft = canvasWidth / 2;
            const widthDiff = objLeft - targetLeft;
            const newWidth = objWidth + widthDiff;
            newScaleX = newWidth / scalingObj.width;

            applyAspectRatio(activeCorner, true);

            snapLines.push({ type: 'vertical', position: canvasWidth / 2 });
          }

          // Bottom edge snapping (for corners with bottom handles: bl, mb, br)
          if (
            ['bl', 'mb', 'br'].includes(activeCorner) &&
            Math.abs(objBottom - canvasHeight) < snapThreshold
          ) {
            const targetBottom = canvasHeight;
            const newHeight = targetBottom - objTop;
            newScaleY = newHeight / scalingObj.height;

            applyAspectRatio(activeCorner, false);

            snapLines.push({ type: 'horizontal', position: canvasHeight });
          }

          // Top edge snapping (for corners with top handles: tl, mt, tr)
          if (
            ['tl', 'mt', 'tr'].includes(activeCorner) &&
            Math.abs(objTop) < snapThreshold
          ) {
            const heightDiff = objTop;
            const newHeight = objHeight + heightDiff;
            newScaleY = newHeight / scalingObj.height;

            applyAspectRatio(activeCorner, false);

            snapLines.push({ type: 'horizontal', position: 0 });
          }

          // Vertical center snapping (for corners that affect height)
          if (
            ['bl', 'mb', 'br'].includes(activeCorner) &&
            Math.abs(objBottom - canvasHeight / 2) < snapThreshold
          ) {
            const targetBottom = canvasHeight / 2;
            const newHeight = targetBottom - objTop;
            newScaleY = newHeight / scalingObj.height;

            applyAspectRatio(activeCorner, false);

            snapLines.push({ type: 'horizontal', position: canvasHeight / 2 });
          }
          if (
            ['tl', 'mt', 'tr'].includes(activeCorner) &&
            Math.abs(objTop - canvasHeight / 2) < snapThreshold
          ) {
            const targetTop = canvasHeight / 2;
            const heightDiff = objTop - targetTop;
            const newHeight = objHeight + heightDiff;
            newScaleY = newHeight / scalingObj.height;

            applyAspectRatio(activeCorner, false);

            snapLines.push({ type: 'horizontal', position: canvasHeight / 2 });
          }

          // Object-to-object snapping for corners
          const otherObjects = canvas
            .getObjects()
            .filter((o: any) => o !== scalingObj && !o.isSnapLine);

          for (const otherObj of otherObjects) {
            const otherLeft = otherObj.left || 0;
            const otherTop = otherObj.top || 0;
            const otherWidth = otherObj.getScaledWidth();
            const otherHeight = otherObj.getScaledHeight();
            const otherCenterX = otherLeft + otherWidth / 2;
            const otherCenterY = otherTop + otherHeight / 2;
            const otherRight = otherLeft + otherWidth;
            const otherBottom = otherTop + otherHeight;

            // Right edge alignment with other objects (for right handles)
            if (
              ['tr', 'mr', 'br'].includes(activeCorner) &&
              Math.abs(objRight - otherRight) < snapThreshold
            ) {
              const newWidth = otherRight - objLeft;
              newScaleX = newWidth / scalingObj.width;

              // For corner handles, maintain aspect ratio
              if (['tr', 'br'].includes(activeCorner)) {
                newScaleY = newScaleX;
              }

              snapLines.push({ type: 'vertical', position: otherRight });
            }
            if (
              ['tr', 'mr', 'br'].includes(activeCorner) &&
              Math.abs(objRight - otherLeft) < snapThreshold
            ) {
              const newWidth = otherLeft - objLeft;
              newScaleX = newWidth / scalingObj.width;

              // For corner handles, maintain aspect ratio
              if (['tr', 'br'].includes(activeCorner)) {
                newScaleY = newScaleX;
              }

              snapLines.push({ type: 'vertical', position: otherLeft });
            }
            if (
              ['tr', 'mr', 'br'].includes(activeCorner) &&
              Math.abs(objRight - otherCenterX) < snapThreshold
            ) {
              const newWidth = otherCenterX - objLeft;
              newScaleX = newWidth / scalingObj.width;

              // For corner handles, maintain aspect ratio
              if (['tr', 'br'].includes(activeCorner)) {
                newScaleY = newScaleX;
              }

              snapLines.push({ type: 'vertical', position: otherCenterX });
            }

            // Left edge alignment with other objects (for left handles)
            if (
              ['tl', 'ml', 'bl'].includes(activeCorner) &&
              Math.abs(objLeft - otherLeft) < snapThreshold
            ) {
              const widthDiff = objLeft - otherLeft;
              const newWidth = objWidth + widthDiff;
              newScaleX = newWidth / scalingObj.width;

              // For corner handles, maintain aspect ratio
              if (['tl', 'bl'].includes(activeCorner)) {
                newScaleY = newScaleX;
              }

              snapLines.push({ type: 'vertical', position: otherLeft });
            }
            if (
              ['tl', 'ml', 'bl'].includes(activeCorner) &&
              Math.abs(objLeft - otherRight) < snapThreshold
            ) {
              const widthDiff = objLeft - otherRight;
              const newWidth = objWidth + widthDiff;
              newScaleX = newWidth / scalingObj.width;

              // For corner handles, maintain aspect ratio
              if (['tl', 'bl'].includes(activeCorner)) {
                newScaleY = newScaleX;
              }

              snapLines.push({ type: 'vertical', position: otherRight });
            }
            if (
              ['tl', 'ml', 'bl'].includes(activeCorner) &&
              Math.abs(objLeft - otherCenterX) < snapThreshold
            ) {
              const widthDiff = objLeft - otherCenterX;
              const newWidth = objWidth + widthDiff;
              newScaleX = newWidth / scalingObj.width;

              // For corner handles, maintain aspect ratio
              if (['tl', 'bl'].includes(activeCorner)) {
                newScaleY = newScaleX;
              }

              snapLines.push({ type: 'vertical', position: otherCenterX });
            }

            // Bottom edge alignment with other objects (for bottom handles)
            if (
              ['bl', 'mb', 'br'].includes(activeCorner) &&
              Math.abs(objBottom - otherBottom) < snapThreshold
            ) {
              const newHeight = otherBottom - objTop;
              newScaleY = newHeight / scalingObj.height;

              // For corner handles, maintain aspect ratio
              if (['bl', 'br'].includes(activeCorner)) {
                newScaleX = newScaleY;
              }

              snapLines.push({ type: 'horizontal', position: otherBottom });
            }
            if (
              ['bl', 'mb', 'br'].includes(activeCorner) &&
              Math.abs(objBottom - otherTop) < snapThreshold
            ) {
              const newHeight = otherTop - objTop;
              newScaleY = newHeight / scalingObj.height;

              // For corner handles, maintain aspect ratio
              if (['bl', 'br'].includes(activeCorner)) {
                newScaleX = newScaleY;
              }

              snapLines.push({ type: 'horizontal', position: otherTop });
            }
            if (
              ['bl', 'mb', 'br'].includes(activeCorner) &&
              Math.abs(objBottom - otherCenterY) < snapThreshold
            ) {
              const newHeight = otherCenterY - objTop;
              newScaleY = newHeight / scalingObj.height;

              // For corner handles, maintain aspect ratio
              if (['bl', 'br'].includes(activeCorner)) {
                newScaleX = newScaleY;
              }

              snapLines.push({ type: 'horizontal', position: otherCenterY });
            }

            // Top edge alignment with other objects (for top handles)
            if (
              ['tl', 'mt', 'tr'].includes(activeCorner) &&
              Math.abs(objTop - otherTop) < snapThreshold
            ) {
              const heightDiff = objTop - otherTop;
              const newHeight = objHeight + heightDiff;
              newScaleY = newHeight / scalingObj.height;

              // For corner handles, maintain aspect ratio
              if (['tl', 'tr'].includes(activeCorner)) {
                newScaleX = newScaleY;
              }

              snapLines.push({ type: 'horizontal', position: otherTop });
            }
            if (
              ['tl', 'mt', 'tr'].includes(activeCorner) &&
              Math.abs(objTop - otherBottom) < snapThreshold
            ) {
              const heightDiff = objTop - otherBottom;
              const newHeight = objHeight + heightDiff;
              newScaleY = newHeight / scalingObj.height;

              // For corner handles, maintain aspect ratio
              if (['tl', 'tr'].includes(activeCorner)) {
                newScaleX = newScaleY;
              }

              snapLines.push({ type: 'horizontal', position: otherBottom });
            }
            if (
              ['tl', 'mt', 'tr'].includes(activeCorner) &&
              Math.abs(objTop - otherCenterY) < snapThreshold
            ) {
              const heightDiff = objTop - otherCenterY;
              const newHeight = objHeight + heightDiff;
              newScaleY = newHeight / scalingObj.height;

              // For corner handles, maintain aspect ratio
              if (['tl', 'tr'].includes(activeCorner)) {
                newScaleX = newScaleY;
              }

              snapLines.push({ type: 'horizontal', position: otherCenterY });
            }
          }

          // Apply snapping - only modify scale, let fabric.js handle position
          // Defensive check to prevent uniScaleKey errors during scaling
          if (scalingObj && typeof scalingObj.set === 'function') {
            scalingObj.set({
              scaleX: newScaleX,
              scaleY: newScaleY,
            });
          }

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

          safeRenderAll(canvas);
        }
      }

      // Use unified system updates for scaling objects
      if (scalingObj.id && scalingObj.elementType) {
        debouncedTargetedUpdate(() => {
          const updates = {
            x: scalingObj.left || 0,
            y: scalingObj.top || 0,
            width: Math.round(
              (scalingObj.width || 100) * (scalingObj.scaleX || 1)
            ),
            height: Math.round(
              (scalingObj.height || 40) * (scalingObj.scaleY || 1)
            ),
          };

          updateElement(scalingObj.id, updates);
        });
      }
    };

    const handleMouseUp = () => {
      // Clear snap lines when mouse is released
      canvas.getObjects().forEach((obj: any) => {
        if (obj.isSnapLine) {
          canvas.remove(obj);
        }
      });
      safeRenderAll(canvas);

      // Reset user interaction flag after mouse up - this is the safe time to allow canvas rebuilds
      setTimeout(() => {
        isUserInteracting.current = false;
      }, 100);
    };

    const handleSelection = () => {
      // Clear snap lines when selecting objects
      canvas.getObjects().forEach((obj: any) => {
        if (obj.isSnapLine) {
          canvas.remove(obj);
        }
      });
      safeRenderAll(canvas);

      // Don't automatically reset interaction flag for selections
      // Let mouse up events handle the reset timing
    };

    // Safety mechanism to reset interaction flag if it gets stuck
    const handleSelectionCleared = () => {
      // When selection is cleared, safe to reset interaction flag
      setTimeout(() => {
        isUserInteracting.current = false;
      }, 50);
    };

    // Remove any existing handlers first to prevent duplicates
    canvas.off('object:modified');
    canvas.off('object:moving');
    canvas.off('object:scaling');
    canvas.off('mouse:up');
    canvas.off('selection:created');
    canvas.off('selection:updated');
    canvas.off('selection:cleared');

    canvas.on('object:modified', handleObjectModified);
    canvas.on('object:moving', handleObjectMoving);
    canvas.on('object:scaling', handleObjectScaling);
    canvas.on('mouse:up', handleMouseUp);
    canvas.on('selection:created', handleSelection);
    canvas.on('selection:updated', handleSelection);
    canvas.on('selection:cleared', handleSelectionCleared);

    return () => {
      canvas.off('object:modified', handleObjectModified);
      canvas.off('object:moving', handleObjectMoving);
      canvas.off('object:scaling', handleObjectScaling);
      canvas.off('mouse:up', handleMouseUp);
      canvas.off('selection:created', handleSelection);
      canvas.off('selection:updated', handleSelection);
      canvas.off('selection:cleared', handleSelectionCleared);
    };
  }, [
    snapToGuides,
    aspectRatioLocked,
    debouncedTargetedUpdate,
    updateElement,
    updateElementProperties,
    safeRenderAll,
    calculateTextLayout,
    getFontMetrics,
  ]);

  // Function to enforce proper z-order based on layerOrder
  const enforceLayerOrder = useCallback(
    (canvas: any, elements: any[]) => {
      const canvasObjects = canvas
        .getObjects()
        .filter(
          (obj: any) =>
            !obj.isSnapLine &&
            !obj.isSelectionOutline &&
            (obj.id || obj.layerOrder !== undefined)
        );

      // Sort canvas objects by their layerOrder (stored directly on object or from element data)
      const objectsWithLayerOrder = canvasObjects
        .map((obj: any) => {
          let layerOrder = obj.layerOrder;

          // If no layerOrder on object, find it from elements array
          if (layerOrder === undefined && obj.id) {
            const element = elements.find((el) => el.id === obj.id);
            layerOrder = element?.layerOrder || 0;
          }

          return {
            obj,
            layerOrder: layerOrder || 0,
          };
        })
        .sort((a: any, b: any) => a.layerOrder - b.layerOrder);

      // Move objects to correct z-order (bottom to top)
      objectsWithLayerOrder.forEach(({ obj }: any, index: number) => {
        canvas.moveTo(obj, index);
      });

      safeRenderAll(canvas);
    },
    [safeRenderAll]
  );

  // Function to render elements using the new unified layering system
  const renderUnifiedElements = useCallback(
    (canvas: any, elements: any[], previewCollectionConfig: any) => {
      // Sort elements by layerOrder for proper rendering sequence
      const sortedElements = [...elements].sort(
        (a, b) => a.layerOrder - b.layerOrder
      );

      // Render all elements first
      sortedElements.forEach((element) => {
        switch (element.type) {
          case 'raster':
            renderRasterElement(canvas, element);
            break;
          case 'svg':
            renderSVGElement(canvas, element, previewCollectionConfig);
            break;
          case 'text':
            renderTextElement(canvas, element, previewCollectionConfig);
            break;
          case 'content-grid':
            renderContentGridElement(canvas, element, previewCollectionConfig);
            break;
        }
      });

      // Enforce layer order immediately after adding elements
      enforceLayerOrder(canvas, sortedElements);

      // Also enforce after a delay for async elements (images, SVGs)
      setTimeout(() => {
        enforceLayerOrder(canvas, sortedElements);
      }, 200);

      // Additional enforcement after longer delay for slow-loading elements
      setTimeout(() => {
        enforceLayerOrder(canvas, sortedElements);
      }, 500);
    },
    [
      renderRasterElement,
      renderSVGElement,
      renderTextElement,
      renderContentGridElement,
      enforceLayerOrder,
    ]
  );

  // Track previous posterData to detect what changed
  const previousPosterDataRef = useRef<PosterEditorData>(posterData);

  // Render canvas content based on poster data
  useEffect(() => {
    if (!fabricCanvasRef.current || !fabric || !isInitialized) {
      return;
    }

    // For templates using source colors, wait for source colors data to be available
    if (posterData.background.useSourceColors && !sourceColorsData) {
      return;
    }

    // Only skip re-rendering if we're in the middle of a canvas manipulation
    // AND this is a change that's coming from that same manipulation (not external)
    if (isUserInteracting.current && isExternalUpdate.current === false) {
      return;
    }

    // Clear any pending debounced updates to prevent them from overwriting
    // the incoming posterData changes from the toolbar
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current);
      updateTimeoutRef.current = undefined;
    }

    // Check if this is a background-only change (preserve element positions)
    const previousData = previousPosterDataRef.current;

    // Helper function to check if only background properties changed
    const isBackgroundOnlyChange = () => {
      // First render or no previous data - always rebuild
      if (!previousData) {
        return false;
      }

      // Major structural changes - always rebuild
      if (
        posterData.width !== previousData.width ||
        posterData.height !== previousData.height
      ) {
        return false;
      }

      // Check if elements have changed (unified system only)
      const elementsChanged =
        JSON.stringify(posterData.elements) !==
        JSON.stringify(previousData.elements);

      // If elements changed, not a background-only change
      if (elementsChanged) {
        return false;
      }

      // Check if only background properties changed
      const backgroundChanged =
        JSON.stringify(posterData.background) !==
        JSON.stringify(previousData.background);

      // Only return true if background changed but elements didn't
      return backgroundChanged;
    };

    // Update the ref for next comparison
    previousPosterDataRef.current = posterData;

    // Set flag to prevent debounced updates during external changes
    isExternalUpdate.current = true;

    const canvas = fabricCanvasRef.current;

    // Ensure canvas is ready before proceeding
    if (!canvas) {
      return;
    }

    const shouldPreserveElements = isBackgroundOnlyChange();

    // Only clear and rebuild if elements have changed
    // For background-only changes, just update the background
    if (!shouldPreserveElements) {
      // Clear existing objects first
      canvas.clear();
    }

    // Determine colors to use - priority: currently editing source > selected preview collection > defaults
    let primaryColor = posterData.background.color || '#6366f1';
    let secondaryColor = posterData.background.secondaryColor || '#1e1b4b';

    if (posterData.background.useSourceColors) {
      // If we're actively editing a source, show that source's colors
      // Otherwise, show the preview collection's colors
      const sourceToPreview =
        currentlyEditingSource || previewCollectionConfig?.type;

      if (sourceToPreview) {
        // Priority 1: Use local unsaved changes if they exist
        if (posterData.background.sourceColors?.[sourceToPreview]) {
          const localColors =
            posterData.background.sourceColors[sourceToPreview];
          primaryColor = localColors.primaryColor || primaryColor;
          secondaryColor = localColors.secondaryColor || secondaryColor;
        }
        // Priority 2: Fall back to saved colors from database
        else if (sourceColorsData?.sourceColors?.[sourceToPreview]) {
          const sourceColors = sourceColorsData.sourceColors[sourceToPreview];
          primaryColor = sourceColors.primaryColor || primaryColor;
          secondaryColor = sourceColors.secondaryColor || secondaryColor;
        }
      }
    }

    // Update canvas background after clearing
    if (
      posterData.background.useSourceColors &&
      !currentlyEditingSource &&
      !previewCollectionConfig?.type
    ) {
      // Show "Source Colours" placeholder when using source colors but not customizing AND no preview collection selected
      canvas.setBackgroundColor('#374151', () => {
        // Add repeating "Source Colours" text overlay
        const textElements: any[] = [];
        const textSize = 24;
        const spacing = 120;

        for (let x = 0; x < posterData.width; x += spacing) {
          for (let y = 0; y < posterData.height; y += spacing) {
            const text = new fabric.Text('Source Colours', {
              left: x + spacing / 2,
              top: y + spacing / 2,
              fontSize: textSize,
              fontFamily: 'Arial, sans-serif',
              fill: '#6b7280',
              opacity: 0.15,
              originX: 'center',
              originY: 'center',
              angle: -25,
              selectable: false,
              evented: false,
              excludeFromExport: true,
              isSourceColorOverlay: true, // Custom flag to identify these elements
            });
            textElements.push(text);
            canvas.add(text);
          }
        }
        safeRenderAll(canvas);
      });
    } else if (posterData.background.type === 'gradient' && fabric) {
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
      canvas.setBackgroundColor(gradient, () => safeRenderAll(canvas));
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
      canvas.setBackgroundColor(gradient, () => safeRenderAll(canvas));
    } else {
      canvas.setBackgroundColor(primaryColor, () => safeRenderAll(canvas));
    }

    // Only rebuild elements if they have changed
    if (!shouldPreserveElements) {
      // Always use unified layering system (users are migrated automatically)
      if (posterData.elements) {
        renderUnifiedElements(
          canvas,
          posterData.elements,
          previewCollectionConfig
        );
      }
    }

    // Force a re-render after a short delay to ensure any async elements
    // (images, SVGs, fonts) that may have failed initially get another chance
    const forceRenderTimeout = setTimeout(() => {
      if (
        fabricCanvasRef.current &&
        posterData.elements &&
        posterData.elements.length > 0
      ) {
        const canvasObjects = fabricCanvasRef.current
          .getObjects()
          .filter(
            (obj: any) =>
              !obj.isSnapLine &&
              !obj.isSelectionOutline &&
              !obj.isSourceColorOverlay
          );
        // If we have elements but no objects rendered (except background and overlays), try rendering again
        if (canvasObjects.length === 0) {
          renderUnifiedElements(
            fabricCanvasRef.current,
            posterData.elements,
            previewCollectionConfig
          );
        }
      }
    }, 100);

    // Cleanup timeout on unmount or re-render
    return () => {
      clearTimeout(forceRenderTimeout);
    };

    // Always update selection highlighting (this is lightweight)
    // Clear any existing selection outlines first
    const existingOutlines = canvas
      .getObjects()
      .filter((obj: any) => obj.isSelectionOutline);
    existingOutlines.forEach((outline: any) => canvas.remove(outline));

    // Add selection highlighting after all elements are rendered
    if (selectedElementId) {
      canvas.getObjects().forEach((obj: any) => {
        if (obj.id === selectedElementId) {
          // Add a dashed border around the selected element
          const bounds = obj.getBoundingRect();
          const outline = new fabric.Rect({
            left: bounds.left - 2,
            top: bounds.top - 2,
            width: bounds.width + 4,
            height: bounds.height + 4,
            fill: 'transparent',
            stroke: '#ff6b35', // Orange outline color
            strokeWidth: 2,
            strokeDashArray: [5, 5],
            selectable: false,
            evented: false,
            excludeFromExport: true,
            isSelectionOutline: true, // Custom flag to identify outline objects
          });
          canvas.add(outline);
          canvas.bringToFront(outline);
        }
      });
    }

    safeRenderAll(canvas);

    // Reset external update flag immediately after rendering is complete
    isExternalUpdate.current = false;
  }, [
    posterData,
    previewCollectionConfig,
    isInitialized,
    currentlyEditingSource,
    selectedElementId,
    sourceColorsData,
    safeRenderAll,
    renderUnifiedElements,
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
