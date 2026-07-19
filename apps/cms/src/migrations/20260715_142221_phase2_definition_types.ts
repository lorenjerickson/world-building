import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_rule_definitions_definition_type" ADD VALUE 'derived-value' BEFORE 'catalog';
  ALTER TYPE "public"."enum_rule_definitions_definition_type" ADD VALUE 'modifier' BEFORE 'catalog';
  ALTER TYPE "public"."enum_rule_definitions_definition_type" ADD VALUE 'check' BEFORE 'catalog';
  ALTER TYPE "public"."enum_rule_definitions_definition_type" ADD VALUE 'resource' BEFORE 'catalog';
  ALTER TYPE "public"."enum__rule_definitions_v_version_definition_type" ADD VALUE 'derived-value' BEFORE 'catalog';
  ALTER TYPE "public"."enum__rule_definitions_v_version_definition_type" ADD VALUE 'modifier' BEFORE 'catalog';
  ALTER TYPE "public"."enum__rule_definitions_v_version_definition_type" ADD VALUE 'check' BEFORE 'catalog';
  ALTER TYPE "public"."enum__rule_definitions_v_version_definition_type" ADD VALUE 'resource' BEFORE 'catalog';`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1 FROM "rule_definitions"
      WHERE "definition_type"::text IN ('derived-value', 'modifier', 'check', 'resource')
    ) OR EXISTS (
      SELECT 1 FROM "_rule_definitions_v"
      WHERE "version_definition_type"::text IN ('derived-value', 'modifier', 'check', 'resource')
    ) THEN
      RAISE EXCEPTION 'Cannot reverse phase2_definition_types while Phase 2 definitions or versions exist. Migrate or delete those documents explicitly first.';
    END IF;
  END $$;

  ALTER TABLE "rule_definitions" ALTER COLUMN "definition_type" SET DATA TYPE text;
  DROP TYPE "public"."enum_rule_definitions_definition_type";
  CREATE TYPE "public"."enum_rule_definitions_definition_type" AS ENUM('entity-type', 'trait', 'field', 'catalog', 'template', 'operation', 'effect', 'event', 'constraint', 'presentation', 'fixture');
  ALTER TABLE "rule_definitions" ALTER COLUMN "definition_type" SET DATA TYPE "public"."enum_rule_definitions_definition_type" USING "definition_type"::"public"."enum_rule_definitions_definition_type";
  ALTER TABLE "_rule_definitions_v" ALTER COLUMN "version_definition_type" SET DATA TYPE text;
  DROP TYPE "public"."enum__rule_definitions_v_version_definition_type";
  CREATE TYPE "public"."enum__rule_definitions_v_version_definition_type" AS ENUM('entity-type', 'trait', 'field', 'catalog', 'template', 'operation', 'effect', 'event', 'constraint', 'presentation', 'fixture');
  ALTER TABLE "_rule_definitions_v" ALTER COLUMN "version_definition_type" SET DATA TYPE "public"."enum__rule_definitions_v_version_definition_type" USING "version_definition_type"::"public"."enum__rule_definitions_v_version_definition_type";`)
}
