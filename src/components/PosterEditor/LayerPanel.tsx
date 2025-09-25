import { fontLoader } from '@app/utils/fontLoader';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CodeBracketSquareIcon,
  DocumentTextIcon,
  PhotoIcon,
  PlusIcon,
  Squares2X2Icon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { defineMessages, useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';
import type {
  ContentGridProps,
  LayeredElement,
  PosterEditorData,
  RasterElementProps,
  SVGElementProps,
  TextElementProps,
} from './PosterEditorModal';

const messages = defineMessages({
  layers: 'Layers',
  addText: 'Add Text',
  addImage: 'Add Image',
  addIcon: 'Add Icon',
  addGrid: 'Add Grid',
  moveUp: 'Move Up',
  moveDown: 'Move Down',
  deleteElement: 'Delete Element',
  properties: 'Properties',
  collectionTitle: 'Collection Title',
  customText: 'Custom Text',
  rasterImage: 'Image',
  sourceIcon: 'Source Icon',
  customIcon: 'Custom Icon',
  contentGrid: 'Content Grid',
  noElementSelected: 'Select an element to edit its properties',
  // Text properties
  fontSize: 'Font Size',
  fontFamily: 'Font Family',
  fontWeight: 'Font Weight',
  fontStyle: 'Font Style',
  textColor: 'Text Color',
  textAlign: 'Text Align',
  maxLines: 'Max Lines',
  left: 'Left',
  center: 'Center',
  right: 'Right',
  normal: 'Normal',
  bold: 'Bold',
  italic: 'Italic',
  // Size properties
  width: 'Width',
  height: 'Height',
  lockAspectRatio: 'Lock aspect ratio',
  // Image/Icon properties
  selectImage: 'Select Image',
  selectIcon: 'Select Icon',
  // Grid properties
  columns: 'Columns',
  rows: 'Rows',
  spacing: 'Spacing',
  cornerRadius: 'Corner Radius',
  // Background properties
  background: 'Background',
  backgroundType: 'Type',
  color: 'Color',
  gradient: 'Gradient',
  radial: 'Radial Gradient',
  intensity: 'Intensity',
  primaryColor: 'Primary Color',
  secondaryColor: 'Secondary Color',
  useSourceColors: 'Use Source Colors',
  sourceType: 'Source Type',
  customizeColors: 'Customize Colors',
  setSourceColors: 'Set Source Colors',
  saveSourceColors: 'Save Colors',
  sourceColorsSaved: 'Colors Saved!',
  snapToGuides: 'Snap to Guides',
});

interface IconSelectorProps {
  value: string;
  onChange: (iconPath: string) => void;
  id?: string;
  filter?: 'raster' | 'svg' | 'all';
  addToast?: (
    message: string,
    options?: {
      appearance?: 'success' | 'error' | 'warning' | 'info';
      autoDismiss?: boolean;
    }
  ) => void;
}

interface FontInfo {
  family: string;
  availableWeights: string[];
  cssValue: string;
  fontUrl?: string;
}

const FontOptions: React.FC = () => {
  const { data: fontsData, error } = useSWR<{
    fonts: FontInfo[];
    count: number;
  }>('/api/v1/fonts');

  // Ensure fonts are loaded when FontOptions is used (safety fallback)
  useEffect(() => {
    if (fontsData?.fonts) {
      const fontsToLoad = fontsData.fonts
        .filter((font) => font.fontUrl && !fontLoader.isFontLoaded(font.family))
        .map((font) => ({ family: font.family, fontUrl: font.fontUrl || '' }))
        .filter((font) => font.fontUrl);

      if (fontsToLoad.length > 0) {
        fontLoader.loadFonts(fontsToLoad).catch(() => {
          // Font loading failed - continue with fallbacks
        });
      }
    }
  }, [fontsData]);

  if (error) {
    // Fallback to basic system fonts if API fails
    const fallbackFonts = [
      { family: 'Inter', cssValue: 'Inter' },
      { family: 'Arial', cssValue: 'Arial' },
      { family: 'Georgia', cssValue: 'Georgia' },
      { family: 'Courier New', cssValue: "'Courier New'" },
    ];

    return (
      <>
        {fallbackFonts.map((font) => (
          <option key={font.family} value={font.cssValue}>
            {font.family}
          </option>
        ))}
      </>
    );
  }

  if (!fontsData) {
    return <option value="Arial, sans-serif">Loading fonts...</option>;
  }

  return (
    <>
      {fontsData.fonts.map((font) => (
        <option key={font.family} value={font.cssValue}>
          {font.family}
        </option>
      ))}
    </>
  );
};

const IconSelector: React.FC<IconSelectorProps> = ({
  value,
  onChange,
  id,
  filter = 'all',
  addToast,
}) => {
  const { data: iconsData } = useSWR<{
    icons: {
      id: string;
      name: string;
      filename: string;
      type: 'system' | 'user';
      category: string;
      description: string;
    }[];
  }>('/api/v1/posters/icons');
  const [isOpen, setIsOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({
    top: 0,
    left: 0,
    width: 0,
  });
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Calculate dropdown position
  const calculateDropdownPosition = useCallback(() => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const dropdownWidth = 384; // w-96 = 384px

      // Calculate initial position
      let left = rect.left + window.scrollX;
      let top = rect.bottom + window.scrollY + 4;

      // Adjust if dropdown would go off the right edge of viewport
      if (left + dropdownWidth > window.innerWidth) {
        left = rect.right + window.scrollX - dropdownWidth; // Align right edge with button right edge
      }

      // Adjust if dropdown would go off the bottom edge of viewport
      if (top + 300 > window.innerHeight + window.scrollY) {
        // 300px estimated dropdown height
        top = rect.top + window.scrollY - 300 - 4; // Show above the button
      }

      const position = {
        top,
        left: Math.max(8, left), // Ensure at least 8px from left edge
        width: rect.width,
      };
      setDropdownPosition(position);
    }
  }, []);

  // Recalculate position when dropdown opens
  useEffect(() => {
    if (isOpen) {
      calculateDropdownPosition();
    }
  }, [isOpen, calculateDropdownPosition]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () =>
        document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const icons = iconsData?.icons || [];

  // Helper function to determine if file is raster or SVG
  const getFileType = (filename: string): 'raster' | 'svg' => {
    const rasterExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
    const lowerFilename = filename.toLowerCase();
    return rasterExtensions.some((ext) => lowerFilename.endsWith(ext))
      ? 'raster'
      : 'svg';
  };

  // Filter icons by file type only
  let filteredIcons = icons;
  if (filter === 'raster') {
    filteredIcons = icons.filter(
      (icon) => getFileType(icon.filename) === 'raster'
    );
  } else if (filter === 'svg') {
    filteredIcons = icons.filter(
      (icon) => getFileType(icon.filename) === 'svg'
    );
  }

  const selectedIcon = icons.find(
    (icon) => value === `/api/v1/posters/icons/${icon.type}/${icon.filename}`
  );

  // Handle file upload
  const handleFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file size (10MB limit from server)
    if (file.size > 10 * 1024 * 1024) {
      addToast?.('File too large. Maximum size is 10MB.', {
        appearance: 'error',
        autoDismiss: true,
      });
      return;
    }

    // Validate file type based on filter
    let allowedTypes: string[] = [];
    let errorMessage = '';

    if (filter === 'raster') {
      allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
      errorMessage =
        'Invalid file type. Only JPEG, PNG, and WebP files are allowed for raster images.';
    } else if (filter === 'svg') {
      allowedTypes = ['image/svg+xml'];
      errorMessage = 'Invalid file type. Only SVG files are allowed for icons.';
    } else {
      // 'all' filter
      allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'];
      errorMessage =
        'Invalid file type. Only JPEG, PNG, WebP, and SVG files are allowed.';
    }

    if (!allowedTypes.includes(file.type)) {
      addToast?.(errorMessage, {
        appearance: 'error',
        autoDismiss: true,
      });
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('icon', file);
      formData.append('name', file.name.split('.')[0]); // Remove extension for name
      formData.append('category', 'user-uploads');

      const response = await fetch('/upload-icon', {
        method: 'POST',
        body: formData,
        // Don't set Content-Type - let browser set it with proper boundary
      });

      if (response.ok) {
        const result = await response.json();
        const iconPath = `/api/v1/posters/icons/${result.icon.type}/${result.icon.filename}`;

        // Refresh icons list
        mutate('/api/v1/posters/icons');

        // Select the newly uploaded icon
        onChange(iconPath);
        setIsOpen(false);

        addToast?.('Icon uploaded successfully!', {
          appearance: 'success',
          autoDismiss: true,
        });
      } else {
        const errorData = await response
          .json()
          .catch(() => ({ error: 'Upload failed' }));
        addToast?.(`Failed to upload icon: ${errorData.error}`, {
          appearance: 'error',
          autoDismiss: true,
        });
      }
    } catch (error) {
      addToast?.('Error uploading icon. Please try again.', {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsUploading(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="relative">
      {/* Selected icon display / trigger button */}
      <button
        type="button"
        ref={buttonRef}
        id={id}
        onClick={() => {
          if (!isOpen) {
            calculateDropdownPosition();
            setIsOpen(true);
          } else {
            setIsOpen(false);
          }
        }}
        className="flex w-full items-center justify-between rounded border border-stone-600 bg-stone-800 px-2 py-1 text-xs text-white hover:border-stone-500 focus:border-orange-500 focus:outline-none"
      >
        <div className="flex items-center space-x-2">
          {selectedIcon ? (
            <>
              <img
                src={`/api/v1/posters/icons/${selectedIcon.type}/${selectedIcon.filename}`}
                alt={selectedIcon.name}
                className="h-4 w-4 object-contain"
              />
              <span>{selectedIcon.name}</span>
            </>
          ) : (
            <span className="text-stone-400">
              {filter === 'raster' ? 'Select an image...' : 'Select an icon...'}
            </span>
          )}
        </div>
        <svg
          className={`h-4 w-4 transition-transform ${
            isOpen ? 'rotate-180' : ''
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {/* Dropdown Portal */}
      {isOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[9999] w-96 rounded border border-stone-600 bg-stone-800 shadow-lg"
            style={{
              top: dropdownPosition.top,
              left: dropdownPosition.left,
              minWidth: Math.max(dropdownPosition.width, 384), // 384px = w-96
            }}
          >
            {/* Upload button */}
            <div className="border-b border-stone-700 p-2">
              <input
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                className="hidden"
                ref={fileInputRef}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="flex w-full items-center justify-center space-x-2 rounded border border-stone-600 bg-stone-700 px-2 py-1 text-xs text-white hover:bg-stone-600 focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isUploading ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    <span>Uploading...</span>
                  </>
                ) : (
                  <>
                    <PlusIcon className="h-4 w-4" />
                    <span>
                      {filter === 'raster' ? 'Upload Image' : 'Upload Icon'}
                    </span>
                  </>
                )}
              </button>
            </div>

            {/* Icon grid */}
            <div className="max-h-72 overflow-y-auto p-2">
              <div
                className={`grid ${
                  filter === 'raster'
                    ? 'grid-cols-3 gap-1'
                    : 'grid-cols-5 gap-2'
                }`}
              >
                {filteredIcons.map((icon) => {
                  const iconPath = `/api/v1/posters/icons/${icon.type}/${icon.filename}`;
                  const isSelected = value === iconPath;

                  return (
                    <button
                      key={icon.id}
                      type="button"
                      onClick={() => {
                        onChange(iconPath);
                        setIsOpen(false);
                      }}
                      className={`group flex items-center justify-center rounded p-2 hover:bg-stone-700 focus:outline-none focus:ring-2 focus:ring-orange-500 ${
                        isSelected ? 'bg-orange-600 hover:bg-orange-700' : ''
                      }`}
                      title={`${icon.name} (${icon.category})`}
                    >
                      <img
                        src={iconPath}
                        alt={icon.name}
                        className={
                          filter === 'raster'
                            ? 'h-20 w-20 object-contain'
                            : 'h-12 w-12 object-contain'
                        }
                      />
                    </button>
                  );
                })}
              </div>

              {filteredIcons.length === 0 && (
                <div className="py-4 text-center text-xs text-stone-400">
                  {filter === 'raster' ? 'No images found' : 'No icons found'}
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

interface LayerPanelProps {
  posterData: PosterEditorData;
  onChange: (data: PosterEditorData) => void;
  selectedElementId?: string;
  onElementSelect: (elementId: string | undefined) => void;
  mode: string;
  snapToGuides?: boolean;
  onSnapToGuidesChange?: (snap: boolean) => void;
  onCurrentlyEditingSourceChange?: (source: string | undefined) => void;
  addToast?: (
    message: string,
    options?: {
      appearance?: 'success' | 'error' | 'warning' | 'info';
      autoDismiss?: boolean;
    }
  ) => void;
  aspectRatioLocked?: Record<string, boolean>;
  onAspectRatioLockedChange?: (locked: Record<string, boolean>) => void;
}

export const LayerPanel: React.FC<LayerPanelProps> = ({
  posterData,
  onChange,
  selectedElementId,
  onElementSelect,
  mode,
  snapToGuides,
  onSnapToGuidesChange,
  onCurrentlyEditingSourceChange,
  addToast,
  aspectRatioLocked = {},
  onAspectRatioLockedChange,
}) => {
  const intl = useIntl();
  const [localSliderValues, setLocalSliderValues] = useState<
    Record<string, number>
  >({});
  const [localTextValues, setLocalTextValues] = useState<
    Record<string, string>
  >({});
  const [selectedSourceType, setSelectedSourceType] = useState<string>('trakt');
  const [saveStatus, setSaveStatus] = useState<string>('');
  const [isSourceColorsExpanded, setIsSourceColorsExpanded] = useState(false);
  const textUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Get elements or create from legacy structure (memoized to prevent re-renders)
  const elements = useMemo(
    () => posterData.elements || [],
    [posterData.elements]
  );

  // Sort elements by layer order for display (reverse order so top elements appear first)
  const sortedElements = [...elements].sort(
    (a, b) => b.layerOrder - a.layerOrder
  );

  // Find selected element
  const selectedElement = selectedElementId
    ? elements.find((el) => el.id === selectedElementId)
    : undefined;

  const isTemplate = mode.includes('template');

  // Fetch source colors
  const { data: sourceColorsData } = useSWR<{
    sourceColors: Record<
      string,
      {
        primaryColor: string;
        secondaryColor: string;
        textColor: string;
      }
    >;
    sourceTypes: string[];
  }>('/api/v1/source-colors');

  // Debounced text update to prevent excessive re-renders during typing
  const debouncedTextUpdate = useCallback(
    (elementId: string, newText: string) => {
      if (textUpdateTimeoutRef.current) {
        clearTimeout(textUpdateTimeoutRef.current);
      }

      textUpdateTimeoutRef.current = setTimeout(() => {
        const elementIndex = elements.findIndex((el) => el.id === elementId);
        if (elementIndex !== -1) {
          const newElements = [...elements];
          const element = newElements[elementIndex];
          if (element.type === 'text') {
            newElements[elementIndex] = {
              ...element,
              properties: {
                ...element.properties,
                text: newText,
              } as TextElementProps,
            };
            onChange({
              ...posterData,
              elements: newElements,
            });
          }
        }
      }, 300); // 300ms delay after user stops typing
    },
    [elements, posterData, onChange]
  );

  // Update element function
  const updateElement = useCallback(
    (elementId: string, updates: Partial<LayeredElement>) => {
      const elementIndex = elements.findIndex((el) => el.id === elementId);
      if (elementIndex !== -1) {
        const newElements = [...elements];
        newElements[elementIndex] = {
          ...newElements[elementIndex],
          ...updates,
        };
        onChange({
          ...posterData,
          elements: newElements,
        });
      }
    },
    [elements, posterData, onChange]
  );

  // Update element properties
  const updateElementProperties = useCallback(
    (
      elementId: string,
      propertyUpdates: Partial<
        | TextElementProps
        | RasterElementProps
        | SVGElementProps
        | ContentGridProps
      >
    ) => {
      const elementIndex = elements.findIndex((el) => el.id === elementId);
      if (elementIndex !== -1) {
        const newElements = [...elements];
        const element = newElements[elementIndex];
        newElements[elementIndex] = {
          ...element,
          properties: {
            ...element.properties,
            ...propertyUpdates,
          },
        };
        onChange({
          ...posterData,
          elements: newElements,
        });
      }
    },
    [elements, posterData, onChange]
  );

  // Update background function
  const updateBackground = useCallback(
    (updates: Partial<PosterEditorData['background']>) => {
      onChange({
        ...posterData,
        background: { ...posterData.background, ...updates },
      });
    },
    [posterData, onChange]
  );

  // Update currently editing source when source colors section is expanded/collapsed or source changes
  useEffect(() => {
    if (onCurrentlyEditingSourceChange) {
      onCurrentlyEditingSourceChange(
        isSourceColorsExpanded ? selectedSourceType : undefined
      );
    }
  }, [
    isSourceColorsExpanded,
    selectedSourceType,
    onCurrentlyEditingSourceChange,
  ]);

  // Initialize source colors in posterData if not present
  useEffect(() => {
    if (
      isTemplate &&
      posterData.background.useSourceColors &&
      !posterData.background.sourceColors &&
      sourceColorsData
    ) {
      const initialSourceColors = { ...sourceColorsData.sourceColors };
      updateBackground({ sourceColors: initialSourceColors });
    }
  }, [
    sourceColorsData,
    posterData.background.useSourceColors,
    posterData.background.sourceColors,
    isTemplate,
    updateBackground,
  ]);

  const updateSourceColor = (
    sourceType: string,
    colorKey: string,
    colorValue: string
  ) => {
    const currentSourceColors = posterData.background.sourceColors || {};
    const currentSourceTypeColors = currentSourceColors[sourceType] ||
      sourceColorsData?.sourceColors[sourceType] || {
        primaryColor: '#6366f1',
        secondaryColor: '#1e1b4b',
        textColor: '#ffffff',
      };

    updateBackground({
      sourceColors: {
        ...currentSourceColors,
        [sourceType]: {
          ...currentSourceTypeColors,
          [colorKey]: colorValue,
        },
      },
    });
  };

  const saveSourceColors = async () => {
    try {
      const sourceColors = posterData.background.sourceColors || {};
      let allSuccessful = true;

      // Save each source type individually to the correct endpoint
      for (const [sourceType, colors] of Object.entries(sourceColors)) {
        const response = await fetch(`/api/v1/source-colors/${sourceType}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(colors),
        });

        if (!response.ok) {
          allSuccessful = false;
          break;
        }
      }

      if (allSuccessful) {
        setSaveStatus('Colors Saved!');
        setTimeout(() => setSaveStatus(''), 2000);

        // Invalidate the SWR cache to refresh source colors in preview
        mutate('/api/v1/source-colors');
      }
    } catch (error) {
      // Silently handle error - could be logged to monitoring service
    }
  };

  const handleReorderElement = useCallback(
    (elementId: string, direction: 'up' | 'down') => {
      const currentIndex = elements.findIndex((el) => el.id === elementId);
      if (currentIndex === -1) return;

      const newElements = [...elements];
      const element = newElements[currentIndex];

      // Find adjacent element in the specified direction
      let swapIndex = -1;
      if (direction === 'up') {
        // Moving up means higher layerOrder (rendered on top)
        const higherElements = elements.filter(
          (el) => el.layerOrder > element.layerOrder
        );
        if (higherElements.length > 0) {
          const nextElement = higherElements.reduce((prev, current) =>
            prev.layerOrder < current.layerOrder ? prev : current
          );
          swapIndex = elements.findIndex((el) => el.id === nextElement.id);
        }
      } else {
        // Moving down means lower layerOrder (rendered behind)
        const lowerElements = elements.filter(
          (el) => el.layerOrder < element.layerOrder
        );
        if (lowerElements.length > 0) {
          const nextElement = lowerElements.reduce((prev, current) =>
            prev.layerOrder > current.layerOrder ? prev : current
          );
          swapIndex = elements.findIndex((el) => el.id === nextElement.id);
        }
      }

      if (swapIndex !== -1) {
        // Swap layer orders
        const tempLayerOrder = newElements[currentIndex].layerOrder;
        newElements[currentIndex].layerOrder =
          newElements[swapIndex].layerOrder;
        newElements[swapIndex].layerOrder = tempLayerOrder;

        onChange({
          ...posterData,
          elements: newElements,
        });
      }
    },
    [elements, posterData, onChange]
  );

  const handleDeleteElement = useCallback(
    (elementId: string) => {
      const newElements = elements.filter((el) => el.id !== elementId);
      onChange({
        ...posterData,
        elements: newElements,
      });

      // Clear selection if deleted element was selected
      if (selectedElementId === elementId) {
        onElementSelect(undefined);
      }
    },
    [elements, posterData, onChange, selectedElementId, onElementSelect]
  );

  const handleAddElement = useCallback(
    (type: LayeredElement['type'], subtype?: string) => {
      const elementId = `${type}-${Date.now()}`;
      let newElement: LayeredElement;

      // Find highest layer order and add 1
      const maxLayerOrder =
        elements.length > 0
          ? Math.max(...elements.map((el) => el.layerOrder))
          : 0;

      // Calculate center position based on poster dimensions
      const centerX = (posterData.width - 200) / 2;
      const centerY = 200 + elements.length * 50; // Stack vertically

      switch (type) {
        case 'text':
          newElement = {
            id: elementId,
            layerOrder: maxLayerOrder + 1,
            type: 'text',
            x: centerX,
            y: centerY,
            width: 200,
            height: 50,
            properties: {
              elementType:
                subtype === 'collection-title'
                  ? 'collection-title'
                  : 'custom-text',
              text: subtype === 'collection-title' ? undefined : 'New Text',
              fontSize: 24,
              fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
              fontWeight: 'normal',
              fontStyle: 'normal',
              color: '#ffffff',
              textAlign: 'center',
              maxLines: 2,
            } as TextElementProps,
          };
          break;
        case 'raster':
          newElement = {
            id: elementId,
            layerOrder: maxLayerOrder + 1,
            type: 'raster',
            x: (posterData.width - 100) / 2,
            y: 150 + elements.length * 80,
            width: 100,
            height: 100,
            properties: {
              imagePath: '',
            } as RasterElementProps,
          };
          break;
        case 'svg':
          newElement = {
            id: elementId,
            layerOrder: maxLayerOrder + 1,
            type: 'svg',
            x: (posterData.width - 50) / 2,
            y: 100 + elements.length * 70,
            width: 50,
            height: 50,
            properties: {
              iconType:
                subtype === 'source-logo' ? 'source-logo' : 'custom-icon',
              iconPath: '',
            } as SVGElementProps,
          };
          break;
        case 'content-grid': {
          const columns = 2;
          const rows = 2;
          const spacing = 16;
          const cellWidth = 80;
          const cellHeight = cellWidth * 1.5; // 2:3 aspect ratio
          const totalWidth = cellWidth * columns + spacing * (columns - 1);
          const totalHeight = cellHeight * rows + spacing * (rows - 1);

          newElement = {
            id: elementId,
            layerOrder: maxLayerOrder + 1,
            type: 'content-grid',
            x: (posterData.width - totalWidth) / 2,
            y: 450,
            width: totalWidth,
            height: totalHeight,
            properties: {
              columns,
              rows,
              spacing,
              cornerRadius: 6,
            } as ContentGridProps,
          };
          break;
        }
        default:
          return;
      }

      onChange({
        ...posterData,
        elements: [...elements, newElement],
      });

      // Select the new element
      onElementSelect(elementId);
    },
    [elements, posterData, onChange, onElementSelect]
  );

  const getElementIcon = (type: LayeredElement['type']) => {
    switch (type) {
      case 'text':
        return DocumentTextIcon;
      case 'raster':
        return PhotoIcon;
      case 'svg':
        return CodeBracketSquareIcon;
      case 'content-grid':
        return Squares2X2Icon;
      default:
        return DocumentTextIcon;
    }
  };

  const getElementLabel = (element: LayeredElement) => {
    switch (element.type) {
      case 'text': {
        const props = element.properties as TextElementProps;
        return props.elementType === 'collection-title'
          ? intl.formatMessage(messages.collectionTitle)
          : props.text || intl.formatMessage(messages.customText);
      }
      case 'raster':
        return intl.formatMessage(messages.rasterImage);
      case 'svg': {
        const props = element.properties as SVGElementProps;
        return props.iconType === 'source-logo'
          ? intl.formatMessage(messages.sourceIcon)
          : intl.formatMessage(messages.customIcon);
      }
      case 'content-grid':
        return intl.formatMessage(messages.contentGrid);
      default:
        return element.id;
    }
  };

  const getElementPreview = (element: LayeredElement) => {
    switch (element.type) {
      case 'text': {
        const props = element.properties as TextElementProps;
        return (
          <div
            className="flex h-6 w-8 items-center justify-center rounded bg-stone-600 text-xs font-medium text-white"
            style={{
              fontSize: '8px',
              fontFamily: props.fontFamily || 'inherit',
              fontWeight: props.fontWeight || 'normal',
              color: props.color || '#ffffff',
            }}
          >
            {props.elementType === 'collection-title' ? 'T' : 'Aa'}
          </div>
        );
      }
      case 'raster': {
        const props = element.properties as RasterElementProps;
        return (
          <div className="flex h-6 w-8 items-center justify-center rounded bg-gradient-to-br from-blue-500 to-purple-600">
            {props.imagePath ? (
              <img
                src={props.imagePath}
                alt="Preview"
                className="h-full w-full rounded object-cover"
                onError={(e) => {
                  // Fallback to icon if image fails to load
                  const target = e.target as HTMLImageElement;
                  target.style.display = 'none';
                  target.nextElementSibling?.classList.remove('hidden');
                }}
              />
            ) : null}
            <PhotoIcon className="h-4 w-4 text-white" />
          </div>
        );
      }
      case 'svg': {
        const props = element.properties as SVGElementProps;
        return (
          <div className="flex h-6 w-8 items-center justify-center rounded bg-gradient-to-br from-green-500 to-teal-600">
            {props.iconPath && !props.iconPath.startsWith('/') ? (
              <img
                src={props.iconPath}
                alt="Preview"
                className="h-4 w-4 object-contain"
                onError={(e) => {
                  // Fallback to icon if SVG fails to load
                  const target = e.target as HTMLImageElement;
                  target.style.display = 'none';
                  target.nextElementSibling?.classList.remove('hidden');
                }}
              />
            ) : null}
            <CodeBracketSquareIcon className="h-4 w-4 text-white" />
          </div>
        );
      }
      case 'content-grid': {
        const props = element.properties as ContentGridProps;
        return (
          <div className="flex h-6 w-8 items-center justify-center rounded bg-gradient-to-br from-orange-500 to-red-600">
            <div
              className="grid h-4 w-5 gap-0.5"
              style={{
                gridTemplateColumns: `repeat(${Math.min(
                  props.columns,
                  3
                )}, 1fr)`,
                gridTemplateRows: `repeat(${Math.min(props.rows, 2)}, 1fr)`,
              }}
            >
              {Array.from({
                length: Math.min(props.columns * props.rows, 6),
              }).map((_, i) => (
                <div key={i} className="rounded-sm bg-white opacity-80" />
              ))}
            </div>
          </div>
        );
      }
      default:
        return (
          <div className="flex h-6 w-8 items-center justify-center rounded bg-stone-600">
            <DocumentTextIcon className="h-4 w-4 text-white" />
          </div>
        );
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-4 p-4">
        {/* Snap to Guides - Top Level Control */}
        {onSnapToGuidesChange && (
          <div className="border-b border-stone-700 pb-4">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={snapToGuides || false}
                onChange={(e) => onSnapToGuidesChange(e.target.checked)}
                className="rounded border-stone-600 bg-stone-800 text-orange-600 focus:ring-orange-500"
              />
              <span className="text-xs text-stone-300">
                {intl.formatMessage(messages.snapToGuides)}
              </span>
            </label>
          </div>
        )}

        {/* 1. Background Controls Section */}
        <div className="space-y-3 border-b border-stone-700 pb-4">
          <h3 className="text-sm font-medium text-stone-300">
            {intl.formatMessage(messages.background)}
          </h3>

          {/* Background Type */}
          <div>
            <label className="mb-1 block text-xs text-stone-400">
              {intl.formatMessage(messages.backgroundType)}
            </label>
            <select
              value={posterData.background.type}
              onChange={(e) =>
                updateBackground({
                  type: (e.target as HTMLSelectElement).value as
                    | 'color'
                    | 'gradient'
                    | 'radial',
                })
              }
              className="w-full rounded border border-stone-600 bg-stone-700 px-2 py-1 text-xs text-white focus:border-orange-500 focus:outline-none"
            >
              <option value="color">
                {intl.formatMessage(messages.color)}
              </option>
              <option value="gradient">
                {intl.formatMessage(messages.gradient)}
              </option>
              <option value="radial">
                {intl.formatMessage(messages.radial)}
              </option>
            </select>
          </div>

          {/* Intensity slider for gradients */}
          {(posterData.background.type === 'gradient' ||
            posterData.background.type === 'radial') && (
            <div>
              <label className="mb-1 block text-xs text-stone-400">
                {intl.formatMessage(messages.intensity)} (
                {localSliderValues['backgroundIntensity'] ??
                  (posterData.background.intensity || 50)}
                %)
              </label>
              <input
                type="range"
                min="0"
                max="100"
                value={
                  localSliderValues['backgroundIntensity'] ??
                  (posterData.background.intensity || 50)
                }
                onInput={(e) => {
                  setLocalSliderValues((prev) => ({
                    ...prev,
                    backgroundIntensity: parseInt(
                      (e.target as HTMLInputElement).value
                    ),
                  }));
                }}
                onChange={(e) => {
                  const newIntensity = parseInt(
                    (e.target as HTMLInputElement).value
                  );
                  updateBackground({ intensity: newIntensity });
                  setLocalSliderValues((prev) => {
                    const newState = { ...prev };
                    delete newState.backgroundIntensity;
                    return newState;
                  });
                }}
                className="w-full"
              />
            </div>
          )}

          {/* Source Colors option for templates */}
          {isTemplate && (
            <div className="space-y-2">
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={posterData.background.useSourceColors || false}
                  onChange={(e) => {
                    updateBackground({
                      useSourceColors: e.target.checked,
                      sourceColors: e.target.checked
                        ? sourceColorsData?.sourceColors || {}
                        : undefined,
                    });
                  }}
                  className="rounded border-stone-600 bg-stone-800 text-orange-600 focus:ring-orange-500"
                />
                <span className="text-xs text-stone-300">
                  {intl.formatMessage(messages.useSourceColors)}
                </span>
              </label>

              {posterData.background.useSourceColors && sourceColorsData && (
                <div className="space-y-2 border-l border-stone-600 pl-4">
                  <button
                    type="button"
                    onClick={() =>
                      setIsSourceColorsExpanded(!isSourceColorsExpanded)
                    }
                    className="flex w-full items-center space-x-2 py-1 text-xs font-medium text-stone-300 hover:text-white focus:outline-none"
                  >
                    <svg
                      className={`h-3 w-3 transition-transform ${
                        isSourceColorsExpanded ? 'rotate-90' : ''
                      }`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                    <span>{intl.formatMessage(messages.customizeColors)}</span>
                  </button>

                  {isSourceColorsExpanded && (
                    <div className="space-y-2">
                      {/* Source Type Selector */}
                      <div>
                        <label className="mb-1 block text-xs text-stone-400">
                          {intl.formatMessage(messages.sourceType)}
                        </label>
                        <select
                          value={selectedSourceType}
                          onChange={(e) =>
                            setSelectedSourceType(
                              (e.target as HTMLSelectElement).value
                            )
                          }
                          className="w-full rounded border border-stone-600 bg-stone-700 px-2 py-1 text-xs text-white focus:border-orange-500 focus:outline-none"
                        >
                          {Object.keys(sourceColorsData.sourceColors).map(
                            (sourceType) => (
                              <option key={sourceType} value={sourceType}>
                                {sourceType.charAt(0).toUpperCase() +
                                  sourceType.slice(1)}
                              </option>
                            )
                          )}
                        </select>
                      </div>

                      {/* Background Colors */}
                      <div className="space-y-2">
                        <h6 className="text-xs font-medium text-stone-400">
                          Background Colors
                        </h6>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label
                              htmlFor={`primary-color-${selectedSourceType}`}
                              className="mb-1 block text-xs text-stone-400"
                            >
                              Primary
                            </label>
                            <input
                              id={`primary-color-${selectedSourceType}`}
                              type="color"
                              value={
                                posterData.background.sourceColors?.[
                                  selectedSourceType
                                ]?.primaryColor ||
                                sourceColorsData.sourceColors[
                                  selectedSourceType
                                ]?.primaryColor ||
                                '#6366f1'
                              }
                              onChange={(e) =>
                                updateSourceColor(
                                  selectedSourceType,
                                  'primaryColor',
                                  (e.target as HTMLInputElement).value
                                )
                              }
                              className="h-6 w-full rounded border border-stone-600"
                            />
                          </div>

                          <div>
                            <label
                              htmlFor={`secondary-color-${selectedSourceType}`}
                              className="mb-1 block text-xs text-stone-400"
                            >
                              Secondary
                            </label>
                            <input
                              id={`secondary-color-${selectedSourceType}`}
                              type="color"
                              value={
                                posterData.background.sourceColors?.[
                                  selectedSourceType
                                ]?.secondaryColor ||
                                sourceColorsData.sourceColors[
                                  selectedSourceType
                                ]?.secondaryColor ||
                                '#1e1b4b'
                              }
                              onChange={(e) =>
                                updateSourceColor(
                                  selectedSourceType,
                                  'secondaryColor',
                                  (e.target as HTMLInputElement).value
                                )
                              }
                              className="h-6 w-full rounded border border-stone-600"
                            />
                          </div>
                        </div>

                        {/* Text Color */}
                        <div>
                          <label
                            htmlFor={`text-color-${selectedSourceType}`}
                            className="mb-1 block text-xs text-stone-400"
                          >
                            Text Color
                          </label>
                          <input
                            id={`text-color-${selectedSourceType}`}
                            type="color"
                            value={
                              posterData.background.sourceColors?.[
                                selectedSourceType
                              ]?.textColor ||
                              sourceColorsData.sourceColors[selectedSourceType]
                                ?.textColor ||
                              '#ffffff'
                            }
                            onChange={(e) =>
                              updateSourceColor(
                                selectedSourceType,
                                'textColor',
                                (e.target as HTMLInputElement).value
                              )
                            }
                            className="h-6 w-full rounded border border-stone-600"
                          />
                        </div>

                        {/* Save Button */}
                        <div className="pt-2">
                          <button
                            type="button"
                            onClick={saveSourceColors}
                            className="w-full rounded bg-orange-600 px-2 py-1 text-xs font-medium text-white hover:bg-orange-700 focus:outline-none focus:ring-1 focus:ring-orange-500"
                          >
                            {intl.formatMessage(messages.saveSourceColors)}
                          </button>
                          {saveStatus && (
                            <div className="mt-1 text-center text-xs text-green-400">
                              {saveStatus}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Primary and Secondary Color Pickers */}
          <div className="space-y-2">
            <div>
              <label className="mb-1 block text-xs text-stone-400">
                {intl.formatMessage(messages.primaryColor)}
              </label>
              <input
                type="color"
                value={posterData.background.color || '#6366f1'}
                onChange={(e) =>
                  updateBackground({
                    color: (e.target as HTMLInputElement).value,
                  })
                }
                disabled={isTemplate && posterData.background.useSourceColors}
                className={`h-8 w-full rounded border border-stone-600 focus:border-orange-500 focus:outline-none ${
                  isTemplate && posterData.background.useSourceColors
                    ? 'cursor-not-allowed opacity-50'
                    : ''
                }`}
              />
              {isTemplate && posterData.background.useSourceColors && (
                <p className="mt-1 text-xs text-stone-500">
                  Disabled - using source colors
                </p>
              )}
            </div>

            {(posterData.background.type === 'gradient' ||
              posterData.background.type === 'radial') && (
              <div>
                <label className="mb-1 block text-xs text-stone-400">
                  {intl.formatMessage(messages.secondaryColor)}
                </label>
                <input
                  type="color"
                  value={posterData.background.secondaryColor || '#1e1b4b'}
                  onChange={(e) =>
                    updateBackground({
                      secondaryColor: (e.target as HTMLInputElement).value,
                    })
                  }
                  disabled={isTemplate && posterData.background.useSourceColors}
                  className={`h-8 w-full rounded border border-stone-600 focus:border-orange-500 focus:outline-none ${
                    isTemplate && posterData.background.useSourceColors
                      ? 'cursor-not-allowed opacity-50'
                      : ''
                  }`}
                />
                {isTemplate && posterData.background.useSourceColors && (
                  <p className="mt-1 text-xs text-stone-500">
                    Disabled - using source colors
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 2. Add Element Buttons Section */}
        <div className="space-y-3 border-b border-stone-700 pb-4">
          <h3 className="text-sm font-medium text-stone-300">
            {intl.formatMessage(messages.layers)}
          </h3>
          <div className="space-y-2">
            {/* Text Elements */}
            <div>
              <button
                type="button"
                onClick={() => handleAddElement('text', 'custom-text')}
                className="flex w-full items-center justify-center gap-1 rounded border border-stone-600 bg-stone-700 px-2 py-1 text-xs text-white hover:bg-stone-600"
              >
                <PlusIcon className="h-3 w-3" />
                Add Custom Text
              </button>
              {isTemplate && (
                <button
                  type="button"
                  onClick={() => handleAddElement('text', 'collection-title')}
                  className="mt-1 flex w-full items-center justify-center gap-1 rounded border border-orange-600 bg-stone-700 px-2 py-1 text-xs text-white hover:bg-stone-600"
                >
                  <PlusIcon className="h-3 w-3" />
                  Add Collection Title
                </button>
              )}
            </div>

            {/* Image Elements */}
            <button
              type="button"
              onClick={() => handleAddElement('raster')}
              className="flex w-full items-center justify-center gap-1 rounded bg-stone-700 px-2 py-1 text-xs text-white hover:bg-stone-600"
            >
              <PlusIcon className="h-3 w-3" />
              {intl.formatMessage(messages.addImage)}
            </button>

            {/* Icon Elements */}
            <div>
              <button
                type="button"
                onClick={() => handleAddElement('svg', 'source-logo')}
                className="flex w-full items-center justify-center gap-1 rounded border border-orange-600 bg-stone-700 px-2 py-1 text-xs text-white hover:bg-stone-600"
              >
                <PlusIcon className="h-3 w-3" />
                Add Source Logo
              </button>
              <button
                type="button"
                onClick={() => handleAddElement('svg', 'custom-icon')}
                className="mt-1 flex w-full items-center justify-center gap-1 rounded border border-stone-600 bg-stone-700 px-2 py-1 text-xs text-white hover:bg-stone-600"
              >
                <PlusIcon className="h-3 w-3" />
                Add Custom SVG Icon
              </button>
            </div>

            {/* Content Grid */}
            <button
              type="button"
              onClick={() => handleAddElement('content-grid')}
              className="flex w-full items-center justify-center gap-1 rounded bg-stone-700 px-2 py-1 text-xs text-white hover:bg-stone-600"
            >
              <PlusIcon className="h-3 w-3" />
              {intl.formatMessage(messages.addGrid)}
            </button>
          </div>
        </div>

        {/* 3. Element List Section */}
        <div className="space-y-3 border-b border-stone-700 pb-4">
          <h3 className="text-sm font-medium text-stone-300">Elements</h3>
          <div className="space-y-1">
            {sortedElements.length === 0 ? (
              <div className="py-4 text-center text-xs text-stone-500">
                No elements added yet
              </div>
            ) : (
              sortedElements.map((element) => {
                const IconComponent = getElementIcon(element.type);
                const isSelected = selectedElementId === element.id;

                return (
                  <div
                    key={element.id}
                    className={`flex cursor-pointer items-center gap-2 rounded p-2 text-sm ${
                      isSelected
                        ? 'bg-orange-600 text-white'
                        : 'bg-stone-700 text-stone-300 hover:bg-stone-600'
                    }`}
                    onClick={() => onElementSelect(element.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onElementSelect(element.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    {/* Reorder Controls */}
                    <div className="flex flex-col">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleReorderElement(element.id, 'up');
                        }}
                        className="p-0.5 hover:text-white"
                        title={intl.formatMessage(messages.moveUp)}
                      >
                        <ArrowUpIcon className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleReorderElement(element.id, 'down');
                        }}
                        className="p-0.5 hover:text-white"
                        title={intl.formatMessage(messages.moveDown)}
                      >
                        <ArrowDownIcon className="h-3 w-3" />
                      </button>
                    </div>

                    {/* Element Preview */}
                    <div className="flex-shrink-0">
                      {getElementPreview(element)}
                    </div>

                    {/* Element Type Icon */}
                    <IconComponent className="h-4 w-4 flex-shrink-0" />

                    {/* Element Label */}
                    <span className="flex-1 truncate">
                      {getElementLabel(element)}
                    </span>

                    {/* Delete Button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteElement(element.id);
                      }}
                      className="p-0.5 hover:text-red-400"
                      title={intl.formatMessage(messages.deleteElement)}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* 4. Element Properties Section */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-stone-300">
            {intl.formatMessage(messages.properties)}
          </h3>
          {selectedElement ? (
            <div className="space-y-3">
              {selectedElement.type === 'text' && (
                <div className="space-y-2">
                  {/* Text Source Colors for Templates */}
                  {isTemplate && (
                    <div className="mb-3 space-y-2 border-b border-stone-600 pb-3">
                      <label className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          checked={
                            (selectedElement.properties as TextElementProps)
                              .useSourceColors || false
                          }
                          onChange={(e) => {
                            updateElementProperties(selectedElement.id, {
                              useSourceColors: e.target.checked,
                              sourceColorType: e.target.checked
                                ? selectedSourceType
                                : undefined,
                            });
                          }}
                          className="rounded border-stone-600 bg-stone-800 text-orange-600 focus:ring-orange-500"
                        />
                        <span className="text-xs text-stone-300">
                          Use Source Text Colors
                        </span>
                      </label>

                      {(selectedElement.properties as TextElementProps)
                        .useSourceColors &&
                        sourceColorsData && (
                          <div className="space-y-2 border-l border-stone-600 pl-4">
                            <div>
                              <label
                                htmlFor={`source-type-text-${selectedElement.id}`}
                                className="mb-1 block text-xs text-stone-400"
                              >
                                Source Type for Text
                              </label>
                              <select
                                id={`source-type-text-${selectedElement.id}`}
                                value={
                                  (
                                    selectedElement.properties as TextElementProps
                                  ).sourceColorType || selectedSourceType
                                }
                                onChange={(e) => {
                                  updateElementProperties(selectedElement.id, {
                                    sourceColorType: (
                                      e.target as HTMLSelectElement
                                    ).value,
                                  });
                                }}
                                className="w-full rounded border border-stone-600 bg-stone-700 px-2 py-1 text-xs text-white focus:border-orange-500 focus:outline-none"
                              >
                                {Object.keys(sourceColorsData.sourceColors).map(
                                  (sourceType) => (
                                    <option key={sourceType} value={sourceType}>
                                      {sourceType.charAt(0).toUpperCase() +
                                        sourceType.slice(1)}
                                    </option>
                                  )
                                )}
                              </select>
                            </div>
                          </div>
                        )}
                    </div>
                  )}

                  {/* Text Content */}
                  {(selectedElement.properties as TextElementProps)
                    .elementType === 'custom-text' ? (
                    <div>
                      <label
                        htmlFor={`text-input-${selectedElement.id}`}
                        className="mb-1 block text-xs text-stone-400"
                      >
                        Text
                      </label>
                      <input
                        id={`text-input-${selectedElement.id}`}
                        type="text"
                        value={
                          localTextValues[selectedElement.id] ??
                          ((selectedElement.properties as TextElementProps)
                            .text ||
                            '')
                        }
                        onChange={(e) => {
                          const newValue = (e.target as HTMLInputElement).value;
                          // Update local state immediately for responsive UI
                          setLocalTextValues((prev) => ({
                            ...prev,
                            [selectedElement.id]: newValue,
                          }));
                          // Debounce the actual poster data update
                          debouncedTextUpdate(selectedElement.id, newValue);
                        }}
                        className="w-full rounded border border-stone-600 bg-stone-700 px-2 py-1 text-xs text-white focus:border-orange-500 focus:outline-none"
                        placeholder="Enter text"
                      />
                    </div>
                  ) : (selectedElement.properties as TextElementProps)
                      .elementType === 'collection-title' ? (
                    <div>
                      <p className="mt-1 rounded bg-orange-100 px-2 py-1 text-xs text-orange-800">
                        This text will automatically display the
                        collection&apos;s name when used.
                      </p>
                    </div>
                  ) : null}

                  {/* Font Size */}
                  <div>
                    <label className="mb-1 block text-xs text-stone-400">
                      {intl.formatMessage(messages.fontSize)} (
                      {localSliderValues[`fontSize-${selectedElement.id}`] ??
                        (selectedElement.properties as TextElementProps)
                          .fontSize}
                      px)
                    </label>
                    <input
                      type="range"
                      min="8"
                      max="72"
                      value={
                        localSliderValues[`fontSize-${selectedElement.id}`] ??
                        (selectedElement.properties as TextElementProps)
                          .fontSize
                      }
                      onInput={(e) => {
                        setLocalSliderValues((prev) => ({
                          ...prev,
                          [`fontSize-${selectedElement.id}`]: Number(
                            (e.target as HTMLInputElement).value
                          ),
                        }));
                      }}
                      onChange={(e) => {
                        const newFontSize = Number(
                          (e.target as HTMLInputElement).value
                        );
                        updateElementProperties(selectedElement.id, {
                          fontSize: newFontSize,
                        });
                        setLocalSliderValues((prev) => {
                          const newState = { ...prev };
                          delete newState[`fontSize-${selectedElement.id}`];
                          return newState;
                        });
                      }}
                      className="w-full"
                    />
                  </div>

                  {/* Font Family */}
                  <div>
                    <label className="mb-1 block text-xs text-stone-400">
                      {intl.formatMessage(messages.fontFamily)}
                    </label>
                    <select
                      value={
                        (selectedElement.properties as TextElementProps)
                          .fontFamily
                      }
                      onChange={(e) => {
                        updateElementProperties(selectedElement.id, {
                          fontFamily: (e.target as HTMLSelectElement).value,
                        });
                      }}
                      className="w-full rounded border border-stone-600 bg-stone-700 px-2 py-1 text-xs text-white focus:border-orange-500 focus:outline-none"
                    >
                      <FontOptions />
                    </select>
                  </div>

                  {/* Text Color */}
                  <div>
                    <label className="mb-1 block text-xs text-stone-400">
                      {intl.formatMessage(messages.textColor)}
                    </label>
                    <input
                      type="color"
                      value={
                        (selectedElement.properties as TextElementProps).color
                      }
                      onChange={(e) => {
                        updateElementProperties(selectedElement.id, {
                          color: (e.target as HTMLInputElement).value,
                        });
                      }}
                      disabled={
                        isTemplate &&
                        (selectedElement.properties as TextElementProps)
                          .useSourceColors
                      }
                      className={`h-8 w-full rounded border border-stone-600 focus:border-orange-500 focus:outline-none ${
                        isTemplate &&
                        (selectedElement.properties as TextElementProps)
                          .useSourceColors
                          ? 'cursor-not-allowed opacity-50'
                          : ''
                      }`}
                    />
                    {isTemplate &&
                      (selectedElement.properties as TextElementProps)
                        .useSourceColors && (
                        <p className="mt-1 text-xs text-stone-500">
                          Disabled - using source text colors
                        </p>
                      )}
                  </div>

                  {/* Font Weight and Style */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block text-xs text-stone-400">
                        {intl.formatMessage(messages.fontWeight)}
                      </label>
                      <select
                        value={
                          (selectedElement.properties as TextElementProps)
                            .fontWeight
                        }
                        onChange={(e) => {
                          updateElementProperties(selectedElement.id, {
                            fontWeight: (e.target as HTMLSelectElement)
                              .value as 'normal' | 'bold',
                          });
                        }}
                        className="w-full rounded border border-stone-600 bg-stone-700 px-2 py-1 text-xs text-white focus:border-orange-500 focus:outline-none"
                      >
                        <option value="normal">
                          {intl.formatMessage(messages.normal)}
                        </option>
                        <option value="bold">
                          {intl.formatMessage(messages.bold)}
                        </option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-stone-400">
                        {intl.formatMessage(messages.fontStyle)}
                      </label>
                      <select
                        value={
                          (selectedElement.properties as TextElementProps)
                            .fontStyle
                        }
                        onChange={(e) => {
                          updateElementProperties(selectedElement.id, {
                            fontStyle: (e.target as HTMLSelectElement).value as
                              | 'normal'
                              | 'italic',
                          });
                        }}
                        className="w-full rounded border border-stone-600 bg-stone-700 px-2 py-1 text-xs text-white focus:border-orange-500 focus:outline-none"
                      >
                        <option value="normal">
                          {intl.formatMessage(messages.normal)}
                        </option>
                        <option value="italic">
                          {intl.formatMessage(messages.italic)}
                        </option>
                      </select>
                    </div>
                  </div>

                  {/* Max Lines */}
                  <div>
                    <label className="mb-1 block text-xs text-stone-400">
                      {intl.formatMessage(messages.maxLines)} (
                      {localSliderValues[`maxLines-${selectedElement.id}`] ??
                        ((selectedElement.properties as TextElementProps)
                          .maxLines ||
                          1)}{' '}
                      lines)
                    </label>
                    <input
                      type="range"
                      min="1"
                      max="5"
                      value={
                        localSliderValues[`maxLines-${selectedElement.id}`] ??
                        ((selectedElement.properties as TextElementProps)
                          .maxLines ||
                          1)
                      }
                      onInput={(e) => {
                        setLocalSliderValues((prev) => ({
                          ...prev,
                          [`maxLines-${selectedElement.id}`]: Number(
                            (e.target as HTMLInputElement).value
                          ),
                        }));
                      }}
                      onChange={(e) => {
                        const newMaxLines = Number(
                          (e.target as HTMLInputElement).value
                        );
                        updateElementProperties(selectedElement.id, {
                          maxLines: newMaxLines,
                        });
                        setLocalSliderValues((prev) => {
                          const newState = { ...prev };
                          delete newState[`maxLines-${selectedElement.id}`];
                          return newState;
                        });
                      }}
                      className="w-full"
                    />
                  </div>
                </div>
              )}

              {selectedElement.type === 'raster' && (
                <div className="space-y-2">
                  {/* Image Selection */}
                  <div>
                    <label className="mb-1 block text-xs text-stone-400">
                      {intl.formatMessage(messages.selectImage)}
                    </label>
                    <IconSelector
                      value={
                        (selectedElement.properties as RasterElementProps)
                          .imagePath || ''
                      }
                      filter="raster"
                      onChange={(imagePath) => {
                        updateElementProperties(selectedElement.id, {
                          imagePath,
                        });
                      }}
                      addToast={addToast}
                    />
                  </div>

                  {/* Lock aspect ratio */}
                  <div>
                    <label className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        checked={aspectRatioLocked[selectedElement.id] ?? true}
                        onChange={(e) => {
                          onAspectRatioLockedChange?.({
                            ...aspectRatioLocked,
                            [selectedElement.id]: e.target.checked,
                          });
                        }}
                        className="rounded border-stone-600 bg-stone-800 text-orange-600 focus:ring-orange-500"
                      />
                      <span className="text-xs text-stone-300">
                        {intl.formatMessage(messages.lockAspectRatio)}
                      </span>
                    </label>
                  </div>

                  {/* Size Controls */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block text-xs text-stone-400">
                        {intl.formatMessage(messages.width)} (
                        {localSliderValues[`width-${selectedElement.id}`] ??
                          selectedElement.width}
                        px)
                      </label>
                      <input
                        type="range"
                        min="10"
                        max="400"
                        value={
                          localSliderValues[`width-${selectedElement.id}`] ??
                          selectedElement.width
                        }
                        onInput={(e) => {
                          const newWidth = Number(
                            (e.target as HTMLInputElement).value
                          );
                          if (aspectRatioLocked[selectedElement.id] ?? true) {
                            const aspectRatio =
                              selectedElement.width / selectedElement.height;
                            const newHeight = Math.round(
                              newWidth / aspectRatio
                            );
                            setLocalSliderValues((prev) => ({
                              ...prev,
                              [`width-${selectedElement.id}`]: newWidth,
                              [`height-${selectedElement.id}`]: newHeight,
                            }));
                          } else {
                            setLocalSliderValues((prev) => ({
                              ...prev,
                              [`width-${selectedElement.id}`]: newWidth,
                            }));
                          }
                        }}
                        onChange={(e) => {
                          const newWidth = Number(
                            (e.target as HTMLInputElement).value
                          );
                          if (aspectRatioLocked[selectedElement.id] ?? true) {
                            const aspectRatio =
                              selectedElement.width / selectedElement.height;
                            const newHeight = Math.round(
                              newWidth / aspectRatio
                            );
                            updateElement(selectedElement.id, {
                              width: newWidth,
                              height: newHeight,
                            });
                          } else {
                            updateElement(selectedElement.id, {
                              width: newWidth,
                            });
                          }
                          setLocalSliderValues((prev) => {
                            const newState = { ...prev };
                            delete newState[`width-${selectedElement.id}`];
                            delete newState[`height-${selectedElement.id}`];
                            return newState;
                          });
                        }}
                        className="w-full"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-stone-400">
                        {intl.formatMessage(messages.height)} (
                        {localSliderValues[`height-${selectedElement.id}`] ??
                          selectedElement.height}
                        px)
                      </label>
                      <input
                        type="range"
                        min="10"
                        max="400"
                        value={
                          localSliderValues[`height-${selectedElement.id}`] ??
                          selectedElement.height
                        }
                        onInput={(e) => {
                          const newHeight = Number(
                            (e.target as HTMLInputElement).value
                          );
                          if (aspectRatioLocked[selectedElement.id] ?? true) {
                            const aspectRatio =
                              selectedElement.width / selectedElement.height;
                            const newWidth = Math.round(
                              newHeight * aspectRatio
                            );
                            setLocalSliderValues((prev) => ({
                              ...prev,
                              [`width-${selectedElement.id}`]: newWidth,
                              [`height-${selectedElement.id}`]: newHeight,
                            }));
                          } else {
                            setLocalSliderValues((prev) => ({
                              ...prev,
                              [`height-${selectedElement.id}`]: newHeight,
                            }));
                          }
                        }}
                        onChange={(e) => {
                          const newHeight = Number(
                            (e.target as HTMLInputElement).value
                          );
                          if (aspectRatioLocked[selectedElement.id] ?? true) {
                            const aspectRatio =
                              selectedElement.width / selectedElement.height;
                            const newWidth = Math.round(
                              newHeight * aspectRatio
                            );
                            updateElement(selectedElement.id, {
                              width: newWidth,
                              height: newHeight,
                            });
                          } else {
                            updateElement(selectedElement.id, {
                              height: newHeight,
                            });
                          }
                          setLocalSliderValues((prev) => {
                            const newState = { ...prev };
                            delete newState[`width-${selectedElement.id}`];
                            delete newState[`height-${selectedElement.id}`];
                            return newState;
                          });
                        }}
                        className="w-full"
                      />
                    </div>
                  </div>
                </div>
              )}

              {selectedElement.type === 'svg' && (
                <div className="space-y-2">
                  {/* Icon Selection - Different for source logos vs custom icons */}
                  {(selectedElement.properties as SVGElementProps).iconType ===
                  'source-logo' ? (
                    <div>
                      <p className="mt-1 rounded bg-orange-100 px-2 py-1 text-xs text-orange-800">
                        This logo will automatically change based on the
                        collection&apos;s source when used.
                      </p>
                    </div>
                  ) : (
                    <div>
                      <label className="mb-1 block text-xs text-stone-400">
                        {intl.formatMessage(messages.selectIcon)}
                      </label>
                      <IconSelector
                        value={
                          (selectedElement.properties as SVGElementProps)
                            .iconPath || ''
                        }
                        filter="svg"
                        onChange={(iconPath) => {
                          updateElementProperties(selectedElement.id, {
                            iconPath,
                          });
                        }}
                        addToast={addToast}
                      />
                    </div>
                  )}

                  {/* Lock aspect ratio */}
                  <div>
                    <label className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        checked={aspectRatioLocked[selectedElement.id] ?? true}
                        onChange={(e) => {
                          onAspectRatioLockedChange?.({
                            ...aspectRatioLocked,
                            [selectedElement.id]: e.target.checked,
                          });
                        }}
                        className="rounded border-stone-600 bg-stone-800 text-orange-600 focus:ring-orange-500"
                      />
                      <span className="text-xs text-stone-300">
                        {intl.formatMessage(messages.lockAspectRatio)}
                      </span>
                    </label>
                  </div>

                  {/* Size Controls */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block text-xs text-stone-400">
                        {intl.formatMessage(messages.width)} (
                        {localSliderValues[`width-${selectedElement.id}`] ??
                          selectedElement.width}
                        px)
                      </label>
                      <input
                        type="range"
                        min="10"
                        max="400"
                        value={
                          localSliderValues[`width-${selectedElement.id}`] ??
                          selectedElement.width
                        }
                        onInput={(e) => {
                          const newWidth = Number(
                            (e.target as HTMLInputElement).value
                          );
                          if (aspectRatioLocked[selectedElement.id] ?? true) {
                            const aspectRatio =
                              selectedElement.width / selectedElement.height;
                            const newHeight = Math.round(
                              newWidth / aspectRatio
                            );
                            setLocalSliderValues((prev) => ({
                              ...prev,
                              [`width-${selectedElement.id}`]: newWidth,
                              [`height-${selectedElement.id}`]: newHeight,
                            }));
                          } else {
                            setLocalSliderValues((prev) => ({
                              ...prev,
                              [`width-${selectedElement.id}`]: newWidth,
                            }));
                          }
                        }}
                        onChange={(e) => {
                          const newWidth = Number(
                            (e.target as HTMLInputElement).value
                          );
                          if (aspectRatioLocked[selectedElement.id] ?? true) {
                            const aspectRatio =
                              selectedElement.width / selectedElement.height;
                            const newHeight = Math.round(
                              newWidth / aspectRatio
                            );
                            updateElement(selectedElement.id, {
                              width: newWidth,
                              height: newHeight,
                            });
                          } else {
                            updateElement(selectedElement.id, {
                              width: newWidth,
                            });
                          }
                          setLocalSliderValues((prev) => {
                            const newState = { ...prev };
                            delete newState[`width-${selectedElement.id}`];
                            delete newState[`height-${selectedElement.id}`];
                            return newState;
                          });
                        }}
                        className="w-full"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-stone-400">
                        {intl.formatMessage(messages.height)} (
                        {localSliderValues[`height-${selectedElement.id}`] ??
                          selectedElement.height}
                        px)
                      </label>
                      <input
                        type="range"
                        min="10"
                        max="400"
                        value={
                          localSliderValues[`height-${selectedElement.id}`] ??
                          selectedElement.height
                        }
                        onInput={(e) => {
                          const newHeight = Number(
                            (e.target as HTMLInputElement).value
                          );
                          if (aspectRatioLocked[selectedElement.id] ?? true) {
                            const aspectRatio =
                              selectedElement.width / selectedElement.height;
                            const newWidth = Math.round(
                              newHeight * aspectRatio
                            );
                            setLocalSliderValues((prev) => ({
                              ...prev,
                              [`width-${selectedElement.id}`]: newWidth,
                              [`height-${selectedElement.id}`]: newHeight,
                            }));
                          } else {
                            setLocalSliderValues((prev) => ({
                              ...prev,
                              [`height-${selectedElement.id}`]: newHeight,
                            }));
                          }
                        }}
                        onChange={(e) => {
                          const newHeight = Number(
                            (e.target as HTMLInputElement).value
                          );
                          if (aspectRatioLocked[selectedElement.id] ?? true) {
                            const aspectRatio =
                              selectedElement.width / selectedElement.height;
                            const newWidth = Math.round(
                              newHeight * aspectRatio
                            );
                            updateElement(selectedElement.id, {
                              width: newWidth,
                              height: newHeight,
                            });
                          } else {
                            updateElement(selectedElement.id, {
                              height: newHeight,
                            });
                          }
                          setLocalSliderValues((prev) => {
                            const newState = { ...prev };
                            delete newState[`width-${selectedElement.id}`];
                            delete newState[`height-${selectedElement.id}`];
                            return newState;
                          });
                        }}
                        className="w-full"
                      />
                    </div>
                  </div>
                </div>
              )}

              {selectedElement.type === 'content-grid' && (
                <div className="space-y-2">
                  {/* Grid Layout */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block text-xs text-stone-400">
                        {intl.formatMessage(messages.columns)} (
                        {localSliderValues[`columns-${selectedElement.id}`] ??
                          (selectedElement.properties as ContentGridProps)
                            .columns}
                        )
                      </label>
                      <input
                        type="range"
                        min="1"
                        max="10"
                        value={
                          localSliderValues[`columns-${selectedElement.id}`] ??
                          (selectedElement.properties as ContentGridProps)
                            .columns
                        }
                        onInput={(e) => {
                          const newColumns = Number(
                            (e.target as HTMLInputElement).value
                          );

                          // Calculate new grid dimensions for preview
                          const props =
                            selectedElement.properties as ContentGridProps;
                          const currentWidth = selectedElement.width;
                          const availableWidth =
                            currentWidth - (newColumns - 1) * props.spacing;
                          const cellWidth = availableWidth / newColumns;
                          const cellHeight = cellWidth * 1.5; // 2:3 poster aspect ratio
                          const newHeight =
                            cellHeight * props.rows +
                            (props.rows - 1) * props.spacing;

                          setLocalSliderValues((prev) => ({
                            ...prev,
                            [`columns-${selectedElement.id}`]: newColumns,
                            [`height-${selectedElement.id}`]:
                              Math.round(newHeight),
                          }));
                        }}
                        onChange={(e) => {
                          const newColumns = Number(
                            (e.target as HTMLInputElement).value
                          );

                          // Calculate new grid dimensions when columns change
                          const props =
                            selectedElement.properties as ContentGridProps;
                          const currentWidth = selectedElement.width;

                          // Calculate available width for cells after new column count
                          const availableWidth =
                            currentWidth - (newColumns - 1) * props.spacing;
                          const cellWidth = availableWidth / newColumns;
                          const cellHeight = cellWidth * 1.5; // 2:3 poster aspect ratio
                          const newHeight =
                            cellHeight * props.rows +
                            (props.rows - 1) * props.spacing;

                          // Update both columns and dimensions
                          updateElementProperties(selectedElement.id, {
                            columns: newColumns,
                          });
                          updateElement(selectedElement.id, {
                            height: Math.round(newHeight),
                          });

                          setLocalSliderValues((prev) => {
                            const newState = { ...prev };
                            delete newState[`columns-${selectedElement.id}`];
                            return newState;
                          });
                        }}
                        className="w-full"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-stone-400">
                        {intl.formatMessage(messages.rows)} (
                        {localSliderValues[`rows-${selectedElement.id}`] ??
                          (selectedElement.properties as ContentGridProps).rows}
                        )
                      </label>
                      <input
                        type="range"
                        min="1"
                        max="10"
                        value={
                          localSliderValues[`rows-${selectedElement.id}`] ??
                          (selectedElement.properties as ContentGridProps).rows
                        }
                        onInput={(e) => {
                          const newRows = Number(
                            (e.target as HTMLInputElement).value
                          );

                          // Calculate new grid dimensions for preview
                          const props =
                            selectedElement.properties as ContentGridProps;
                          const currentWidth = selectedElement.width;
                          const availableWidth =
                            currentWidth - (props.columns - 1) * props.spacing;
                          const cellWidth = availableWidth / props.columns;
                          const cellHeight = cellWidth * 1.5; // 2:3 poster aspect ratio
                          const newHeight =
                            cellHeight * newRows +
                            (newRows - 1) * props.spacing;

                          setLocalSliderValues((prev) => ({
                            ...prev,
                            [`rows-${selectedElement.id}`]: newRows,
                            [`height-${selectedElement.id}`]:
                              Math.round(newHeight),
                          }));
                        }}
                        onChange={(e) => {
                          const newRows = Number(
                            (e.target as HTMLInputElement).value
                          );

                          // Calculate new grid dimensions when rows change
                          const props =
                            selectedElement.properties as ContentGridProps;
                          const currentWidth = selectedElement.width;

                          // Calculate available width for cells (unchanged)
                          const availableWidth =
                            currentWidth - (props.columns - 1) * props.spacing;
                          const cellWidth = availableWidth / props.columns;
                          const cellHeight = cellWidth * 1.5; // 2:3 poster aspect ratio
                          const newHeight =
                            cellHeight * newRows +
                            (newRows - 1) * props.spacing;

                          // Update both rows and dimensions
                          updateElementProperties(selectedElement.id, {
                            rows: newRows,
                          });
                          updateElement(selectedElement.id, {
                            height: Math.round(newHeight),
                          });

                          setLocalSliderValues((prev) => {
                            const newState = { ...prev };
                            delete newState[`rows-${selectedElement.id}`];
                            return newState;
                          });
                        }}
                        className="w-full"
                      />
                    </div>
                  </div>

                  {/* Spacing and Corner Radius */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block text-xs text-stone-400">
                        {intl.formatMessage(messages.spacing)} (
                        {localSliderValues[`spacing-${selectedElement.id}`] ??
                          (selectedElement.properties as ContentGridProps)
                            .spacing}
                        px)
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="50"
                        value={
                          localSliderValues[`spacing-${selectedElement.id}`] ??
                          (selectedElement.properties as ContentGridProps)
                            .spacing
                        }
                        onInput={(e) => {
                          const newSpacing = Number(
                            (e.target as HTMLInputElement).value
                          );

                          // Calculate new grid dimensions for preview
                          const props =
                            selectedElement.properties as ContentGridProps;
                          const currentWidth = selectedElement.width;
                          const availableWidth =
                            currentWidth - (props.columns - 1) * newSpacing;
                          const cellWidth = availableWidth / props.columns;
                          const cellHeight = cellWidth * 1.5; // 2:3 poster aspect ratio
                          const newHeight =
                            cellHeight * props.rows +
                            (props.rows - 1) * newSpacing;

                          setLocalSliderValues((prev) => ({
                            ...prev,
                            [`spacing-${selectedElement.id}`]: newSpacing,
                            [`height-${selectedElement.id}`]:
                              Math.round(newHeight),
                          }));
                        }}
                        onChange={(e) => {
                          const newSpacing = Number(
                            (e.target as HTMLInputElement).value
                          );

                          // Calculate new grid dimensions when spacing changes
                          const props =
                            selectedElement.properties as ContentGridProps;
                          const currentWidth = selectedElement.width;

                          // Calculate available width for cells after new spacing
                          const availableWidth =
                            currentWidth - (props.columns - 1) * newSpacing;
                          const cellWidth = availableWidth / props.columns;
                          const cellHeight = cellWidth * 1.5; // 2:3 poster aspect ratio
                          const newHeight =
                            cellHeight * props.rows +
                            (props.rows - 1) * newSpacing;

                          // Update both spacing and dimensions
                          updateElementProperties(selectedElement.id, {
                            spacing: newSpacing,
                          });
                          updateElement(selectedElement.id, {
                            height: Math.round(newHeight),
                          });

                          setLocalSliderValues((prev) => {
                            const newState = { ...prev };
                            delete newState[`spacing-${selectedElement.id}`];
                            return newState;
                          });
                        }}
                        className="w-full"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-stone-400">
                        {intl.formatMessage(messages.cornerRadius)} (
                        {localSliderValues[
                          `cornerRadius-${selectedElement.id}`
                        ] ??
                          (selectedElement.properties as ContentGridProps)
                            .cornerRadius}
                        px)
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="20"
                        value={
                          localSliderValues[
                            `cornerRadius-${selectedElement.id}`
                          ] ??
                          (selectedElement.properties as ContentGridProps)
                            .cornerRadius
                        }
                        onInput={(e) => {
                          setLocalSliderValues((prev) => ({
                            ...prev,
                            [`cornerRadius-${selectedElement.id}`]: Number(
                              (e.target as HTMLInputElement).value
                            ),
                          }));
                        }}
                        onChange={(e) => {
                          const newCornerRadius = Number(
                            (e.target as HTMLInputElement).value
                          );
                          updateElementProperties(selectedElement.id, {
                            cornerRadius: newCornerRadius,
                          });
                          setLocalSliderValues((prev) => {
                            const newState = { ...prev };
                            delete newState[
                              `cornerRadius-${selectedElement.id}`
                            ];
                            return newState;
                          });
                        }}
                        className="w-full"
                      />
                    </div>
                  </div>

                  {/* Grid Size Controls - Width only, height auto-calculated for poster aspect ratio */}
                  <div>
                    <div>
                      <label className="mb-1 block text-xs text-stone-400">
                        {intl.formatMessage(messages.width)} (
                        {localSliderValues[`width-${selectedElement.id}`] ??
                          selectedElement.width}
                        px)
                      </label>
                      <input
                        type="range"
                        min="50"
                        max="800"
                        value={
                          localSliderValues[`width-${selectedElement.id}`] ??
                          selectedElement.width
                        }
                        onInput={(e) => {
                          const newWidth = Number(
                            (e.target as HTMLInputElement).value
                          );
                          // Calculate height based on poster aspect ratio (2:3) and grid layout
                          const props =
                            selectedElement.properties as ContentGridProps;
                          const availableWidth =
                            newWidth - (props.columns - 1) * props.spacing;
                          const cellWidth = availableWidth / props.columns;
                          const cellHeight = cellWidth * 1.5; // 2:3 poster aspect ratio
                          const newHeight =
                            cellHeight * props.rows +
                            (props.rows - 1) * props.spacing;

                          setLocalSliderValues((prev) => ({
                            ...prev,
                            [`width-${selectedElement.id}`]: newWidth,
                            [`height-${selectedElement.id}`]:
                              Math.round(newHeight),
                          }));
                        }}
                        onChange={(e) => {
                          const newWidth = Number(
                            (e.target as HTMLInputElement).value
                          );
                          // Calculate height based on poster aspect ratio (2:3) and grid layout
                          const props =
                            selectedElement.properties as ContentGridProps;
                          const availableWidth =
                            newWidth - (props.columns - 1) * props.spacing;
                          const cellWidth = availableWidth / props.columns;
                          const cellHeight = cellWidth * 1.5; // 2:3 poster aspect ratio
                          const newHeight =
                            cellHeight * props.rows +
                            (props.rows - 1) * props.spacing;

                          updateElement(selectedElement.id, {
                            width: newWidth,
                            height: Math.round(newHeight),
                          });
                          setLocalSliderValues((prev) => {
                            const newState = { ...prev };
                            delete newState[`width-${selectedElement.id}`];
                            delete newState[`height-${selectedElement.id}`];
                            return newState;
                          });
                        }}
                        className="w-full"
                      />
                    </div>

                    {/* Height display (read-only) */}
                    <div className="mt-2">
                      <label className="mb-1 block text-xs text-stone-400">
                        {intl.formatMessage(messages.height)} (
                        {(() => {
                          const currentWidth =
                            localSliderValues[`width-${selectedElement.id}`] ??
                            selectedElement.width;
                          const props =
                            selectedElement.properties as ContentGridProps;

                          // Use local slider values for real-time preview
                          const currentColumns =
                            localSliderValues[
                              `columns-${selectedElement.id}`
                            ] ?? props.columns;
                          const currentRows =
                            localSliderValues[`rows-${selectedElement.id}`] ??
                            props.rows;
                          const currentSpacing =
                            localSliderValues[
                              `spacing-${selectedElement.id}`
                            ] ?? props.spacing;

                          const availableWidth =
                            currentWidth -
                            (currentColumns - 1) * currentSpacing;
                          const cellWidth = availableWidth / currentColumns;
                          const cellHeight = cellWidth * 1.5;
                          const calculatedHeight =
                            cellHeight * currentRows +
                            (currentRows - 1) * currentSpacing;
                          return Math.round(calculatedHeight);
                        })()}
                        px - Auto)
                      </label>
                      <div className="flex h-8 items-center justify-center rounded border border-stone-600 bg-stone-800 px-2 text-xs text-stone-400">
                        Locked to poster aspect ratio (2:3)
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-stone-500">
              {intl.formatMessage(messages.noElementSelected)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
