import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Tracks placeholder items created in Plex for missing content
 * Database stores ONLY lifecycle tracking - context data comes from live sources (TMDB, Plex, Sonarr/Radarr)
 */
@Entity('coming_soon_item') // Keep the same table name for backward compatibility
export class PlaceholderItem {
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

  @Column({ type: 'varchar' })
  public source:
    | 'anilist'
    | 'comingsoon'
    | 'imdb'
    | 'letterboxd'
    | 'mdblist'
    | 'myanimelist'
    | 'networks'
    | 'originals'
    | 'radarr'
    | 'sonarr'
    | 'tmdb'
    | 'trakt';

  @Column({ type: 'varchar' })
  public placeholderPath: string; // Full filesystem path to placeholder file

  @Column({ type: 'varchar', nullable: true })
  public plexRatingKey?: string; // Plex item ID (once discovered)

  @CreateDateColumn()
  public createdAt: Date;

  @UpdateDateColumn()
  public updatedAt: Date;
}

/**
 * @deprecated Use PlaceholderItem instead
 */
export { PlaceholderItem as ComingSoonItem };
