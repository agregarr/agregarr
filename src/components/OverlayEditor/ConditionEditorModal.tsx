import Modal from '@app/components/Common/Modal';
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
import { Bars3Icon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import type {
  ApplicationCondition,
  ConditionRule,
  ConditionSection,
} from '@server/entity/OverlayTemplate';
import { useEffect, useRef, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import useSWR from 'swr';
import { CONDITION_FIELD_CATEGORIES } from './types';

interface ArrTag {
  id: number;
  label: string;
}

const messages = defineMessages({
  title: 'Edit Application Conditions',
  save: 'Save',
  cancel: 'Cancel',
  description:
    'Define when this overlay template should be applied to posters. Organize rules into sections for clear, readable conditions.',
  enableCondition: 'Only apply when:',
  noCondition: 'Always apply (no condition)',
  addRule: 'Add Rule',
  addSection: 'Add Section',
  removeSection: 'Remove Section',
  removeRule: 'Remove Rule',
  section: 'Section',
  opEquals: 'equals',
  opNotEquals: 'not equals',
  opGreaterThan: 'greater than',
  opGreaterOrEqual: 'greater than or equal',
  opLessThan: 'less than',
  opLessOrEqual: 'less than or equal',
  opContains: 'contains',
  opRegex: 'regex',
  opBegins: 'begins with',
  opEnds: 'ends with',
  opIn: 'in',
  and: 'AND',
  or: 'OR',
});

// List of numeric fields
const NUMERIC_FIELDS = [
  'imdbRating',
  'rtCriticsScore',
  'rtAudienceScore',
  // 'metacriticScore', // TODO: Implement Metacritic integration
  'year',
  'runtime',
  'daysUntilRelease',
  'daysAgo',
  'daysUntilNextSeason',
  'daysAgoNextSeason',
  'daysUntilNextEpisode',
  'daysUntilAction',
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
  'imdbTop250Rank',
];

// List of boolean fields
const BOOLEAN_FIELDS = [
  'isPlaceholder',
  'isMonitored',
  'inRadarr',
  'inSonarr',
  'downloaded',
  'hdr',
  'dolbyVision',
  'isImdbTop250',
];

// ============================================================================
// RULE ITEM (Individual Condition)
// ============================================================================

interface RuleItemProps {
  id: string | number;
  rule: ConditionRule;
  onChange: (updated: ConditionRule) => void;
  onRemove: () => void;
}

const RuleItem: React.FC<RuleItemProps> = ({
  id,
  rule,
  onChange,
  onRemove,
}) => {
  const intl = useIntl();

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const field = rule.field || 'daysUntilRelease';
  const operator = rule.operator || 'eq';
  const value = rule.value ?? '';

  const isNumeric = NUMERIC_FIELDS.includes(field);
  const isBoolean = BOOLEAN_FIELDS.includes(field);
  const isRadarrTags = field === 'radarrTags';
  const isSonarrTags = field === 'sonarrTags';
  const isTagField = isRadarrTags || isSonarrTags;

  // Fetch all tags from all Radarr instances
  const { data: radarrTags } = useSWR<ArrTag[]>(
    isRadarrTags ? '/api/v1/settings/radarr/tags/all' : null,
    (url) => fetch(url).then((res) => res.json())
  );

  // Fetch all tags from all Sonarr instances
  const { data: sonarrTags } = useSWR<ArrTag[]>(
    isSonarrTags ? '/api/v1/settings/sonarr/tags/all' : null,
    (url) => fetch(url).then((res) => res.json())
  );

  const availableTags = isRadarrTags
    ? Array.isArray(radarrTags)
      ? radarrTags
      : []
    : isSonarrTags
    ? Array.isArray(sonarrTags)
      ? sonarrTags
      : []
    : [];

  // Sanitize operator if it's invalid for the current field type (on mount)
  const lastSanitizedKey = useRef<string>('');

  useEffect(() => {
    const sanitizeKey = `${field}-${operator}`;
    if (lastSanitizedKey.current === sanitizeKey) return;

    const numericOnlyOperators = ['gt', 'gte', 'lt', 'lte'];
    const isInvalid =
      (!isNumeric && numericOnlyOperators.includes(operator)) ||
      (isBoolean && !['eq', 'neq'].includes(operator));

    if (isInvalid) {
      lastSanitizedKey.current = sanitizeKey;
      onChange({ ...rule, operator: 'eq' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field, operator, isNumeric, isBoolean]);

  const allConditionFields = Object.values(CONDITION_FIELD_CATEGORIES).flat();
  const placeholder =
    allConditionFields.find((f) => f.field === field)?.example || '';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center space-x-2 ${
        isDragging ? 'z-50 opacity-50' : ''
      }`}
    >
      {/* Drag Handle */}
      <div
        {...attributes}
        {...listeners}
        className="flex-shrink-0 cursor-grab touch-none active:cursor-grabbing"
      >
        <Bars3Icon className="h-5 w-5 text-stone-500" />
      </div>

      {/* Field Selector */}
      <select
        value={field}
        onChange={(e) => {
          const newField = e.target.value;
          const isNewFieldBoolean = BOOLEAN_FIELDS.includes(newField);
          const isNewFieldNumeric = NUMERIC_FIELDS.includes(newField);

          // Determine if current operator is valid for new field type
          const numericOnlyOperators = ['gt', 'gte', 'lt', 'lte'];
          const isCurrentOperatorInvalid =
            (!isNewFieldNumeric && numericOnlyOperators.includes(operator)) ||
            (isNewFieldBoolean && !['eq', 'neq'].includes(operator));

          // Reset to appropriate defaults when changing field
          onChange({
            ...rule,
            field: newField,
            operator: isCurrentOperatorInvalid ? 'eq' : rule.operator,
            value: isNewFieldBoolean ? true : '',
          });
        }}
        className="flex-1 select-none rounded border border-stone-600 bg-stone-700 px-2 py-1 text-sm text-white"
      >
        {Object.entries(CONDITION_FIELD_CATEGORIES).map(
          ([category, fields]) => (
            <optgroup key={category} label={category}>
              {fields.map((v) => (
                <option key={v.field} value={v.field}>
                  {v.label}
                </option>
              ))}
            </optgroup>
          )
        )}
      </select>

      {/* Comparison Operator */}
      <select
        value={operator}
        onChange={(e) => {
          onChange({
            ...rule,
            operator: e.target.value as ConditionRule['operator'],
          });
        }}
        className="w-32 rounded border border-stone-600 bg-stone-700 px-2 py-1 text-sm text-white"
      >
        <option value="eq">{intl.formatMessage(messages.opEquals)}</option>
        <option value="neq">{intl.formatMessage(messages.opNotEquals)}</option>
        {isNumeric && (
          <>
            <option value="gt">
              {intl.formatMessage(messages.opGreaterThan)}
            </option>
            <option value="gte">
              {intl.formatMessage(messages.opGreaterOrEqual)}
            </option>
            <option value="lt">
              {intl.formatMessage(messages.opLessThan)}
            </option>
            <option value="lte">
              {intl.formatMessage(messages.opLessOrEqual)}
            </option>
          </>
        )}
        {!isBoolean && (
          <>
            <option value="in">{intl.formatMessage(messages.opIn)}</option>
            <option value="contains">
              {intl.formatMessage(messages.opContains)}
            </option>
            <option value="regex">
              {intl.formatMessage(messages.opRegex)}
            </option>
            <option value="begins">
              {intl.formatMessage(messages.opBegins)}
            </option>
            <option value="ends">{intl.formatMessage(messages.opEnds)}</option>
          </>
        )}
      </select>

      {/* Value Input */}
      {isBoolean ? (
        <select
          value={String(value)}
          onChange={(e) => {
            onChange({
              ...rule,
              value: e.target.value === 'true',
            });
          }}
          className="flex-1 rounded border border-stone-600 bg-stone-700 px-2 py-1 text-sm text-white"
        >
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      ) : isTagField ? (
        <select
          value={String(value)}
          onChange={(e) => {
            onChange({
              ...rule,
              value: e.target.value,
            });
          }}
          className="flex-1 rounded border border-stone-600 bg-stone-700 px-2 py-1 text-sm text-white"
        >
          <option value="">Select tag...</option>
          {availableTags.map((tag) => (
            <option key={tag.id} value={tag.label}>
              {tag.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={isNumeric ? 'number' : 'text'}
          value={String(value)}
          onChange={(e) => {
            const val = e.target.value;
            const numVal = Number(val);
            onChange({
              ...rule,
              value: isNumeric && !isNaN(numVal) && val !== '' ? numVal : val,
            });
          }}
          placeholder={placeholder}
          className="flex-1 rounded border border-stone-600 bg-stone-700 px-2 py-1 text-sm text-white"
        />
      )}

      {/* Remove Button */}
      <button
        type="button"
        onClick={onRemove}
        className="flex-shrink-0 rounded p-1 text-red-400 hover:bg-red-900/50 hover:text-red-300"
        title={intl.formatMessage(messages.removeRule)}
      >
        <TrashIcon className="h-4 w-4" />
      </button>
    </div>
  );
};

// ============================================================================
// SECTION COMPONENT (Group of Rules)
// ============================================================================

interface SectionComponentProps {
  sectionIndex: number;
  section: ConditionSection;
  onChange: (updated: ConditionSection) => void;
  onRemove: () => void;
  canRemove: boolean;
}

const SectionComponent: React.FC<SectionComponentProps> = ({
  sectionIndex,
  section,
  onChange,
  onRemove,
  canRemove,
}) => {
  const intl = useIntl();

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleAddRule = () => {
    const newRule: ConditionRule = {
      field: 'daysUntilRelease',
      operator: 'gte',
      value: 0,
    };
    onChange({
      ...section,
      rules: [...section.rules, newRule],
    });
  };

  const handleUpdateRule = (index: number, updated: ConditionRule) => {
    const newRules = [...section.rules];
    newRules[index] = updated;
    onChange({ ...section, rules: newRules });
  };

  const handleRemoveRule = (index: number) => {
    const newRules = section.rules.filter((_, i) => i !== index);
    onChange({ ...section, rules: newRules });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = section.rules.findIndex(
      (_, i) => `rule-${i}` === active.id
    );
    const newIndex = section.rules.findIndex((_, i) => `rule-${i}` === over.id);

    if (oldIndex !== -1 && newIndex !== -1) {
      onChange({
        ...section,
        rules: arrayMove(section.rules, oldIndex, newIndex),
      });
    }
  };

  return (
    <div className="mb-4 rounded border-2 border-stone-600 bg-stone-900 p-3">
      {/* Section Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="text-sm font-semibold text-orange-400">
            {intl.formatMessage(messages.section)} {sectionIndex + 1}
          </span>
          <span className="text-xs text-stone-400">
            ({section.rules.length}{' '}
            {section.rules.length === 1 ? 'rule' : 'rules'})
          </span>
        </div>

        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="flex items-center space-x-1 rounded px-2 py-1 text-xs text-red-400 hover:bg-red-900/50 hover:text-red-300"
            title={intl.formatMessage(messages.removeSection)}
          >
            <TrashIcon className="h-4 w-4" />
            <span>{intl.formatMessage(messages.removeSection)}</span>
          </button>
        )}
      </div>

      {/* Rules */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={section.rules.map((_, i) => `rule-${i}`)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-1">
            {section.rules.map((rule, index) => (
              <div key={`rule-container-${index}`}>
                <RuleItem
                  id={`rule-${index}`}
                  rule={rule}
                  onChange={(updated) => handleUpdateRule(index, updated)}
                  onRemove={() => handleRemoveRule(index)}
                />

                {/* Operator BETWEEN rules (smaller, left-aligned) */}
                {index < section.rules.length - 1 && (
                  <div className="my-1.5 pl-7">
                    <select
                      value={section.rules[index + 1].ruleOperator || 'and'}
                      onChange={(e) => {
                        const nextRule = section.rules[index + 1];
                        handleUpdateRule(index + 1, {
                          ...nextRule,
                          ruleOperator: e.target.value as 'and' | 'or',
                        });
                      }}
                      className="w-16 rounded border border-stone-600 bg-stone-700 px-2 py-0.5 text-xs font-semibold text-orange-400"
                    >
                      <option value="and">
                        {intl.formatMessage(messages.and)}
                      </option>
                      <option value="or">
                        {intl.formatMessage(messages.or)}
                      </option>
                    </select>
                  </div>
                )}
              </div>
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {/* Add Rule Button */}
      <div className="mt-3">
        <button
          type="button"
          onClick={handleAddRule}
          className="flex items-center space-x-1 rounded border border-dashed border-stone-600 px-3 py-1.5 text-xs text-orange-400 hover:border-stone-500 hover:text-orange-300"
        >
          <PlusIcon className="h-3 w-3" />
          <span>{intl.formatMessage(messages.addRule)}</span>
        </button>
      </div>
    </div>
  );
};

// ============================================================================
// CONDITION BUILDER (Main Component)
// ============================================================================

interface ConditionBuilderProps {
  condition: ApplicationCondition | undefined;
  onChange: (condition: ApplicationCondition | undefined) => void;
}

const ConditionBuilder: React.FC<ConditionBuilderProps> = ({
  condition,
  onChange,
}) => {
  const intl = useIntl();

  const hasCondition = condition !== undefined;

  const handleToggleCondition = (enabled: boolean) => {
    if (enabled) {
      onChange({
        sections: [
          {
            rules: [
              {
                field: 'daysUntilRelease',
                operator: 'gte',
                value: 0,
              },
            ],
          },
        ],
      });
    } else {
      onChange(undefined);
    }
  };

  const handleAddSection = () => {
    if (!condition) return;

    const newSection: ConditionSection = {
      sectionOperator: 'or',
      rules: [
        {
          field: 'daysUntilRelease',
          operator: 'gte',
          value: 0,
        },
      ],
    };

    onChange({
      sections: [...condition.sections, newSection],
    });
  };

  const handleUpdateSection = (index: number, updated: ConditionSection) => {
    if (!condition) return;

    const newSections = [...condition.sections];
    newSections[index] = updated;
    onChange({ sections: newSections });
  };

  const handleRemoveSection = (index: number) => {
    if (!condition) return;

    const newSections = condition.sections.filter((_, i) => i !== index);
    if (newSections.length === 0) {
      onChange(undefined);
    } else {
      onChange({ sections: newSections });
    }
  };

  return (
    <div>
      <label className="mb-3 flex items-center space-x-2">
        <input
          type="checkbox"
          checked={hasCondition}
          onChange={(e) => handleToggleCondition(e.target.checked)}
          className="rounded border-stone-600 bg-stone-700 text-orange-600"
        />
        <span className="text-sm text-stone-300">
          {hasCondition
            ? intl.formatMessage(messages.enableCondition)
            : intl.formatMessage(messages.noCondition)}
        </span>
      </label>

      {hasCondition && condition && (
        <div>
          {/* Sections */}
          {condition.sections.map((section, index) => (
            <div key={index}>
              <SectionComponent
                sectionIndex={index}
                section={section}
                onChange={(updated) => handleUpdateSection(index, updated)}
                onRemove={() => handleRemoveSection(index)}
                canRemove={condition.sections.length > 1}
              />

              {/* Operator BETWEEN sections (centered, larger) */}
              {index < condition.sections.length - 1 && (
                <div className="my-3 flex justify-center">
                  <select
                    value={
                      condition.sections[index + 1].sectionOperator || 'or'
                    }
                    onChange={(e) => {
                      const nextSection = condition.sections[index + 1];
                      handleUpdateSection(index + 1, {
                        ...nextSection,
                        sectionOperator: e.target.value as 'and' | 'or',
                      });
                    }}
                    className="rounded border border-stone-600 bg-stone-800 px-3 py-1.5 text-sm font-semibold text-orange-400"
                  >
                    <option value="and">
                      {intl.formatMessage(messages.and)}
                    </option>
                    <option value="or">
                      {intl.formatMessage(messages.or)}
                    </option>
                  </select>
                </div>
              )}
            </div>
          ))}

          {/* Add Section Button */}
          <div className="mt-3">
            <button
              type="button"
              onClick={handleAddSection}
              className="flex items-center space-x-1 rounded border border-dashed border-stone-600 px-3 py-1.5 text-xs text-orange-400 hover:border-stone-500 hover:text-orange-300"
            >
              <PlusIcon className="h-3 w-3" />
              <span>{intl.formatMessage(messages.addSection)}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// CONDITION EDITOR MODAL (Main Export)
// ============================================================================

interface ConditionEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialCondition: ApplicationCondition | undefined;
  onSave: (condition: ApplicationCondition | undefined) => void;
}

export const ConditionEditorModal: React.FC<ConditionEditorModalProps> = ({
  isOpen,
  onClose,
  initialCondition,
  onSave,
}) => {
  const intl = useIntl();
  const [condition, setCondition] = useState<ApplicationCondition | undefined>(
    initialCondition
  );

  useEffect(() => {
    if (isOpen) {
      setCondition(initialCondition);
    }
  }, [isOpen, initialCondition]);

  const handleSave = () => {
    onSave(condition);
    onClose();
  };

  const handleCancel = () => {
    setCondition(initialCondition);
    onClose();
  };

  return (
    <Modal
      title={intl.formatMessage(messages.title)}
      onCancel={handleCancel}
      onOk={handleSave}
      okText={intl.formatMessage(messages.save)}
      cancelText={intl.formatMessage(messages.cancel)}
      backgroundClickable={false}
      customMaxWidth="sm:max-w-4xl"
    >
      <div className="space-y-4">
        <p className="text-sm text-stone-400">
          {intl.formatMessage(messages.description)}
        </p>

        <div className="max-h-[600px] overflow-y-auto rounded border border-stone-700 bg-stone-900 p-4">
          <ConditionBuilder condition={condition} onChange={setCondition} />
        </div>
      </div>
    </Modal>
  );
};

export default ConditionEditorModal;
