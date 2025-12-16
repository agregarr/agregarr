import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Tracks metadata for Plex collections to prevent redundant uploads
 * Stores input hashes and Plex upload URLs to detect when regeneration/reapplication is needed
 */
@Entity()
export class CollectionMetadata {
  constructor(init?: Partial<CollectionMetadata>) {
    Object.assign(this, init);
  }

  @PrimaryColumn('varchar')
  @Index()
  public plexCollectionRatingKey: string;

  @Column({ type: 'varchar', nullable: true })
  @Index()
  public collectionConfigId?: string;

  @Column({ type: 'varchar', nullable: true })
  public libraryKey?: string;

  // === POSTER METADATA ===
  @Column({ type: 'varchar', length: 64, nullable: true })
  public lastPosterInputHash?: string;

  @Column({ type: 'text', nullable: true })
  public lastPosterUploadUrl?: string;

  @Column({ type: 'datetime', nullable: true })
  public lastPosterAppliedAt?: Date;

  @Column({ type: 'varchar', nullable: true })
  public posterLocalPath?: string; // Local file path in config/posters/ for Discovery downloads

  // === WALLPAPER METADATA ===
  @Column({ type: 'varchar', nullable: true })
  public lastWallpaperFilename?: string;

  @Column({ type: 'text', nullable: true })
  public lastWallpaperUploadUrl?: string;

  @Column({ type: 'datetime', nullable: true })
  public lastWallpaperAppliedAt?: Date;

  // === THEME METADATA ===
  @Column({ type: 'varchar', nullable: true })
  public lastThemeFilename?: string;

  @Column({ type: 'text', nullable: true })
  public lastThemeUploadUrl?: string;

  @Column({ type: 'datetime', nullable: true })
  public lastThemeAppliedAt?: Date;

  @CreateDateColumn()
  public createdAt: Date;

  @UpdateDateColumn()
  public updatedAt: Date;
}
