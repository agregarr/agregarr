import type { MaintainerrCollection } from '@server/api/maintainerr';
import type { PlexLibraryItem } from '@server/api/plexapi';
import PlexAPI from '@server/api/plexapi';
import type { RadarrMovie } from '@server/api/servarr/radarr';
import type { SonarrSeries } from '@server/api/servarr/sonarr';
import { getRepository } from '@server/datasource';
import { OverlayLibraryConfig } from '@server/entity/OverlayLibraryConfig';
import { OverlayTemplate } from '@server/entity/OverlayTemplate';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  buildRenderContext,
  checkMonitoringStatus,
  fetchReleaseDateInfo,
} from './OverlayContextBuilder';
import type { OverlayRenderContext } from './OverlayTemplateRenderer';
import {
  evaluateCondition,
  overlayTemplateRenderer,
} from './OverlayTemplateRenderer';

/**
 * Input for overlay application - either a simple rating key or with context overrides
 */
export interface OverlayItemInput {
  ratingKey: string;
  contextOverrides?: Partial<OverlayRenderContext>;
}

/**
 * Job state machine states
 */
export type JobState =
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'cancelled'
  | 'failed';

/**
 * Internal progress tracking for a library overlay job
 */
interface LibraryProgress {
  // Identity
  libraryName: string;
  startTime: number;

  // State machine
  state: JobState;
  completedAt?: number; // For TTL cleanup after completion

  // Progress
  totalItems: number;
  currentItem: number;
  currentTitle: string;
  filteredCount: number; // Episodes/seasons skipped by type filter

  // Outcome counts
  // INVARIANT: successCount + errorCount + skippedCount + filteredCount === currentItem
  successCount: number;
  errorCount: number;
  skippedCount: number; // Items with no changes (hash matched)

  // ETA calculation (private, not serialized)
  _recentItemTimes: number[]; // Rolling window of last 20 item timestamps
  _promise: Promise<void>; // For mutex, not serialized
}

/**
 * Public status shape returned by API
 */
export interface LibraryStatus {
  running: boolean;
  state: JobState;
  libraryName: string;
  startTime: number;
  runningFor: number;
  totalItems: number;
  currentItem: number;
  currentTitle: string;
  filteredCount: number;
  successCount: number;
  errorCount: number;
  skippedCount: number;
  progressPercent: number; // Clamped 0-100
  estimatedSecondsRemaining: number | null; // Capped at 7200 (2h)
}

/**
 * Result from applying overlays to a single item
 */
interface OverlayApplyResult {
  skipped: boolean; // true if nothing changed (hash match)
}

/**
 * Service for applying overlay templates to Plex library items
 */
class OverlayLibraryService {
  // Cache for Radarr/Sonarr library data (per job)
  private radarrMoviesCache?: Map<string, RadarrMovie[]>;
  private sonarrSeriesCache?: Map<string, SonarrSeries[]>;
  private maintainerrCollectionsCache?: MaintainerrCollection[];

  // Track running libraries with mutex-like behavior and detailed progress
  // Prevents concurrent processing of the same library
  private runningLibraries = new Map<string, LibraryProgress>();

  // Track libraries that have been requested to cancel
  private cancelledLibraries = new Set<string>();

  // TTL for completed jobs (visible to UI before cleanup)
  private static readonly COMPLETED_TTL_MS = 10_000;

  /**
   * Request cancellation of a library overlay job
   * Returns 'requested' if newly requested, 'already' if already cancelling, 'not_found' otherwise
   */
  public requestCancellation(
    libraryId: string
  ): 'requested' | 'already' | 'not_found' {
    const progress = this.runningLibraries.get(libraryId);
    if (!progress) {
      return 'not_found';
    }
    if (progress.state === 'cancelling') {
      return 'already'; // Idempotent - already in progress
    }
    if (progress.state === 'running') {
      this.cancelledLibraries.add(libraryId);
      progress.state = 'cancelling';
      return 'requested';
    }
    return 'not_found'; // Job completed/failed/cancelled
  }

  /**
   * Safely update progress for a library (while running or cancelling)
   * Allows final progress updates during cancellation to maintain count accuracy
   */
  private updateProgress(
    libraryId: string,
    mutator: (progress: LibraryProgress) => void
  ): void {
    const progress = this.runningLibraries.get(libraryId);
    if (
      progress &&
      (progress.state === 'running' || progress.state === 'cancelling')
    ) {
      mutator(progress);
    }
  }

  /**
   * Clean up completed jobs after TTL expires
   */
  private cleanupCompletedJobs(): void {
    const now = Date.now();
    for (const [id, status] of this.runningLibraries) {
      if (
        status.completedAt &&
        now - status.completedAt > OverlayLibraryService.COMPLETED_TTL_MS
      ) {
        this.runningLibraries.delete(id);
      }
    }
  }

  /**
   * Calculate ETA using rolling average of recent item times
   * Returns null if not enough data, caps at 2 hours
   */
  private calculateEta(progress: LibraryProgress): number | null {
    const times = progress._recentItemTimes;

    // Need at least 5 samples and library must have 20+ items
    if (times.length < 5 || progress.totalItems < 20) {
      return null;
    }

    // Calculate average ms per item from rolling window
    const windowDuration = times[times.length - 1] - times[0];
    const avgMsPerItem = windowDuration / (times.length - 1);

    // Estimate remaining time
    const remaining = progress.totalItems - progress.currentItem;
    const etaMs = remaining * avgMsPerItem;

    // Cap at 2 hours (7200 seconds)
    return Math.min(7200, Math.round(etaMs / 1000));
  }

  /**
   * Get status for a specific library
   */
  public getLibraryStatus(
    libraryId: string
  ): LibraryStatus | { running: false } {
    // Clean up expired entries first
    this.cleanupCompletedJobs();

    const progress = this.runningLibraries.get(libraryId);
    if (!progress) {
      return { running: false };
    }

    const runningFor = Math.round((Date.now() - progress.startTime) / 1000);

    // Calculate progress percent (clamped 0-100)
    const rawPercent =
      progress.totalItems > 0
        ? (progress.currentItem / progress.totalItems) * 100
        : 0;
    const progressPercent = Math.min(100, Math.max(0, Math.round(rawPercent)));

    // Calculate ETA
    const estimatedSecondsRemaining = this.calculateEta(progress);

    // Return cloned status object
    return {
      running: progress.state === 'running' || progress.state === 'cancelling',
      state: progress.state,
      libraryName: progress.libraryName,
      startTime: progress.startTime,
      runningFor,
      totalItems: progress.totalItems,
      currentItem: progress.currentItem,
      currentTitle: progress.currentTitle,
      filteredCount: progress.filteredCount,
      successCount: progress.successCount,
      errorCount: progress.errorCount,
      skippedCount: progress.skippedCount,
      progressPercent,
      estimatedSecondsRemaining,
    };
  }

  /**
   * Get all running libraries with full status
   */
  public getAllRunningLibraries(): (LibraryStatus & { libraryId: string })[] {
    this.cleanupCompletedJobs();

    return Array.from(this.runningLibraries.keys())
      .map((libraryId) => {
        const status = this.getLibraryStatus(libraryId);
        if ('state' in status) {
          return { libraryId, ...status };
        }
        return null;
      })
      .filter((s): s is LibraryStatus & { libraryId: string } => s !== null);
  }

  /**
   * Clear library caches (call at start of overlay job)
   */
  private clearLibraryCaches() {
    this.radarrMoviesCache = new Map();
    this.sonarrSeriesCache = new Map();
    this.maintainerrCollectionsCache = undefined;
  }

  /**
   * Apply overlays to all items in a library
   * Uses mutex-like behavior to prevent concurrent processing of the same library
   */
  async applyOverlaysToLibrary(
    libraryId: string,
    checkCancelled?: () => boolean
  ): Promise<void> {
    // Mutex: wait for any in-progress job to complete before starting
    // Loop to handle multiple waiters waking up simultaneously
    let existing = this.runningLibraries.get(libraryId);
    while (
      existing &&
      (existing.state === 'running' || existing.state === 'cancelling')
    ) {
      logger.warn('Library already being processed, waiting for completion', {
        label: 'OverlayLibrary',
        libraryId,
        libraryName: existing.libraryName,
        state: existing.state,
        startedAt: new Date(existing.startTime).toISOString(),
        runningFor: `${Math.round((Date.now() - existing.startTime) / 1000)}s`,
      });
      // Wait for existing job, catch errors so retries proceed after failures
      await existing._promise.catch(() => undefined);
      // Re-check in case another waiter started a new job
      existing = this.runningLibraries.get(libraryId);
    }

    // Clean up old completed jobs
    this.cleanupCompletedJobs();

    // Create a deferred promise to set in the map immediately
    // This prevents race conditions where two calls pass the check before either awaits
    let resolveDeferred: () => void;
    let rejectDeferred: (error: Error) => void;
    const deferredPromise = new Promise<void>((resolve, reject) => {
      resolveDeferred = resolve;
      rejectDeferred = reject;
    });

    // Initialize progress with all fields BEFORE any await (to prevent race condition)
    this.runningLibraries.set(libraryId, {
      libraryName: libraryId, // Will update after config fetch
      startTime: Date.now(),
      state: 'running',
      completedAt: undefined,
      totalItems: 0,
      currentItem: 0,
      currentTitle: '',
      filteredCount: 0,
      successCount: 0,
      errorCount: 0,
      skippedCount: 0,
      _recentItemTimes: [],
      _promise: deferredPromise,
    });

    // Create cancellation checker that includes both external callback and internal set
    const combinedCheckCancelled = () => {
      if (checkCancelled && checkCancelled()) return true;
      return this.cancelledLibraries.has(libraryId);
    };

    try {
      // Get library configuration
      const configRepository = getRepository(OverlayLibraryConfig);
      const config = await configRepository.findOne({
        where: { libraryId },
      });

      // Update libraryName now that we have config
      this.updateProgress(libraryId, (p) => {
        p.libraryName = config?.libraryName || libraryId;
      });

      // Process the library
      await this.processLibraryOverlays(
        libraryId,
        config,
        combinedCheckCancelled
      );

      // Mark completed (stays in map for TTL period)
      // Set completedAt for ANY state to ensure TTL cleanup works
      const progress = this.runningLibraries.get(libraryId);
      if (progress) {
        // If still running, mark completed. If cancelling but finished, mark cancelled.
        if (progress.state === 'running') {
          progress.state = 'completed';
        } else if (progress.state === 'cancelling') {
          progress.state = 'cancelled';
        }
        // Always set completedAt for TTL cleanup
        progress.completedAt = Date.now();
      }
      resolveDeferred!();
    } catch (error) {
      // Mark failed
      const progress = this.runningLibraries.get(libraryId);
      if (progress) {
        progress.state = 'failed';
        progress.completedAt = Date.now();
      }
      rejectDeferred!(
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    } finally {
      // Clean up cancellation flag
      this.cancelledLibraries.delete(libraryId);
    }
  }

  /**
   * Internal method to process library overlays
   */
  private async processLibraryOverlays(
    libraryId: string,
    config: OverlayLibraryConfig | null,
    checkCancelled?: () => boolean
  ): Promise<void> {
    try {
      // Clear library caches at start of job
      this.clearLibraryCaches();

      logger.info('Starting overlay application for library', {
        label: 'OverlayLibrary',
        libraryId,
      });

      if (!config || config.enabledOverlays.length === 0) {
        logger.info('No overlays enabled for library', {
          label: 'OverlayLibrary',
          libraryId,
        });
        return;
      }

      // Get enabled overlay templates
      const templateRepository = getRepository(OverlayTemplate);
      const enabledTemplateIds = config.enabledOverlays
        .filter((o) => o.enabled)
        .map((o) => o.templateId);

      const templates = await templateRepository.findByIds(enabledTemplateIds);

      if (templates.length === 0) {
        logger.info('No templates found for library', {
          label: 'OverlayLibrary',
          libraryId,
        });
        return;
      }

      // Sort templates by layer order
      const sortedTemplates = templates.sort((a, b) => {
        const orderA =
          config.enabledOverlays.find((o) => o.templateId === a.id)
            ?.layerOrder || 0;
        const orderB =
          config.enabledOverlays.find((o) => o.templateId === b.id)
            ?.layerOrder || 0;
        return orderA - orderB;
      });

      logger.info('Applying overlays to library', {
        label: 'OverlayLibrary',
        libraryId,
        templateCount: sortedTemplates.length,
        templates: sortedTemplates.map((t) => t.name),
      });

      // Fetch Maintainerr collections once for the entire job
      const settings = getSettings();
      if (settings.maintainerr?.hostname && settings.maintainerr?.apiKey) {
        try {
          const MaintainerrAPI = (await import('@server/api/maintainerr'))
            .default;
          const maintainerrClient = new MaintainerrAPI(settings.maintainerr);
          this.maintainerrCollectionsCache =
            await maintainerrClient.getCollections();
          logger.info('Fetched Maintainerr collections for overlay job', {
            label: 'OverlayLibrary',
            collectionsCount: this.maintainerrCollectionsCache.length,
          });
        } catch (error) {
          logger.error('Failed to fetch Maintainerr collections', {
            label: 'OverlayLibrary',
            error: error instanceof Error ? error.message : String(error),
          });
          this.maintainerrCollectionsCache = [];
        }
      }

      // Get library items from Plex
      const { getAdminUser } = await import(
        '@server/lib/collections/core/CollectionUtilities'
      );
      const admin = await getAdminUser();

      if (!admin) {
        throw new Error('No admin user found');
      }

      const plexApi = new PlexAPI({ plexToken: admin.plexToken });

      // Fetch all items (handle pagination)
      let allItems: PlexLibraryItem[] = [];
      let offset = 0;
      const pageSize = 50;
      let hasMore = true;

      // Paginate through all library items
      while (hasMore) {
        const response = await plexApi.getLibraryContents(libraryId, {
          offset,
          size: pageSize,
        });

        allItems = allItems.concat(response.items);

        if (offset + pageSize >= response.totalSize) {
          hasMore = false;
        }

        offset += pageSize;
      }

      // Set total items count
      this.updateProgress(libraryId, (p) => {
        p.totalItems = allItems.length;
      });

      logger.info('Processing library items', {
        label: 'OverlayLibrary',
        libraryId,
        itemCount: allItems.length,
      });

      // Handle empty library - mark completed immediately
      if (allItems.length === 0) {
        logger.info('Library has no items to process', {
          label: 'OverlayLibrary',
          libraryId,
        });
        return;
      }

      // Process each item
      for (const item of allItems) {
        // CRITICAL: Skip episodes and seasons - overlays only apply to movies and shows
        if (item.type === 'episode' || item.type === 'season') {
          this.updateProgress(libraryId, (p) => {
            p.currentItem++; // Advance currentItem to maintain accurate progress %
            p.filteredCount++;
          });
          continue;
        }

        // Check for cancellation FIRST
        if (checkCancelled && checkCancelled()) {
          // Transition to cancelling state
          const progress = this.runningLibraries.get(libraryId);
          if (progress) {
            progress.state = 'cancelling';
          }

          logger.info(
            'Overlay application cancelled during library processing',
            {
              label: 'OverlayLibrary',
              libraryId,
              processedItems: progress?.currentItem || 0,
              totalItems: allItems.length,
            }
          );

          // Mark cancelled (not completed)
          if (progress) {
            progress.state = 'cancelled';
            progress.completedAt = Date.now();
          }
          return; // Exit early, don't continue processing
        }

        // Update current item title (before processing)
        this.updateProgress(libraryId, (p) => {
          p.currentTitle = item.title || '';
        });

        try {
          // Fetch full metadata including Stream details (needed for HDR, bitDepth, etc.)
          const fullMetadata = await plexApi.getMetadata(item.ratingKey);

          // Merge full metadata with library item
          const itemWithFullMetadata = {
            ...item,
            Media: fullMetadata.Media,
          };

          const result = await this.applyOverlaysToItem(
            plexApi,
            itemWithFullMetadata,
            sortedTemplates,
            config.mediaType,
            libraryId,
            config.libraryName
          );

          // Update counts AFTER outcome is known
          this.updateProgress(libraryId, (p) => {
            p.currentItem++;

            // Track timing for ETA
            p._recentItemTimes.push(Date.now());
            if (p._recentItemTimes.length > 20) {
              p._recentItemTimes.shift();
            }

            if (result.skipped) {
              p.skippedCount++;
            } else {
              p.successCount++;
            }
          });
        } catch (error) {
          // Update error count AFTER failure
          this.updateProgress(libraryId, (p) => {
            p.currentItem++;
            p.errorCount++;

            // Track timing for ETA even on errors
            p._recentItemTimes.push(Date.now());
            if (p._recentItemTimes.length > 20) {
              p._recentItemTimes.shift();
            }
          });

          logger.error('Failed to apply overlays to item', {
            label: 'OverlayLibrary',
            itemTitle: item.title,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            errorDetails: error,
          });
          // Continue with next item
        }
      }

      // Get final counts from progress
      const finalProgress = this.runningLibraries.get(libraryId);
      logger.info('Completed overlay application for library', {
        label: 'OverlayLibrary',
        libraryId,
        successCount: finalProgress?.successCount || 0,
        errorCount: finalProgress?.errorCount || 0,
        skippedCount: finalProgress?.skippedCount || 0,
        filteredCount: finalProgress?.filteredCount || 0,
      });
    } catch (error) {
      logger.error('Failed to apply overlays to library', {
        label: 'OverlayLibrary',
        libraryId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    // Note: runningLibraries cleanup is handled by the caller (applyOverlaysToLibrary)
  }

  /**
   * Apply overlays to specific collection items only
   * Used by "Apply overlays during sync" feature
   *
   * @param items - Either an array of rating keys (string[]) or items with context overrides (OverlayItemInput[])
   * @param libraryId - The Plex library ID
   */
  async applyOverlaysToCollectionItems(
    items: string[] | OverlayItemInput[],
    libraryId: string
  ): Promise<void> {
    try {
      // Clear library caches at start of job
      this.clearLibraryCaches();

      // Normalize input to OverlayItemInput[]
      const normalizedItems: OverlayItemInput[] = items.map((item) =>
        typeof item === 'string' ? { ratingKey: item } : item
      );

      logger.info('Applying overlays to collection items', {
        label: 'OverlayLibrary',
        itemCount: normalizedItems.length,
        libraryId,
      });

      // Get library configuration for templates
      const configRepository = getRepository(OverlayLibraryConfig);
      const config = await configRepository.findOne({
        where: { libraryId },
      });

      // Early return if no overlays configured (same logic as applyOverlaysToLibrary)
      if (!config || config.enabledOverlays.length === 0) {
        logger.info(
          'No overlays enabled for library, skipping overlay application',
          {
            label: 'OverlayLibrary',
            libraryId,
          }
        );
        return;
      }

      // Get enabled overlay templates
      const templateRepository = getRepository(OverlayTemplate);
      const enabledTemplateIds = config.enabledOverlays
        .filter((o) => o.enabled)
        .map((o) => o.templateId);

      const templates = await templateRepository.findByIds(enabledTemplateIds);

      if (templates.length === 0) {
        logger.info(
          'No templates found for library, skipping overlay application',
          {
            label: 'OverlayLibrary',
            libraryId,
          }
        );
        return;
      }

      // Sort templates by layer order
      const sortedTemplates = templates.sort((a, b) => {
        const orderA =
          config.enabledOverlays.find((o) => o.templateId === a.id)
            ?.layerOrder || 0;
        const orderB =
          config.enabledOverlays.find((o) => o.templateId === b.id)
            ?.layerOrder || 0;
        return orderA - orderB;
      });

      // Get admin user for Plex API
      const { getAdminUser } = await import(
        '@server/lib/collections/core/CollectionUtilities'
      );
      const admin = await getAdminUser();

      if (!admin) {
        throw new Error('No admin user found');
      }

      const plexApi = new PlexAPI({ plexToken: admin.plexToken });

      // Determine media type from library config
      const mediaType = config.mediaType || 'movie';

      // Process each item
      let successCount = 0;
      let errorCount = 0;

      for (const { ratingKey, contextOverrides } of normalizedItems) {
        try {
          // Fetch item metadata
          const itemMetadata = await plexApi.getMetadata(ratingKey);

          if (itemMetadata) {
            // CRITICAL: Skip episodes and seasons - overlays only apply to movies and shows
            if (
              itemMetadata.type === 'episode' ||
              itemMetadata.type === 'season'
            ) {
              continue;
            }

            // Convert to PlexLibraryItem format (cast to satisfy type requirements)
            const item = {
              ratingKey: itemMetadata.ratingKey,
              title: itemMetadata.title,
              year: (itemMetadata as { year?: number }).year,
              type: itemMetadata.type,
              guid: itemMetadata.guid || '',
              Guid: itemMetadata.Guid,
              Media: itemMetadata.Media,
              parentIndex: itemMetadata.parentIndex,
              index: itemMetadata.index,
              addedAt: itemMetadata.addedAt || 0,
              updatedAt: itemMetadata.updatedAt || 0,
              editionTitle: (itemMetadata as { editionTitle?: string })
                .editionTitle,
            } as PlexLibraryItem;

            await this.applyOverlaysToItem(
              plexApi,
              item,
              sortedTemplates,
              mediaType,
              libraryId,
              config.libraryName,
              contextOverrides
            );
            successCount++;
          }
        } catch (error) {
          errorCount++;
          logger.error('Failed to apply overlays to collection item', {
            label: 'OverlayLibrary',
            ratingKey,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      logger.info('Completed overlay application for collection items', {
        label: 'OverlayLibrary',
        successCount,
        errorCount,
        totalItems: normalizedItems.length,
      });
    } catch (error) {
      logger.error('Failed to apply overlays to collection items', {
        label: 'OverlayLibrary',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Apply overlays to a single Plex item
   *
   * NOTE: configuredLibraryType is the library's configured type, but PlexBasePosterManager
   * will use item.type for TMDB API calls to prevent fetching wrong posters
   */
  private async applyOverlaysToItem(
    plexApi: PlexAPI,
    item: PlexLibraryItem,
    templates: OverlayTemplate[],
    configuredLibraryType: 'movie' | 'show',
    libraryId: string,
    libraryName: string,
    contextOverrides?: Partial<OverlayRenderContext>
  ): Promise<OverlayApplyResult> {
    try {
      // CRITICAL: Derive actual media type from item.type, not library config
      // This prevents TMDB API namespace mismatches that cause wrong posters
      const actualMediaType: 'movie' | 'show' =
        item.type === 'movie' ? 'movie' : 'show';

      // Warn if there's a mismatch between item type and library config
      if (actualMediaType !== configuredLibraryType) {
        logger.warn('Item type does not match library configuration', {
          label: 'OverlayLibrary',
          itemTitle: item.title,
          ratingKey: item.ratingKey,
          itemType: item.type,
          configuredLibraryType,
          usingType: actualMediaType,
        });
      }

      // Get metadata tracking for this item
      const metadataService = (
        await import('@server/lib/metadata/MetadataTrackingService')
      ).default;
      const metadata = await metadataService.getItemMetadata(item.ratingKey);

      // Extract TMDB ID from item GUIDs
      let tmdbId: number | undefined;
      if (item.Guid && Array.isArray(item.Guid)) {
        const tmdbGuid = item.Guid.find((g) => g.id?.includes('tmdb://'));
        if (tmdbGuid) {
          const match = tmdbGuid.id.match(/tmdb:\/\/(\d+)/);
          if (match) {
            tmdbId = parseInt(match[1]);
          }
        }
      }

      // Check if this is a placeholder (async version with API call for suspicious items)
      const { placeholderContextService } = await import(
        '@server/lib/placeholders/services/PlaceholderContextService'
      );
      const plexMetadata = item as {
        type: string;
        guid?: string;
        editionTitle?: string;
        Guid?: { id: string }[];
        childCount?: number;
        Children?: { Metadata?: unknown[] };
        seasonCount?: number;
        leafCount?: number;
        ratingKey?: string;
      };

      logger.debug('Calling async placeholder detection', {
        label: 'OverlayLibrary',
        itemTitle: item.title,
        ratingKey: item.ratingKey,
        leafCount: plexMetadata.leafCount,
        type: plexMetadata.type,
      });

      const isPlaceholder =
        await placeholderContextService.isPlaceholderItemAsync(
          plexMetadata,
          plexApi['plexClient'] as {
            query: (path: string) => Promise<{
              MediaContainer?: { Directory?: unknown[]; Metadata?: unknown[] };
            }>;
          }
        );

      logger.debug('Async placeholder detection result', {
        label: 'OverlayLibrary',
        itemTitle: item.title,
        ratingKey: item.ratingKey,
        isPlaceholder,
      });

      // Build base context for dynamic fields
      const baseContext = await buildRenderContext(
        item,
        actualMediaType,
        isPlaceholder,
        this.maintainerrCollectionsCache
      );

      // Fetch fresh release date information for ALL items with TMDB ID
      let releaseDateContext: Partial<OverlayRenderContext> = {};
      if (tmdbId) {
        const releaseDateInfo = await fetchReleaseDateInfo(
          tmdbId,
          actualMediaType
        );

        if (releaseDateInfo) {
          // Calculate days until release and days ago
          const { calculateDaysSince } = await import(
            '@server/utils/dateHelpers'
          );
          let daysUntilRelease: number | undefined;
          let daysAgo: number | undefined;
          let daysUntilNextEpisode: number | undefined;
          let daysUntilNextSeason: number | undefined;
          let daysAgoNextSeason: number | undefined;

          if (releaseDateInfo.releaseDate) {
            const daysSince = calculateDaysSince(releaseDateInfo.releaseDate);
            if (daysSince < 0) {
              daysUntilRelease = -daysSince;
            } else {
              daysAgo = daysSince;
            }
          }

          if (releaseDateInfo.nextEpisodeAirDate) {
            const daysSince = calculateDaysSince(
              releaseDateInfo.nextEpisodeAirDate
            );
            if (daysSince < 0) {
              daysUntilNextEpisode = -daysSince;
            }
          }

          if (releaseDateInfo.nextSeasonAirDate) {
            const daysSince = calculateDaysSince(
              releaseDateInfo.nextSeasonAirDate
            );
            if (daysSince < 0) {
              daysUntilNextSeason = -daysSince;
            } else {
              daysAgoNextSeason = daysSince;
            }
          }

          releaseDateContext = {
            releaseDate: releaseDateInfo.releaseDate,
            daysUntilRelease,
            daysAgo,
            nextEpisodeAirDate: releaseDateInfo.nextEpisodeAirDate,
            daysUntilNextEpisode,
            nextSeasonAirDate: releaseDateInfo.nextSeasonAirDate,
            daysUntilNextSeason,
            daysAgoNextSeason,
            seasonNumber: releaseDateInfo.seasonNumber,
          };
        }
      }

      // Check monitoring status for ALL items with TMDB ID
      let monitoringContext: Partial<OverlayRenderContext> = {};
      if (tmdbId) {
        monitoringContext = await checkMonitoringStatus(
          tmdbId,
          actualMediaType,
          this.radarrMoviesCache,
          this.sonarrSeriesCache
        );
      }

      // Merge contexts: base → release dates → monitoring → explicit overrides
      // Set isPlaceholder and downloaded at the end so they're always present

      // CRITICAL: If *arr reports hasFile=true, the item CANNOT be a placeholder
      // This overrides incorrect placeholder detection (e.g., corrupted metadata)
      let actualIsPlaceholder = isPlaceholder;
      if (monitoringContext.hasFile === true) {
        actualIsPlaceholder = false; // *arr has files, so it's definitely not a placeholder
      }

      // For downloaded: placeholders are never downloaded, real items check *arr hasFile status
      let downloaded: boolean;
      if (actualIsPlaceholder) {
        downloaded = false; // Placeholders are never downloaded
      } else if (typeof monitoringContext.hasFile === 'boolean') {
        downloaded = monitoringContext.hasFile; // Real monitored items use *arr hasFile status
      } else {
        downloaded = true; // Real items not in *arr are assumed downloaded (they exist in Plex)
      }

      const context: OverlayRenderContext = {
        ...baseContext,
        isPlaceholder: actualIsPlaceholder,
        downloaded,
        ...contextOverrides,
        ...releaseDateContext,
        ...monitoringContext,
      };

      // Filter templates by conditions to get only templates that will actually be applied
      // CRITICAL: Hash must be based on MATCHING templates, not all enabled templates
      // This ensures hash changes when different templates match due to context changes
      const matchingTemplates = templates.filter((template) => {
        const condition = template.getApplicationCondition();
        return evaluateCondition(condition, context);
      });

      // Calculate overlay input hash for metadata tracking
      // Extract which context fields are actually used by MATCHING templates
      // CRITICAL: Hash uses matching template IDs + variable field values + condition field values
      // Template IDs capture which templates match, field values capture all data affecting rendering
      const { calculateOverlayInputHash, extractUsedContextFields } =
        await import('@server/utils/metadataHashing');

      const templateDataArray = matchingTemplates.map((t) =>
        t.getTemplateData()
      );
      const applicationConditions = matchingTemplates.map((t) =>
        t.getApplicationCondition()
      );
      const usedFields = extractUsedContextFields(
        templateDataArray,
        applicationConditions
      );

      const overlayInputHash = calculateOverlayInputHash({
        templateIds: matchingTemplates.map((t) => t.id).sort(),
        usedFields: usedFields,
        context: context as Record<string, unknown>,
      });

      // Debug logging for hash comparison
      logger.debug('Overlay hash comparison', {
        label: 'OverlayLibrary',
        itemTitle: item.title,
        ratingKey: item.ratingKey,
        oldHash: metadata?.lastOverlayInputHash,
        newHash: overlayInputHash,
        matchingTemplateIds: matchingTemplates.map((t) => t.id).sort(),
        matchingTemplateNames: matchingTemplates.map((t) => t.name),
        usedFields: Array.from(usedFields),
        contextValues: {
          downloaded: context.downloaded,
          hasFile: context.hasFile,
          isMonitored: context.isMonitored,
          inSonarr: context.inSonarr,
          daysAgo: context.daysAgo,
          isPlaceholder: context.isPlaceholder,
        },
      });

      // OPTIMIZATION: Check if overlay inputs changed BEFORE downloading poster
      // This prevents expensive poster downloads when nothing has changed
      try {
        const currentPosterUrl = await plexApi.getCurrentPosterUrl(
          item.ratingKey
        );

        const overlayInputsChanged =
          metadata?.lastOverlayInputHash !== overlayInputHash;

        // Check if Plex poster changed using normalized comparison
        // This handles different URL formats (upload://, /library/metadata/, http://...)
        const { posterUrlsMatch, extractThumbId } = await import(
          '@server/utils/posterUrlHelpers'
        );
        const plexPosterMissing = !posterUrlsMatch(
          metadata?.ourOverlayPosterUrl,
          currentPosterUrl
        );

        // Debug logging for poster URL comparison
        logger.debug('Poster URL comparison', {
          label: 'OverlayLibrary',
          itemTitle: item.title,
          storedUrl: metadata?.ourOverlayPosterUrl,
          currentUrl: currentPosterUrl,
          storedThumbId: extractThumbId(metadata?.ourOverlayPosterUrl),
          currentThumbId: extractThumbId(currentPosterUrl),
          urlsMatch: !plexPosterMissing,
          plexPosterMissing,
        });

        // Also check if base poster source changed (TMDB vs Plex)
        const settings = getSettings();
        const posterSource = settings.overlays?.defaultPosterSource || 'tmdb';
        const basePosterSourceChanged =
          metadata?.basePosterSource !== posterSource;

        if (
          !overlayInputsChanged &&
          !plexPosterMissing &&
          !basePosterSourceChanged
        ) {
          logger.debug('Nothing changed, skipping overlay application', {
            label: 'OverlayLibrary',
            itemTitle: item.title,
            ratingKey: item.ratingKey,
            overlayInputsChanged: false,
            plexPosterMissing: false,
            basePosterSourceChanged: false,
          });
          return { skipped: true }; // Skip this item - no need to download poster
        }

        logger.info('Applying overlays - changes detected', {
          label: 'OverlayLibrary',
          itemTitle: item.title,
          overlayInputsChanged,
          plexPosterMissing,
          basePosterSourceChanged,
        });
      } catch (metaError) {
        logger.warn('Metadata check failed, proceeding with overlay', {
          label: 'MetadataTracking',
          error:
            metaError instanceof Error ? metaError.message : String(metaError),
        });
        // Fall through to apply overlay
      }

      // ONLY download poster if we've determined changes exist
      // Get poster source preference (global setting)
      const settings = getSettings();
      const posterSource = settings.overlays?.defaultPosterSource || 'tmdb';

      // Get base poster with change detection
      const { plexBasePosterManager } = await import(
        '@server/lib/overlays/PlexBasePosterManager'
      );

      let basePosterResult: {
        posterBuffer: Buffer;
        basePosterChanged: boolean;
        sourceUrl: string;
        filename: string;
        fileModTime?: number | null;
      };

      try {
        basePosterResult = await plexBasePosterManager.getBasePosterForOverlay(
          plexApi,
          item,
          libraryId,
          libraryName,
          configuredLibraryType,
          posterSource,
          {
            basePosterSource: metadata?.basePosterSource,
            originalPlexPosterUrl: metadata?.originalPlexPosterUrl,
            ourOverlayPosterUrl: metadata?.ourOverlayPosterUrl,
            basePosterFilename: metadata?.basePosterFilename,
            localPosterModifiedTime: metadata?.localPosterModifiedTime,
          },
          tmdbId
        );
      } catch (error) {
        // Re-throw to let caller track this as a failure
        // Previously this was silently returning, causing failed items to be counted as success
        throw new Error(
          `Failed to get base poster for "${item.title}": ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }

      const posterBuffer = basePosterResult.posterBuffer;

      // Apply each template in order
      let currentBuffer = posterBuffer;
      let templatesApplied = 0;

      for (const template of templates) {
        // Check if application condition is met
        const condition = template.getApplicationCondition();
        if (!evaluateCondition(condition, context)) {
          continue;
        }

        const templateData = template.getTemplateData();
        currentBuffer = await overlayTemplateRenderer.renderOverlay(
          currentBuffer,
          templateData,
          context
        );
        templatesApplied++;
      }

      // Save to temporary file
      const tempDir = os.tmpdir();
      const tempFilePath = path.join(
        tempDir,
        `overlay-${item.ratingKey}-${Date.now()}.webp`
      );

      await fs.writeFile(tempFilePath, currentBuffer);

      try {
        // Upload modified poster back to Plex
        await plexApi.uploadPosterFromFile(item.ratingKey, tempFilePath);

        // Lock poster to prevent Plex from auto-updating it during library scans
        try {
          await plexApi.lockPoster(item.ratingKey);
          logger.debug('Locked poster after overlay application', {
            label: 'OverlayLibrary',
            itemTitle: item.title,
            ratingKey: item.ratingKey,
          });
        } catch (lockError) {
          logger.warn('Failed to lock poster after overlay application', {
            label: 'OverlayLibrary',
            itemTitle: item.title,
            ratingKey: item.ratingKey,
            error:
              lockError instanceof Error
                ? lockError.message
                : String(lockError),
          });
        }

        // Record overlay metadata tracking with base poster info
        try {
          const newPosterUrl = await plexApi.getCurrentPosterUrl(
            item.ratingKey
          );

          if (newPosterUrl) {
            await metadataService.recordOverlayApplicationWithBasePoster(
              item.ratingKey,
              libraryId,
              overlayInputHash,
              newPosterUrl,
              {
                basePosterSource: posterSource,
                originalPlexPosterUrl: basePosterResult.sourceUrl,
                basePosterFilename: basePosterResult.filename,
                localPosterModifiedTime: basePosterResult.fileModTime,
              }
            );
          }
        } catch (metaError) {
          logger.error('Failed to record overlay metadata, upload succeeded', {
            label: 'MetadataTracking',
            error:
              metaError instanceof Error
                ? metaError.message
                : String(metaError),
          });
        }

        // Manage "Overlay" label based on whether overlays were applied
        if (templatesApplied > 0) {
          // Add "Overlay" label to indicate this item has overlays
          try {
            await plexApi.addLabelToItem(item.ratingKey, 'Overlay');
            logger.debug('Added Overlay label', {
              label: 'OverlayLibrary',
              itemTitle: item.title,
              ratingKey: item.ratingKey,
              templatesApplied,
            });
          } catch (error) {
            // Log but don't fail the entire operation if label addition fails
            logger.warn('Failed to add Overlay label', {
              label: 'OverlayLibrary',
              itemTitle: item.title,
              ratingKey: item.ratingKey,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        } else {
          // Remove "Overlay" label since we've reset to default poster
          try {
            await plexApi.removeLabelFromItem(item.ratingKey, 'Overlay');
            logger.debug('Removed Overlay label - no templates applied', {
              label: 'OverlayLibrary',
              itemTitle: item.title,
              ratingKey: item.ratingKey,
            });
          } catch (error) {
            // Log but don't fail the entire operation if label removal fails
            logger.warn('Failed to remove Overlay label', {
              label: 'OverlayLibrary',
              itemTitle: item.title,
              ratingKey: item.ratingKey,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        logger.info('Applied overlays to item', {
          label: 'OverlayLibrary',
          itemTitle: item.title,
          templateCount: templates.length,
          templatesApplied,
        });

        return { skipped: false };
      } finally {
        // Clean up temp file
        await fs.unlink(tempFilePath).catch(() => {
          // Ignore cleanup errors
        });
      }
    } catch (error) {
      logger.error('Failed to apply overlays to item', {
        label: 'OverlayLibrary',
        itemTitle: item.title,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        errorDetails: error,
      });
      throw error;
    }
  }
}

export const overlayLibraryService = new OverlayLibraryService();
