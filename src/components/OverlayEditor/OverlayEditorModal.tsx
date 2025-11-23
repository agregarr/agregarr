import Modal from '@app/components/Common/Modal';
import { Dialog, Transition } from '@headlessui/react';
import { Squares2X2Icon } from '@heroicons/react/24/outline';
import {
  ArrowPathIcon,
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  EyeIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/solid';
import type React from 'react';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import useSWR from 'swr';
import type { OverlayCanvasRef } from './OverlayCanvas';
import { OverlayCanvas } from './OverlayCanvas';
import { OverlayLayerPanel } from './OverlayLayerPanel';
import type {
  ApplicationCondition,
  OverlayRenderContext,
  OverlayTemplateData,
  PreviewPosterInfo,
} from './types';
import {
  CONDITION_FIELD_CATEGORIES,
  getTemplateTypeFromConditionField,
  SAMPLE_PREVIEW_CONTEXTS,
} from './types';

const messages = defineMessages({
  createOverlayTitle: 'Create Overlay Template',
  editOverlayTitle: 'Edit Overlay Template',
  save: 'Save',
  cancel: 'Cancel',
  saving: 'Saving...',
  templateName: 'Template Name',
  description: 'Description (Optional)',
  enterName: 'Enter a name',
  enterDescription: 'Enter a description',
  undo: 'Undo',
  redo: 'Redo',
  previewPoster: 'Preview Poster',
  refreshPoster: 'Next Poster',
  loadingMetadata: 'Loading metadata...',
  snapToGuides: 'Snap to Guides',
  posterInfo: 'Poster Info',
  noPosterLoaded: 'No poster loaded',
  // Application condition
  applicationCondition: 'Application Condition',
  enableCondition: 'Only apply when:',
  noCondition: 'Always apply (no condition)',
  opEquals: 'equals',
  opNotEquals: 'not equals',
  opGreaterThan: 'greater than',
  opGreaterOrEqual: 'at least',
  opLessThan: 'less than',
  opLessOrEqual: 'at most',
  opContains: 'contains',
  opRegex: 'matches regex',
  opBegins: 'begins with',
  opEnds: 'ends with',
  // Preview overlays
  previewOverlays: 'Preview with Other Overlays',
  selectOverlaysForPreview: 'Select Overlays for Preview',
  noOtherOverlays: 'No other overlay templates available',
  selectedCount: '{count} selected',
  // Compound conditions
  addCondition: 'Add Condition',
  removeCondition: 'Remove',
  combineWith: 'Combine with',
  andLogic: 'AND',
  orLogic: 'OR',
});

export type OverlayEditorMode = 'create' | 'edit';

export interface OverlayEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: OverlayEditorMode;
  templateId?: number; // ID of template being edited (to exclude from preview list)
  initialData?: OverlayTemplateData;
  initialName?: string;
  initialDescription?: string;
  initialCondition?: ApplicationCondition;
  onSave: (data: {
    name: string;
    description?: string;
    type?: string;
    templateData: OverlayTemplateData;
    applicationCondition?: ApplicationCondition;
  }) => Promise<void>;
}

const DEFAULT_OVERLAY_DATA: OverlayTemplateData = {
  width: 1000,
  height: 1500,
  elements: [],
};

interface PreviewPostersResponse {
  posters: PreviewPosterInfo[];
  count: number;
}

interface AvailableOverlayTemplate {
  id: number;
  name: string;
  templateData: OverlayTemplateData;
}

// Simple condition type for UI
type SimpleCondition = {
  field: string;
  operator: string;
  value: string | number | boolean | (string | number)[];
};

// Helper to extract simple conditions from ApplicationCondition
const extractConditions = (
  cond: ApplicationCondition | undefined
): { conditions: SimpleCondition[]; combinator: 'and' | 'or' } => {
  if (!cond) return { conditions: [], combinator: 'and' };

  if (cond.and && cond.and.length > 0) {
    return {
      conditions: cond.and
        .filter((c) => c.field)
        .map((c) => ({
          field: c.field || 'daysUntilRelease',
          operator: c.operator || 'eq',
          value: c.value ?? '',
        })),
      combinator: 'and',
    };
  }

  if (cond.or && cond.or.length > 0) {
    return {
      conditions: cond.or
        .filter((c) => c.field)
        .map((c) => ({
          field: c.field || 'daysUntilRelease',
          operator: c.operator || 'eq',
          value: c.value ?? '',
        })),
      combinator: 'or',
    };
  }

  if (cond.field) {
    return {
      conditions: [
        {
          field: cond.field,
          operator: cond.operator || 'eq',
          value: cond.value ?? '',
        },
      ],
      combinator: 'and',
    };
  }

  return { conditions: [], combinator: 'and' };
};

// Helper to build ApplicationCondition from UI state
const buildCondition = (
  conditions: SimpleCondition[],
  combinator: 'and' | 'or'
): ApplicationCondition | undefined => {
  if (conditions.length === 0) return undefined;

  // Filter out conditions with empty values
  const validConditions = conditions.filter(
    (c) => c.value !== '' && c.value !== null && c.value !== undefined
  );

  if (validConditions.length === 0) return undefined;

  if (validConditions.length === 1) {
    return {
      field: validConditions[0].field,
      operator: validConditions[0].operator as ApplicationCondition['operator'],
      value: validConditions[0].value,
    };
  }

  const conditionArray = validConditions.map((c) => ({
    field: c.field,
    operator: c.operator as ApplicationCondition['operator'],
    value: c.value,
  }));

  return combinator === 'and'
    ? { and: conditionArray }
    : { or: conditionArray };
};

export const OverlayEditorModal: React.FC<OverlayEditorModalProps> = ({
  isOpen,
  onClose,
  mode,
  templateId,
  initialData = DEFAULT_OVERLAY_DATA,
  initialName = '',
  initialDescription = '',
  initialCondition,
  onSave,
}) => {
  const intl = useIntl();
  const [overlayData, setOverlayData] =
    useState<OverlayTemplateData>(initialData);
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [saving, setSaving] = useState(false);
  const [selectedElementId, setSelectedElementId] = useState<
    string | undefined
  >();
  const [snapToGuides, setSnapToGuides] = useState(true);

  // Condition state
  const initialConditionData = extractConditions(initialCondition);
  const [conditions, setConditions] = useState<SimpleCondition[]>(
    initialConditionData.conditions
  );
  const [conditionCombinator, setConditionCombinator] = useState<'and' | 'or'>(
    initialConditionData.combinator
  );

  // Derived condition for saving
  const condition = buildCondition(conditions, conditionCombinator);

  // Poster preview state
  const [currentPosterIndex, setCurrentPosterIndex] = useState(0);

  // Preview overlays state
  const [selectedPreviewIds, setSelectedPreviewIds] = useState<number[]>([]);
  const [isPreviewSelectorOpen, setIsPreviewSelectorOpen] = useState(false);

  const canvasRef = useRef<OverlayCanvasRef | null>(null);

  // Fetch available preview posters
  const { data: postersData } = useSWR<PreviewPostersResponse>(
    isOpen ? '/api/v1/overlay-templates/preview-posters' : null
  );

  // Get current poster info
  const currentPoster = postersData?.posters[currentPosterIndex];

  // Fetch real metadata for current poster
  const { data: metadataResponse } = useSWR<OverlayRenderContext>(
    isOpen && currentPoster
      ? `/api/v1/overlay-templates/preview-metadata/${currentPoster.id}`
      : null
  );

  // Fetch available overlay templates for preview selection
  const { data: templatesData } = useSWR<{
    templates: AvailableOverlayTemplate[];
  }>(isOpen ? '/api/v1/overlay-templates' : null);

  // Filter out current template being edited (by ID)
  const availableTemplates = (templatesData?.templates || []).filter(
    (t) => t.id !== templateId
  );

  // Get selected preview overlay data
  const selectedPreviewOverlays = selectedPreviewIds
    .map((id) => availableTemplates.find((t) => t.id === id)?.templateData)
    .filter((data): data is OverlayTemplateData => data !== undefined);

  // History state for undo/redo
  const [history, setHistory] = useState<OverlayTemplateData[]>([initialData]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const maxHistorySize = 50;

  // Undo/Redo functions
  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  const undo = useCallback(() => {
    if (canUndo) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setOverlayData(history[newIndex]);
      setSelectedElementId(undefined);
    }
  }, [canUndo, historyIndex, history]);

  const redo = useCallback(() => {
    if (canRedo) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setOverlayData(history[newIndex]);
      setSelectedElementId(undefined);
    }
  }, [canRedo, historyIndex, history]);

  // Helper to add state to history
  const addToHistory = useCallback(
    (newData: OverlayTemplateData) => {
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(newData);

      if (newHistory.length > maxHistorySize) {
        newHistory.shift();
      } else {
        setHistoryIndex(newHistory.length - 1);
      }

      setHistory(newHistory);
      setOverlayData(newData);
    },
    [history, historyIndex, maxHistorySize]
  );

  // Reset history when modal opens
  useEffect(() => {
    if (isOpen) {
      setHistory([initialData]);
      setHistoryIndex(0);
      setOverlayData(initialData);
      setName(initialName);
      setDescription(initialDescription);
      setSelectedElementId(undefined);
      setCurrentPosterIndex(0);
      const condData = extractConditions(initialCondition);
      setConditions(condData.conditions);
      setConditionCombinator(condData.combinator);
      setSelectedPreviewIds([]);
    }
  }, [isOpen, initialData, initialName, initialDescription, initialCondition]);

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isModifier = e.ctrlKey || e.metaKey;

      if (isModifier && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (isModifier && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        redo();
      } else if (isModifier && e.key === 'y') {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      return;
    }

    // Auto-determine type from condition field, default to 'generic' if no condition
    const autoType = condition?.field
      ? getTemplateTypeFromConditionField(condition.field)
      : 'generic';

    try {
      setSaving(true);
      await onSave({
        name: name.trim(),
        description: description?.trim() || undefined,
        type: autoType,
        templateData: overlayData,
        applicationCondition: condition,
      });
      onClose();
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        // eslint-disable-next-line no-console
        console.error('Failed to save overlay template:', error);
      }
    } finally {
      setSaving(false);
    }
  }, [name, description, overlayData, condition, onSave, onClose]);

  const handleCancel = useCallback(() => {
    onClose();
  }, [onClose]);

  const getTitle = () => {
    return mode === 'create'
      ? intl.formatMessage(messages.createOverlayTitle)
      : intl.formatMessage(messages.editOverlayTitle);
  };

  // Handle poster cycling
  const handleNextPoster = () => {
    if (postersData && postersData.count > 0) {
      setCurrentPosterIndex((prev) => (prev + 1) % postersData.count);
    }
  };

  // Get preview context - use real metadata if available, otherwise fallback to sample data
  const previewContext: OverlayRenderContext | undefined = metadataResponse
    ? metadataResponse
    : currentPoster?.type === 'movie'
    ? (SAMPLE_PREVIEW_CONTEXTS.movie as OverlayRenderContext)
    : currentPoster?.type === 'tv'
    ? (SAMPLE_PREVIEW_CONTEXTS.tv as OverlayRenderContext)
    : (SAMPLE_PREVIEW_CONTEXTS.movie as OverlayRenderContext);

  // Get poster URL
  const posterUrl = currentPoster?.url;

  return (
    <>
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
                <Dialog.Panel className="w-full max-w-[95vw] transform overflow-hidden rounded-2xl bg-stone-900 p-4 text-left align-middle shadow-xl transition-all">
                  <div className="mb-2 flex items-center justify-between">
                    <Dialog.Title
                      as="h3"
                      className="text-base font-medium text-white"
                    >
                      {getTitle()}
                    </Dialog.Title>
                    <button
                      type="button"
                      className="rounded-md p-1 text-stone-400 hover:text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                      onClick={onClose}
                    >
                      <XMarkIcon className="h-5 w-5" aria-hidden="true" />
                    </button>
                  </div>

                  <div className="grid h-[calc(100vh-100px)] grid-cols-12 gap-6">
                    {/* Left sidebar - Form */}
                    <div className="col-span-3 space-y-4 overflow-y-auto">
                      <div>
                        <label
                          htmlFor="name"
                          className="mb-2 block text-sm font-medium text-stone-300"
                        >
                          {intl.formatMessage(messages.templateName)}
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
                          value={description || ''}
                          onChange={(e) => setDescription(e.target.value)}
                        />
                      </div>

                      {/* Preview with Other Overlays */}
                      <div className="border-t border-stone-700 pt-4">
                        <label className="mb-2 block text-sm font-medium text-stone-300">
                          {intl.formatMessage(messages.previewOverlays)}
                        </label>
                        <button
                          type="button"
                          onClick={() => setIsPreviewSelectorOpen(true)}
                          className="flex w-full items-center justify-center space-x-2 rounded-md border border-stone-600 bg-stone-700 px-3 py-2 text-sm text-stone-300 hover:border-stone-500 hover:text-white"
                        >
                          <EyeIcon className="h-4 w-4" />
                          <span>
                            {selectedPreviewIds.length > 0
                              ? intl.formatMessage(messages.selectedCount, {
                                  count: selectedPreviewIds.length,
                                })
                              : intl.formatMessage(
                                  messages.selectOverlaysForPreview
                                )}
                          </span>
                        </button>
                      </div>

                      {/* Application Condition */}
                      <div className="border-t border-stone-700 pt-4">
                        <label className="mb-2 block text-sm font-medium text-stone-300">
                          {intl.formatMessage(messages.applicationCondition)}
                        </label>

                        {/* Toggle for condition */}
                        <label className="mb-3 flex items-center space-x-2">
                          <input
                            type="checkbox"
                            checked={conditions.length > 0}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setConditions([
                                  {
                                    field: 'daysUntilRelease',
                                    operator: 'gte',
                                    value: '',
                                  },
                                ]);
                              } else {
                                setConditions([]);
                              }
                            }}
                            className="rounded border-stone-600 bg-stone-700 text-orange-600"
                          />
                          <span className="text-sm text-stone-300">
                            {conditions.length > 0
                              ? intl.formatMessage(messages.enableCondition)
                              : intl.formatMessage(messages.noCondition)}
                          </span>
                        </label>

                        {conditions.length > 0 &&
                          (() => {
                            // Get all condition fields for finding examples
                            const allConditionFields = Object.values(
                              CONDITION_FIELD_CATEGORIES
                            ).flat();
                            const numericFields = [
                              'imdbRating',
                              'rtCriticsScore',
                              'rtAudienceScore',
                              'metacriticScore',
                              'year',
                              'runtime',
                              'daysUntilRelease',
                              'daysAgo',
                              'seasonNumber',
                              'episodeNumber',
                              'width',
                              'height',
                              'aspectRatio',
                              'bitDepth',
                              'audioChannels',
                              'bitrate',
                              'fileSize',
                              'viewCount',
                            ];

                            return (
                              <div className="space-y-3">
                                {conditions.map((cond, index) => {
                                  const isNumeric = numericFields.includes(
                                    cond.field
                                  );

                                  return (
                                    <div key={index} className="space-y-2">
                                      {/* AND/OR separator between conditions */}
                                      {index > 0 && (
                                        <div className="flex items-center justify-center py-1">
                                          <select
                                            value={conditionCombinator}
                                            onChange={(e) =>
                                              setConditionCombinator(
                                                e.target.value as 'and' | 'or'
                                              )
                                            }
                                            className="rounded border border-stone-600 bg-stone-700 px-2 py-1 text-xs text-orange-400"
                                          >
                                            <option value="and">
                                              {intl.formatMessage(
                                                messages.andLogic
                                              )}
                                            </option>
                                            <option value="or">
                                              {intl.formatMessage(
                                                messages.orLogic
                                              )}
                                            </option>
                                          </select>
                                        </div>
                                      )}

                                      <div className="rounded border border-stone-600 bg-stone-800 p-2">
                                        {/* Field */}
                                        <select
                                          value={cond.field}
                                          onChange={(e) => {
                                            const newConditions = [
                                              ...conditions,
                                            ];
                                            newConditions[index] = {
                                              ...cond,
                                              field: e.target.value,
                                              value: '',
                                            };
                                            setConditions(newConditions);
                                          }}
                                          className="mb-2 w-full rounded border border-stone-600 bg-stone-700 px-2 py-1 text-sm text-white"
                                        >
                                          {Object.entries(
                                            CONDITION_FIELD_CATEGORIES
                                          ).map(([category, fields]) => (
                                            <optgroup
                                              key={category}
                                              label={category}
                                            >
                                              {fields.map((v) => (
                                                <option
                                                  key={v.field}
                                                  value={v.field}
                                                >
                                                  {v.label}
                                                </option>
                                              ))}
                                            </optgroup>
                                          ))}
                                        </select>

                                        {/* Operator */}
                                        <select
                                          value={cond.operator}
                                          onChange={(e) => {
                                            const newConditions = [
                                              ...conditions,
                                            ];
                                            newConditions[index] = {
                                              ...cond,
                                              operator: e.target.value,
                                            };
                                            setConditions(newConditions);
                                          }}
                                          className="mb-2 w-full rounded border border-stone-600 bg-stone-700 px-2 py-1 text-sm text-white"
                                        >
                                          <option value="eq">
                                            {intl.formatMessage(
                                              messages.opEquals
                                            )}
                                          </option>
                                          <option value="neq">
                                            {intl.formatMessage(
                                              messages.opNotEquals
                                            )}
                                          </option>
                                          {isNumeric && (
                                            <>
                                              <option value="gt">
                                                {intl.formatMessage(
                                                  messages.opGreaterThan
                                                )}
                                              </option>
                                              <option value="gte">
                                                {intl.formatMessage(
                                                  messages.opGreaterOrEqual
                                                )}
                                              </option>
                                              <option value="lt">
                                                {intl.formatMessage(
                                                  messages.opLessThan
                                                )}
                                              </option>
                                              <option value="lte">
                                                {intl.formatMessage(
                                                  messages.opLessOrEqual
                                                )}
                                              </option>
                                            </>
                                          )}
                                          <option value="contains">
                                            {intl.formatMessage(
                                              messages.opContains
                                            )}
                                          </option>
                                          <option value="regex">
                                            {intl.formatMessage(
                                              messages.opRegex
                                            )}
                                          </option>
                                          <option value="begins">
                                            {intl.formatMessage(
                                              messages.opBegins
                                            )}
                                          </option>
                                          <option value="ends">
                                            {intl.formatMessage(
                                              messages.opEnds
                                            )}
                                          </option>
                                        </select>

                                        {/* Value */}
                                        <div className="flex items-center space-x-2">
                                          <input
                                            type={isNumeric ? 'number' : 'text'}
                                            value={String(cond.value)}
                                            onChange={(e) => {
                                              const val = e.target.value;
                                              const numVal = Number(val);
                                              const newConditions = [
                                                ...conditions,
                                              ];
                                              newConditions[index] = {
                                                ...cond,
                                                value:
                                                  isNumeric &&
                                                  !isNaN(numVal) &&
                                                  val !== ''
                                                    ? numVal
                                                    : val,
                                              };
                                              setConditions(newConditions);
                                            }}
                                            placeholder={
                                              allConditionFields.find(
                                                (f) => f.field === cond.field
                                              )?.example || ''
                                            }
                                            className="flex-1 rounded border border-stone-600 bg-stone-700 px-2 py-1 text-sm text-white"
                                          />
                                          {conditions.length > 1 && (
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setConditions(
                                                  conditions.filter(
                                                    (_, i) => i !== index
                                                  )
                                                );
                                              }}
                                              className="rounded p-1 text-red-400 hover:bg-red-900/50 hover:text-red-300"
                                              title={intl.formatMessage(
                                                messages.removeCondition
                                              )}
                                            >
                                              <TrashIcon className="h-4 w-4" />
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}

                                {/* Add condition button */}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setConditions([
                                      ...conditions,
                                      {
                                        field: 'daysUntilRelease',
                                        operator: 'gte',
                                        value: '',
                                      },
                                    ]);
                                  }}
                                  className="flex w-full items-center justify-center space-x-1 rounded border border-dashed border-stone-600 py-2 text-xs text-stone-400 hover:border-stone-500 hover:text-stone-300"
                                >
                                  <PlusIcon className="h-3 w-3" />
                                  <span>
                                    {intl.formatMessage(messages.addCondition)}
                                  </span>
                                </button>
                              </div>
                            );
                          })()}
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
                      {/* Canvas Area */}
                      <OverlayCanvas
                        ref={canvasRef}
                        overlayData={overlayData}
                        onChange={addToHistory}
                        selectedElementId={selectedElementId}
                        onElementSelect={setSelectedElementId}
                        backgroundImageUrl={posterUrl}
                        renderContext={previewContext}
                        snapToGuides={snapToGuides}
                        previewOverlays={selectedPreviewOverlays}
                      />

                      {/* Vertical Toolbar */}
                      <div className="flex flex-col items-center space-y-1 border-l border-stone-700 px-2 py-3">
                        {/* Undo */}
                        <button
                          type="button"
                          onClick={undo}
                          disabled={!canUndo}
                          className="rounded p-1.5 text-stone-400 hover:bg-stone-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                          title="Undo (Ctrl+Z)"
                        >
                          <ArrowUturnLeftIcon className="h-4 w-4" />
                        </button>
                        {/* Redo */}
                        <button
                          type="button"
                          onClick={redo}
                          disabled={!canRedo}
                          className="rounded p-1.5 text-stone-400 hover:bg-stone-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                          title="Redo (Ctrl+Shift+Z)"
                        >
                          <ArrowUturnRightIcon className="h-4 w-4" />
                        </button>

                        <div className="my-1 h-px w-4 bg-stone-600" />

                        {/* Snap to guides */}
                        <button
                          type="button"
                          onClick={() => setSnapToGuides(!snapToGuides)}
                          className={`rounded p-1.5 ${
                            snapToGuides
                              ? 'bg-orange-600 text-white'
                              : 'text-stone-400 hover:bg-stone-700 hover:text-white'
                          }`}
                          title={snapToGuides ? 'Snap: ON' : 'Snap: OFF'}
                        >
                          <Squares2X2Icon className="h-4 w-4" />
                        </button>

                        <div className="my-1 h-px w-4 bg-stone-600" />

                        {/* Refresh poster */}
                        <button
                          type="button"
                          onClick={handleNextPoster}
                          disabled={!postersData || postersData.count === 0}
                          className="rounded p-1.5 text-stone-400 hover:bg-stone-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                          title={intl.formatMessage(messages.refreshPoster)}
                        >
                          <ArrowPathIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    {/* Right sidebar - Layer Panel */}
                    <div className="col-span-3 overflow-y-auto">
                      <OverlayLayerPanel
                        overlayData={overlayData}
                        onChange={addToHistory}
                        selectedElementId={selectedElementId}
                        onElementSelect={setSelectedElementId}
                      />
                    </div>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>

      {/* Preview Overlay Selection Modal - outside Transition to avoid Fragment prop issues */}
      {isPreviewSelectorOpen && (
        <Modal
          title={intl.formatMessage(messages.selectOverlaysForPreview)}
          onCancel={() => setIsPreviewSelectorOpen(false)}
          onOk={() => setIsPreviewSelectorOpen(false)}
          okText="Done"
          loading={false}
          backgroundClickable={false}
        >
          <div className="max-h-96 overflow-y-auto">
            {availableTemplates.length === 0 ? (
              <p className="text-center text-stone-400">
                {intl.formatMessage(messages.noOtherOverlays)}
              </p>
            ) : (
              <div className="space-y-2">
                {availableTemplates.map((template) => (
                  <label
                    key={template.id}
                    className="flex cursor-pointer items-center space-x-3 rounded-md p-2 hover:bg-stone-700"
                  >
                    <input
                      type="checkbox"
                      checked={selectedPreviewIds.includes(template.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedPreviewIds([
                            ...selectedPreviewIds,
                            template.id,
                          ]);
                        } else {
                          setSelectedPreviewIds(
                            selectedPreviewIds.filter(
                              (id) => id !== template.id
                            )
                          );
                        }
                      }}
                      className="rounded border-stone-600 bg-stone-700 text-orange-600 focus:ring-orange-500"
                    />
                    <span className="text-sm text-white">{template.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
};
