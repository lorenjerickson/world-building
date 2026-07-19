import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRuleDefinitionSnapshots1784077320000 implements MigrationInterface {
  name = 'AddRuleDefinitionSnapshots1784077320000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "rule_definition_snapshots" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "ruleSetId" integer NOT NULL,
        "definitionId" integer NOT NULL,
        "definitionExternalId" varchar NOT NULL,
        "name" varchar NOT NULL,
        "body" jsonb NOT NULL,
        "reason" varchar NOT NULL DEFAULT 'autosave'
          CHECK ("reason" IN ('autosave', 'manual', 'restore', 'import')),
        "actorId" varchar NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX "IDX_rule_def_snapshot_definition" ON "rule_definition_snapshots" ("definitionId");
      CREATE INDEX "IDX_rule_def_snapshot_ruleset_def_time"
        ON "rule_definition_snapshots" ("ruleSetId", "definitionId", "createdAt" DESC);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "rule_definition_snapshots";`);
  }
}
