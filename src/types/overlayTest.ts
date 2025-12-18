import type { ApplicationCondition } from '@server/entity/OverlayTemplate';

export interface PlexSearchResult {
  ratingKey: string;
  title: string;
  year?: number;
  type: 'movie' | 'show';
  thumb?: string;
  libraryId: string;
  libraryName: string;
}

export interface TemplateRuleResult {
  ruleIndex: number;
  ruleOperator?: 'and' | 'or';
  field: string;
  operator: string;
  value: unknown;
  actualValue: unknown;
  matched: boolean;
}

export interface TemplateSectionResult {
  sectionIndex: number;
  sectionOperator?: 'and' | 'or';
  matched: boolean;
  ruleResults: TemplateRuleResult[];
}

export interface TemplateResult {
  id: number;
  name: string;
  matched: boolean;
  appliedCondition?: ApplicationCondition;
  conditionResults?: {
    sectionResults: TemplateSectionResult[];
  };
}

export interface OverlayTestResult {
  poster: string; // Base64-encoded WebP image
  item: {
    ratingKey: string;
    title: string;
    year?: number;
    type: 'movie' | 'show';
    libraryId: string;
    libraryName: string;
  };
  templates: TemplateResult[];
  context: Record<string, unknown>; // Flat list of all context variables
  errors?: string[];
}
