import Button from '@app/components/Common/Button';
import type { OverlayEditorMode } from '@app/components/OverlayEditor';
import { OverlayEditorModal } from '@app/components/OverlayEditor';
import { AVAILABLE_VARIABLES } from '@app/components/OverlayEditor/types';
import {
  ArrowDownTrayIcon,
  DocumentDuplicateIcon,
  PencilIcon,
  TrashIcon,
} from '@heroicons/react/24/solid';
import type {
  ApplicationCondition,
  OverlayTemplateData,
  OverlayTemplateType,
} from '@server/entity/OverlayTemplate';
import { useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { useToasts } from 'react-toast-notifications';
import CopyTemplateModal from './CopyTemplateModal';

const messages = defineMessages({
  edit: 'Edit',
  duplicate: 'Duplicate',
  delete: 'Delete',
  export: 'Export',
  overlayExportSuccess: 'Overlay template exported successfully',
  overlayExportError: 'Failed to export overlay template',
  confirmDeleteOverlay:
    'Are you sure you want to delete this overlay template?',
  deleteTemplate: 'Delete Template',
  cancel: 'Cancel',
  noOverlayTemplates: 'No overlay templates found',
  createFirstOverlayTemplate:
    'Create your first overlay template to get started',
  copyOverlayElements: 'Copy Elements',
  alwaysApply: 'Always apply',
});

// Operator display labels
const OPERATOR_LABELS: Record<string, string> = {
  eq: '=',
  neq: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  in: 'in',
  contains: 'contains',
  notContains: '!contains',
};

// Get field label from AVAILABLE_VARIABLES
const getFieldLabel = (field: string): string => {
  const allVars = [
    ...AVAILABLE_VARIABLES.ratings,
    ...AVAILABLE_VARIABLES.metadata,
    ...AVAILABLE_VARIABLES.video,
    ...AVAILABLE_VARIABLES.audio,
    ...AVAILABLE_VARIABLES.file,
    ...AVAILABLE_VARIABLES.playback,
    ...AVAILABLE_VARIABLES['coming-soon'],
  ];
  return allVars.find((v) => v.field === field)?.label || field;
};

// Format flat condition for display
const formatCondition = (
  condition: ApplicationCondition | undefined
): string | null => {
  if (!condition || !condition.sections || condition.sections.length === 0) {
    return null;
  }

  const formattedSections = condition.sections.map((section) => {
    const formattedRules = section.rules.map((rule) => {
      const fieldLabel = getFieldLabel(rule.field);
      const op = OPERATOR_LABELS[rule.operator] || rule.operator;
      return `${fieldLabel} ${op} ${rule.value}`;
    });

    // Join rules within section with their operators
    let sectionText = formattedRules[0];
    for (let i = 1; i < formattedRules.length; i++) {
      const operator = section.rules[i].ruleOperator?.toUpperCase() || 'AND';
      sectionText += ` ${operator} ${formattedRules[i]}`;
    }

    return `(${sectionText})`;
  });

  // Join sections with their operators
  let result = formattedSections[0];
  for (let i = 1; i < formattedSections.length; i++) {
    const operator =
      condition.sections[i].sectionOperator?.toUpperCase() || 'OR';
    result += ` ${operator} ${formattedSections[i]}`;
  }

  return result;
};

// Component to render condition with styled AND/OR operators
// Section operators (between parentheses) = BLUE, Rule operators (within parentheses) = ORANGE
const ConditionDisplay: React.FC<{ condition: string }> = ({ condition }) => {
  // Split by sections (groups in parentheses) and section operators
  const sectionRegex = /(\([^)]+\))|(\s(?:AND|OR)\s)/g;
  const parts: string[] = [];
  let lastIndex = 0;
  let match;

  while ((match = sectionRegex.exec(condition)) !== null) {
    if (match.index > lastIndex) {
      parts.push(condition.substring(lastIndex, match.index));
    }
    parts.push(match[0]);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < condition.length) {
    parts.push(condition.substring(lastIndex));
  }

  return (
    <span>
      {parts.map((part, index) => {
        // Section operators (between sections) - BLUE
        if (part.match(/^\s(?:AND|OR)\s$/)) {
          const isAfterSection = index > 0 && parts[index - 1]?.endsWith(')');
          if (isAfterSection) {
            return (
              <span key={index} className="font-semibold text-blue-500">
                {part}
              </span>
            );
          }
        }
        // Rule operators (within sections) - ORANGE
        if (part.match(/^\s(?:AND|OR)\s$/)) {
          return (
            <span key={index} className="font-semibold text-orange-500">
              {part}
            </span>
          );
        }
        return <span key={index}>{part}</span>;
      })}
    </span>
  );
};

interface OverlayTemplate {
  id: number;
  name: string;
  description?: string;
  type: OverlayTemplateType;
  templateData: OverlayTemplateData;
  isDefault: boolean;
  applicationCondition?: ApplicationCondition;
  createdAt: string;
  updatedAt: string;
}

interface OverlayTemplateGridProps {
  templates: OverlayTemplate[];
  onTemplateUpdate: () => void;
}

const OverlayTemplateGrid: React.FC<OverlayTemplateGridProps> = ({
  templates,
  onTemplateUpdate,
}) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<OverlayEditorMode>('edit');
  const [selectedTemplate, setSelectedTemplate] =
    useState<OverlayTemplate | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [isCopyModalOpen, setIsCopyModalOpen] = useState(false);
  const [copySourceTemplate, setCopySourceTemplate] =
    useState<OverlayTemplate | null>(null);

  const handleEdit = (template: OverlayTemplate) => {
    setSelectedTemplate(template);
    setModalMode('edit');
    setIsModalOpen(true);
  };

  const handleDuplicate = (template: OverlayTemplate) => {
    setSelectedTemplate(template);
    setModalMode('create');
    setIsModalOpen(true);
  };

  const handleCopyElements = (template: OverlayTemplate) => {
    setCopySourceTemplate(template);
    setIsCopyModalOpen(true);
  };

  const handleExport = async (templateId: number, templateName: string) => {
    try {
      const response = await fetch(`/overlay-template-export/${templateId}`);

      if (!response.ok) {
        throw new Error('Failed to export overlay template');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${templateName.replace(
        /[^a-zA-Z0-9]/g,
        '_'
      )}_overlay_template.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      addToast(intl.formatMessage(messages.overlayExportSuccess), {
        appearance: 'success',
        autoDismiss: true,
      });
    } catch (error) {
      addToast(intl.formatMessage(messages.overlayExportError), {
        appearance: 'error',
        autoDismiss: true,
      });
    }
  };

  const handleDelete = async (templateId: number) => {
    const response = await fetch(`/api/v1/overlay-templates/${templateId}`, {
      method: 'DELETE',
    });

    if (response.ok) {
      onTemplateUpdate();
      setDeleteConfirmId(null);
      addToast('Template deleted successfully', {
        appearance: 'success',
        autoDismiss: true,
      });
    } else {
      addToast('Failed to delete template', {
        appearance: 'error',
        autoDismiss: true,
      });
    }
  };

  const handleSave = async (data: {
    name: string;
    description?: string;
    type?: string;
    templateData: OverlayTemplateData;
    applicationCondition?: ApplicationCondition;
  }) => {
    if (modalMode === 'edit' && selectedTemplate) {
      // Update existing template
      const response = await fetch(
        `/api/v1/overlay-templates/${selectedTemplate.id}`,
        {
          method: 'PUT',
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
        }
      );

      if (!response.ok) {
        throw new Error('Failed to update template');
      }

      addToast('Template updated successfully', {
        appearance: 'success',
        autoDismiss: true,
      });
    } else {
      // Create new template (duplicate or new)
      const response = await fetch('/api/v1/overlay-templates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: data.name,
          description: data.description,
          type: data.type || 'custom',
          templateData: data.templateData,
          applicationCondition: data.applicationCondition,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create template');
      }

      addToast('Template created successfully', {
        appearance: 'success',
        autoDismiss: true,
      });
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
              d="M8 14v20c0 4.418 7.163 8 16 8 1.381 0 2.721-.087 4-.252M8 14c0 4.418 7.163 8 16 8s16-3.582 16-8M8 14c0-4.418 7.163-8 16-8s16 3.582 16 8m0 0v14m0-4c0 4.418-7.163 8-16 8S8 28.418 8 24m32 10v6m0 0v6m0-6h6m-6 0h-6"
            />
          </svg>
          <p className="mt-4 text-lg text-stone-300">
            {intl.formatMessage(messages.noOverlayTemplates)}
          </p>
          <p className="mt-2 text-stone-400">
            {intl.formatMessage(messages.createFirstOverlayTemplate)}
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
            {/* Template Preview - Server-rendered */}
            <div className="relative aspect-[2/3] overflow-hidden bg-stone-900">
              <img
                src={`/api/v1/overlay-templates/${template.id}/preview`}
                alt={`${template.name} preview`}
                className="h-full w-full object-cover"
                loading="lazy"
              />
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
                  {/* Condition */}
                  <div className="mt-2 inline-block rounded bg-stone-900 px-2 py-1 text-xs text-stone-300">
                    {(() => {
                      const formattedCondition = formatCondition(
                        template.applicationCondition
                      );
                      return formattedCondition ? (
                        <ConditionDisplay condition={formattedCondition} />
                      ) : (
                        intl.formatMessage(messages.alwaysApply)
                      );
                    })()}
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="mt-3 flex flex-wrap gap-2">
                {!template.isDefault && (
                  <button
                    onClick={() => handleEdit(template)}
                    className="flex items-center rounded-md bg-stone-700 px-3 py-2 text-xs text-stone-200 transition-colors hover:bg-stone-600 hover:text-white"
                    title={intl.formatMessage(messages.edit)}
                  >
                    <PencilIcon className="mr-2 h-3 w-3" />
                    {intl.formatMessage(messages.edit)}
                  </button>
                )}
                <button
                  onClick={() => handleDuplicate(template)}
                  className="flex items-center rounded-md bg-stone-700 px-3 py-2 text-xs text-stone-200 transition-colors hover:bg-stone-600 hover:text-white"
                  title={intl.formatMessage(messages.duplicate)}
                >
                  <DocumentDuplicateIcon className="mr-2 h-3 w-3" />
                  {intl.formatMessage(messages.duplicate)}
                </button>
                <button
                  onClick={() => handleCopyElements(template)}
                  className="flex items-center rounded-md bg-stone-700 px-3 py-2 text-xs text-stone-200 transition-colors hover:bg-stone-600 hover:text-white"
                  title={intl.formatMessage(messages.copyOverlayElements)}
                >
                  <DocumentDuplicateIcon className="mr-2 h-3 w-3" />
                  {intl.formatMessage(messages.copyOverlayElements)}
                </button>
                {!template.isDefault && (
                  <button
                    onClick={() => handleExport(template.id, template.name)}
                    className="flex items-center rounded-md bg-green-900/50 px-3 py-2 text-xs text-green-400 transition-colors hover:bg-green-900 hover:text-green-300"
                    title={intl.formatMessage(messages.export)}
                  >
                    <ArrowDownTrayIcon className="mr-2 h-3 w-3" />
                    {intl.formatMessage(messages.export)}
                  </button>
                )}
                {!template.isDefault && (
                  <button
                    onClick={() => setDeleteConfirmId(template.id)}
                    className="flex items-center rounded-md bg-red-900/50 px-3 py-2 text-xs text-red-400 transition-colors hover:bg-red-900 hover:text-red-300"
                    title={intl.formatMessage(messages.delete)}
                  >
                    <TrashIcon className="mr-2 h-3 w-3" />
                    {intl.formatMessage(messages.delete)}
                  </button>
                )}
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
                    {intl.formatMessage(messages.confirmDeleteOverlay)}
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

      <OverlayEditorModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedTemplate(null);
        }}
        mode={modalMode}
        templateId={modalMode === 'edit' ? selectedTemplate?.id : undefined}
        initialData={selectedTemplate?.templateData}
        initialName={
          modalMode === 'create' && selectedTemplate
            ? `${selectedTemplate.name} (Copy)`
            : selectedTemplate?.name || ''
        }
        initialDescription={selectedTemplate?.description}
        initialCondition={selectedTemplate?.applicationCondition}
        onSave={handleSave}
      />

      {copySourceTemplate && (
        <CopyTemplateModal
          isOpen={isCopyModalOpen}
          onClose={() => {
            setIsCopyModalOpen(false);
            setCopySourceTemplate(null);
          }}
          sourceTemplate={copySourceTemplate}
          allTemplates={templates}
          onCopyComplete={() => {
            onTemplateUpdate();
            addToast('Elements copied successfully', {
              appearance: 'success',
              autoDismiss: true,
            });
          }}
        />
      )}
    </>
  );
};

export default OverlayTemplateGrid;
