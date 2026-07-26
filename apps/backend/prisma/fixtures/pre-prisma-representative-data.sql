-- Representative data for the disposable pre-Prisma compatibility
-- database. Do not run this fixture against a shared or production database.

BEGIN;

INSERT INTO "worlds" (
  "id",
  "prompt",
  "generatedContent",
  "metadata",
  "createdAt"
) VALUES (
  '00000000-0000-4000-8000-000000000001',
  'Phase 1 legacy world',
  'Legacy generated content',
  '{"name":"Legacy World","nullableValue":null,"tags":["fixture"]}'::jsonb,
  '2026-07-25T17:00:00.123456Z'
) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "rule_set_compositions" (
  "id",
  "workspaceExternalId",
  "manifest",
  "compositionHash",
  "engineVersion",
  "compilerVersion",
  "validationSummary",
  "createdBy",
  "createdAt"
) VALUES (
  '10000000-0000-4000-8000-000000000001',
  'workspace:phase1',
  '{"profileName":"default","members":[{"namespaceAlias":"core"}]}'::jsonb,
  'phase1-composition-hash',
  '1.0.0',
  '1.0.0',
  NULL,
  'actor:phase1',
  '2026-07-25T17:01:00.123456Z'
) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "rule_set_composition_members" (
  "id",
  "compositionId",
  "ruleSetId",
  "releaseId",
  "releaseHash",
  "namespaceAlias",
  "sortOrder",
  "policy"
) VALUES (
  '11000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  101,
  201,
  'phase1-release-hash',
  'core',
  0,
  '{"mode":"fixture"}'::jsonb
) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "rule_set_bindings" (
  "id",
  "workspaceExternalId",
  "scopeType",
  "scopeId",
  "gameplayProfileName",
  "compositionId",
  "compositionHash",
  "active",
  "stateVersion",
  "status",
  "createdAt",
  "updatedAt"
) VALUES (
  '12000000-0000-4000-8000-000000000001',
  'workspace:phase1',
  'world',
  'world:phase1',
  'default',
  '10000000-0000-4000-8000-000000000001',
  'phase1-composition-hash',
  true,
  9007199254740993,
  'active',
  '2026-07-25T17:02:00.123456Z',
  '2026-07-25T17:02:00.654321Z'
) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "rule_instances" (
  "id",
  "bindingId",
  "typeId",
  "state",
  "stateVersion",
  "createdBy",
  "createdAt",
  "updatedAt"
) VALUES (
  '13000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001',
  'creature:phase1',
  '{"hitPoints":12,"conditions":[]}'::jsonb,
  9007199254740994,
  'actor:phase1',
  '2026-07-25T17:03:00.123456Z',
  '2026-07-25T17:03:00.654321Z'
) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "rule_effects" (
  "id",
  "bindingId",
  "targetId",
  "definitionId",
  "sourceRef",
  "state",
  "expiresAt",
  "stateVersion",
  "createdAt",
  "updatedAt"
) VALUES (
  '14000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001',
  'target:phase1',
  'effect:phase1',
  '{"kind":"fixture"}'::jsonb,
  '{"stacks":1}'::jsonb,
  NULL,
  9007199254740995,
  '2026-07-25T17:04:00.123456Z',
  '2026-07-25T17:04:00.654321Z'
) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "rule_executions" (
  "id",
  "bindingId",
  "operationId",
  "actorId",
  "idempotencyKey",
  "input",
  "result",
  "traceRef",
  "status",
  "createdAt",
  "updatedAt"
) VALUES (
  '15000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001',
  'operation:phase1',
  'actor:phase1',
  'phase1-idempotency-key',
  '{"roll":20}'::jsonb,
  NULL,
  NULL,
  'pending',
  '2026-07-25T17:05:00.123456Z',
  '2026-07-25T17:05:00.654321Z'
) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "rule_events" (
  "id",
  "bindingId",
  "sequence",
  "eventTypeId",
  "visibility",
  "payload",
  "causationId",
  "correlationId",
  "createdAt"
) VALUES (
  '16000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001',
  9007199254740996,
  'event:phase1',
  'public',
  '{"message":"fixture"}'::jsonb,
  NULL,
  NULL,
  '2026-07-25T17:06:00.123456Z'
) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "rule_continuations" (
  "id",
  "executionId",
  "stepId",
  "state",
  "authorizedResponders",
  "expiresAt",
  "status",
  "stateVersion",
  "createdAt",
  "updatedAt"
) VALUES (
  '17000000-0000-4000-8000-000000000001',
  '15000000-0000-4000-8000-000000000001',
  'step:phase1',
  '{"waiting":true}'::jsonb,
  '["actor:phase1"]'::jsonb,
  '2030-07-25T17:07:00.123456Z',
  'pending',
  9007199254740997,
  '2026-07-25T17:07:00.123456Z',
  '2026-07-25T17:07:00.654321Z'
) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "rule_artifacts" (
  "id",
  "artifactHash",
  "releaseOrCompositionHash",
  "engineVersion",
  "artifactLocation",
  "validationSummary",
  "compiledAt"
) VALUES (
  '18000000-0000-4000-8000-000000000001',
  'phase1-artifact-hash',
  'phase1-composition-hash',
  '1.0.0',
  'memory://phase1-artifact',
  '{"status":"valid"}'::jsonb,
  '2026-07-25T17:08:00.123456Z'
) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "artifact_rule_contexts" (
  "id",
  "artifactId",
  "generationJobId",
  "bindingId",
  "compositionHash",
  "policyHash",
  "applicableReleases",
  "context",
  "applicabilityStatus",
  "validationSummary",
  "createdAt",
  "updatedAt"
) VALUES (
  '19000000-0000-4000-8000-000000000001',
  'artifact:phase1',
  'job:phase1',
  '12000000-0000-4000-8000-000000000001',
  'phase1-composition-hash',
  'phase1-policy-hash',
  '["phase1-release-hash"]'::jsonb,
  '{"locale":"en"}'::jsonb,
  'applicable',
  '{"status":"valid"}'::jsonb,
  '2026-07-25T17:09:00.123456Z',
  '2026-07-25T17:09:00.654321Z'
) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "rule_authoring_sessions" (
  "id",
  "ruleSetId",
  "draftId",
  "actorId",
  "baseRevision",
  "status",
  "modelMetadata",
  "retentionPolicy",
  "createdAt",
  "updatedAt"
) VALUES (
  '20000000-0000-4000-8000-000000000001',
  101,
  'draft:phase1',
  'actor:phase1',
  'revision:phase1',
  'active',
  '{"provider":"fixture"}'::jsonb,
  '{"days":30}'::jsonb,
  '2026-07-25T17:10:00.123456Z',
  '2026-07-25T17:10:00.654321Z'
) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "rule_authoring_proposals" (
  "id",
  "sessionId",
  "baseRevision",
  "proposalHash",
  "patch",
  "assumptions",
  "validationSummary",
  "status",
  "decisionBy",
  "createdAt",
  "updatedAt"
) VALUES (
  '21000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'revision:phase1',
  'phase1-proposal-hash',
  '{"op":"replace"}'::jsonb,
  '["fixture"]'::jsonb,
  '{"status":"valid"}'::jsonb,
  'proposed',
  NULL,
  '2026-07-25T17:11:00.123456Z',
  '2026-07-25T17:11:00.654321Z'
) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "rule_definition_snapshots" (
  "id",
  "ruleSetId",
  "definitionId",
  "definitionExternalId",
  "name",
  "body",
  "reason",
  "actorId",
  "createdAt"
) VALUES (
  '22000000-0000-4000-8000-000000000001',
  101,
  301,
  'definition:phase1',
  'Phase 1 definition',
  '{"metamodelVersion":"fixture/1"}'::jsonb,
  'autosave',
  'actor:phase1',
  '2026-07-25T17:12:00.123456Z'
) ON CONFLICT ("id") DO NOTHING;

COMMIT;
