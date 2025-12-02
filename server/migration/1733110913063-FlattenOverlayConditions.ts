import type {
  ApplicationCondition,
  ConditionRule,
  ConditionSection,
} from '@server/entity/OverlayTemplate';
import logger from '@server/logger';
import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Legacy nested condition structure (before flattening)
 * Used only for migration purposes
 */
interface LegacyCondition {
  field?: string;
  operator?:
    | 'eq'
    | 'neq'
    | 'gt'
    | 'gte'
    | 'lt'
    | 'lte'
    | 'in'
    | 'contains'
    | 'regex'
    | 'begins'
    | 'ends';
  value?: string | number | boolean | (string | number)[];
  and?: LegacyCondition[];
  or?: LegacyCondition[];
}

/**
 * Migration to flatten overlay template conditions from nested to flat structure
 *
 * Old nested structure:
 * { and: [condition1, { or: [condition2, condition3] }] }
 *
 * New flat structure:
 * { sections: [{ rules: [rule1, rule2] }] }
 *
 * This migration converts ALL existing applicationCondition JSON in the database
 */
export class FlattenOverlayConditions1733110913063
  implements MigrationInterface
{
  /**
   * Flatten a legacy nested condition structure to the new flat section/rule structure
   *
   * Strategy: Convert to Disjunctive Normal Form (DNF) - OR of ANDs
   * Example: A AND (B OR C) becomes (A AND B) OR (A AND C)
   *
   * This makes conditions human-readable with explicit duplication rather than nesting
   */
  private flattenCondition(
    legacy: LegacyCondition | undefined | null
  ): ApplicationCondition | undefined {
    if (!legacy) return undefined;

    // Convert legacy to DNF (array of AND clauses)
    const dnfClauses = this.toDNF(legacy);

    if (dnfClauses.length === 0) return undefined;

    // Convert DNF clauses to sections
    const sections: ConditionSection[] = dnfClauses.map((clause, index) => {
      const rules: ConditionRule[] = clause.map((rule, ruleIndex) => ({
        ...(ruleIndex > 0 && { ruleOperator: 'and' as const }), // All rules in a clause are ANDed
        field: rule.field,
        operator: rule.operator,
        value: rule.value as string | number | boolean | (string | number)[],
      }));

      return {
        ...(index > 0 && { sectionOperator: 'or' as const }), // All clauses are ORed
        rules,
      };
    });

    return { sections };
  }

  /**
   * Convert a legacy condition to Disjunctive Normal Form (DNF)
   * Returns an array of AND-clauses (each clause is an array of simple conditions)
   *
   * Example:
   * Input:  A AND (B OR C)
   * Output: [[A, B], [A, C]]
   *
   * Input:  (A OR B) AND (C OR D)
   * Output: [[A, C], [A, D], [B, C], [B, D]]
   */
  private toDNF(condition: LegacyCondition): {
    field: string;
    operator:
      | 'eq'
      | 'neq'
      | 'gt'
      | 'gte'
      | 'lt'
      | 'lte'
      | 'in'
      | 'contains'
      | 'regex'
      | 'begins'
      | 'ends';
    value: unknown;
  }[][] {
    // Simple condition (leaf node)
    if (condition.field && condition.operator) {
      return [
        [
          {
            field: condition.field,
            operator: condition.operator as
              | 'eq'
              | 'neq'
              | 'gt'
              | 'gte'
              | 'lt'
              | 'lte'
              | 'in'
              | 'contains'
              | 'regex'
              | 'begins'
              | 'ends',
            value: condition.value,
          },
        ],
      ];
    }

    // OR group: flatten each child and concatenate
    if (condition.or && condition.or.length > 0) {
      const result: ReturnType<typeof this.toDNF> = [];
      for (const child of condition.or) {
        result.push(...this.toDNF(child));
      }
      return result;
    }

    // AND group: flatten each child and compute cross product
    if (condition.and && condition.and.length > 0) {
      let result = this.toDNF(condition.and[0]);

      for (let i = 1; i < condition.and.length; i++) {
        const childDNF = this.toDNF(condition.and[i]);
        result = this.crossProduct(result, childDNF);
      }

      return result;
    }

    // Empty/invalid condition
    logger.warn('Empty or invalid condition encountered during flattening', {
      label: 'Migration',
      condition,
    });
    return [];
  }

  /**
   * Compute cross product of two DNF clause sets
   * Used to flatten AND groups
   *
   * Example:
   * left:  [[A], [B]]
   * right: [[C], [D]]
   * result: [[A, C], [A, D], [B, C], [B, D]]
   */
  private crossProduct(
    left: {
      field: string;
      operator:
        | 'eq'
        | 'neq'
        | 'gt'
        | 'gte'
        | 'lt'
        | 'lte'
        | 'in'
        | 'contains'
        | 'regex'
        | 'begins'
        | 'ends';
      value: unknown;
    }[][],
    right: {
      field: string;
      operator:
        | 'eq'
        | 'neq'
        | 'gt'
        | 'gte'
        | 'lt'
        | 'lte'
        | 'in'
        | 'contains'
        | 'regex'
        | 'begins'
        | 'ends';
      value: unknown;
    }[][]
  ): {
    field: string;
    operator:
      | 'eq'
      | 'neq'
      | 'gt'
      | 'gte'
      | 'lt'
      | 'lte'
      | 'in'
      | 'contains'
      | 'regex'
      | 'begins'
      | 'ends';
    value: unknown;
  }[][] {
    const result: {
      field: string;
      operator:
        | 'eq'
        | 'neq'
        | 'gt'
        | 'gte'
        | 'lt'
        | 'lte'
        | 'in'
        | 'contains'
        | 'regex'
        | 'begins'
        | 'ends';
      value: unknown;
    }[][] = [];

    for (const leftClause of left) {
      for (const rightClause of right) {
        result.push([...leftClause, ...rightClause]);
      }
    }

    return result;
  }
  public async up(queryRunner: QueryRunner): Promise<void> {
    logger.info('Starting overlay condition flattening migration', {
      label: 'Migration',
    });

    // Get all overlay templates
    const templates = await queryRunner.query(
      'SELECT id, name, applicationCondition FROM overlay_template WHERE applicationCondition IS NOT NULL'
    );

    logger.info(
      `Found ${templates.length} templates with conditions to migrate`,
      {
        label: 'Migration',
      }
    );

    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    for (const template of templates) {
      try {
        const oldCondition = JSON.parse(template.applicationCondition);

        // Check if already flat (has 'sections' property)
        if (oldCondition.sections && Array.isArray(oldCondition.sections)) {
          logger.debug(
            `Template "${template.name}" already has flat condition structure, skipping`,
            { label: 'Migration' }
          );
          skipCount++;
          continue;
        }

        // Flatten the condition
        const flatCondition = this.flattenCondition(oldCondition);

        if (!flatCondition) {
          logger.warn(
            `Could not flatten condition for template "${template.name}", setting to null`,
            { label: 'Migration', oldCondition }
          );
          await queryRunner.query(
            'UPDATE overlay_template SET applicationCondition = NULL WHERE id = ?',
            [template.id]
          );
          errorCount++;
          continue;
        }

        // Update with flattened condition
        await queryRunner.query(
          'UPDATE overlay_template SET applicationCondition = ? WHERE id = ?',
          [JSON.stringify(flatCondition), template.id]
        );

        logger.debug(
          `Successfully flattened condition for template "${template.name}"`,
          {
            label: 'Migration',
            sections: flatCondition.sections.length,
          }
        );
        successCount++;
      } catch (error) {
        logger.error(
          `Error flattening condition for template "${template.name}"`,
          {
            label: 'Migration',
            error: error instanceof Error ? error.message : String(error),
          }
        );
        errorCount++;
      }
    }

    logger.info('Overlay condition flattening migration completed', {
      label: 'Migration',
      total: templates.length,
      success: successCount,
      skipped: skipCount,
      errors: errorCount,
    });
  }

  public async down(): Promise<void> {
    // Down migration not supported - nested conditions are legacy
    // Once flattened, they remain flat
    logger.warn(
      'Downgrade migration not supported for overlay condition flattening',
      { label: 'Migration' }
    );
  }
}
