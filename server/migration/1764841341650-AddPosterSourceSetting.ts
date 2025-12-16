import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPosterSourceSetting1764841341650 implements MigrationInterface {
  name = 'AddPosterSourceSetting1764841341650';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_929fb16a80b020273ef5326999"`);
    await queryRunner.query(`DROP INDEX "IDX_82fd9025007163fd3673a24ecf"`);
    await queryRunner.query(
      `CREATE TABLE "temporary_media_item_metadata" ("plexItemRatingKey" varchar PRIMARY KEY NOT NULL, "libraryKey" varchar NOT NULL, "lastOverlayInputHash" varchar(64), "lastPosterUploadUrl" text, "lastOverlayAppliedAt" datetime, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "basePosterSource" varchar(10), "originalPlexPosterUrl" varchar, "ourOverlayPosterUrl" varchar, "basePosterFilename" varchar)`
    );
    await queryRunner.query(
      `INSERT INTO "temporary_media_item_metadata"("plexItemRatingKey", "libraryKey", "lastOverlayInputHash", "lastPosterUploadUrl", "lastOverlayAppliedAt", "createdAt", "updatedAt") SELECT "plexItemRatingKey", "libraryKey", "lastOverlayInputHash", "lastPosterUploadUrl", "lastOverlayAppliedAt", "createdAt", "updatedAt" FROM "media_item_metadata"`
    );
    await queryRunner.query(`DROP TABLE "media_item_metadata"`);
    await queryRunner.query(
      `ALTER TABLE "temporary_media_item_metadata" RENAME TO "media_item_metadata"`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_929fb16a80b020273ef5326999" ON "media_item_metadata" ("libraryKey") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_82fd9025007163fd3673a24ecf" ON "media_item_metadata" ("plexItemRatingKey") `
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_82fd9025007163fd3673a24ecf"`);
    await queryRunner.query(`DROP INDEX "IDX_929fb16a80b020273ef5326999"`);
    await queryRunner.query(
      `ALTER TABLE "media_item_metadata" RENAME TO "temporary_media_item_metadata"`
    );
    await queryRunner.query(
      `CREATE TABLE "media_item_metadata" ("plexItemRatingKey" varchar PRIMARY KEY NOT NULL, "libraryKey" varchar NOT NULL, "lastOverlayInputHash" varchar(64), "lastPosterUploadUrl" text, "lastOverlayAppliedAt" datetime, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')))`
    );
    await queryRunner.query(
      `INSERT INTO "media_item_metadata"("plexItemRatingKey", "libraryKey", "lastOverlayInputHash", "lastPosterUploadUrl", "lastOverlayAppliedAt", "createdAt", "updatedAt") SELECT "plexItemRatingKey", "libraryKey", "lastOverlayInputHash", "lastPosterUploadUrl", "lastOverlayAppliedAt", "createdAt", "updatedAt" FROM "temporary_media_item_metadata"`
    );
    await queryRunner.query(`DROP TABLE "temporary_media_item_metadata"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_82fd9025007163fd3673a24ecf" ON "media_item_metadata" ("plexItemRatingKey") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_929fb16a80b020273ef5326999" ON "media_item_metadata" ("libraryKey") `
    );
  }
}
