import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import type {
  EditorMode,
  PosterEditorData,
} from '@app/components/PosterEditor';
import { PosterEditorModal } from '@app/components/PosterEditor';
import { fontLoader } from '@app/utils/fontLoader';
import { Menu, Tab, Transition } from '@headlessui/react';
import {
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  ChevronDownIcon,
  PlusIcon,
} from '@heroicons/react/24/solid';
import { Fragment, useEffect, useRef, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { useToasts } from 'react-toast-notifications';
import useSWR from 'swr';
import OverlaysView from './OverlaysView';
import PosterTemplateGrid from './PosterTemplateGrid';
import SavedPosterGrid from './SavedPosterGrid';

const messages = defineMessages({
  templates: 'Collection Templates',
  savedPosters: 'Saved Posters',
  overlays: 'Poster Overlays',
  createTemplate: 'Create Template',
  createPoster: 'Create Poster',
  import: 'Import',
  importTemplate: 'Import Template',
  importSourceColors: 'Import Source Colors',
  exportSourceColors: 'Export Source Colors',
  loading: 'Loading...',
  error: 'Failed to load data',
  importSuccess: 'Template imported successfully',
  importError: 'Failed to import file',
  sourceColorsExportSuccess: 'Source colors exported successfully',
  sourceColorsExportError: 'Failed to export source colors',
  invalidFileFormat:
    'Invalid file format. Please select a valid template or source colors JSON file.',
});

interface PosterTemplate {
  id: number;
  name: string;
  description?: string;
  templateData: PosterEditorData;
  isDefault: boolean;
  isPersonDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SavedPoster {
  id: number;
  name: string;
  description?: string;
  posterData: PosterEditorData;
  imagePath?: string;
  thumbnailPath?: string;
  createdAt: string;
  updatedAt: string;
}

const PostersView: React.FC = () => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const [selectedTab, setSelectedTab] = useState(0);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<EditorMode>('create-template');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch templates and posters
  const {
    data: templatesData,
    error: templatesError,
    mutate: mutateTemplates,
  } = useSWR<{ templates: PosterTemplate[] }>('/api/v1/posters/templates');

  const {
    data: savedPostersData,
    error: savedPostersError,
    mutate: mutateSavedPosters,
  } = useSWR<{ posters: SavedPoster[] }>('/api/v1/posters/saved');

  // Fetch fonts for preloading
  const { data: fontsData } = useSWR<{
    fonts: {
      family: string;
      availableWeights: string[];
      cssValue: string;
      fontUrl?: string;
    }[];
    count: number;
  }>('/api/v1/fonts');

  // Preload fonts when PostersView loads
  useEffect(() => {
    if (fontsData?.fonts) {
      const fontsToLoad = fontsData.fonts
        .filter((font) => font.fontUrl)
        .map((font) => ({ family: font.family, fontUrl: font.fontUrl || '' }))
        .filter((font) => font.fontUrl);

      if (fontsToLoad.length > 0) {
        fontLoader.loadFonts(fontsToLoad).catch(() => {
          // Font preloading failed - continue with fallbacks
        });
      }
    }
  }, [fontsData]);

  const templates = templatesData?.templates || [];
  const savedPosters = savedPostersData?.posters || [];

  const handleCreateTemplate = () => {
    setModalMode('create-template');
    setIsModalOpen(true);
  };

  const handleImportTemplate = () => {
    fileInputRef.current?.click();
  };

  const handleExportSourceColors = async () => {
    try {
      const response = await fetch('/api/v1/source-colors/export');

      if (!response.ok) {
        throw new Error('Failed to export source colors');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'source_colors.json';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      addToast(intl.formatMessage(messages.sourceColorsExportSuccess), {
        appearance: 'success',
        autoDismiss: true,
      });
    } catch (error) {
      addToast(intl.formatMessage(messages.sourceColorsExportError), {
        appearance: 'error',
        autoDismiss: true,
      });
    }
  };

  const handleFileSelect = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      // Check if it's a ZIP file (poster template) or JSON file (source colors)
      if (file.name.endsWith('.zip')) {
        // This is a poster template ZIP file
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch('/template-import', {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Import failed');
        }

        mutateTemplates();
        addToast(intl.formatMessage(messages.importSuccess), {
          appearance: 'success',
          autoDismiss: true,
        });
      } else if (file.name.endsWith('.json')) {
        // This is a source colors export file
        const text = await file.text();
        const data = JSON.parse(text);

        if (data.sourceColors) {
          const response = await fetch('/api/v1/source-colors/import', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(data),
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Import failed');
          }

          const result = await response.json();
          addToast(
            `Successfully imported ${result.importCount} source color schemes`,
            {
              appearance: 'success',
              autoDismiss: true,
            }
          );
        } else {
          throw new Error(
            'Invalid JSON file format. Please select a valid source colors JSON file.'
          );
        }
      } else {
        throw new Error(
          'Unsupported file type. Please upload a ZIP file for templates or JSON file for source colors.'
        );
      }
    } catch (error) {
      // Show user-friendly error message
      addToast(
        error instanceof Error
          ? error.message
          : intl.formatMessage(messages.importError),
        {
          appearance: 'error',
          autoDismiss: true,
        }
      );
    }

    // Reset file input
    if (event.target) {
      event.target.value = '';
    }
  };

  // Temporarily commented out for initial release
  // const handleCreatePoster = () => {
  //   setModalMode('create-poster');
  //   setIsModalOpen(true);
  // };

  const handleSave = async (data: {
    name: string;
    description?: string;
    posterData: PosterEditorData;
  }) => {
    const endpoint = modalMode.includes('template')
      ? '/api/v1/posters/templates'
      : '/api/v1/posters/saved';

    const payload = modalMode.includes('template')
      ? {
          name: data.name,
          description: data.description,
          templateData: data.posterData,
        }
      : {
          name: data.name,
          description: data.description,
          posterData: data.posterData,
        };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error('Failed to save');
    }

    // Refresh the appropriate list
    if (modalMode.includes('template')) {
      mutateTemplates();
    } else {
      mutateSavedPosters();
    }
  };

  const tabs = [
    {
      name: intl.formatMessage(messages.templates),
      count: undefined,
    },
    {
      name: intl.formatMessage(messages.savedPosters),
      count: savedPosters?.length || 0,
    },
    {
      name: intl.formatMessage(messages.overlays),
      count: undefined, // No count for overlays tab
    },
  ];

  if (templatesError || savedPostersError) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-red-400">{intl.formatMessage(messages.error)}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Tab.Group selectedIndex={selectedTab} onChange={setSelectedTab}>
        <div className="flex items-center justify-between">
          <Tab.List className="flex space-x-1 rounded-xl bg-stone-900/20 p-1">
            {tabs.map((tab) => (
              <Tab as={Fragment} key={tab.name}>
                {({ selected }) => (
                  <button
                    className={`w-full rounded-lg py-2.5 px-4 text-sm font-medium leading-5 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-opacity-75 ${
                      selected
                        ? 'bg-white text-orange-700 shadow'
                        : 'text-stone-100 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    {tab.name}
                  </button>
                )}
              </Tab>
            ))}
          </Tab.List>

          <div className="flex space-x-3">
            {selectedTab === 0 && (
              <Button
                buttonType="primary"
                onClick={handleCreateTemplate}
                className="flex items-center space-x-2"
              >
                <PlusIcon className="h-4 w-4" />
                <span>{intl.formatMessage(messages.createTemplate)}</span>
              </Button>
            )}
            {selectedTab === 0 && (
              <Menu as="div" className="relative inline-block text-left">
                <div>
                  <Menu.Button className="inline-flex items-center space-x-2 rounded-md border border-stone-600 bg-stone-700 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-stone-600 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2">
                    <ArrowUpTrayIcon className="h-4 w-4" />
                    <span>{intl.formatMessage(messages.import)}</span>
                    <ChevronDownIcon className="h-4 w-4" />
                  </Menu.Button>
                </div>

                <Transition
                  as={Fragment}
                  enter="transition ease-out duration-100"
                  enterFrom="transform opacity-0 scale-95"
                  enterTo="transform opacity-100 scale-100"
                  leave="transition ease-in duration-75"
                  leaveFrom="transform opacity-100 scale-100"
                  leaveTo="transform opacity-0 scale-95"
                >
                  <Menu.Items className="absolute right-0 z-10 mt-2 w-56 origin-top-right rounded-md bg-stone-800 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
                    <div className="py-1">
                      <Menu.Item>
                        {({ active }) => (
                          <button
                            onClick={handleImportTemplate}
                            className={`${
                              active
                                ? 'bg-stone-700 text-white'
                                : 'text-stone-200'
                            } flex w-full items-center px-4 py-2 text-left text-sm`}
                          >
                            <ArrowUpTrayIcon className="mr-3 h-4 w-4" />
                            {intl.formatMessage(messages.importTemplate)}
                          </button>
                        )}
                      </Menu.Item>
                      <Menu.Item>
                        {({ active }) => (
                          <button
                            onClick={handleImportTemplate}
                            className={`${
                              active
                                ? 'bg-stone-700 text-white'
                                : 'text-stone-200'
                            } flex w-full items-center px-4 py-2 text-left text-sm`}
                          >
                            <ArrowUpTrayIcon className="mr-3 h-4 w-4" />
                            {intl.formatMessage(messages.importSourceColors)}
                          </button>
                        )}
                      </Menu.Item>
                      <hr className="border-stone-600" />
                      <Menu.Item>
                        {({ active }) => (
                          <button
                            onClick={handleExportSourceColors}
                            className={`${
                              active
                                ? 'bg-stone-700 text-white'
                                : 'text-stone-200'
                            } flex w-full items-center px-4 py-2 text-left text-sm`}
                          >
                            <ArrowDownTrayIcon className="mr-3 h-4 w-4" />
                            {intl.formatMessage(messages.exportSourceColors)}
                          </button>
                        )}
                      </Menu.Item>
                    </div>
                  </Menu.Items>
                </Transition>
              </Menu>
            )}
            {/* Temporarily commented out - focusing on templates only for initial release */}
            {/* <Button
              buttonType="ghost"
              onClick={handleCreatePoster}
              className="flex items-center space-x-2"
            >
              <PlusIcon className="h-4 w-4" />
              <span>{intl.formatMessage(messages.createPoster)}</span>
            </Button> */}
          </div>
        </div>

        <Tab.Panels>
          <Tab.Panel className="focus:outline-none">
            {!templatesData ? (
              <div className="flex h-96 items-center justify-center">
                <LoadingSpinner />
              </div>
            ) : (
              <PosterTemplateGrid
                templates={templates}
                onTemplateUpdate={mutateTemplates}
              />
            )}
          </Tab.Panel>

          <Tab.Panel className="focus:outline-none">
            {!savedPostersData ? (
              <div className="flex h-96 items-center justify-center">
                <LoadingSpinner />
              </div>
            ) : (
              <SavedPosterGrid
                savedPosters={savedPosters}
                onPosterUpdate={mutateSavedPosters}
              />
            )}
          </Tab.Panel>

          <Tab.Panel className="focus:outline-none">
            <OverlaysView />
          </Tab.Panel>
        </Tab.Panels>
      </Tab.Group>

      {/* Hidden file input for template import */}
      <input
        type="file"
        ref={fileInputRef}
        accept=".zip,.json"
        onChange={handleFileSelect}
        className="hidden"
      />

      <PosterEditorModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        mode={modalMode}
        onSave={handleSave}
      />
    </div>
  );
};

export default PostersView;
