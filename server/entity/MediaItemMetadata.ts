import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Tracks metadata for individual Plex media items (movies/shows) to prevent redundant overlay uploads
 * Stores input hashes and Plex upload URLs for poster overlays
 */
@Entity()
export class MediaItemMetadata {
  constructor(init?: Partial<MediaItemMetadata>) {
    Object.assign(this, init);
  }

  @PrimaryColumn('varchar')
  @Index()
  public plexItemRatingKey: string;

  @Column({ type: 'varchar' })
  @Index()
  public libraryKey: string;

  // === OVERLAY METADATA ===
  @Column({ type: 'varchar', length: 64, nullable: true })
  public lastOverlayInputHash?: string;

  @Column({ type: 'text', nullable: true })
  public lastPosterUploadUrl?: string;

  @Column({ type: 'datetime', nullable: true })
  public lastOverlayAppliedAt?: Date;

  @CreateDateColumn()
  public createdAt: Date;

  @UpdateDateColumn()
  public updatedAt: Date;
}
