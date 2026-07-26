import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(backendDir, '../..');
const schemaPath = resolve(backendDir, 'prisma/schema.prisma');
const verifyScript = resolve(backendDir, 'scripts/verify-prisma-legacy-contract.mjs');
const adoptScript = resolve(backendDir, 'scripts/adopt-prisma-baseline.mjs');
const compareScript = resolve(backendDir, 'scripts/compare-prisma-database-contracts.mjs');
const createLegacyFixtureScript = resolve(
  backendDir,
  'scripts/create-legacy-schema-fixture.mjs',
);
const runtimeTest = resolve(backendDir, 'test/prisma-runtime.test.js');
const require = createRequire(import.meta.url);
const prismaCli = require.resolve('prisma/build/index.js');
const suffix = `${process.pid}_${Date.now()}`;
const cleanDatabase = `wb_prisma_verify_clean_${suffix}`;
const legacyDatabase = `wb_prisma_verify_legacy_${suffix}`;
const adminDatabaseUrl =
  process.env.PRISMA_RELEASE_DATABASE_URL ??
  'postgresql://worldbuilder:password123@127.0.0.1:5432/postgres';
const adminUrl = new URL(adminDatabaseUrl);
const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);

if (
  !localHosts.has(adminUrl.hostname) &&
  process.env.PRISMA_RELEASE_ALLOW_REMOTE !== '1'
) {
  throw new Error(
    'Refusing to create disposable databases on a remote host. ' +
      'Set PRISMA_RELEASE_ALLOW_REMOTE=1 only for an explicitly disposable server.',
  );
}

adminUrl.searchParams.delete('schema');

function databaseUrl(databaseName) {
  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

const cleanDatabaseUrl = databaseUrl(cleanDatabase);
const legacyDatabaseUrl = databaseUrl(legacyDatabase);
const createdDatabases = [];

function run(label, command, args, environment = {}, cwd = backendDir) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: 'inherit',
    env: {
      ...process.env,
      PRISMA_HIDE_UPDATE_MESSAGE: '1',
      ...environment,
    },
  });
  assert.equal(
    result.status,
    0,
    `${label} failed with exit status ${result.status ?? 'unknown'}.`,
  );
}

async function verifySchemaFormatting() {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'wb-prisma-format-'));
  const temporarySchema = join(temporaryDirectory, 'schema.prisma');
  const originalSchema = await readFile(schemaPath, 'utf8');
  try {
    await writeFile(temporarySchema, originalSchema);
    run(
      'Format-check Prisma schema',
      process.execPath,
      [prismaCli, 'format', '--schema', temporarySchema],
    );
    assert.equal(
      await readFile(temporarySchema, 'utf8'),
      originalSchema,
      'prisma/schema.prisma is not formatted. Run prisma format and commit the result.',
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function createDatabases() {
  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE "${cleanDatabase}"`);
    createdDatabases.push(cleanDatabase);
    await client.query(`CREATE DATABASE "${legacyDatabase}"`);
    createdDatabases.push(legacyDatabase);
  } finally {
    await client.end();
  }
}

async function dropDatabases() {
  assert.ok(
    createdDatabases.every((name) => name.startsWith('wb_prisma_verify_')),
  );
  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    for (const name of createdDatabases) {
      await client.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1',
        [name],
      );
      await client.query(`DROP DATABASE IF EXISTS "${name}"`);
    }
  } finally {
    await client.end();
  }
}

try {
  await verifySchemaFormatting();
  run('Validate Prisma schema', process.execPath, [prismaCli, 'validate']);
  run('Generate Prisma Client', process.execPath, [prismaCli, 'generate']);
  run('Build backend', 'pnpm', ['run', 'build']);
  run('Run backend unit tests', 'pnpm', ['run', 'test']);

  await createDatabases();

  run(
    'Deploy Prisma migrations to a clean database',
    process.execPath,
    [prismaCli, 'migrate', 'deploy'],
    { DATABASE_URL: cleanDatabaseUrl },
  );
  run(
    'Verify clean database migration status',
    process.execPath,
    [prismaCli, 'migrate', 'status'],
    { DATABASE_URL: cleanDatabaseUrl },
  );
  run(
    'Verify clean schema and representative rows',
    process.execPath,
    [verifyScript, '--seed-fixture'],
    { DATABASE_URL: cleanDatabaseUrl },
  );
  run(
    'Run PostgreSQL-backed runtime tests',
    process.execPath,
    ['--test', runtimeTest],
    { DATABASE_URL: cleanDatabaseUrl },
  );

  run(
    'Create historical pre-Prisma database fixture',
    process.execPath,
    [createLegacyFixtureScript],
    { DATABASE_URL: legacyDatabaseUrl },
  );
  run(
    'Verify legacy schema and representative rows',
    process.execPath,
    [verifyScript, '--seed-fixture'],
    { DATABASE_URL: legacyDatabaseUrl },
  );
  run(
    'Compare clean Prisma and historical database contracts',
    process.execPath,
    [compareScript],
    {
      LEGACY_DATABASE_URL: legacyDatabaseUrl,
      PRISMA_DATABASE_URL: cleanDatabaseUrl,
    },
  );
  run(
    'Adopt the Prisma baseline on the legacy database',
    process.execPath,
    [adoptScript, '--apply', '--backup-confirmed'],
    { DATABASE_URL: legacyDatabaseUrl },
  );
  run(
    'Re-verify adopted data and relationships',
    process.execPath,
    [verifyScript, '--exercise-fixture'],
    { DATABASE_URL: legacyDatabaseUrl },
  );
  run(
    'Verify adopted migration status',
    process.execPath,
    [prismaCli, 'migrate', 'status'],
    { DATABASE_URL: legacyDatabaseUrl },
  );
  run(
    'Compare clean and adopted database contracts',
    process.execPath,
    [compareScript],
    {
      LEGACY_DATABASE_URL: legacyDatabaseUrl,
      PRISMA_DATABASE_URL: cleanDatabaseUrl,
    },
  );

  run(
    'Build and smoke-test the production image',
    'pnpm',
    ['run', 'smoke:production'],
  );

  console.log('\nBackend Prisma release verification passed.');
} finally {
  if (createdDatabases.length > 0) {
    await dropDatabases();
  }
}
