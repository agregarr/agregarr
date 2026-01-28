/**
 * Randomize Home Order Service
 *
 * Shuffles the home screen order of collections/hubs that have randomizeHomeOrder enabled.
 * All randomized items in a library swap positions with each other, regardless of whether
 * they are contiguous. Static items (randomizeHomeOrder=false) stay at their positions.
 *
 * IMPORTANT: Shuffling is done PER-LIBRARY because sortOrderHome is a per-library value.
 *
 * Example: If positions are [A(rand), B(static), C(rand), D(static), E(rand)]
 * Then A, C, E shuffle amongst positions 1, 3, 5 while B stays at 2, D stays at 4.
 * After shuffle, you might get: [E, B, A, D, C] or [C, B, E, D, A], etc.
 */

import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

interface CollectionItem {
  id: string;
  libraryId: string;
  sortOrderHome: number;
  randomizeHomeOrder?: boolean;
  type: 'collection' | 'hub' | 'preexisting';
}

class RandomizeHomeOrder {
  public status: { running: boolean; progress: number } = {
    running: false,
    progress: 0,
  };

  private cancelled = false;

  /**
   * Fisher-Yates shuffle algorithm
   */
  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /**
   * Find all randomized items in the library
   * Returns array of indices of items that should be shuffled together
   * Items swap positions with each other regardless of whether they're contiguous
   */
  private findRandomizedIndices(items: CollectionItem[]): number[] {
    const indices: number[] = [];

    for (let i = 0; i < items.length; i++) {
      if (items[i].randomizeHomeOrder && items[i].sortOrderHome > 0) {
        indices.push(i);
      }
    }

    return indices;
  }

  /**
   * Shuffle items within a single library and return map of id -> new sortOrderHome
   *
   * All randomized items swap positions with each other regardless of contiguity.
   * Static items stay at their positions.
   *
   * Example: If positions are [A(rand), B(static), C(rand), D(static), E(rand)]
   * Then A, C, E shuffle amongst positions 1, 3, 5 while B stays at 2, D stays at 4.
   */
  private shuffleLibraryItems(
    libraryItems: CollectionItem[]
  ): Map<string, number> {
    const newOrderMap = new Map<string, number>();

    // Sort by current sortOrderHome to establish order
    libraryItems.sort((a, b) => a.sortOrderHome - b.sortOrderHome);

    // Find all randomized items (not just contiguous groups)
    const randomizedIndices = this.findRandomizedIndices(libraryItems);

    if (randomizedIndices.length <= 1) {
      // No items to shuffle (0 or 1 randomized item)
      libraryItems.forEach((item) => {
        newOrderMap.set(`${item.type}:${item.id}`, item.sortOrderHome);
      });
      return newOrderMap;
    }

    // Get the randomized items and their original positions
    const randomizedItems = randomizedIndices.map((idx) => libraryItems[idx]);
    const originalPositions = randomizedIndices.map(
      (idx) => libraryItems[idx].sortOrderHome
    );

    // Shuffle the items
    const shuffledItems = this.shuffleArray(randomizedItems);

    // Assign shuffled items back to the original positions
    // (so they swap positions with each other)
    randomizedIndices.forEach((idx, i) => {
      libraryItems[idx] = {
        ...shuffledItems[i],
        sortOrderHome: originalPositions[i],
      };
    });

    // Build the result map with final sortOrderHome values
    libraryItems.forEach((item) => {
      newOrderMap.set(`${item.type}:${item.id}`, item.sortOrderHome);
    });

    return newOrderMap;
  }

  /**
   * Randomize home order for all collections/hubs that have randomizeHomeOrder enabled
   */
  public async run(): Promise<void> {
    if (this.status.running) {
      logger.warn('Randomize Home Order already in progress', {
        label: 'Randomize Home Order',
      });
      return;
    }

    // Check if collections sync is running to prevent conflicts
    const collectionsSync = (await import('@server/lib/collectionsSync'))
      .default;
    if (collectionsSync.running) {
      logger.warn(
        'Collections sync is currently running. Skipping randomization to avoid conflicts.',
        {
          label: 'Randomize Home Order',
        }
      );
      return;
    }

    logger.info('Starting Randomize Home Order', {
      label: 'Randomize Home Order',
    });

    this.status.running = true;
    this.status.progress = 0;
    this.cancelled = false;

    try {
      const settings = getSettings();

      // Group items by library - sortOrderHome is per-library
      const itemsByLibrary = new Map<string, CollectionItem[]>();

      // Add Agregarr-created collections (only those positioned on home screen)
      if (settings.plex.collectionConfigs) {
        settings.plex.collectionConfigs.forEach((config) => {
          const sortOrder = config.sortOrderHome || 0;
          if (sortOrder > 0) {
            if (!itemsByLibrary.has(config.libraryId)) {
              itemsByLibrary.set(config.libraryId, []);
            }
            itemsByLibrary.get(config.libraryId)?.push({
              id: config.id,
              libraryId: config.libraryId,
              sortOrderHome: sortOrder,
              randomizeHomeOrder: config.randomizeHomeOrder,
              type: 'collection',
            });
          }
        });
      }

      // Add default Plex hubs (only those positioned on home screen)
      if (settings.plex.hubConfigs) {
        settings.plex.hubConfigs.forEach((config) => {
          const sortOrder = config.sortOrderHome || 0;
          if (sortOrder > 0) {
            if (!itemsByLibrary.has(config.libraryId)) {
              itemsByLibrary.set(config.libraryId, []);
            }
            itemsByLibrary.get(config.libraryId)?.push({
              id: config.id,
              libraryId: config.libraryId,
              sortOrderHome: sortOrder,
              randomizeHomeOrder: config.randomizeHomeOrder,
              type: 'hub',
            });
          }
        });
      }

      // Add pre-existing collections (only those positioned on home screen)
      if (settings.plex.preExistingCollectionConfigs) {
        settings.plex.preExistingCollectionConfigs.forEach((config) => {
          const sortOrder = config.sortOrderHome || 0;
          if (sortOrder > 0) {
            if (!itemsByLibrary.has(config.libraryId)) {
              itemsByLibrary.set(config.libraryId, []);
            }
            itemsByLibrary.get(config.libraryId)?.push({
              id: config.id,
              libraryId: config.libraryId,
              sortOrderHome: sortOrder,
              randomizeHomeOrder: config.randomizeHomeOrder,
              type: 'preexisting',
            });
          }
        });
      }

      if (itemsByLibrary.size === 0) {
        logger.info('No collections/hubs found to randomize', {
          label: 'Randomize Home Order',
        });
        return;
      }

      // Process each library separately
      const allNewOrders = new Map<string, number>();
      let totalShuffled = 0;
      let librariesWithRandomized = 0;

      for (const [libraryId, libraryItems] of itemsByLibrary) {
        if (this.cancelled) {
          throw new Error('Randomize Home Order cancelled');
        }

        // Check if this library has any randomized items
        const hasRandomized = libraryItems.some(
          (item) => item.randomizeHomeOrder && item.sortOrderHome > 0
        );

        if (!hasRandomized) {
          // Keep existing order for this library
          libraryItems.forEach((item) => {
            allNewOrders.set(`${item.type}:${item.id}`, item.sortOrderHome);
          });
          continue;
        }

        librariesWithRandomized++;

        // Shuffle this library's items
        const libraryNewOrders = this.shuffleLibraryItems(libraryItems);

        // Count shuffled items (those with randomizeHomeOrder enabled)
        const shuffledInLibrary = libraryItems.filter(
          (item) => item.randomizeHomeOrder
        ).length;
        totalShuffled += shuffledInLibrary;

        // Merge into all new orders
        for (const [key, value] of libraryNewOrders) {
          allNewOrders.set(key, value);
        }

        logger.debug(
          `Library ${libraryId}: shuffled ${shuffledInLibrary} items`,
          {
            label: 'Randomize Home Order',
          }
        );
      }

      if (librariesWithRandomized === 0) {
        logger.info('No collections/hubs have randomizeHomeOrder enabled', {
          label: 'Randomize Home Order',
        });
        return;
      }

      logger.info(
        `Shuffled ${totalShuffled} collections/hubs across ${librariesWithRandomized} libraries`,
        {
          label: 'Randomize Home Order',
        }
      );

      // Apply the new order back to settings
      if (settings.plex.collectionConfigs) {
        settings.plex.collectionConfigs = settings.plex.collectionConfigs.map(
          (config) => {
            const newSortOrder = allNewOrders.get(`collection:${config.id}`);
            if (newSortOrder !== undefined) {
              return {
                ...config,
                sortOrderHome: newSortOrder,
              };
            }
            return config;
          }
        );
      }

      if (settings.plex.hubConfigs) {
        settings.plex.hubConfigs = settings.plex.hubConfigs.map((config) => {
          const newSortOrder = allNewOrders.get(`hub:${config.id}`);
          if (newSortOrder !== undefined) {
            return {
              ...config,
              sortOrderHome: newSortOrder,
            };
          }
          return config;
        });
      }

      if (settings.plex.preExistingCollectionConfigs) {
        settings.plex.preExistingCollectionConfigs =
          settings.plex.preExistingCollectionConfigs.map((config) => {
            const newSortOrder = allNewOrders.get(`preexisting:${config.id}`);
            if (newSortOrder !== undefined) {
              return {
                ...config,
                sortOrderHome: newSortOrder,
              };
            }
            return config;
          });
      }

      // Save settings
      settings.save();

      // Now apply the new ordering to Plex
      logger.info('Applying randomized order to Plex...', {
        label: 'Randomize Home Order',
      });

      const { HubSyncService } = await import(
        '@server/lib/collections/plex/HubSyncService'
      );
      const { getAdminUser } = await import(
        '@server/lib/collections/core/CollectionUtilities'
      );
      const PlexAPI = (await import('@server/api/plexapi')).default;

      // Get Plex client
      const localAdmin = await getAdminUser();
      if (!localAdmin?.plexToken) {
        throw new Error('No local admin Plex token found');
      }

      const plexClient = new PlexAPI({
        plexToken: localAdmin.plexToken,
        plexSettings: settings.plex,
      });

      // Use Hub Sync Service to apply ordering
      const hubSyncService = new HubSyncService();
      await hubSyncService.syncUnifiedOrdering(plexClient);

      logger.info('Randomize Home Order completed successfully', {
        label: 'Randomize Home Order',
      });
    } catch (error) {
      if (this.cancelled) {
        logger.info('Randomize Home Order cancelled', {
          label: 'Randomize Home Order',
        });
      } else {
        logger.error('Randomize Home Order failed', {
          label: 'Randomize Home Order',
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    } finally {
      this.status.running = false;
      this.status.progress = 100;
      this.cancelled = false;
    }
  }

  /**
   * Cancel the currently running randomization
   */
  public cancel(): void {
    logger.info('Cancelling Randomize Home Order', {
      label: 'Randomize Home Order',
    });
    this.cancelled = true;
  }
}

const randomizeHomeOrder = new RandomizeHomeOrder();

export default randomizeHomeOrder;
