import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCollectionMissingItems1765651200422
  implements MigrationInterface
{
  name = 'AddCollectionMissingItems1765651200422';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "collection_missing_items" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "collectionId" varchar NOT NULL, "libraryId" varchar NOT NULL, "tmdbId" integer NOT NULL, "tvdbId" integer, "mediaType" varchar(10) NOT NULL, "title" varchar NOT NULL, "year" integer, "originalPosition" integer NOT NULL, "source" varchar, "fullSyncTimestamp" datetime NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_168fd2baea6e73ff0276eac52d" ON "collection_missing_items" ("collectionId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_23e094cd6d150084d54145cd05" ON "collection_missing_items" ("libraryId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_082f893274e0755e0b2a8c1891" ON "collection_missing_items" ("tmdbId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f9edfd4988befaae4cced8cfb2" ON "collection_missing_items" ("fullSyncTimestamp") `
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_f9edfd4988befaae4cced8cfb2"`);
    await queryRunner.query(`DROP INDEX "IDX_082f893274e0755e0b2a8c1891"`);
    await queryRunner.query(`DROP INDEX "IDX_23e094cd6d150084d54145cd05"`);
    await queryRunner.query(`DROP INDEX "IDX_168fd2baea6e73ff0276eac52d"`);
    await queryRunner.query(`DROP TABLE "collection_missing_items"`);
  }
}
