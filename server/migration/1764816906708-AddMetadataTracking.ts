import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMetadataTracking1764816906708 implements MigrationInterface {
  name = 'AddMetadataTracking1764816906708';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "collection_metadata" ("plexCollectionRatingKey" varchar PRIMARY KEY NOT NULL, "collectionConfigId" varchar, "libraryKey" varchar, "lastPosterInputHash" varchar(64), "lastPosterUploadUrl" text, "lastPosterAppliedAt" datetime, "lastWallpaperFilename" varchar, "lastWallpaperUploadUrl" text, "lastWallpaperAppliedAt" datetime, "lastThemeFilename" varchar, "lastThemeUploadUrl" text, "lastThemeAppliedAt" datetime, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_63bf4f99775f4350d1d954aeff" ON "collection_metadata" ("plexCollectionRatingKey") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3c1385bd45e9195bc795f50420" ON "collection_metadata" ("collectionConfigId") `
    );
    await queryRunner.query(
      `CREATE TABLE "media_item_metadata" ("plexItemRatingKey" varchar PRIMARY KEY NOT NULL, "libraryKey" varchar NOT NULL, "lastOverlayInputHash" varchar(64), "lastPosterUploadUrl" text, "lastOverlayAppliedAt" datetime, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_82fd9025007163fd3673a24ecf" ON "media_item_metadata" ("plexItemRatingKey") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_929fb16a80b020273ef5326999" ON "media_item_metadata" ("libraryKey") `
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_929fb16a80b020273ef5326999"`);
    await queryRunner.query(`DROP INDEX "IDX_82fd9025007163fd3673a24ecf"`);
    await queryRunner.query(`DROP TABLE "media_item_metadata"`);
    await queryRunner.query(`DROP INDEX "IDX_3c1385bd45e9195bc795f50420"`);
    await queryRunner.query(`DROP INDEX "IDX_63bf4f99775f4350d1d954aeff"`);
    await queryRunner.query(`DROP TABLE "collection_metadata"`);
  }
}
