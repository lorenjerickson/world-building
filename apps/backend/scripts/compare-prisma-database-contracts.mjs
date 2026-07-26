import assert from 'node:assert/strict';
import { Client } from 'pg';
import { Prisma } from '@prisma/client';

const legacyDatabaseUrl = process.env.LEGACY_DATABASE_URL;
const prismaDatabaseUrl = process.env.PRISMA_DATABASE_URL;

if (!legacyDatabaseUrl || !prismaDatabaseUrl) {
  throw new Error('LEGACY_DATABASE_URL and PRISMA_DATABASE_URL are required.');
}

const tableNames = Prisma.dmmf.datamodel.models.map((model) => model.dbName ?? model.name);

function normalizeWhitespace(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : value;
}

function normalizeType(value) {
  return value.replace(/^timestamp\(\d+\) with time zone$/, 'timestamp with time zone');
}

function sortedRows(rows, keys) {
  return [...rows].sort((left, right) => {
    for (const key of keys) {
      const comparison = String(left[key]).localeCompare(String(right[key]));
      if (comparison !== 0) return comparison;
    }
    return 0;
  });
}

async function readContract(databaseUrl) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const columns = await client.query(
        `
          SELECT
            "tableClass"."relname" AS "table",
            "attribute"."attname" AS "column",
            format_type("attribute"."atttypid", "attribute"."atttypmod") AS "type",
            "attribute"."attnotnull" AS "notNull",
            pg_get_expr("defaultValue"."adbin", "defaultValue"."adrelid") AS "default"
          FROM "pg_class" AS "tableClass"
          JOIN "pg_namespace" AS "namespace"
            ON "namespace"."oid" = "tableClass"."relnamespace"
          JOIN "pg_attribute" AS "attribute"
            ON "attribute"."attrelid" = "tableClass"."oid"
          LEFT JOIN "pg_attrdef" AS "defaultValue"
            ON "defaultValue"."adrelid" = "tableClass"."oid"
            AND "defaultValue"."adnum" = "attribute"."attnum"
          WHERE "namespace"."nspname" = 'public'
            AND "tableClass"."relname" = ANY($1::text[])
            AND "attribute"."attnum" > 0
            AND NOT "attribute"."attisdropped"
        `,
        [tableNames],
      );
    const constraints = await client.query(
        `
          SELECT
            "tableClass"."relname" AS "table",
            "constraint"."conname" AS "name",
            "constraint"."contype" AS "kind",
            pg_get_constraintdef("constraint"."oid", true) AS "definition"
          FROM "pg_constraint" AS "constraint"
          JOIN "pg_class" AS "tableClass"
            ON "tableClass"."oid" = "constraint"."conrelid"
          JOIN "pg_namespace" AS "namespace"
            ON "namespace"."oid" = "tableClass"."relnamespace"
          WHERE "namespace"."nspname" = 'public'
            AND "tableClass"."relname" = ANY($1::text[])
        `,
        [tableNames],
      );
    const indexes = await client.query(
        `
          SELECT
            "tablename" AS "table",
            "indexname" AS "name",
            "indexdef" AS "definition"
          FROM "pg_indexes"
          WHERE "schemaname" = 'public'
            AND "tablename" = ANY($1::text[])
        `,
        [tableNames],
      );
    const comments = await client.query(
        `
          SELECT
            "tableClass"."relname" AS "table",
            obj_description("tableClass"."oid", 'pg_class') AS "comment"
          FROM "pg_class" AS "tableClass"
          JOIN "pg_namespace" AS "namespace"
            ON "namespace"."oid" = "tableClass"."relnamespace"
          WHERE "namespace"."nspname" = 'public'
            AND "tableClass"."relname" = ANY($1::text[])
        `,
        [tableNames],
      );

    return {
      columns: sortedRows(
        columns.rows.map((row) => ({
          ...row,
          type: normalizeType(row.type),
          default: normalizeWhitespace(row.default),
        })),
        ['table', 'column'],
      ),
      constraints: sortedRows(
        constraints.rows.map((row) => ({
          ...row,
          definition: normalizeWhitespace(row.definition),
        })),
        ['table', 'name'],
      ),
      indexes: sortedRows(
        indexes.rows.map((row) => ({
          ...row,
          definition: normalizeWhitespace(row.definition),
        })),
        ['table', 'name'],
      ),
      comments: sortedRows(comments.rows, ['table']),
    };
  } finally {
    await client.end();
  }
}

const [legacyContract, prismaContract] = await Promise.all([
  readContract(legacyDatabaseUrl),
  readContract(prismaDatabaseUrl),
]);

assert.deepEqual(
  prismaContract,
  legacyContract,
  'Clean Prisma and historical database contracts differ.',
);
console.log('Clean Prisma and historical database contracts match.');
