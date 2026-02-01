import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTagsToOverlayTemplate1769953500585
  implements MigrationInterface
{
  name = 'AddTagsToOverlayTemplate1769953500585';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "temporary_overlay_template" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" varchar NOT NULL, "description" varchar, "type" varchar NOT NULL DEFAULT ('generic'), "templateData" text NOT NULL, "isDefault" boolean NOT NULL DEFAULT (0), "isActive" boolean NOT NULL DEFAULT (1), "applicationCondition" text, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "displayOrder" integer NOT NULL DEFAULT (0), "tags" text)`
    );
    await queryRunner.query(
      `INSERT INTO "temporary_overlay_template"("id", "name", "description", "type", "templateData", "isDefault", "isActive", "applicationCondition", "createdAt", "updatedAt", "displayOrder") SELECT "id", "name", "description", "type", "templateData", "isDefault", "isActive", "applicationCondition", "createdAt", "updatedAt", "displayOrder" FROM "overlay_template"`
    );
    await queryRunner.query(`DROP TABLE "overlay_template"`);
    await queryRunner.query(
      `ALTER TABLE "temporary_overlay_template" RENAME TO "overlay_template"`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "overlay_template" RENAME TO "temporary_overlay_template"`
    );
    await queryRunner.query(
      `CREATE TABLE "overlay_template" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" varchar NOT NULL, "description" varchar, "type" varchar NOT NULL DEFAULT ('generic'), "templateData" text NOT NULL, "isDefault" boolean NOT NULL DEFAULT (0), "isActive" boolean NOT NULL DEFAULT (1), "applicationCondition" text, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "displayOrder" integer NOT NULL DEFAULT (0))`
    );
    await queryRunner.query(
      `INSERT INTO "overlay_template"("id", "name", "description", "type", "templateData", "isDefault", "isActive", "applicationCondition", "createdAt", "updatedAt", "displayOrder") SELECT "id", "name", "description", "type", "templateData", "isDefault", "isActive", "applicationCondition", "createdAt", "updatedAt", "displayOrder" FROM "temporary_overlay_template"`
    );
    await queryRunner.query(`DROP TABLE "temporary_overlay_template"`);
  }
}
