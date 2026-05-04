import type PlexAPI from '@server/api/plexapi';
import type { PlexHubManagementResponse } from '@server/interfaces/api/plexInterfaces';
import logger from '@server/logger';

/**
 * PlexHubManager - Handles Plex hub management operations
 * Manages hub visibility, ordering, and promotion for library sections
 */
class PlexHubManager {
  private plexApi: PlexAPI;

  constructor(plexApi: PlexAPI) {
    this.plexApi = plexApi;
  }

  /**
   * Get all hubs for a specific library section
   * Returns both built-in hubs (Recently Added, etc.) and custom collections
   */
  public async getLibraryHubs(sectionId: string): Promise<unknown> {
    try {
      const response = await this.plexApi['plexClient'].query(
        `/hubs/sections/${sectionId}`
      );
      return response;
    } catch (error) {
      logger.error(`Error fetching hubs for library section ${sectionId}`, {
        label: 'Plex API',
        error: error instanceof Error ? error.message : String(error),
        sectionId,
      });
      throw error;
    }
  }

  /**
   * Get hub management interface for a library section
   * This endpoint provides the drag-and-drop hub ordering interface
   */
  public async getHubManagement(
    sectionId: string
  ): Promise<PlexHubManagementResponse> {
    logger.debug('Fetching hub management interface', {
      label: 'Plex API',
      sectionId,
    });
    const startTime = Date.now();

    try {
      const response = await this.plexApi['plexClient'].query(
        `/hubs/sections/${sectionId}/manage`
      );

      const hubCount =
        (response as PlexHubManagementResponse)?.MediaContainer?.Hub?.length ||
        0;
      logger.debug('Hub management interface fetched successfully', {
        label: 'Plex API',
        sectionId,
        hubCount,
        responseTime: Date.now() - startTime,
      });

      return response as PlexHubManagementResponse;
    } catch (error) {
      logger.error(
        `Error fetching hub management for library section ${sectionId}`,
        {
          label: 'Plex API',
          error: error instanceof Error ? error.message : String(error),
          sectionId,
          responseTime: Date.now() - startTime,
        }
      );
      throw error;
    }
  }

  /**
   * Move a hub to a new position in the library home screen
   * @param sectionId Library section ID
   * @param hubId Hub identifier (e.g., 'movie.recentlyadded', collection rating key)
   * @param afterHubId Hub to move this hub after (null for first position)
   */
  public async moveHub(
    sectionId: string,
    hubId: string,
    afterHubId?: string
  ): Promise<void> {
    try {
      const url = afterHubId
        ? `/hubs/sections/${sectionId}/manage/${hubId}/move?after=${afterHubId}`
        : `/hubs/sections/${sectionId}/manage/${hubId}/move`;

      await this.plexApi['safePutQuery'](url);
    } catch (error) {
      logger.error(
        `Error moving hub ${hubId} in library section ${sectionId}`,
        {
          label: 'Plex API',
          error: error instanceof Error ? error.message : String(error),
          sectionId,
          hubId,
          afterHubId,
        }
      );
      throw error;
    }
  }

  /**
   * Get current collection visibility settings
   */
  public async getCollectionVisibility(
    collectionRatingKey: string
  ): Promise<unknown> {
    try {
      const response = await this.plexApi['plexClient'].query(
        `/library/collections/${collectionRatingKey}`
      );

      // Extract visibility info from collection metadata
      const collection = response.MediaContainer?.Metadata?.[0];
      if (!collection) {
        return {};
      }

      // Return basic visibility structure - this is simplified since getting exact
      // visibility settings from Plex is complex and not critical for update logic
      return {
        isVisible: collection.visible !== false,
        // Add more visibility fields if needed
      };
    } catch (error) {
      logger.warn(
        `Failed to get collection visibility for ${collectionRatingKey}`,
        {
          label: 'Plex API',
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return {};
    }
  }

  /**
   * Update hub visibility settings
   * @param sectionId Library section ID
   * @param hubId Hub identifier
   * @param visibility Hub visibility configuration
   */
  public async updateHubVisibility(
    sectionId: string,
    hubId: string,
    visibility: {
      promotedToRecommended?: boolean;
      promotedToOwnHome?: boolean;
      promotedToSharedHome?: boolean;
    }
  ): Promise<void> {
    try {
      const params = new URLSearchParams();

      if (visibility.promotedToRecommended !== undefined) {
        params.append(
          'promotedToRecommended',
          visibility.promotedToRecommended ? '1' : '0'
        );
      }
      if (visibility.promotedToOwnHome !== undefined) {
        params.append(
          'promotedToOwnHome',
          visibility.promotedToOwnHome ? '1' : '0'
        );
      }
      if (visibility.promotedToSharedHome !== undefined) {
        params.append(
          'promotedToSharedHome',
          visibility.promotedToSharedHome ? '1' : '0'
        );
      }

      const url = `/hubs/sections/${sectionId}/manage/${hubId}?${params.toString()}`;
      await this.plexApi['safePutQuery'](url);

      // Hub visibility updated successfully - reduced logging
    } catch (error) {
      logger.error(
        `Error updating hub visibility for ${hubId} in library section ${sectionId}`,
        {
          label: 'Plex API',
          error: error instanceof Error ? error.message : String(error),
          sectionId,
          hubId,
          visibility,
        }
      );
      throw error;
    }
  }

  /**
   * Get all available hubs across all library sections
   * Useful for getting a complete overview of the Plex home screen
   */
  public async getAllLibraryHubs(): Promise<{ [sectionId: string]: unknown }> {
    try {
      const allLibraries = await this.plexApi.getLibraries();
      // Filter to only movie and show libraries - we don't manage music, photo, or other library types
      const libraries = allLibraries.filter(
        (library) => library.type === 'movie' || library.type === 'show'
      );
      const allHubs: { [sectionId: string]: unknown } = {};

      for (const library of libraries) {
        try {
          allHubs[library.key] = await this.getLibraryHubs(library.key);
        } catch (error) {
          logger.warn(
            `Failed to fetch hubs for library ${library.title} (${library.key})`,
            {
              label: 'Plex API',
              error: error instanceof Error ? error.message : String(error),
              libraryKey: library.key,
              libraryTitle: library.title,
            }
          );
          // Continue with other libraries even if one fails
        }
      }

      return allHubs;
    } catch (error) {
      logger.error('Error fetching all library hubs', {
        label: 'Plex API',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Reorder multiple hubs in a library section
   * @param sectionId Library section ID
   * @param desiredOrder Array of hub IDs in desired order
   * @param positionedItemsCount Optional count of positioned items
   * @param libraryType Type of library (movie or show) for anchor positioning
   * @param syncCounter Optional sync counter for alternating positioning methods (prevents precision convergence)
   */
  public async reorderHubs(
    sectionId: string,
    desiredOrder: string[],
    positionedItemsCount?: number,
    libraryType?: 'movie' | 'show',
    syncCounter?: number
  ): Promise<void> {
    // Declare outside try block for error logging
    let completeDesiredOrder = desiredOrder;

    try {
      if (desiredOrder.length <= 1) {
        return;
      }

      // Get current hub order from Plex
      const hubManagement = await this.getHubManagement(sectionId);
      const currentHubs = hubManagement.MediaContainer.Hub;
      const currentOrder = currentHubs.map(
        (h: { identifier: string }) => h.identifier
      );

      // Create complete desired order: our managed items first, then all unmanaged items at bottom
      const managedItemsSet = new Set(desiredOrder);
      const unmanagedItems = currentOrder.filter(
        (id) => !managedItemsSet.has(id)
      );
      completeDesiredOrder = [...desiredOrder, ...unmanagedItems];

      // Only proceed if orders are actually different
      if (
        JSON.stringify(currentOrder) === JSON.stringify(completeDesiredOrder)
      ) {
        return;
      }

      logger.debug(
        `Complete ordering includes ${completeDesiredOrder.length} items (${desiredOrder.length} managed, ${unmanagedItems.length} unmanaged)`,
        {
          label: 'Plex API',
          sectionId,
          managedItems: desiredOrder.length,
          unmanagedItems: unmanagedItems.length,
          completeOrder: completeDesiredOrder,
        }
      );

      // Smart selective reordering: only move items that are in wrong positions
      logger.debug(
        `Using selective reordering approach for sync ${
          syncCounter || 'manual'
        }`,
        {
          label: 'Plex API',
          sectionId,
          method: 'selective',
          syncCounter: syncCounter || 'manual',
          currentOrder: currentOrder.slice(0, 5), // First 5 items for debugging
          desiredOrder: completeDesiredOrder.slice(0, 5),
        }
      );

      let moveCount = 0;

      // Check if first item needs to be moved (use anchor positioning)
      if (currentOrder[0] !== completeDesiredOrder[0]) {
        // Determine anchor for positioning first item
        let requiredAnchor: string | null = null;
        if (libraryType === 'show') {
          requiredAnchor = 'tv.ondeck';
        } else if (libraryType === 'movie') {
          requiredAnchor = 'movie.inprogress';
        }

        if (requiredAnchor) {
          try {
            logger.debug(
              `Moving first item ${completeDesiredOrder[0]} after anchor ${requiredAnchor}`,
              {
                label: 'Plex API',
                sectionId,
                hubId: completeDesiredOrder[0],
                afterHubId: requiredAnchor,
              }
            );
            await this.moveHub(
              sectionId,
              completeDesiredOrder[0],
              requiredAnchor
            );
            moveCount++;
          } catch (error) {
            logger.error(
              `Failed to move first item ${completeDesiredOrder[0]} after anchor`,
              {
                label: 'Plex API',
                sectionId,
                hubId: completeDesiredOrder[0],
                afterHubId: requiredAnchor,
                error: error instanceof Error ? error.message : String(error),
              }
            );
          }
        }
      }

      // Check subsequent items - move after their immediate predecessor if wrong
      let repromoCount = 0;
      for (let i = 1; i < completeDesiredOrder.length; i++) {
        const currentItem = completeDesiredOrder[i];
        const expectedPredecessor = completeDesiredOrder[i - 1];

        // Find current position of this item
        const currentPosition = currentOrder.indexOf(currentItem);
        const expectedPredecessorCurrentPosition =
          currentOrder.indexOf(expectedPredecessor);

        // Item needs to move if it's not immediately after its expected predecessor
        const needsMove =
          currentPosition !== expectedPredecessorCurrentPosition + 1;

        if (needsMove) {
          try {
            logger.debug(
              `Moving item ${currentItem} after predecessor ${expectedPredecessor}`,
              {
                label: 'Plex API',
                sectionId,
                hubId: currentItem,
                afterHubId: expectedPredecessor,
                currentPosition,
                expectedPosition: i,
              }
            );
            await this.moveHub(sectionId, currentItem, expectedPredecessor);
            moveCount++;

            // CONVERGENCE SOLUTION: Verify the move worked by fetching actual order
            const verificationHubManagement = await this.getHubManagement(
              sectionId
            );
            const actualOrder =
              verificationHubManagement.MediaContainer.Hub.map(
                (h: { identifier: string }) => h.identifier
              );

            // Check if item landed immediately after predecessor
            const actualPredecessorIndex =
              actualOrder.indexOf(expectedPredecessor);
            const actualCurrentIndex = actualOrder.indexOf(currentItem);
            const placementSuccess =
              actualPredecessorIndex !== -1 &&
              actualCurrentIndex === actualPredecessorIndex + 1;

            if (!placementSuccess) {
              // Placement failed - likely due to float precision convergence
              logger.warn(
                `Placement verification failed for ${currentItem} - attempting unpromote/re-promote recovery`,
                {
                  label: 'Plex API',
                  sectionId,
                  hubId: currentItem,
                  expectedAfter: expectedPredecessor,
                  actualPredecessorIndex,
                  actualCurrentIndex,
                  convergenceDetected: true,
                }
              );

              // Extract rating key from identifier for unpromote/re-promote
              const ratingKey =
                this.extractRatingKeyFromIdentifier(currentItem);

              if (ratingKey) {
                // Unpromote the collection (delete from hub management)
                await this.deleteHubItem(sectionId, currentItem);
                repromoCount++;

                logger.debug(
                  `Unpromoted collection ${currentItem}, re-promoting with fresh spacing`,
                  {
                    label: 'Plex API',
                    sectionId,
                    hubId: currentItem,
                    ratingKey,
                  }
                );

                // Re-promote it (gets fresh 1000-unit spacing at the end)
                await this.promoteCollectionToHub(ratingKey, sectionId);

                // Update tracking: item is now at the end
                actualOrder.splice(actualCurrentIndex, 1);
                actualOrder.push(currentItem);
                currentOrder.length = 0;
                currentOrder.push(...actualOrder);

                logger.info(
                  `Successfully recovered from convergence via unpromote/re-promote for ${currentItem}`,
                  {
                    label: 'Plex API',
                    sectionId,
                    hubId: currentItem,
                    ratingKey,
                    repromoCount,
                  }
                );
              } else {
                // Can't unpromote built-in hubs or items without rating keys
                logger.warn(
                  `Cannot unpromote/re-promote ${currentItem} - no rating key available`,
                  {
                    label: 'Plex API',
                    sectionId,
                    hubId: currentItem,
                    note: 'Built-in hubs or invalid identifiers cannot be re-promoted',
                  }
                );
                // Update tracking with actual order anyway
                currentOrder.length = 0;
                currentOrder.push(...actualOrder);
              }
            } else {
              // Move succeeded - update our tracking of current order
              if (currentPosition === -1) {
                // Item not found in tracking array — refresh from actual order
                logger.warn(
                  `Item ${currentItem} not found in tracking array, refreshing`,
                  { label: 'Plex API', sectionId, hubId: currentItem }
                );
                const refreshed = await this.getHubManagement(sectionId);
                currentOrder.length = 0;
                currentOrder.push(
                  ...refreshed.MediaContainer.Hub.map(
                    (h: { identifier: string }) => h.identifier
                  )
                );
              } else {
                const itemToMove = currentOrder.splice(currentPosition, 1)[0];
                const predecessorNewPosition =
                  currentOrder.indexOf(expectedPredecessor);
                currentOrder.splice(predecessorNewPosition + 1, 0, itemToMove);
              }
            }
          } catch (error) {
            logger.error(
              `Failed to move item ${currentItem} after predecessor ${expectedPredecessor}`,
              {
                label: 'Plex API',
                sectionId,
                hubId: currentItem,
                afterHubId: expectedPredecessor,
                error: error instanceof Error ? error.message : String(error),
              }
            );
          }
        }
      }

      logger.info(
        `Selective reordering completed: ${moveCount} items moved${
          repromoCount > 0
            ? `, ${repromoCount} items re-promoted for convergence recovery`
            : ''
        }`,
        {
          label: 'Plex API',
          sectionId,
          moveCount,
          repromoCount,
          totalItems: completeDesiredOrder.length,
          efficiency: `${moveCount}/${completeDesiredOrder.length} moves`,
        }
      );

      // Verify order after moves - detect precision convergence
      if (moveCount > 0) {
        const verificationHubManagement = await this.getHubManagement(
          sectionId
        );
        const actualOrder = verificationHubManagement.MediaContainer.Hub.map(
          (h: { identifier: string }) => h.identifier
        );

        const orderMatches =
          JSON.stringify(actualOrder) === JSON.stringify(completeDesiredOrder);

        if (!orderMatches) {
          logger.error(
            `Order verification failed after ${moveCount} moves and ${repromoCount} re-promotions - falling back to reset`,
            {
              label: 'Plex API',
              sectionId,
              moveCount,
              repromoCount,
              expectedOrder: completeDesiredOrder,
              actualOrder,
              convergenceDetected: true,
              note: 'Unpromote/re-promote recovery was attempted but final order still incorrect',
            }
          );

          // Throw a specific error that can be caught and handled with reset
          const convergenceError = new Error(
            `Precision convergence detected in library ${sectionId} - unpromote/re-promote recovery failed`
          ) as Error & {
            isPrecisionConvergence: boolean;
            sectionId: string;
            moveCount: number;
            repromoCount: number;
          };
          convergenceError.isPrecisionConvergence = true;
          convergenceError.sectionId = sectionId;
          convergenceError.moveCount = moveCount;
          convergenceError.repromoCount = repromoCount;
          throw convergenceError;
        } else {
          logger.info(
            `Order verification successful - all ${completeDesiredOrder.length} items in correct positions`,
            {
              label: 'Plex API',
              sectionId,
              verification: 'passed',
              moveCount,
            }
          );
        }
      }
    } catch (error) {
      logger.error(`Error reordering hubs in library section ${sectionId}`, {
        label: 'Plex API',
        error: error instanceof Error ? error.message : String(error),
        sectionId,
        desiredOrder: completeDesiredOrder,
      });
      throw error;
    }
  }

  /**
   * Reset all hub management for a library section
   * This clears all hub positioning and forces Plex to use clean 1000-interval spacing
   * @param sectionId Library section ID
   */
  public async resetLibraryHubManagement(sectionId: string): Promise<void> {
    try {
      const url = `/hubs/sections/${sectionId}/manage`;

      logger.warn(
        `Resetting hub management for library section ${sectionId} due to precision convergence`,
        {
          label: 'Plex API',
          sectionId,
          action: 'nuclear_reset',
        }
      );

      await this.plexApi['safeDeleteQuery'](url);

      logger.info(
        `Successfully reset hub management for library section ${sectionId}`,
        {
          label: 'Plex API',
          sectionId,
          result: 'clean_spacing_restored',
        }
      );
    } catch (error) {
      logger.error(
        `Error resetting hub management for library section ${sectionId}`,
        {
          label: 'Plex API',
          error: error instanceof Error ? error.message : String(error),
          sectionId,
        }
      );
      throw error;
    }
  }

  /**
   * Delete a hub item from a library section
   * @param sectionId Library section ID
   * @param hubId Hub identifier to delete
   */
  public async deleteHubItem(sectionId: string, hubId: string): Promise<void> {
    try {
      const url = `/hubs/sections/${sectionId}/manage/${hubId}`;

      await this.plexApi['safeDeleteQuery'](url);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      // 404 means hub is already deleted - treat as success
      if (errorMessage.includes('404')) {
        logger.debug(
          `Hub item ${hubId} already deleted from library section ${sectionId}`,
          {
            label: 'Plex API',
            sectionId,
            hubId,
          }
        );
        return;
      }
      logger.error(
        `Error deleting hub item ${hubId} from library section ${sectionId}`,
        {
          label: 'Plex API',
          error: errorMessage,
          sectionId,
          hubId,
        }
      );
      throw error;
    }
  }

  /**
   * Extract rating key from a hub identifier for unpromote/re-promote operations
   * @param identifier Hub identifier (e.g., "custom.collection.1.35954")
   * @returns Rating key if identifier is a custom collection, null otherwise
   */
  private extractRatingKeyFromIdentifier(identifier: string): string | null {
    // Check if this is a custom collection identifier
    if (!identifier.startsWith('custom.collection.')) {
      return null;
    }

    // Extract rating key from "custom.collection.{libraryId}.{ratingKey}"
    const parts = identifier.split('.');
    if (parts.length >= 4) {
      return parts[3];
    }

    return null;
  }

  /**
   * Promote a collection to hub management (makes it available for visibility/ordering management)
   * @param collectionRatingKey The rating key of the collection to promote
   * @param libraryId The library ID where the collection exists
   */
  public async promoteCollectionToHub(
    collectionRatingKey: string,
    libraryId: string
  ): Promise<void> {
    try {
      const hubInitUrl = `/hubs/sections/${libraryId}/manage?metadataItemId=${collectionRatingKey}`;
      await this.plexApi['safePostQuery'](hubInitUrl);

      logger.debug(
        `Successfully promoted collection to hub management: ${collectionRatingKey}`,
        {
          label: 'Plex API',
          collectionRatingKey,
          libraryId,
        }
      );
    } catch (error) {
      logger.error(
        `Error promoting collection ${collectionRatingKey} to hub management in library ${libraryId}`,
        {
          label: 'Plex API',
          collectionRatingKey,
          libraryId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
    }
  }
}

export default PlexHubManager;
