/**
 * Randomize Home Order Service
 *
 * Shuffles the home screen order of collections/hubs that have randomizeHomeOrder enabled.
 * Collections retain their sortOrderHome values but are randomly shuffled amongst other
 * randomized collections in their position range.
 *
 * Example: If positions 4, 5, 6 have randomizeHomeOrder=true and positions 1-3, 7-8 are static,
 * then only positions 4-6 will be shuffled amongst themselves.
 */

import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

interface CollectionItem {
  id: string;
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
   * Find contiguous groups of randomized collections
   * Returns array of groups where each group contains indices of collections to shuffle together
   */
  private findRandomizedGroups(items: CollectionItem[]): number[][] {
    const groups: number[][] = [];
    let currentGroup: number[] = [];

    for (let i = 0; i < items.length; i++) {
      if (items[i].randomizeHomeOrder && items[i].sortOrderHome > 0) {
        currentGroup.push(i);
      } else {
        // End current group if we have one
        if (currentGroup.length > 0) {
          groups.push(currentGroup);
          currentGroup = [];
        }
      }
    }

    // Don't forget the last group
    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }

    return groups;
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

      // Gather all collections/hubs/preexisting into a unified list
      const allItems: CollectionItem[] = [];

      // Add Agregarr-created collections
      if (settings.plex.collectionConfigs) {
        settings.plex.collectionConfigs.forEach((config) => {
          allItems.push({
            id: config.id,
            sortOrderHome: config.sortOrderHome || 0,
            randomizeHomeOrder: config.randomizeHomeOrder,
            type: 'collection',
          });
        });
      }

      // Add default Plex hubs
      if (settings.plex.hubConfigs) {
        settings.plex.hubConfigs.forEach((config) => {
          allItems.push({
            id: config.id,
            sortOrderHome: config.sortOrderHome || 0,
            randomizeHomeOrder: config.randomizeHomeOrder,
            type: 'hub',
          });
        });
      }

      // Add pre-existing collections
      if (settings.plex.preExistingCollectionConfigs) {
        settings.plex.preExistingCollectionConfigs.forEach((config) => {
          allItems.push({
            id: config.id,
            sortOrderHome: config.sortOrderHome || 0,
            randomizeHomeOrder: config.randomizeHomeOrder,
            type: 'preexisting',
          });
        });
      }

      if (allItems.length === 0) {
        logger.info('No collections/hubs found to randomize', {
          label: 'Randomize Home Order',
        });
        return;
      }

      // Sort by current sortOrderHome to establish order
      allItems.sort((a, b) => a.sortOrderHome - b.sortOrderHome);

      // Find groups of contiguous randomized items
      const groups = this.findRandomizedGroups(allItems);

      if (groups.length === 0) {
        logger.info('No collections/hubs have randomizeHomeOrder enabled', {
          label: 'Randomize Home Order',
        });
        return;
      }

      logger.info(
        `Found ${groups.length} group(s) of randomized collections/hubs`,
        {
          label: 'Randomize Home Order',
        }
      );

      // Shuffle each group
      let shuffledCount = 0;
      for (const group of groups) {
        if (this.cancelled) {
          throw new Error('Randomize Home Order cancelled');
        }

        // Get the items in this group
        const groupItems = group.map((idx) => allItems[idx]);

        // Shuffle the items
        const shuffledItems = this.shuffleArray(groupItems);

        // Assign the shuffled items back to their positions
        group.forEach((idx, i) => {
          allItems[idx] = shuffledItems[i];
        });

        shuffledCount += group.length;
      }

      logger.info(`Shuffled ${shuffledCount} collections/hubs`, {
        label: 'Randomize Home Order',
      });

      // Now update the sortOrderHome values in settings based on the new order
      const newOrder = allItems.map((item, index) => ({
        ...item,
        sortOrderHome: index + 1, // 1-based indexing
      }));

      // Apply the new order back to settings
      if (settings.plex.collectionConfigs) {
        settings.plex.collectionConfigs = settings.plex.collectionConfigs.map(
          (config) => {
            const newItem = newOrder.find(
              (item) => item.id === config.id && item.type === 'collection'
            );
            if (newItem) {
              return {
                ...config,
                sortOrderHome: newItem.sortOrderHome,
              };
            }
            return config;
          }
        );
      }

      if (settings.plex.hubConfigs) {
        settings.plex.hubConfigs = settings.plex.hubConfigs.map((config) => {
          const newItem = newOrder.find(
            (item) => item.id === config.id && item.type === 'hub'
          );
          if (newItem) {
            return {
              ...config,
              sortOrderHome: newItem.sortOrderHome,
            };
          }
          return config;
        });
      }

      if (settings.plex.preExistingCollectionConfigs) {
        settings.plex.preExistingCollectionConfigs =
          settings.plex.preExistingCollectionConfigs.map((config) => {
            const newItem = newOrder.find(
              (item) => item.id === config.id && item.type === 'preexisting'
            );
            if (newItem) {
              return {
                ...config,
                sortOrderHome: newItem.sortOrderHome,
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
