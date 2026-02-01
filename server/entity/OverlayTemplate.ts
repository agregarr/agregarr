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
  type: 'text' | 'tile' | 'variable' | 'raster' | 'svg' | 'mapped-icon';

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
    | OverlaySVGElementProps
    | OverlayMappedIconElementProps;
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
  opacity?: number; // 0-100
}

/**
 * Tile element - decorative rectangle (no text)
 */
export interface OverlayTileElementProps {
  fillColor: string;
  fillOpacity: number; // 0-100
  borderColor?: string;
  borderWidth?: number; // Absolute pixels in template canvas
  borderRadius?: number; // Absolute pixels (deprecated - use individual corners)
  borderRadiusTopLeft?: number; // Absolute pixels
  borderRadiusTopRight?: number; // Absolute pixels
  borderRadiusBottomLeft?: number; // Absolute pixels
  borderRadiusBottomRight?: number; // Absolute pixels
  lockCorners?: boolean; // When true, all corners use topLeft value
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
  opacity?: number; // 0-100
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
 * Icon mapping entry - maps a context value to an icon
 * Used by mapped-icon elements to display icons based on field values
 */
export interface IconMapping {
  value: string; // e.g., "eng", "1080"
  iconPath: string; // e.g., "/api/v1/posters/icons/user/flag-en.svg"
}

/**
 * Mapped Icon element - displays icons based on context field values
 * Reads a context field (single value or array), looks up each value
 * in the mappings table, and renders the corresponding icon(s)
 */
export interface OverlayMappedIconElementProps {
  field: string; // Context field (e.g., 'audioLanguages', 'resolution')
  mappings: IconMapping[]; // User-defined value → icon mappings

  // Layout configuration
  layout: 'horizontal' | 'vertical' | 'grid';
  iconSize: number; // Icon size in pixels
  spacingX: number; // Horizontal space between icons (can be negative for overlap)
  spacingY: number; // Vertical space between icons (can be negative for overlap)
  spacing?: number; // Deprecated: use spacingX/spacingY. Kept for backward compatibility.
  maxIcons?: number; // Optional limit (0 = unlimited)
  gridColumns?: number; // For grid layout (default 3)

  // Visual options
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
 * Uses a flat section-based structure for better UX
 *
 * Structure reads naturally:
 * - Section 1: (rule1 AND rule2 AND rule3)
 * - OR/AND (section operator)
 * - Section 2: (rule4 OR rule5)
 *
 * Example: Show overlay when (views=0 AND dateAdded<X) OR (rating>8)
 * {
 *   sections: [
 *     {
 *       rules: [
 *         { field: 'viewCount', operator: 'eq', value: 0 },
 *         { ruleOperator: 'and', field: 'dateAdded', operator: 'lt', value: '2024-01-01' }
 *       ]
 *     },
 *     {
 *       sectionOperator: 'or',
 *       rules: [
 *         { field: 'imdbRating', operator: 'gt', value: 8 }
 *       ]
 *     }
 *   ]
 * }
 */
export interface ApplicationCondition {
  sections: ConditionSection[];
}

/**
 * A section contains rules that combine with AND or OR
 * sectionOperator determines how this section connects to the PREVIOUS section
 */
export interface ConditionSection {
  sectionOperator?: 'and' | 'or'; // How this section combines with previous section (omitted for first section)
  rules: ConditionRule[];
}

/**
 * A single condition rule (field/operator/value)
 * ruleOperator determines how this rule connects to the PREVIOUS rule in the section
 */
export interface ConditionRule {
  ruleOperator?: 'and' | 'or'; // How this rule combines with previous rule (omitted for first rule in section)
  field: string; // e.g., 'imdbRating', 'resolution', 'daysUntilRelease'
  operator:
    | 'eq' // equals
    | 'neq' // not equals
    | 'gt' // greater than
    | 'gte' // greater than or equal
    | 'lt' // less than
    | 'lte' // less than or equal
    | 'in' // value in array
    | 'contains' // string contains
    | 'notContains' // string does not contain
    | 'regex' // regex match
    | 'begins' // string begins with
    | 'ends' // string ends with
    | 'exists'; // field exists (has non-null/undefined value)
  value: string | number | boolean | (string | number)[];
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

  @Column({ default: 0 })
  public displayOrder: number; // Order for UI display (lower = earlier)

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

  // Tags for categorization/filtering
  @Column({ type: 'text', nullable: true })
  public tags: string | null;

  // Helper methods for tags
  public getTags(): string[] {
    if (!this.tags) return [];
    return JSON.parse(this.tags);
  }

  public setTags(tags: string[] | undefined | null): void {
    this.tags = tags && tags.length > 0 ? JSON.stringify(tags) : null;
  }
}
