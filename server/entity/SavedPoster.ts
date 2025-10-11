import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { LayeredElement } from './PosterTemplate';

export interface SavedPosterData {
  // Canvas dimensions
  width: number;
  height: number;

  // Background configuration
  background: {
    type: 'color' | 'gradient';
    color?: string;
    secondaryColor?: string;
    useSourceColors?: boolean;
    intensity?: number;
  };

  // Unified layering system
  elements: LayeredElement[];
  migrated: boolean; // Migration completion flag

  // Content items for poster previews
  contentItems?: {
    id: string;
    posterUrl: string;
    x: number;
    y: number;
    width: number;
    height: number;
    cornerRadius: number;
  }[];
}

@Entity()
export class SavedPoster {
  constructor(init?: Partial<SavedPoster>) {
    Object.assign(this, init);
  }

  @PrimaryGeneratedColumn()
  public id: number;

  @Column()
  public name: string;

  @Column({ nullable: true })
  public description?: string;

  @Column({ type: 'text' })
  public posterData: string; // JSON serialized SavedPosterData

  @Column({ nullable: true })
  public filename?: string; // Saved JPEG filename in poster storage

  @Column({ nullable: true })
  public thumbnailFilename?: string; // Smaller preview image

  @Column({ default: true })
  public isActive: boolean;

  @CreateDateColumn()
  public createdAt: Date;

  @UpdateDateColumn()
  public updatedAt: Date;

  // Helper methods for poster data
  public getPosterData(): SavedPosterData {
    return JSON.parse(this.posterData);
  }

  public setPosterData(data: SavedPosterData): void {
    this.posterData = JSON.stringify(data);
  }
}
