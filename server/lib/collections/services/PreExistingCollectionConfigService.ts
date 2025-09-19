import type { PreExistingCollectionConfig } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { IdGenerator } from '@server/utils/idGenerator';

// Type for pre-existing collection configs during discovery (before isActive is set server-side)
type DiscoveredPreExistingConfig = Omit<
  PreExistingCollectionConfig,
  'isActive'
>;

/**
 * Service for managing pre-existing Plex collection configurations specifically
 * Separated from the combined HubConfigService for cleaner API design
 */
export class PreExistingCollectionConfigService {
  /**
   * Get current pre-existing collection configurations
   */
  public getConfigs(): PreExistingCollectionConfig[] {
    const settings = getSettings();
    const preExistingCollectionConfigs =
      settings.plex.preExistingCollectionConfigs || [];

    return preExistingCollectionConfigs;
  }

  /**
   * Save pre-existing collection configurations (replaces entire config array)
   */
  public saveConfigs(
    newConfigs: DiscoveredPreExistingConfig[]
  ): PreExistingCollectionConfig[] {
    const settings = getSettings();

    // Convert DiscoveredPreExistingConfig to PreExistingCollectionConfig format (just add isActive)
    const existingPreExistingConfigs =
      settings.plex.preExistingCollectionConfigs || [];
    const mergedPreExistingConfigs = newConfigs.map(
      (newConfig: DiscoveredPreExistingConfig) => {
        const existingConfig = existingPreExistingConfigs.find(
          (existing) =>
            existing.collectionRatingKey === newConfig.collectionRatingKey &&
            existing.libraryId === newConfig.libraryId
        );

        return {
          // Preserve existing ID or generate new one
          id: existingConfig?.id || IdGenerator.generateId(),
          collectionRatingKey: newConfig.collectionRatingKey,
          name: newConfig.name,
          libraryId: newConfig.libraryId,
          libraryName: newConfig.libraryName,
          mediaType: newConfig.mediaType,
          sortOrderHome: newConfig.sortOrderHome ?? 1,
          sortOrderLibrary: newConfig.sortOrderLibrary ?? 0,
          isLibraryPromoted:
            newConfig.isLibraryPromoted ??
            existingConfig?.isLibraryPromoted ??
            false,
          visibilityConfig: newConfig.visibilityConfig,
          isActive: existingConfig?.isActive ?? true,
          // Copy linking fields from discovered config (if present)
          collectionType: newConfig.collectionType,
          isLinked: newConfig.isLinked,
          linkId: newConfig.linkId,
          isUnlinked: newConfig.isUnlinked,
          timeRestriction: newConfig.timeRestriction,
          customPoster: newConfig.customPoster ?? existingConfig?.customPoster,
        };
      }
    );

    // Combine existing configs with new configs instead of replacing
    const existingNonMatchingConfigs = existingPreExistingConfigs.filter(
      (existing) =>
        !newConfigs.some(
          (newConfig) =>
            existing.collectionRatingKey === newConfig.collectionRatingKey &&
            existing.libraryId === newConfig.libraryId
        )
    );

    settings.plex.preExistingCollectionConfigs = [
      ...existingNonMatchingConfigs,
      ...mergedPreExistingConfigs,
    ];
    settings.save();

    logger.info('Pre-existing collection configurations saved', {
      label: 'Pre-existing Collection Config Service',
      count: newConfigs.length,
    });

    return mergedPreExistingConfigs;
  }

  /**
   * Save existing pre-existing collection configurations (for reordering/editing)
   */
  public saveExistingConfigs(
    newConfigs: PreExistingCollectionConfig[]
  ): PreExistingCollectionConfig[] {
    const settings = getSettings();

    // Direct save since these are already in the correct format
    settings.plex.preExistingCollectionConfigs = newConfigs;
    settings.save();

    logger.info('Pre-existing collection configurations saved', {
      label: 'Pre-existing Collection Config Service',
      count: newConfigs.length,
    });

    return newConfigs;
  }

  /**
   * Update settings for an individual pre-existing collection configuration
   * Preserves computed fields while allowing user changes
   * If the collection is linked, updates all linked collection instances
   */
  public updateSettings(
    id: string,
    settings: Partial<PreExistingCollectionConfig>
  ): PreExistingCollectionConfig {
    const configs = this.getConfigs();
    const existingConfigIndex = configs.findIndex((c) => c.id === id);

    if (existingConfigIndex === -1) {
      throw new Error('Config not found');
    }

    const existingConfig = configs[existingConfigIndex];

    // Check if this is a linked collection - if so, update all linked configs
    const configsToUpdate = [];
    if (existingConfig.isLinked && existingConfig.linkId) {
      // Find all configs with the same linkId
      const linkedConfigs = configs.filter(
        (c) => c.linkId === existingConfig.linkId && c.isLinked
      );
      configsToUpdate.push(...linkedConfigs);
      logger.info(
        `Updating ${linkedConfigs.length} linked pre-existing collection configs`,
        {
          label: 'Pre-existing Collection Config Service',
          linkId: existingConfig.linkId,
          configIds: linkedConfigs.map((c) => c.id),
        }
      );
    } else {
      configsToUpdate.push(existingConfig);
    }

    const updatedConfigs: PreExistingCollectionConfig[] = [];

    // Process each config (could be just one, or multiple if linked)
    for (const configToUpdate of configsToUpdate) {
      const configIndex = configs.findIndex((c) => c.id === configToUpdate.id);

      // For linked collections, exclude library-specific fields from settings to prevent corruption
      const safeSettings = { ...settings };
      if (existingConfig.isLinked && existingConfig.linkId) {
        // Remove library-specific fields that must be preserved for each individual collection
        delete safeSettings.libraryId;
        delete safeSettings.libraryName;
        delete safeSettings.collectionRatingKey; // CRITICAL: Each collection has its own unique rating key
        delete safeSettings.mediaType;
        delete safeSettings.id; // ID should never be overwritten
      }

      // Merge settings while preserving computed fields
      const updatedConfig: PreExistingCollectionConfig = {
        ...configToUpdate, // Preserve all existing fields including computed ones
        ...safeSettings, // Apply user changes (with library-specific fields excluded for linked collections)
        // Ensure computed fields stay computed:
        id: configToUpdate.id, // ID never changes
        isActive: configToUpdate.isActive, // isActive is computed elsewhere
        collectionType: configToUpdate.collectionType, // Computed field
        // Business logic fields can be changed by user:
        isLinked: settings.isLinked ?? configToUpdate.isLinked,
        linkId: settings.linkId ?? configToUpdate.linkId,
        isUnlinked: settings.isUnlinked ?? configToUpdate.isUnlinked,
      };

      // Update the config in place
      configs[configIndex] = updatedConfig;
      updatedConfigs.push(updatedConfig);
    }

    // Save the updated configs
    this.saveExistingConfigs(configs);

    logger.info('Pre-existing collection config(s) updated successfully', {
      label: 'Pre-existing Collection Config Service',
      updatedCount: updatedConfigs.length,
      configIds: updatedConfigs.map((c) => c.id),
      configNames: updatedConfigs.map((c) => c.name),
      isLinked: existingConfig.isLinked,
      linkId: existingConfig.linkId || 'none',
    });

    return updatedConfigs[0]; // Return the primary config (the one that was edited)
  }

  /**
   * Append new pre-existing collection configurations to existing ones (for discovery)
   */
  public appendConfigs(
    newConfigs: DiscoveredPreExistingConfig[]
  ): PreExistingCollectionConfig[] {
    const settings = getSettings();
    const existingPreExistingConfigs =
      settings.plex.preExistingCollectionConfigs || [];

    // Convert and add isActive field and default time restrictions server-side
    const preExistingConfigsWithActiveStatus = newConfigs.map(
      (config: DiscoveredPreExistingConfig) => {
        // Use the collectionRatingKey directly (already present in the config)
        const collectionRatingKey = config.collectionRatingKey;

        // Try to find existing config by natural key to preserve ID
        const existingConfig = existingPreExistingConfigs.find(
          (existing) =>
            existing.collectionRatingKey === collectionRatingKey &&
            existing.libraryId === config.libraryId
        );

        return {
          // Preserve existing ID or generate new one
          id: existingConfig?.id || IdGenerator.generateId(),
          collectionRatingKey,
          name: config.name,
          libraryId: config.libraryId,
          libraryName: config.libraryName,
          mediaType: config.mediaType,
          sortOrderHome: config.sortOrderHome ?? 1,
          sortOrderLibrary: config.sortOrderLibrary ?? 0,
          isLibraryPromoted:
            config.isLibraryPromoted ??
            existingConfig?.isLibraryPromoted ??
            false,
          visibilityConfig: config.visibilityConfig,
          isActive: true, // All discovered items start as active
          // Copy linking fields from discovered config (if present)
          collectionType: config.collectionType,
          isLinked: config.isLinked,
          linkId: config.linkId,
          isUnlinked: config.isUnlinked,
          timeRestriction: config.timeRestriction || {
            alwaysActive: true, // Default to always active
          },
          customPoster: config.customPoster ?? existingConfig?.customPoster,
        };
      }
    );

    const updatedConfigs = [
      ...existingPreExistingConfigs,
      ...preExistingConfigsWithActiveStatus,
    ];
    settings.plex.preExistingCollectionConfigs = updatedConfigs;
    settings.save();

    logger.info('Pre-existing collection configurations appended', {
      label: 'Pre-existing Collection Config Service',
      appended: newConfigs.length,
      total: updatedConfigs.length,
    });

    return updatedConfigs;
  }
}

// Create and export singleton instance
export const preExistingCollectionConfigService =
  new PreExistingCollectionConfigService();
export default preExistingCollectionConfigService;
