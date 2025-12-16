import type { MigrationInterface, QueryRunner } from 'typeorm';

export class RefactorPlaceholderItemSchema1765110269827
  implements MigrationInterface
{
  name = 'RefactorPlaceholderItemSchema1765110269827';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "temporary_coming_soon_item" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "configId" varchar NOT NULL, "mediaType" varchar NOT NULL, "tmdbId" integer NOT NULL, "tvdbId" integer, "title" varchar NOT NULL, "year" integer, "source" varchar NOT NULL, "placeholderPath" varchar NOT NULL, "plexRatingKey" varchar, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')))`
    );
    await queryRunner.query(
      `INSERT INTO "temporary_coming_soon_item"("id", "configId", "mediaType", "tmdbId", "tvdbId", "title", "year", "source", "placeholderPath", "plexRatingKey", "createdAt", "updatedAt") SELECT "id", "configId", "mediaType", "tmdbId", "tvdbId", "title", "year", "source", "placeholderPath", "plexRatingKey", "createdAt", "updatedAt" FROM "coming_soon_item"`
    );
    await queryRunner.query(`DROP TABLE "coming_soon_item"`);
    await queryRunner.query(
      `ALTER TABLE "temporary_coming_soon_item" RENAME TO "coming_soon_item"`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "coming_soon_item" RENAME TO "temporary_coming_soon_item"`
    );
    await queryRunner.query(
      `CREATE TABLE "coming_soon_item" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "configId" varchar NOT NULL, "mediaType" varchar NOT NULL, "tmdbId" integer NOT NULL, "tvdbId" integer, "title" varchar NOT NULL, "year" integer, "releaseDate" varchar, "isEstimatedDate" boolean NOT NULL DEFAULT (0), "seasonNumber" integer, "source" varchar NOT NULL, "placeholderPath" varchar NOT NULL, "plexRatingKey" varchar, "releasedAt" datetime, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "isPlaceholder" boolean NOT NULL DEFAULT (1))`
    );
    await queryRunner.query(
      `INSERT INTO "coming_soon_item"("id", "configId", "mediaType", "tmdbId", "tvdbId", "title", "year", "source", "placeholderPath", "plexRatingKey", "createdAt", "updatedAt") SELECT "id", "configId", "mediaType", "tmdbId", "tvdbId", "title", "year", "source", "placeholderPath", "plexRatingKey", "createdAt", "updatedAt" FROM "temporary_coming_soon_item"`
    );
    await queryRunner.query(`DROP TABLE "temporary_coming_soon_item"`);
  }
}
