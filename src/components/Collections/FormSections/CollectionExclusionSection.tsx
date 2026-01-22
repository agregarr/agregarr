import type { CollectionFormConfig } from '@app/types/collections';
import type React from 'react';
import { useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import Select, { type MultiValue } from 'react-select';

const messages = defineMessages({
  exclusionTitle: 'Collection Mutual Exclusion',
  exclusionDescription:
    'Automatically exclude items that exist in other collections. Items from selected collections will be removed from this collection during sync. Note: Exclusions only apply if the excluded collection is active in Plex.',
  enableExclusion: 'Enable collection exclusion',
  selectCollections: 'Select collections to exclude items from',
  collectionPlaceholder: 'Select collections...',
  collectionsSelected:
    '{count, plural, one {# collection selected for exclusion} other {# collections selected for exclusion}}',
});

interface CollectionExclusionSectionProps {
  values: CollectionFormConfig;
  setFieldValue: (field: string, value: unknown) => void;
  allCollectionConfigs: CollectionFormConfig[];
}

const CollectionExclusionSection: React.FC<CollectionExclusionSectionProps> = ({
  values,
  setFieldValue,
  allCollectionConfigs,
}) => {
  const intl = useIntl();

  // Special collection types that should not be available for exclusion
  // These types create multiple collections or have special behavior
  const isSpecialCollectionType = (config: CollectionFormConfig): boolean => {
    // Overseerr individual user collections (creates one per user)
    if (config.type === 'overseerr' && config.subtype === 'users') {
      return true;
    }
    // TMDB auto franchise collections (creates one per franchise)
    if (config.type === 'tmdb' && config.subtype === 'auto_franchise') {
      return true;
    }
    return false;
  };

  // Get all library IDs this collection is configured for
  // For linked collections, this could be multiple libraries
  const currentLibraryIds =
    values.libraryIds || (values.libraryId ? [values.libraryId] : []);

  // Filter out the current collection, special types, and get collections from the same libraries
  const availableCollections = allCollectionConfigs.filter(
    (config) =>
      config.id !== values.id && // Don't allow excluding from itself
      currentLibraryIds.includes(config.libraryId) && // Show collections from any of the selected libraries
      !isSpecialCollectionType(config) // Exclude special collection types
  );

  const selectedExclusions = values.excludeFromCollections || [];

  // Track enabled state independently from selections
  // Enabled if there are selections OR if user has toggled it on
  const [isManuallyEnabled, setIsManuallyEnabled] = useState(
    selectedExclusions.length > 0
  );
  const isEnabled = isManuallyEnabled || selectedExclusions.length > 0;

  // Don't show section if this is a special collection type
  if (isSpecialCollectionType(values)) {
    return null;
  }

  // Hide for Plex person collections (actors/directors) to avoid exclusions
  if (
    values.type === 'plex' &&
    (values.subtype === 'actors' || values.subtype === 'directors')
  ) {
    return null;
  }

  // Don't show section if there are no available collections to exclude from
  if (availableCollections.length === 0) {
    return null;
  }

  // Prepare options for react-select
  const options = availableCollections.map((collection) => ({
    value: collection.id,
    label: `${collection.name} - ${collection.libraryName}`,
  }));

  const selectedOptions = options.filter((option) =>
    selectedExclusions.includes(option.value)
  );

  const handleToggleEnabled = () => {
    if (isEnabled) {
      // Disable - clear all exclusions and manually disabled state
      setFieldValue('excludeFromCollections', []);
      setIsManuallyEnabled(false);
    } else {
      // Enable - set manually enabled state
      setIsManuallyEnabled(true);
    }
  };

  const handleSelectionChange = (
    newSelectedOptions: MultiValue<{ value: string; label: string }>
  ) => {
    const values = newSelectedOptions
      ? newSelectedOptions.map((option) => option.value)
      : [];
    setFieldValue('excludeFromCollections', values);
  };

  return (
    <div className="form-row">
      <label htmlFor="excludeFromCollections" className="text-label">
        {intl.formatMessage(messages.exclusionTitle)}
      </label>
      <div className="form-input-area">
        <div className="mb-4 text-sm text-gray-400">
          {intl.formatMessage(messages.exclusionDescription)}
        </div>

        {/* Enable/Disable Toggle */}
        <div className="mb-4">
          <label className="inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              checked={isEnabled}
              onChange={handleToggleEnabled}
              className="form-checkbox"
            />
            <span className="ml-2 text-sm text-white">
              {intl.formatMessage(messages.enableExclusion)}
            </span>
          </label>
        </div>

        {/* Multi-select dropdown - only show when enabled */}
        {isEnabled && (
          <div>
            <label className="mb-2 block text-sm text-gray-300">
              {intl.formatMessage(messages.selectCollections)}
            </label>
            <Select
              isMulti
              options={options}
              value={selectedOptions}
              onChange={handleSelectionChange}
              placeholder={intl.formatMessage(messages.collectionPlaceholder)}
              menuPlacement="auto"
              className="react-select-container"
              classNamePrefix="react-select"
              closeMenuOnSelect={false}
              hideSelectedOptions={false}
            />
            {selectedExclusions.length > 0 && (
              <div className="mt-2 text-xs text-gray-400">
                {intl.formatMessage(messages.collectionsSelected, {
                  count: selectedExclusions.length,
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default CollectionExclusionSection;
