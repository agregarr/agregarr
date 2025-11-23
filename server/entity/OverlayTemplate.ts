import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Overlay element types - subset of PosterTemplate elements
 * No background, no content-grid (overlays are applied to existing posters)
 * Uses absolute positioning in a 1000x1500 template canvas (scaled when applied to actual posters)
 */
export interface OverlayElement {
  id: string;
  layerOrder: number; // 0 = bottom, higher = top (for stacking multiple elements)
  type: 'text' | 'tile' | 'variable' | 'raster' | 'svg';

  // Common properties (absolute pixels in template canvas)
  x: number; // Absolute pixels (in 1000x1500 template canvas)
  y: number; // Absolute pixels
  width: number; // Absolute pixels
  height: number; // Absolute pixels
  rotation?: number; // Rotation in degrees (0-360)

  // Type-specific properties (discriminated union)
  properties:
    | OverlayTextElementProps
    | OverlayTileElementProps
    | OverlayVariableElementProps
    | OverlayRasterElementProps
    | OverlaySVGElementProps;
}

/**
 * Text element - pure text only (no background)
 */
export interface OverlayTextElementProps {
  text: string;
  fontSize: number; // Absolute pixels in template canvas
  fontFamily: string;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  color: string;
  textAlign: 'left' | 'center' | 'right';
  maxLines?: number;
}

/**
 * Tile element - decorative rectangle (no text)
 */
export interface OverlayTileElementProps {
  fillColor: string;
  fillOpacity: number; // 0-100
  borderColor?: string;
  borderWidth?: number; // Absolute pixels in template canvas
  borderRadius?: number; // Absolute pixels
}

/**
 * Segment in a variable element (for composing dynamic text)
 */
export interface OverlayVariableSegment {
  type: 'text' | 'variable';
  value?: string; // For type='text' - static text content
  field?: string; // For type='variable' - field name from context (e.g., 'seasonNumber', 'daysUntilRelease')
  format?: string; // For type='variable' with date fields - date format string (e.g., 'YYYY-MM-DD', 'MMM DD')
}

/**
 * Variable element - compose dynamic text from multiple segments
 * Example segments for "SEASON 2 IN 14 DAYS":
 * - { type: 'text', value: 'SEASON ' }
 * - { type: 'variable', field: 'seasonNumber' }
 * - { type: 'text', value: ' IN ' }
 * - { type: 'variable', field: 'daysUntilRelease' }
 * - { type: 'text', value: ' DAYS' }
 */
export interface OverlayVariableElementProps {
  segments: OverlayVariableSegment[]; // Array of text and variable segments
  fontSize: number; // Absolute pixels in template canvas
  fontFamily: string;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  color: string;
  textAlign: 'left' | 'center' | 'right';
}

/**
 * Raster image element (PNG/JPG)
 */
export interface OverlayRasterElementProps {
  imagePath: string; // Path to uploaded raster image
  opacity?: number; // 0-100
}

/**
 * SVG element (icons, logos)
 */
export interface OverlaySVGElementProps {
  iconType: 'service-logo' | 'custom-icon' | 'dynamic-icon';
  iconPath?: string; // For custom/static icons
  dynamicIconField?: string; // For dynamic icons like {studioLogo}
  grayscale?: boolean;
  opacity?: number; // 0-100
}

/**
 * Overlay template data structure
 * Templates are designed in a 1000x1500 canvas (same as poster templates)
 * When applied to actual posters, elements are scaled proportionally
 *
 * One template = One visual design = One application condition
 * The condition is defined at the template level via applicationCondition (field/operator/value)
 */
export interface OverlayTemplateData {
  // Canvas dimensions for template editing (typically 1000x1500)
  width: number;
  height: number;

  // Visual elements (tiles, text, variables, images, icons)
  elements: OverlayElement[];
}

/**
 * Overlay template types for organization
 */
export type OverlayTemplateType =
  | 'rating' // IMDb, RT, etc.
  | 'metadata' // Director, studio, year, etc.
  | 'technical' // Resolution, audio format, etc.
  | 'status' // Coming soon, watched, etc.
  | 'generic'; // No specific condition / general purpose

/**
 * Application condition for when to apply an overlay template
 * This determines when the overlay should be shown based on item data
 *
 * Supports:
 * - Simple conditions: { field: 'daysUntilRelease', operator: 'gt', value: 0 }
 * - AND conditions: { and: [condition1, condition2, ...] }
 * - OR conditions: { or: [condition1, condition2, ...] }
 * - Nested: { and: [condition1, { or: [condition2, condition3] }] }
 */
export interface ApplicationCondition {
  // Single condition fields (optional when using compound)
  field?: string; // e.g., 'imdbRating', 'resolution', 'daysUntilRelease'
  operator?:
    | 'eq' // equals
    | 'neq' // not equals
    | 'gt' // greater than
    | 'gte' // greater than or equal
    | 'lt' // less than
    | 'lte' // less than or equal
    | 'in' // value in array
    | 'contains' // string contains
    | 'regex' // regex match
    | 'begins' // string begins with
    | 'ends'; // string ends with
  value?: string | number | boolean | (string | number)[];

  // Compound condition arrays
  and?: ApplicationCondition[];
  or?: ApplicationCondition[];
}

/**
 * Database entity for overlay templates
 */
@Entity()
export class OverlayTemplate {
  constructor(init?: Partial<OverlayTemplate>) {
    Object.assign(this, init);
  }

  @PrimaryGeneratedColumn()
  public id: number;

  @Column()
  public name: string;

  @Column({ nullable: true })
  public description?: string;

  @Column({
    type: 'varchar',
    default: 'generic',
  })
  public type: OverlayTemplateType;

  @Column({ type: 'text' })
  public templateData: string; // JSON serialized OverlayTemplateData

  @Column({ default: false })
  public isDefault: boolean; // True for system preset templates

  @Column({ default: true })
  public isActive: boolean;

  // Generic application condition (field/operator/value)
  @Column({ type: 'text', nullable: true })
  public applicationCondition: string | null; // JSON serialized ApplicationCondition

  @CreateDateColumn()
  public createdAt: Date;

  @UpdateDateColumn()
  public updatedAt: Date;

  // Helper methods for template data
  public getTemplateData(): OverlayTemplateData {
    return JSON.parse(this.templateData);
  }

  public setTemplateData(data: OverlayTemplateData): void {
    this.templateData = JSON.stringify(data);
  }

  // Helper methods for application condition
  public getApplicationCondition(): ApplicationCondition | undefined {
    if (!this.applicationCondition) return undefined;
    return JSON.parse(this.applicationCondition);
  }

  public setApplicationCondition(
    condition: ApplicationCondition | undefined | null
  ): void {
    this.applicationCondition = condition ? JSON.stringify(condition) : null;
  }
}
