import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Modal from '@app/components/Common/Modal';
import type {
  OverlayTestResult,
  PlexSearchResult,
} from '@app/types/overlayTest';
import { Transition } from '@headlessui/react';
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  MagnifyingGlassIcon,
  XCircleIcon,
} from '@heroicons/react/24/solid';
import axios from 'axios';
import { Fragment, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { useToasts } from 'react-toast-notifications';

const messages = defineMessages({
  search: 'Search',
  cancel: 'Cancel',
  testOverlay: 'Test Overlay',
  renderedPoster: 'Rendered Poster',
  library: 'Library: {name}',
  templateResults: 'Template Results',
  noConditions: 'No conditions (always applies)',
  conditionEvaluation: 'Condition Evaluation:',
  actual: '(actual: {value})',
  contextVariables: 'Context Variables ({count})',
  undefined: 'undefined',
  noPoster: 'No Poster',
  refreshPoster: 'Refresh Poster',
  refreshPosterSuccess: 'Poster refresh started for {title}',
  refreshPosterError: 'Failed to start poster refresh',
  refreshPosterConflict:
    'A sync is already running. Please wait and try again.',
});

interface TestItemModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const TestItemModal: React.FC<TestItemModalProps> = ({ isOpen, onClose }) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const [stage, setStage] = useState<'search' | 'results'>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PlexSearchResult[]>([]);
  const [selectedItem, setSelectedItem] = useState<PlexSearchResult | null>(
    null
  );
  const [testResults, setTestResults] = useState<OverlayTestResult | null>(
    null
  );
  const [isSearching, setIsSearching] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshingItems, setRefreshingItems] = useState<Set<string>>(
    new Set()
  );
  const [expandedTemplate, setExpandedTemplate] = useState<number | null>(null);

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      return;
    }

    setIsSearching(true);
    try {
      const { data } = await axios.get<{
        results: PlexSearchResult[];
        totalResults: number;
      }>('/api/v1/plex/search', {
        params: { query: searchQuery, limit: 20 },
      });
      setSearchResults(data.results);

      if (data.results.length === 0) {
        addToast('No results found', {
          appearance: 'info',
          autoDismiss: true,
        });
      }
    } catch (error) {
      addToast(
        error instanceof Error ? error.message : 'Failed to search Plex',
        {
          appearance: 'error',
          autoDismiss: true,
        }
      );
    } finally {
      setIsSearching(false);
    }
  };

  const handleTest = async () => {
    if (!selectedItem) return;

    setIsTesting(true);
    setStage('results');

    try {
      const { data } = await axios.post<OverlayTestResult>(
        '/api/v1/overlay-test',
        {
          ratingKey: selectedItem.ratingKey,
        }
      );
      setTestResults(data);
    } catch (error) {
      const errorMessage =
        axios.isAxiosError(error) && error.response?.data?.error
          ? error.response.data.error
          : error instanceof Error
          ? error.message
          : 'Failed to test overlay';

      addToast(errorMessage, {
        appearance: 'error',
        autoDismiss: true,
      });

      // Go back to search if test failed
      setStage('search');
    } finally {
      setIsTesting(false);
    }
  };

  const handleBack = () => {
    setStage('search');
    setTestResults(null);
    setExpandedTemplate(null);
  };

  const handleRefreshPoster = async () => {
    if (!testResults) return;

    setIsRefreshing(true);
    try {
      await axios.post(
        `/api/v1/overlay-library-configs/${testResults.item.libraryId}/apply-items`,
        { ratingKey: testResults.item.ratingKey }
      );
      addToast(
        intl.formatMessage(messages.refreshPosterSuccess, {
          title: testResults.item.title,
        }),
        { appearance: 'success', autoDismiss: true }
      );
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : null;
      const message =
        status === 409
          ? intl.formatMessage(messages.refreshPosterConflict)
          : intl.formatMessage(messages.refreshPosterError);
      addToast(message, { appearance: 'error', autoDismiss: true });
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleRefreshItem = async (
    e: React.MouseEvent,
    item: PlexSearchResult
  ) => {
    e.stopPropagation();
    if (refreshingItems.has(item.ratingKey)) return;

    setRefreshingItems((prev) => new Set(prev).add(item.ratingKey));
    try {
      await axios.post(
        `/api/v1/overlay-library-configs/${item.libraryId}/apply-items`,
        { ratingKey: item.ratingKey }
      );
      addToast(
        intl.formatMessage(messages.refreshPosterSuccess, {
          title: item.title,
        }),
        { appearance: 'success', autoDismiss: true }
      );
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : null;
      const message =
        status === 409
          ? intl.formatMessage(messages.refreshPosterConflict)
          : intl.formatMessage(messages.refreshPosterError);
      addToast(message, { appearance: 'error', autoDismiss: true });
    } finally {
      setRefreshingItems((prev) => {
        const next = new Set(prev);
        next.delete(item.ratingKey);
        return next;
      });
    }
  };

  const handleClose = () => {
    setStage('search');
    setSearchQuery('');
    setSearchResults([]);
    setSelectedItem(null);
    setTestResults(null);
    setExpandedTemplate(null);
    onClose();
  };

  return (
    <Transition
      as={Fragment}
      show={isOpen}
      enter="transition ease-out duration-300"
      enterFrom="opacity-0"
      enterTo="opacity-100"
      leave="transition ease-in duration-200"
      leaveFrom="opacity-100"
      leaveTo="opacity-0"
      appear
    >
      <Modal
        title={
          stage === 'search' ? 'Test Item - Search' : 'Test Item - Results'
        }
        customMaxWidth="sm:max-w-6xl"
        onCancel={stage === 'results' ? handleBack : handleClose}
        cancelText={stage === 'results' ? 'Back to Search' : undefined}
      >
        {stage === 'search' && (
          <div className="space-y-4">
            {/* Search Input */}
            <div className="flex items-center space-x-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Search for a movie or TV show..."
                className="flex-1 rounded-md border border-stone-600 bg-stone-700 px-4 py-2 text-white placeholder-stone-400 focus:border-orange-500 focus:outline-none"
              />
              <Button
                onClick={handleSearch}
                disabled={!searchQuery.trim() || isSearching}
                buttonType="primary"
              >
                <MagnifyingGlassIcon className="h-5 w-5" />
                <span className="ml-2">
                  {intl.formatMessage(messages.search)}
                </span>
              </Button>
            </div>

            {/* Results Grid */}
            {isSearching ? (
              <div className="flex h-64 items-center justify-center">
                <LoadingSpinner />
              </div>
            ) : searchResults.length > 0 ? (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {searchResults.map((item) => (
                    <button
                      key={item.ratingKey}
                      onClick={() => setSelectedItem(item)}
                      className={`group relative rounded-lg p-2 transition-all ${
                        selectedItem?.ratingKey === item.ratingKey
                          ? 'bg-stone-700 ring-4 ring-orange-500'
                          : 'hover:bg-stone-700/50'
                      }`}
                    >
                      <div className="relative mb-2 aspect-[2/3] overflow-hidden rounded-md">
                        {item.thumb ? (
                          <img
                            src={item.thumb}
                            alt={item.title}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center bg-stone-800 text-stone-500">
                            {intl.formatMessage(messages.noPoster)}
                          </div>
                        )}
                        <button
                          onClick={(e) => handleRefreshItem(e, item)}
                          disabled={refreshingItems.has(item.ratingKey)}
                          title={intl.formatMessage(messages.refreshPoster)}
                          className="absolute bottom-2 right-2 rounded-full bg-black/60 p-2.5 text-white opacity-0 transition-opacity hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50 group-hover:opacity-100"
                        >
                          <ArrowPathIcon
                            className={`h-5 w-5 ${
                              refreshingItems.has(item.ratingKey)
                                ? 'animate-spin'
                                : ''
                            }`}
                          />
                        </button>
                      </div>
                      <div className="text-left">
                        <p className="truncate text-sm font-medium text-white">
                          {item.title}
                        </p>
                        <p className="text-xs text-stone-400">
                          {item.year} • {item.libraryName}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>

                {/* Action Buttons */}
                <div className="flex justify-end space-x-2 border-t border-stone-700 pt-4">
                  <Button buttonType="ghost" onClick={handleClose}>
                    {intl.formatMessage(messages.cancel)}
                  </Button>
                  <Button
                    buttonType="primary"
                    onClick={handleTest}
                    disabled={!selectedItem || isTesting}
                  >
                    {intl.formatMessage(messages.testOverlay)}
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        )}

        {stage === 'results' && (
          <div className="grid min-h-[80vh] grid-cols-1 items-start gap-6 lg:grid-cols-2">
            {/* Left Column: Poster with Overlays */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white">
                {intl.formatMessage(messages.renderedPoster)}
              </h3>
              {isTesting ? (
                <div className="flex h-96 items-center justify-center rounded-lg bg-stone-900">
                  <LoadingSpinner />
                </div>
              ) : testResults ? (
                <>
                  <div className="flex max-h-[75vh] items-center justify-center overflow-hidden rounded-lg bg-stone-900">
                    <img
                      src={`data:image/webp;base64,${testResults.poster}`}
                      alt={testResults.item.title}
                      className="h-auto max-h-[75vh] w-auto max-w-full object-contain"
                    />
                  </div>
                  <div className="rounded-lg bg-stone-800 p-3 text-sm text-stone-400">
                    <p>
                      <strong className="text-white">
                        {testResults.item.title}
                      </strong>{' '}
                      {testResults.item.year && `(${testResults.item.year})`}
                    </p>
                    <p>
                      {intl.formatMessage(messages.library, {
                        name: testResults.item.libraryName,
                      })}
                    </p>
                  </div>
                  <Button
                    buttonType="primary"
                    onClick={handleRefreshPoster}
                    disabled={isRefreshing}
                    className="flex w-full items-center justify-center space-x-2"
                  >
                    <ArrowPathIcon
                      className={`h-4 w-4 ${
                        isRefreshing ? 'animate-spin' : ''
                      }`}
                    />
                    <span>{intl.formatMessage(messages.refreshPoster)}</span>
                  </Button>
                </>
              ) : null}
            </div>

            {/* Right Column: Template & Context Details */}
            <div className="flex min-h-[80vh] flex-col space-y-4">
              {testResults && (
                <>
                  {/* Templates Section */}
                  <div className="flex min-h-0 flex-1 flex-col">
                    <h3 className="mb-3 text-lg font-semibold text-white">
                      {intl.formatMessage(messages.templateResults)}
                    </h3>
                    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
                      {testResults.templates.map((template) => (
                        <div
                          key={template.id}
                          className="rounded-lg border border-stone-700 bg-stone-800"
                        >
                          {/* Template Header */}
                          <button
                            onClick={() =>
                              setExpandedTemplate(
                                expandedTemplate === template.id
                                  ? null
                                  : template.id
                              )
                            }
                            className="flex w-full items-center justify-between px-4 py-3 transition-colors hover:bg-stone-700/50"
                          >
                            <div className="flex items-center space-x-3">
                              {template.matched ? (
                                <CheckCircleIcon className="h-5 w-5 text-green-500" />
                              ) : (
                                <XCircleIcon className="h-5 w-5 text-red-500" />
                              )}
                              <span className="text-sm font-medium text-white">
                                {template.name}
                              </span>
                            </div>
                            <ChevronDownIcon
                              className={`h-5 w-5 text-stone-400 transition-transform ${
                                expandedTemplate === template.id
                                  ? 'rotate-180'
                                  : ''
                              }`}
                            />
                          </button>

                          {/* Expanded Condition Details */}
                          {expandedTemplate === template.id &&
                            template.conditionResults && (
                              <div className="border-t border-stone-700 px-4 pb-3 pt-3">
                                {template.conditionResults.sectionResults
                                  .length === 0 ? (
                                  <p className="text-xs text-stone-500">
                                    {intl.formatMessage(messages.noConditions)}
                                  </p>
                                ) : (
                                  <div className="space-y-2">
                                    <p className="text-xs font-semibold text-stone-400">
                                      {intl.formatMessage(
                                        messages.conditionEvaluation
                                      )}
                                    </p>
                                    {template.conditionResults.sectionResults.map(
                                      (section, sIdx) => (
                                        <div
                                          key={sIdx}
                                          className="ml-2 space-y-1"
                                        >
                                          {sIdx > 0 &&
                                            section.sectionOperator && (
                                              <p className="text-xs font-bold uppercase text-orange-400">
                                                {section.sectionOperator}
                                              </p>
                                            )}
                                          <div className="space-y-1">
                                            {section.ruleResults.map(
                                              (rule, rIdx) => (
                                                <div
                                                  key={rIdx}
                                                  className="flex items-start space-x-2 text-xs"
                                                >
                                                  {rIdx > 0 &&
                                                    rule.ruleOperator && (
                                                      <span className="min-w-[30px] font-bold uppercase text-orange-400">
                                                        {rule.ruleOperator}
                                                      </span>
                                                    )}
                                                  <div
                                                    className={`flex-1 ${
                                                      rule.matched
                                                        ? 'text-green-400'
                                                        : 'text-red-400'
                                                    }`}
                                                  >
                                                    <span className="font-mono">
                                                      {rule.field}{' '}
                                                      {rule.operator}{' '}
                                                      {JSON.stringify(
                                                        rule.value
                                                      )}
                                                    </span>
                                                    <span className="ml-2 text-stone-500">
                                                      {intl.formatMessage(
                                                        messages.actual,
                                                        {
                                                          value: JSON.stringify(
                                                            rule.actualValue
                                                          ),
                                                        }
                                                      )}
                                                    </span>
                                                  </div>
                                                </div>
                                              )
                                            )}
                                          </div>
                                        </div>
                                      )
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Context Variables Section */}
                  <div className="flex min-h-0 flex-1 flex-col">
                    <h3 className="mb-3 text-lg font-semibold text-white">
                      {intl.formatMessage(messages.contextVariables, {
                        count: Object.keys(testResults.context).length,
                      })}
                    </h3>
                    <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-stone-700 bg-stone-800">
                      <div className="divide-y divide-stone-700">
                        {Object.entries(testResults.context).map(
                          ([key, value]) => (
                            <div
                              key={key}
                              className="flex items-center justify-between px-4 py-2 text-xs hover:bg-stone-700/30"
                            >
                              <span className="font-mono font-semibold text-stone-300">
                                {key}
                              </span>
                              <span className="ml-4 font-mono text-white">
                                {value === undefined || value === null ? (
                                  <span className="text-stone-600">
                                    {intl.formatMessage(messages.undefined)}
                                  </span>
                                ) : value instanceof Date ? (
                                  value.toISOString()
                                ) : (
                                  JSON.stringify(value)
                                )}
                              </span>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </Modal>
    </Transition>
  );
};

export default TestItemModal;
