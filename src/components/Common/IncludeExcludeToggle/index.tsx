import { defineMessages, useIntl } from 'react-intl';

const messages = defineMessages({
  modeExclude: 'Exclude',
  modeInclude: 'Include',
});

interface IncludeExcludeToggleProps {
  mode: 'exclude' | 'include';
  onModeChange: (mode: 'exclude' | 'include') => void;
  disabled?: boolean;
}

const IncludeExcludeToggle = ({
  mode,
  onModeChange,
  disabled = false,
}: IncludeExcludeToggleProps) => {
  const intl = useIntl();

  return (
    <div className="flex rounded-md bg-gray-700 p-1">
      <button
        type="button"
        onClick={() => onModeChange('exclude')}
        disabled={disabled}
        className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
          mode === 'exclude'
            ? 'bg-orange-600 text-white'
            : 'text-gray-300 hover:text-white'
        } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
      >
        {intl.formatMessage(messages.modeExclude)}
      </button>
      <button
        type="button"
        onClick={() => onModeChange('include')}
        disabled={disabled}
        className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
          mode === 'include'
            ? 'bg-orange-600 text-white'
            : 'text-gray-300 hover:text-white'
        } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
      >
        {intl.formatMessage(messages.modeInclude)}
      </button>
    </div>
  );
};

export default IncludeExcludeToggle;
