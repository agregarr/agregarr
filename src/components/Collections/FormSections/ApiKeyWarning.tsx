import Alert from '@app/components/Common/Alert';
import type { ApiKeyValidationResult } from '@app/utils/apiKeyValidation';
import type React from 'react';
import { defineMessages, useIntl } from 'react-intl';

const messages = defineMessages({
  apiKeyWarning: '{services} required. Configure in {settingsPath}.',
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

  // Convert path to user-friendly text
  const settingsPathText = settingsPath?.includes('/downloads')
    ? 'Settings > Downloads'
    : 'Settings > Sources';

  return (
    <div className={`mt-2 ${className}`}>
      <Alert
        title={intl.formatMessage(messages.apiKeyWarning, {
          services: servicesText,
          settingsPath: settingsPathText,
        })}
        type="warning"
      />
    </div>
  );
};

export default ApiKeyWarning;
