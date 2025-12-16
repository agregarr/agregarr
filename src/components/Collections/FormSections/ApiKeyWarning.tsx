import Alert from '@app/components/Common/Alert';
import type { ApiKeyValidationResult } from '@app/utils/apiKeyValidation';
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/20/solid';
import type React from 'react';
import { defineMessages, useIntl } from 'react-intl';

const messages = defineMessages({
  apiKeyWarning: '{services} required.',
  configureSettings: 'Configure Settings',
});

interface ApiKeyWarningProps {
  validation: ApiKeyValidationResult;
  className?: string;
}

const ApiKeyWarning: React.FC<ApiKeyWarningProps> = ({
  validation,
  className = '',
}) => {
  const intl = useIntl();

  // Don't show warning if all required keys are present
  if (validation.hasRequiredKeys) {
    return null;
  }

  const servicesText = validation.missingServices.join(', ');

  // Determine settings path - use the first requirement's path
  const settingsPath = validation.requirements.find(
    (req) => !req.configured && req.required
  )?.settingsPath;

  const settingsUrl = settingsPath || '/settings';

  return (
    <div className={`mt-2 ${className}`}>
      <Alert
        title={intl.formatMessage(messages.apiKeyWarning, {
          services: servicesText,
        })}
        type="warning"
      >
        <div className="mt-3">
          <a
            href={settingsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-md bg-orange-600 px-3 py-2 text-sm font-medium text-white hover:bg-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 focus:ring-offset-orange-900"
          >
            {intl.formatMessage(messages.configureSettings)}
            <ArrowTopRightOnSquareIcon className="h-4 w-4" />
          </a>
        </div>
      </Alert>
    </div>
  );
};

export default ApiKeyWarning;
