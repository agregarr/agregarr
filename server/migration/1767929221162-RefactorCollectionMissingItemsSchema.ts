import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Refactor CollectionMissingItems to use collectionRatingKey as primary identifier
 *
 * Changes:
 * - Add collectionRatingKey column (non-null, indexed) - primary identifier for the Plex collection
 * - Keep configId (non-null, indexed) - references parent config (same for multi-collection patterns)
 * - Drop existing data (will be regenerated on next full sync)
 *
 * This enables quick sync to work with "one config multiple collections" patterns
 * where a single config generates multiple Plex collections (e.g., per-user collections,
 * per-franchise collections). All collections share the same configId but have unique
 * collectionRatingKey values.
 */
export class RefactorCollectionMissingItemsSchema1767929221162
  implements MigrationInterface
{
  name = 'RefactorCollectionMissingItemsSchema1767929221162';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Step 1: Create temporary table with new schema
    await queryRunner.query(
      `CREATE TABLE "temporary_collection_missing_items" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "collectionRatingKey" varchar NOT NULL,
        "configId" varchar NOT NULL,
        "libraryId" varchar NOT NULL,
        "tmdbId" integer NOT NULL,
        "tvdbId" integer,
        "mediaType" varchar(10) NOT NULL,
        "title" varchar NOT NULL,
        "year" integer,
        "originalPosition" integer NOT NULL,
        "source" varchar,
        "fullSyncTimestamp" datetime NOT NULL,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
      )`
    );

    // Step 2: Drop old data
    // We intentionally don't migrate existing records because:
    // - Old collectionId was the config ID, not the Plex collection rating key
    // - We can't reliably look up the actual collectionRatingKey during migration
    // - Missing items will be regenerated correctly on next full sync
    // This is safe because missing items are ephemeral data for Quick Sync optimization

    // Step 3: Drop old table
    await queryRunner.query(`DROP INDEX "IDX_f9edfd4988befaae4cced8cfb2"`);
    await queryRunner.query(`DROP INDEX "IDX_082f893274e0755e0b2a8c1891"`);
    await queryRunner.query(`DROP INDEX "IDX_23e094cd6d150084d54145cd05"`);
    await queryRunner.query(`DROP INDEX "IDX_168fd2baea6e73ff0276eac52d"`);
    await queryRunner.query(`DROP TABLE "collection_missing_items"`);

    // Step 4: Rename temporary table
    await queryRunner.query(
      `ALTER TABLE "temporary_collection_missing_items" RENAME TO "collection_missing_items"`
    );

    // Step 5: Create indexes on new schema
    await queryRunner.query(
      `CREATE INDEX "IDX_collection_missing_items_collectionRatingKey" ON "collection_missing_items" ("collectionRatingKey")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_collection_missing_items_configId" ON "collection_missing_items" ("configId")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_collection_missing_items_libraryId" ON "collection_missing_items" ("libraryId")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_collection_missing_items_tmdbId" ON "collection_missing_items" ("tmdbId")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_collection_missing_items_fullSyncTimestamp" ON "collection_missing_items" ("fullSyncTimestamp")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Rollback: Restore original schema
    await queryRunner.query(
      `ALTER TABLE "collection_missing_items" RENAME TO "temporary_collection_missing_items"`
    );

    // Create original table structure
    await queryRunner.query(
      `CREATE TABLE "collection_missing_items" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "collectionId" varchar NOT NULL,
        "libraryId" varchar NOT NULL,
        "tmdbId" integer NOT NULL,
        "tvdbId" integer,
        "mediaType" varchar(10) NOT NULL,
        "title" varchar NOT NULL,
        "year" integer,
        "originalPosition" integer NOT NULL,
        "source" varchar,
        "fullSyncTimestamp" datetime NOT NULL,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
      )`
    );

    // Copy data back (using configId as collectionId)
    await queryRunner.query(
      `INSERT INTO "collection_missing_items"(
        "id", "collectionId", "libraryId", "tmdbId", "tvdbId",
        "mediaType", "title", "year", "originalPosition", "source",
        "fullSyncTimestamp", "createdAt", "updatedAt"
      )
      SELECT
        "id", COALESCE("configId", "collectionRatingKey"), "libraryId", "tmdbId", "tvdbId",
        "mediaType", "title", "year", "originalPosition", "source",
        "fullSyncTimestamp", "createdAt", "updatedAt"
      FROM "temporary_collection_missing_items"`
    );

    // Drop temporary table
    await queryRunner.query(`DROP TABLE "temporary_collection_missing_items"`);

    // Recreate original indexes
    await queryRunner.query(
      `CREATE INDEX "IDX_168fd2baea6e73ff0276eac52d" ON "collection_missing_items" ("collectionId")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_23e094cd6d150084d54145cd05" ON "collection_missing_items" ("libraryId")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_082f893274e0755e0b2a8c1891" ON "collection_missing_items" ("tmdbId")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f9edfd4988befaae4cced8cfb2" ON "collection_missing_items" ("fullSyncTimestamp")`
    );
  }
}
