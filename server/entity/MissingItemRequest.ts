import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './User';

/**
 * Entity for tracking missing items that have been requested
 * This allows us to show users what Agregarr has been doing
 */
@Entity()
export class MissingItemRequest {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'integer' })
  public tmdbId: number;

  @Column({ type: 'varchar', length: 10 })
  public mediaType: 'movie' | 'tv';

  @Column({ type: 'varchar', length: 255 })
  public title: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  public posterPath?: string; // TMDB poster path

  @Column({ type: 'integer', nullable: true })
  public year?: number;

  @Column({ type: 'varchar', length: 255 })
  public collectionName: string; // Name of the collection this came from

  @Column({ type: 'varchar', length: 50 })
  public collectionSource: string; // 'trakt', 'tmdb', 'imdb', 'letterboxd', etc.

  @Column({ type: 'varchar', length: 100, nullable: true })
  public collectionSubtype?: string; // 'trending', 'popular', etc. for granular tracking

  @Column({ type: 'varchar', length: 50 })
  public requestService: string; // 'radarr', 'sonarr', 'overseerr'

  @Column({ type: 'varchar', length: 50 })
  public requestMethod: string; // 'auto', 'manual' (for overseerr), or service name for arr services

  @Column({ type: 'varchar', length: 20 })
  public requestStatus:
    | 'pending'
    | 'approved'
    | 'declined'
    | 'available'
    | 'processing'
    | 'failed'
    | 'partially_available'; // Track current status

  @Column({ type: 'integer', nullable: true })
  public overseerrRequestId?: number; // Link to Overseerr request if applicable

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn()
  public requestedBy?: User; // The service user that made the request

  @Column({ type: 'integer', nullable: true })
  public requestedById?: number;

  @CreateDateColumn()
  public createdAt: Date;

  @UpdateDateColumn()
  public updatedAt: Date;

  @Column({ type: 'datetime', nullable: true })
  public requestedAt?: Date; // When the actual request was made to download service

  @Column({ type: 'text', nullable: true })
  public notes?: string; // Any additional notes or error messages

  constructor(init?: Partial<MissingItemRequest>) {
    Object.assign(this, init);
  }
}
