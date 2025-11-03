import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Tracks Coming Soon placeholder items created in Plex
 * Used for cleanup when real files are added
 */
@Entity()
export class ComingSoonItem {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'varchar' })
  public configId: string; // Collection config ID

  @Column({ type: 'varchar' })
  public mediaType: 'movie' | 'tv';

  @Column({ type: 'integer' })
  public tmdbId: number;

  @Column({ type: 'integer', nullable: true })
  public tvdbId?: number;

  @Column({ type: 'varchar' })
  public title: string;

  @Column({ type: 'integer', nullable: true })
  public year?: number;

  @Column({ type: 'varchar', nullable: true })
  public releaseDate?: string;

  @Column({ type: 'boolean', default: false })
  public isEstimatedDate: boolean;

  @Column({ type: 'integer', nullable: true })
  public seasonNumber?: number;

  @Column({ type: 'varchar' })
  public source: 'radarr' | 'sonarr' | 'trakt';

  @Column({ type: 'varchar' })
  public placeholderPath: string; // Full filesystem path to placeholder file

  @Column({ type: 'varchar', nullable: true })
  public plexRatingKey?: string; // Plex item ID

  @Column({ type: 'datetime', nullable: true })
  public releasedAt?: Date; // When the real file was detected (for 7-day post-release tracking)

  @CreateDateColumn()
  public createdAt: Date;

  @UpdateDateColumn()
  public updatedAt: Date;
}
