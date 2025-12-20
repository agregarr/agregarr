import AppDataWarning from '@app/components/AppDataWarning';
import Button from '@app/components/Common/Button';
import PageTitle from '@app/components/Common/PageTitle';
import LanguagePicker from '@app/components/Layout/LanguagePicker';
import SettingsDownloads from '@app/components/Settings/SettingsDownloads';
import SettingsPlex from '@app/components/Settings/SettingsPlex';
import SettingsSources from '@app/components/Settings/SettingsSources';
import LoginWithPlex from '@app/components/Setup/LoginWithPlex';
import SetupSteps from '@app/components/Setup/SetupSteps';
import useLocale from '@app/hooks/useLocale';
import axios from 'axios';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { mutate } from 'swr'; // useSWR removed - not used

const messages = defineMessages({
  setup: 'Setup',
  finish: 'Finish Setup',
  finishing: 'Finishing…',
  continue: 'Continue',
  loginwithplex: 'Sign in with Plex',
  configureplex: 'Configure Plex',
  configuresources: 'Configure Sources',
  configuredownloads: 'Configure Downloads',
});

const Setup = () => {
  const intl = useIntl();
  const [isUpdating, setIsUpdating] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [plexSettingsComplete, setPlexSettingsComplete] = useState(false);
  const router = useRouter();
  const { locale } = useLocale();

  // Scroll to bottom of logo when step changes
  useEffect(() => {
    const logoElement = document.querySelector('img[alt="Logo"]');
    if (logoElement) {
      const logoBottom =
        logoElement.getBoundingClientRect().bottom + window.scrollY;
      window.scrollTo(0, logoBottom);
    } else {
      // Fallback to top if logo not found
      window.scrollTo(0, 0);
    }
  }, [currentStep]);

  const finishSetup = async () => {
    setIsUpdating(true);
    const response = await axios.post<{ initialized: boolean }>(
      '/api/v1/settings/initialize'
    );

    setIsUpdating(false);
    if (response.data.initialized) {
      await axios.post('/api/v1/settings/main', { locale });
      mutate('/api/v1/settings/public');

      router.push('/');
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col justify-center bg-stone-900 py-8">
      <PageTitle title={intl.formatMessage(messages.setup)} />
      <div className="absolute top-4 right-4 z-50">
        <LanguagePicker />
      </div>
      <div className="relative z-40 px-4 sm:mx-auto sm:w-full sm:max-w-4xl">
        <img
          src="/logo_stacked.svg"
          className="mb-8 max-w-full sm:mx-auto sm:max-w-md"
          alt="Logo"
        />
        <AppDataWarning />
        <nav className="relative z-50">
          <ul
            className="divide-y divide-gray-600 rounded-md border border-gray-600 bg-stone-800 bg-opacity-50 md:flex md:divide-y-0"
            style={{ backdropFilter: 'blur(5px)' }}
          >
            <SetupSteps
              stepNumber={1}
              description={intl.formatMessage(messages.loginwithplex)}
              active={currentStep === 1}
              completed={currentStep > 1}
            />
            <SetupSteps
              stepNumber={2}
              description={intl.formatMessage(messages.configureplex)}
              active={currentStep === 2}
              completed={currentStep > 2}
            />
            <SetupSteps
              stepNumber={3}
              description={intl.formatMessage(messages.configuresources)}
              active={currentStep === 3}
              completed={currentStep > 3}
            />
            <SetupSteps
              stepNumber={4}
              description={intl.formatMessage(messages.configuredownloads)}
              active={currentStep === 4}
              isLastStep
            />
          </ul>
        </nav>
        <div className="mt-10 w-full rounded-md border border-gray-600 bg-stone-800 bg-opacity-50 p-4 text-white">
          {currentStep === 1 && (
            <LoginWithPlex onComplete={() => setCurrentStep(2)} />
          )}
          {currentStep === 2 && (
            <div>
              <SettingsPlex onComplete={() => setPlexSettingsComplete(true)} />
              <div className="actions">
                <div className="flex justify-end">
                  <span className="ml-3 inline-flex rounded-md shadow-sm">
                    <Button
                      buttonType="primary"
                      disabled={!plexSettingsComplete}
                      onClick={() => setCurrentStep(3)}
                    >
                      {intl.formatMessage(messages.continue)}
                    </Button>
                  </span>
                </div>
              </div>
            </div>
          )}
          {currentStep === 3 && (
            <div>
              <SettingsSources
                onComplete={() => {
                  // No action needed - setup continues via manual navigation
                }}
              />
              <div className="actions">
                <div className="flex justify-end">
                  <span className="ml-3 inline-flex rounded-md shadow-sm">
                    <Button
                      buttonType="primary"
                      onClick={() => {
                        // Use setTimeout to match the async behavior of SettingsPlex completion
                        setTimeout(() => setCurrentStep(4), 0);
                      }}
                    >
                      {intl.formatMessage(messages.continue)}
                    </Button>
                  </span>
                </div>
              </div>
            </div>
          )}
          {currentStep === 4 && (
            <div>
              <SettingsDownloads
                onComplete={() => {
                  // No action needed - setup continues via manual navigation
                }}
              />
              <div className="actions">
                <div className="flex justify-end">
                  <span className="ml-3 inline-flex rounded-md shadow-sm">
                    <Button
                      buttonType="primary"
                      onClick={() => finishSetup()}
                      disabled={isUpdating}
                    >
                      {isUpdating
                        ? intl.formatMessage(messages.finishing)
                        : intl.formatMessage(messages.finish)}
                    </Button>
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Setup;
