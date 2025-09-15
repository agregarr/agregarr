import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
import type {
  EditorMode,
  PosterEditorData,
} from '@app/components/PosterEditor';
import { PosterEditorModal } from '@app/components/PosterEditor';
import { Menu, Transition } from '@headlessui/react';
import {
  DocumentDuplicateIcon,
  EllipsisVerticalIcon,
  PencilIcon,
  TrashIcon,
} from '@heroicons/react/24/solid';
import { Fragment, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';

const messages = defineMessages({
  edit: 'Edit',
  duplicate: 'Duplicate',
  delete: 'Delete',
  confirmDelete: 'Are you sure you want to delete this template?',
  deleteTemplate: 'Delete Template',
  cancel: 'Cancel',
  noTemplates: 'No templates found',
  createFirstTemplate: 'Create your first template to get started',
  createTemplate: 'Create Template',
  lastUpdated: 'Last updated',
});

interface PosterTemplate {
  id: number;
  name: string;
  description?: string;
  templateData: PosterEditorData;
  createdAt: string;
  updatedAt: string;
}

interface PosterTemplateGridProps {
  templates: PosterTemplate[];
  onTemplateUpdate: () => void;
}

const PosterTemplateGrid: React.FC<PosterTemplateGridProps> = ({
  templates,
  onTemplateUpdate,
}) => {
  const intl = useIntl();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<EditorMode>('edit-template');
  const [selectedTemplate, setSelectedTemplate] =
    useState<PosterTemplate | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  const handleEdit = (template: PosterTemplate) => {
    setSelectedTemplate(template);
    setModalMode('edit-template');
    setIsModalOpen(true);
  };

  const handleDuplicate = (template: PosterTemplate) => {
    setSelectedTemplate(template);
    setModalMode('create-template');
    setIsModalOpen(true);
  };

  const handleDelete = async (templateId: number) => {
    const response = await fetch(`/api/v1/posters/templates/${templateId}`, {
      method: 'DELETE',
    });

    if (response.ok) {
      onTemplateUpdate();
      setDeleteConfirmId(null);
    }
  };

  const handleSave = async (data: {
    name: string;
    description?: string;
    posterData: PosterEditorData;
  }) => {
    if (modalMode === 'edit-template' && selectedTemplate) {
      // Update existing template
      const response = await fetch(
        `/api/v1/posters/templates/${selectedTemplate.id}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: data.name,
            description: data.description,
            templateData: data.posterData,
          }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to update template');
      }
    } else {
      // Create new template (duplicate)
      const response = await fetch('/api/v1/posters/templates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: data.name,
          description: data.description,
          templateData: data.posterData,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create template');
      }
    }

    onTemplateUpdate();
  };

  if (templates.length === 0) {
    return (
      <div className="py-16 text-center">
        <div className="mx-auto max-w-sm">
          <svg
            className="mx-auto h-12 w-12 text-stone-400"
            stroke="currentColor"
            fill="none"
            viewBox="0 0 48 48"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M34 40h10v-4a6 6 0 00-10.712-3.714M34 40H14m20 0v-4a9.971 9.971 0 00-.712-3.714M14 40H4v-4a6 6 0 0110.712-3.714M14 40v-4a9.971 9.971 0 01.712-3.714M18 20a6 6 0 1112 0v-5a6 6 0 10-12 0v5z"
            />
          </svg>
          <p className="mt-4 text-lg text-stone-300">
            {intl.formatMessage(messages.noTemplates)}
          </p>
          <p className="mt-2 text-stone-400">
            {intl.formatMessage(messages.createFirstTemplate)}
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {templates.map((template) => (
          <div
            key={template.id}
            className="hover:bg-stone-750 group relative overflow-hidden rounded-lg bg-stone-800 transition-colors duration-200"
          >
            {/* Template Preview */}
            <div className="relative aspect-[2/3] bg-stone-700">
              <div
                className="relative h-full w-full overflow-hidden"
                style={{
                  background:
                    template.templateData.background.type === 'gradient'
                      ? `linear-gradient(to bottom, ${
                          template.templateData.background.color || '#6366f1'
                        }, ${
                          template.templateData.background.secondaryColor ||
                          '#1e1b4b'
                        })`
                      : template.templateData.background.type === 'radial'
                      ? `radial-gradient(circle, ${
                          template.templateData.background.color || '#6366f1'
                        }, ${
                          template.templateData.background.secondaryColor ||
                          '#1e1b4b'
                        })`
                      : template.templateData.background.color || '#6366f1',
                }}
              >
                {/* Text Elements Preview */}
                {template.templateData.textElements.map((textElement) => (
                  <div
                    key={textElement.id}
                    className="absolute text-center"
                    style={{
                      left: `${
                        (textElement.x / template.templateData.width) * 100
                      }%`,
                      top: `${
                        (textElement.y / template.templateData.height) * 100
                      }%`,
                      width: `${
                        (textElement.width / template.templateData.width) * 100
                      }%`,
                      height: `${
                        (textElement.height / template.templateData.height) *
                        100
                      }%`,
                      fontSize: `${
                        (textElement.fontSize / template.templateData.height) *
                        100
                      }px`,
                      fontFamily: textElement.fontFamily,
                      fontWeight: textElement.fontWeight,
                      fontStyle: textElement.fontStyle,
                      color: textElement.color,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {textElement.type === 'collection-title'
                      ? 'Collection Title'
                      : textElement.text || 'Sample Text'}
                  </div>
                ))}

                {/* Icon Elements Preview */}
                {template.templateData.iconElements.map((iconElement) => (
                  <div
                    key={iconElement.id}
                    className="absolute flex items-center justify-center rounded bg-stone-600/50 text-xs text-white"
                    style={{
                      left: `${
                        (iconElement.x / template.templateData.width) * 100
                      }%`,
                      top: `${
                        (iconElement.y / template.templateData.height) * 100
                      }%`,
                      width: `${
                        (iconElement.width / template.templateData.width) * 100
                      }%`,
                      height: `${
                        (iconElement.height / template.templateData.height) *
                        100
                      }%`,
                    }}
                  >
                    {iconElement.type === 'source-logo' ? 'Logo' : 'Icon'}
                  </div>
                ))}

                {/* Content Grid Preview */}
                {template.templateData.contentGrid && (
                  <div
                    className="absolute"
                    style={{
                      left: `${
                        (template.templateData.contentGrid.x /
                          template.templateData.width) *
                        100
                      }%`,
                      top: `${
                        (template.templateData.contentGrid.y /
                          template.templateData.height) *
                        100
                      }%`,
                      width: `${
                        (template.templateData.contentGrid.width /
                          template.templateData.width) *
                        100
                      }%`,
                      height: `${
                        (template.templateData.contentGrid.height /
                          template.templateData.height) *
                        100
                      }%`,
                    }}
                  >
                    <div
                      className="grid gap-1"
                      style={{
                        gridTemplateColumns: `repeat(${template.templateData.contentGrid.columns}, 1fr)`,
                        gridTemplateRows: `repeat(${template.templateData.contentGrid.rows}, 1fr)`,
                        height: '100%',
                      }}
                    >
                      {Array.from({
                        length:
                          template.templateData.contentGrid.columns *
                          template.templateData.contentGrid.rows,
                      }).map((_, i) => (
                        <div
                          key={i}
                          className="rounded-sm bg-stone-700/80"
                          style={{
                            borderRadius: `${
                              template.templateData.contentGrid?.cornerRadius ||
                              0
                            }px`,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Template Info */}
            <div className="p-4">
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-medium text-white">
                    {template.name}
                  </h3>
                  {template.description && (
                    <p className="line-clamp-2 mt-1 text-xs text-stone-400">
                      {template.description}
                    </p>
                  )}
                  <div className="mt-2 flex items-center space-x-2">
                    <Badge badgeType="default" className="text-xs">
                      {template.templateData.width}x
                      {template.templateData.height}
                    </Badge>
                    <span className="text-xs text-stone-500">
                      {intl.formatMessage(messages.lastUpdated)}{' '}
                      {new Date(template.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                {/* Actions Menu */}
                <Menu as="div" className="relative">
                  <Menu.Button className="flex items-center rounded-full p-1 text-stone-400 hover:bg-stone-700 hover:text-white">
                    <EllipsisVerticalIcon className="h-5 w-5" />
                  </Menu.Button>
                  <Transition
                    as={Fragment}
                    enter="transition ease-out duration-100"
                    enterFrom="transform opacity-0 scale-95"
                    enterTo="transform opacity-100 scale-100"
                    leave="transition ease-in duration-75"
                    leaveFrom="transform opacity-100 scale-100"
                    leaveTo="transform opacity-0 scale-95"
                  >
                    <Menu.Items className="absolute right-0 z-10 mt-2 w-48 origin-top-right rounded-md bg-stone-700 py-1 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
                      <Menu.Item>
                        {({ active }) => (
                          <button
                            onClick={() => handleEdit(template)}
                            className={`${
                              active ? 'bg-stone-600' : ''
                            } flex w-full items-center px-4 py-2 text-left text-sm text-stone-200`}
                          >
                            <PencilIcon className="mr-3 h-4 w-4" />
                            {intl.formatMessage(messages.edit)}
                          </button>
                        )}
                      </Menu.Item>
                      <Menu.Item>
                        {({ active }) => (
                          <button
                            onClick={() => handleDuplicate(template)}
                            className={`${
                              active ? 'bg-stone-600' : ''
                            } flex w-full items-center px-4 py-2 text-left text-sm text-stone-200`}
                          >
                            <DocumentDuplicateIcon className="mr-3 h-4 w-4" />
                            {intl.formatMessage(messages.duplicate)}
                          </button>
                        )}
                      </Menu.Item>
                      <Menu.Item>
                        {({ active }) => (
                          <button
                            onClick={() => setDeleteConfirmId(template.id)}
                            className={`${
                              active ? 'bg-stone-600' : ''
                            } flex w-full items-center px-4 py-2 text-left text-sm text-red-400`}
                          >
                            <TrashIcon className="mr-3 h-4 w-4" />
                            {intl.formatMessage(messages.delete)}
                          </button>
                        )}
                      </Menu.Item>
                    </Menu.Items>
                  </Transition>
                </Menu>
              </div>
            </div>

            {/* Delete Confirmation */}
            {deleteConfirmId === template.id && (
              <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-75 p-4">
                <div className="w-full max-w-sm rounded-lg bg-stone-800 p-4">
                  <h4 className="mb-2 font-medium text-white">
                    {intl.formatMessage(messages.deleteTemplate)}
                  </h4>
                  <p className="mb-4 text-sm text-stone-300">
                    {intl.formatMessage(messages.confirmDelete)}
                  </p>
                  <div className="flex space-x-2">
                    <Button
                      buttonType="danger"
                      onClick={() => handleDelete(template.id)}
                      className="flex-1"
                    >
                      {intl.formatMessage(messages.delete)}
                    </Button>
                    <Button
                      buttonType="ghost"
                      onClick={() => setDeleteConfirmId(null)}
                      className="flex-1"
                    >
                      {intl.formatMessage(messages.cancel)}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <PosterEditorModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedTemplate(null);
        }}
        mode={modalMode}
        initialData={selectedTemplate?.templateData}
        onSave={handleSave}
      />
    </>
  );
};

export default PosterTemplateGrid;
