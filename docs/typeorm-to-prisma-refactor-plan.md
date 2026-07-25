---
title: "TypeORM-to-Prisma backend refactor assessment and completion plan"
created: "2026-07-25"
last_updated: "2026-07-25"
completion_status: complete
disposition: unknown
---

# TypeORM-to-Prisma backend refactor assessment and completion plan

| Field | Value |
|---|---|
| Audited | 2026-07-25 |
| Repository revision | `bf03031` (`basic refactoring`) |
| Scope | `apps/backend`, backend database deployment, and backend tests |
| Overall status | Complete; Phases 1–6 verified |

## Executive assessment

The application-level query conversion is mostly complete. Nest now provides a
global `PrismaService`, and the known PostgreSQL consumers for worlds, rule-set
compositions and bindings, and rule-definition snapshots use Prisma. No
`TypeOrmModule`, `InjectRepository`, `InjectDataSource`, or TypeORM repository is
wired into the current Nest application.

Phase 1 establishes and verifies the physical legacy schema contract. The
Prisma schema uses the existing quoted camel-case columns, native PostgreSQL
types, defaults, indexes, and foreign-key actions. Unsupported check constraints
and the active-binding partial unique index are recorded as mandatory raw SQL
invariants.

Phase 2 adds a reviewed Prisma baseline and a fail-closed adoption command.
Clean deployment, legacy adoption with representative data, catalog parity,
idempotent reruns, and clean migration status all pass on PostgreSQL 17.

Phase 3 makes multi-record writes atomic, serializes concurrent snapshot
retention, maps Prisma failures to stable public errors, and makes Prisma
`bigint` values JSON-safe. Unit and PostgreSQL-backed runtime tests pass.

Phase 4 makes Prisma generation deterministic in workspace and container builds,
packages the schema and migrations in the production image, and gates backend
startup on a successful one-shot `prisma migrate deploy` job.

Phase 5 adds one local/CI release command that verifies schema formatting,
generation, build, unit and PostgreSQL runtime tests, clean migration, legacy
adoption with data, catalog parity, and the production image.

Phase 6 removes the TypeORM packages and executable source surface. The
historical adoption path remains covered by a programmatic pre-Prisma database
fixture, while Prisma is now the sole runtime ORM and application migration
system.

A useful high-level estimate is:

| Workstream | Assessment |
|---|---|
| Nest provider/runtime wiring | Complete |
| Conversion of known TypeORM query consumers | Complete |
| Prisma physical model | Phase 1 complete; verified against the TypeORM schema |
| Migration-history ownership | Phase 2 complete; Prisma baseline checked in |
| Existing-data upgrade path | Phase 2 complete; fail-closed adoption verified |
| Production build/startup integration | Phase 4 complete; empty and failure paths verified |
| Runtime test coverage | Phase 5 complete; enforced by backend CI |
| TypeORM removal | Phase 6 complete; historical references only |

The database migration-history, runtime-safety, delivery-integration, CI release
gates, and final ORM cleanup are verified.

## Phase 1 result

Phase 1 was completed on 2026-07-25 against a disposable PostgreSQL 17 database:

- all three registered TypeORM migrations applied successfully;
- a representative fixture covered all 14 application tables, JSON values,
  nullable fields, timestamps, relationships, and `bigint` values above
  JavaScript's safe-integer limit;
- Prisma read and updated every representative row;
- nested Prisma relation reads verified all nine legacy foreign keys;
- the database-to-datamodel diff contained only
  `DROP TABLE "migrations"`, which is expected because the historical TypeORM
  migration table is intentionally outside the Prisma application model; and
- the verifier confirmed eight check constraints, the active-binding partial
  unique index, all timestamp types, and the guarded `worlds` table comment.

The repeatable artifacts are:

- `apps/backend/prisma/schema.prisma`;
- `apps/backend/prisma/legacy-schema-contract.md`;
- `apps/backend/prisma/fixtures/pre-prisma-representative-data.sql`; and
- `apps/backend/scripts/verify-prisma-legacy-contract.mjs`.

## Phase 2 result

Phase 2 was completed on 2026-07-25 using separate disposable PostgreSQL 17
databases for the clean and legacy paths:

- `20260725190000_application_baseline` creates all 14 application tables and
  preserves the raw SQL invariants recorded in Phase 1;
- `prisma migrate deploy` succeeds from empty, reports no pending migrations on
  a second run, and has clean migration status;
- the clean Prisma database and TypeORM-created database have matching
  application columns, types, defaults, constraints, indexes, and comments;
- the adoption command requires explicit apply and backup confirmations, runs a
  read-only preflight, marks the baseline applied, deploys later migrations,
  checks status, and verifies the schema again;
- all representative IDs, JSON content, nullable values, relationships,
  timestamps, and `bigint` values survived adoption;
- a second adoption run is idempotent; and
- adoption refused both a Prisma-only database and an intentionally drifted
  TypeORM database, without creating Prisma migration metadata on the drifted
  target.

The Phase 2 artifacts are:

- `apps/backend/prisma/migrations/20260725190000_application_baseline/migration.sql`;
- `apps/backend/scripts/adopt-prisma-baseline.mjs`; and
- `apps/backend/scripts/compare-prisma-database-contracts.mjs`.

## Phase 3 result

Phase 3 was completed on 2026-07-25 with unit and PostgreSQL 17 integration
coverage:

- composition headers and ordered members are created by one atomic nested
  Prisma transaction;
- a concurrent duplicate composition request returns the unique-constraint
  winner, preserving content-addressed idempotency;
- an intentionally invalid nested member write leaves no partial composition;
- snapshot capture and pruning run in one transaction under a
  definition-scoped PostgreSQL advisory lock;
- 60 concurrent snapshot writes retain exactly 50 rows;
- Prisma unique, relation, not-found, transaction-conflict, and connection
  errors map to stable public error codes without database details;
- a global response interceptor converts nested `bigint` values to decimal
  strings while preserving dates and JSON shapes;
- the world-deletion test now uses the Prisma contract and verifies graph
  cleanup precedes row deletion; and
- the backend unit suite passes 52/52 tests and the PostgreSQL runtime suite
  passes 4/4 tests.

The Phase 3 artifacts include:

- `apps/backend/src/database/prisma-exception.filter.ts`;
- `apps/backend/src/database/prisma-response.interceptor.ts`; and
- `apps/backend/test/prisma-runtime.test.js`.

## Phase 4 result

Phase 4 was completed on 2026-07-25 with workspace and container verification:

- backend workspace builds and local development startup explicitly generate
  Prisma Client after the schema is available;
- local development runs `prisma migrate deploy` after its databases become
  healthy;
- the production image contains the Prisma schema, baseline migration, runtime
  Prisma Client and native engine, and the Prisma deployment CLI;
- the application source bind mount no longer masks the packaged production
  artifacts;
- Compose runs the one-shot `backend-migrate` service after PostgreSQL health
  and starts `backend` only after migration success;
- a no-cache image build and empty-volume startup completed successfully;
- migration status in the running image reported the database up to date;
- a Prisma-seeded world was updated through the production HTTP API; and
- an intentionally unreachable migration database caused startup to fail while
  the backend container remained unstarted.

The Phase 4 artifacts include:

- `apps/backend/Dockerfile`;
- `docker-compose.yml`;
- `apps/backend/scripts/smoke-production-compose.mjs`; and
- the application-startup runbook in
  `apps/backend/prisma/legacy-schema-contract.md`.

## Phase 5 result

Phase 5 was completed on 2026-07-25 with a locally reproducible GitHub Actions
gate:

- `pnpm verify:backend-release` format-checks and validates the Prisma schema,
  regenerates Prisma Client, builds the backend, and runs all 52 unit tests;
- the command creates uniquely named clean and legacy databases on an explicitly
  disposable PostgreSQL server and removes them on success or failure;
- the clean path deploys every Prisma migration, checks status, verifies schema
  drift and representative rows, and runs all four PostgreSQL runtime tests;
- the legacy path creates the frozen pre-Prisma schema and historical migration
  records, seeds and exercises all 14 application models, compares the physical
  database contract, adopts the Prisma baseline, re-verifies data and
  relationships, checks status, and compares the adopted contract again;
- remote database hosts are rejected unless the operator explicitly marks the
  server disposable;
- the final gate builds and smoke-tests the production image, including
  migration-before-start and the migration-failure startup block;
- Docker-assigned ephemeral ports make the smoke test safe on shared CI runners;
  and
- the backend now exposes a standard `test` script, so the root Turbo test graph
  discovers and runs the backend unit suite.

The Phase 5 artifacts are:

- `.github/workflows/backend-prisma.yml`; and
- `apps/backend/scripts/verify-prisma-release.mjs`.

## Phase 6 result

Phase 6 was completed on 2026-07-25 after the Phase 5 release gate passed:

- `@nestjs/typeorm` and `typeorm` were removed from the backend package and
  workspace lockfile;
- the TypeORM data source, entity registry, 14 entity declarations, migration
  registry, three released migration classes, and reverted placeholder were
  deleted;
- the release gate now creates a frozen historical pre-Prisma database fixture
  directly from the reviewed physical baseline and the three released
  migration-history records;
- the adoption preflight, representative data exercise, contract comparison,
  and Prisma baseline resolution remain unchanged;
- current architecture and design documents describe Prisma as the application
  persistence implementation; and
- repository searches find no TypeORM imports, installed packages, executable
  configuration, or commands.

The Phase 6 compatibility artifact is
`apps/backend/scripts/create-legacy-schema-fixture.mjs`.

## Evidence from the current tree

### Completed work

- `apps/backend/src/app.module.ts` imports `PrismaModule` instead of configuring
  `TypeOrmModule`.
- `apps/backend/src/database/prisma.service.ts` owns connection startup and
  shutdown.
- `GenerateService` uses `prisma.world` for create, read, update, and delete.
- `CompositionManifestService` uses Prisma for compositions, members, and
  bindings.
- `RuleDefinitionSnapshotService` uses Prisma for capture, retention, listing,
  and retrieval.
- `apps/backend/prisma/schema.prisma` defines 14 models corresponding to the 14
  legacy TypeORM entities.
- The schema maps to the physical camel-case legacy columns, models all nine
  foreign keys, and preserves `timestamptz(6)` and database UUID defaults.
- `prisma:verify-legacy` checks physical parity and exercises every model.
- `prisma validate` succeeds.
- `pnpm --filter @world-building/backend build` succeeds with the locally
  generated Prisma client.

### Incomplete or unsafe work

1. **Prisma migration history: resolved in Phase 2.**

   The reviewed application baseline is checked in under
   `apps/backend/prisma/migrations/`.

2. **Empty database startup integration: resolved in Phase 4.**

   Docker Compose and root development startup run
   `prisma:migrate:deploy`. CI integration remains Phase 5 work.

3. **Legacy physical-schema mismatch: resolved in Phase 1.**

   The Prisma schema now uses the quoted camel-case columns created by TypeORM
   and was exercised against a migrated legacy fixture.

4. **Legacy database semantics: modeled or explicitly recorded in Phase 1.**

   Prisma models the foreign keys, delete behavior, native timestamp types, and
   ordinary indexes. Check constraints and the partial unique index are
   documented and verified as mandatory raw SQL for the Phase 2 baseline.

5. **Deterministic Docker generation and packaging: resolved in Phase 4.**

   The schema is copied before installation and generation, generation runs in
   the build and production stages, and the no-cache production smoke test
   proves the Linux client and engine work without workspace artifacts.

6. **Backend runtime tests and CI integration: resolved in Phases 3 and 5.**

   The unit suite and PostgreSQL-backed converted-service suite pass. Phase 2
   scripts also verify clean migration, representative TypeORM adoption,
   status, and drift. The Phase 5 release command and backend GitHub Actions
   workflow enforce all of these checks, and the root `test` graph includes the
   backend unit suite.

7. **TypeORM source and dependencies: resolved in Phase 6.**

   No executable backend source, dependency, command, entity, or migration
   class references TypeORM. Historical compatibility language and migration
   metadata remain only where they explain adoption of existing databases.

8. **Clean and legacy database verification: resolved in Phases 1–2.**

   Disposable PostgreSQL 17 databases provide verification evidence for clean
   Prisma deployment, TypeORM-created schema adoption, catalog parity, data
   preservation, idempotency, and fail-closed drift handling.

## Recommended completion strategy

Use Prisma as the sole runtime ORM and sole owner of future application schema
migrations, while preserving the existing database in place. Do not use
`prisma db push`, do not drop/recreate an existing database, and do not silently
rename live columns as part of the ORM switch.

The safest first cutover is to make Prisma describe the existing physical
camel-case schema. A later, separately reviewed migration can rename columns to
snake case if that normalization is still desirable.

### Phase 1: Establish the physical schema contract

Implementation status: complete on 2026-07-25.

1. Start a disposable PostgreSQL database and apply all registered TypeORM
   migrations to create the authoritative legacy fixture.
2. Add representative rows for every table used by the converted services,
   including JSON values, timestamps, `bigint` versions, nullable fields, and
   related records.
3. Introspect the fixture and compare it with `schema.prisma`.
4. Update `schema.prisma` to map Prisma field names to the actual quoted
   camel-case columns. Retain `@@map` for the existing snake-case table names.
5. Add Prisma relations and explicit referential actions where Prisma supports
   the existing foreign keys.
6. Record check constraints, the partial unique index, timestamp types, and any
   other unsupported Prisma constructs as raw SQL requirements for the
   baseline migration.
7. Decide explicitly whether the active-binding partial unique index is the
   intended invariant; do not accidentally replace it with the different
   three-column unique constraint already represented in the Prisma model.

Exit criteria:

- [x] Prisma can read and update every representative legacy row.
- [x] A database-to-datamodel diff contains no unintended table/column changes.
- [x] Every legacy foreign key, unique/index rule, check constraint, default, and
  timestamp type has a documented Prisma or raw-SQL owner.

### Phase 2: Create a reviewed Prisma baseline and adoption path

Implementation status: complete on 2026-07-25.

1. Create a named baseline under `apps/backend/prisma/migrations/`.
2. Make its `migration.sql` build the complete application schema on an empty
   database, including constraints Prisma cannot express.
3. Apply the baseline with `prisma migrate deploy` to a clean database and run
   `prisma migrate status`.
4. Compare the clean Prisma-created database to the legacy TypeORM-created
   fixture. Resolve every unintended difference.
5. Document and automate adoption for existing environments:

   - back up and verify the target database;
   - confirm the three released TypeORM migrations and physical schema are
     present;
   - run a read-only schema/drift preflight;
   - mark the Prisma baseline applied with `prisma migrate resolve --applied`
     only after that preflight succeeds; and
   - run `prisma migrate deploy` and `prisma migrate status`.

6. Leave the old TypeORM `migrations` metadata table in place during the
   transition. Prisma uses `_prisma_migrations`, so deletion is unnecessary and
   would discard useful audit history.

Exit criteria:

- [x] `prisma migrate deploy` succeeds from empty and status reports no pending
  migrations.
- [x] Adoption preserves all representative legacy rows and constraints.
- [x] Re-running deploy is idempotent.
- [x] The baseline-resolve procedure fails closed when the legacy schema is
  incomplete or different.

### Phase 3: Make runtime operations safe and behaviorally equivalent

Implementation status: complete on 2026-07-25.

1. Put composition creation and member insertion in a single Prisma
   transaction so a member failure cannot leave a partial composition.
2. Review snapshot create/prune behavior and use a transaction if strict
   retention is required under concurrent writes.
3. Add stable handling/tests for Prisma errors:

   - not found;
   - unique conflicts;
   - foreign-key violations;
   - connection failure; and
   - transaction retry/rollback behavior.

4. Verify API serialization of Prisma `bigint`, `Decimal` if later introduced,
   JSON null values, and timestamps before returning model objects from
   controllers.
5. Correct the world-deletion unit test to use a Prisma-shaped mock and add
   focused tests for all converted services.

Exit criteria:

- [x] All backend unit and PostgreSQL runtime tests pass.
- [x] Failure-path tests prove that multi-table writes are atomic.
- [x] Public API responses remain compatible with the pre-refactor contract.

### Phase 4: Integrate generation, deploy, and startup

Implementation status: complete on 2026-07-25.

1. Replace the ambiguous scripts with explicit commands such as:

   - `prisma:generate`: `prisma generate`;
   - `prisma:migrate:dev`: `prisma migrate dev`;
   - `prisma:migrate:deploy`: `prisma migrate deploy`; and
   - `prisma:migrate:status`: `prisma migrate status`.

2. Ensure code generation runs after `schema.prisma` is present in local,
   workspace, and Docker build contexts.
3. Rework and test the Docker stages so the production image contains the
   generated client, native engine for the runtime platform, schema, and
   migration files.
4. Add a one-shot backend migration job (or equivalent release step) that runs
   `prisma migrate deploy` before the backend starts. Do not use `migrate dev`
   or `db push` in shared or production environments.
5. Make backend startup depend on successful migration completion and database
   health.
6. Add a container smoke test that starts from an empty volume, migrates,
   starts the production image, and exercises a Prisma-backed endpoint.

Exit criteria:

- [x] A no-cache production image builds without pre-existing workspace
  `node_modules` or generated Prisma artifacts.
- [x] The empty-volume Compose path initializes and starts successfully.
- [x] A migration failure prevents application startup.

### Phase 5: Add CI release gates

Implementation status: complete on 2026-07-25.

Add a backend database workflow that:

1. validates and formats the Prisma schema;
2. generates the client from scratch;
3. builds the backend;
4. runs unit tests;
5. applies all Prisma migrations to clean PostgreSQL;
6. confirms migration status has no pending migrations;
7. runs database integration tests;
8. upgrades a checked-in or programmatically created legacy TypeORM fixture;
9. verifies row counts, stable IDs, JSON content, relationships, and
   constraints after adoption; and
10. builds and smoke-tests the production image.

Expose a backend `test` script or update the root pipeline so the backend suite
cannot be skipped by `pnpm test`.

Exit criteria:

- [x] CI fails for stale generated-client output, missing migrations, schema drift,
  failed legacy adoption, or a broken production image.
- [x] The same verification command can be run locally.

### Phase 6: Remove TypeORM

Implementation status: complete on 2026-07-25.

Only after the clean-install and legacy-upgrade gates pass:

1. Delete the TypeORM data source, entity registry, entity classes, migration
   registry, migration implementations, and reverted placeholder.
2. Remove `@nestjs/typeorm` and `typeorm` from
   `apps/backend/package.json`, then refresh `pnpm-lock.yaml`.
3. Remove stale TypeORM commands and documentation. Update documents that still
   describe TypeORM as the current backend persistence layer, especially
   `docs/payload-cms-implementation.md` and
   `docs/realtime-multiplayer-design.md`.
4. Run a repository-wide TypeORM search; remaining mentions should be
   explicitly historical migration documentation only.
5. Run the complete build, test, migration, adoption, and container suite.

Exit criteria:

- [x] No executable backend code or installed backend dependency references
  TypeORM.
- [x] Prisma is the only runtime ORM and application migration system.
- [x] Existing environments and clean installs reach the same verified schema
  without data loss.

## Suggested implementation order

1. Fix physical schema parity before generating any migration.
2. Create and verify the baseline plus existing-database adoption.
3. Fix tests and transactional behavior.
4. Make code generation and migration deployment deterministic in Docker and
   development.
5. Add CI gates.
6. Remove TypeORM only after both database paths pass.

The sequencing rule was followed: TypeORM cleanup occurred only after clean and
legacy database paths passed. The frozen legacy fixture and historical migration
records continue to verify adoption without retaining the old ORM runtime.

## Final completion checklist

- [x] Prisma schema matches the legacy TypeORM physical schema in the Phase 1 fixture.
- [x] Reviewed Prisma baseline is checked in.
- [x] Clean database migration passes.
- [x] Legacy TypeORM database adoption passes without data loss.
- [x] Migration status is clean in both paths.
- [x] Converted service integration tests pass against PostgreSQL.
- [x] Backend unit tests pass, including the corrected world-deletion test.
- [x] Multi-table writes are transactional.
- [x] Production Docker image generates/packages Prisma deterministically.
- [x] Deployment runs `prisma migrate deploy` before backend startup.
- [x] CI enforces schema, migration, upgrade, test, and container gates.
- [x] TypeORM code and dependencies are removed.
- [x] Persistence documentation describes Prisma as the current implementation.
