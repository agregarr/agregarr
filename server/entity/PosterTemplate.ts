import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export interface PosterTemplateData {
  // Canvas dimensions
  width: number;
  height: number;

  // Background configuration
  background: {
    type: 'color' | 'gradient';
    color?: string; // Single color or primary gradient color
    secondaryColor?: string; // For gradients
    useSourceColors?: boolean; // If true, use global source-specific colors from SourceColors table
  };

  // Text elements
  textElements: {
    id: string;
    type: 'collection-title' | 'custom-text';
    text?: string; // For custom text, collection title is dynamic
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

  // Icon/logo elements
  iconElements: {
    id: string;
    type: 'source-logo' | 'custom-icon';
    iconPath?: string; // For custom icons, service logo is dynamic
    x: number;
    y: number;
    width: number;
    height: number;
    grayscale: boolean;
  }[];

  // Content grid for collection items
  contentGrid?: {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    columns: number;
    rows: number;
    spacing: number;
    cornerRadius: number;
  };
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
