import type { ApplicationCondition } from '@server/entity/OverlayTemplate';
import { CONDITION_FIELD_CATEGORIES } from './types';

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
  regex: 'regex',
  begins: 'begins',
  ends: 'ends',
};

// Get field label from CONDITION_FIELD_CATEGORIES
const getFieldLabel = (field: string): string => {
  const allFields = Object.values(CONDITION_FIELD_CATEGORIES).flat();
  return allFields.find((v) => v.field === field)?.label || field;
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
  if (!condition || !condition.sections || condition.sections.length === 0) {
    return (
      <div className="rounded bg-stone-800 px-2 py-1 text-xs italic text-stone-500">
        Always apply (no condition)
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {condition.sections.map((section, sectionIndex) => (
        <div key={sectionIndex}>
          {/* Section operator (AND/OR between sections) */}
          {sectionIndex > 0 && (
            <div className="my-1 text-center">
              <span className="rounded bg-stone-700 px-2 py-0.5 text-xs font-semibold text-stone-300">
                {section.sectionOperator?.toUpperCase() || 'OR'}
              </span>
            </div>
          )}

          {/* Section box */}
          <div className="rounded border border-stone-700 bg-stone-900 p-2">
            <div className="flex flex-wrap items-center gap-1">
              {section.rules.map((rule, ruleIndex) => (
                <div key={ruleIndex} className="flex items-center gap-1">
                  {/* Rule operator (AND/OR between rules) */}
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
                      {Array.isArray(rule.value)
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
