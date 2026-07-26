import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { Client } from 'pg';
import { Prisma, PrismaClient } from '@prisma/client';

const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = resolve(backendDir, 'prisma/schema.prisma');
const fixturePath = resolve(
  backendDir,
  'prisma/fixtures/pre-prisma-representative-data.sql',
);
const seedFixture = process.argv.includes('--seed-fixture');
const exerciseFixture = seedFixture || process.argv.includes('--exercise-fixture');
const databaseUrl = process.env.DATABASE_URL;
const baselineMigrationName = '20260725190000_application_baseline';

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required.');
}

const require = createRequire(import.meta.url);
const prismaCli = require.resolve('prisma/build/index.js');
const sql = new Client({ connectionString: databaseUrl });
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

const fixtureIds = {
  world: '00000000-0000-4000-8000-000000000001',
  composition: '10000000-0000-4000-8000-000000000001',
  member: '11000000-0000-4000-8000-000000000001',
  binding: '12000000-0000-4000-8000-000000000001',
  instance: '13000000-0000-4000-8000-000000000001',
  effect: '14000000-0000-4000-8000-000000000001',
  execution: '15000000-0000-4000-8000-000000000001',
  event: '16000000-0000-4000-8000-000000000001',
  continuation: '17000000-0000-4000-8000-000000000001',
  artifact: '18000000-0000-4000-8000-000000000001',
  context: '19000000-0000-4000-8000-000000000001',
  session: '20000000-0000-4000-8000-000000000001',
  proposal: '21000000-0000-4000-8000-000000000001',
  snapshot: '22000000-0000-4000-8000-000000000001',
};

const expectedCheckConstraints = [
  'artifact_rule_contexts_applicabilityStatus_check',
  'rule_authoring_proposals_status_check',
  'rule_authoring_sessions_status_check',
  'rule_continuations_status_check',
  'rule_definition_snapshots_reason_check',
  'rule_executions_status_check',
  'rule_set_bindings_scopeType_check',
  'rule_set_bindings_status_check',
];

const expectedForeignKeys = new Map([
  ['artifact_rule_contexts_bindingId_fkey', 'SET NULL'],
  ['rule_authoring_proposals_sessionId_fkey', 'CASCADE'],
  ['rule_continuations_executionId_fkey', 'CASCADE'],
  ['rule_effects_bindingId_fkey', 'CASCADE'],
  ['rule_events_bindingId_fkey', 'CASCADE'],
  ['rule_executions_bindingId_fkey', 'CASCADE'],
  ['rule_instances_bindingId_fkey', 'CASCADE'],
  ['rule_set_bindings_compositionId_fkey', 'RESTRICT'],
  ['rule_set_composition_members_compositionId_fkey', 'CASCADE'],
]);

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

async function verifyPhysicalNamesAndTimestamps() {
  for (const model of Prisma.dmmf.datamodel.models) {
    const tableName = model.dbName ?? model.name;
    const scalarFields = model.fields.filter((field) => field.kind === 'scalar');
    const expectedColumns = sorted(scalarFields.map((field) => field.dbName ?? field.name));
    const columnsResult = await sql.query(
      `
        SELECT "column_name", "data_type"
        FROM "information_schema"."columns"
        WHERE "table_schema" = 'public' AND "table_name" = $1
      `,
      [tableName],
    );

    assert.deepEqual(
      sorted(columnsResult.rows.map((row) => row.column_name)),
      expectedColumns,
      `Physical columns differ for ${tableName}`,
    );

    const typeByColumn = new Map(
      columnsResult.rows.map((row) => [row.column_name, row.data_type]),
    );
    for (const field of scalarFields.filter((candidate) => candidate.type === 'DateTime')) {
      assert.equal(
        typeByColumn.get(field.dbName ?? field.name),
        'timestamp with time zone',
        `${tableName}.${field.dbName ?? field.name} must remain timestamptz`,
      );
    }
  }
}

async function verifyMigrationHistory() {
  const history = await sql.query(
    `
      SELECT
        to_regclass('public.migrations') IS NOT NULL AS "hasLegacy",
        to_regclass('public._prisma_migrations') IS NOT NULL AS "hasPrisma"
    `,
  );
  const { hasLegacy, hasPrisma } = history.rows[0];
  assert.ok(hasLegacy || hasPrisma, 'No recognized migration history table exists.');

  if (hasLegacy) {
    const legacy = await sql.query(
      `SELECT "name" FROM "migrations" ORDER BY "timestamp"`,
    );
    assert.deepEqual(
      legacy.rows.map((row) => row.name),
      [
        'AdoptWorldsSchema1784077200000',
        'CreateRuleSetPersistence1784077260000',
        'AddRuleDefinitionSnapshots1784077320000',
      ],
    );
  }

  if (hasPrisma) {
    const migrations = await sql.query(
      `
        SELECT "migration_name", "finished_at", "rolled_back_at"
        FROM "_prisma_migrations"
        ORDER BY "started_at"
      `,
    );
    const baseline = migrations.rows.find(
      (row) => row.migration_name === baselineMigrationName,
    );
    assert.ok(baseline, `Prisma baseline ${baselineMigrationName} is not recorded.`);
    assert.ok(baseline.finished_at, 'Prisma baseline is not finished.');
    assert.equal(baseline.rolled_back_at, null, 'Prisma baseline is rolled back.');
    assert.equal(
      migrations.rows.some((row) => !row.finished_at && !row.rolled_back_at),
      false,
      'Prisma migration history contains a failed or unfinished migration.',
    );
  }

  return [
    ...(hasLegacy ? ['migrations'] : []),
    ...(hasPrisma ? ['_prisma_migrations'] : []),
  ];
}

async function verifyUnsupportedObjects() {
  const checks = await sql.query(
    `
      SELECT "conname"
      FROM "pg_constraint"
      WHERE "contype" = 'c'
        AND "connamespace" = 'public'::regnamespace
    `,
  );
  assert.deepEqual(sorted(checks.rows.map((row) => row.conname)), expectedCheckConstraints);

  const foreignKeys = await sql.query(
    `
      SELECT "constraint_name", "delete_rule"
      FROM "information_schema"."referential_constraints"
      WHERE "constraint_schema" = 'public'
    `,
  );
  assert.deepEqual(
    new Map(foreignKeys.rows.map((row) => [row.constraint_name, row.delete_rule])),
    expectedForeignKeys,
  );

  const activeIndex = await sql.query(
    `
      SELECT "indexdef"
      FROM "pg_indexes"
      WHERE "schemaname" = 'public'
        AND "indexname" = 'UQ_rule_set_binding_active_scope'
    `,
  );
  assert.equal(
    activeIndex.rowCount,
    1,
    'Required partial index UQ_rule_set_binding_active_scope is missing.',
  );
  assert.match(activeIndex.rows[0].indexdef, /UNIQUE INDEX/);
  assert.match(activeIndex.rows[0].indexdef, /"scopeType", "scopeId"/);
  assert.match(activeIndex.rows[0].indexdef, /WHERE \(active = true\)/);

  const worldComment = await sql.query(
    `SELECT obj_description('public.worlds'::regclass, 'pg_class') AS "comment"`,
  );
  assert.equal(worldComment.rows[0].comment, 'world-building migration 1784077200000');
}

function verifyPrismaDiff(historyTables) {
  const result = spawnSync(
    process.execPath,
    [
      prismaCli,
      'migrate',
      'diff',
      '--from-schema-datasource',
      schemaPath,
      '--to-schema-datamodel',
      schemaPath,
      '--script',
    ],
    {
      cwd: backendDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        PRISMA_HIDE_UPDATE_MESSAGE: '1',
      },
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const ddlStatements = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^(CREATE|ALTER|DROP|RENAME)\b/.test(line));
  assert.deepEqual(
    sorted(ddlStatements),
    sorted(
      historyTables
        .filter((table) => table !== '_prisma_migrations')
        .map((table) => `DROP TABLE "${table}";`),
    ),
    `Unexpected Prisma schema drift:\n${result.stdout}`,
  );
}

async function exerciseRepresentativeRows() {
  const verification = { verifiedBy: 'prisma-phase1' };
  await prisma.$transaction([
    prisma.world.update({
      where: { id: fixtureIds.world },
      data: { metadata: verification },
    }),
    prisma.ruleSetComposition.update({
      where: { id: fixtureIds.composition },
      data: { validationSummary: verification },
    }),
    prisma.ruleSetCompositionMember.update({
      where: { id: fixtureIds.member },
      data: { policy: verification },
    }),
    prisma.ruleSetBinding.update({
      where: { id: fixtureIds.binding },
      data: { status: 'active' },
    }),
    prisma.ruleInstance.update({
      where: { id: fixtureIds.instance },
      data: { state: verification },
    }),
    prisma.ruleEffect.update({
      where: { id: fixtureIds.effect },
      data: { state: verification },
    }),
    prisma.ruleExecution.update({
      where: { id: fixtureIds.execution },
      data: { result: verification, status: 'committed' },
    }),
    prisma.ruleEvent.update({
      where: { id: fixtureIds.event },
      data: { payload: verification },
    }),
    prisma.ruleContinuation.update({
      where: { id: fixtureIds.continuation },
      data: { state: verification, status: 'resolved' },
    }),
    prisma.ruleArtifact.update({
      where: { id: fixtureIds.artifact },
      data: { validationSummary: verification },
    }),
    prisma.artifactRuleContext.update({
      where: { id: fixtureIds.context },
      data: { context: verification },
    }),
    prisma.ruleAuthoringSession.update({
      where: { id: fixtureIds.session },
      data: { status: 'completed' },
    }),
    prisma.ruleAuthoringProposal.update({
      where: { id: fixtureIds.proposal },
      data: { status: 'accepted', decisionBy: 'actor:phase1' },
    }),
    prisma.ruleDefinitionSnapshot.update({
      where: { id: fixtureIds.snapshot },
      data: { body: verification, reason: 'manual' },
    }),
  ]);

  const [composition, binding, execution, session] = await Promise.all([
    prisma.ruleSetComposition.findUniqueOrThrow({
      where: { id: fixtureIds.composition },
      include: { members: true, bindings: true },
    }),
    prisma.ruleSetBinding.findUniqueOrThrow({
      where: { id: fixtureIds.binding },
      include: {
        composition: true,
        instances: true,
        effects: true,
        executions: true,
        events: true,
        artifactContexts: true,
      },
    }),
    prisma.ruleExecution.findUniqueOrThrow({
      where: { id: fixtureIds.execution },
      include: { continuations: true },
    }),
    prisma.ruleAuthoringSession.findUniqueOrThrow({
      where: { id: fixtureIds.session },
      include: { proposals: true },
    }),
  ]);

  assert.equal(composition.members.length, 1);
  assert.equal(composition.bindings.length, 1);
  assert.equal(binding.stateVersion, 9007199254740993n);
  assert.equal(binding.instances.length, 1);
  assert.equal(binding.effects[0].expiresAt, null);
  assert.equal(binding.artifactContexts.length, 1);
  assert.equal(execution.continuations.length, 1);
  assert.equal(session.proposals.length, 1);
}

try {
  await sql.connect();
  if (seedFixture) {
    await sql.query(await readFile(fixturePath, 'utf8'));
  }
  await prisma.$connect();
  const historyTables = await verifyMigrationHistory();
  await verifyPhysicalNamesAndTimestamps();
  await verifyUnsupportedObjects();
  verifyPrismaDiff(historyTables);
  if (exerciseFixture) {
    await exerciseRepresentativeRows();
  }
  console.log(
    exerciseFixture
      ? 'Prisma schema contract and representative rows verified.'
      : 'Prisma schema contract verified with a read-only preflight.',
  );
} finally {
  await Promise.allSettled([prisma.$disconnect(), sql.end()]);
}
