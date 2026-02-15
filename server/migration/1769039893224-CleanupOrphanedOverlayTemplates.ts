import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CleanupOrphanedOverlayTemplates1769039893224
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Delete all non-default templates that were soft-deleted (isActive = 0)
    // These are orphaned user-created templates that should have been hard deleted
    await queryRunner.query(`
      DELETE FROM overlay_template
      WHERE isDefault = 0 AND isActive = 0
    `);
  }

  public async down(): Promise<void> {
    // Cannot restore deleted templates - this is a one-way cleanup
  }
}
