import IncludeExcludeToggle from '@app/components/Common/IncludeExcludeToggle';
import axios from 'axios';
import { useCallback, useEffect, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import type { MultiValue } from 'react-select';
import AsyncSelect from 'react-select/async';

const messages = defineMessages({
  keywordFilterLabel: 'Keyword Filter',
  keywordFilterHelp:
    'EXCLUDE mode: Skip items with ANY selected keyword. INCLUDE mode: Only grab items with ANY selected keyword.',
  searchKeywords: 'Search TMDB keywords...',
  deselectAll: 'Deselect All',
});

interface KeywordOption {
  value: number;
  label: string;
}

interface KeywordFilterWithModeProps {
  mode: 'exclude' | 'include';
  selectedValues: number[];
  onModeChange: (mode: 'exclude' | 'include') => void;
  onValuesChange: (values: number[]) => void;
  disabled?: boolean;
}

const KeywordFilterWithMode = ({
  mode,
  selectedValues,
  onModeChange,
  onValuesChange,
  disabled = false,
}: KeywordFilterWithModeProps) => {
  const intl = useIntl();
  const [resolvedOptions, setResolvedOptions] = useState<KeywordOption[]>([]);

  // Resolve saved keyword IDs to names on mount or when selectedValues change
  useEffect(() => {
    const resolveKeywords = async () => {
      if (selectedValues.length === 0) {
        setResolvedOptions([]);
        return;
      }

      // Only resolve IDs we don't already have
      const unresolvedIds = selectedValues.filter(
        (id) => !resolvedOptions.some((opt) => opt.value === id)
      );

      if (unresolvedIds.length === 0) {
        // Filter out any options that are no longer selected
        setResolvedOptions((prev) =>
          prev.filter((opt) => selectedValues.includes(opt.value))
        );
        return;
      }

      try {
        const response = await axios.get<{ id: number; name: string }[]>(
          `/api/v1/keywords/batch?ids=${unresolvedIds.join(',')}`
        );
        const newOptions = response.data.map((k) => ({
          value: k.id,
          label: k.name,
        }));

        setResolvedOptions((prev) => {
          const existing = prev.filter((opt) =>
            selectedValues.includes(opt.value)
          );
          const merged = [...existing, ...newOptions];
          // Deduplicate
          const seen = new Set<number>();
          return merged.filter((opt) => {
            if (seen.has(opt.value)) return false;
            seen.add(opt.value);
            return true;
          });
        });
      } catch {
        // Keep existing resolved options on error
      }
    };

    resolveKeywords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedValues]);

  const loadOptions = useCallback(
    async (inputValue: string): Promise<KeywordOption[]> => {
      if (!inputValue || inputValue.trim().length < 2) {
        return [];
      }

      try {
        const response = await axios.get<{ id: number; name: string }[]>(
          `/api/v1/keywords/search`,
          { params: { query: inputValue.trim() } }
        );
        return response.data.map((k) => ({
          value: k.id,
          label: k.name,
        }));
      } catch {
        return [];
      }
    },
    []
  );

  const handleChange = (newSelectedOptions: MultiValue<KeywordOption>) => {
    const values = newSelectedOptions
      ? newSelectedOptions.map((option) => option.value)
      : [];
    onValuesChange(values);
  };

  const handleDeselectAll = () => {
    onValuesChange([]);
  };

  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center justify-between">
        <label className="text-sm text-gray-300">
          {intl.formatMessage(messages.keywordFilterLabel)}
        </label>

        <IncludeExcludeToggle
          mode={mode}
          onModeChange={onModeChange}
          disabled={disabled}
        />
      </div>

      {/* Deselect All button */}
      <div className="mb-2 flex gap-2">
        <button
          type="button"
          onClick={handleDeselectAll}
          disabled={disabled || selectedValues.length === 0}
          className="text-xs text-gray-400 hover:text-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {intl.formatMessage(messages.deselectAll)}
        </button>
      </div>

      <AsyncSelect<KeywordOption, true>
        isMulti
        cacheOptions
        loadOptions={loadOptions}
        value={resolvedOptions.filter((opt) =>
          selectedValues.includes(opt.value)
        )}
        onChange={handleChange}
        isDisabled={disabled}
        placeholder={intl.formatMessage(messages.searchKeywords)}
        noOptionsMessage={({ inputValue }) =>
          inputValue && inputValue.length >= 2
            ? 'No keywords found'
            : 'Type at least 2 characters to search...'
        }
        menuPlacement="auto"
        className="react-select-container"
        classNamePrefix="react-select"
        closeMenuOnSelect={false}
        hideSelectedOptions={false}
      />
      <p className="mt-2 text-xs text-gray-400">
        {intl.formatMessage(messages.keywordFilterHelp)}
      </p>
    </div>
  );
};

export default KeywordFilterWithMode;
