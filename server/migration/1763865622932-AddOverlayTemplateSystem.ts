import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOverlayTemplateSystem1763865622932
  implements MigrationInterface
{
  name = 'AddOverlayTemplateSystem1763865622932';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create overlay_template table
    await queryRunner.query(
      `CREATE TABLE "overlay_template" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" varchar NOT NULL, "description" varchar, "type" varchar NOT NULL DEFAULT ('custom'), "templateData" text NOT NULL, "isDefault" boolean NOT NULL DEFAULT (0), "isActive" boolean NOT NULL DEFAULT (1), "applicationCondition" text, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')))`
    );

    // Create overlay_library_config table
    await queryRunner.query(
      `CREATE TABLE "overlay_library_config" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "libraryId" varchar NOT NULL, "libraryName" varchar NOT NULL, "mediaType" varchar NOT NULL, "enabledOverlays" text NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), CONSTRAINT "UQ_overlay_library_config_libraryId" UNIQUE ("libraryId"))`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "overlay_library_config"`);
    await queryRunner.query(`DROP TABLE "overlay_template"`);
  }
}
