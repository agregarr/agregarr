import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddComingSoonFeature1761992992560 implements MigrationInterface {
  name = 'AddComingSoonFeature1761992992560';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "coming_soon_item" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "configId" varchar NOT NULL, "mediaType" varchar NOT NULL, "tmdbId" integer NOT NULL, "tvdbId" integer, "title" varchar NOT NULL, "year" integer, "releaseDate" varchar, "isEstimatedDate" boolean NOT NULL DEFAULT (0), "seasonNumber" integer, "source" varchar NOT NULL, "placeholderPath" varchar NOT NULL, "plexRatingKey" varchar, "releasedAt" datetime, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_coming_soon_item_tmdbId" ON "coming_soon_item" ("tmdbId")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_coming_soon_item_configId" ON "coming_soon_item" ("configId")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_coming_soon_item_configId"`);
    await queryRunner.query(`DROP INDEX "IDX_coming_soon_item_tmdbId"`);
    await queryRunner.query(`DROP TABLE "coming_soon_item"`);
  }
}
