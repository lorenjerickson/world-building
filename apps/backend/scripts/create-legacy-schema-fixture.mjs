import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = resolve(
  backendDir,
  'prisma/migrations/20260725190000_application_baseline/migration.sql',
);
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required.');
}

const legacyMigrations = [
  [1784077200000, 'AdoptWorldsSchema1784077200000'],
  [1784077260000, 'CreateRuleSetPersistence1784077260000'],
  [1784077320000, 'AddRuleDefinitionSnapshots1784077320000'],
];
const client = new Client({ connectionString: databaseUrl });

try {
  await client.connect();
  await client.query('BEGIN');
  await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  await client.query(await readFile(baselinePath, 'utf8'));
  await client.query(`
    CREATE TABLE "migrations" (
      "id" SERIAL NOT NULL,
      "timestamp" bigint NOT NULL,
      "name" varchar NOT NULL,
      CONSTRAINT "PK_8c82d7f526340ab734260ea46be" PRIMARY KEY ("id")
    )
  `);
  for (const [timestamp, name] of legacyMigrations) {
    await client.query(
      'INSERT INTO "migrations" ("timestamp", "name") VALUES ($1, $2)',
      [timestamp, name],
    );
  }
  await client.query('COMMIT');
  console.log('Historical pre-Prisma database fixture created.');
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
