import type {
  MultiSourceCombineMode,
  MultiSourceType,
} from '@server/../src/types/collections';
import PlexAPI from '@server/api/plexapi';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import schedule from 'node-schedule';
import { collectionSyncService } from './CollectionSyncService';

interface IndividualCollectionJob {
  collectionId: string;
  job: schedule.Job;
  intervalHours: number;
}

/**
 * IndividualCollectionScheduler - Manages custom sync schedules for collections
 *
 * Handles per-collection sync scheduling separate from the main sync job.
 * Supports decimal hour intervals (e.g., 0.5 for 30 minutes, 2.5 for 2 hours 30 minutes).
 */
export class IndividualCollectionScheduler {
  private static jobs: Map<string, IndividualCollectionJob> = new Map();
  private static initialized = false;

  /**
   * Initialize the scheduler by setting up jobs for existing collections
   */
  public static async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    logger.info('Initializing IndividualCollectionScheduler', {
      label: 'Individual Collection Scheduler',
    });

    try {
      await this.refreshAllJobs();
      this.initialized = true;

      logger.info('IndividualCollectionScheduler initialized successfully', {
        label: 'Individual Collection Scheduler',
        activeJobs: this.jobs.size,
      });
    } catch (error) {
      logger.error(
        `Failed to initialize IndividualCollectionScheduler: ${error}`,
        {
          label: 'Individual Collection Scheduler',
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  /**
   * Refresh all jobs based on current collection configurations
   */
  public static async refreshAllJobs(): Promise<void> {
    // Clear existing jobs
    this.clearAllJobs();

    const settings = getSettings();
    const collections = settings.plex.collectionConfigs || [];

    for (const collection of collections) {
      const extendedCollection = collection as typeof collection & {
        customSyncSchedule?: {
          enabled: boolean;
          intervalHours: number;
        };
      };
      const customSync = extendedCollection.customSyncSchedule;
      if (customSync?.enabled && customSync.intervalHours > 0) {
        await this.scheduleCollectionSync(
          collection.id,
          customSync.intervalHours
        );
      }
    }

    logger.debug(`Refreshed individual collection jobs`, {
      label: 'Individual Collection Scheduler',
      activeJobs: this.jobs.size,
      collections: Array.from(this.jobs.keys()),
    });
  }

  /**
   * Schedule a collection for individual sync
   */
  public static async scheduleCollectionSync(
    collectionId: string,
    intervalHours: number
  ): Promise<void> {
    // Cancel existing job if it exists
    this.cancelCollectionSync(collectionId);

    try {
      // For intervals less than 1 hour, use minute-based scheduling
      // For 1 hour or more, use hour-based scheduling
      let finalCronExpression: string;
      if (intervalHours < 1) {
        const minutes = Math.round(intervalHours * 60);
        finalCronExpression = `*/${minutes} * * * *`;
      } else if (intervalHours === Math.floor(intervalHours)) {
        // Whole hours
        const hours = Math.floor(intervalHours);
        finalCronExpression = `0 */${hours} * * *`;
      } else {
        // Decimal hours - use minute-based approach
        const totalMinutes = Math.round(intervalHours * 60);
        finalCronExpression = `*/${totalMinutes} * * * *`;
      }

      const job = schedule.scheduleJob(finalCronExpression, async () => {
        await this.executeCollectionSync(collectionId);
      });

      if (job) {
        this.jobs.set(collectionId, {
          collectionId,
          job,
          intervalHours,
        });

        logger.info(`Scheduled individual collection sync`, {
          label: 'Individual Collection Scheduler',
          collectionId,
          intervalHours,
          cronExpression: finalCronExpression,
        });
      } else {
        throw new Error('Failed to create scheduled job');
      }
    } catch (error) {
      logger.error(
        `Failed to schedule collection sync for ${collectionId}: ${error}`,
        {
          label: 'Individual Collection Scheduler',
          collectionId,
          intervalHours,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  /**
   * Cancel individual sync for a collection
   */
  public static cancelCollectionSync(collectionId: string): void {
    const existingJob = this.jobs.get(collectionId);
    if (existingJob) {
      existingJob.job.cancel();
      this.jobs.delete(collectionId);

      logger.info(`Cancelled individual collection sync`, {
        label: 'Individual Collection Scheduler',
        collectionId,
      });
    }
  }

  /**
   * Execute sync for a specific collection
   */
  private static async executeCollectionSync(
    collectionId: string
  ): Promise<void> {
    try {
      const settings = getSettings();
      const collectionConfig = settings.plex.collectionConfigs?.find(
        (config) => config.id === collectionId
      );

      if (!collectionConfig) {
        logger.warn(
          `Collection config not found for scheduled sync: ${collectionId}`,
          {
            label: 'Individual Collection Scheduler',
            collectionId,
          }
        );
        // Cancel the job since the collection no longer exists
        this.cancelCollectionSync(collectionId);
        return;
      }

      logger.info(
        `Executing scheduled sync for collection: ${collectionConfig.name}`,
        {
          label: 'Individual Collection Scheduler',
          collectionId,
          collectionName: collectionConfig.name,
        }
      );

      // Get admin user for Plex API
      const userRepository = getRepository(User);
      const admin = await userRepository.findOne({ where: { id: 1 } });

      if (!admin) {
        throw new Error('Admin user not found');
      }

      const plexClient = new PlexAPI({ plexToken: admin.plexToken });

      // Determine if this is multi-source
      const extendedConfig = collectionConfig as typeof collectionConfig & {
        isMultiSource?: boolean;
        sources?: {
          id: string;
          type: string;
          subtype?: string;
          customUrl?: string;
          timePeriod?: string;
          priority: number;
        }[];
      };
      const isMultiSource =
        extendedConfig.isMultiSource &&
        (extendedConfig.sources?.length ?? 0) > 0;
      const allCollections = await plexClient.getAllCollections();

      let result;
      if (isMultiSource) {
        // Use multi-source orchestrator
        const { MultiSourceOrchestrator } = await import(
          './MultiSourceOrchestrator'
        );
        const orchestrator = new MultiSourceOrchestrator();

        // Convert to MultiSourceCollectionConfig format
        const multiSourceConfig = {
          ...extendedConfig,
          type: 'multi-source' as const,
          sources:
            extendedConfig.sources?.map((source) => ({
              id: source.id,
              type: source.type as MultiSourceType,
              subtype: source.subtype || '',
              customUrl: source.customUrl,
              timePeriod: source.timePeriod as
                | 'daily'
                | 'weekly'
                | 'monthly'
                | 'all',
              customDays: source.customDays,
              minimumPlays: source.minimumPlays,
              priority: source.priority,
            })) || [],
          combineMode:
            (extendedConfig.combineMode as MultiSourceCombineMode) ||
            'list_order',
        };

        result = await orchestrator.processMultiSourceCollection(
          multiSourceConfig,
          plexClient,
          allCollections,
          new Set(),
          {}
        );
      } else {
        // Use normal single-source sync
        const syncService = await collectionSyncService.createSyncService(
          collectionConfig.type
        );
        result = await syncService.processCollections(
          [collectionConfig],
          plexClient,
          allCollections,
          new Set(),
          {}
        );
      }

      logger.info(
        `Scheduled collection sync completed: ${collectionConfig.name}`,
        {
          label: 'Individual Collection Scheduler',
          collectionId,
          collectionName: collectionConfig.name,
          result,
        }
      );
    } catch (error) {
      logger.error(
        `Scheduled collection sync failed for ${collectionId}: ${error}`,
        {
          label: 'Individual Collection Scheduler',
          collectionId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  /**
   * Clear all scheduled jobs
   */
  public static clearAllJobs(): void {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for (const [_, jobInfo] of this.jobs) {
      jobInfo.job.cancel();
    }
    this.jobs.clear();

    logger.debug('Cleared all individual collection sync jobs', {
      label: 'Individual Collection Scheduler',
    });
  }

  /**
   * Get status of all scheduled jobs
   */
  public static getJobsStatus(): {
    collectionId: string;
    intervalHours: number;
    nextRun: Date | null;
  }[] {
    const status: {
      collectionId: string;
      intervalHours: number;
      nextRun: Date | null;
    }[] = [];

    for (const [collectionId, jobInfo] of this.jobs) {
      status.push({
        collectionId,
        intervalHours: jobInfo.intervalHours,
        nextRun: jobInfo.job.nextInvocation(),
      });
    }

    return status;
  }

  /**
   * Check if a collection has an active individual sync schedule
   */
  public static hasActiveJob(collectionId: string): boolean {
    return this.jobs.has(collectionId);
  }
}

// Export singleton instance
export const individualCollectionScheduler = IndividualCollectionScheduler;
