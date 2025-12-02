import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDisplayOrderToOverlayTemplate1733102597468
  implements MigrationInterface
{
  name = 'AddDisplayOrderToOverlayTemplate1733102597468';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add displayOrder column to overlay_template table
    await queryRunner.query(
      `ALTER TABLE "overlay_template" ADD COLUMN "displayOrder" integer NOT NULL DEFAULT (0)`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove displayOrder column from overlay_template table
    await queryRunner.query(
      `ALTER TABLE "overlay_template" DROP COLUMN "displayOrder"`
    );
  }
}
