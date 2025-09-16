import PlexAPI from '@server/api/plexapi';
import type {
  MultiSourceCombineMode,
  MultiSourceType,
} from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import schedule from 'node-schedule';
import { collectionSyncService } from './CollectionSyncService';

interface IndividualCollectionJob {
  collectionId: string;
  job: schedule.Job;
  intervalHours: number;
}

interface QueuedCollectionSync {
  collectionId: string;
  collectionName: string;
  libraryId: string;
  priority: number; // Lower numbers = higher priority
  scheduledAt: Date;
}

interface LibraryQueue {
  libraryId: string;
  running: boolean;
  queue: QueuedCollectionSync[];
  currentCollection?: string;
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
  private static libraryQueues: Map<string, LibraryQueue> = new Map();
  private static fullSyncRunning = false;

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
      const customSync = collection.customSyncSchedule;
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
        await this.queueCollectionSync(collectionId);
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
   * Set full sync running status to prevent individual syncs
   */
  public static setFullSyncRunning(running: boolean): void {
    this.fullSyncRunning = running;
    logger.debug(
      `Full sync status changed: ${running ? 'running' : 'stopped'}`,
      {
        label: 'Individual Collection Scheduler',
      }
    );
  }

  /**
   * Check if full sync is currently running
   */
  public static isFullSyncRunning(): boolean {
    return this.fullSyncRunning;
  }

  /**
   * Queue a collection for sync with collision detection and library-based queuing
   */
  private static async queueCollectionSync(
    collectionId: string
  ): Promise<void> {
    try {
      // Check if full sync is running
      if (this.fullSyncRunning) {
        logger.info(
          `Skipping individual collection sync: full sync is running`,
          {
            label: 'Individual Collection Scheduler',
            collectionId,
          }
        );
        return;
      }

      // Get collection configuration
      const settings = getSettings();
      const collectionConfig = settings.plex.collectionConfigs?.find(
        (config) => config.id === collectionId
      );

      if (!collectionConfig) {
        logger.warn(
          `Collection config not found for queued sync: ${collectionId}`,
          {
            label: 'Individual Collection Scheduler',
            collectionId,
          }
        );
        this.cancelCollectionSync(collectionId);
        return;
      }

      const libraryId = collectionConfig.libraryId;

      // Get or create library queue
      let libraryQueue = this.libraryQueues.get(libraryId);
      if (!libraryQueue) {
        libraryQueue = {
          libraryId,
          running: false,
          queue: [],
        };
        this.libraryQueues.set(libraryId, libraryQueue);
      }

      // Check if this collection is already queued
      const alreadyQueued = libraryQueue.queue.some(
        (item) => item.collectionId === collectionId
      );

      if (alreadyQueued) {
        logger.debug(
          `Collection already queued for sync: ${collectionConfig.name}`,
          {
            label: 'Individual Collection Scheduler',
            collectionId,
            libraryId,
          }
        );
        return;
      }

      // Add to queue
      const queuedSync: QueuedCollectionSync = {
        collectionId,
        collectionName: collectionConfig.name,
        libraryId,
        priority: Date.now(), // FIFO ordering
        scheduledAt: new Date(),
      };

      libraryQueue.queue.push(queuedSync);
      libraryQueue.queue.sort((a, b) => a.priority - b.priority);

      logger.info(
        `Queued collection sync: ${collectionConfig.name} (queue position: ${libraryQueue.queue.length})`,
        {
          label: 'Individual Collection Scheduler',
          collectionId,
          libraryId,
          queueSize: libraryQueue.queue.length,
        }
      );

      // Process queue for this library if not already running
      await this.processLibraryQueue(libraryId);
    } catch (error) {
      logger.error(
        `Failed to queue collection sync for ${collectionId}: ${error}`,
        {
          label: 'Individual Collection Scheduler',
          collectionId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  /**
   * Process the queue for a specific library
   */
  private static async processLibraryQueue(libraryId: string): Promise<void> {
    const libraryQueue = this.libraryQueues.get(libraryId);
    if (
      !libraryQueue ||
      libraryQueue.running ||
      libraryQueue.queue.length === 0
    ) {
      return;
    }

    libraryQueue.running = true;

    try {
      while (!this.fullSyncRunning) {
        const nextSync = libraryQueue.queue.shift();
        if (!nextSync) {
          // Queue is empty
          break;
        }

        libraryQueue.currentCollection = nextSync.collectionName;

        logger.info(
          `Processing queued collection sync: ${nextSync.collectionName} (${libraryQueue.queue.length} remaining in queue)`,
          {
            label: 'Individual Collection Scheduler',
            collectionId: nextSync.collectionId,
            libraryId,
            queueRemaining: libraryQueue.queue.length,
          }
        );

        await this.executeCollectionSync(nextSync.collectionId);

        // Brief pause between collections in the same library to prevent overwhelming Plex
        if (libraryQueue.queue.length > 0) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      if (this.fullSyncRunning && libraryQueue.queue.length > 0) {
        logger.info(
          `Stopping library queue processing: full sync started (${libraryQueue.queue.length} collections still queued)`,
          {
            label: 'Individual Collection Scheduler',
            libraryId,
            queueRemaining: libraryQueue.queue.length,
          }
        );
      }
    } catch (error) {
      logger.error(
        `Error processing library queue for ${libraryId}: ${error}`,
        {
          label: 'Individual Collection Scheduler',
          libraryId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    } finally {
      libraryQueue.running = false;
      libraryQueue.currentCollection = undefined;
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

      // Get admin user for Plex API (same approach as full sync)
      const { getAdminUser } = await import(
        '@server/lib/collections/core/CollectionUtilities'
      );
      const admin = await getAdminUser();

      if (!admin?.plexToken) {
        throw new Error('No admin Plex token found');
      }

      const plexClient = new PlexAPI({
        plexToken: admin.plexToken,
        plexSettings: settings.plex,
      });

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

  /**
   * Get status of all library queues
   */
  public static getLibraryQueuesStatus(): {
    libraryId: string;
    running: boolean;
    currentCollection?: string;
    queueSize: number;
    queuedCollections: string[];
  }[] {
    const status: {
      libraryId: string;
      running: boolean;
      currentCollection?: string;
      queueSize: number;
      queuedCollections: string[];
    }[] = [];

    for (const [libId, queue] of this.libraryQueues) {
      status.push({
        libraryId: libId,
        running: queue.running,
        currentCollection: queue.currentCollection,
        queueSize: queue.queue.length,
        queuedCollections: queue.queue.map((q) => q.collectionName),
      });
    }

    return status;
  }

  /**
   * Clear all queues (for emergency stop or restart)
   */
  public static clearAllQueues(): void {
    let totalCleared = 0;
    for (const [libraryId, queue] of this.libraryQueues) {
      const queueSize = queue.queue.length;
      totalCleared += queueSize;

      if (queueSize > 0) {
        logger.debug(
          `Clearing queue for library ${libraryId}: ${queueSize} items`,
          {
            label: 'Individual Collection Scheduler',
            libraryId,
            queueSize,
          }
        );
      }

      queue.queue = [];
      queue.running = false;
      queue.currentCollection = undefined;
    }

    logger.info(`Cleared all individual collection queues`, {
      label: 'Individual Collection Scheduler',
      totalCleared,
      librariesCleared: this.libraryQueues.size,
    });
  }

  /**
   * Wait for individual syncs to complete before allowing full sync
   */
  public static async waitForIndividualSyncsToComplete(
    timeoutMs = 300000
  ): Promise<void> {
    const startTime = Date.now();
    const checkInterval = 1000; // Check every second

    while (Date.now() - startTime < timeoutMs) {
      const anyRunning = Array.from(this.libraryQueues.values()).some(
        (queue) => queue.running || queue.queue.length > 0
      );

      if (!anyRunning) {
        logger.debug('All individual collection syncs have completed', {
          label: 'Individual Collection Scheduler',
        });
        return;
      }

      logger.debug('Waiting for individual collection syncs to complete...', {
        label: 'Individual Collection Scheduler',
        runningQueues: Array.from(this.libraryQueues.values())
          .filter((q) => q.running || q.queue.length > 0)
          .map((q) => ({
            libraryId: q.libraryId,
            queueSize: q.queue.length,
            running: q.running,
          })),
      });

      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    }

    logger.warn('Timeout waiting for individual collection syncs to complete', {
      label: 'Individual Collection Scheduler',
      timeoutMs,
      stillRunning: Array.from(this.libraryQueues.values())
        .filter((q) => q.running || q.queue.length > 0)
        .map((q) => ({
          libraryId: q.libraryId,
          queueSize: q.queue.length,
          running: q.running,
        })),
    });
  }
}

// Export singleton instance
export const individualCollectionScheduler = IndividualCollectionScheduler;
