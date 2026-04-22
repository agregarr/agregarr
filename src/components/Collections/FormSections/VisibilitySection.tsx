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
  usersHome: 'Users Home',
  serverOwnerHome: 'Server Owner Home',
  libraryRecommended: 'Library Recommended',
  libraryOnlyRestricted:
    'TMDB Franchise Collections and Plex Library Auto Director/Actor Collections are restricted to Library Tab Only visibility to avoid cluttering your home/recommended screens.',
  serverOwnerOnlyRestricted:
    "Server owner request collections are restricted from Users Home. Library Recommended is available — Plex label restrictions prevent other users from seeing the server owner's collection.",
  usersOnlyRestricted:
    'Individual user request collections create one Plex collection per user. Server Owner Home is not available — each user sees only their own collection via Plex restrictions.',
  noVisibilityHubWarning:
    'No visibility options selected. Hub will be completely hidden.',
  noVisibilityCollectionWarning:
    'No visibility options selected. Collection will only appear in library tab.',
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
  restrictUsersOnly?: boolean;
}

const VisibilitySection = ({
  values,
  setFieldValue,
  isDefaultPlexHub = false,
  fieldPrefix = 'visibilityConfig',
  restrictToLibraryOnly = false,
  restrictToServerOwnerOnly = false,
  restrictUsersOnly = false,
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
      // Don't touch serverOwnerHome or libraryRecommended - label restrictions handle user visibility
    }
  }, [restrictToServerOwnerOnly, fieldPrefix, setFieldValue]);

  // Auto-handle restrictUsersOnly case — clear serverOwnerHome (not applicable for per-user collections)
  React.useEffect(() => {
    if (restrictUsersOnly) {
      setFieldValue(`${fieldPrefix}.serverOwnerHome`, false);
    }
  }, [restrictUsersOnly, fieldPrefix, setFieldValue]);

  return (
    <div className="space-y-2">
      {/* Show restriction notice for collections restricted to library only */}
      {restrictToLibraryOnly && (
        <div className="mb-3 rounded border border-orange-500/20 bg-orange-500/10 p-3 text-sm text-orange-300">
          {intl.formatMessage(messages.libraryOnlyRestricted)}
        </div>
      )}

      {/* Show restriction notice for overseerr server owner collections */}
      {restrictToServerOwnerOnly && (
        <div className="mb-3 rounded border border-green-500/20 bg-green-500/10 p-3 text-sm text-green-300">
          {intl.formatMessage(messages.serverOwnerOnlyRestricted)}
        </div>
      )}

      {/* Show restriction notice for overseerr individual user collections */}
      {restrictUsersOnly && (
        <div className="mb-3 rounded border border-blue-500/20 bg-blue-500/10 p-3 text-sm text-blue-300">
          {intl.formatMessage(messages.usersOnlyRestricted)}
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

          {/* Server Owner Home — hidden for per-user collections */}
          {!restrictUsersOnly && (
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

      {/* For server owner restrictions, show Server Owner Home and Library Recommended */}
      {restrictToServerOwnerOnly && (
        <>
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

      {/* Warning when no visibility options are selected */}
      {!visibilityConfig?.usersHome &&
        !visibilityConfig?.serverOwnerHome &&
        !visibilityConfig?.libraryRecommended && (
          <div className="mt-3 rounded border border-orange-500/20 bg-orange-500/10 p-2 text-xs text-orange-300">
            ⚠️{' '}
            {isDefaultPlexHub
              ? intl.formatMessage(messages.noVisibilityHubWarning)
              : intl.formatMessage(messages.noVisibilityCollectionWarning)}
          </div>
        )}
    </div>
  );
};

export default VisibilitySection;
