import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialAgregarrMigration1755023456242
  implements MigrationInterface
{
  name = 'InitialAgregarrMigration1755023456242';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "session" ("expiredAt" bigint NOT NULL, "id" varchar(255) PRIMARY KEY NOT NULL, "json" text NOT NULL)`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_28c5d1d16da7908c97c9bc2f74" ON "session" ("expiredAt") `
    );
    await queryRunner.query(
      `CREATE TABLE "user_settings" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "locale" varchar NOT NULL DEFAULT (''), "region" varchar, "originalLanguage" varchar, "watchlistSyncMovies" boolean, "watchlistSyncTv" boolean, "userId" integer, CONSTRAINT "REL_986a2b6d3c05eb4091bb8066f7" UNIQUE ("userId"))`
    );
    await queryRunner.query(
      `CREATE TABLE "user" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "email" varchar NOT NULL, "plexUsername" varchar, "plexTitle" varchar, "hasPlexPass" boolean NOT NULL DEFAULT (0), "username" varchar, "password" varchar, "resetPasswordGuid" varchar, "recoveryLinkExpirationDate" date, "userType" integer NOT NULL DEFAULT (1), "plexId" integer, "externalOverseerrId" integer, "plexToken" varchar, "permissions" integer NOT NULL DEFAULT (0), "avatar" varchar NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), CONSTRAINT "UQ_e12875dfb3b1d92d7d7c5377e22" UNIQUE ("email"))`
    );
    await queryRunner.query(
      `CREATE TABLE "media" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "mediaType" varchar NOT NULL, "tmdbId" integer NOT NULL, "tvdbId" integer, "imdbId" varchar, "status" integer NOT NULL DEFAULT (1), "status4k" integer NOT NULL DEFAULT (1), "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "lastSeasonChange" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "mediaAddedAt" datetime, "serviceId" integer, "serviceId4k" integer, "externalServiceId" integer, "externalServiceId4k" integer, "externalServiceSlug" varchar, "externalServiceSlug4k" varchar, "ratingKey" varchar, "ratingKey4k" varchar, CONSTRAINT "UQ_41a289eb1fa489c1bc6f38d9c3c" UNIQUE ("tvdbId"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7157aad07c73f6a6ae3bbd5ef5" ON "media" ("tmdbId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_41a289eb1fa489c1bc6f38d9c3" ON "media" ("tvdbId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7ff2d11f6a83cb52386eaebe74" ON "media" ("imdbId") `
    );
    await queryRunner.query(
      `CREATE TABLE "season" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "seasonNumber" integer NOT NULL, "status" integer NOT NULL DEFAULT (1), "status4k" integer NOT NULL DEFAULT (1), "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "mediaId" integer)`
    );
    await queryRunner.query(
      `CREATE TABLE "missing_item_request" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "tmdbId" integer NOT NULL, "mediaType" varchar(10) NOT NULL, "title" varchar(255) NOT NULL, "posterPath" varchar(500), "year" integer, "collectionName" varchar(255) NOT NULL, "collectionSource" varchar(50) NOT NULL, "collectionSubtype" varchar(100), "requestService" varchar(50) NOT NULL, "requestMethod" varchar(50) NOT NULL, "requestStatus" varchar(20) NOT NULL, "overseerrRequestId" integer, "requestedById" integer, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "requestedAt" datetime, "notes" text)`
    );
    await queryRunner.query(
      `CREATE TABLE "temporary_user_settings" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "locale" varchar NOT NULL DEFAULT (''), "region" varchar, "originalLanguage" varchar, "watchlistSyncMovies" boolean, "watchlistSyncTv" boolean, "userId" integer, CONSTRAINT "REL_986a2b6d3c05eb4091bb8066f7" UNIQUE ("userId"), CONSTRAINT "FK_986a2b6d3c05eb4091bb8066f78" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `INSERT INTO "temporary_user_settings"("id", "locale", "region", "originalLanguage", "watchlistSyncMovies", "watchlistSyncTv", "userId") SELECT "id", "locale", "region", "originalLanguage", "watchlistSyncMovies", "watchlistSyncTv", "userId" FROM "user_settings"`
    );
    await queryRunner.query(`DROP TABLE "user_settings"`);
    await queryRunner.query(
      `ALTER TABLE "temporary_user_settings" RENAME TO "user_settings"`
    );
    await queryRunner.query(
      `CREATE TABLE "temporary_season" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "seasonNumber" integer NOT NULL, "status" integer NOT NULL DEFAULT (1), "status4k" integer NOT NULL DEFAULT (1), "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "mediaId" integer, CONSTRAINT "FK_087099b39600be695591da9a49c" FOREIGN KEY ("mediaId") REFERENCES "media" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `INSERT INTO "temporary_season"("id", "seasonNumber", "status", "status4k", "createdAt", "updatedAt", "mediaId") SELECT "id", "seasonNumber", "status", "status4k", "createdAt", "updatedAt", "mediaId" FROM "season"`
    );
    await queryRunner.query(`DROP TABLE "season"`);
    await queryRunner.query(
      `ALTER TABLE "temporary_season" RENAME TO "season"`
    );
    await queryRunner.query(
      `CREATE TABLE "temporary_missing_item_request" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "tmdbId" integer NOT NULL, "mediaType" varchar(10) NOT NULL, "title" varchar(255) NOT NULL, "posterPath" varchar(500), "year" integer, "collectionName" varchar(255) NOT NULL, "collectionSource" varchar(50) NOT NULL, "collectionSubtype" varchar(100), "requestService" varchar(50) NOT NULL, "requestMethod" varchar(50) NOT NULL, "requestStatus" varchar(20) NOT NULL, "overseerrRequestId" integer, "requestedById" integer, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "requestedAt" datetime, "notes" text, CONSTRAINT "FK_missing_item_request_user" FOREIGN KEY ("requestedById") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `INSERT INTO "temporary_missing_item_request"("id", "tmdbId", "mediaType", "title", "posterPath", "year", "collectionName", "collectionSource", "collectionSubtype", "requestService", "requestMethod", "requestStatus", "overseerrRequestId", "requestedById", "createdAt", "updatedAt", "requestedAt", "notes") SELECT "id", "tmdbId", "mediaType", "title", "posterPath", "year", "collectionName", "collectionSource", "collectionSubtype", "requestService", "requestMethod", "requestStatus", "overseerrRequestId", "requestedById", "createdAt", "updatedAt", "requestedAt", "notes" FROM "missing_item_request"`
    );
    await queryRunner.query(`DROP TABLE "missing_item_request"`);
    await queryRunner.query(
      `ALTER TABLE "temporary_missing_item_request" RENAME TO "missing_item_request"`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "missing_item_request" RENAME TO "temporary_missing_item_request"`
    );
    await queryRunner.query(
      `CREATE TABLE "missing_item_request" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "tmdbId" integer NOT NULL, "mediaType" varchar(10) NOT NULL, "title" varchar(255) NOT NULL, "posterPath" varchar(500), "year" integer, "collectionName" varchar(255) NOT NULL, "collectionSource" varchar(50) NOT NULL, "collectionSubtype" varchar(100), "requestService" varchar(50) NOT NULL, "requestMethod" varchar(50) NOT NULL, "requestStatus" varchar(20) NOT NULL, "overseerrRequestId" integer, "requestedById" integer, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "requestedAt" datetime, "notes" text)`
    );
    await queryRunner.query(
      `INSERT INTO "missing_item_request"("id", "tmdbId", "mediaType", "title", "posterPath", "year", "collectionName", "collectionSource", "collectionSubtype", "requestService", "requestMethod", "requestStatus", "overseerrRequestId", "requestedById", "createdAt", "updatedAt", "requestedAt", "notes") SELECT "id", "tmdbId", "mediaType", "title", "posterPath", "year", "collectionName", "collectionSource", "collectionSubtype", "requestService", "requestMethod", "requestStatus", "overseerrRequestId", "requestedById", "createdAt", "updatedAt", "requestedAt", "notes" FROM "temporary_missing_item_request"`
    );
    await queryRunner.query(`DROP TABLE "temporary_missing_item_request"`);
    await queryRunner.query(
      `ALTER TABLE "season" RENAME TO "temporary_season"`
    );
    await queryRunner.query(
      `CREATE TABLE "season" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "seasonNumber" integer NOT NULL, "status" integer NOT NULL DEFAULT (1), "status4k" integer NOT NULL DEFAULT (1), "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "mediaId" integer)`
    );
    await queryRunner.query(
      `INSERT INTO "season"("id", "seasonNumber", "status", "status4k", "createdAt", "updatedAt", "mediaId") SELECT "id", "seasonNumber", "status", "status4k", "createdAt", "updatedAt", "mediaId" FROM "temporary_season"`
    );
    await queryRunner.query(`DROP TABLE "temporary_season"`);
    await queryRunner.query(
      `ALTER TABLE "user_settings" RENAME TO "temporary_user_settings"`
    );
    await queryRunner.query(
      `CREATE TABLE "user_settings" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "locale" varchar NOT NULL DEFAULT (''), "region" varchar, "originalLanguage" varchar, "watchlistSyncMovies" boolean, "watchlistSyncTv" boolean, "userId" integer, CONSTRAINT "REL_986a2b6d3c05eb4091bb8066f7" UNIQUE ("userId"))`
    );
    await queryRunner.query(
      `INSERT INTO "user_settings"("id", "locale", "region", "originalLanguage", "watchlistSyncMovies", "watchlistSyncTv", "userId") SELECT "id", "locale", "region", "originalLanguage", "watchlistSyncMovies", "watchlistSyncTv", "userId" FROM "temporary_user_settings"`
    );
    await queryRunner.query(`DROP TABLE "temporary_user_settings"`);
    await queryRunner.query(`DROP TABLE "season"`);
    await queryRunner.query(`DROP INDEX "IDX_7ff2d11f6a83cb52386eaebe74"`);
    await queryRunner.query(`DROP INDEX "IDX_41a289eb1fa489c1bc6f38d9c3"`);
    await queryRunner.query(`DROP INDEX "IDX_7157aad07c73f6a6ae3bbd5ef5"`);
    await queryRunner.query(`DROP TABLE "media"`);
    await queryRunner.query(`DROP TABLE "user"`);
    await queryRunner.query(`DROP TABLE "user_settings"`);
    await queryRunner.query(`DROP INDEX "IDX_28c5d1d16da7908c97c9bc2f74"`);
    await queryRunner.query(`DROP TABLE "session"`);
    await queryRunner.query(`DROP TABLE "missing_item_request"`);
  }
}
