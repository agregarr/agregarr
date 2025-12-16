import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDisplayOrderToOverlayTemplate1764686327000
  implements MigrationInterface
{
  name = 'AddDisplayOrderToOverlayTemplate1764686327000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Check if displayOrder column already exists (idempotent)
    const columns = await queryRunner.query(
      `PRAGMA table_info(overlay_template)`
    );
    const hasDisplayOrder = columns.some(
      (col: { name: string }) => col.name === 'displayOrder'
    );

    if (!hasDisplayOrder) {
      // Add displayOrder column to overlay_template table
      await queryRunner.query(
        `ALTER TABLE "overlay_template" ADD COLUMN "displayOrder" integer NOT NULL DEFAULT (0)`
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove displayOrder column from overlay_template table
    await queryRunner.query(
      `ALTER TABLE "overlay_template" DROP COLUMN "displayOrder"`
    );
  }
}
