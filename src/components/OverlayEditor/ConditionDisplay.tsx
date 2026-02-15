import type { ApplicationCondition } from '@server/entity/OverlayTemplate';
import { defineMessages, useIntl } from 'react-intl';
import useSWR from 'swr';
import { CONDITION_FIELD_CATEGORIES } from './types';

const messages = defineMessages({
  alwaysApply: 'Always apply (no condition)',
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
  regex: 'regex',
  begins: 'begins',
  ends: 'ends',
};

// Get field label from CONDITION_FIELD_CATEGORIES
const getFieldLabel = (field: string): string => {
  const allFields = Object.values(CONDITION_FIELD_CATEGORIES).flat();
  return allFields.find((v) => v.field === field)?.label || field;
};

// Resolve collection ID to display name
const useCollectionName = (
  condition: ApplicationCondition | undefined
): Map<string, string> => {
  // Check if any rules reference the 'collection' field
  const hasCollectionRules = condition?.sections?.some((s) =>
    s.rules.some((r) => r.field === 'collection')
  );

  const { data: agregarrCollections } = useSWR<{
    collectionConfigs: { id: string; name: string }[];
  }>(hasCollectionRules ? '/api/v1/collections' : null, (url) =>
    fetch(url).then((res) => res.json())
  );

  const { data: preExistingCollections } = useSWR<
    { id: string; name: string }[]
  >(hasCollectionRules ? '/api/v1/preexisting' : null, (url) =>
    fetch(url).then((res) => res.json())
  );

  const nameMap = new Map<string, string>();
  if (agregarrCollections?.collectionConfigs) {
    for (const c of agregarrCollections.collectionConfigs) {
      nameMap.set(c.id, c.name);
    }
  }
  if (Array.isArray(preExistingCollections)) {
    for (const c of preExistingCollections) {
      nameMap.set(c.id, c.name);
    }
  }
  return nameMap;
};

interface ConditionDisplayProps {
  condition: ApplicationCondition | undefined;
}

/**
 * Display overlay application condition in human-readable format
 * Uses the new flat section/rule structure for clarity
 */
export const ConditionDisplay: React.FC<ConditionDisplayProps> = ({
  condition,
}) => {
  const intl = useIntl();
  const collectionNames = useCollectionName(condition);

  if (!condition || !condition.sections || condition.sections.length === 0) {
    return (
      <div className="rounded bg-stone-800 px-2 py-1 text-xs italic text-stone-500">
        {intl.formatMessage(messages.alwaysApply)}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {condition.sections.map((section, sectionIndex) => (
        <div key={sectionIndex}>
          {/* Section operator (AND/OR between sections) - BLUE to differentiate from rule operators */}
          {sectionIndex > 0 && (
            <div className="my-1 text-center">
              <span className="rounded bg-blue-900/50 px-2 py-0.5 text-xs font-semibold text-blue-300">
                {section.sectionOperator?.toUpperCase() || 'OR'}
              </span>
            </div>
          )}

          {/* Section box */}
          <div className="rounded border border-stone-700 bg-stone-900 p-2">
            <div className="flex flex-wrap items-center gap-1">
              {section.rules.map((rule, ruleIndex) => (
                <div key={ruleIndex} className="flex items-center gap-1">
                  {/* Rule operator (AND/OR between rules) - ORANGE */}
                  {ruleIndex > 0 && (
                    <span className="rounded bg-orange-900/50 px-1.5 py-0.5 text-xs font-semibold text-orange-300">
                      {rule.ruleOperator?.toUpperCase() || 'AND'}
                    </span>
                  )}

                  {/* Rule display: field operator value */}
                  <span className="rounded bg-stone-800 px-2 py-0.5 text-xs text-stone-300">
                    <span className="font-medium text-orange-400">
                      {getFieldLabel(rule.field)}
                    </span>
                    <span className="mx-1 text-orange-400">
                      {OPERATOR_LABELS[rule.operator] || rule.operator}
                    </span>
                    <span className="font-mono text-white">
                      {rule.field === 'collection'
                        ? collectionNames.get(String(rule.value)) ||
                          String(rule.value)
                        : Array.isArray(rule.value)
                        ? `[${rule.value.join(', ')}]`
                        : typeof rule.value === 'boolean'
                        ? rule.value
                          ? 'true'
                          : 'false'
                        : String(rule.value)}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default ConditionDisplay;
