import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Configuration for which overlay templates are enabled for a specific library
 */
export interface EnabledOverlay {
  templateId: number; // Reference to OverlayTemplate
  enabled: boolean; // Whether this overlay is active
  layerOrder: number; // Stacking order (0 = bottom, higher = top)
}

/**
 * Database entity for library-specific overlay configuration
 */
@Entity()
export class OverlayLibraryConfig {
  constructor(init?: Partial<OverlayLibraryConfig>) {
    Object.assign(this, init);
  }

  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ unique: true })
  public libraryId: string; // Plex library key

  @Column()
  public libraryName: string; // Friendly name for display

  @Column()
  public mediaType: 'movie' | 'show';

  @Column({ type: 'simple-json' })
  public enabledOverlays: EnabledOverlay[];

  @CreateDateColumn()
  public createdAt: Date;

  @UpdateDateColumn()
  public updatedAt: Date;
}
