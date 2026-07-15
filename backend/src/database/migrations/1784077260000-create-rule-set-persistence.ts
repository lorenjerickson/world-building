import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRuleSetPersistence1784077260000 implements MigrationInterface {
  name = 'CreateRuleSetPersistence1784077260000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "rule_set_compositions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "workspaceExternalId" varchar NOT NULL,
        "manifest" jsonb NOT NULL,
        "compositionHash" varchar NOT NULL,
        "engineVersion" varchar NOT NULL,
        "compilerVersion" varchar NOT NULL,
        "validationSummary" jsonb,
        "createdBy" varchar NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_rule_set_composition_workspace_hash" UNIQUE ("workspaceExternalId", "compositionHash")
      );
      CREATE INDEX "IDX_rule_set_composition_workspace" ON "rule_set_compositions" ("workspaceExternalId");
      CREATE INDEX "IDX_rule_set_composition_hash" ON "rule_set_compositions" ("compositionHash");

      CREATE TABLE "rule_set_composition_members" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "compositionId" uuid NOT NULL REFERENCES "rule_set_compositions"("id") ON DELETE CASCADE,
        "ruleSetId" integer NOT NULL,
        "releaseId" integer NOT NULL,
        "releaseHash" varchar NOT NULL,
        "namespaceAlias" varchar NOT NULL,
        "sortOrder" integer NOT NULL,
        "policy" jsonb NOT NULL DEFAULT '{}'::jsonb,
        CONSTRAINT "UQ_rule_set_member_namespace" UNIQUE ("compositionId", "namespaceAlias"),
        CONSTRAINT "UQ_rule_set_member_order" UNIQUE ("compositionId", "sortOrder")
      );

      CREATE TABLE "rule_set_bindings" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "workspaceExternalId" varchar NOT NULL,
        "scopeType" varchar NOT NULL CHECK ("scopeType" IN ('world', 'campaign', 'session')),
        "scopeId" varchar NOT NULL,
        "gameplayProfileName" varchar NOT NULL,
        "compositionId" uuid NOT NULL REFERENCES "rule_set_compositions"("id") ON DELETE RESTRICT,
        "compositionHash" varchar NOT NULL,
        "active" boolean NOT NULL DEFAULT false,
        "stateVersion" bigint NOT NULL DEFAULT 1,
        "status" varchar NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'migrating', 'disabled')),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_rule_set_binding_profile" UNIQUE ("scopeType", "scopeId", "gameplayProfileName")
      );
      CREATE INDEX "IDX_rule_set_binding_workspace" ON "rule_set_bindings" ("workspaceExternalId");
      CREATE UNIQUE INDEX "UQ_rule_set_binding_active_scope" ON "rule_set_bindings" ("scopeType", "scopeId") WHERE "active" = true;

      CREATE TABLE "rule_instances" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "bindingId" uuid NOT NULL REFERENCES "rule_set_bindings"("id") ON DELETE CASCADE,
        "typeId" varchar NOT NULL,
        "state" jsonb NOT NULL,
        "stateVersion" bigint NOT NULL DEFAULT 1,
        "createdBy" varchar NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX "IDX_rule_instance_binding_type" ON "rule_instances" ("bindingId", "typeId");

      CREATE TABLE "rule_effects" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "bindingId" uuid NOT NULL REFERENCES "rule_set_bindings"("id") ON DELETE CASCADE,
        "targetId" varchar NOT NULL,
        "definitionId" varchar NOT NULL,
        "sourceRef" jsonb NOT NULL,
        "state" jsonb NOT NULL,
        "expiresAt" timestamptz,
        "stateVersion" bigint NOT NULL DEFAULT 1,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX "IDX_rule_effect_binding_target" ON "rule_effects" ("bindingId", "targetId");
      CREATE INDEX "IDX_rule_effect_binding_expiry" ON "rule_effects" ("bindingId", "expiresAt");

      CREATE TABLE "rule_executions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "bindingId" uuid NOT NULL REFERENCES "rule_set_bindings"("id") ON DELETE CASCADE,
        "operationId" varchar NOT NULL,
        "actorId" varchar NOT NULL,
        "idempotencyKey" varchar NOT NULL,
        "input" jsonb NOT NULL,
        "result" jsonb,
        "traceRef" varchar,
        "status" varchar NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'committed', 'rejected', 'failed')),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_rule_execution_idempotency" UNIQUE ("bindingId", "actorId", "idempotencyKey")
      );

      CREATE TABLE "rule_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "bindingId" uuid NOT NULL REFERENCES "rule_set_bindings"("id") ON DELETE CASCADE,
        "sequence" bigint NOT NULL,
        "eventTypeId" varchar NOT NULL,
        "visibility" varchar NOT NULL DEFAULT 'public',
        "payload" jsonb NOT NULL,
        "causationId" uuid,
        "correlationId" uuid,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_rule_event_sequence" UNIQUE ("bindingId", "sequence")
      );

      CREATE TABLE "rule_continuations" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "executionId" uuid NOT NULL REFERENCES "rule_executions"("id") ON DELETE CASCADE,
        "stepId" varchar NOT NULL,
        "state" jsonb NOT NULL,
        "authorizedResponders" jsonb NOT NULL,
        "expiresAt" timestamptz NOT NULL,
        "status" varchar NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'resolved', 'expired', 'cancelled')),
        "stateVersion" bigint NOT NULL DEFAULT 1,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX "IDX_rule_continuation_execution" ON "rule_continuations" ("executionId");
      CREATE INDEX "IDX_rule_continuation_status_expiry" ON "rule_continuations" ("status", "expiresAt");

      CREATE TABLE "rule_artifacts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "artifactHash" varchar NOT NULL UNIQUE,
        "releaseOrCompositionHash" varchar NOT NULL,
        "engineVersion" varchar NOT NULL,
        "artifactLocation" varchar NOT NULL,
        "validationSummary" jsonb NOT NULL,
        "compiledAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_rule_artifact_source_engine" UNIQUE ("releaseOrCompositionHash", "engineVersion")
      );

      CREATE TABLE "artifact_rule_contexts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "artifactId" varchar NOT NULL,
        "generationJobId" varchar NOT NULL,
        "bindingId" uuid REFERENCES "rule_set_bindings"("id") ON DELETE SET NULL,
        "compositionHash" varchar NOT NULL,
        "policyHash" varchar NOT NULL,
        "applicableReleases" jsonb NOT NULL,
        "context" jsonb NOT NULL,
        "applicabilityStatus" varchar NOT NULL DEFAULT 'applicable' CHECK ("applicabilityStatus" IN ('applicable', 'adaptable', 'legacy-visible', 'profile-hidden', 'invalid')),
        "validationSummary" jsonb NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX "IDX_artifact_rule_context_artifact_composition" ON "artifact_rule_contexts" ("artifactId", "compositionHash");
      CREATE INDEX "IDX_artifact_rule_context_job" ON "artifact_rule_contexts" ("generationJobId");

      CREATE TABLE "rule_authoring_sessions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "ruleSetId" integer NOT NULL,
        "draftId" varchar NOT NULL,
        "actorId" varchar NOT NULL,
        "baseRevision" varchar NOT NULL,
        "status" varchar NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'completed', 'cancelled', 'expired')),
        "modelMetadata" jsonb NOT NULL,
        "retentionPolicy" jsonb NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX "IDX_rule_authoring_session_context" ON "rule_authoring_sessions" ("ruleSetId", "draftId", "actorId");

      CREATE TABLE "rule_authoring_proposals" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "sessionId" uuid NOT NULL REFERENCES "rule_authoring_sessions"("id") ON DELETE CASCADE,
        "baseRevision" varchar NOT NULL,
        "proposalHash" varchar NOT NULL,
        "patch" jsonb NOT NULL,
        "assumptions" jsonb NOT NULL,
        "validationSummary" jsonb NOT NULL,
        "status" varchar NOT NULL DEFAULT 'proposed' CHECK ("status" IN ('proposed', 'accepted', 'partially-accepted', 'discarded', 'stale')),
        "decisionBy" varchar,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_rule_authoring_proposal_hash" UNIQUE ("sessionId", "proposalHash")
      );
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE "rule_authoring_proposals";
      DROP TABLE "rule_authoring_sessions";
      DROP TABLE "artifact_rule_contexts";
      DROP TABLE "rule_artifacts";
      DROP TABLE "rule_continuations";
      DROP TABLE "rule_events";
      DROP TABLE "rule_executions";
      DROP TABLE "rule_effects";
      DROP TABLE "rule_instances";
      DROP TABLE "rule_set_bindings";
      DROP TABLE "rule_set_composition_members";
      DROP TABLE "rule_set_compositions";
    `);
  }
}
