import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Tracks missing items from collection syncs for Quick Sync feature
 * Stores items that were not found in Plex during full sync so they can be
 * efficiently added to collections when they become available
 */
@Entity()
export class CollectionMissingItems {
  constructor(init?: Partial<CollectionMissingItems>) {
    Object.assign(this, init);
  }

  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'varchar' })
  @Index()
  public collectionRatingKey: string; // Plex collection rating key (primary identifier)

  @Column({ type: 'varchar' })
  @Index()
  public configId: string; // Parent CollectionConfig.id (same for multi-collection patterns)

  @Column({ type: 'varchar' })
  @Index()
  public libraryId: string; // Plex library key

  @Column({ type: 'integer' })
  @Index()
  public tmdbId: number; // TMDB ID for matching

  @Column({ type: 'integer', nullable: true })
  public tvdbId?: number; // TVDB ID for anime/TV matching

  @Column({ type: 'varchar', length: 10 })
  public mediaType: 'movie' | 'tv';

  @Column({ type: 'varchar' })
  public title: string;

  @Column({ type: 'integer', nullable: true })
  public year?: number;

  @Column({ type: 'integer' })
  public originalPosition: number; // Position in original source list for correct ordering

  @Column({ type: 'varchar', nullable: true })
  public source?: string; // Source of the item: 'trakt', 'tmdb', 'imdb', etc.

  @Column({ type: 'datetime' })
  @Index()
  public fullSyncTimestamp: Date; // When full sync stored these items (for cleanup)

  @CreateDateColumn()
  public createdAt: Date;

  @UpdateDateColumn()
  public updatedAt: Date;
}
