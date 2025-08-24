import type { PlexHubConfig } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { IdGenerator } from '@server/utils/idGenerator';

// Type for hub configs during discovery (before isActive is set server-side)
type DiscoveredHubConfig = Omit<PlexHubConfig, 'isActive'>;

/**
 * Service for managing default Plex hub configurations specifically
 * Separated from the combined HubConfigService for cleaner API design
 */
export class DefaultHubConfigService {
  /**
   * Get current default Plex hub configurations
   */
  public getConfigs(): PlexHubConfig[] {
    const settings = getSettings();
    const hubConfigs = settings.plex.hubConfigs || [];

    logger.debug('Default hub configs retrieved', {
      label: 'Default Hub Config Service',
      count: hubConfigs.length,
      sample:
        hubConfigs.length > 0
          ? {
              hubIdentifier: hubConfigs[0].hubIdentifier,
              libraryId: hubConfigs[0].libraryId,
              name: hubConfigs[0].name,
              isActive: hubConfigs[0].isActive,
            }
          : null,
    });

    return hubConfigs;
  }

  /**
   * Save default Plex hub configurations (replaces entire config array)
   */
  public saveConfigs(newConfigs: DiscoveredHubConfig[]): PlexHubConfig[] {
    const settings = getSettings();

    // Preserve existing isActive status when updating hub configs
    const existingHubConfigs = settings.plex.hubConfigs || [];
    const mergedHubConfigs = newConfigs.map(
      (newConfig: DiscoveredHubConfig) => {
        const existingConfig = existingHubConfigs.find(
          (existing) =>
            existing.hubIdentifier === newConfig.hubIdentifier &&
            existing.libraryId === newConfig.libraryId
        );
        return {
          ...newConfig,
          // Preserve existing ID or generate new one
          id: existingConfig?.id || IdGenerator.generateId(),
          // Preserve existing isActive status, or default to true for new configs
          isActive: existingConfig?.isActive ?? true,
        };
      }
    );

    // Apply automatic linking logic for hubs with same base identifier
    const linkedConfigs = this.applyAutomaticLinking(mergedHubConfigs);

    // Combine existing configs with new configs instead of replacing
    const existingNonMatchingConfigs = existingHubConfigs.filter(
      (existing) =>
        !newConfigs.some(
          (newConfig) =>
            existing.hubIdentifier === newConfig.hubIdentifier &&
            existing.libraryId === newConfig.libraryId
        )
    );

    settings.plex.hubConfigs = [
      ...existingNonMatchingConfigs,
      ...linkedConfigs,
    ];
    settings.save();

    logger.info('Default hub configurations saved with automatic linking', {
      label: 'Default Hub Config Service',
      count: newConfigs.length,
      linkedGroups: this.countLinkedGroups(linkedConfigs),
    });

    return linkedConfigs;
  }

  /**
   * Save existing default hub configurations (for reordering/editing)
   */
  public saveExistingConfigs(newConfigs: PlexHubConfig[]): PlexHubConfig[] {
    const settings = getSettings();

    // Direct save since these are already in the correct format
    settings.plex.hubConfigs = newConfigs;
    settings.save();

    logger.info('Default hub configurations saved', {
      label: 'Default Hub Config Service',
      count: newConfigs.length,
    });

    return newConfigs;
  }

  /**
   * Update settings for an individual default hub configuration
   * Preserves computed fields while allowing user changes
   */
  public updateSettings(
    id: string,
    settings: Partial<PlexHubConfig>
  ): PlexHubConfig {
    const configs = this.getConfigs();
    const existingConfigIndex = configs.findIndex((c) => c.id === id);

    if (existingConfigIndex === -1) {
      throw new Error('Config not found');
    }

    const existingConfig = configs[existingConfigIndex];

    // Merge settings while preserving computed fields
    const updatedConfig: PlexHubConfig = {
      ...existingConfig, // Preserve all existing fields including computed ones
      ...settings, // Apply user changes
      // Ensure computed fields stay computed:
      id: existingConfig.id, // ID never changes
      isActive: existingConfig.isActive, // isActive is computed elsewhere
      collectionType: existingConfig.collectionType, // Computed field
      // Business logic fields can be changed by user:
      isLinked: settings.isLinked ?? existingConfig.isLinked,
      linkId: settings.linkId ?? existingConfig.linkId,
    };

    // Update the config in place
    configs[existingConfigIndex] = updatedConfig;

    // Save the updated configs
    this.saveExistingConfigs(configs);

    logger.info('Individual default hub config updated successfully', {
      label: 'Default Hub Config Service',
      configId: id,
      configName: updatedConfig.name,
    });

    return updatedConfig;
  }

  /**
   * Append new default hub configurations to existing ones (for discovery)
   */
  public appendConfigs(newConfigs: DiscoveredHubConfig[]): PlexHubConfig[] {
    const settings = getSettings();
    const existingHubConfigs = settings.plex.hubConfigs || [];

    // Add isActive field and default time restrictions server-side
    const hubConfigsWithActiveStatus = newConfigs.map(
      (config: DiscoveredHubConfig) => {
        // Try to find existing hub by natural key to preserve ID
        const existingConfig = existingHubConfigs.find(
          (existing) =>
            existing.hubIdentifier === config.hubIdentifier &&
            existing.libraryId === config.libraryId
        );

        return {
          ...config,
          // Preserve existing ID or generate new one
          id: existingConfig?.id || IdGenerator.generateId(),
          isActive: true, // All discovered items start as active
          timeRestriction: config.timeRestriction || {
            alwaysActive: true, // Default to always active
          },
        };
      }
    );

    // Apply automatic linking logic for hubs with same base identifier
    const allConfigs = [...existingHubConfigs, ...hubConfigsWithActiveStatus];
    const linkedConfigs = this.applyAutomaticLinking(allConfigs);

    settings.plex.hubConfigs = linkedConfigs;
    settings.save();

    logger.info('Default hub configurations appended with automatic linking', {
      label: 'Default Hub Config Service',
      appended: newConfigs.length,
      total: linkedConfigs.length,
      linkedGroups: this.countLinkedGroups(linkedConfigs),
    });

    return linkedConfigs;
  }

  /**
   * Apply automatic linking logic to group hubs with the same base identifier
   * Hubs with the same base identifier (like "recentlyadded" from both "movie.recentlyadded" and "tv.recentlyadded")
   * across different libraries should be automatically linked so they can be configured together
   */
  private applyAutomaticLinking(hubConfigs: PlexHubConfig[]): PlexHubConfig[] {
    // Group hubs by their base identifier (without media type prefix)
    const hubGroups = new Map<string, PlexHubConfig[]>();

    hubConfigs.forEach((hub) => {
      const baseIdentifier = this.extractBaseHubIdentifier(hub.hubIdentifier);
      const existing = hubGroups.get(baseIdentifier) || [];
      existing.push(hub);
      hubGroups.set(baseIdentifier, existing);
    });

    // Generate a new linkId for each group that has multiple hubs
    let nextLinkId = this.getNextLinkId(hubConfigs);
    const resultConfigs: PlexHubConfig[] = [];

    for (const [baseIdentifier, hubs] of hubGroups.entries()) {
      if (hubs.length > 1) {
        // Multiple hubs with same base identifier - they should be linked
        const linkId = nextLinkId++;

        logger.debug(
          `Auto-linking ${hubs.length} hubs with base identifier: ${baseIdentifier}`,
          {
            label: 'Default Hub Config Service',
            baseIdentifier,
            linkId,
            hubIdentifiers: hubs.map((h) => h.hubIdentifier),
            libraryIds: hubs.map((h) => h.libraryId),
          }
        );

        // Link all hubs in this group
        hubs.forEach((hub) => {
          resultConfigs.push({
            ...hub,
            isLinked: true,
            linkId,
          });
        });
      } else {
        // Single hub - no linking needed
        resultConfigs.push({
          ...hubs[0],
          isLinked: false,
          linkId: undefined,
        });
      }
    }

    return resultConfigs;
  }

  /**
   * Extract base hub identifier without media type prefix
   * "movie.recentlyadded" -> "recentlyadded"
   * "tv.recentlyadded" -> "recentlyadded"
   * "recent.library.playlists" -> "recent.library.playlists" (no change)
   */
  private extractBaseHubIdentifier(hubIdentifier: string): string {
    // For built-in hubs that start with media type prefix
    if (hubIdentifier.startsWith('movie.') || hubIdentifier.startsWith('tv.')) {
      return hubIdentifier.substring(hubIdentifier.indexOf('.') + 1);
    }

    // For other identifiers (like custom collections or other hub types), return as-is
    return hubIdentifier;
  }

  /**
   * Get the next available linkId
   */
  private getNextLinkId(hubConfigs: PlexHubConfig[]): number {
    const existingLinkIds = hubConfigs
      .map((hub) => hub.linkId)
      .filter((id): id is number => typeof id === 'number');

    return existingLinkIds.length > 0 ? Math.max(...existingLinkIds) + 1 : 1;
  }

  /**
   * Count how many linked groups exist in the configs
   */
  private countLinkedGroups(hubConfigs: PlexHubConfig[]): number {
    const linkIds = new Set(
      hubConfigs
        .filter((hub) => hub.isLinked && hub.linkId)
        .map((hub) => hub.linkId)
    );
    return linkIds.size;
  }
}

// Create and export singleton instance
export const defaultHubConfigService = new DefaultHubConfigService();
export default defaultHubConfigService;
