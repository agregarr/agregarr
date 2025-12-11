import type { CollectionFormConfig } from '@app/types/collections';
import { Field } from 'formik';
import React from 'react';
import { defineMessages, useIntl } from 'react-intl';

type VisibilityConfig = {
  usersHome: boolean;
  serverOwnerHome: boolean;
  libraryRecommended: boolean;
};

const messages = defineMessages({
  visibility: 'Visibility',
  visibilityDescription: 'Control where this collection appears in Plex',
  usersHome: 'Users Home',
  usersHomeDescription: 'Show on user home screens',
  serverOwnerHome: 'Server Owner Home',
  serverOwnerHomeDescription: 'Show on server owner home screen',
  libraryRecommended: 'Library Recommended',
  libraryRecommendedDescription: 'Show in library recommended section',
});

interface VisibilitySectionProps {
  values: CollectionFormConfig;
  setFieldValue: (field: string, value: VisibilityConfig | boolean) => void;
  isEnhancedForm?: boolean;
  isDefaultPlexHub?: boolean;
  fieldPrefix?: string;
  titleKey?: string;
  descriptionKey?: string;
  restrictToLibraryOnly?: boolean;
  restrictToServerOwnerOnly?: boolean;
}

const VisibilitySection = ({
  values,
  setFieldValue,
  isDefaultPlexHub = false,
  fieldPrefix = 'visibilityConfig',
  restrictToLibraryOnly = false,
  restrictToServerOwnerOnly = false,
}: VisibilitySectionProps) => {
  const intl = useIntl();

  // Get current visibility config
  const getNestedValue = (
    obj: CollectionFormConfig,
    path: string
  ): VisibilityConfig | undefined => {
    if (path === 'visibilityConfig') return obj.visibilityConfig;
    if (path === 'timeRestriction.inactiveVisibilityConfig') {
      return obj.timeRestriction?.inactiveVisibilityConfig;
    }
    return undefined;
  };

  const visibilityConfig = getNestedValue(values, fieldPrefix);

  // Auto-handle restrictToLibraryOnly case
  React.useEffect(() => {
    if (restrictToLibraryOnly) {
      setFieldValue(`${fieldPrefix}.usersHome`, false);
      setFieldValue(`${fieldPrefix}.serverOwnerHome`, false);
      setFieldValue(`${fieldPrefix}.libraryRecommended`, false);
    }
  }, [restrictToLibraryOnly, fieldPrefix, setFieldValue]);

  // Auto-handle restrictToServerOwnerOnly case
  React.useEffect(() => {
    if (restrictToServerOwnerOnly) {
      setFieldValue(`${fieldPrefix}.usersHome`, false);
      setFieldValue(`${fieldPrefix}.libraryRecommended`, false);
      // Don't touch serverOwnerHome - let user control this one
    }
  }, [restrictToServerOwnerOnly, fieldPrefix, setFieldValue]);

  return (
    <div className="space-y-2">
      {/* Show restriction notice for collections restricted to library only */}
      {restrictToLibraryOnly && (
        <div className="mb-3 rounded border border-orange-500/20 bg-orange-500/10 p-3 text-sm text-orange-300">
          Individual user request collections are restricted to Library Tab Only
          visibility due a Plex bug that doesn&apos;t respect label restrictions
          on the Home/Recommended screens. TMDB Franchise Collections and Plex
          Library Auto Director Collections are hidden so that you don&apos;t
          clog up your home/recommended screens.
        </div>
      )}

      {/* Show restriction notice for overseerr server owner collections */}
      {restrictToServerOwnerOnly && (
        <div className="mb-3 rounded border border-green-500/20 bg-green-500/10 p-3 text-sm text-green-300">
          Server owner request collections can only appear on the server
          owner&apos;s home screen.
        </div>
      )}

      {!restrictToLibraryOnly && !restrictToServerOwnerOnly && (
        <>
          {/* Users Home */}
          <div className="flex items-center">
            <Field
              type="checkbox"
              id={`${fieldPrefix}-usersHome`}
              name={`${fieldPrefix}.usersHome`}
              className="form-checkbox"
            />
            <label
              htmlFor={`${fieldPrefix}-usersHome`}
              className="ml-2 text-sm text-gray-300"
            >
              {intl.formatMessage(messages.usersHome)}
            </label>
          </div>

          {/* Server Owner Home */}
          <div className="flex items-center">
            <Field
              type="checkbox"
              id={`${fieldPrefix}-serverOwnerHome`}
              name={`${fieldPrefix}.serverOwnerHome`}
              className="form-checkbox"
            />
            <label
              htmlFor={`${fieldPrefix}-serverOwnerHome`}
              className="ml-2 text-sm text-gray-300"
            >
              {intl.formatMessage(messages.serverOwnerHome)}
            </label>
          </div>

          {/* Library Recommended */}
          <div className="flex items-center">
            <Field
              type="checkbox"
              id={`${fieldPrefix}-libraryRecommended`}
              name={`${fieldPrefix}.libraryRecommended`}
              className="form-checkbox"
            />
            <label
              htmlFor={`${fieldPrefix}-libraryRecommended`}
              className="ml-2 text-sm text-gray-300"
            >
              {intl.formatMessage(messages.libraryRecommended)}
            </label>
          </div>
        </>
      )}

      {/* For server owner restrictions, show only Server Owner Home option */}
      {restrictToServerOwnerOnly && (
        <div className="flex items-center">
          <Field
            type="checkbox"
            id={`${fieldPrefix}-serverOwnerHome`}
            name={`${fieldPrefix}.serverOwnerHome`}
            className="form-checkbox"
          />
          <label
            htmlFor={`${fieldPrefix}-serverOwnerHome`}
            className="ml-2 text-sm text-gray-300"
          >
            {intl.formatMessage(messages.serverOwnerHome)}
          </label>
        </div>
      )}

      {/* Warning when no visibility options are selected */}
      {!visibilityConfig?.usersHome &&
        !visibilityConfig?.serverOwnerHome &&
        !visibilityConfig?.libraryRecommended && (
          <div className="mt-3 rounded border border-orange-500/20 bg-orange-500/10 p-2 text-xs text-orange-300">
            {isDefaultPlexHub ? (
              <>
                ⚠️ No visibility options selected. Hub will be completely
                hidden.
              </>
            ) : (
              <>
                ⚠️ No visibility options selected. Collection will only appear
                in library tab.
              </>
            )}
          </div>
        )}
    </div>
  );
};

export default VisibilitySection;
