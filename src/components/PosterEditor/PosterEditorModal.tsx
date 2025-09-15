import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/solid';
import type React from 'react';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import useSWR from 'swr';
import { PosterEditorCanvas } from './PosterEditorCanvas';
import { PosterEditorToolbar } from './PosterEditorToolbar';

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
  textElements: {
    id: string;
    type: 'collection-title' | 'custom-text';
    text?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    fontSize: number;
    fontFamily: string;
    fontWeight: 'normal' | 'bold';
    fontStyle: 'normal' | 'italic';
    color: string;
    textAlign: 'left' | 'center' | 'right';
    maxLines?: number;
  }[];
  iconElements: {
    id: string;
    type: 'source-logo' | 'custom-icon';
    iconPath?: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }[];
  contentGrid?: {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    columns: number;
    rows: number;
    spacing: number;
    cornerRadius: number;
  };
}

export interface PosterEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: EditorMode;
  initialData?: PosterEditorData;
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
    type: 'gradient',
    color: '#6366f1',
    secondaryColor: '#1e1b4b',
  },
  textElements: [
    {
      id: 'title',
      type: 'collection-title',
      x: 30, // (500 - 440) / 2 = 30 for proper centering
      y: 375,
      width: 440,
      height: 100,
      fontSize: 32,
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      fontWeight: 'bold',
      fontStyle: 'normal',
      color: '#ffffff',
      textAlign: 'center',
      maxLines: 3,
    },
  ],
  iconElements: [],
};

export const PosterEditorModal: React.FC<PosterEditorModalProps> = ({
  isOpen,
  onClose,
  mode,
  initialData = DEFAULT_POSTER_DATA,
  previewCollectionConfig: externalPreviewConfig,
  onSave,
  setPreviewCollectionConfig: externalSetPreviewConfig,
}) => {
  const intl = useIntl();
  const [posterData, setPosterData] = useState<PosterEditorData>(initialData);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [currentlyEditingSource, setCurrentlyEditingSource] = useState<
    string | undefined
  >();
  const [snapToGuides, setSnapToGuides] = useState(true);
  const canvasRef = useRef<{ exportAsImage: () => Promise<string> } | null>(
    null
  );

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

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setPosterData(initialData);
      setName('');
      setDescription('');
    }
  }, [isOpen, initialData]);

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
                    />
                  </div>

                  {/* Right sidebar - Tools */}
                  <div className="col-span-3 overflow-y-auto">
                    <PosterEditorToolbar
                      posterData={posterData}
                      onChange={setPosterData}
                      mode={mode}
                      onCurrentlyEditingSourceChange={setCurrentlyEditingSource}
                      snapToGuides={snapToGuides}
                      onSnapToGuidesChange={setSnapToGuides}
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
