import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPosterLocalPathToCollectionMetadata1765744104779
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add posterLocalPath column to collection_metadata table
    await queryRunner.query(
      `ALTER TABLE "collection_metadata" ADD COLUMN "posterLocalPath" varchar`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove posterLocalPath column
    await queryRunner.query(
      `ALTER TABLE "collection_metadata" DROP COLUMN "posterLocalPath"`
    );
  }
}
