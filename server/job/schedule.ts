// Availability sync import removed - not needed for collections-only app
import collectionsQuickSync from '@server/lib/collectionsQuickSync';
import collectionsSync from '@server/lib/collectionsSync';
// ImageProxy removed - not needed for collections-only app
import overlayApplication from '@server/lib/overlayApplication';
import overlaysQuickSync from '@server/lib/overlaysQuickSync';
import randomizeHomeOrder from '@server/lib/randomizeHomeOrder';
import refreshToken from '@server/lib/refreshToken';
// Scanner imports removed - not needed for collections-only app
import type { JobId } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import schedule from 'node-schedule';

interface ScheduledJob {
  id: JobId;
  job: schedule.Job;
  name: string;
  type: 'process' | 'command';
  interval: 'seconds' | 'minutes' | 'hours' | 'fixed';
  cronSchedule: string;
  running?: () => boolean;
  cancelFn?: () => void;
}

export const scheduledJobs: ScheduledJob[] = [];

export const startJobs = (): void => {
  const jobs = getSettings().jobs;

  // Plex Recently Added Scan removed - not needed for collections-only app

  // Plex Full Library Scan removed - not needed for collections-only app

  // Radarr Scan removed - not needed for collections-only app

  // Sonarr Scan removed - not needed for collections-only app

  // Media Availability Sync removed - not needed for collections-only app

  scheduledJobs.push({
    id: 'plex-collections-sync',
    name: 'Plex Collections Sync',
    type: 'process',
    interval: 'hours',
    cronSchedule: jobs['plex-collections-sync'].schedule,
    job: schedule.scheduleJob(jobs['plex-collections-sync'].schedule, () => {
      // Check if any collections are configured before running
      const settings = getSettings();
      const hasCollections =
        settings.plex.collectionConfigs &&
        settings.plex.collectionConfigs.length > 0;

      if (!hasCollections) {
        logger.debug(
          'Skipping scheduled Plex Collections Sync: No collections configured',
          {
            label: 'Jobs',
          }
        );
        return;
      }

      logger.info('Starting scheduled job: Plex Collections Sync', {
        label: 'Jobs',
      });
      collectionsSync.run();
    }),
    running: () => collectionsSync.status.running,
    cancelFn: () => collectionsSync.cancel(),
  });

  scheduledJobs.push({
    id: 'plex-collections-quick-sync',
    name: 'Collections Quick Sync',
    type: 'process',
    interval: 'minutes',
    cronSchedule: jobs['plex-collections-quick-sync'].schedule,
    job: schedule.scheduleJob(
      jobs['plex-collections-quick-sync'].schedule,
      () => {
        logger.info('Starting scheduled job: Collections Quick Sync', {
          label: 'Jobs',
        });
        collectionsQuickSync.run();
      }
    ),
    running: () => collectionsQuickSync.status.running,
    cancelFn: () => collectionsQuickSync.cancel(),
  });

  scheduledJobs.push({
    id: 'plex-randomize-home-order',
    name: 'Plex Randomize Home Order',
    type: 'process',
    interval: 'minutes',
    cronSchedule: jobs['plex-randomize-home-order'].schedule,
    job: schedule.scheduleJob(
      jobs['plex-randomize-home-order'].schedule,
      () => {
        logger.info('Starting scheduled job: Plex Randomize Home Order', {
          label: 'Jobs',
        });
        randomizeHomeOrder.run();
      }
    ),
    running: () => randomizeHomeOrder.status.running,
    cancelFn: () => randomizeHomeOrder.cancel(),
  });

  scheduledJobs.push({
    id: 'overlay-application',
    name: 'Overlay Application',
    type: 'process',
    interval: 'hours',
    cronSchedule: jobs['overlay-application'].schedule,
    job: schedule.scheduleJob(jobs['overlay-application'].schedule, () => {
      logger.info('Starting scheduled job: Overlay Application', {
        label: 'Jobs',
      });
      overlayApplication.run();
    }),
    running: () => overlayApplication.status.running,
    cancelFn: () => overlayApplication.cancel(),
  });

  scheduledJobs.push({
    id: 'overlay-quick-sync',
    name: 'Overlay Quick Sync',
    type: 'process',
    interval: 'minutes',
    cronSchedule: jobs['overlay-quick-sync'].schedule,
    job: schedule.scheduleJob(jobs['overlay-quick-sync'].schedule, () => {
      logger.info('Starting scheduled job: Overlay Quick Sync', {
        label: 'Jobs',
      });
      overlaysQuickSync.run();
    }),
    running: () => overlaysQuickSync.status.running,
    cancelFn: () => overlaysQuickSync.cancel(),
  });

  scheduledJobs.push({
    id: 'plex-refresh-token',
    name: 'Plex Refresh Token',
    type: 'process',
    interval: 'fixed',
    cronSchedule: jobs['plex-refresh-token'].schedule,
    job: schedule.scheduleJob(jobs['plex-refresh-token'].schedule, () => {
      logger.info('Starting scheduled job: Plex Refresh Token', {
        label: 'Jobs',
      });
      refreshToken.run();
    }),
  });

  logger.info('Scheduled jobs loaded', { label: 'Jobs' });
};
