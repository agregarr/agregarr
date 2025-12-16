import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import { OverlayEditorModal } from '@app/components/OverlayEditor';
import { Tab } from '@headlessui/react';
import {
  ArrowUpTrayIcon,
  Cog6ToothIcon,
  PlusIcon,
} from '@heroicons/react/24/solid';
import type {
  ApplicationCondition,
  OverlayTemplateData,
  OverlayTemplateType,
} from '@server/entity/OverlayTemplate';
import { Fragment, useEffect, useRef, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { useToasts } from 'react-toast-notifications';
import useSWR from 'swr';
import LibraryConfigView from './LibraryConfigView';
import OverlayTemplateGrid from './OverlayTemplateGrid';
import PosterSourceSetupModal from './PosterSourceSetupModal';

const messages = defineMessages({
  title: 'Overlay System',
  description:
    'Create overlay templates and apply them to your Plex library posters',
  templatesTab: 'Overlay Templates',
  librariesTab: 'Library Configuration',
  createTemplate: 'Create Overlay Template',
  importTemplate: 'Import Template',
  importSuccess: 'Overlay template imported successfully',
  importError: 'Failed to import overlay template',
  loading: 'Loading...',
  error: 'Failed to load overlay data',
  templatesDescription:
    'Design reusable overlay templates for ratings, metadata, and more',
  librariesDescription: 'Configure which overlays are applied to each library',
  overlaySettings: 'Posters Source',
});

interface OverlayTemplate {
  id: number;
  name: string;
  description?: string;
  type: OverlayTemplateType;
  templateData: OverlayTemplateData;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

const OverlaysView: React.FC = () => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const [selectedTab, setSelectedTab] = useState(0);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSetupModalOpen, setIsSetupModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch overlay templates
  const {
    data: templatesData,
    error: templatesError,
    mutate: mutateTemplates,
  } = useSWR<{ templates: OverlayTemplate[] }>('/api/v1/overlay-templates');

  // Fetch overlay settings
  const { data: overlaySettings, mutate: mutateSettings } = useSWR<{
    defaultPosterSource: 'tmdb' | 'plex';
    initialSetupComplete: boolean;
  }>('/api/v1/overlay-settings');

  const templates = templatesData?.templates || [];

  // Show setup modal when navigating to Library Configuration tab if setup not complete
  useEffect(() => {
    if (
      selectedTab === 1 &&
      overlaySettings &&
      !overlaySettings.initialSetupComplete
    ) {
      setIsSetupModalOpen(true);
    }
  }, [selectedTab, overlaySettings]);

  const handleSetupComplete = () => {
    setIsSetupModalOpen(false);
    mutateSettings();
  };

  const handleCreateTemplate = () => {
    setIsModalOpen(true);
  };

  const handleImportTemplate = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      if (!file.name.endsWith('.zip')) {
        throw new Error(
          'Invalid file type. Please upload a ZIP file containing an overlay template.'
        );
      }

      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/overlay-template-import', {
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
    } catch (error) {
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

  const handleSave = async (data: {
    name: string;
    description?: string;
    type?: string;
    templateData: OverlayTemplateData;
    applicationCondition?: ApplicationCondition;
  }) => {
    const response = await fetch('/api/v1/overlay-templates', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: data.name,
        description: data.description,
        type: data.type || 'generic',
        templateData: data.templateData,
        applicationCondition: data.applicationCondition,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to create template');
    }

    mutateTemplates();
    addToast('Template created successfully', {
      appearance: 'success',
      autoDismiss: true,
    });
  };

  const tabs = [
    {
      name: intl.formatMessage(messages.templatesTab),
      count: templates.length,
      description: intl.formatMessage(messages.templatesDescription),
    },
    {
      name: intl.formatMessage(messages.librariesTab),
      count: undefined,
      description: intl.formatMessage(messages.librariesDescription),
    },
  ];

  if (templatesError) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-red-400">{intl.formatMessage(messages.error)}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-white">
          {intl.formatMessage(messages.title)}
        </h2>
        <p className="mt-1 text-sm text-stone-400">
          {intl.formatMessage(messages.description)}
        </p>
      </div>

      <Tab.Group selectedIndex={selectedTab} onChange={setSelectedTab}>
        <div className="flex items-center justify-between">
          <Tab.List className="flex space-x-1 rounded-xl bg-stone-900/20 p-1">
            {tabs.map((tab) => (
              <Tab as={Fragment} key={tab.name}>
                {({ selected }) => (
                  <button
                    className={`rounded-lg px-4 py-2.5 text-sm font-medium leading-5 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-opacity-75 ${
                      selected
                        ? 'bg-white text-orange-700 shadow'
                        : 'text-stone-100 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    {tab.name}
                    {tab.count !== undefined && tab.count > 0 && (
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

          {selectedTab === 0 && (
            <div className="flex items-center space-x-2">
              <Button
                buttonType="ghost"
                onClick={handleImportTemplate}
                className="flex items-center space-x-2"
              >
                <ArrowUpTrayIcon className="h-4 w-4" />
                <span>{intl.formatMessage(messages.importTemplate)}</span>
              </Button>
              <Button
                buttonType="primary"
                onClick={handleCreateTemplate}
                className="flex items-center space-x-2"
              >
                <PlusIcon className="h-4 w-4" />
                <span>{intl.formatMessage(messages.createTemplate)}</span>
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>
          )}

          {selectedTab === 1 && (
            <Button
              buttonType="ghost"
              onClick={() => setIsSetupModalOpen(true)}
              className="flex items-center space-x-2"
            >
              <Cog6ToothIcon className="h-5 w-5" />
              <span>{intl.formatMessage(messages.overlaySettings)}</span>
            </Button>
          )}
        </div>

        {/* Tab description */}
        <div className="mt-2 text-sm text-stone-400">
          {tabs[selectedTab].description}
        </div>

        <Tab.Panels>
          <Tab.Panel className="focus:outline-none">
            {!templatesData ? (
              <div className="flex h-96 items-center justify-center">
                <LoadingSpinner />
              </div>
            ) : (
              <OverlayTemplateGrid
                templates={templates}
                onTemplateUpdate={mutateTemplates}
              />
            )}
          </Tab.Panel>

          <Tab.Panel className="focus:outline-none">
            <LibraryConfigView />
          </Tab.Panel>
        </Tab.Panels>
      </Tab.Group>

      <OverlayEditorModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        mode="create"
        onSave={handleSave}
      />

      <PosterSourceSetupModal
        isOpen={isSetupModalOpen}
        onClose={() => setIsSetupModalOpen(false)}
        onComplete={handleSetupComplete}
        isInitialSetup={!overlaySettings?.initialSetupComplete}
        currentPosterSource={overlaySettings?.defaultPosterSource}
      />
    </div>
  );
};

export default OverlaysView;
