import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Modal from '@app/components/Common/Modal';
import { IconSelector } from '@app/components/PosterEditor/IconSelector';
import { Transition } from '@headlessui/react';
import {
  ArrowPathIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import type React from 'react';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { useToasts } from 'react-toast-notifications';
import type { IconMapping } from './types';

const messages = defineMessages({
  editMappings: 'Edit Icon Mappings',
  fieldLabel: 'Mappings for "{field}"',
  value: 'Value',
  icon: 'Icon',
  actions: 'Actions',
  addMapping: 'Add Mapping',
  save: 'Save',
  cancel: 'Cancel',
  noMappings: 'No mappings configured',
  noMappingsDesc: 'Add mappings to display icons for specific field values',
  valuePlaceholder: 'e.g., US, GB, DE...',
  selectIcon: 'Select icon',
  mappingCount: '{count} mapping(s) configured',
  duplicateValue: 'This value already has a mapping',
  loadingMappings: 'Loading mappings...',
  resetToDefaults: 'Reset to Defaults',
  usingDefaults: 'Using system defaults',
  usingCustom: 'Using custom mappings',
  resetConfirm: 'Reset mappings to system defaults?',
  failedToLoad: 'Failed to load mappings',
  failedToSave: 'Failed to save mappings',
  savedSuccessfully: 'Mappings saved successfully',
});

interface MappingsResponse {
  field: string;
  mappings: IconMapping[];
  hasDefaults: boolean;
  hasCustomMappings: boolean;
  isUsingDefaults: boolean;
}

interface MappedIconMappingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (mappings: IconMapping[]) => void;
  mappings: IconMapping[];
  fieldName: string;
}

const MappedIconMappingModal: React.FC<MappedIconMappingModalProps> = ({
  isOpen,
  onClose,
  onSave,
  mappings,
  fieldName,
}) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const [localMappings, setLocalMappings] = useState<IconMapping[]>(mappings);
  const [duplicateIndex, setDuplicateIndex] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasDefaults, setHasDefaults] = useState(false);
  const [isUsingDefaults, setIsUsingDefaults] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Fetch mappings from API when modal opens
  const fetchMappings = useCallback(async () => {
    if (!fieldName) return;

    setIsLoading(true);
    try {
      const response = await fetch(`/api/v1/overlay-mappings/${fieldName}`);
      if (response.ok) {
        const data: MappingsResponse = await response.json();
        setLocalMappings(data.mappings);
        setHasDefaults(data.hasDefaults);
        setIsUsingDefaults(data.isUsingDefaults);
      } else {
        // Fallback to passed mappings
        setLocalMappings(mappings);
      }
    } catch (error) {
      // Fallback to passed mappings
      setLocalMappings(mappings);
    } finally {
      setIsLoading(false);
    }
  }, [fieldName, mappings]);

  // Reset local state and fetch when modal opens
  useEffect(() => {
    if (isOpen) {
      setDuplicateIndex(null);
      fetchMappings();
    }
  }, [isOpen, fetchMappings]);

  const handleAddMapping = () => {
    setLocalMappings([...localMappings, { value: '', iconPath: '' }]);
    setIsUsingDefaults(false);
  };

  const handleRemoveMapping = (index: number) => {
    setLocalMappings(localMappings.filter((_, i) => i !== index));
    if (duplicateIndex === index) {
      setDuplicateIndex(null);
    }
    setIsUsingDefaults(false);
  };

  const handleUpdateMapping = (
    index: number,
    updates: Partial<IconMapping>
  ) => {
    const newMappings = [...localMappings];
    newMappings[index] = { ...newMappings[index], ...updates };
    setLocalMappings(newMappings);
    setIsUsingDefaults(false);

    // Check for duplicates when value changes
    if (updates.value !== undefined) {
      const normalizedValue = updates.value.toLowerCase().trim();
      const hasDuplicate = newMappings.some(
        (m, i) =>
          i !== index && m.value.toLowerCase().trim() === normalizedValue
      );
      setDuplicateIndex(hasDuplicate ? index : null);
    }
  };

  const handleSave = async () => {
    // Filter out empty mappings
    const validMappings = localMappings.filter(
      (m) => m.value.trim() && m.iconPath
    );

    setIsSaving(true);
    try {
      // Save to API for persistence
      const response = await fetch(`/api/v1/overlay-mappings/${fieldName}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mappings: validMappings }),
      });

      if (!response.ok) {
        throw new Error('Failed to save mappings');
      }

      // Call parent onSave to update the element
      onSave(validMappings);
      onClose();

      addToast(intl.formatMessage(messages.savedSuccessfully), {
        appearance: 'success',
        autoDismiss: true,
      });
    } catch (error) {
      addToast(intl.formatMessage(messages.failedToSave), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetToDefaults = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/v1/overlay-mappings/${fieldName}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        const data: MappingsResponse = await response.json();
        setLocalMappings(data.mappings);
        setIsUsingDefaults(true);
      }
    } catch (error) {
      addToast(intl.formatMessage(messages.failedToLoad), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    onClose();
  };

  return (
    <Transition
      as={Fragment}
      appear
      show={isOpen}
      enter="transition-opacity duration-300"
      enterFrom="opacity-0"
      enterTo="opacity-100"
      leave="transition-opacity duration-300"
      leaveFrom="opacity-100"
      leaveTo="opacity-0"
    >
      <Modal
        onCancel={handleCancel}
        onOk={handleSave}
        title={intl.formatMessage(messages.editMappings)}
        cancelText={intl.formatMessage(messages.cancel)}
        okText={intl.formatMessage(messages.save)}
        okDisabled={duplicateIndex !== null || isSaving}
      >
        <div className="space-y-4">
          {/* Field name header with status */}
          <div className="flex items-center justify-between rounded bg-stone-800 px-3 py-2">
            <p className="text-sm text-stone-300">
              {intl.formatMessage(messages.fieldLabel, { field: fieldName })}
            </p>
            {hasDefaults && (
              <span
                className={`text-xs ${
                  isUsingDefaults ? 'text-green-400' : 'text-orange-400'
                }`}
              >
                {isUsingDefaults
                  ? intl.formatMessage(messages.usingDefaults)
                  : intl.formatMessage(messages.usingCustom)}
              </span>
            )}
          </div>

          {/* Loading state */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <LoadingSpinner />
              <span className="ml-2 text-sm text-stone-400">
                {intl.formatMessage(messages.loadingMappings)}
              </span>
            </div>
          ) : (
            <>
              {/* Mappings list */}
              {localMappings.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-sm text-stone-400">
                    {intl.formatMessage(messages.noMappings)}
                  </p>
                  <p className="mt-1 text-xs text-stone-500">
                    {intl.formatMessage(messages.noMappingsDesc)}
                  </p>
                </div>
              ) : (
                <div className="max-h-96 space-y-2 overflow-y-auto">
                  {/* Table header */}
                  <div className="sticky top-0 grid grid-cols-12 gap-3 bg-stone-900 px-2 py-1 text-xs font-medium text-stone-400">
                    <div className="col-span-5">
                      {intl.formatMessage(messages.value)}
                    </div>
                    <div className="col-span-5">
                      {intl.formatMessage(messages.icon)}
                    </div>
                    <div className="col-span-2 text-right">
                      {intl.formatMessage(messages.actions)}
                    </div>
                  </div>

                  {/* Mapping rows */}
                  {localMappings.map((mapping, index) => (
                    <div
                      key={index}
                      className={`grid grid-cols-12 items-center gap-3 rounded-lg border p-2 ${
                        duplicateIndex === index
                          ? 'border-red-500 bg-red-900/20'
                          : 'border-stone-700 bg-stone-800'
                      }`}
                    >
                      <div className="col-span-5">
                        <input
                          type="text"
                          value={mapping.value}
                          onChange={(e) =>
                            handleUpdateMapping(index, {
                              value: e.target.value,
                            })
                          }
                          placeholder={intl.formatMessage(
                            messages.valuePlaceholder
                          )}
                          className={`w-full rounded border bg-stone-700 px-2 py-1.5 text-sm text-white placeholder-stone-500 focus:outline-none focus:ring-1 ${
                            duplicateIndex === index
                              ? 'border-red-500 focus:ring-red-500'
                              : 'border-stone-600 focus:ring-orange-500'
                          }`}
                        />
                        {duplicateIndex === index && (
                          <p className="mt-1 text-xs text-red-400">
                            {intl.formatMessage(messages.duplicateValue)}
                          </p>
                        )}
                      </div>
                      <div className="col-span-5 space-y-2">
                        {/* Icon preview */}
                        <div className="flex h-12 w-12 items-center justify-center rounded border border-stone-600 bg-stone-700">
                          {mapping.iconPath ? (
                            <img
                              src={mapping.iconPath}
                              alt={mapping.value}
                              className="h-10 w-10 object-contain"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display =
                                  'none';
                              }}
                            />
                          ) : (
                            <span className="text-xs text-stone-500">—</span>
                          )}
                        </div>
                        {/* Icon selector dropdown */}
                        <IconSelector
                          value={mapping.iconPath}
                          onChange={(iconPath) =>
                            handleUpdateMapping(index, { iconPath })
                          }
                          filter="all"
                          addToast={addToast}
                        />
                      </div>
                      <div className="col-span-2 flex justify-end">
                        <button
                          type="button"
                          onClick={() => handleRemoveMapping(index)}
                          className="rounded p-1.5 text-red-400 hover:bg-red-900/50 focus:outline-none focus:ring-2 focus:ring-red-500"
                          title="Remove mapping"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex items-center justify-between">
                <Button
                  buttonType="ghost"
                  buttonSize="sm"
                  onClick={handleAddMapping}
                >
                  <PlusIcon className="mr-2 h-4 w-4" />
                  {intl.formatMessage(messages.addMapping)}
                </Button>

                {hasDefaults && !isUsingDefaults && (
                  <Button
                    buttonType="ghost"
                    buttonSize="sm"
                    onClick={handleResetToDefaults}
                  >
                    <ArrowPathIcon className="mr-2 h-4 w-4" />
                    {intl.formatMessage(messages.resetToDefaults)}
                  </Button>
                )}
              </div>

              {/* Mapping count */}
              {localMappings.length > 0 && (
                <p className="text-center text-xs text-stone-500">
                  {intl.formatMessage(messages.mappingCount, {
                    count: localMappings.filter(
                      (m) => m.value.trim() && m.iconPath
                    ).length,
                  })}
                </p>
              )}
            </>
          )}
        </div>
      </Modal>
    </Transition>
  );
};

export default MappedIconMappingModal;
