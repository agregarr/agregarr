import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/solid';
import type React from 'react';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { useToasts } from 'react-toast-notifications';
import useSWR from 'swr';
import { LayerPanel } from './LayerPanel';
import {
  PosterEditorCanvas,
  type PosterEditorCanvasRef,
} from './PosterEditorCanvas';

const messages = defineMessages({
  createPosterTitle: 'Create Poster',
  createTemplateTitle: 'Create Template',
  editPosterTitle: 'Edit Poster',
  editTemplateTitle: 'Edit Template',
  save: 'Save',
  cancel: 'Cancel',
  saving: 'Saving...',
  posterName: 'Poster Name',
  templateName: 'Template Name',
  description: 'Description (Optional)',
  enterName: 'Enter a name',
  enterDescription: 'Enter a description',
  sampleCollection: 'Preview Collection (Visualization Only)',
  selectCollection: 'Select a collection...',
  sampleCollectionHelp:
    'Choose a collection to see how your template will look with real data. This is for preview only - templates save as reusable designs.',
});

export type EditorMode =
  | 'create-poster'
  | 'create-template'
  | 'edit-poster'
  | 'edit-template';

// Frontend layered element types matching backend structure
export interface LayeredElement {
  id: string;
  layerOrder: number; // 0 = bottom, higher = top
  type: 'text' | 'raster' | 'svg' | 'content-grid';

  // Common properties
  x: number;
  y: number;
  width: number;
  height: number;

  // Type-specific properties (discriminated union)
  properties:
    | TextElementProps
    | RasterElementProps
    | SVGElementProps
    | ContentGridProps;
}

export interface TextElementProps {
  elementType: 'collection-title' | 'custom-text';
  text?: string; // For custom text, collection title is dynamic
  fontSize: number;
  fontFamily: string;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  color: string;
  textAlign: 'left' | 'center' | 'right';
  maxLines?: number;
  // Text-specific source colors for templates
  useSourceColors?: boolean;
  sourceColorType?: string;
}

export interface RasterElementProps {
  imagePath: string; // Path to uploaded raster image
}

export interface SVGElementProps {
  iconType: 'source-logo' | 'svg-icon';
  iconPath?: string; // For custom icons, service logo is dynamic
}

export interface ContentGridProps {
  columns: number;
  rows: number;
  spacing: number;
  cornerRadius: number;
}

export interface PosterEditorData {
  width: number;
  height: number;
  background: {
    type: 'color' | 'gradient' | 'radial';
    color?: string;
    secondaryColor?: string;
    intensity?: number; // 0-100, controls gradient spread
    useSourceColors?: boolean;
    sourceColors?: {
      [sourceType: string]: {
        primaryColor: string;
        secondaryColor: string;
        textColor: string;
      };
    };
  };

  // Unified layering system - all elements in single array
  elements: LayeredElement[]; // Unified element list with layer ordering
  migrated: boolean; // Flag to track if template has been migrated to new system
}

export interface PosterEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: EditorMode;
  initialData?: PosterEditorData;
  initialName?: string;
  initialDescription?: string;
  previewCollectionConfig?: {
    name: string;
    type?: string;
    mediaType?: 'movie' | 'tv';
  };
  onSave: (data: {
    name: string;
    description?: string;
    posterData: PosterEditorData;
  }) => Promise<void>;
  setPreviewCollectionConfig?: (
    config:
      | { name: string; type?: string; mediaType?: 'movie' | 'tv' }
      | undefined
  ) => void;
}

const DEFAULT_POSTER_DATA: PosterEditorData = {
  width: 500,
  height: 750,
  background: {
    type: 'radial',
    color: '#fb923c',
    secondaryColor: '#c2410c',
    intensity: 50,
  },
  elements: [],
  migrated: true,
};

export const PosterEditorModal: React.FC<PosterEditorModalProps> = ({
  isOpen,
  onClose,
  mode,
  initialData = DEFAULT_POSTER_DATA,
  initialName = '',
  initialDescription = '',
  previewCollectionConfig: externalPreviewConfig,
  onSave,
  setPreviewCollectionConfig: externalSetPreviewConfig,
}) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const [posterData, setPosterData] = useState<PosterEditorData>(initialData);
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [saving, setSaving] = useState(false);
  const [currentlyEditingSource, setCurrentlyEditingSource] = useState<
    string | undefined
  >();
  const [snapToGuides, setSnapToGuides] = useState(true);
  const [aspectRatioLocked, setAspectRatioLocked] = useState<
    Record<string, boolean>
  >({});
  const [selectedElementId, setSelectedElementId] = useState<
    string | undefined
  >();
  // Unified layering system is now the only system
  const canvasRef = useRef<PosterEditorCanvasRef | null>(null);

  // Internal preview collection state (for template/poster creation from PostersView)
  const [internalPreviewConfig, setInternalPreviewConfig] = useState<
    | {
        name: string;
        type?: string;
        mediaType?: 'movie' | 'tv';
      }
    | undefined
  >(undefined);

  // Use external config if provided, otherwise use internal state
  const previewCollectionConfig =
    externalPreviewConfig || internalPreviewConfig;
  const setPreviewCollectionConfig =
    externalSetPreviewConfig || setInternalPreviewConfig;

  // Stable onChange callback to prevent re-renders
  const handlePosterDataChange = useCallback((data: PosterEditorData) => {
    setPosterData(data);
  }, []);

  // Fetch actual collection configs for preview
  const { data: collectionsData } = useSWR<{
    collectionConfigs: {
      name: string;
      type?: string;
      mediaType?: 'movie' | 'tv';
    }[];
  }>(isOpen ? '/api/v1/collections' : null);

  // Fetch source colors for background rendering
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
  }>(isOpen ? '/api/v1/source-colors' : null);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      // Data should already be migrated by backend
      if (!initialData.migrated || !initialData.elements) {
        // For development, show a helpful error
        throw new Error(
          'Template data must be migrated by backend before reaching client'
        );
      }

      setPosterData(initialData);
      setName(initialName);
      setDescription(initialDescription);
      setSelectedElementId(undefined);
    }
  }, [isOpen, initialData, initialName, initialDescription]);

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      return;
    }

    try {
      setSaving(true);
      await onSave({
        name: name.trim(),
        description: description.trim() || undefined,
        posterData,
      });
      onClose();
    } catch (error) {
      // Log error silently for debugging
      if (process.env.NODE_ENV === 'development') {
        // eslint-disable-next-line no-console
        console.error('Failed to save:', error);
      }
    } finally {
      setSaving(false);
    }
  }, [name, description, posterData, onSave, onClose]);

  const handleCancel = useCallback(() => {
    onClose();
  }, [onClose]);

  const getTitle = () => {
    switch (mode) {
      case 'create-poster':
        return intl.formatMessage(messages.createPosterTitle);
      case 'create-template':
        return intl.formatMessage(messages.createTemplateTitle);
      case 'edit-poster':
        return intl.formatMessage(messages.editPosterTitle);
      case 'edit-template':
        return intl.formatMessage(messages.editTemplateTitle);
      default:
        return '';
    }
  };

  const isTemplate = mode.includes('template');
  const nameLabel = isTemplate
    ? intl.formatMessage(messages.templateName)
    : intl.formatMessage(messages.posterName);

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black bg-opacity-75" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-7xl transform overflow-hidden rounded-2xl bg-stone-900 p-6 text-left align-middle shadow-xl transition-all">
                <div className="mb-4 flex items-center justify-between">
                  <Dialog.Title
                    as="h3"
                    className="text-lg font-medium leading-6 text-white"
                  >
                    {getTitle()}
                  </Dialog.Title>
                  <button
                    type="button"
                    className="rounded-md p-2 text-stone-400 hover:text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                    onClick={onClose}
                  >
                    <XMarkIcon className="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>

                <div className="grid h-[calc(100vh-160px)] max-h-[800px] grid-cols-12 gap-6">
                  {/* Left sidebar - Form */}
                  <div className="col-span-3 space-y-4 overflow-y-auto">
                    <div>
                      <label
                        htmlFor="name"
                        className="mb-2 block text-sm font-medium text-stone-300"
                      >
                        {nameLabel}
                      </label>
                      <input
                        type="text"
                        id="name"
                        className="w-full rounded-md border border-stone-600 bg-stone-800 px-3 py-2 text-sm text-white placeholder-stone-400 focus:border-orange-500 focus:outline-none"
                        placeholder={intl.formatMessage(messages.enterName)}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="description"
                        className="mb-2 block text-sm font-medium text-stone-300"
                      >
                        {intl.formatMessage(messages.description)}
                      </label>
                      <textarea
                        id="description"
                        rows={3}
                        className="w-full resize-none rounded-md border border-stone-600 bg-stone-800 px-3 py-2 text-sm text-white placeholder-stone-400 focus:border-orange-500 focus:outline-none"
                        placeholder={intl.formatMessage(
                          messages.enterDescription
                        )}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                      />
                    </div>

                    {/* Action buttons */}
                    <div className="border-t border-stone-700 pt-4">
                      <div className="flex flex-col space-y-2">
                        <button
                          type="button"
                          onClick={handleSave}
                          disabled={!name.trim() || saving}
                          className="w-full rounded-md bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {saving
                            ? intl.formatMessage(messages.saving)
                            : intl.formatMessage(messages.save)}
                        </button>
                        <button
                          type="button"
                          onClick={handleCancel}
                          disabled={saving}
                          className="w-full rounded-md border border-stone-600 px-4 py-2 text-sm font-medium text-stone-300 hover:border-stone-500 hover:text-white focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {intl.formatMessage(messages.cancel)}
                        </button>
                      </div>
                    </div>

                    {/* Collection Preview Selector */}
                    <div>
                      <label
                        htmlFor="previewCollection"
                        className="mb-2 block text-sm font-medium text-stone-300"
                      >
                        {intl.formatMessage(messages.sampleCollection)}
                      </label>
                      <select
                        id="previewCollection"
                        className="w-full rounded-md border border-stone-600 bg-stone-800 px-3 py-2 text-sm text-white focus:border-orange-500 focus:outline-none"
                        value={previewCollectionConfig?.name || ''}
                        onChange={(e) => {
                          const collectionConfigs =
                            collectionsData?.collectionConfigs || [];
                          const selected = collectionConfigs.find(
                            (c) => c.name === e.target.value
                          );
                          if (selected && setPreviewCollectionConfig) {
                            setPreviewCollectionConfig({
                              name: selected.name,
                              type: selected.type,
                              mediaType: selected.mediaType || 'movie',
                            });
                          } else if (
                            !e.target.value &&
                            setPreviewCollectionConfig
                          ) {
                            // Clear selection
                            setPreviewCollectionConfig(undefined);
                          }
                        }}
                      >
                        <option value="">
                          {intl.formatMessage(messages.selectCollection)}
                        </option>
                        {(collectionsData?.collectionConfigs || []).map(
                          (collection) => (
                            <option
                              key={collection.name}
                              value={collection.name}
                            >
                              {collection.name} ({collection.type || 'Unknown'})
                            </option>
                          )
                        )}
                      </select>
                      <p className="mt-1 text-xs text-stone-500">
                        {intl.formatMessage(messages.sampleCollectionHelp)}
                      </p>
                    </div>
                  </div>

                  {/* Center - Canvas */}
                  <div className="col-span-6 flex items-center justify-center overflow-hidden rounded-lg bg-stone-800">
                    <PosterEditorCanvas
                      ref={canvasRef}
                      posterData={posterData}
                      onChange={handlePosterDataChange}
                      previewCollectionConfig={previewCollectionConfig}
                      mode={mode}
                      currentlyEditingSource={currentlyEditingSource}
                      snapToGuides={snapToGuides}
                      selectedElementId={selectedElementId}
                      sourceColorsData={sourceColorsData}
                      aspectRatioLocked={aspectRatioLocked}
                    />
                  </div>

                  {/* Right sidebar - Tools */}
                  <div className="col-span-3 overflow-y-auto">
                    <LayerPanel
                      posterData={posterData}
                      onChange={setPosterData}
                      selectedElementId={selectedElementId}
                      onElementSelect={setSelectedElementId}
                      mode={mode}
                      snapToGuides={snapToGuides}
                      onSnapToGuidesChange={setSnapToGuides}
                      onCurrentlyEditingSourceChange={setCurrentlyEditingSource}
                      addToast={addToast}
                      aspectRatioLocked={aspectRatioLocked}
                      onAspectRatioLockedChange={setAspectRatioLocked}
                    />
                  </div>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
};
