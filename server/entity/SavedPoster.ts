import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export interface SavedPosterData {
  // Canvas dimensions
  width: number;
  height: number;

  // All the same structure as PosterTemplateData but with actual values
  // Background configuration
  background: {
    type: 'color' | 'gradient';
    color?: string;
    secondaryColor?: string;
  };

  // Text elements with actual text content
  textElements: {
    id: string;
    text: string; // Always actual text for saved posters
    x: number;
    y: number;
    width: number;
    height: number;
    fontSize: number;
    fontFamily: string;
    fontWeight: 'normal' | 'bold';
    fontStyle: 'normal' | 'italic';
    color: string;
    textAlign: 'left' | 'center' | 'right';
    maxLines?: number;
  }[];

  // Icon/logo elements with actual paths
  iconElements: {
    id: string;
    iconPath: string; // Always actual path for saved posters
    x: number;
    y: number;
    width: number;
    height: number;
    grayscale: boolean;
  }[];

  // Content grid with actual poster URLs
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
