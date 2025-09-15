import type { MigrationInterface, QueryRunner } from 'typeorm';

export class PosterEntitiesAddition1757064597022 implements MigrationInterface {
  name = 'PosterEntitiesAddition1757064597022';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "temporary_missing_item_request" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "tmdbId" integer NOT NULL, "mediaType" varchar(10) NOT NULL, "title" varchar(255) NOT NULL, "posterPath" varchar(500), "year" integer, "collectionName" varchar(255) NOT NULL, "collectionSource" varchar(50) NOT NULL, "collectionSubtype" varchar(100), "requestService" varchar(50) NOT NULL, "requestMethod" varchar(50) NOT NULL, "requestStatus" varchar(20) NOT NULL, "overseerrRequestId" integer, "requestedById" integer, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "requestedAt" datetime, "notes" text)`
    );
    await queryRunner.query(
      `INSERT INTO "temporary_missing_item_request"("id", "tmdbId", "mediaType", "title", "posterPath", "year", "collectionName", "collectionSource", "collectionSubtype", "requestService", "requestMethod", "requestStatus", "overseerrRequestId", "requestedById", "createdAt", "updatedAt", "requestedAt", "notes") SELECT "id", "tmdbId", "mediaType", "title", "posterPath", "year", "collectionName", "collectionSource", "collectionSubtype", "requestService", "requestMethod", "requestStatus", "overseerrRequestId", "requestedById", "createdAt", "updatedAt", "requestedAt", "notes" FROM "missing_item_request"`
    );
    await queryRunner.query(`DROP TABLE "missing_item_request"`);
    await queryRunner.query(
      `ALTER TABLE "temporary_missing_item_request" RENAME TO "missing_item_request"`
    );
    await queryRunner.query(
      `CREATE TABLE "poster_template" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" varchar NOT NULL, "description" varchar, "templateData" text NOT NULL, "isDefault" boolean NOT NULL DEFAULT (0), "isActive" boolean NOT NULL DEFAULT (1), "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')))`
    );
    await queryRunner.query(
      `CREATE TABLE "saved_poster" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" varchar NOT NULL, "description" varchar, "posterData" text NOT NULL, "filename" varchar, "thumbnailFilename" varchar, "isActive" boolean NOT NULL DEFAULT (1), "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')))`
    );
    await queryRunner.query(
      `CREATE TABLE "temporary_user_settings" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "locale" varchar NOT NULL DEFAULT (''), "watchlistSyncMovies" boolean, "watchlistSyncTv" boolean, "userId" integer, CONSTRAINT "REL_986a2b6d3c05eb4091bb8066f7" UNIQUE ("userId"), CONSTRAINT "FK_986a2b6d3c05eb4091bb8066f78" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `INSERT INTO "temporary_user_settings"("id", "locale", "watchlistSyncMovies", "watchlistSyncTv", "userId") SELECT "id", "locale", "watchlistSyncMovies", "watchlistSyncTv", "userId" FROM "user_settings"`
    );
    await queryRunner.query(`DROP TABLE "user_settings"`);
    await queryRunner.query(
      `ALTER TABLE "temporary_user_settings" RENAME TO "user_settings"`
    );
    await queryRunner.query(
      `CREATE TABLE "temporary_poster_template" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" varchar NOT NULL, "description" varchar, "templateData" text NOT NULL, "isDefault" boolean NOT NULL DEFAULT (0), "isActive" boolean NOT NULL DEFAULT (1), "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')))`
    );
    await queryRunner.query(
      `INSERT INTO "temporary_poster_template"("id", "name", "description", "templateData", "isDefault", "isActive", "createdAt", "updatedAt") SELECT "id", "name", "description", "templateData", "isDefault", "isActive", "createdAt", "updatedAt" FROM "poster_template"`
    );
    await queryRunner.query(`DROP TABLE "poster_template"`);
    await queryRunner.query(
      `ALTER TABLE "temporary_poster_template" RENAME TO "poster_template"`
    );
    await queryRunner.query(
      `CREATE TABLE "temporary_saved_poster" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" varchar NOT NULL, "description" varchar, "posterData" text NOT NULL, "filename" varchar, "thumbnailFilename" varchar, "isActive" boolean NOT NULL DEFAULT (1), "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')))`
    );
    await queryRunner.query(
      `INSERT INTO "temporary_saved_poster"("id", "name", "description", "posterData", "filename", "thumbnailFilename", "isActive", "createdAt", "updatedAt") SELECT "id", "name", "description", "posterData", "filename", "thumbnailFilename", "isActive", "createdAt", "updatedAt" FROM "saved_poster"`
    );
    await queryRunner.query(`DROP TABLE "saved_poster"`);
    await queryRunner.query(
      `ALTER TABLE "temporary_saved_poster" RENAME TO "saved_poster"`
    );
    await queryRunner.query(
      `CREATE TABLE "temporary_missing_item_request" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "tmdbId" integer NOT NULL, "mediaType" varchar(10) NOT NULL, "title" varchar(255) NOT NULL, "posterPath" varchar(500), "year" integer, "collectionName" varchar(255) NOT NULL, "collectionSource" varchar(50) NOT NULL, "collectionSubtype" varchar(100), "requestService" varchar(50) NOT NULL, "requestMethod" varchar(50) NOT NULL, "requestStatus" varchar(20) NOT NULL, "overseerrRequestId" integer, "requestedById" integer, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "requestedAt" datetime, "notes" text, CONSTRAINT "FK_94accf3d86866171a389bb6e53a" FOREIGN KEY ("requestedById") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE NO ACTION)`
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
      `ALTER TABLE "saved_poster" RENAME TO "temporary_saved_poster"`
    );
    await queryRunner.query(
      `CREATE TABLE "saved_poster" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" varchar NOT NULL, "description" varchar, "posterData" text NOT NULL, "filename" varchar, "thumbnailFilename" varchar, "isActive" boolean NOT NULL DEFAULT (1), "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')))`
    );
    await queryRunner.query(
      `INSERT INTO "saved_poster"("id", "name", "description", "posterData", "filename", "thumbnailFilename", "isActive", "createdAt", "updatedAt") SELECT "id", "name", "description", "posterData", "filename", "thumbnailFilename", "isActive", "createdAt", "updatedAt" FROM "temporary_saved_poster"`
    );
    await queryRunner.query(`DROP TABLE "temporary_saved_poster"`);
    await queryRunner.query(
      `ALTER TABLE "poster_template" RENAME TO "temporary_poster_template"`
    );
    await queryRunner.query(
      `CREATE TABLE "poster_template" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" varchar NOT NULL, "description" varchar, "templateData" text NOT NULL, "isDefault" boolean NOT NULL DEFAULT (0), "isActive" boolean NOT NULL DEFAULT (1), "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')))`
    );
    await queryRunner.query(
      `INSERT INTO "poster_template"("id", "name", "description", "templateData", "isDefault", "isActive", "createdAt", "updatedAt") SELECT "id", "name", "description", "templateData", "isDefault", "isActive", "createdAt", "updatedAt" FROM "temporary_poster_template"`
    );
    await queryRunner.query(`DROP TABLE "temporary_poster_template"`);
    await queryRunner.query(
      `ALTER TABLE "user_settings" RENAME TO "temporary_user_settings"`
    );
    await queryRunner.query(
      `CREATE TABLE "user_settings" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "locale" varchar NOT NULL DEFAULT (''), "region" varchar, "originalLanguage" varchar, "watchlistSyncMovies" boolean, "watchlistSyncTv" boolean, "userId" integer, CONSTRAINT "REL_986a2b6d3c05eb4091bb8066f7" UNIQUE ("userId"), CONSTRAINT "FK_986a2b6d3c05eb4091bb8066f78" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `INSERT INTO "user_settings"("id", "locale", "watchlistSyncMovies", "watchlistSyncTv", "userId") SELECT "id", "locale", "watchlistSyncMovies", "watchlistSyncTv", "userId" FROM "temporary_user_settings"`
    );
    await queryRunner.query(`DROP TABLE "temporary_user_settings"`);
    await queryRunner.query(`DROP TABLE "saved_poster"`);
    await queryRunner.query(`DROP TABLE "poster_template"`);
    await queryRunner.query(
      `ALTER TABLE "missing_item_request" RENAME TO "temporary_missing_item_request"`
    );
    await queryRunner.query(
      `CREATE TABLE "missing_item_request" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "tmdbId" integer NOT NULL, "mediaType" varchar(10) NOT NULL, "title" varchar(255) NOT NULL, "posterPath" varchar(500), "year" integer, "collectionName" varchar(255) NOT NULL, "collectionSource" varchar(50) NOT NULL, "collectionSubtype" varchar(100), "requestService" varchar(50) NOT NULL, "requestMethod" varchar(50) NOT NULL, "requestStatus" varchar(20) NOT NULL, "overseerrRequestId" integer, "requestedById" integer, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "requestedAt" datetime, "notes" text, CONSTRAINT "FK_missing_item_request_user" FOREIGN KEY ("requestedById") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `INSERT INTO "missing_item_request"("id", "tmdbId", "mediaType", "title", "posterPath", "year", "collectionName", "collectionSource", "collectionSubtype", "requestService", "requestMethod", "requestStatus", "overseerrRequestId", "requestedById", "createdAt", "updatedAt", "requestedAt", "notes") SELECT "id", "tmdbId", "mediaType", "title", "posterPath", "year", "collectionName", "collectionSource", "collectionSubtype", "requestService", "requestMethod", "requestStatus", "overseerrRequestId", "requestedById", "createdAt", "updatedAt", "requestedAt", "notes" FROM "temporary_missing_item_request"`
    );
    await queryRunner.query(`DROP TABLE "temporary_missing_item_request"`);
  }
}
