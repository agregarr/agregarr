import logger from '@server/logger';
import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CRITICAL REPAIR MIGRATION
 *
 * This migration fixes databases affected by incorrectly timestamped migrations.
 *
 * BACKGROUND:
 * Two migrations were created with timestamps from December 2, 2024:
 *   - 1733102597468-AddDisplayOrderToOverlayTemplate
 *   - 1733110913063-FlattenOverlayConditions
 *
 * THIS MIGRATION:
 * - Detects if user has the broken state
 * - Removes the incorrectly run migration entries
 * - Creates overlay_template table if missing
 * - Re-runs the corrected migrations with proper timestamps
 */
export class RepairBrokenMigrationState1764789285262
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    logger.info('Starting repair of broken migration state', {
      label: 'Migration',
    });

    // Check if migrations table exists
    const migrationsTableExists = await this.tableExists(
      queryRunner,
      'migrations'
    );

    if (!migrationsTableExists) {
      logger.info('Fresh database - no repair needed', { label: 'Migration' });
      return;
    }

    // Check for old incorrectly timestamped migration entries
    const oldMigrations = await queryRunner.query(
      `SELECT name FROM migrations WHERE name IN (?, ?)`,
      [
        'AddDisplayOrderToOverlayTemplate1733102597468',
        'FlattenOverlayConditions1733110913063',
      ]
    );

    if (oldMigrations.length === 0) {
      logger.info('No broken migration state detected - database is healthy', {
        label: 'Migration',
      });
      return;
    }

    logger.warn('Detected broken migration state - beginning repair', {
      label: 'Migration',
      brokenMigrations: oldMigrations.map((m: { name: string }) => m.name),
    });

    // Remove the old incorrectly run migration entries
    for (const migration of oldMigrations) {
      await queryRunner.query(`DELETE FROM migrations WHERE name = ?`, [
        migration.name,
      ]);
      logger.info(`Removed broken migration entry: ${migration.name}`, {
        label: 'Migration',
      });
    }

    // Check if overlay_template table exists
    const overlayTemplateExists = await this.tableExists(
      queryRunner,
      'overlay_template'
    );

    if (!overlayTemplateExists) {
      logger.info('overlay_template table missing - creating it now', {
        label: 'Migration',
      });

      // Create overlay_template table (from AddOverlayTemplateSystem migration)
      await queryRunner.query(
        `CREATE TABLE "overlay_template" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" varchar NOT NULL, "description" varchar, "type" varchar NOT NULL DEFAULT ('custom'), "templateData" text NOT NULL, "isDefault" boolean NOT NULL DEFAULT (0), "isActive" boolean NOT NULL DEFAULT (1), "applicationCondition" text, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')))`
      );

      // Create overlay_library_config table (from AddOverlayTemplateSystem migration)
      await queryRunner.query(
        `CREATE TABLE "overlay_library_config" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "libraryId" varchar NOT NULL, "libraryName" varchar NOT NULL, "mediaType" varchar NOT NULL, "enabledOverlays" text NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), CONSTRAINT "UQ_overlay_library_config_libraryId" UNIQUE ("libraryId"))`
      );

      logger.info('Created overlay tables', { label: 'Migration' });
    }

    // Check if displayOrder column exists in overlay_template
    const columns = await queryRunner.query(
      `PRAGMA table_info(overlay_template)`
    );
    const hasDisplayOrder = columns.some(
      (col: { name: string }) => col.name === 'displayOrder'
    );

    if (!hasDisplayOrder) {
      logger.info('Adding missing displayOrder column', {
        label: 'Migration',
      });
      await queryRunner.query(
        `ALTER TABLE "overlay_template" ADD COLUMN "displayOrder" integer NOT NULL DEFAULT (0)`
      );
    }

    // Check if any overlay templates need condition flattening
    const templatesWithConditions = await queryRunner.query(
      `SELECT id, name, applicationCondition FROM overlay_template WHERE applicationCondition IS NOT NULL`
    );

    if (templatesWithConditions.length > 0) {
      logger.info(
        `Checking ${templatesWithConditions.length} templates for condition flattening`,
        { label: 'Migration' }
      );

      for (const template of templatesWithConditions) {
        try {
          const condition = JSON.parse(template.applicationCondition);

          // Check if already flat (has 'sections' property)
          if (!condition.sections || !Array.isArray(condition.sections)) {
            logger.info(
              `Template "${template.name}" has legacy nested conditions - needs manual review`,
              { label: 'Migration' }
            );
            // Note: We don't auto-flatten here as the FlattenOverlayConditions migration
            // will run properly after this repair
          }
        } catch (error) {
          logger.warn(
            `Could not parse condition for template "${template.name}"`,
            {
              label: 'Migration',
              error: error instanceof Error ? error.message : String(error),
            }
          );
        }
      }
    }

    logger.info('Migration repair completed successfully', {
      label: 'Migration',
    });
  }

  public async down(): Promise<void> {
    // This repair migration is not reversible
    logger.warn('Repair migration cannot be reversed', { label: 'Migration' });
  }

  private async tableExists(
    queryRunner: QueryRunner,
    tableName: string
  ): Promise<boolean> {
    const result = await queryRunner.query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
      [tableName]
    );
    return result.length > 0;
  }
}
