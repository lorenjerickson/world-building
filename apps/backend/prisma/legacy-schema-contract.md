# Legacy application database contract

This file records database objects that must survive the TypeORM-to-Prisma
cutover. The contract was reconstructed on 2026-07-25 by applying the three
registered TypeORM migrations to PostgreSQL 17 and introspecting the result.

`schema.prisma` is intentionally mapped to the existing quoted camel-case
columns and snake-case table names. Phase 1 does not rename live columns.

## Prisma-managed structure

Prisma models all 14 application tables, their scalar columns, native
PostgreSQL types, defaults, ordinary indexes, unique constraints, and these
foreign keys:

| Child | Parent | Delete action |
|---|---|---|
| `rule_set_composition_members.compositionId` | `rule_set_compositions.id` | `CASCADE` |
| `rule_set_bindings.compositionId` | `rule_set_compositions.id` | `RESTRICT` |
| `rule_instances.bindingId` | `rule_set_bindings.id` | `CASCADE` |
| `rule_effects.bindingId` | `rule_set_bindings.id` | `CASCADE` |
| `rule_executions.bindingId` | `rule_set_bindings.id` | `CASCADE` |
| `rule_events.bindingId` | `rule_set_bindings.id` | `CASCADE` |
| `rule_continuations.executionId` | `rule_executions.id` | `CASCADE` |
| `artifact_rule_contexts.bindingId` | `rule_set_bindings.id` | `SET NULL` |
| `rule_authoring_proposals.sessionId` | `rule_authoring_sessions.id` | `CASCADE` |

All persisted date-time columns are `timestamptz(6)`. UUID primary-key defaults
are database-generated with `gen_random_uuid()`. Update timestamp fields keep
their database `now()` default and use Prisma's `@updatedAt` behavior for
Prisma writes.

The TypeORM-owned `migrations` table remains intentionally outside the Prisma
model. It is historical adoption metadata, not application data. The adoption
command leaves it in place when Prisma's `_prisma_migrations` table is
introduced.

## Raw SQL invariants for the Prisma baseline

Prisma 5.22 does not represent the following check constraints. The checked-in
baseline migration includes them verbatim and the compatibility verifier checks
for them:

| Constraint | Allowed values |
|---|---|
| `rule_set_bindings_scopeType_check` | `world`, `campaign`, `session` |
| `rule_set_bindings_status_check` | `active`, `migrating`, `disabled` |
| `rule_executions_status_check` | `pending`, `committed`, `rejected`, `failed` |
| `rule_continuations_status_check` | `pending`, `resolved`, `expired`, `cancelled` |
| `artifact_rule_contexts_applicabilityStatus_check` | `applicable`, `adaptable`, `legacy-visible`, `profile-hidden`, `invalid` |
| `rule_authoring_sessions_status_check` | `active`, `completed`, `cancelled`, `expired` |
| `rule_authoring_proposals_status_check` | `proposed`, `accepted`, `partially-accepted`, `discarded`, `stale` |
| `rule_definition_snapshots_reason_check` | `autosave`, `manual`, `restore`, `import` |

Prisma 5.22 also cannot represent this partial unique index:

```sql
CREATE UNIQUE INDEX "UQ_rule_set_binding_active_scope"
  ON "rule_set_bindings" ("scopeType", "scopeId")
  WHERE "active" = true;
```

The index is an intentional domain invariant: a scope may have multiple named
profile rows, but only one row may be active across the scope. It is not
equivalent to the separate
`("scopeType", "scopeId", "gameplayProfileName")` unique constraint. The
baseline retains both.

The `worlds` table comment
`world-building migration 1784077200000` is legacy ownership metadata. It is
not required by Prisma Client, but the baseline/adoption verifier should retain
it so the old migration's guarded rollback semantics remain explainable.

## Clean database deployment

The reviewed baseline is
`prisma/migrations/20260725190000_application_baseline/migration.sql`.
Apply it to an empty database with:

```bash
DATABASE_URL=postgresql://... \
  pnpm --filter @world-building/backend prisma:migrate:deploy

DATABASE_URL=postgresql://... \
  pnpm --filter @world-building/backend prisma:migrate:status

DATABASE_URL=postgresql://... \
  pnpm --filter @world-building/backend prisma:verify-legacy
```

Despite its historical name, `prisma:verify-legacy` verifies either a
Prisma-created database, a TypeORM-created database before adoption, or an
adopted database. Without a fixture flag, it is read-only.

## Application startup

The committed Compose topology runs the one-shot `backend-migrate` service
before starting `backend`. The migration service uses the same production image
as the application, waits for PostgreSQL health, and runs only
`prisma migrate deploy`. A failed migration prevents the backend process from
starting.

The production image contains the Prisma schema and checked-in migrations,
generates Prisma Client for its Linux runtime, and has no source-code bind mount
that can mask the packaged artifacts. Verify the complete empty-volume and
failure-gate path with:

```bash
pnpm --filter @world-building/backend smoke:production
```

Local `pnpm dev` generates Prisma Client and runs `prisma migrate deploy` after
starting the development databases. Use `prisma:migrate:dev` only when
intentionally authoring a new local migration; shared and production startup
must continue to use `prisma:migrate:deploy`.

## Release verification

The same complete backend database gate used by CI is available locally:

```bash
PRISMA_RELEASE_DATABASE_URL=postgresql://worldbuilder:password123@127.0.0.1:5432/postgres \
  pnpm verify:backend-release
```

The command format-checks and validates the schema, generates Prisma Client,
builds and unit-tests the backend, verifies clean migration and PostgreSQL
runtime behavior, creates and adopts a representative pre-Prisma database,
compares both database contracts, and runs the production-image smoke test.

It creates only uniquely named `wb_prisma_verify_*` databases and removes them
on exit. Remote hosts are rejected unless
`PRISMA_RELEASE_ALLOW_REMOTE=1` explicitly confirms that the server is
disposable. Never point this command at a shared or production PostgreSQL
server.

## Existing TypeORM database adoption

Adoption adds Prisma migration metadata without executing the baseline's
`CREATE` statements against existing tables.

1. Take and verify a restorable database backup.
2. Stop application writes for the adoption window.
3. Run the read-only preflight:

   ```bash
   DATABASE_URL=postgresql://... \
     pnpm --filter @world-building/backend prisma:verify-legacy
   ```

4. If and only if the preflight passes, run:

   ```bash
   DATABASE_URL=postgresql://... \
     pnpm --filter @world-building/backend prisma:adopt-baseline \
     --apply --backup-confirmed
   ```

`--backup-confirmed` is an operator assertion; the command does not create a
backup. The command refuses to run without both confirmation flags, without the
three exact TypeORM migration records, with missing or changed schema
invariants, or when Prisma history exists without the expected baseline. It
then marks the baseline applied, runs `prisma migrate deploy`, checks migration
status, and repeats the read-only contract verification. Re-running it after a
successful adoption is safe and idempotent.

The legacy `migrations` table is retained beside `_prisma_migrations`.

## Disposable verification

Against a disposable database representing the historical pre-Prisma schema:

```bash
pnpm --filter @world-building/backend prisma:generate
pnpm --filter @world-building/backend build

DATABASE_URL=postgresql://... \
  node apps/backend/scripts/create-legacy-schema-fixture.mjs

DATABASE_URL=postgresql://... \
  pnpm --filter @world-building/backend prisma:verify-legacy --seed-fixture
```

The command:

- compares Prisma model table and column names with PostgreSQL;
- confirms only the intentionally unmanaged `migrations` table appears in a
  Prisma schema diff;
- verifies all check constraints, the active-binding partial index, foreign-key
  delete actions, timestamp types, and the `worlds` comment.

`--seed-fixture` additionally inserts and exercises representative rows in all
14 application models through Prisma Client. `--exercise-fixture` re-exercises
already seeded rows after adoption.

To compare every application column, constraint, index, default, and comment
between two databases:

```bash
LEGACY_DATABASE_URL=postgresql://... \
PRISMA_DATABASE_URL=postgresql://... \
  pnpm --filter @world-building/backend prisma:compare-contracts
```

The fixture writes only its own fixed IDs and is intended solely for a
disposable database. Never pass `--seed-fixture` or `--exercise-fixture` for a
shared environment.
