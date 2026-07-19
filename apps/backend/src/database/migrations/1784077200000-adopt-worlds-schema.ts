import type { MigrationInterface, QueryRunner } from 'typeorm';

const marker = 'world-building migration 1784077200000';

export class AdoptWorldsSchema1784077200000 implements MigrationInterface {
  name = 'AdoptWorldsSchema1784077200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF to_regclass('public.worlds') IS NULL THEN
          CREATE TABLE "worlds" (
            "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            "prompt" varchar NOT NULL,
            "generatedContent" text NOT NULL,
            "metadata" jsonb,
            "createdAt" timestamptz NOT NULL DEFAULT now()
          );
          COMMENT ON TABLE "worlds" IS '${marker}';
        END IF;
      END $$;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF obj_description('public.worlds'::regclass, 'pg_class') = '${marker}' THEN
          DROP TABLE "worlds";
        END IF;
      END $$;
    `);
  }
}
