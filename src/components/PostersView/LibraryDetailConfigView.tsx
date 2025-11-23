import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Modal from '@app/components/Common/Modal';
import { AVAILABLE_VARIABLES } from '@app/components/OverlayEditor/types';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowPathIcon,
  Bars3Icon,
  EyeIcon,
  EyeSlashIcon,
} from '@heroicons/react/24/outline';
import type {
  ApplicationCondition,
  OverlayTemplateType,
} from '@server/entity/OverlayTemplate';
import { useCallback, useEffect, useRef, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';

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

// Format condition for display (recursively handles AND/OR)
const formatCondition = (
  condition: ApplicationCondition | undefined
): string | null => {
  if (!condition) return null;

  // Handle AND compound conditions
  if (condition.and && condition.and.length > 0) {
    const formatted = condition.and
      .map((c) => formatCondition(c))
      .filter(Boolean)
      .join(' AND ');
    return formatted || null;
  }

  // Handle OR compound conditions
  if (condition.or && condition.or.length > 0) {
    const formatted = condition.or
      .map((c) => formatCondition(c))
      .filter(Boolean)
      .join(' OR ');
    return formatted || null;
  }

  // Handle simple condition
  if (!condition.field) return null;
  const fieldLabel = getFieldLabel(condition.field);
  const op = OPERATOR_LABELS[condition.operator || 'eq'] || condition.operator;
  return `${fieldLabel} ${op} ${condition.value}`;
};

const messages = defineMessages({
  configureOverlays: 'Configure Overlays',
  availableOverlays: 'Available Overlays',
  comingSoonForced:
    'Coming Soon overlays are automatically applied to placeholder items',
  ratings: 'Ratings',
  metadata: 'TMDB Metadata',
  mediaInfo: 'Media Info',
  status: 'Status',
  generic: 'General Purpose',
  save: 'Save Configuration',
  cancel: 'Cancel',
  saving: 'Saving...',
  worksOn: 'Works on',
  placeholders: 'Placeholders',
  realItems: 'Real items',
  both: 'Both',
  comingSoon: 'Coming Soon (Auto-applied)',
  optionalStatus: 'Status Overlays (Coming Soon/Placeholder items)',
  editDesign: 'Edit design in Templates tab',
  configure: 'Configure',
  savedSuccessfully: 'Library configuration saved',
  saveFailed: 'Failed to save configuration',
  alwaysApply: 'Always apply',
});

interface Template {
  id: number;
  name: string;
  description?: string;
  type: OverlayTemplateType;
  isDefault: boolean;
  applicationCondition?: ApplicationCondition;
}

interface EnabledOverlay {
  templateId: number;
  enabled: boolean;
  layerOrder: number;
  config?: {
    daysThreshold?: number;
    timeWindowDays?: number;
    minimumRating?: number;
  };
}

interface LibraryConfig {
  id?: number;
  libraryId: string;
  libraryName: string;
  mediaType: 'movie' | 'show';
  enabledOverlays: EnabledOverlay[];
}

interface LibraryDetailConfigViewProps {
  isOpen: boolean;
  onClose: () => void;
  libraryId: string;
  libraryName: string;
  libraryType: 'movie' | 'show';
}

interface SortableTemplateItemProps {
  template: Template;
  enabled: boolean;
  isHidden: boolean;
  forced: boolean;
  onToggle: () => void;
  onTogglePreview: () => void;
}

const SortableTemplateItem: React.FC<SortableTemplateItemProps> = ({
  template,
  enabled,
  isHidden,
  forced,
  onToggle,
  onTogglePreview,
}) => {
  const intl = useIntl();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: template.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const conditionText = formatCondition(template.applicationCondition);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center space-x-3 rounded-md p-3 transition-colors ${
        enabled ? 'bg-orange-500 bg-opacity-20' : 'hover:bg-stone-700'
      } ${forced ? 'opacity-75' : ''} ${isDragging ? 'z-50 opacity-50' : ''}`}
    >
      {/* Drag Handle */}
      <div
        {...attributes}
        {...listeners}
        className="flex-shrink-0 cursor-grab touch-none active:cursor-grabbing"
      >
        <Bars3Icon className="h-5 w-5 text-stone-500" />
      </div>

      {/* Checkbox */}
      <label className="flex flex-shrink-0 cursor-pointer items-center">
        <input
          type="checkbox"
          checked={forced || enabled}
          onChange={() => !forced && onToggle()}
          disabled={forced}
          className="h-4 w-4 rounded border-stone-600 text-orange-500 focus:ring-orange-500 disabled:opacity-50"
        />
      </label>

      {/* Template Info */}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-white">{template.name}</div>
        {template.description && (
          <div className="text-xs text-stone-400">{template.description}</div>
        )}
        {/* More prominent condition display */}
        {conditionText ? (
          <div className="mt-1 inline-block rounded bg-stone-800 px-2 py-0.5 text-xs font-medium text-blue-400">
            {conditionText}
          </div>
        ) : (
          <div className="mt-1 inline-block rounded bg-stone-800 px-2 py-0.5 text-xs font-medium text-stone-500">
            {intl.formatMessage(messages.alwaysApply)}
          </div>
        )}
      </div>

      {/* Preview Toggle */}
      {(enabled || forced) && (
        <button
          onClick={onTogglePreview}
          className={`flex-shrink-0 rounded p-1 transition-colors ${
            isHidden
              ? 'text-stone-500 hover:text-stone-300'
              : 'text-stone-300 hover:text-white'
          }`}
          title={isHidden ? 'Show in preview' : 'Hide from preview'}
        >
          {isHidden ? (
            <EyeSlashIcon className="h-4 w-4" />
          ) : (
            <EyeIcon className="h-4 w-4" />
          )}
        </button>
      )}
    </div>
  );
};

const LibraryDetailConfigView: React.FC<LibraryDetailConfigViewProps> = ({
  isOpen,
  onClose,
  libraryId,
  libraryName,
  libraryType,
}) => {
  const intl = useIntl();
  const [saving, setSaving] = useState(false);
  const [enabledOverlays, setEnabledOverlays] = useState<EnabledOverlay[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [hiddenFromPreview, setHiddenFromPreview] = useState<Set<number>>(
    new Set()
  );

  // Drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleCyclePoster = () => {
    setRefreshTrigger((prev) => prev + 1);
  };

  const togglePreviewVisibility = (templateId: number) => {
    setHiddenFromPreview((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(templateId)) {
        newSet.delete(templateId);
      } else {
        newSet.add(templateId);
      }
      return newSet;
    });
  };

  // Fetch templates
  const { data: templatesData } = useSWR<{ templates: Template[] }>(
    isOpen ? '/api/v1/overlay-templates' : null
  );

  // Fetch library config
  const { data: configData } = useSWR<LibraryConfig>(
    isOpen ? `/api/v1/overlay-library-configs/${libraryId}` : null
  );

  // Initialize enabled overlays from config
  useEffect(() => {
    if (configData?.enabledOverlays) {
      setEnabledOverlays(configData.enabledOverlays);
    }
  }, [configData]);

  // Fetch combined preview when enabled overlays change
  const fetchPreview = useCallback(async () => {
    const enabledIds = enabledOverlays
      .filter((o) => o.enabled && !hiddenFromPreview.has(o.templateId))
      .sort((a, b) => a.layerOrder - b.layerOrder)
      .map((o) => o.templateId);

    if (enabledIds.length === 0) {
      setPreviewUrl(null);
      return;
    }

    setPreviewLoading(true);
    try {
      const response = await fetch(
        '/api/v1/overlay-templates/combined-preview',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ templateIds: enabledIds }),
        }
      );

      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        setPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
      }
    } catch {
      // Ignore preview errors
    } finally {
      setPreviewLoading(false);
    }
  }, [enabledOverlays, hiddenFromPreview]);

  // Debounce preview fetching
  useEffect(() => {
    if (!isOpen) return;

    if (previewDebounceRef.current) {
      clearTimeout(previewDebounceRef.current);
    }

    previewDebounceRef.current = setTimeout(() => {
      fetchPreview();
    }, 300);

    return () => {
      if (previewDebounceRef.current) {
        clearTimeout(previewDebounceRef.current);
      }
    };
  }, [
    enabledOverlays,
    isOpen,
    fetchPreview,
    refreshTrigger,
    hiddenFromPreview,
  ]);

  // Cleanup preview URL on unmount
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const templates = templatesData?.templates || [];

  // Sort templates by layer order from enabledOverlays (descending - higher layers at top)
  const sortedTemplates = [...templates].sort((a, b) => {
    const aOverlay = enabledOverlays.find((o) => o.templateId === a.id);
    const bOverlay = enabledOverlays.find((o) => o.templateId === b.id);
    const aOrder = aOverlay?.layerOrder ?? -1;
    const bOrder = bOverlay?.layerOrder ?? -1;
    return bOrder - aOrder; // Reversed: higher layer order = top of list
  });

  const isEnabled = (templateId: number) => {
    return enabledOverlays.some(
      (o) => o.templateId === templateId && o.enabled
    );
  };

  const handleToggle = (templateId: number) => {
    setEnabledOverlays((prev) => {
      const existing = prev.find((o) => o.templateId === templateId);

      if (existing) {
        // Toggle enabled
        return prev.map((o) =>
          o.templateId === templateId ? { ...o, enabled: !o.enabled } : o
        );
      } else {
        // Add new
        const maxLayerOrder = Math.max(...prev.map((o) => o.layerOrder), 0);
        return [
          ...prev,
          {
            templateId,
            enabled: true,
            layerOrder: maxLayerOrder + 1,
          },
        ];
      }
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = sortedTemplates.findIndex((t) => t.id === active.id);
    const newIndex = sortedTemplates.findIndex((t) => t.id === over.id);

    // Reorder the templates
    const reordered = arrayMove(sortedTemplates, oldIndex, newIndex);

    // Update layer orders based on new positions (reversed - top of list = highest layer)
    setEnabledOverlays((prev) => {
      const updated = [...prev];
      const totalTemplates = reordered.length;
      reordered.forEach((template, index) => {
        const layerOrder = totalTemplates - index - 1; // Reverse: index 0 = highest layer
        const existing = updated.find((o) => o.templateId === template.id);
        if (existing) {
          existing.layerOrder = layerOrder;
        } else {
          updated.push({
            templateId: template.id,
            enabled: false,
            layerOrder,
          });
        }
      });
      return updated;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetch(
        `/api/v1/overlay-library-configs/${libraryId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            libraryName,
            mediaType: configData?.mediaType || libraryType,
            enabledOverlays,
          }),
        }
      );

      if (response.ok) {
        await mutate(`/api/v1/overlay-library-configs/${libraryId}`);
        await mutate('/api/v1/overlay-library-configs');
        onClose();
      } else {
        alert(intl.formatMessage(messages.saveFailed));
      }
    } catch (error) {
      alert(intl.formatMessage(messages.saveFailed));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`${intl.formatMessage(
        messages.configureOverlays
      )} - ${libraryName}`}
      onCancel={onClose}
      onOk={handleSave}
      okText={intl.formatMessage(messages.save)}
      okDisabled={saving}
      cancelText={intl.formatMessage(messages.cancel)}
      backgroundClickable={false}
      customMaxWidth="sm:max-w-4xl"
    >
      {!templatesData || !configData ? (
        <div className="flex h-[600px] items-center justify-center">
          <LoadingSpinner />
        </div>
      ) : (
        <div className="flex h-[600px] gap-8">
          {/* Large Preview Panel - Main Focus */}
          <div className="flex flex-shrink-0 flex-col">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Preview</h3>
              {previewUrl && !previewLoading && (
                <button
                  onClick={handleCyclePoster}
                  className="flex items-center gap-1.5 rounded-md bg-stone-700 px-2.5 py-1.5 text-xs text-stone-300 transition-colors hover:bg-stone-600"
                  title="Cycle poster"
                >
                  <ArrowPathIcon className="h-3.5 w-3.5" />
                  Cycle
                </button>
              )}
            </div>
            <div className="relative aspect-[2/3] h-[540px] overflow-hidden rounded-lg bg-stone-900">
              {previewLoading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-black bg-opacity-50">
                  <LoadingSpinner />
                </div>
              )}
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt="Combined overlay preview"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-center text-sm text-stone-500">
                  <span>Select overlays to see preview</span>
                </div>
              )}
            </div>
          </div>

          {/* Overlay Selection - Drag & Drop Scrollable List */}
          <div className="min-w-0 flex-1 overflow-y-auto pr-2">
            <div className="mb-3 text-xs text-stone-400">
              Drag to reorder • Top overlays render on top of bottom overlays
            </div>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={sortedTemplates.map((t) => t.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-2">
                  {sortedTemplates.map((template) => {
                    const forced = template.name.startsWith('Coming Soon:');
                    return (
                      <SortableTemplateItem
                        key={template.id}
                        template={template}
                        enabled={isEnabled(template.id)}
                        isHidden={hiddenFromPreview.has(template.id)}
                        forced={forced}
                        onToggle={() => handleToggle(template.id)}
                        onTogglePreview={() =>
                          togglePreviewVisibility(template.id)
                        }
                      />
                    );
                  })}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        </div>
      )}
    </Modal>
  );
};

export default LibraryDetailConfigView;
