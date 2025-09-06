import {
  DocumentTextIcon,
  PaintBrushIcon,
  PhotoIcon,
  PlusIcon,
  Square3Stack3DIcon,
  TrashIcon,
} from '@heroicons/react/24/solid';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import useSWR from 'swr';
import type { EditorMode, PosterEditorData } from './PosterEditorModal';

const messages = defineMessages({
  background: 'Background',
  iconsLogos: 'Icons/Logos',
  text: 'Text',
  content: 'Content',
  backgroundType: 'Type',
  color: 'Color',
  gradient: 'Gradient',
  primaryColor: 'Primary Color',
  secondaryColor: 'Secondary Color',
  useSourceColors: 'Use Source Colours',
  sourceType: 'Source Type',
  customizeColors: 'Customize Colors',
  addText: 'Add Text',
  addCustomText: 'Add Custom Text',
  addCollectionTitle: 'Add Collection Title',
  fontSize: 'Font Size',
  fontFamily: 'Font Family',
  fontWeight: 'Font Weight',
  normal: 'Normal',
  bold: 'Bold',
  textColor: 'Text Color',
  textAlign: 'Text Align',
  left: 'Left',
  center: 'Center',
  right: 'Right',
  addIcon: 'Add Icon',
  uploadIcon: 'Upload Icon',
  systemIcons: 'System Icons',
  iconSize: 'Icon Size',
  grayscale: 'Grayscale',
  contentGrid: 'Content Grid',
  addContentGrid: 'Add Content Grid',
  columns: 'Columns',
  rows: 'Rows',
  spacing: 'Spacing',
  cornerRadius: 'Corner Radius',
  removeElement: 'Remove Element',
});

interface PosterEditorToolbarProps {
  posterData: PosterEditorData;
  onChange: (data: PosterEditorData) => void;
  mode: EditorMode;
}

type ToolbarTab = 'background' | 'icons' | 'text' | 'content';

export const PosterEditorToolbar: React.FC<PosterEditorToolbarProps> = ({
  posterData,
  onChange,
  mode,
}) => {
  const intl = useIntl();
  const [activeTab, setActiveTab] = useState<ToolbarTab>('background');
  const [selectedSourceType, setSelectedSourceType] = useState<string>('trakt');

  const isTemplate = mode.includes('template');

  // Fetch source colors
  const { data: sourceColorsData } = useSWR<{
    sourceColors: Record<
      string,
      {
        primaryColor: string;
        secondaryColor: string;
        textColor: string;
        accentColor: string;
      }
    >;
    sourceTypes: string[];
  }>('/api/v1/posters/source-colors');

  const updatePosterData = useCallback(
    (updates: Partial<PosterEditorData>) => {
      onChange({ ...posterData, ...updates });
    },
    [posterData, onChange]
  );

  const updateBackground = useCallback(
    (updates: Partial<PosterEditorData['background']>) => {
      updatePosterData({
        background: { ...posterData.background, ...updates },
      });
    },
    [posterData.background, updatePosterData]
  );

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

  const tabs: {
    id: ToolbarTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    {
      id: 'background',
      label: intl.formatMessage(messages.background),
      icon: PaintBrushIcon,
    },
    {
      id: 'icons',
      label: intl.formatMessage(messages.iconsLogos),
      icon: PhotoIcon,
    },
    {
      id: 'text',
      label: intl.formatMessage(messages.text),
      icon: DocumentTextIcon,
    },
    {
      id: 'content',
      label: intl.formatMessage(messages.content),
      icon: Square3Stack3DIcon,
    },
  ];

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
        accentColor: '#818cf8',
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

  const addTextElement = (type: 'collection-title' | 'custom-text') => {
    const newElement = {
      id: `text-${Date.now()}`,
      type,
      text: type === 'custom-text' ? 'New Text' : undefined,
      x: 250, // Center horizontally
      y: 200 + posterData.textElements.length * 50, // Stack vertically
      width: 200,
      height: 40,
      fontSize: 24,
      fontFamily: 'Helvetica Neue, Segoe UI, Arial, sans-serif',
      fontWeight: 'normal' as const,
      fontStyle: 'normal' as const,
      color: '#ffffff',
      textAlign: 'center' as const,
      maxLines: 1,
    };

    updatePosterData({
      textElements: [...posterData.textElements, newElement],
    });
  };

  const addIconElement = (type: 'source-logo' | 'custom-icon') => {
    const newElement = {
      id: `icon-${Date.now()}`,
      type,
      iconPath: '',
      x: 250, // Center horizontally
      y: 100 + posterData.iconElements.length * 70, // Stack vertically
      width: 50,
      height: 50,
      grayscale: false,
    };

    updatePosterData({
      iconElements: [...posterData.iconElements, newElement],
    });
  };

  const addContentGrid = () => {
    const newGrid = {
      id: `grid-${Date.now()}`,
      x: 84, // Centered for 2x2 grid
      y: 450,
      width: 332,
      height: 266,
      columns: 2,
      rows: 2,
      spacing: 16,
      cornerRadius: 6,
    };

    updatePosterData({
      contentGrid: newGrid,
    });
  };

  const renderBackgroundTab = () => (
    <div className="space-y-4">
      <div>
        <label className="mb-2 block text-sm font-medium text-stone-300">
          {intl.formatMessage(messages.backgroundType)}
        </label>
        <select
          value={posterData.background.type}
          onChange={(e) =>
            updateBackground({ type: e.target.value as 'color' | 'gradient' })
          }
          className="w-full rounded-md border border-stone-600 bg-stone-800 px-3 py-2 text-sm text-white focus:border-orange-500 focus:outline-none"
        >
          <option value="color">{intl.formatMessage(messages.color)}</option>
          <option value="gradient">
            {intl.formatMessage(messages.gradient)}
          </option>
        </select>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-stone-300">
          {intl.formatMessage(messages.primaryColor)}
        </label>
        <input
          type="color"
          value={posterData.background.color || '#6366f1'}
          onChange={(e) => updateBackground({ color: e.target.value })}
          className="h-10 w-full rounded-md border border-stone-600 bg-stone-800 focus:border-orange-500 focus:outline-none"
        />
      </div>

      {posterData.background.type === 'gradient' && (
        <div>
          <label className="mb-2 block text-sm font-medium text-stone-300">
            {intl.formatMessage(messages.secondaryColor)}
          </label>
          <input
            type="color"
            value={posterData.background.secondaryColor || '#1e1b4b'}
            onChange={(e) =>
              updateBackground({ secondaryColor: e.target.value })
            }
            className="h-10 w-full rounded-md border border-stone-600 bg-stone-800 focus:border-orange-500 focus:outline-none"
          />
        </div>
      )}

      {isTemplate && (
        <div className="space-y-3">
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
            <span className="text-sm text-stone-300">
              {intl.formatMessage(messages.useSourceColors)}
            </span>
          </label>

          {posterData.background.useSourceColors && sourceColorsData && (
            <div className="space-y-3 border-l border-stone-600 pl-6">
              <div>
                <label className="mb-2 block text-sm font-medium text-stone-300">
                  {intl.formatMessage(messages.sourceType)}
                </label>
                <select
                  value={selectedSourceType}
                  onChange={(e) => setSelectedSourceType(e.target.value)}
                  className="w-full rounded-md border border-stone-600 bg-stone-800 px-3 py-2 text-sm text-white focus:border-orange-500 focus:outline-none"
                >
                  {sourceColorsData.sourceTypes.map((sourceType) => (
                    <option key={sourceType} value={sourceType}>
                      {sourceType.charAt(0).toUpperCase() + sourceType.slice(1)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <h4 className="text-xs font-medium text-stone-400">
                  {intl.formatMessage(messages.customizeColors)}
                </h4>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label
                      htmlFor="primaryColor"
                      className="mb-1 block text-xs text-stone-400"
                    >
                      Primary
                    </label>
                    <input
                      id="primaryColor"
                      type="color"
                      value={
                        posterData.background.sourceColors?.[selectedSourceType]
                          ?.primaryColor ||
                        sourceColorsData.sourceColors[selectedSourceType]
                          ?.primaryColor ||
                        '#6366f1'
                      }
                      onChange={(e) =>
                        updateSourceColor(
                          selectedSourceType,
                          'primaryColor',
                          e.target.value
                        )
                      }
                      className="h-8 w-full rounded border border-stone-600 bg-stone-800"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="secondaryColor"
                      className="mb-1 block text-xs text-stone-400"
                    >
                      Secondary
                    </label>
                    <input
                      id="secondaryColor"
                      type="color"
                      value={
                        posterData.background.sourceColors?.[selectedSourceType]
                          ?.secondaryColor ||
                        sourceColorsData.sourceColors[selectedSourceType]
                          ?.secondaryColor ||
                        '#1e1b4b'
                      }
                      onChange={(e) =>
                        updateSourceColor(
                          selectedSourceType,
                          'secondaryColor',
                          e.target.value
                        )
                      }
                      className="h-8 w-full rounded border border-stone-600 bg-stone-800"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="textColor"
                      className="mb-1 block text-xs text-stone-400"
                    >
                      Text
                    </label>
                    <input
                      id="textColor"
                      type="color"
                      value={
                        posterData.background.sourceColors?.[selectedSourceType]
                          ?.textColor ||
                        sourceColorsData.sourceColors[selectedSourceType]
                          ?.textColor ||
                        '#ffffff'
                      }
                      onChange={(e) =>
                        updateSourceColor(
                          selectedSourceType,
                          'textColor',
                          e.target.value
                        )
                      }
                      className="h-8 w-full rounded border border-stone-600 bg-stone-800"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="accentColor"
                      className="mb-1 block text-xs text-stone-400"
                    >
                      Accent
                    </label>
                    <input
                      id="accentColor"
                      type="color"
                      value={
                        posterData.background.sourceColors?.[selectedSourceType]
                          ?.accentColor ||
                        sourceColorsData.sourceColors[selectedSourceType]
                          ?.accentColor ||
                        '#818cf8'
                      }
                      onChange={(e) =>
                        updateSourceColor(
                          selectedSourceType,
                          'accentColor',
                          e.target.value
                        )
                      }
                      className="h-8 w-full rounded border border-stone-600 bg-stone-800"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );

  const renderTextTab = () => (
    <div className="space-y-4">
      <div>
        <label className="mb-2 block text-sm font-medium text-stone-300">
          {intl.formatMessage(messages.addText)}
        </label>
        <div className="flex space-x-2">
          <button
            type="button"
            onClick={() => addTextElement('custom-text')}
            className="flex-1 rounded-md bg-orange-600 px-3 py-2 text-xs text-white hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-500"
          >
            <PlusIcon className="mr-1 inline h-4 w-4" />
            {intl.formatMessage(messages.addCustomText)}
          </button>
        </div>
      </div>

      {isTemplate && (
        <div>
          <button
            type="button"
            onClick={() => addTextElement('collection-title')}
            className="w-full rounded-md border border-stone-600 px-3 py-2 text-xs text-stone-300 hover:border-stone-500 hover:text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
          >
            <PlusIcon className="mr-1 inline h-4 w-4" />
            {intl.formatMessage(messages.addCollectionTitle)}
          </button>
        </div>
      )}

      {posterData.textElements.length > 0 && (
        <div className="border-t border-stone-700 pt-4">
          <h4 className="mb-3 text-sm font-medium text-stone-300">
            Text Elements
          </h4>
          <div className="max-h-40 space-y-3 overflow-y-auto">
            {posterData.textElements.map((element, index) => (
              <div
                key={element.id}
                className="rounded-md border border-stone-700 bg-stone-800 p-3"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs text-stone-400">
                    {element.type === 'collection-title'
                      ? 'Collection Title'
                      : 'Custom Text'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const newElements = posterData.textElements.filter(
                        (_, i) => i !== index
                      );
                      updatePosterData({ textElements: newElements });
                    }}
                    className="text-red-400 hover:text-red-300 focus:outline-none"
                  >
                    <TrashIcon className="h-3 w-3" />
                  </button>
                </div>

                {element.type === 'custom-text' && (
                  <input
                    type="text"
                    value={element.text || ''}
                    onChange={(e) => {
                      const newElements = [...posterData.textElements];
                      newElements[index] = { ...element, text: e.target.value };
                      updatePosterData({ textElements: newElements });
                    }}
                    className="mb-2 w-full rounded border border-stone-600 bg-stone-700 px-2 py-1 text-xs text-white focus:border-orange-500 focus:outline-none"
                    placeholder="Enter text"
                  />
                )}

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <div className="mb-1 block text-stone-400">Size</div>
                    <input
                      type="range"
                      min="8"
                      max="72"
                      value={element.fontSize}
                      onChange={(e) => {
                        const newElements = [...posterData.textElements];
                        newElements[index] = {
                          ...element,
                          fontSize: Number(e.target.value),
                        };
                        updatePosterData({ textElements: newElements });
                      }}
                      className="w-full"
                    />
                    <span className="text-stone-500">{element.fontSize}px</span>
                  </div>

                  <div>
                    <div className="mb-1 block text-stone-400">Color</div>
                    <input
                      type="color"
                      value={element.color}
                      onChange={(e) => {
                        const newElements = [...posterData.textElements];
                        newElements[index] = {
                          ...element,
                          color: e.target.value,
                        };
                        updatePosterData({ textElements: newElements });
                      }}
                      className="h-6 w-full rounded border border-stone-600"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const renderIconsTab = () => (
    <div className="space-y-4">
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => addIconElement('source-logo')}
          className="w-full rounded-md bg-orange-600 px-3 py-2 text-sm text-white hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-500"
        >
          <PlusIcon className="mr-1 inline h-4 w-4" />
          Add Source Logo
        </button>
        <button
          type="button"
          onClick={() => addIconElement('custom-icon')}
          className="w-full rounded-md border border-orange-600 px-3 py-2 text-sm text-orange-600 hover:bg-orange-600 hover:text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
        >
          <PlusIcon className="mr-1 inline h-4 w-4" />
          Add Custom Icon
        </button>
      </div>

      {posterData.iconElements.length > 0 && (
        <div className="border-t border-stone-700 pt-4">
          <h4 className="mb-3 text-sm font-medium text-stone-300">
            Icon Elements
          </h4>
          <div className="max-h-40 space-y-3 overflow-y-auto">
            {posterData.iconElements.map((element, index) => (
              <div
                key={element.id}
                className="rounded-md border border-stone-700 bg-stone-800 p-3"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs text-stone-400">
                    {element.type === 'source-logo'
                      ? 'Source Logo'
                      : 'Custom Icon'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const newElements = posterData.iconElements.filter(
                        (_, i) => i !== index
                      );
                      updatePosterData({ iconElements: newElements });
                    }}
                    className="text-red-400 hover:text-red-300 focus:outline-none"
                  >
                    <TrashIcon className="h-3 w-3" />
                  </button>
                </div>

                <div className="space-y-2">
                  <div>
                    <label className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        checked={element.grayscale}
                        onChange={(e) => {
                          const newElements = [...posterData.iconElements];
                          newElements[index] = {
                            ...element,
                            grayscale: e.target.checked,
                          };
                          updatePosterData({ iconElements: newElements });
                        }}
                        className="rounded border-stone-600 bg-stone-800 text-orange-600 focus:ring-orange-500"
                      />
                      <span className="text-xs text-stone-300">
                        {intl.formatMessage(messages.grayscale)}
                      </span>
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <div className="mb-1 block text-stone-400">Width</div>
                      <input
                        type="range"
                        min="10"
                        max="200"
                        value={element.width}
                        onChange={(e) => {
                          const newElements = [...posterData.iconElements];
                          newElements[index] = {
                            ...element,
                            width: Number(e.target.value),
                          };
                          updatePosterData({ iconElements: newElements });
                        }}
                        className="w-full"
                      />
                      <span className="text-stone-500">{element.width}px</span>
                    </div>

                    <div>
                      <div className="mb-1 block text-stone-400">Height</div>
                      <input
                        type="range"
                        min="10"
                        max="200"
                        value={element.height}
                        onChange={(e) => {
                          const newElements = [...posterData.iconElements];
                          newElements[index] = {
                            ...element,
                            height: Number(e.target.value),
                          };
                          updatePosterData({ iconElements: newElements });
                        }}
                        className="w-full"
                      />
                      <span className="text-stone-500">{element.height}px</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const renderContentTab = () => (
    <div className="space-y-4">
      {!posterData.contentGrid ? (
        <div>
          <button
            type="button"
            onClick={addContentGrid}
            className="w-full rounded-md bg-orange-600 px-3 py-2 text-sm text-white hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-500"
          >
            <PlusIcon className="mr-1 inline h-4 w-4" />
            {intl.formatMessage(messages.addContentGrid)}
          </button>
          <p className="mt-2 text-xs text-stone-400">
            Add a content grid to display collection items (movies, TV shows,
            etc.)
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-stone-300">Content Grid</h4>
            <button
              type="button"
              onClick={() => updatePosterData({ contentGrid: undefined })}
              className="text-red-400 hover:text-red-300 focus:outline-none"
            >
              <TrashIcon className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-stone-400">
                {intl.formatMessage(messages.columns)}
              </label>
              <input
                type="range"
                min="1"
                max="6"
                value={posterData.contentGrid.columns}
                onChange={(e) => {
                  if (posterData.contentGrid) {
                    const newGrid = {
                      ...posterData.contentGrid,
                      columns: Number(e.target.value),
                    };
                    updatePosterData({ contentGrid: newGrid });
                  }
                }}
                className="w-full"
              />
              <span className="text-xs text-stone-500">
                {posterData.contentGrid.columns}
              </span>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-stone-400">
                {intl.formatMessage(messages.rows)}
              </label>
              <input
                type="range"
                min="1"
                max="6"
                value={posterData.contentGrid.rows}
                onChange={(e) => {
                  if (posterData.contentGrid) {
                    const newGrid = {
                      ...posterData.contentGrid,
                      rows: Number(e.target.value),
                    };
                    updatePosterData({ contentGrid: newGrid });
                  }
                }}
                className="w-full"
              />
              <span className="text-xs text-stone-500">
                {posterData.contentGrid.rows}
              </span>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-stone-400">
                {intl.formatMessage(messages.spacing)}
              </label>
              <input
                type="range"
                min="0"
                max="50"
                value={posterData.contentGrid.spacing}
                onChange={(e) => {
                  if (posterData.contentGrid) {
                    const newGrid = {
                      ...posterData.contentGrid,
                      spacing: Number(e.target.value),
                    };
                    updatePosterData({ contentGrid: newGrid });
                  }
                }}
                className="w-full"
              />
              <span className="text-xs text-stone-500">
                {posterData.contentGrid.spacing}px
              </span>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-stone-400">
                {intl.formatMessage(messages.cornerRadius)}
              </label>
              <input
                type="range"
                min="0"
                max="20"
                value={posterData.contentGrid.cornerRadius}
                onChange={(e) => {
                  if (posterData.contentGrid) {
                    const newGrid = {
                      ...posterData.contentGrid,
                      cornerRadius: Number(e.target.value),
                    };
                    updatePosterData({ contentGrid: newGrid });
                  }
                }}
                className="w-full"
              />
              <span className="text-xs text-stone-500">
                {posterData.contentGrid.cornerRadius}px
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const renderTabContent = () => {
    switch (activeTab) {
      case 'background':
        return renderBackgroundTab();
      case 'text':
        return renderTextTab();
      case 'icons':
        return renderIconsTab();
      case 'content':
        return renderContentTab();
      default:
        return null;
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Tab Navigation */}
      <div className="mb-4 flex flex-col space-y-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center space-x-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-orange-600 text-white'
                  : 'text-stone-300 hover:bg-stone-700 hover:text-white'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto">{renderTabContent()}</div>
    </div>
  );
};
