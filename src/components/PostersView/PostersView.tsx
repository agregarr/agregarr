import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import type {
  EditorMode,
  PosterEditorData,
} from '@app/components/PosterEditor';
import { PosterEditorModal } from '@app/components/PosterEditor';
import { Tab } from '@headlessui/react';
import { PlusIcon } from '@heroicons/react/24/solid';
import { Fragment, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import useSWR from 'swr';
import PosterTemplateGrid from './PosterTemplateGrid';
import SavedPosterGrid from './SavedPosterGrid';

const messages = defineMessages({
  templates: 'Templates',
  savedPosters: 'Saved Posters',
  createTemplate: 'Create Template',
  createPoster: 'Create Poster',
  loading: 'Loading...',
  error: 'Failed to load data',
});

interface PosterTemplate {
  id: number;
  name: string;
  description?: string;
  templateData: PosterEditorData;
  isDefault: boolean;
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
  const [selectedTab, setSelectedTab] = useState(0);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<EditorMode>('create-template');

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

  const templates = templatesData?.templates || [];
  const savedPosters = savedPostersData?.posters || [];

  const handleCreateTemplate = () => {
    setModalMode('create-template');
    setIsModalOpen(true);
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
      count: templates?.length || 0,
    },
    {
      name: intl.formatMessage(messages.savedPosters),
      count: savedPosters?.length || 0,
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
                    {tab.count > 0 && (
                      <span
                        className={`ml-2 inline-flex items-center justify-center rounded-full px-2 py-1 text-xs font-bold leading-none ${
                          selected
                            ? 'bg-orange-100 text-orange-800'
                            : 'bg-stone-700 text-stone-200'
                        }`}
                      >
                        {tab.count}
                      </span>
                    )}
                  </button>
                )}
              </Tab>
            ))}
          </Tab.List>

          <div className="flex space-x-3">
            <Button
              buttonType="primary"
              onClick={handleCreateTemplate}
              className="flex items-center space-x-2"
            >
              <PlusIcon className="h-4 w-4" />
              <span>{intl.formatMessage(messages.createTemplate)}</span>
            </Button>
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
        </Tab.Panels>
      </Tab.Group>

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
