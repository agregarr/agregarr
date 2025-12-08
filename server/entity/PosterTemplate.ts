import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// New unified layering system types
export interface LayeredElement {
  id: string;
  layerOrder: number; // 0 = bottom, higher = top
  type: 'text' | 'raster' | 'svg' | 'content-grid' | 'person';

  // Common properties
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number; // Rotation in degrees (0-360)

  // Type-specific properties (discriminated union)
  properties:
    | TextElementProps
    | RasterElementProps
    | SVGElementProps
    | ContentGridProps
    | PersonElementProps;
}

export interface TextElementProps {
  elementType: 'collection-title' | 'custom-text';
  text?: string; // For custom text, collection title is dynamic
  fontSize: number;
  fontFamily: string;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  color: string;
  textAlign: 'left' | 'center' | 'right';
  maxLines?: number;
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
}

export interface RasterElementProps {
  imagePath: string; // Path to uploaded raster image
}

export interface PersonElementProps {
  imagePath?: string; // Optional preview/placeholder image
  overlayColor?: string; // Optional overlay tint color
  overlayOpacity?: number; // 0-1 overlay opacity
}

export interface SVGElementProps {
  iconType: 'source-logo' | 'svg-icon' | 'custom-icon';
  iconPath?: string; // For custom icons, service logo is dynamic
  grayscale: boolean;
}

export interface ContentGridProps {
  columns: number;
  rows: number;
  spacing: number;
  cornerRadius: number;
}

export interface PosterTemplateData {
  // Canvas dimensions
  width: number;
  height: number;

  // Background configuration
  background: {
    type: 'color' | 'gradient' | 'radial';
    color?: string; // Single color or primary gradient color
    secondaryColor?: string; // For gradients
    intensity?: number; // For gradients - controls gradient spread (0-100)
    useSourceColors?: boolean; // If true, use global source-specific colors from SourceColors table
  };

  // Unified layering system
  elements: LayeredElement[]; // Unified element list with layer ordering
  migrated: boolean; // Migration completion flag (always true after v1.3.2)
}

@Entity()
export class PosterTemplate {
  constructor(init?: Partial<PosterTemplate>) {
    Object.assign(this, init);
  }

  @PrimaryGeneratedColumn()
  public id: number;

  @Column()
  public name: string;

  @Column({ nullable: true })
  public description?: string;

  @Column({ type: 'text' })
  public templateData: string; // JSON serialized PosterTemplateData

  @Column({ default: false })
  public isDefault: boolean; // True for system default templates

  @Column({ default: true })
  public isActive: boolean;

  @CreateDateColumn()
  public createdAt: Date;

  @UpdateDateColumn()
  public updatedAt: Date;

  // Helper methods for template data
  public getTemplateData(): PosterTemplateData {
    return JSON.parse(this.templateData);
  }

  public setTemplateData(data: PosterTemplateData): void {
    this.templateData = JSON.stringify(data);
  }
}
