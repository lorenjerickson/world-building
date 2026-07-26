import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const verifyScript = resolve(backendDir, 'scripts/verify-prisma-legacy-contract.mjs');
const databaseUrl = process.env.DATABASE_URL;
const baselineMigrationName = '20260725190000_application_baseline';
const apply = process.argv.includes('--apply');
const backupConfirmed = process.argv.includes('--backup-confirmed');
const require = createRequire(import.meta.url);
const prismaCli = require.resolve('prisma/build/index.js');

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required.');
}
if (!apply || !backupConfirmed) {
  throw new Error(
    'Adoption is disabled unless both --apply and --backup-confirmed are provided.',
  );
}

function run(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: backendDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      PRISMA_HIDE_UPDATE_MESSAGE: '1',
    },
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, `${label} failed.`);
}

const sql = new Client({ connectionString: databaseUrl });

try {
  await sql.connect();
  const history = await sql.query(
    `
      SELECT
        to_regclass('public.migrations') IS NOT NULL AS "hasLegacy",
        to_regclass('public._prisma_migrations') IS NOT NULL AS "hasPrisma"
    `,
  );
  assert.equal(
    history.rows[0].hasLegacy,
    true,
    'The legacy migrations table is absent; this command is only for pre-Prisma adoption.',
  );

  run(process.execPath, [verifyScript], 'Read-only legacy schema preflight');

  let baselineApplied = false;
  if (history.rows[0].hasPrisma) {
    const baseline = await sql.query(
      `
        SELECT "finished_at", "rolled_back_at"
        FROM "_prisma_migrations"
        WHERE "migration_name" = $1
      `,
      [baselineMigrationName],
    );
    assert.equal(
      baseline.rowCount,
      1,
      'Prisma migration history exists without the expected baseline; refusing adoption.',
    );
    assert.ok(baseline.rows[0].finished_at, 'The Prisma baseline is unfinished.');
    assert.equal(baseline.rows[0].rolled_back_at, null, 'The Prisma baseline is rolled back.');
    baselineApplied = true;
  }

  if (!baselineApplied) {
    run(
      process.execPath,
      [prismaCli, 'migrate', 'resolve', '--applied', baselineMigrationName],
      'Prisma baseline resolution',
    );
  }

  run(process.execPath, [prismaCli, 'migrate', 'deploy'], 'Prisma migration deploy');
  run(process.execPath, [prismaCli, 'migrate', 'status'], 'Prisma migration status');
  run(process.execPath, [verifyScript], 'Post-adoption schema verification');
  console.log(
    baselineApplied
      ? 'Prisma baseline was already adopted; deploy and verification are clean.'
      : 'Prisma baseline adoption completed and verified.',
  );
} finally {
  await sql.end();
}
