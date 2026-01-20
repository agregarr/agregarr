import { IconSelector } from '@app/components/PosterEditor/IconSelector';
import { fontLoader } from '@app/utils/fontLoader';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CodeBracketSquareIcon,
  DocumentTextIcon,
  LockClosedIcon,
  LockOpenIcon,
  PhotoIcon,
  PlusIcon,
  Square3Stack3DIcon,
  TrashIcon,
  VariableIcon,
} from '@heroicons/react/24/outline';
import { useEffect } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { useToasts } from 'react-toast-notifications';
import useSWR from 'swr';
import type {
  OverlayElement,
  OverlayRasterElementProps,
  OverlaySVGElementProps,
  OverlayTemplateData,
  OverlayTextElementProps,
  OverlayTileElementProps,
  OverlayVariableElementProps,
  OverlayVariableSegment,
} from './types';
import { AVAILABLE_VARIABLES } from './types';

const messages = defineMessages({
  layers: 'Layers',
  addText: 'Text',
  addTile: 'Tile',
  addVariable: 'Variable',
  addImage: 'Image',
  addIcon: 'Icon',
  moveUp: 'Move Up',
  moveDown: 'Move Down',
  deleteElement: 'Delete Element',
  properties: 'Properties',
  noElementSelected: 'Select an element to edit its properties',
  // Text properties
  text: 'Text',
  fontSize: 'Font Size',
  fontFamily: 'Font Family',
  fontWeight: 'Font Weight',
  fontStyle: 'Font Style',
  textColor: 'Text Color',
  textAlign: 'Text Align',
  left: 'Left',
  center: 'Center',
  right: 'Right',
  normal: 'Normal',
  bold: 'Bold',
  italic: 'Italic',
  // Tile properties
  fillColor: 'Fill Color',
  fillOpacity: 'Fill Opacity',
  borderColor: 'Border Color',
  borderWidth: 'Border Width',
  borderRadius: 'Border Radius',
  cornerRadii: 'Corner Radii',
  topLeft: 'Top Left',
  topRight: 'Top Right',
  bottomLeft: 'Bottom Left',
  bottomRight: 'Bottom Right',
  lockCorners: 'Lock Corners',
  unlockCorners: 'Unlock Corners',
  // Variable properties
  variableField: 'Variable',
  prefix: 'Prefix Text',
  suffix: 'Suffix Text',
  previewText: 'Preview',
  selectVariable: 'Select a variable...',
  segments: 'Text Segments',
  addTextSegment: 'Add Text',
  addVariableSegment: 'Add Variable',
  textSegment: 'Text',
  variableSegment: 'Variable',
  segmentValue: 'Text Content',
  dateFormat: 'Date Format',
  // SVG properties
  selectIcon: 'Icon',
  grayscale: 'Grayscale',
  opacity: 'Opacity',
  // Raster properties
  selectImage: 'Image',
  // Size
  width: 'Width',
  height: 'Height',
  x: 'X Position',
  y: 'Y Position',
  // Actions
  undo: 'Undo',
  redo: 'Redo',
  snapToGuides: 'Snap to Guides',
  // Application condition
  applicationCondition: 'Application Condition',
  enableCondition: 'Only apply when:',
  noCondition: 'Always apply (no condition)',
  conditionField: 'Field',
  conditionOperator: 'Operator',
  conditionValue: 'Value',
  opEquals: 'equals',
  opNotEquals: 'not equals',
  opGreaterThan: 'greater than',
  opGreaterOrEqualDisplay: 'at least',
  opLessThan: 'less than',
  opLessOrEqualDisplay: 'at most',
  opContains: 'contains',
  opNotContains: 'does not contain',
  opRegexDisplay: 'matches regex',
  opBegins: 'begins with',
  opEnds: 'ends with',
  locked: 'Locked',
  unlocked: 'Unlocked',
  unknownElement: 'Unknown element type: {type}',
});

interface FontInfo {
  family: string;
  availableWeights: string[];
  cssValue: string;
  fontUrl?: string;
}

interface OverlayLayerPanelProps {
  overlayData: OverlayTemplateData;
  onChange: (data: OverlayTemplateData) => void;
  selectedElementId?: string;
  onElementSelect: (elementId: string | undefined) => void;
}

export const OverlayLayerPanel: React.FC<OverlayLayerPanelProps> = ({
  overlayData,
  onChange,
  selectedElementId,
  onElementSelect,
}) => {
  const intl = useIntl();
  const { addToast } = useToasts();

  const { data: fontsData } = useSWR<{ fonts: FontInfo[]; count: number }>(
    '/api/v1/fonts'
  );

  // Ensure fonts are loaded when panel is used (safety fallback)
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

  const generateId = () => `element-${Date.now()}-${Math.random()}`;

  // Get elements directly from overlayData
  const elements = overlayData.elements;

  // Helper to update elements
  const updateElements = (newElements: OverlayElement[]) => {
    onChange({
      ...overlayData,
      elements: newElements,
    });
  };

  const handleAddText = () => {
    const newElement: OverlayElement = {
      id: generateId(),
      layerOrder: elements.length,
      type: 'text',
      x: 100,
      y: 150,
      width: 300,
      height: 120,
      properties: {
        text: 'New Text',
        fontSize: 60,
        fontFamily: 'Inter',
        fontWeight: 'bold',
        fontStyle: 'normal',
        color: '#FFFFFF',
        textAlign: 'left',
        opacity: 100,
      },
    };

    updateElements([...elements, newElement]);
    onElementSelect(newElement.id);
  };

  const handleAddTile = () => {
    const newElement: OverlayElement = {
      id: generateId(),
      layerOrder: elements.length,
      type: 'tile',
      x: 100,
      y: 150,
      width: 300,
      height: 150,
      properties: {
        fillColor: '#000000',
        fillOpacity: 70,
        borderColor: '#FFFFFF',
        borderWidth: 2,
        lockCorners: true,
        borderRadiusTopLeft: 10,
      },
    };

    updateElements([...elements, newElement]);
    onElementSelect(newElement.id);
  };

  const handleAddVariable = () => {
    const newElement: OverlayElement = {
      id: generateId(),
      layerOrder: elements.length,
      type: 'variable',
      x: 100,
      y: 150,
      width: 400,
      height: 120,
      properties: {
        segments: [{ type: 'variable', field: 'imdbRating' }],
        fontSize: 60,
        fontFamily: 'Inter',
        fontWeight: 'bold',
        fontStyle: 'normal',
        color: '#FFFFFF',
        textAlign: 'center',
        opacity: 100,
      },
    };

    updateElements([...elements, newElement]);
    onElementSelect(newElement.id);
  };

  const handleAddIcon = () => {
    const newElement: OverlayElement = {
      id: generateId(),
      layerOrder: elements.length,
      type: 'svg',
      x: 100,
      y: 150,
      width: 150,
      height: 150,
      properties: {
        iconType: 'custom-icon',
        iconPath: '',
        opacity: 100,
        grayscale: false,
      },
    };

    updateElements([...elements, newElement]);
    onElementSelect(newElement.id);
  };

  const handleAddImage = () => {
    const newElement: OverlayElement = {
      id: generateId(),
      layerOrder: elements.length,
      type: 'raster',
      x: 100,
      y: 150,
      width: 200,
      height: 200,
      properties: {
        imagePath: '',
        opacity: 100,
      },
    };

    updateElements([...elements, newElement]);
    onElementSelect(newElement.id);
  };

  const handleDeleteElement = (elementId: string) => {
    updateElements(elements.filter((el) => el.id !== elementId));
    onElementSelect(undefined);
  };

  const handleMoveUp = (elementId: string) => {
    const updatedElements = [...elements];
    const index = updatedElements.findIndex((el) => el.id === elementId);
    if (index > 0) {
      [updatedElements[index], updatedElements[index - 1]] = [
        updatedElements[index - 1],
        updatedElements[index],
      ];
      updatedElements.forEach((el, i) => (el.layerOrder = i));
      updateElements(updatedElements);
    }
  };

  const handleMoveDown = (elementId: string) => {
    const updatedElements = [...elements];
    const index = updatedElements.findIndex((el) => el.id === elementId);
    if (index < updatedElements.length - 1) {
      [updatedElements[index], updatedElements[index + 1]] = [
        updatedElements[index + 1],
        updatedElements[index],
      ];
      updatedElements.forEach((el, i) => (el.layerOrder = i));
      updateElements(updatedElements);
    }
  };

  const handleUpdateElement = (
    elementId: string,
    updates: Partial<OverlayElement>
  ) => {
    updateElements(
      elements.map((el) => (el.id === elementId ? { ...el, ...updates } : el))
    );
  };

  const selectedElement = elements.find((el) => el.id === selectedElementId);

  const getElementIcon = (type: OverlayElement['type']) => {
    switch (type) {
      case 'text':
        return '📝';
      case 'tile':
        return '🔲';
      case 'variable':
        return '📊';
      case 'svg':
        return '🎨';
      case 'raster':
        return '🖼️';
      default:
        return '📦';
    }
  };

  const getElementLabel = (element: OverlayElement) => {
    switch (element.type) {
      case 'text':
        return (element.properties as OverlayTextElementProps).text || 'Text';
      case 'tile':
        return 'Tile';
      case 'variable': {
        const props = element.properties as OverlayVariableElementProps;
        // Build label from segments
        return props.segments
          .map((seg) => (seg.type === 'text' ? seg.value : `{${seg.field}}`))
          .join('');
      }
      case 'svg':
        return 'SVG Icon';
      case 'raster':
        return 'Image';
      default:
        return 'Unknown';
    }
  };

  const getVariablePreview = (props: OverlayVariableElementProps) => {
    const allVars = [
      ...AVAILABLE_VARIABLES.ratings,
      ...AVAILABLE_VARIABLES.metadata,
      ...AVAILABLE_VARIABLES.video,
      ...AVAILABLE_VARIABLES.audio,
      ...AVAILABLE_VARIABLES.file,
      ...AVAILABLE_VARIABLES.playback,
      ...AVAILABLE_VARIABLES['coming-soon'],
      ...AVAILABLE_VARIABLES.status,
    ];

    // Build preview from segments
    return props.segments
      .map((seg) => {
        if (seg.type === 'text') {
          return seg.value || '';
        } else if (seg.type === 'variable' && seg.field) {
          const varInfo = allVars.find((v) => v.field === seg.field);
          return varInfo?.example || `{${seg.field}}`;
        }
        return '';
      })
      .join('');
  };

  const renderTextProperties = (element: OverlayElement) => {
    const props = element.properties as OverlayTextElementProps;
    return (
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs text-stone-300">
            {intl.formatMessage(messages.text)}
          </label>
          <textarea
            value={props.text || ''}
            onChange={(e) =>
              handleUpdateElement(element.id, {
                properties: { ...props, text: e.target.value },
              })
            }
            className="w-full rounded border border-stone-600 bg-stone-700 px-2 py-1 text-xs text-white"
            rows={2}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs text-stone-300">
            {intl.formatMessage(messages.fontFamily)}
          </label>
          <select
            value={props.fontFamily || 'Inter'}
            onChange={(e) =>
              handleUpdateElement(element.id, {
                properties: { ...props, fontFamily: e.target.value },
              })
            }
            className="w-full rounded border border-stone-600 bg-stone-700 px-2 py-1 text-xs text-white"
          >
            {fontsData?.fonts.map((font) => (
              <option key={font.family} value={font.family}>
                {font.family}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs text-stone-300">
            {intl.formatMessage(messages.fontSize)} ({props.fontSize}px)
          </label>
          <input
            type="range"
            min="12"
            max="150"
            step="2"
            value={props.fontSize || 48}
            onChange={(e) =>
              handleUpdateElement(element.id, {
                properties: {
                  ...props,
                  fontSize: parseInt(e.target.value, 10),
                },
              })
            }
            className="w-full"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-xs text-stone-300">
              {intl.formatMessage(messages.fontWeight)}
            </label>
            <select
              value={props.fontWeight || 'bold'}
              onChange={(e) =>
                handleUpdateElement(element.id, {
                  properties: {
                    ...props,
                    fontWeight: e.target.value as 'normal' | 'bold',
                  },
                })
              }
              className="w-full rounded border border-stone-600 bg-stone-700 px-2 py-1 text-xs text-white"
            >
              <option value="normal">
                {intl.formatMessage(messages.normal)}
              </option>
              <option value="bold">{intl.formatMessage(messages.bold)}</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-stone-300">
              {intl.formatMessage(messages.fontStyle)}
            </label>
            <select
              value={props.fontStyle || 'normal'}
              onChange={(e) =>
                handleUpdateElement(element.id, {
                  properties: {
                    ...props,
                    fontStyle: e.target.value as 'normal' | 'italic',
                  },
                })
              }
              className="w-full rounded border border-stone-600 bg-stone-700 px-2 py-1 text-xs text-white"
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

        <div>
          <label className="mb-1 block text-xs text-stone-300">
            {intl.formatMessage(messages.textColor)}
          </label>
          <input
            type="color"
            value={props.color || '#FFFFFF'}
            onChange={(e) =>
              handleUpdateElement(element.id, {
                properties: { ...props, color: e.target.value },
              })
            }
            className="h-8 w-full rounded border border-stone-600"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs text-stone-300">
            {intl.formatMessage(messages.textAlign)}
          </label>
          <div className="flex space-x-1">
            {(['left', 'center', 'right'] as const).map((align) => (
              <button
                key={align}
                type="button"
                onClick={() =>
                  handleUpdateElement(element.id, {
                    properties: { ...props, textAlign: align },
                  })
                }
                className={`flex-1 rounded px-2 py-1 text-xs ${
                  props.textAlign === align
                    ? 'bg-orange-600 text-white'
                    : 'bg-stone-700 text-stone-300 hover:bg-stone-600'
                }`}
              >
                {intl.formatMessage(messages[align])}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs text-stone-300">
            {intl.formatMessage(messages.opacity)} ({props.opacity ?? 100}%)
          </label>
          <input
            type="range"
            min="0"
            max="100"
            value={props.opacity ?? 100}
            onChange={(e) =>
              handleUpdateElement(element.id, {
                properties: { ...props, opacity: parseInt(e.target.value) },
              })
            }
            className="w-full"
          />
        </div>
      </div>
    );
  };

  const renderTileProperties = (element: OverlayElement) => {
    const props = element.properties as OverlayTileElementProps;
    return (
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs text-stone-300">
            {intl.formatMessage(messages.fillColor)}
          </label>
          <input
            type="color"
            value={props.fillColor || '#000000'}
            onChange={(e) =>
              handleUpdateElement(element.id, {
                properties: { ...props, fillColor: e.target.value },
              })
            }
            className="h-8 w-full rounded border border-stone-600"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs text-stone-300">
            {intl.formatMessage(messages.fillOpacity)} ({props.fillOpacity}%)
          </label>
          <input
            type="range"
            min="0"
            max="100"
            value={props.fillOpacity}
            onChange={(e) =>
              handleUpdateElement(element.id, {
                properties: { ...props, fillOpacity: parseInt(e.target.value) },
              })
            }
            className="w-full"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs text-stone-300">
            {intl.formatMessage(messages.borderColor)}
          </label>
          <input
            type="color"
            value={props.borderColor || '#FFFFFF'}
            onChange={(e) =>
              handleUpdateElement(element.id, {
                properties: { ...props, borderColor: e.target.value },
              })
            }
            className="h-8 w-full rounded border border-stone-600"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs text-stone-300">
            {intl.formatMessage(messages.borderWidth)} ({props.borderWidth || 0}
            px)
          </label>
          <input
            type="range"
            min="0"
            max="30"
            step="1"
            value={props.borderWidth || 0}
            onChange={(e) =>
              handleUpdateElement(element.id, {
                properties: {
                  ...props,
                  borderWidth: parseInt(e.target.value, 10),
                },
              })
            }
            className="w-full"
          />
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="text-xs font-medium text-stone-300">
              {intl.formatMessage(messages.cornerRadii)}
            </label>
            <button
              type="button"
              onClick={() => {
                const isCurrentlyLocked =
                  props.lockCorners === undefined
                    ? props.borderRadius !== undefined
                    : props.lockCorners;

                if (isCurrentlyLocked) {
                  // Unlocking - set all corners to current value
                  const currentRadius =
                    props.borderRadiusTopLeft ?? props.borderRadius ?? 0;
                  handleUpdateElement(element.id, {
                    properties: {
                      ...props,
                      lockCorners: false,
                      borderRadiusTopLeft: currentRadius,
                      borderRadiusTopRight: currentRadius,
                      borderRadiusBottomLeft: currentRadius,
                      borderRadiusBottomRight: currentRadius,
                      borderRadius: undefined,
                    },
                  });
                } else {
                  // Locking - use topLeft value for all
                  const lockValue = props.borderRadiusTopLeft ?? 0;
                  handleUpdateElement(element.id, {
                    properties: {
                      ...props,
                      lockCorners: true,
                      borderRadiusTopLeft: lockValue,
                      borderRadiusTopRight: undefined,
                      borderRadiusBottomLeft: undefined,
                      borderRadiusBottomRight: undefined,
                    },
                  });
                }
              }}
              className="flex items-center gap-1 rounded bg-stone-700 px-2 py-1 text-xs text-stone-300 transition hover:bg-stone-600"
              title={
                props.lockCorners === undefined
                  ? props.borderRadius !== undefined
                    ? intl.formatMessage(messages.unlockCorners)
                    : intl.formatMessage(messages.lockCorners)
                  : props.lockCorners
                  ? intl.formatMessage(messages.unlockCorners)
                  : intl.formatMessage(messages.lockCorners)
              }
            >
              {props.lockCorners === undefined ? (
                props.borderRadius !== undefined ? (
                  <>
                    <LockClosedIcon className="h-3 w-3" />
                    <span>{intl.formatMessage(messages.locked)}</span>
                  </>
                ) : (
                  <>
                    <LockOpenIcon className="h-3 w-3" />
                    <span>{intl.formatMessage(messages.unlocked)}</span>
                  </>
                )
              ) : props.lockCorners ? (
                <>
                  <LockClosedIcon className="h-3 w-3" />
                  <span>{intl.formatMessage(messages.locked)}</span>
                </>
              ) : (
                <>
                  <LockOpenIcon className="h-3 w-3" />
                  <span>{intl.formatMessage(messages.unlocked)}</span>
                </>
              )}
            </button>
          </div>

          {props.lockCorners === undefined ? (
            props.borderRadius !== undefined ? (
              // Legacy mode or locked mode
              <div>
                <label className="mb-1 block text-xs text-stone-400">
                  {intl.formatMessage(messages.borderRadius)} (
                  {props.borderRadiusTopLeft ?? props.borderRadius ?? 0}px)
                </label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={props.borderRadiusTopLeft ?? props.borderRadius ?? 0}
                  onChange={(e) =>
                    handleUpdateElement(element.id, {
                      properties: {
                        ...props,
                        borderRadius: parseInt(e.target.value, 10),
                      },
                    })
                  }
                  className="w-full"
                />
              </div>
            ) : (
              // Unlocked mode - individual corners
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs text-stone-400">
                    {intl.formatMessage(messages.topLeft)} (
                    {props.borderRadiusTopLeft ?? 0}px)
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={props.borderRadiusTopLeft ?? 0}
                    onChange={(e) =>
                      handleUpdateElement(element.id, {
                        properties: {
                          ...props,
                          borderRadiusTopLeft: parseInt(e.target.value, 10),
                        },
                      })
                    }
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-stone-400">
                    {intl.formatMessage(messages.topRight)} (
                    {props.borderRadiusTopRight ?? 0}px)
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={props.borderRadiusTopRight ?? 0}
                    onChange={(e) =>
                      handleUpdateElement(element.id, {
                        properties: {
                          ...props,
                          borderRadiusTopRight: parseInt(e.target.value, 10),
                        },
                      })
                    }
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-stone-400">
                    {intl.formatMessage(messages.bottomLeft)} (
                    {props.borderRadiusBottomLeft ?? 0}px)
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={props.borderRadiusBottomLeft ?? 0}
                    onChange={(e) =>
                      handleUpdateElement(element.id, {
                        properties: {
                          ...props,
                          borderRadiusBottomLeft: parseInt(e.target.value, 10),
                        },
                      })
                    }
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-stone-400">
                    {intl.formatMessage(messages.bottomRight)} (
                    {props.borderRadiusBottomRight ?? 0}px)
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={props.borderRadiusBottomRight ?? 0}
                    onChange={(e) =>
                      handleUpdateElement(element.id, {
                        properties: {
                          ...props,
                          borderRadiusBottomRight: parseInt(e.target.value, 10),
                        },
                      })
                    }
                    className="w-full"
                  />
                </div>
              </div>
            )
          ) : props.lockCorners ? (
            // Locked mode
            <div>
              <label className="mb-1 block text-xs text-stone-400">
                {intl.formatMessage(messages.borderRadius)} (
                {props.borderRadiusTopLeft ?? 0}px)
              </label>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={props.borderRadiusTopLeft ?? 0}
                onChange={(e) =>
                  handleUpdateElement(element.id, {
                    properties: {
                      ...props,
                      borderRadiusTopLeft: parseInt(e.target.value, 10),
                    },
                  })
                }
                className="w-full"
              />
            </div>
          ) : (
            // Unlocked mode - individual corners
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs text-stone-400">
                  {intl.formatMessage(messages.topLeft)} (
                  {props.borderRadiusTopLeft ?? 0}px)
                </label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={props.borderRadiusTopLeft ?? 0}
                  onChange={(e) =>
                    handleUpdateElement(element.id, {
                      properties: {
                        ...props,
                        borderRadiusTopLeft: parseInt(e.target.value, 10),
                      },
                    })
                  }
                  className="w-full"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-stone-400">
                  {intl.formatMessage(messages.topRight)} (
                  {props.borderRadiusTopRight ?? 0}px)
                </label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={props.borderRadiusTopRight ?? 0}
                  onChange={(e) =>
                    handleUpdateElement(element.id, {
                      properties: {
                        ...props,
                        borderRadiusTopRight: parseInt(e.target.value, 10),
                      },
                    })
                  }
                  className="w-full"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-stone-400">
                  {intl.formatMessage(messages.bottomLeft)} (
                  {props.borderRadiusBottomLeft ?? 0}px)
                </label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={props.borderRadiusBottomLeft ?? 0}
                  onChange={(e) =>
                    handleUpdateElement(element.id, {
                      properties: {
                        ...props,
                        borderRadiusBottomLeft: parseInt(e.target.value, 10),
                      },
                    })
                  }
                  className="w-full"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-stone-400">
                  {intl.formatMessage(messages.bottomRight)} (
                  {props.borderRadiusBottomRight ?? 0}px)
                </label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={props.borderRadiusBottomRight ?? 0}
                  onChange={(e) =>
                    handleUpdateElement(element.id, {
                      properties: {
                        ...props,
                        borderRadiusBottomRight: parseInt(e.target.value, 10),
                      },
                    })
                  }
                  className="w-full"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderVariableProperties = (element: OverlayElement) => {
    const props = element.properties as OverlayVariableElementProps;

    const handleAddTextSegment = () => {
      const newSegments: OverlayVariableSegment[] = [
        ...props.segments,
        { type: 'text', value: 'TEXT' },
      ];
      handleUpdateElement(element.id, {
        properties: { ...props, segments: newSegments },
      });
    };

    const handleAddVariableSegment = () => {
      const newSegments: OverlayVariableSegment[] = [
        ...props.segments,
        { type: 'variable', field: 'imdbRating' },
      ];
      handleUpdateElement(element.id, {
        properties: { ...props, segments: newSegments },
      });
    };

    const handleUpdateSegment = (
      index: number,
      updates: Partial<OverlayVariableSegment>
    ) => {
      const newSegments = [...props.segments];
      newSegments[index] = { ...newSegments[index], ...updates };
      handleUpdateElement(element.id, {
        properties: { ...props, segments: newSegments },
      });
    };

    const handleDeleteSegment = (index: number) => {
      const newSegments = props.segments.filter((_, i) => i !== index);
      handleUpdateElement(element.id, {
        properties: { ...props, segments: newSegments },
      });
    };

    const handleMoveSegmentUp = (index: number) => {
      if (index > 0) {
        const newSegments = [...props.segments];
        [newSegments[index], newSegments[index - 1]] = [
          newSegments[index - 1],
          newSegments[index],
        ];
        handleUpdateElement(element.id, {
          properties: { ...props, segments: newSegments },
        });
      }
    };

    const handleMoveSegmentDown = (index: number) => {
      if (index < props.segments.length - 1) {
        const newSegments = [...props.segments];
        [newSegments[index], newSegments[index + 1]] = [
          newSegments[index + 1],
          newSegments[index],
        ];
        handleUpdateElement(element.id, {
          properties: { ...props, segments: newSegments },
        });
      }
    };

    return (
      <div className="space-y-3">
        {/* Segments Builder */}
        <div>
          <label className="mb-2 block text-xs text-stone-300">
            {intl.formatMessage(messages.segments)}
          </label>

          {/* Segment List */}
          <div className="mb-2 space-y-2">
            {props.segments.map((segment, index) => (
              <div
                key={index}
                className="rounded border border-stone-600 bg-stone-800 p-2"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-stone-400">
                    {segment.type === 'text'
                      ? intl.formatMessage(messages.textSegment)
                      : intl.formatMessage(messages.variableSegment)}
                  </span>
                  <div className="flex space-x-1">
                    <button
                      onClick={() => handleMoveSegmentUp(index)}
                      disabled={index === 0}
                      className="rounded p-1 hover:bg-stone-600 disabled:opacity-30"
                    >
                      <ArrowUpIcon className="h-3 w-3 text-stone-300" />
                    </button>
                    <button
                      onClick={() => handleMoveSegmentDown(index)}
                      disabled={index === props.segments.length - 1}
                      className="rounded p-1 hover:bg-stone-600 disabled:opacity-30"
                    >
                      <ArrowDownIcon className="h-3 w-3 text-stone-300" />
                    </button>
                    <button
                      onClick={() => handleDeleteSegment(index)}
                      className="rounded p-1 text-red-400 hover:bg-red-900"
                    >
                      <TrashIcon className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                {segment.type === 'text' ? (
                  <input
                    type="text"
                    value={segment.value || ''}
                    onChange={(e) =>
                      handleUpdateSegment(index, { value: e.target.value })
                    }
                    placeholder="Enter text..."
                    className="w-full rounded border border-stone-600 bg-stone-700 px-2 py-1 text-xs text-white"
                  />
                ) : (
                  <>
                    <select
                      value={segment.field || ''}
                      onChange={(e) =>
                        handleUpdateSegment(index, { field: e.target.value })
                      }
                      className="w-full rounded border border-stone-600 bg-stone-700 px-2 py-1 text-xs text-white"
                    >
                      <option value="">
                        {intl.formatMessage(messages.selectVariable)}
                      </option>
                      <optgroup label="Ratings">
                        {AVAILABLE_VARIABLES.ratings.map((v) => (
                          <option key={v.field} value={v.field}>
                            {v.label}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Metadata">
                        {AVAILABLE_VARIABLES.metadata.map((v) => (
                          <option key={v.field} value={v.field}>
                            {v.label}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Video">
                        {AVAILABLE_VARIABLES.video.map((v) => (
                          <option key={v.field} value={v.field}>
                            {v.label}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Audio">
                        {AVAILABLE_VARIABLES.audio.map((v) => (
                          <option key={v.field} value={v.field}>
                            {v.label}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="File Info">
                        {AVAILABLE_VARIABLES.file.map((v) => (
                          <option key={v.field} value={v.field}>
                            {v.label}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Playback">
                        {AVAILABLE_VARIABLES.playback.map((v) => (
                          <option key={v.field} value={v.field}>
                            {v.label}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Coming Soon">
                        {AVAILABLE_VARIABLES['coming-soon'].map((v) => (
                          <option key={v.field} value={v.field}>
                            {v.label}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Status">
                        {AVAILABLE_VARIABLES.status.map((v) => (
                          <option key={v.field} value={v.field}>
                            {v.label}
                          </option>
                        ))}
                      </optgroup>
                    </select>

                    {/* Date format dropdown - show for date fields */}
                    {segment.field &&
                      [
                        'releaseDate',
                        'nextEpisodeAirDate',
                        'nextSeasonAirDate',
                        'lastPlayed',
                        'dateAdded',
                      ].includes(segment.field) && (
                        <div className="mt-2">
                          <label className="mb-1 block text-xs text-stone-400">
                            {intl.formatMessage(messages.dateFormat)}
                          </label>
                          <select
                            value={segment.format || 'MMM DD'}
                            onChange={(e) =>
                              handleUpdateSegment(index, {
                                format: e.target.value,
                              })
                            }
                            className="w-full rounded border border-stone-600 bg-stone-700 px-2 py-1 text-xs text-white"
                          >
                            <optgroup label="Short (No Year)">
                              <option value="MMM DD">DEC 20</option>
                              <option value="DD MMM">20 DEC</option>
                            </optgroup>
                            <optgroup label="Short (With Year)">
                              <option value="MMM DD, YYYY">DEC 20, 2025</option>
                              <option value="DD MMM YYYY">20 DEC 2025</option>
                            </optgroup>
                            <optgroup label="Full Month Name">
                              <option value="MMMM DD, YYYY">
                                December 20, 2025
                              </option>
                              <option value="DD MMMM YYYY">
                                20 December 2025
                              </option>
                            </optgroup>
                            <optgroup label="Numeric">
                              <option value="YYYY-MM-DD">2025-12-20</option>
                              <option value="YYYY/MM/DD">2025/12/20</option>
                              <option value="MM/DD/YYYY">12/20/2025</option>
                              <option value="DD/MM/YYYY">20/12/2025</option>
                              <option value="DD-MM-YYYY">20-12-2025</option>
                              <option value="DD/MM">20/12</option>
                              <option value="MM/DD">12/20</option>
                            </optgroup>
                            <optgroup label="With Weekday">
                              <option value="DDD DD/MM">MON 20/12</option>
                              <option value="DDDD">MONDAY</option>
                            </optgroup>
                          </select>
                        </div>
                      )}
                  </>
                )}
              </div>
            ))}
          </div>

          {/* Add Segment Buttons */}
          <div className="flex space-x-2">
            <button
              onClick={handleAddTextSegment}
              className="flex flex-1 items-center justify-center space-x-1 rounded bg-stone-700 px-2 py-1.5 text-xs text-stone-200 hover:bg-stone-600"
            >
              <PlusIcon className="h-3 w-3" />
              <span>{intl.formatMessage(messages.addTextSegment)}</span>
            </button>
            <button
              onClick={handleAddVariableSegment}
              className="flex flex-1 items-center justify-center space-x-1 rounded bg-stone-700 px-2 py-1.5 text-xs text-stone-200 hover:bg-stone-600"
            >
              <PlusIcon className="h-3 w-3" />
              <span>{intl.formatMessage(messages.addVariableSegment)}</span>
            </button>
          </div>
        </div>

        {/* Preview */}
        <div className="rounded bg-stone-900 p-2">
          <label className="mb-1 block text-xs text-stone-400">
            {intl.formatMessage(messages.previewText)}
          </label>
          <div className="text-sm font-medium text-white">
            {getVariablePreview(props)}
          </div>
        </div>

        {/* Font Properties */}
        <div>
          <label className="mb-1 block text-xs text-stone-300">
            {intl.formatMessage(messages.fontFamily)}
          </label>
          <select
            value={props.fontFamily || 'Inter'}
            onChange={(e) =>
              handleUpdateElement(element.id, {
                properties: { ...props, fontFamily: e.target.value },
              })
            }
            className="w-full rounded border border-stone-600 bg-stone-700 px-2 py-1 text-xs text-white"
          >
            {fontsData?.fonts.map((font) => (
              <option key={font.family} value={font.family}>
                {font.family}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs text-stone-300">
            {intl.formatMessage(messages.fontSize)} ({props.fontSize}px)
          </label>
          <input
            type="range"
            min="12"
            max="150"
            step="2"
            value={props.fontSize || 48}
            onChange={(e) =>
              handleUpdateElement(element.id, {
                properties: {
                  ...props,
                  fontSize: parseInt(e.target.value, 10),
                },
              })
            }
            className="w-full"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-xs text-stone-300">
              {intl.formatMessage(messages.fontWeight)}
            </label>
            <select
              value={props.fontWeight || 'bold'}
              onChange={(e) =>
                handleUpdateElement(element.id, {
                  properties: {
                    ...props,
                    fontWeight: e.target.value as 'normal' | 'bold',
                  },
                })
              }
              className="w-full rounded border border-stone-600 bg-stone-700 px-2 py-1 text-xs text-white"
            >
              <option value="normal">
                {intl.formatMessage(messages.normal)}
              </option>
              <option value="bold">{intl.formatMessage(messages.bold)}</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-stone-300">
              {intl.formatMessage(messages.fontStyle)}
            </label>
            <select
              value={props.fontStyle || 'normal'}
              onChange={(e) =>
                handleUpdateElement(element.id, {
                  properties: {
                    ...props,
                    fontStyle: e.target.value as 'normal' | 'italic',
                  },
                })
              }
              className="w-full rounded border border-stone-600 bg-stone-700 px-2 py-1 text-xs text-white"
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

        <div>
          <label className="mb-1 block text-xs text-stone-300">
            {intl.formatMessage(messages.textColor)}
          </label>
          <input
            type="color"
            value={props.color || '#FFFFFF'}
            onChange={(e) =>
              handleUpdateElement(element.id, {
                properties: { ...props, color: e.target.value },
              })
            }
            className="h-8 w-full rounded border border-stone-600"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs text-stone-300">
            {intl.formatMessage(messages.textAlign)}
          </label>
          <div className="flex space-x-1">
            {(['left', 'center', 'right'] as const).map((align) => (
              <button
                key={align}
                type="button"
                onClick={() =>
                  handleUpdateElement(element.id, {
                    properties: { ...props, textAlign: align },
                  })
                }
                className={`flex-1 rounded px-2 py-1 text-xs ${
                  props.textAlign === align
                    ? 'bg-orange-600 text-white'
                    : 'bg-stone-700 text-stone-300 hover:bg-stone-600'
                }`}
              >
                {intl.formatMessage(messages[align])}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs text-stone-300">
            {intl.formatMessage(messages.opacity)} ({props.opacity ?? 100}%)
          </label>
          <input
            type="range"
            min="0"
            max="100"
            value={props.opacity ?? 100}
            onChange={(e) =>
              handleUpdateElement(element.id, {
                properties: { ...props, opacity: parseInt(e.target.value) },
              })
            }
            className="w-full"
          />
        </div>
      </div>
    );
  };

  const renderSVGProperties = (element: OverlayElement) => {
    const props = element.properties as OverlaySVGElementProps;
    return (
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs text-stone-300">
            {intl.formatMessage(messages.selectIcon)}
          </label>
          <IconSelector
            value={props.iconPath || ''}
            onChange={(iconPath) => {
              // Auto-size SVG element to match icon's actual dimensions
              // Load the image to get its width and height
              const img = new window.Image();
              img.onload = () => {
                // Update both icon path and element dimensions
                handleUpdateElement(element.id, {
                  width: img.width,
                  height: img.height,
                  properties: { ...props, iconPath },
                });
              };
              img.onerror = () => {
                // If image fails to load, just update the icon path
                handleUpdateElement(element.id, {
                  properties: { ...props, iconPath },
                });
              };
              img.src = iconPath;
            }}
            filter="svg"
            addToast={addToast}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs text-stone-300">
            {intl.formatMessage(messages.opacity)} ({props.opacity || 100}%)
          </label>
          <input
            type="range"
            min="0"
            max="100"
            value={props.opacity || 100}
            onChange={(e) =>
              handleUpdateElement(element.id, {
                properties: { ...props, opacity: parseInt(e.target.value) },
              })
            }
            className="w-full"
          />
        </div>

        <div>
          <label className="flex items-center space-x-2">
            <input
              type="checkbox"
              checked={props.grayscale || false}
              onChange={(e) =>
                handleUpdateElement(element.id, {
                  properties: { ...props, grayscale: e.target.checked },
                })
              }
              className="rounded border-stone-600 bg-stone-800 text-orange-600 focus:ring-orange-500"
            />
            <span className="text-xs text-stone-300">
              {intl.formatMessage(messages.grayscale)}
            </span>
          </label>
        </div>
      </div>
    );
  };

  const renderRasterProperties = (element: OverlayElement) => {
    const props = element.properties as OverlayRasterElementProps;
    return (
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs text-stone-300">
            {intl.formatMessage(messages.selectImage)}
          </label>
          <IconSelector
            value={props.imagePath || ''}
            onChange={(imagePath) =>
              handleUpdateElement(element.id, {
                properties: { ...props, imagePath },
              })
            }
            filter="raster"
            addToast={addToast}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs text-stone-300">
            {intl.formatMessage(messages.opacity)} ({props.opacity || 100}%)
          </label>
          <input
            type="range"
            min="0"
            max="100"
            value={props.opacity || 100}
            onChange={(e) =>
              handleUpdateElement(element.id, {
                properties: { ...props, opacity: parseInt(e.target.value) },
              })
            }
            className="w-full"
          />
        </div>
      </div>
    );
  };

  const renderPositionAndSizeProperties = (element: OverlayElement) => {
    return (
      <div className="mb-4 border-b border-stone-700 pb-4">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-xs text-stone-300">
              {intl.formatMessage(messages.x)}
            </label>
            <input
              type="number"
              value={Math.round(element.x)}
              onChange={(e) =>
                handleUpdateElement(element.id, {
                  x: parseInt(e.target.value) || 0,
                })
              }
              className="w-full rounded border border-stone-600 bg-stone-700 px-2 py-1 text-xs text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-stone-300">
              {intl.formatMessage(messages.y)}
            </label>
            <input
              type="number"
              value={Math.round(element.y)}
              onChange={(e) =>
                handleUpdateElement(element.id, {
                  y: parseInt(e.target.value) || 0,
                })
              }
              className="w-full rounded border border-stone-600 bg-stone-700 px-2 py-1 text-xs text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-stone-300">
              {intl.formatMessage(messages.width)}
            </label>
            <input
              type="number"
              value={Math.round(element.width)}
              onChange={(e) =>
                handleUpdateElement(element.id, {
                  width: parseInt(e.target.value) || 1,
                })
              }
              min="1"
              className="w-full rounded border border-stone-600 bg-stone-700 px-2 py-1 text-xs text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-stone-300">
              {intl.formatMessage(messages.height)}
            </label>
            <input
              type="number"
              value={Math.round(element.height)}
              onChange={(e) =>
                handleUpdateElement(element.id, {
                  height: parseInt(e.target.value) || 1,
                })
              }
              min="1"
              className="w-full rounded border border-stone-600 bg-stone-700 px-2 py-1 text-xs text-white"
            />
          </div>
        </div>
      </div>
    );
  };

  const renderPropertiesPanel = () => {
    if (!selectedElement) {
      return (
        <p className="text-xs text-stone-400">
          {intl.formatMessage(messages.noElementSelected)}
        </p>
      );
    }

    const typeSpecificProperties = () => {
      switch (selectedElement.type) {
        case 'text':
          return renderTextProperties(selectedElement);
        case 'tile':
          return renderTileProperties(selectedElement);
        case 'variable':
          return renderVariableProperties(selectedElement);
        case 'svg':
          return renderSVGProperties(selectedElement);
        case 'raster':
          return renderRasterProperties(selectedElement);
        default:
          return (
            <p className="text-xs text-stone-400">
              {intl.formatMessage(messages.unknownElement, {
                type: selectedElement.type,
              })}
            </p>
          );
      }
    };

    return (
      <>
        {renderPositionAndSizeProperties(selectedElement)}
        {typeSpecificProperties()}
      </>
    );
  };

  return (
    <div className="space-y-4">
      {/* Add Element Buttons - 5 types */}
      <div>
        <h4 className="mb-2 text-sm font-medium text-white">
          {intl.formatMessage(messages.layers)}
        </h4>
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={handleAddText}
            className="flex flex-col items-center rounded-lg bg-stone-700 p-2 text-xs text-stone-200 transition-colors hover:bg-stone-600"
          >
            <DocumentTextIcon className="mb-1 h-4 w-4" />
            {intl.formatMessage(messages.addText)}
          </button>
          <button
            onClick={handleAddTile}
            className="flex flex-col items-center rounded-lg bg-stone-700 p-2 text-xs text-stone-200 transition-colors hover:bg-stone-600"
          >
            <Square3Stack3DIcon className="mb-1 h-4 w-4" />
            {intl.formatMessage(messages.addTile)}
          </button>
          <button
            onClick={handleAddVariable}
            disabled={elements.some((el) => el.type === 'variable')}
            className="flex flex-col items-center rounded-lg bg-stone-700 p-2 text-xs text-stone-200 transition-colors hover:bg-stone-600 disabled:cursor-not-allowed disabled:opacity-50"
            title={
              elements.some((el) => el.type === 'variable')
                ? 'Only one variable element allowed per overlay'
                : undefined
            }
          >
            <VariableIcon className="mb-1 h-4 w-4" />
            {intl.formatMessage(messages.addVariable)}
          </button>
          <button
            onClick={handleAddIcon}
            className="flex flex-col items-center rounded-lg bg-stone-700 p-2 text-xs text-stone-200 transition-colors hover:bg-stone-600"
          >
            <CodeBracketSquareIcon className="mb-1 h-4 w-4" />
            {intl.formatMessage(messages.addIcon)}
          </button>
          <button
            onClick={handleAddImage}
            className="flex flex-col items-center rounded-lg bg-stone-700 p-2 text-xs text-stone-200 transition-colors hover:bg-stone-600"
          >
            <PhotoIcon className="mb-1 h-4 w-4" />
            {intl.formatMessage(messages.addImage)}
          </button>
        </div>
      </div>

      {/* Elements List */}
      <div className="space-y-2">
        {elements.map((element, index) => (
          <div
            key={element.id}
            role="button"
            tabIndex={0}
            className={`rounded-lg p-2 transition-colors ${
              selectedElementId === element.id
                ? 'bg-orange-600 text-white'
                : 'bg-stone-700 text-stone-200 hover:bg-stone-600'
            }`}
            onClick={() => onElementSelect(element.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                onElementSelect(element.id);
              }
            }}
          >
            <div className="flex items-center justify-between">
              <span className="truncate text-sm">
                {getElementIcon(element.type)} {getElementLabel(element)}
              </span>
              <div className="flex shrink-0 space-x-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleMoveUp(element.id);
                  }}
                  disabled={index === 0}
                  className="rounded p-1 hover:bg-stone-500 disabled:opacity-30"
                >
                  <ArrowUpIcon className="h-3 w-3" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleMoveDown(element.id);
                  }}
                  disabled={index === elements.length - 1}
                  className="rounded p-1 hover:bg-stone-500 disabled:opacity-30"
                >
                  <ArrowDownIcon className="h-3 w-3" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteElement(element.id);
                  }}
                  className="rounded p-1 text-red-400 hover:bg-red-900"
                >
                  <TrashIcon className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Properties Panel */}
      <div className="rounded-lg bg-stone-800 p-4">
        <h4 className="mb-3 text-sm font-medium text-white">
          {intl.formatMessage(messages.properties)}
        </h4>
        {renderPropertiesPanel()}
      </div>
    </div>
  );
};
