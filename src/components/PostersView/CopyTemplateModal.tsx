import Button from '@app/components/Common/Button';
import Modal from '@app/components/Common/Modal';
import type {
  OverlayElement,
  OverlayTemplateData,
  OverlayTemplateType,
} from '@server/entity/OverlayTemplate';
import { useEffect, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';

const messages = defineMessages({
  copyTemplate: 'Copy Elements',
  copyDescription:
    'Select which elements to copy from this template to other templates.',
  selectElements: 'Select elements to copy:',
  selectTemplates: 'Select templates to copy to:',
  selectAll: 'Select All',
  deselectAll: 'Deselect All',
  copyElements: 'Copy {elementCount} elements to {templateCount} templates',
  cancel: 'Cancel',
  copied: 'Elements copied successfully',
  copyFailed: 'Failed to copy elements',
  noElementsSelected: 'Select at least one element',
  noTemplatesSelected: 'Select at least one template',
  elementText: 'Text',
  elementTile: 'Tile',
  elementVariable: 'Variable',
  elementRaster: 'Image',
  elementSvg: 'Icon',
});

interface Template {
  id: number;
  name: string;
  description?: string;
  type: OverlayTemplateType;
  isDefault: boolean;
  templateData: OverlayTemplateData;
}

interface CopyTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceTemplate: Template;
  allTemplates: Template[];
  onCopyComplete: () => void;
}

// Get element type label
const getElementTypeLabel = (
  type: OverlayElement['type'],
  intl: ReturnType<typeof useIntl>
): string => {
  const typeMessages: Record<
    OverlayElement['type'],
    typeof messages.elementText
  > = {
    text: messages.elementText,
    tile: messages.elementTile,
    variable: messages.elementVariable,
    raster: messages.elementRaster,
    svg: messages.elementSvg,
  };
  return intl.formatMessage(typeMessages[type]);
};

// Get element description for display
const getElementDescription = (element: OverlayElement): string => {
  if (element.type === 'text') {
    return (element.properties as { text: string }).text.substring(0, 30);
  }
  if (element.type === 'variable') {
    const segments = (
      element.properties as { segments: { type: string; value?: string }[] }
    ).segments;
    return segments
      .map((s) => (s.type === 'text' ? s.value : `{${s.type}}`) || '')
      .join('')
      .substring(0, 30);
  }
  return `${element.width}×${element.height} at (${element.x}, ${element.y})`;
};

const CopyTemplateModal: React.FC<CopyTemplateModalProps> = ({
  isOpen,
  onClose,
  sourceTemplate,
  allTemplates,
  onCopyComplete,
}) => {
  const intl = useIntl();
  const [selectedElementIds, setSelectedElementIds] = useState<string[]>([]);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<number[]>([]);
  const [copying, setCopying] = useState(false);

  // Get elements from source template
  const sourceElements = sourceTemplate.templateData.elements || [];

  // Reset selections when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedElementIds([]);
      setSelectedTemplateIds([]);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Filter templates (exclude source and default templates)
  const availableTemplates = allTemplates.filter((t) => {
    if (t.id === sourceTemplate.id) return false;
    if (t.isDefault) return false;
    return true;
  });

  const handleToggleElement = (id: string) => {
    setSelectedElementIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleToggleTemplate = (id: number) => {
    setSelectedTemplateIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleSelectAllElements = () => {
    setSelectedElementIds(sourceElements.map((e) => e.id));
  };

  const handleDeselectAllElements = () => {
    setSelectedElementIds([]);
  };

  const handleSelectAllTemplates = () => {
    setSelectedTemplateIds(availableTemplates.map((t) => t.id));
  };

  const handleDeselectAllTemplates = () => {
    setSelectedTemplateIds([]);
  };

  const handleCopy = async () => {
    if (selectedElementIds.length === 0) {
      alert(intl.formatMessage(messages.noElementsSelected));
      return;
    }
    if (selectedTemplateIds.length === 0) {
      alert(intl.formatMessage(messages.noTemplatesSelected));
      return;
    }

    setCopying(true);
    try {
      const response = await fetch('/api/v1/overlay-templates/copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceTemplateId: sourceTemplate.id,
          targetTemplateIds: selectedTemplateIds,
          elementIds: selectedElementIds,
        }),
      });

      if (response.ok) {
        await response.json();
        onCopyComplete();
        onClose();
      } else {
        throw new Error('Copy failed');
      }
    } catch (error) {
      alert(intl.formatMessage(messages.copyFailed));
    } finally {
      setCopying(false);
    }
  };

  return (
    <Modal
      title={intl.formatMessage(messages.copyTemplate)}
      onCancel={onClose}
      onOk={handleCopy}
      okText={intl.formatMessage(messages.copyElements, {
        elementCount: selectedElementIds.length,
        templateCount: selectedTemplateIds.length,
      })}
      okDisabled={
        selectedElementIds.length === 0 ||
        selectedTemplateIds.length === 0 ||
        copying
      }
      cancelText={intl.formatMessage(messages.cancel)}
      customMaxWidth="sm:max-w-4xl"
    >
      <div className="space-y-4">
        <div className="text-sm text-stone-400">
          {intl.formatMessage(messages.copyDescription)}
        </div>

        <div className="rounded-lg bg-stone-800 p-3">
          <div className="text-xs text-stone-500">Copying from:</div>
          <div className="mt-1 font-medium text-white">
            {sourceTemplate.name}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Elements Selection */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-white">
                {intl.formatMessage(messages.selectElements)}
              </div>
              <div className="space-x-2">
                <Button buttonSize="sm" onClick={handleSelectAllElements}>
                  {intl.formatMessage(messages.selectAll)}
                </Button>
                <Button buttonSize="sm" onClick={handleDeselectAllElements}>
                  {intl.formatMessage(messages.deselectAll)}
                </Button>
              </div>
            </div>

            <div className="max-h-96 space-y-2 overflow-y-auto rounded-lg border border-stone-700 p-3">
              {sourceElements.length === 0 ? (
                <div className="py-8 text-center text-sm text-stone-500">
                  No elements in template
                </div>
              ) : (
                sourceElements.map((element) => (
                  <label
                    key={element.id}
                    className={`flex cursor-pointer items-center space-x-3 rounded-md p-2 transition-colors ${
                      selectedElementIds.includes(element.id)
                        ? 'bg-orange-500 bg-opacity-20'
                        : 'hover:bg-stone-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedElementIds.includes(element.id)}
                      onChange={() => handleToggleElement(element.id)}
                      className="rounded border-stone-600 text-orange-500 focus:ring-orange-500"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-white">
                        {getElementTypeLabel(element.type, intl)}
                      </div>
                      <div className="text-xs text-stone-400">
                        {getElementDescription(element)}
                      </div>
                    </div>
                  </label>
                ))
              )}
            </div>
          </div>

          {/* Templates Selection */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-white">
                {intl.formatMessage(messages.selectTemplates)}
              </div>
              <div className="space-x-2">
                <Button buttonSize="sm" onClick={handleSelectAllTemplates}>
                  {intl.formatMessage(messages.selectAll)}
                </Button>
                <Button buttonSize="sm" onClick={handleDeselectAllTemplates}>
                  {intl.formatMessage(messages.deselectAll)}
                </Button>
              </div>
            </div>

            <div className="max-h-96 space-y-2 overflow-y-auto rounded-lg border border-stone-700 p-3">
              {availableTemplates.length === 0 ? (
                <div className="py-8 text-center text-sm text-stone-500">
                  No templates available
                </div>
              ) : (
                availableTemplates.map((template) => (
                  <label
                    key={template.id}
                    className={`flex cursor-pointer items-center space-x-3 rounded-md p-2 transition-colors ${
                      selectedTemplateIds.includes(template.id)
                        ? 'bg-orange-500 bg-opacity-20'
                        : 'hover:bg-stone-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedTemplateIds.includes(template.id)}
                      onChange={() => handleToggleTemplate(template.id)}
                      className="rounded border-stone-600 text-orange-500 focus:ring-orange-500"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-white">
                        {template.name}
                      </div>
                      {template.description && (
                        <div className="text-xs text-stone-400">
                          {template.description}
                        </div>
                      )}
                    </div>
                  </label>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default CopyTemplateModal;
