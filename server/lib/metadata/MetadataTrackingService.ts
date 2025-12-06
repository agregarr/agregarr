import { getRepository } from '@server/datasource';
import { CollectionMetadata } from '@server/entity/CollectionMetadata';
import { MediaItemMetadata } from '@server/entity/MediaItemMetadata';
import logger from '@server/logger';

/**
 * Service for managing collection and media item metadata tracking
 * Prevents redundant uploads by tracking input hashes and Plex upload URLs
 */
class MetadataTrackingService {
  // === COLLECTION POSTER METHODS ===

  async shouldRegeneratePoster(
    collectionRatingKey: string,
    newInputHash: string
  ): Promise<boolean> {
    const repo = getRepository(CollectionMetadata);
    const metadata = await repo.findOne({
      where: { plexCollectionRatingKey: collectionRatingKey },
    });

    if (!metadata?.lastPosterInputHash) {
      logger.debug('No poster metadata found, regeneration needed', {
        label: 'MetadataTracking',
        collectionRatingKey,
      });
      return true;
    }

    const needsRegeneration = metadata.lastPosterInputHash !== newInputHash;

    logger.debug('Poster regeneration check', {
      label: 'MetadataTracking',
      collectionRatingKey,
      needsRegeneration,
      lastHash: metadata.lastPosterInputHash.substring(0, 8),
      newHash: newInputHash.substring(0, 8),
    });

    return needsRegeneration;
  }

  async shouldReapplyPoster(
    collectionRatingKey: string,
    currentPlexUrl: string | null
  ): Promise<boolean> {
    const repo = getRepository(CollectionMetadata);
    const metadata = await repo.findOne({
      where: { plexCollectionRatingKey: collectionRatingKey },
    });

    if (!metadata?.lastPosterUploadUrl) {
      logger.debug('No poster URL tracked, reapplication needed', {
        label: 'MetadataTracking',
        collectionRatingKey,
      });
      return true;
    }

    if (!currentPlexUrl) {
      logger.debug('No current Plex poster, reapplication needed', {
        label: 'MetadataTracking',
        collectionRatingKey,
      });
      return true;
    }

    const needsReapplication = metadata.lastPosterUploadUrl !== currentPlexUrl;

    logger.debug('Poster reapplication check', {
      label: 'MetadataTracking',
      collectionRatingKey,
      needsReapplication,
      expectedUrl: metadata.lastPosterUploadUrl,
      currentUrl: currentPlexUrl,
    });

    return needsReapplication;
  }

  async recordPosterApplication(
    collectionRatingKey: string,
    inputHash: string,
    uploadUrl: string,
    options?: { configId?: string; libraryKey?: string }
  ): Promise<void> {
    const repo = getRepository(CollectionMetadata);

    let metadata = await repo.findOne({
      where: { plexCollectionRatingKey: collectionRatingKey },
    });

    if (!metadata) {
      metadata = new CollectionMetadata({
        plexCollectionRatingKey: collectionRatingKey,
        collectionConfigId: options?.configId,
        libraryKey: options?.libraryKey,
      });
    }

    metadata.lastPosterInputHash = inputHash;
    metadata.lastPosterUploadUrl = uploadUrl;
    metadata.lastPosterAppliedAt = new Date();

    await repo.save(metadata);

    logger.info('Recorded poster application', {
      label: 'MetadataTracking',
      collectionRatingKey,
      inputHash: inputHash.substring(0, 8),
      uploadUrl,
    });
  }

  // === WALLPAPER METHODS ===

  async shouldReapplyWallpaper(
    collectionRatingKey: string,
    newFilename: string,
    currentPlexUrl: string | null
  ): Promise<boolean> {
    const repo = getRepository(CollectionMetadata);
    const metadata = await repo.findOne({
      where: { plexCollectionRatingKey: collectionRatingKey },
    });

    // Check if filename changed (acts as input hash)
    if (!metadata || metadata.lastWallpaperFilename !== newFilename) {
      return true;
    }

    // Check if Plex URL matches
    if (!currentPlexUrl || metadata.lastWallpaperUploadUrl !== currentPlexUrl) {
      return true;
    }

    return false;
  }

  async recordWallpaperApplication(
    collectionRatingKey: string,
    filename: string,
    uploadUrl: string,
    options?: { configId?: string; libraryKey?: string }
  ): Promise<void> {
    const repo = getRepository(CollectionMetadata);

    let metadata = await repo.findOne({
      where: { plexCollectionRatingKey: collectionRatingKey },
    });

    if (!metadata) {
      metadata = new CollectionMetadata({
        plexCollectionRatingKey: collectionRatingKey,
        collectionConfigId: options?.configId,
        libraryKey: options?.libraryKey,
      });
    }

    metadata.lastWallpaperFilename = filename;
    metadata.lastWallpaperUploadUrl = uploadUrl;
    metadata.lastWallpaperAppliedAt = new Date();

    await repo.save(metadata);

    logger.info('Recorded wallpaper application', {
      label: 'MetadataTracking',
      collectionRatingKey,
      filename,
      uploadUrl,
    });
  }

  // === THEME METHODS ===

  async shouldReapplyTheme(
    collectionRatingKey: string,
    newFilename: string,
    currentPlexUrl: string | null
  ): Promise<boolean> {
    const repo = getRepository(CollectionMetadata);
    const metadata = await repo.findOne({
      where: { plexCollectionRatingKey: collectionRatingKey },
    });

    if (!metadata || metadata.lastThemeFilename !== newFilename) {
      return true;
    }

    if (!currentPlexUrl || metadata.lastThemeUploadUrl !== currentPlexUrl) {
      return true;
    }

    return false;
  }

  async recordThemeApplication(
    collectionRatingKey: string,
    filename: string,
    uploadUrl: string,
    options?: { configId?: string; libraryKey?: string }
  ): Promise<void> {
    const repo = getRepository(CollectionMetadata);

    let metadata = await repo.findOne({
      where: { plexCollectionRatingKey: collectionRatingKey },
    });

    if (!metadata) {
      metadata = new CollectionMetadata({
        plexCollectionRatingKey: collectionRatingKey,
        collectionConfigId: options?.configId,
        libraryKey: options?.libraryKey,
      });
    }

    metadata.lastThemeFilename = filename;
    metadata.lastThemeUploadUrl = uploadUrl;
    metadata.lastThemeAppliedAt = new Date();

    await repo.save(metadata);

    logger.info('Recorded theme application', {
      label: 'MetadataTracking',
      collectionRatingKey,
      filename,
      uploadUrl,
    });
  }

  // === OVERLAY METHODS (for individual items) ===

  async shouldReapplyOverlay(
    itemRatingKey: string,
    newInputHash: string,
    currentPlexUrl: string | null
  ): Promise<boolean> {
    const repo = getRepository(MediaItemMetadata);
    const metadata = await repo.findOne({
      where: { plexItemRatingKey: itemRatingKey },
    });

    // Check if input hash changed
    if (!metadata || metadata.lastOverlayInputHash !== newInputHash) {
      return true;
    }

    // Check if Plex URL matches
    if (!currentPlexUrl || metadata.lastPosterUploadUrl !== currentPlexUrl) {
      return true;
    }

    return false;
  }

  async recordOverlayApplication(
    itemRatingKey: string,
    libraryKey: string,
    inputHash: string,
    uploadUrl: string
  ): Promise<void> {
    const repo = getRepository(MediaItemMetadata);

    let metadata = await repo.findOne({
      where: { plexItemRatingKey: itemRatingKey },
    });

    if (!metadata) {
      metadata = new MediaItemMetadata({
        plexItemRatingKey: itemRatingKey,
        libraryKey: libraryKey,
      });
    }

    metadata.lastOverlayInputHash = inputHash;
    metadata.lastPosterUploadUrl = uploadUrl;
    metadata.lastOverlayAppliedAt = new Date();

    await repo.save(metadata);

    logger.info('Recorded overlay application', {
      label: 'MetadataTracking',
      itemRatingKey,
      inputHash: inputHash.substring(0, 8),
      uploadUrl,
    });
  }

  async recordOverlayApplicationWithBasePoster(
    itemRatingKey: string,
    libraryKey: string,
    overlayInputHash: string,
    ourOverlayPosterUrl: string,
    basePosterInfo: {
      basePosterSource: 'tmdb' | 'plex';
      originalPlexPosterUrl: string;
      basePosterFilename: string;
    }
  ): Promise<void> {
    const repo = getRepository(MediaItemMetadata);

    let metadata = await repo.findOne({
      where: { plexItemRatingKey: itemRatingKey },
    });

    if (!metadata) {
      metadata = new MediaItemMetadata({
        plexItemRatingKey: itemRatingKey,
        libraryKey: libraryKey,
      });
    }

    // Update overlay tracking
    metadata.lastOverlayInputHash = overlayInputHash;
    metadata.lastPosterUploadUrl = ourOverlayPosterUrl;
    metadata.lastOverlayAppliedAt = new Date();

    // Update base poster tracking
    metadata.basePosterSource = basePosterInfo.basePosterSource;
    metadata.originalPlexPosterUrl = basePosterInfo.originalPlexPosterUrl;
    metadata.ourOverlayPosterUrl = ourOverlayPosterUrl;
    metadata.basePosterFilename = basePosterInfo.basePosterFilename;

    await repo.save(metadata);

    logger.info('Recorded overlay application with base poster tracking', {
      label: 'MetadataTracking',
      itemRatingKey,
      overlayInputHash: overlayInputHash.substring(0, 8),
      basePosterSource: basePosterInfo.basePosterSource,
    });
  }

  async getItemMetadata(
    itemRatingKey: string
  ): Promise<MediaItemMetadata | null> {
    const repo = getRepository(MediaItemMetadata);
    return await repo.findOne({
      where: { plexItemRatingKey: itemRatingKey },
    });
  }
}

export default new MetadataTrackingService();
