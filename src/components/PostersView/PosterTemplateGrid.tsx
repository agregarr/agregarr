import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
import type {
  EditorMode,
  PosterEditorData,
} from '@app/components/PosterEditor';
import { PosterEditorModal } from '@app/components/PosterEditor';
import {
  DocumentDuplicateIcon,
  PencilIcon,
  TrashIcon,
} from '@heroicons/react/24/solid';
import { useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';

const messages = defineMessages({
  edit: 'Edit',
  duplicate: 'Duplicate',
  delete: 'Delete',
  setDefault: 'Set Default',
  default: 'Default',
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
  isDefault: boolean;
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

  const handleSetDefault = async (templateId: number) => {
    const response = await fetch(
      `/api/v1/posters/templates/${templateId}/set-default`,
      {
        method: 'POST',
      }
    );

    if (response.ok) {
      onTemplateUpdate();
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
            <div className="relative aspect-[2/3] overflow-hidden bg-stone-700">
              <img
                src={`/api/v1/posters/templates/${template.id}/preview?collectionName=Sample Collection&collectionType=multi-source`}
                alt={`Preview of ${template.name}`}
                className="h-full w-full object-cover"
                onError={(e) => {
                  // Fallback to placeholder if preview fails
                  const target = e.target as HTMLImageElement;
                  target.style.display = 'none';
                  target.nextElementSibling?.classList.remove('hidden');
                }}
              />
              {/* Fallback placeholder */}
              <div className="absolute inset-0 flex hidden items-center justify-center bg-stone-700 text-stone-400">
                <div className="text-center">
                  <div className="text-sm font-medium">{template.name}</div>
                  <div className="text-xs">Preview unavailable</div>
                </div>
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
                    {template.isDefault && (
                      <Badge badgeType="success" className="text-xs">
                        {intl.formatMessage(messages.default)}
                      </Badge>
                    )}
                    <span className="text-xs text-stone-500">
                      {intl.formatMessage(messages.lastUpdated)}{' '}
                      {new Date(template.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => handleEdit(template)}
                  className="flex items-center rounded-md bg-stone-700 px-3 py-2 text-xs text-stone-200 transition-colors hover:bg-stone-600 hover:text-white"
                  title={intl.formatMessage(messages.edit)}
                >
                  <PencilIcon className="mr-2 h-3 w-3" />
                  {intl.formatMessage(messages.edit)}
                </button>
                <button
                  onClick={() => handleDuplicate(template)}
                  className="flex items-center rounded-md bg-stone-700 px-3 py-2 text-xs text-stone-200 transition-colors hover:bg-stone-600 hover:text-white"
                  title={intl.formatMessage(messages.duplicate)}
                >
                  <DocumentDuplicateIcon className="mr-2 h-3 w-3" />
                  {intl.formatMessage(messages.duplicate)}
                </button>
                {!template.isDefault && (
                  <button
                    onClick={() => handleSetDefault(template.id)}
                    className="flex items-center rounded-md bg-blue-900/50 px-3 py-2 text-xs text-blue-400 transition-colors hover:bg-blue-900 hover:text-blue-300"
                    title={intl.formatMessage(messages.setDefault)}
                  >
                    {intl.formatMessage(messages.setDefault)}
                  </button>
                )}
                <button
                  onClick={() => setDeleteConfirmId(template.id)}
                  className="flex items-center rounded-md bg-red-900/50 px-3 py-2 text-xs text-red-400 transition-colors hover:bg-red-900 hover:text-red-300"
                  title={intl.formatMessage(messages.delete)}
                >
                  <TrashIcon className="mr-2 h-3 w-3" />
                  {intl.formatMessage(messages.delete)}
                </button>
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
        initialName={selectedTemplate?.name}
        initialDescription={selectedTemplate?.description}
        onSave={handleSave}
      />
    </>
  );
};

export default PosterTemplateGrid;
