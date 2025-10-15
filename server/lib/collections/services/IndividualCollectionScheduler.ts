import PlexAPI from '@server/api/plexapi';
import type {
  CustomSyncSchedule,
  MultiSourceCombineMode,
  MultiSourceType,
} from '@server/lib/settings';
import { getSettings, SYNC_SCHEDULE_PRESETS } from '@server/lib/settings';
import logger from '@server/logger';
import schedule from 'node-schedule';
import { collectionSyncService } from './CollectionSyncService';

interface IndividualCollectionJob {
  collectionId: string;
  job: schedule.Job;
  intervalHours?: number; // For preset schedules
  customCron?: string; // For custom cron schedules
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

interface ApiWaitingItem {
  collectionId: string;
  collectionName: string;
  libraryId: string;
  resolve: () => void;
  scheduledAt: Date;
}

interface ApiQueue {
  apiType: string;
  inUse: boolean;
  waitingQueue: ApiWaitingItem[];
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
  private static apiQueues: Map<string, ApiQueue> = new Map();

  /**
   * Parse custom sync schedule and return either interval hours or cron expression
   */
  private static parseCustomSyncSchedule(schedule: CustomSyncSchedule): {
    intervalHours?: number;
    customCron?: string;
    startDate?: string;
    startTime?: string;
    firstSyncAt?: string;
  } {
    if (!schedule.enabled) {
      return {};
    }

    // Handle legacy format (direct intervalHours)
    if (schedule.intervalHours && !schedule.scheduleType) {
      return { intervalHours: schedule.intervalHours };
    }

    // Handle new format
    if (schedule.scheduleType === 'preset' && schedule.preset) {
      const preset = SYNC_SCHEDULE_PRESETS.find(
        (p) => p.key === schedule.preset
      );
      if (preset) {
        return {
          intervalHours: preset.intervalHours,
          startDate: schedule.startNow ? undefined : schedule.startDate,
          startTime: schedule.startNow ? undefined : schedule.startTime,
          firstSyncAt: schedule.firstSyncAt,
        };
      }
    } else if (schedule.scheduleType === 'custom' && schedule.customCron) {
      return { customCron: schedule.customCron };
    }

    // Fallback to legacy intervalHours if present
    if (schedule.intervalHours) {
      return { intervalHours: schedule.intervalHours };
    }

    return {};
  }

  /**
   * Generate a cron expression for an interval with a specific start date/time
   */
  private static generateCronWithStartDateTime(
    intervalHours: number,
    startDate: string,
    startTime: string
  ): string {
    const [hour, minute] = startTime.split(':').map(Number);
    const [day, month] = startDate.split('-').map(Number);

    if (intervalHours === 24) {
      // Daily: run at the same time every day
      return `${minute} ${hour} * * *`;
    } else if (intervalHours === 168) {
      // Weekly: run on the same day/time every week (assume Monday if not specified)
      return `${minute} ${hour} * * 1`;
    } else if (intervalHours === 720) {
      // Monthly: run on the same day of month
      return `${minute} ${hour} ${day} * *`;
    } else if (intervalHours === 8760) {
      // Yearly: run on the specific date/time
      return `${minute} ${hour} ${day} ${month} *`;
    } else {
      // For other intervals, fall back to regular cron
      const hours = Math.floor(intervalHours);
      return `${minute} */${hours} * * *`;
    }
  }

  /**
   * Parse start date and time into a Date object for the next occurrence
   */
  private static parseStartDateTime(
    startDate: string,
    startTime: string
  ): Date {
    const [hour, minute] = startTime.split(':').map(Number);
    const [day, month] = startDate.split('-').map(Number);

    const now = new Date();
    const targetDate = new Date(
      now.getFullYear(),
      month - 1,
      day,
      hour,
      minute,
      0
    );

    // If the target date is in the past, move to next year
    if (targetDate < now) {
      targetDate.setFullYear(now.getFullYear() + 1);
    }

    return targetDate;
  }

  /**
   * Calculate the next run time based on the first sync time and interval
   */
  private static calculateNextRunFromFirstSync(
    firstSyncAt: string,
    intervalHours: number
  ): Date {
    const firstSync = new Date(firstSyncAt);
    const now = new Date();
    const intervalMs = intervalHours * 60 * 60 * 1000;

    // Calculate how many intervals have passed since the first sync
    const elapsed = now.getTime() - firstSync.getTime();
    const intervalsPassed = Math.floor(elapsed / intervalMs);

    // Calculate the next run time
    const nextRun = new Date(
      firstSync.getTime() + (intervalsPassed + 1) * intervalMs
    );

    // If the calculated next run is in the past (shouldn't happen, but safety check), use now + interval
    if (nextRun <= now) {
      return new Date(now.getTime() + intervalMs);
    }

    return nextRun;
  }

  /**
   * Initialize the scheduler by setting up jobs for existing collections
   */
  public static async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

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
      if (customSync?.enabled) {
        const parsed = this.parseCustomSyncSchedule(customSync);
        if (parsed.intervalHours || parsed.customCron) {
          await this.scheduleCollectionSync(
            collection.id,
            parsed.intervalHours,
            parsed.customCron,
            parsed.startDate,
            parsed.startTime,
            parsed.firstSyncAt
          );
        }
      }
    }
  }

  /**
   * Schedule a collection for individual sync
   */
  public static async scheduleCollectionSync(
    collectionId: string,
    intervalHours?: number,
    customCron?: string,
    startDate?: string,
    startTime?: string,
    firstSyncAt?: string
  ): Promise<void> {
    // Cancel existing job if it exists
    this.cancelCollectionSync(collectionId);

    try {
      let finalCronExpression: string;

      // Use custom cron if provided
      if (customCron) {
        finalCronExpression = customCron;
      } else if (intervalHours && intervalHours > 0) {
        // Generate cron from interval hours with optional start date/time
        if (startDate && startTime && intervalHours >= 24) {
          // For daily+ intervals with start date/time, create specific cron
          finalCronExpression = this.generateCronWithStartDateTime(
            intervalHours,
            startDate,
            startTime
          );
        } else if (firstSyncAt && intervalHours >= 1) {
          // Use firstSyncAt to calculate next run time for persistent scheduling
          const nextRunTime = this.calculateNextRunFromFirstSync(
            firstSyncAt,
            intervalHours
          );

          // Create a one-time job for the next calculated run, then reschedule
          const job = schedule.scheduleJob(nextRunTime, async () => {
            await this.queueCollectionSync(collectionId);
            // Reschedule for next interval
            await this.scheduleCollectionSync(
              collectionId,
              intervalHours,
              undefined,
              undefined,
              undefined,
              firstSyncAt
            );
          });

          if (job) {
            this.jobs.set(collectionId, {
              collectionId,
              job,
              intervalHours,
              customCron,
            });

            logger.info(
              `Scheduled individual collection sync with persistent timing`,
              {
                label: 'Individual Collection Scheduler',
                collectionId,
                intervalHours,
                firstSyncAt,
                nextRun: nextRunTime.toISOString(),
              }
            );
          }
          return; // Exit early for persistent scheduling
        } else {
          // Legacy behavior for immediate start or sub-daily intervals
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
        }
      } else {
        throw new Error('Either intervalHours or customCron must be provided');
      }

      const job = schedule.scheduleJob(finalCronExpression, async () => {
        await this.queueCollectionSync(collectionId);
      });

      if (job) {
        this.jobs.set(collectionId, {
          collectionId,
          job,
          intervalHours,
          customCron,
        });

        logger.info(`Scheduled individual collection sync`, {
          label: 'Individual Collection Scheduler',
          collectionId,
          intervalHours,
          customCron,
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
          customCron,
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
   * Wait for API to become available, then acquire lock
   */
  public static async waitForApiAccess(
    apiType: string,
    collectionId: string,
    collectionName: string,
    libraryId: string
  ): Promise<void> {
    return new Promise((resolve) => {
      // Get or create API queue
      let apiQueue = this.apiQueues.get(apiType);
      if (!apiQueue) {
        apiQueue = {
          apiType,
          inUse: false,
          waitingQueue: [],
        };
        this.apiQueues.set(apiType, apiQueue);
      }

      // If API is not in use, acquire it immediately
      if (!apiQueue.inUse) {
        apiQueue.inUse = true;
        logger.debug(`API acquired immediately: ${apiType}`, {
          label: 'Individual Collection Scheduler',
          apiType,
          collectionId,
          collectionName,
        });
        resolve();
        return;
      }

      // API is in use, add to waiting queue
      const waitingItem: ApiWaitingItem = {
        collectionId,
        collectionName,
        libraryId,
        resolve,
        scheduledAt: new Date(),
      };

      apiQueue.waitingQueue.push(waitingItem);

      logger.info(
        `Collection waiting for API access: ${collectionName} (${apiType} API, position ${apiQueue.waitingQueue.length} in queue)`,
        {
          label: 'Individual Collection Scheduler',
          apiType,
          collectionId,
          collectionName,
          queuePosition: apiQueue.waitingQueue.length,
        }
      );
    });
  }

  /**
   * Release API and process next item in waiting queue
   */
  public static releaseApiAccess(apiType: string): void {
    const apiQueue = this.apiQueues.get(apiType);
    if (!apiQueue) {
      return;
    }

    // Process next waiting item
    const nextItem = apiQueue.waitingQueue.shift();
    if (nextItem) {
      logger.info(
        `API access granted to next waiting collection: ${nextItem.collectionName} (${apiType} API)`,
        {
          label: 'Individual Collection Scheduler',
          apiType,
          collectionId: nextItem.collectionId,
          collectionName: nextItem.collectionName,
          waitingQueueRemaining: apiQueue.waitingQueue.length,
        }
      );
      // Keep API in use for the next item
      nextItem.resolve();
    } else {
      // No more waiting items, release the API
      apiQueue.inUse = false;
      logger.debug(`API released: ${apiType}`, {
        label: 'Individual Collection Scheduler',
        apiType,
      });
    }
  }

  /**
   * Check if an API is currently in use
   */
  public static isApiInUse(apiType: string): boolean {
    const apiQueue = this.apiQueues.get(apiType);
    return apiQueue?.inUse || false;
  }

  /**
   * Get all APIs currently in use
   */
  public static getApisInUse(): string[] {
    return Array.from(this.apiQueues.entries())
      .filter(([, queue]) => queue.inUse)
      .map(([apiType]) => apiType);
  }

  /**
   * Get API queue status for debugging
   */
  public static getApiQueuesStatus(): {
    apiType: string;
    inUse: boolean;
    waitingCount: number;
    waitingCollections: string[];
  }[] {
    return Array.from(this.apiQueues.entries()).map(([apiType, queue]) => ({
      apiType,
      inUse: queue.inUse,
      waitingCount: queue.waitingQueue.length,
      waitingCollections: queue.waitingQueue.map((item) => item.collectionName),
    }));
  }

  /**
   * Queue a collection for sync with collision detection and library-based queuing
   */
  private static async queueCollectionSync(
    collectionId: string
  ): Promise<void> {
    try {
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

      // Wait for API access before proceeding
      const apiType = collectionConfig.type;
      await this.waitForApiAccess(
        apiType,
        collectionId,
        collectionConfig.name,
        collectionConfig.libraryId
      );

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

      // Log differently if queuing during main sync
      if (this.fullSyncRunning) {
        logger.info(
          `Queued collection sync (will process after main sync completes): ${collectionConfig.name} (queue position: ${libraryQueue.queue.length})`,
          {
            label: 'Individual Collection Scheduler',
            collectionId,
            libraryId,
            queueSize: libraryQueue.queue.length,
            deferredUntilMainSyncComplete: true,
          }
        );
      } else {
        logger.info(
          `Queued collection sync: ${collectionConfig.name} (queue position: ${libraryQueue.queue.length})`,
          {
            label: 'Individual Collection Scheduler',
            collectionId,
            libraryId,
            queueSize: libraryQueue.queue.length,
          }
        );
      }

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

      const apiType = collectionConfig.type;

      logger.info(
        `Executing scheduled sync for collection: ${collectionConfig.name} (API: ${apiType})`,
        {
          label: 'Individual Collection Scheduler',
          collectionId,
          collectionName: collectionConfig.name,
          apiType,
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
          customDays?: number;
          minimumPlays?: number;
          priority: number;
          networksCountry?: string;
          radarrTagServerId?: number;
          radarrTagId?: number;
          radarrTagLabel?: string;
          sonarrTagServerId?: number;
          sonarrTagId?: number;
          sonarrTagLabel?: string;
        }[];
      };
      const isMultiSource =
        extendedConfig.isMultiSource &&
        (extendedConfig.sources?.length ?? 0) > 0;
      const allCollections = await plexClient.getAllCollections();

      // Use shared library cache for better matching
      const { libraryCacheService } = await import('./LibraryCacheService');
      const libraryCache = await libraryCacheService.getCache(plexClient);

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
              networksCountry: source.networksCountry,
              radarrTagServerId: source.radarrTagServerId,
              radarrTagId: source.radarrTagId,
              radarrTagLabel: source.radarrTagLabel,
              sonarrTagServerId: source.sonarrTagServerId,
              sonarrTagId: source.sonarrTagId,
              sonarrTagLabel: source.sonarrTagLabel,
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
          libraryCache
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
          libraryCache
        );
      }

      // Mark collection as synced (update needsSync status)
      settings.markCollectionSynced(collectionId, 'collection');
      settings.save();

      // Sync Plex collection ordering after collection sync
      const { HubSyncService } = await import(
        '@server/lib/collections/plex/HubSyncService'
      );
      const hubSyncService = new HubSyncService();
      await hubSyncService.syncUnifiedOrdering(plexClient);

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
    } finally {
      // Always release the API, regardless of success or failure
      const settings = getSettings();
      const collectionConfig = settings.plex.collectionConfigs?.find(
        (config) => config.id === collectionId
      );
      if (collectionConfig) {
        this.releaseApiAccess(collectionConfig.type);
      }
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
  }

  /**
   * Get status of all scheduled jobs
   */
  public static getJobsStatus(): {
    collectionId: string;
    intervalHours?: number;
    customCron?: string;
    nextRun: Date | null;
  }[] {
    const status: {
      collectionId: string;
      intervalHours?: number;
      customCron?: string;
      nextRun: Date | null;
    }[] = [];

    for (const [collectionId, jobInfo] of this.jobs) {
      status.push({
        collectionId,
        intervalHours: jobInfo.intervalHours,
        customCron: jobInfo.customCron,
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
   * Get status of all library queues and API locks
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

    // Clear all API queues as well
    const apiQueuesStatus = this.getApiQueuesStatus();
    let totalWaitingCleared = 0;

    for (const [apiType, apiQueue] of this.apiQueues) {
      totalWaitingCleared += apiQueue.waitingQueue.length;
      // Reject all waiting promises to prevent hanging
      for (const waitingItem of apiQueue.waitingQueue) {
        // We can't really reject them gracefully since they're waiting for resolve()
        // But clearing the queue will prevent them from ever resolving
        logger.debug(
          `Clearing waiting collection: ${waitingItem.collectionName}`,
          {
            label: 'Individual Collection Scheduler',
            apiType,
            collectionId: waitingItem.collectionId,
          }
        );
      }
    }

    this.apiQueues.clear();

    logger.info(`Cleared all individual collection queues and API queues`, {
      label: 'Individual Collection Scheduler',
      totalCleared,
      librariesCleared: this.libraryQueues.size,
      apiQueuesCleared: apiQueuesStatus.length,
      totalWaitingCleared,
    });
  }

  /**
   * Wait for individual syncs to complete before allowing full sync
   * No timeout - waits indefinitely (consistent with main sync behavior)
   * Main sync flag will cause individual syncs to exit their processing loops
   */
  public static async waitForIndividualSyncsToComplete(): Promise<void> {
    const checkInterval = 1000; // Check every second
    let lastLogTime = Date.now();
    const logIntervalMs = 10000; // Log status every 10 seconds to avoid spam

    let anyRunning = true;
    while (anyRunning) {
      anyRunning = Array.from(this.libraryQueues.values()).some(
        (queue) => queue.running || queue.queue.length > 0
      );

      if (!anyRunning) {
        logger.debug('All individual collection syncs have completed', {
          label: 'Individual Collection Scheduler',
        });
        return;
      }

      // Log status periodically (not every second to avoid spam)
      const now = Date.now();
      if (now - lastLogTime >= logIntervalMs) {
        logger.debug('Waiting for individual collection syncs to complete...', {
          label: 'Individual Collection Scheduler',
          runningQueues: Array.from(this.libraryQueues.values())
            .filter((q) => q.running || q.queue.length > 0)
            .map((q) => ({
              libraryId: q.libraryId,
              queueSize: q.queue.length,
              running: q.running,
              currentCollection: q.currentCollection,
            })),
        });
        lastLogTime = now;
      }

      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    }
  }

  /**
   * Process all pending queues that accumulated during main sync
   * Called after main sync completes to handle collections that were queued
   */
  public static async processPendingQueues(): Promise<void> {
    const queuesWithPendingItems = Array.from(this.libraryQueues.entries())
      .filter(([, queue]) => queue.queue.length > 0 && !queue.running)
      .map(([libraryId]) => libraryId);

    if (queuesWithPendingItems.length === 0) {
      logger.debug('No pending individual collection syncs to process', {
        label: 'Individual Collection Scheduler',
      });
      return;
    }

    logger.info(
      `Processing ${queuesWithPendingItems.length} library queues with pending individual syncs`,
      {
        label: 'Individual Collection Scheduler',
        librariesWithPendingItems: queuesWithPendingItems.length,
        totalPendingCollections: Array.from(this.libraryQueues.values()).reduce(
          (sum, queue) => sum + queue.queue.length,
          0
        ),
      }
    );

    // Process each library queue with pending items
    for (const libraryId of queuesWithPendingItems) {
      try {
        await this.processLibraryQueue(libraryId);
      } catch (error) {
        logger.error(
          `Failed to process pending queue for library ${libraryId}: ${error}`,
          {
            label: 'Individual Collection Scheduler',
            libraryId,
            error: error instanceof Error ? error.message : String(error),
          }
        );
      }
    }

    logger.info('Finished processing pending individual collection syncs', {
      label: 'Individual Collection Scheduler',
    });
  }
}

// Export singleton instance
export const individualCollectionScheduler = IndividualCollectionScheduler;
