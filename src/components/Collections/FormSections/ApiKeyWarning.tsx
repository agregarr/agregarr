import Alert from '@app/components/Common/Alert';
import type { ApiKeyValidationResult } from '@app/utils/apiKeyValidation';
import type React from 'react';
import { defineMessages, useIntl } from 'react-intl';

const messages = defineMessages({
  apiKeyWarning:
    '{services} API key required. Configure in Settings > Sources.',
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

  return (
    <div className={`mt-2 ${className}`}>
      <Alert
        title={intl.formatMessage(messages.apiKeyWarning, {
          services: servicesText,
        })}
        type="warning"
      />
    </div>
  );
};

export default ApiKeyWarning;
