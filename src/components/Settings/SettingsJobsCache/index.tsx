import Spinner from '@app/assets/spinner.svg';
import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Modal from '@app/components/Common/Modal';
import PageTitle from '@app/components/Common/PageTitle';
import Table from '@app/components/Common/Table';
import useLocale from '@app/hooks/useLocale';
import globalMessages from '@app/i18n/globalMessages';
import { Transition } from '@headlessui/react';
import { PlayIcon, StopIcon } from '@heroicons/react/24/outline';
import { PencilIcon } from '@heroicons/react/24/solid';
import type { JobId } from '@server/lib/settings';
import axios from 'axios';
import cronstrue from 'cronstrue/i18n';
import { Fragment, useReducer, useState } from 'react';
import type { MessageDescriptor } from 'react-intl';
import { defineMessages, FormattedRelativeTime, useIntl } from 'react-intl';
import { useToasts } from 'react-toast-notifications';
import useSWR from 'swr';

const messages: { [messageName: string]: MessageDescriptor } = defineMessages({
  jobsandcache: 'Jobs',
  jobs: 'Jobs',
  jobsDescription:
    'Agregarr performs Collections Sync as regularly-scheduled job, but can also be manually triggered below.',
  jobname: 'Job Name',
  jobtype: 'Type',
  nextexecution: 'Next Execution',
  runnow: 'Run Now',
  canceljob: 'Cancel Job',
  jobstarted: '{jobname} started.',
  jobcancelled: '{jobname} canceled.',
  process: 'Process',
  command: 'Command',
  cache: 'Cache',
  cacheDescription:
    'Agregarr caches requests to external API endpoints to optimize performance and avoid making unnecessary API calls.',
  cacheflushed: '{cachename} cache flushed.',
  cachename: 'Cache Name',
  cachehits: 'Hits',
  cachemisses: 'Misses',
  cachekeys: 'Total Keys',
  cacheksize: 'Key Size',
  cachevsize: 'Value Size',
  flushcache: 'Flush Cache',
  unknownJob: 'Unknown Job',
  'plex-refresh-token': 'Plex Refresh Token',
  'plex-collections-sync': 'Plex Collections Sync',
  'plex-collections-quick-sync': 'Collections Quick Sync',
  'plex-randomize-home-order': 'Randomize Home Order',
  'overlay-application': 'Poster Overlay Application',
  'overlay-quick-sync': 'Overlay Quick Sync',
  'watchlist-sync': 'Plex Watchlist Sync',
  editJobSchedule: 'Modify Job',
  jobScheduleEditSaved: 'Job edited successfully!',
  jobScheduleEditFailed: 'Something went wrong while saving the job.',
  editJobScheduleCurrent: 'Current Frequency',
  editJobSchedulePrompt: 'New Frequency',
  editJobScheduleSelectorHours:
    'Every {jobScheduleHours, plural, one {hour} other {{jobScheduleHours} hours}}',
  editJobScheduleSelectorMinutes:
    'Every {jobScheduleMinutes, plural, one {minute} other {{jobScheduleMinutes} minutes}}',
  editJobScheduleSelectorSeconds:
    'Every {jobScheduleSeconds, plural, one {second} other {{jobScheduleSeconds} seconds}}',
  editJobScheduleUsePreset: 'Use Preset Intervals',
  editJobScheduleUseCustom: 'Use Custom CRON Expression',
  editJobScheduleCustomCron: 'CRON Expression',
  editJobScheduleCustomCronPlaceholder:
    'e.g. 0 */15 * * * * (every 15 min) or 0 0 */6 * * * (every 6 hours)',
  editJobScheduleCustomCronInvalid: 'Invalid CRON expression',
  imagecache: 'Image Cache',
  imagecacheDescription:
    'When enabled in settings, Agregarr will proxy and cache images from pre-configured external sources. Cached images are saved into your config folder. You can find the files in <code>{appDataPath}/cache/images</code>.',
  imagecachecount: 'Images Cached',
  imagecachesize: 'Total Cache Size',
  toastCollectionsSyncSkipped:
    'Plex collections sync skipped - collections are disabled. Enable collections in Plex settings to run this job.',
});

interface Job {
  id: JobId;
  name: string;
  type: 'process' | 'command';
  interval: 'seconds' | 'minutes' | 'hours' | 'fixed';
  cronSchedule: string;
  nextExecutionTime: string;
  followingExecutionTime: string | null;
  running: boolean;
}

type JobModalState = {
  isOpen?: boolean;
  job?: Job;
  scheduleHours: number;
  scheduleMinutes: number;
  scheduleSeconds: number;
  useCustomCron: boolean;
  customCronExpression: string;
};

type JobModalAction =
  | {
      type: 'set';
      hours?: number;
      minutes?: number;
      seconds?: number;
      useCustomCron?: boolean;
      customCronExpression?: string;
    }
  | {
      type: 'close';
    }
  | { type: 'open'; job?: Job };

/**
 * Parse a CRON expression to extract the interval value for preset schedules
 * CRON format: second minute hour day month weekday
 */
const parseCronToInterval = (
  cronSchedule: string,
  interval: 'seconds' | 'minutes' | 'hours' | 'fixed'
): number | undefined => {
  const parts = cronSchedule.split(/\s+/);
  if (parts.length !== 6) {
    return undefined;
  }

  try {
    if (interval === 'seconds') {
      // Pattern: */{seconds} * ...
      const secondsPart = parts[0];
      const match = secondsPart.match(/^\*\/(\d+)$/);
      return match ? parseInt(match[1], 10) : undefined;
    } else if (interval === 'minutes') {
      // Pattern: * */{minutes} ...
      const minutesPart = parts[1];
      const match = minutesPart.match(/^\*\/(\d+)$/);
      return match ? parseInt(match[1], 10) : undefined;
    } else if (interval === 'hours') {
      // Pattern: 0 */{hours} ...
      const hoursPart = parts[2];
      const match = hoursPart.match(/^\*\/(\d+)$/);
      return match ? parseInt(match[1], 10) : undefined;
    }
  } catch {
    return undefined;
  }

  return undefined;
};

const jobModalReducer = (
  state: JobModalState,
  action: JobModalAction
): JobModalState => {
  switch (action.type) {
    case 'close':
      return {
        ...state,
        isOpen: false,
      };

    case 'open': {
      // Parse the existing CRON schedule to determine current preset values
      let scheduleHours = 1;
      let scheduleMinutes = 5;
      let scheduleSeconds = 30;
      let useCustomCron = false;

      if (action.job?.cronSchedule) {
        const parsedValue = parseCronToInterval(
          action.job.cronSchedule,
          action.job.interval
        );

        if (parsedValue !== undefined) {
          // Successfully parsed preset schedule
          if (action.job.interval === 'seconds') {
            scheduleSeconds = parsedValue;
          } else if (action.job.interval === 'minutes') {
            scheduleMinutes = parsedValue;
          } else if (action.job.interval === 'hours') {
            scheduleHours = parsedValue;
          }
          useCustomCron = false;
        } else {
          // Could not parse as preset, treat as custom CRON
          useCustomCron = true;
        }
      }

      return {
        isOpen: true,
        job: action.job,
        scheduleHours,
        scheduleMinutes,
        scheduleSeconds,
        useCustomCron,
        customCronExpression: useCustomCron
          ? action.job?.cronSchedule ?? ''
          : '',
      };
    }

    case 'set':
      return {
        ...state,
        scheduleHours: action.hours ?? state.scheduleHours,
        scheduleMinutes: action.minutes ?? state.scheduleMinutes,
        scheduleSeconds: action.seconds ?? state.scheduleSeconds,
        useCustomCron: action.useCustomCron ?? state.useCustomCron,
        customCronExpression:
          action.customCronExpression ?? state.customCronExpression,
      };
  }
};

const SettingsJobs = () => {
  const intl = useIntl();
  const { locale } = useLocale();
  const { addToast } = useToasts();
  const {
    data,
    error,
    mutate: revalidate,
  } = useSWR<Job[]>('/api/v1/settings/jobs', {
    refreshInterval: 5000,
  });

  const [jobModalState, dispatch] = useReducer(jobModalReducer, {
    isOpen: false,
    scheduleHours: 1,
    scheduleMinutes: 5,
    scheduleSeconds: 30,
    useCustomCron: false,
    customCronExpression: '',
  });
  const [isSaving, setIsSaving] = useState(false);

  if (!data && !error) {
    return <LoadingSpinner />;
  }

  const runJob = async (job: Job) => {
    await axios.post(`/api/v1/settings/jobs/${job.id}/run`);

    // Collections sync will check if there are collections to process
    if (job.id === 'plex-collections-sync') {
      try {
        // Job will determine if there are collections to process
      } catch (error) {
        // If we can't check settings, just proceed with normal message
      }
    }

    addToast(
      intl.formatMessage(messages.jobstarted, {
        jobname: intl.formatMessage(messages[job.id] ?? messages.unknownJob),
      }),
      {
        appearance: 'success',
        autoDismiss: true,
      }
    );
    revalidate();
  };

  const cancelJob = async (job: Job) => {
    await axios.post(`/api/v1/settings/jobs/${job.id}/cancel`);
    addToast(
      intl.formatMessage(messages.jobcancelled, {
        jobname: intl.formatMessage(messages[job.id] ?? messages.unknownJob),
      }),
      {
        appearance: 'error',
        autoDismiss: true,
      }
    );
    revalidate();
  };

  const scheduleJob = async () => {
    let scheduleExpression = '';

    try {
      if (jobModalState.useCustomCron) {
        // Use custom CRON expression
        const cronExpr = jobModalState.customCronExpression.trim();
        if (!cronExpr) {
          throw new Error('CRON expression is required');
        }

        // Basic validation: should have 6 parts for node-schedule (second minute hour day month weekday)
        const cronParts = cronExpr.split(/\s+/);
        if (cronParts.length !== 6) {
          throw new Error(
            'CRON expression must have 6 parts (node-schedule format): second minute hour day month weekday. Examples: "0 */15 * * * *" (every 15 min), "0 0 */6 * * *" (every 6 hours)'
          );
        }

        scheduleExpression = cronExpr;
      } else {
        // Use preset intervals
        const jobScheduleCron = ['0', '0', '*', '*', '*', '*'];

        if (jobModalState.job?.interval === 'seconds') {
          jobScheduleCron.splice(
            0,
            2,
            `*/${jobModalState.scheduleSeconds}`,
            '*'
          );
        } else if (jobModalState.job?.interval === 'minutes') {
          jobScheduleCron[1] = `*/${jobModalState.scheduleMinutes}`;
        } else if (jobModalState.job?.interval === 'hours') {
          jobScheduleCron[2] = `*/${jobModalState.scheduleHours}`;
        } else {
          // jobs with interval: fixed should not be editable unless using custom CRON
          throw new Error('This job type requires custom CRON expression');
        }

        scheduleExpression = jobScheduleCron.join(' ');
      }

      setIsSaving(true);
      await axios.post(
        `/api/v1/settings/jobs/${jobModalState.job?.id}/schedule`,
        {
          schedule: scheduleExpression,
        }
      );

      addToast(intl.formatMessage(messages.jobScheduleEditSaved), {
        appearance: 'success',
        autoDismiss: true,
      });

      dispatch({ type: 'close' });
      revalidate();
    } catch (e) {
      const errorMessage =
        e.response?.data?.message ||
        e.message ||
        intl.formatMessage(messages.jobScheduleEditFailed);
      addToast(errorMessage, {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <PageTitle
        title={[
          intl.formatMessage(messages.jobsandcache),
          intl.formatMessage(globalMessages.settings),
        ]}
      />
      <Transition
        as={Fragment}
        enter="transition-opacity duration-300"
        enterFrom="opacity-0"
        enterTo="opacity-100"
        leave="transition-opacity duration-300"
        leaveFrom="opacity-100"
        leaveTo="opacity-0"
        show={jobModalState.isOpen}
      >
        <Modal
          title={intl.formatMessage(messages.editJobSchedule)}
          okText={
            isSaving
              ? intl.formatMessage(globalMessages.saving)
              : intl.formatMessage(globalMessages.save)
          }
          onCancel={() => dispatch({ type: 'close' })}
          okDisabled={isSaving}
          onOk={() => scheduleJob()}
        >
          <div className="section">
            <form className="mb-6">
              <div className="form-row">
                <label className="text-label">
                  {intl.formatMessage(messages.editJobScheduleCurrent)}
                </label>
                <div className="form-input-area mt-2 mb-1">
                  <div>
                    {jobModalState.job &&
                      cronstrue.toString(jobModalState.job.cronSchedule, {
                        locale,
                      })}
                  </div>
                  <div className="text-sm text-gray-500">
                    {jobModalState.job?.cronSchedule}
                  </div>
                </div>
              </div>
              <div className="form-row">
                <label className="text-label">
                  {intl.formatMessage(messages.editJobSchedulePrompt)}
                </label>
                <div className="form-input-area">
                  <div className="mb-4">
                    <label className="mr-6 inline-flex items-center">
                      <input
                        type="radio"
                        className="form-radio"
                        checked={!jobModalState.useCustomCron}
                        onChange={() =>
                          dispatch({ type: 'set', useCustomCron: false })
                        }
                      />
                      <span className="ml-2">
                        {intl.formatMessage(messages.editJobScheduleUsePreset)}
                      </span>
                    </label>
                    <label className="inline-flex items-center">
                      <input
                        type="radio"
                        className="form-radio"
                        checked={jobModalState.useCustomCron}
                        onChange={() =>
                          dispatch({ type: 'set', useCustomCron: true })
                        }
                      />
                      <span className="ml-2">
                        {intl.formatMessage(messages.editJobScheduleUseCustom)}
                      </span>
                    </label>
                  </div>

                  {!jobModalState.useCustomCron ? (
                    // Preset intervals
                    <div>
                      {jobModalState.job?.interval === 'seconds' ? (
                        <select
                          name="jobScheduleSeconds"
                          className="inline"
                          value={jobModalState.scheduleSeconds}
                          onChange={(e) =>
                            dispatch({
                              type: 'set',
                              seconds: Number(e.target.value),
                            })
                          }
                        >
                          {[30, 45, 60].map((v) => (
                            <option value={v} key={`jobScheduleSeconds-${v}`}>
                              {intl.formatMessage(
                                messages.editJobScheduleSelectorSeconds,
                                {
                                  jobScheduleSeconds: v,
                                }
                              )}
                            </option>
                          ))}
                        </select>
                      ) : jobModalState.job?.interval === 'minutes' ? (
                        <select
                          name="jobScheduleMinutes"
                          className="inline"
                          value={jobModalState.scheduleMinutes}
                          onChange={(e) =>
                            dispatch({
                              type: 'set',
                              minutes: Number(e.target.value),
                            })
                          }
                        >
                          {[5, 10, 15, 20, 30, 60, 120, 180, 240, 300, 360].map(
                            (v) => (
                              <option value={v} key={`jobScheduleMinutes-${v}`}>
                                {intl.formatMessage(
                                  messages.editJobScheduleSelectorMinutes,
                                  {
                                    jobScheduleMinutes: v,
                                  }
                                )}
                              </option>
                            )
                          )}
                        </select>
                      ) : (
                        <select
                          name="jobScheduleHours"
                          className="inline"
                          value={jobModalState.scheduleHours}
                          onChange={(e) =>
                            dispatch({
                              type: 'set',
                              hours: Number(e.target.value),
                            })
                          }
                        >
                          {[1, 2, 3, 4, 6, 8, 12, 24, 48, 72].map((v) => (
                            <option value={v} key={`jobScheduleHours-${v}`}>
                              {intl.formatMessage(
                                messages.editJobScheduleSelectorHours,
                                {
                                  jobScheduleHours: v,
                                }
                              )}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  ) : (
                    // Custom CRON expression
                    <div>
                      <label
                        htmlFor="customCronExpression"
                        className="text-label mb-2 block"
                      >
                        {intl.formatMessage(messages.editJobScheduleCustomCron)}
                      </label>
                      <input
                        id="customCronExpression"
                        type="text"
                        className="inline"
                        placeholder={intl.formatMessage(
                          messages.editJobScheduleCustomCronPlaceholder
                        )}
                        value={jobModalState.customCronExpression}
                        onChange={(e) =>
                          dispatch({
                            type: 'set',
                            customCronExpression: e.target.value,
                          })
                        }
                      />
                    </div>
                  )}
                </div>
              </div>
            </form>
          </div>
        </Modal>
      </Transition>

      <div className="mb-6">
        <h3 className="heading">{intl.formatMessage(messages.jobs)}</h3>
        <p className="description">
          {intl.formatMessage(messages.jobsDescription)}
        </p>
      </div>
      <div className="section">
        <Table>
          <thead>
            <tr>
              <Table.TH>{intl.formatMessage(messages.jobname)}</Table.TH>
              <Table.TH>{intl.formatMessage(messages.jobtype)}</Table.TH>
              <Table.TH>{intl.formatMessage(messages.nextexecution)}</Table.TH>
              <Table.TH></Table.TH>
            </tr>
          </thead>
          <Table.TBody>
            {data?.map((job) => (
              <tr key={`job-list-${job.id}`}>
                <Table.TD>
                  <div className="flex items-center text-sm leading-5 text-white">
                    <span>
                      {intl.formatMessage(
                        messages[job.id] ?? messages.unknownJob
                      )}
                    </span>
                    {job.running && <Spinner className="ml-2 h-5 w-5" />}
                  </div>
                </Table.TD>
                <Table.TD>
                  <Badge
                    badgeType={job.type === 'process' ? 'primary' : 'warning'}
                    className="uppercase"
                  >
                    {job.type === 'process'
                      ? intl.formatMessage(messages.process)
                      : intl.formatMessage(messages.command)}
                  </Badge>
                </Table.TD>
                <Table.TD>
                  {(() => {
                    const secondsUntilNext = Math.floor(
                      (new Date(job.nextExecutionTime).getTime() - Date.now()) /
                        1000
                    );
                    const hoursUntilNext = secondsUntilNext / 3600;

                    // Show hours for up to 48 hours, then switch to days
                    return (
                      <div className="text-sm leading-5 text-white">
                        {hoursUntilNext <= 48 ? (
                          <FormattedRelativeTime
                            value={Math.floor(secondsUntilNext / 3600)}
                            updateIntervalInSeconds={60}
                            numeric="auto"
                            unit="hour"
                          />
                        ) : (
                          <FormattedRelativeTime
                            value={Math.floor(secondsUntilNext / 86400)}
                            updateIntervalInSeconds={3600}
                            numeric="auto"
                            unit="day"
                          />
                        )}
                      </div>
                    );
                  })()}
                  {job.followingExecutionTime &&
                    (() => {
                      const secondsUntil = Math.floor(
                        (new Date(job.followingExecutionTime).getTime() -
                          Date.now()) /
                          1000
                      );
                      const hoursUntil = secondsUntil / 3600;

                      // Show hours for up to 48 hours, then switch to days
                      if (hoursUntil <= 48) {
                        return (
                          <div className="text-xs leading-4 text-gray-400">
                            Following execution{' '}
                            <FormattedRelativeTime
                              value={Math.floor(secondsUntil / 3600)}
                              updateIntervalInSeconds={60}
                              numeric="auto"
                              unit="hour"
                            />
                          </div>
                        );
                      } else {
                        return (
                          <div className="text-xs leading-4 text-gray-400">
                            Following execution{' '}
                            <FormattedRelativeTime
                              value={Math.floor(secondsUntil / 86400)}
                              updateIntervalInSeconds={3600}
                              numeric="auto"
                              unit="day"
                            />
                          </div>
                        );
                      }
                    })()}
                </Table.TD>
                <Table.TD alignText="right">
                  {job.interval !== 'fixed' && (
                    <Button
                      className="mr-2"
                      buttonType="warning"
                      onClick={() => dispatch({ type: 'open', job })}
                    >
                      <PencilIcon />
                      <span>{intl.formatMessage(globalMessages.edit)}</span>
                    </Button>
                  )}
                  {job.running ? (
                    <Button buttonType="danger" onClick={() => cancelJob(job)}>
                      <StopIcon />
                      <span>{intl.formatMessage(messages.canceljob)}</span>
                    </Button>
                  ) : (
                    <Button buttonType="primary" onClick={() => runJob(job)}>
                      <PlayIcon />
                      <span>{intl.formatMessage(messages.runnow)}</span>
                    </Button>
                  )}
                </Table.TD>
              </tr>
            ))}
          </Table.TBody>
        </Table>
      </div>
    </>
  );
};

export default SettingsJobs;
