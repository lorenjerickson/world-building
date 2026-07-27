---
title: "PostgreSQL-to-MongoDB suitability assessment and migration plan"
created: "2026-07-26"
last_updated: "2026-07-26"
completion_status: proposed
disposition: conditional-go
---

# PostgreSQL-to-MongoDB suitability assessment and migration plan

| Field | Value |
| --- | --- |
| Decision | Conditional go; migrate in bounded stages, not as a big-bang rewrite |
| Scope | Payload CMS persistence, NestJS application persistence, search, deployment, schema management, contracts, and source-data migration |
| Out of scope | Replacing Auth0, S3-compatible media storage, or the public NestJS API boundary |
| Current CMS store | Payload 3.86.0 on PostgreSQL 17 |
| Current application store | Prisma 5.22 on PostgreSQL/pgvector |
| Proposed store | MongoDB replica set, with separate CMS-owned and application-owned databases |
| Primary condition | MongoDB must preserve the current concurrency, uniqueness, idempotency, sequencing, authorization, and versioning guarantees |

## Executive decision

MongoDB is suitable for this application, but the reason is more specific than
"the data looks like JSON."

The strongest fit is authored content, immutable compiled artifacts, generated
world metadata, composition manifests, validation results, policies, patches,
and other values that are already represented as JSON. These values have a
natural aggregate boundary, are normally read as a whole, evolve through
explicit schema or metamodel versions, and benefit from being stored without a
large relational expansion into auxiliary tables.

The weakest fit is mutable runtime coordination state. Rule executions,
idempotency records, active bindings, ordered events, effects, continuations,
and snapshot retention currently depend on unique constraints, partial unique
indexes, transactions, foreign-key actions, and a PostgreSQL advisory lock.
MongoDB can implement these guarantees, but they do not appear automatically
just because the records become documents. They must be redesigned around
atomic aggregate updates, unique or partial indexes, optimistic concurrency,
and replica-set transactions.

The recommendation is therefore:

1. **Proceed with a production-representative MongoDB spike.**
2. **Migrate Payload CMS first** if adapter, drafts, versions, relationships,
   access control, and media acceptance tests pass without contract changes.
3. **Migrate document-oriented NestJS persistence next**, including generated
   worlds, immutable compositions and artifacts, authoring proposals, and
   snapshots.
4. **Migrate mutable rule-runtime state only after its concurrency gate passes.**
5. **Remove PostgreSQL only after dual-run verification, a cutover rehearsal,
   backup restoration, and rollback rehearsal pass.**

This is a conditional go rather than an unconditional mandate. PostgreSQL
already handles JSONB, transactions, relational integrity, and full-text
ranking well. If the spike cannot preserve runtime invariants or requires
materially weaker search, operations, or type safety, the correct outcome is to
retain PostgreSQL for application runtime state while still considering
MongoDB for Payload.

## Why consider the change now

The application has two PostgreSQL databases with different owners:

- Payload owns authored content, drafts, versions, relationships, users,
  workspaces, media metadata, encounter maps, and rule-set definitions.
- NestJS owns generated worlds, search documents, compiled composition state,
  mutable rule runtime state, authoring coordination, artifacts, and snapshots.

The current implementation evidence is:

- [`apps/cms/src/payload.config.ts`](../apps/cms/src/payload.config.ts);
- [`apps/backend/prisma/schema.prisma`](../apps/backend/prisma/schema.prisma);
- [`apps/backend/src/search/search.service.ts`](../apps/backend/src/search/search.service.ts);
- [`apps/backend/src/rules/releases/composition-manifest.service.ts`](../apps/backend/src/rules/releases/composition-manifest.service.ts);
- [`apps/backend/src/rules/catalog/rule-definition-snapshot.service.ts`](../apps/backend/src/rules/catalog/rule-definition-snapshot.service.ts);
- [`apps/backend/src/graph/graph.service.ts`](../apps/backend/src/graph/graph.service.ts); and
- [`docker-compose.yml`](../docker-compose.yml).

The recent Payload failure around `payload_locked_documents_rels` illustrates a
real cost of the relational mapping. Adding collections changed a polymorphic
relationship table, but the database migration did not initially accompany the
configured collections. MongoDB would not require a column addition for each
new relationship target.

That advantage is meaningful, but it does not eliminate schema management.
MongoDB uses a flexible physical schema by default; the application still needs
to control:

- required and optional fields;
- closed enums and discriminated unions;
- relationship identifiers;
- schema and metamodel versions;
- indexes and uniqueness;
- data transformations between versions;
- historical drafts and versions;
- API compatibility; and
- validation of old documents that coexist with new code.

MongoDB's own guidance recommends schema validation once an application has an
established structure, and supports JSON Schema-like validators for field types
and value ranges. See [MongoDB schema validation](https://www.mongodb.com/docs/manual/core/schema-validation/).

This document is an assessment and migration proposal, not authorization to
relax current repository policy. Until the MongoDB adapter is implemented and
approved, every Payload model change still requires a checked-in PostgreSQL
migration, refreshed generated artifacts, clean-database verification, and
migration-status verification. Payload `push: false` remains literal and
unconditional. Network-isolation requirements remain in force throughout and
after migration.

## Current-state inventory

### Payload CMS

Payload currently owns these collections:

- users and workspaces;
- media;
- worlds, locations, characters, campaigns, sessions, items, organizations,
  and events;
- encounter maps, drafts, revisions, and artifacts; and
- rule sets, modules, definitions, generation policies, releases, migrations,
  and documents.

Payload also owns internal documents for:

- draft/version history;
- locked documents;
- preferences;
- authentication sessions; and
- Payload migration history.

The application intentionally keeps Payload private. NestJS is the only
application service allowed to call it, and browser code receives neither a
Payload URL nor CMS credentials. This boundary must remain unchanged.

### NestJS application persistence

The Prisma schema contains 15 models:

- `World`;
- `SearchDocument`;
- `RuleSetComposition` and `RuleSetCompositionMember`;
- `RuleSetBinding`;
- `RuleInstance`;
- `RuleEffect`;
- `RuleExecution`;
- `RuleEvent`;
- `RuleContinuation`;
- `RuleArtifact`;
- `ArtifactRuleContext`;
- `RuleAuthoringSession`;
- `RuleAuthoringProposal`; and
- `RuleDefinitionSnapshot`.

Important physical invariants include:

- unique composition hashes within a workspace;
- unique member aliases and sort positions within a composition;
- one binding per scope/profile and one active binding per scope;
- command idempotency by binding, actor, and idempotency key;
- unique event sequence numbers within a binding;
- immutable artifact hashes;
- unique proposal hashes within an authoring session;
- foreign-key delete behavior;
- enum-like check constraints;
- transactionally created compositions and members;
- transactionally replaced search indexes;
- advisory-lock serialization of snapshot capture/pruning; and
- weighted PostgreSQL full-text search.

These are application requirements, not PostgreSQL implementation details.
Every one needs a MongoDB equivalent or an explicit design change.

### Other persistence

Generated world triples are also written to a local LevelGraph/LevelDB store.
The originating triples are copied into `World.metadata`, so PostgreSQL is
currently sufficient to reconstruct that graph.

This assessment does not recommend folding graph traversal into the initial
MongoDB migration. MongoDB supports `$graphLookup`, but that alone does not make
it a purpose-built graph database. The initial migration should keep
LevelGraph, move the source `World` documents to MongoDB, and verify graph
reconstruction. A later decision can either:

- retain LevelGraph as a derived local index;
- store edges in a `world_edges` MongoDB collection with traversal indexes; or
- adopt a production graph database if graph queries become a core workload.

Media bytes remain in private S3-compatible storage. Only media metadata moves.

## Suitability by workload

| Workload | MongoDB fit | Recommended model | Main caveat |
| --- | --- | --- | --- |
| Payload authored content | High | Keep Payload collection boundaries | Adapter migration must preserve drafts, versions, access control, and relationships |
| Rule definitions and policies | High | One document per definition/policy | Runtime validation and schema versions remain mandatory |
| Encounter canonical geometry | High | Metadata document plus S3 artifact | Do not embed artifacts that risk the BSON size limit |
| Generated worlds | High | One world document | Keep graph edges derived or separate |
| Immutable compositions | High | Embed bounded ordered members | Enforce aliases/order before write and validate the whole aggregate |
| Compiled artifacts | High | One immutable document per hash | Enforce content-addressed uniqueness |
| Authoring proposals | High | Separate proposal documents or bounded session subset | Avoid unbounded proposal arrays |
| Definition snapshots | High | One bounded history document per definition | Use atomic `$push`/`$slice` and retain at most 50 |
| Bindings, instances, and effects | Medium | Separate collections with explicit references | No foreign keys; consistency moves into application transactions and verification |
| Executions and continuations | Medium | Separate collections | Requires replica-set transactions and idempotency indexes |
| Ordered event stream | Medium | Separate event collection or bounded buckets | Atomic sequence allocation and unique sequence index are mandatory |
| Full-text search | Conditional | Dedicated search collection plus MongoDB Search | Atlas/Search deployment choice affects feature parity |
| LevelGraph triples | Low/conditional | Keep derived store initially | MongoDB is not automatically a graph-store replacement |

MongoDB advises embedding data that is read and updated together, while using
references for complex many-to-many relationships, large hierarchies, and
entities queried independently. See [reference-data guidance](https://www.mongodb.com/docs/manual/data-modeling/referencing/)
and [document relationship patterns](https://www.mongodb.com/docs/manual/applications/data-models-relationships/).

The target model deliberately does not embed an entire world, rule set, event
stream, or version history into one document. MongoDB documents have a 16 MiB
limit, and unbounded arrays are a documented anti-pattern. See
[avoid unbounded arrays](https://www.mongodb.com/docs/manual/data-modeling/design-antipatterns/unbounded-arrays/)
and [schema design anti-patterns](https://www.mongodb.com/docs/manual/data-modeling/design-antipatterns/).

## Target architecture

### Deployment boundary

Use one production MongoDB replica-set deployment with at least two logical
databases and separate credentials:

```text
MongoDB replica set
├── wanderlust_cms
│   └── owned only by Payload
└── wanderlust_app
    └── owned only by NestJS
```

The two databases may share the same cluster for operational simplicity, but
ownership remains separate:

- Payload credentials cannot read or write the Nest database.
- Nest application persistence credentials cannot mutate Payload collections.
- Nest's CMS integration still calls Payload's private API rather than reading
  Payload collections directly.
- The frontend has no MongoDB connectivity or credentials.
- MongoDB, Payload, and private object storage remain on the internal CMS
  network. MongoDB publishes no production host port.

A replica set is required even for local development. MongoDB transactions are
available on replica sets and sharded clusters, and Prisma's MongoDB connector
also requires a replica set for nested writes. See [MongoDB atomicity and
transactions](https://www.mongodb.com/docs/manual/core/write-operations-atomicity/)
and [Prisma's MongoDB connector requirements](https://docs.prisma.io/docs/orm/core-concepts/supported-databases/mongodb).

For local development, use a single-node replica set. Production should use a
managed replica set or a correctly operated multi-member replica set with
tested backup and restoration.

### Payload adapter

Payload 3.86 supports MongoDB through `@payloadcms/db-mongodb` and
`mongooseAdapter`. The adapter supports migrations, transaction options,
custom collection schema options, and optional preservation of supplied IDs.
See the [Payload MongoDB adapter documentation](https://payloadcms.com/docs/database/mongodb).

The target configuration should:

- use `mongooseAdapter`;
- require a MongoDB URL from a server-only environment variable;
- preserve the existing migration directory;
- keep transactions enabled;
- reject additional keys rather than enabling `allowAdditionalKeys`;
- make ID behavior an explicit migration decision;
- retain generated `payload-types.ts`;
- retain all access rules and internal-token authentication; and
- keep S3 storage configuration unchanged.

Payload's MongoDB migration model differs from PostgreSQL. Collection fields do
not normally require physical DDL, but existing documents still require
checked-in transformations when their shape or meaning changes. Payload
supports adapter-specific TypeScript `up` and `down` migrations. See
[Payload migrations](https://payloadcms.com/docs/database/migrations).

### NestJS persistence driver

Do not make Prisma's MongoDB connector the default target without a successful
toolchain spike.

Prisma can generate a type-safe MongoDB client, but:

- Prisma Migrate does not support MongoDB;
- schema changes use `db push`, which produces no reviewable migration history;
- MongoDB relations are application-level rather than database foreign keys;
- null and missing fields have different semantics that Prisma cannot fully
  express; and
- current Prisma documentation says MongoDB support for Prisma ORM v7 is still
  forthcoming and recommends Prisma 6.19 for MongoDB.

Those constraints conflict with this repository's preference for explicit,
reviewable, reproducible schema changes. See [Prisma's MongoDB connector
documentation](https://docs.prisma.io/docs/orm/core-concepts/supported-databases/mongodb).

The recommended NestJS target is:

- the official MongoDB Node.js driver;
- a small application-owned `MongoModule`;
- constructor-injected repositories behind application interfaces;
- explicit transaction/session helpers;
- checked-in collection-validator and index migrations; and
- domain/API contracts that do not expose driver types.

Mongoose is an acceptable alternative if a spike demonstrates better
maintainability, but the application must not couple public contracts to
Mongoose documents or Payload's internal Mongoose models.

### Target application collections

| PostgreSQL source | MongoDB target | Transformation |
| --- | --- | --- |
| `worlds` | `worlds` | Preserve UUID as string `_id`; keep prompt, generated content, metadata, and timestamps |
| `search_documents` | `search_documents` | Preserve logical keys; rebuild search index rather than migrating `tsvector` |
| `rule_set_compositions` + members | `rule_set_compositions` | Embed ordered, bounded `members` in the immutable composition document |
| `rule_set_bindings` | `rule_set_bindings` | Reference composition `_id`; preserve hash and optimistic `stateVersion` |
| `rule_instances` | `rule_instances` | Separate collection referenced by `bindingId` |
| `rule_effects` | `rule_effects` | Separate collection with target/expiry indexes |
| `rule_executions` | `rule_executions` | Separate collection with unique idempotency index |
| `rule_events` | `rule_events` | Separate unbounded stream with unique `(bindingId, sequence)` |
| `rule_continuations` | `rule_continuations` | Separate collection; optional TTL only after terminal-state retention policy is defined |
| `rule_artifacts` | `rule_artifacts` | Immutable document keyed by artifact hash or preserved UUID |
| `artifact_rule_contexts` | `artifact_rule_contexts` | Separate documents; references remain explicit and nullable |
| `rule_authoring_sessions` | `rule_authoring_sessions` | Preserve UUID `_id`, metadata, retention policy, and state |
| `rule_authoring_proposals` | `rule_authoring_proposals` | Separate collection to avoid an unbounded session array |
| `rule_definition_snapshots` | `rule_definition_histories` | Group by definition and store a bounded array of the newest 50 snapshots |

Use existing application UUIDs as string `_id` values during the API migration.
This avoids an unnecessary public identifier change and simplifies rollback.
Use BSON `Long` internally for current `bigint` state/sequence values, while
continuing to serialize them as decimal strings at the HTTP boundary.

### Required MongoDB indexes

At minimum, checked-in migrations must create:

- unique `(workspaceExternalId, compositionHash)` on compositions;
- unique `(scopeType, scopeId, gameplayProfileName)` on bindings;
- partial unique `(scopeType, scopeId)` where `active: true`;
- `(workspaceExternalId)` on bindings and compositions;
- `(bindingId, typeId)` on instances;
- `(bindingId, targetId)` and `(bindingId, expiresAt)` on effects;
- unique `(bindingId, actorId, idempotencyKey)` on executions;
- unique `(bindingId, sequence)` on events;
- `(executionId)` and `(status, expiresAt)` on continuations;
- unique `artifactHash` and unique `(releaseOrCompositionHash, engineVersion)`
  on artifacts;
- `(artifactId, compositionHash)` and `(generationJobId)` on artifact contexts;
- `(ruleSetId, draftId, actorId)` on authoring sessions;
- unique `(sessionId, proposalHash)` on proposals;
- unique `(ruleSetId, definitionId)` on definition histories; and
- unique `(actorId, recordType, recordId)` on search documents.

MongoDB supports unique compound and partial indexes. See [unique indexes](https://www.mongodb.com/docs/manual/core/index-unique/).

## Schema management and strongly typed contracts

### Principle: flexible storage, strict contracts

MongoDB must not become the source of truth for application types merely
because it accepts heterogeneous documents. The source of truth should be
versioned application contracts.

Use four mutually checked layers:

1. **Canonical domain schemas**
   - Define each persisted aggregate and API payload as a runtime-validatable,
     versioned schema.
   - Generate or infer TypeScript types from the same source.
   - Keep discriminators, enums, required fields, numeric bounds, and closed
     object behavior explicit.

2. **Boundary validation**
   - Validate every external request in NestJS.
   - Validate Payload-authored rule bodies before save and publication.
   - Validate every document read from MongoDB before it enters compiler or
     evaluator code.
   - Reject unknown schema versions instead of coercing them silently.

3. **MongoDB collection validators**
   - Check in `$jsonSchema` validators for application-owned collections.
   - Start migrated collections at `validationLevel: "moderate"` only during
     controlled import if legacy documents require it.
   - Move to strict/error validation before cutover.
   - Treat validator changes as migrations.

4. **Contract and drift tests**
   - Generate TypeScript artifacts and validators in CI.
   - Compare the expected index and validator manifest with a clean database.
   - Seed every supported schema version and validate round trips.
   - Prove public API responses are identical across PostgreSQL and MongoDB
     adapters.

Generated driver or Payload types are implementation aids, not public API
contracts. Public contracts remain application-owned and database-independent.
This preserves the existing rule-system principle that the browser must not
invent semantics from Payload fields.

Contract ownership should be explicit:

| Contract | Canonical owner | Generated/derived artifacts |
| --- | --- | --- |
| Public HTTP and realtime DTOs | Nest/application contract package | Frontend TypeScript types, request/response validators, API documentation |
| Rule language and compiled artifacts | Existing metamodel/compiler packages | Authoring descriptors, validators, compiler types |
| Payload collection records | Payload collection configuration | `payload-types.ts`; private CMS client mappings |
| Nest persisted aggregates | New storage-contract package | TypeScript types, runtime validators, MongoDB `$jsonSchema` validators |
| MongoDB driver models | Nest Mongo repository adapter | Internal collection/document helpers only |

The preferred implementation shape is a new
`packages/contracts` workspace package, or a clearly isolated contract surface
inside `packages/common`, with no imports from Prisma, Mongoose, Payload, or the
MongoDB driver. The spike should select a schema toolchain that can:

- infer strict TypeScript types;
- validate unknown runtime input;
- emit stable JSON Schema compatible with the supported MongoDB validator
  subset;
- express discriminated unions and closed objects;
- produce deterministic generated output; and
- run in Node.js and browser builds where the contract is shared.

The tool choice is secondary to those capabilities. Generated JSON Schema must
be reviewed and checked in; CI must fail when generation is stale.

### Document schema versions

Every application-owned MongoDB document should contain:

```json
{
  "schemaVersion": 1
}
```

Schema versions belong to storage shape. They are distinct from:

- rule metamodel versions;
- encounter artifact format versions;
- Payload draft/version numbers;
- compiler versions; and
- API versions.

Readers may temporarily support the current and immediately previous storage
version during an expand/backfill/contract migration. Writers emit only the
current version.

MongoDB documents can hold multiple schema versions during a rolling migration,
but readers then need explicit version-aware logic. See the [MongoDB schema
versioning pattern](https://www.mongodb.com/docs/manual/data-modeling/design-patterns/data-versioning/schema-versioning/).

### Application migration framework

Replace Prisma Migrate with a small checked-in application migration framework:

```text
apps/backend/src/database/migrations/
├── index.ts
├── 2026xxxx_create_collections.ts
├── 2026xxxx_create_validators.ts
├── 2026xxxx_create_indexes.ts
└── 2026xxxx_transform_<shape>.ts
```

Each migration records:

- stable name;
- checksum;
- `up`;
- `down`, or an explicit irreversible marker;
- preconditions;
- postconditions;
- data transformation counters; and
- minimum/maximum application versions that can read the result.

The runner uses a `schema_migrations` collection and a migration lease. It must:

- refuse checksum changes after a migration has run;
- run before application startup;
- execute transactional work in a session when supported;
- use resumable, idempotent batches for large transformations;
- expose status and drift commands;
- verify indexes and validators;
- fail application startup when required migrations are pending; and
- support a clean-database verification path in CI.

Do not substitute an automatic schema push for checked-in migrations.

### Concurrency contracts

MongoDB writes are atomic at the single-document level. Multi-document
transactions are available but cost more than well-designed aggregate writes.
The target design should first minimize transaction boundaries, then use
transactions where correctness spans documents.

Required translations include:

- **Composition creation:** embed members and create the immutable composition
  in one insert. A unique hash index selects the winner for concurrent
  identical requests.
- **Snapshot retention:** replace advisory locking with one history document per
  definition and one atomic `$push` using `$slice: -50`.
- **Optimistic state:** include `stateVersion` in update predicates and increment
  it atomically.
- **Execution idempotency:** rely on the unique idempotency index and return the
  existing winner.
- **Event sequencing:** allocate and persist sequence state atomically. If
  sequence allocation and event insertion are separate documents, perform both
  in a replica-set transaction.
- **Binding activation:** enforce the active-scope partial unique index and use a
  transaction when deactivating one binding and activating another.
- **Cascades:** implement explicit transactional deletes or asynchronous,
  idempotent cleanup jobs. MongoDB references do not provide PostgreSQL foreign
  keys or cascades.

## Search decision

The current search implementation uses a weighted PostgreSQL `tsvector`,
English tokenization, rank ordering, and actor isolation.

MongoDB's basic self-managed text index has meaningful restrictions, including
one text index per collection and limited sort behavior. MongoDB recommends its
Search indexes for richer search workloads. See [self-managed text index
restrictions](https://www.mongodb.com/docs/v8.0/core/indexes/index-types/index-text/text-index-restrictions/)
and [MongoDB Search overview](https://www.mongodb.com/docs/atlas/atlas-search/tutorial/build-applications/).

The migration has a product/operations decision:

- **Preferred:** use MongoDB Search with an index that preserves title,
  summary, and body weighting plus actor filtering.
- **Acceptable for local development:** use a basic compound text index and
  deterministic fallback sorting.
- **Alternative:** retain a dedicated search engine if self-hosting and search
  quality are both mandatory.

Search parity is a cutover gate. The team must compare relevance for a fixed
query corpus, not merely verify that some results are returned.

## Identifier strategy

Identifier changes are the largest cross-store contract risk.

Current Payload PostgreSQL IDs are numeric, and NestJS models currently store
some of those IDs as integers. Default MongoDB/Payload IDs are ObjectIds.

The migration should establish these rules before copying data:

1. Public and cross-store references use stable `externalId`, content hash,
   Auth0 subject, or another domain identifier.
2. Payload internal IDs are treated as opaque strings in NestJS contracts.
3. Every migrated Payload document receives a unique `legacyPostgresId`.
4. The migration records a durable map of:

   ```text
   collection + legacyPostgresId -> target MongoDB id + externalId
   ```

5. Relationships are rewritten through that map.
6. Existing API UUIDs are preserved as string MongoDB `_id` values.
7. Numeric Payload IDs remain accepted only in a time-bounded compatibility
   layer during migration.

Payload's MongoDB adapter can optionally accept supplied IDs on creation. That
may simplify migration, but it must be proven against relationships, versions,
locks, and Admin behavior before choosing numeric-ID preservation. The default
plan assumes target ObjectIds plus stable external identifiers.

## Data migration strategy

### Migration principles

- PostgreSQL remains authoritative until cutover.
- Every importer is idempotent and restartable.
- No transformation relies on table iteration order.
- Source and target IDs are mapped explicitly.
- Counts alone are not proof of correctness.
- Every exported record has a canonical hash.
- Media bytes are reconciled with object storage separately from metadata.
- Writes are paused for the final delta unless a tested change-capture path is
  active.
- PostgreSQL remains read-only and restorable for an agreed rollback window.

MongoDB Relational Migrator supports PostgreSQL snapshot jobs and modeling
transformations, but its jobs are non-idempotent by default. It may accelerate
the application-database backfill, but it does not replace application-specific
mapping, Payload version handling, or invariant verification. See [MongoDB
Relational Migrator data migration](https://www.mongodb.com/docs/relational-migrator/jobs/sync-jobs/).

The recommended baseline is repository-owned export/transform/import tooling.

### Phase 0: decision spike

Build a production-shaped spike before committing to the program:

- single-node replica set locally and production-equivalent managed replica set
  in a test environment;
- Payload MongoDB adapter with representative collections;
- drafts, versions, relationships, locks, Admin UI, access control, and S3;
- one rule definition with recursive trait JSON;
- one encounter map with artifact metadata;
- one immutable composition with embedded members;
- one binding/execution/event transaction;
- concurrent idempotent execution requests;
- 60 concurrent snapshot writes retaining exactly 50;
- active-binding uniqueness;
- search relevance corpus;
- backup and restore; and
- failure testing during primary election.

Exit gate:

- no public contract regression;
- all current acceptance and concurrency behaviors pass;
- p95 latency and write throughput remain within agreed budgets;
- a restore returns equivalent hashes and indexes; and
- the operational choice for MongoDB Search is accepted.

If the gate fails only for mutable runtime state, adopt the hybrid endpoint:
Payload on MongoDB and Nest runtime state on PostgreSQL.

### Phase 1: contract and repository preparation

Before data movement:

1. Introduce database-independent repository interfaces for every Prisma
   consumer.
2. Move Prisma-specific exception mapping behind the PostgreSQL adapter.
3. Define canonical runtime schemas and TypeScript types.
4. Change CMS identifiers in Nest contracts from `number` to opaque IDs or
   stable external IDs.
5. Add a storage `schemaVersion` to every application aggregate.
6. Add MongoDB repository implementations behind feature flags.
7. Add adapter parity tests that execute the same behavior against PostgreSQL
   and MongoDB.
8. Add metrics for reads, writes, mismatches, retries, transaction aborts, and
   migration lag.

No endpoint changes storage without a rollback-capable flag.

### Phase 2: MongoDB infrastructure and schema bootstrap

1. Add a private MongoDB replica-set service for local and CI use.
2. Add separate CMS and application users/databases.
3. Do not publish MongoDB ports in committed production Compose/deployment
   configuration.
4. Add health and replica-readiness checks.
5. Add the application migration runner.
6. Check in validators and indexes.
7. Apply all migrations to an empty database in CI.
8. Run migration status and drift checks.
9. Configure encrypted backups and complete a restore test.
10. Define capacity, oplog, monitoring, and alerting requirements.

### Phase 3: Payload CMS migration

Do not copy Payload PostgreSQL tables one-for-one. Those tables are an adapter
implementation, not the canonical CMS contract.

Build a versioned CMS export archive:

```text
cms-export/
├── manifest.json
├── id-map.ndjson
├── collections/<slug>.ndjson
├── versions/<slug>.ndjson
├── media.ndjson
├── preferences.ndjson
└── checksums.json
```

The export process:

1. Runs against a PostgreSQL snapshot.
2. Records Payload version, migration status, collection schemas, counts, and
   export time.
3. Exports current documents through Payload's Local API where possible.
4. Exports drafts and version history explicitly.
5. Replaces relationship IDs with stable source references.
6. Records publication/draft status and timestamps exactly.
7. Records media object keys, sizes, MIME types, and checksums without copying
   bytes unnecessarily.
8. Excludes ephemeral locks and authentication sessions.
9. Archives preferences separately because their internal references require
   target-ID rewriting.
10. Produces a canonical hash per record and per collection.

The import process:

1. Creates workspaces first.
2. Creates users and media metadata.
3. Imports independently rooted content.
4. Imports relationship-heavy content in dependency order.
5. Uses a second pass for cycles and optional relationships.
6. Imports rule sets, modules, definitions, policies, releases, migrations, and
   documents.
7. Imports encounter maps, drafts, revisions, and artifact metadata.
8. Reconstructs drafts and version history.
9. Rewrites preferences after target IDs exist.
10. Initializes MongoDB Payload migration history rather than copying
    PostgreSQL migration rows.
11. Reconciles every media record with the private S3 bucket.

Payload migration acceptance must verify:

- document and version counts;
- draft/published state;
- exact Lexical JSON and rule JSON;
- all relationship targets;
- workspace access isolation;
- Auth0 user resolution;
- immutable release behavior;
- private media authorization and byte checksums;
- Admin UI rendering;
- lock acquisition while editing a trait; and
- successful trait save, publication, and restore.

### Phase 4: NestJS application-data migration

Build a PostgreSQL extractor that reads a consistent snapshot and writes a
canonical NDJSON archive. Use Extended JSON conventions for dates and integers.

Transform in dependency order:

1. `worlds`;
2. immutable `rule_set_compositions` with embedded ordered members;
3. `rule_set_bindings`;
4. `rule_instances` and `rule_effects`;
5. `rule_executions`;
6. `rule_continuations` and `rule_events`;
7. `rule_artifacts`;
8. `artifact_rule_contexts`;
9. `rule_authoring_sessions` and proposals;
10. grouped `rule_definition_histories`; and
11. regenerated `search_documents`.

Transformation rules:

- preserve API UUIDs as string `_id`;
- convert `bigint` to BSON `Long`;
- preserve timestamps at millisecond precision and record any source precision
  truncation;
- preserve null separately from missing fields according to the canonical
  contract;
- preserve every JSON value without lossy coercion;
- embed composition members sorted by `sortOrder`;
- reject duplicate aliases or positions before import;
- group snapshots by definition, sort newest first, and retain exactly 50;
- verify all application-level references before insert;
- regenerate search text from canonical source records; and
- rebuild LevelGraph from migrated world metadata in a derived-data step.

The importer uses unordered bulk writes in bounded batches where safe and
transactions where multiple collections must become visible atomically.

### Phase 5: shadow traffic and synchronization

For the expected early-stage data volume, a planned write pause is safer than a
long-lived dual-write system. Use:

1. initial backfill while PostgreSQL remains authoritative;
2. shadow reads from MongoDB;
3. response normalization and hash comparison;
4. repair of all mismatches;
5. a short write pause;
6. final delta export/import;
7. final verification; and
8. feature-flag cutover.

If the required write-pause window is unacceptable, introduce a durable
PostgreSQL outbox before backfill:

- committed PostgreSQL writes enqueue canonical change events in the same
  transaction;
- a migrator applies those events idempotently to MongoDB;
- each target record stores the last source sequence;
- cutover waits for zero lag; and
- after cutover, a MongoDB change stream can feed a reverse journal during the
  rollback window.

MongoDB change streams require a replica set or sharded cluster and provide
resume tokens for durable consumption. See [MongoDB change streams](https://www.mongodb.com/docs/manual/changestreams/).

Do not implement synchronous best-effort dual writes without an outbox. A
request that succeeds in one database and fails in the other produces
unbounded, difficult-to-repair divergence.

### Phase 6: cutover

Cut over CMS and application persistence separately.

For each cutover:

1. Confirm recent PostgreSQL and MongoDB backups.
2. Put affected writes into maintenance mode.
3. Record source transaction/watermark positions.
4. Apply the final delta.
5. Run full counts, hashes, relationships, validators, indexes, and business
   invariant checks.
6. Run smoke and acceptance tests.
7. Switch the feature flag/configuration.
8. Resume writes.
9. Monitor error rate, latency, transaction aborts, replication health, search
   quality, and mismatch probes.
10. Keep PostgreSQL read-only during the rollback window.

Suggested order:

1. Payload CMS;
2. generated worlds and authoring history;
3. immutable compositions and artifacts;
4. search;
5. mutable runtime state; and
6. removal of PostgreSQL deployment components.

### Phase 7: rollback and retirement

Before the first production cutover, prove both rollback paths:

- **Before MongoDB accepts new authoritative writes:** switch the feature flag
  back to PostgreSQL.
- **After MongoDB accepts authoritative writes:** pause writes, replay the
  reverse journal/export into PostgreSQL, verify it, and then switch back.

Retire PostgreSQL only after:

- the rollback window expires;
- MongoDB backups and point-in-time restoration are proven;
- no mismatch alerts remain;
- all PostgreSQL-dependent release checks have MongoDB replacements;
- Prisma migrations and client generation are removed from startup;
- the application and CMS PostgreSQL volumes are archived according to policy;
- runbooks and disaster recovery documentation are updated; and
- a final signed migration report records counts, hashes, and exceptions.

Never destroy the PostgreSQL databases as part of cutover.

## Verification strategy

### Structural verification

- collection counts by type, workspace, status, and schema version;
- expected validators and validation modes;
- exact index keys, uniqueness, partial filters, and collation;
- no pending or checksum-mismatched migrations;
- no documents with unknown fields or schema versions;
- no dangling references; and
- no duplicate logical keys.

### Content verification

Canonicalize source rows and target documents into a shared representation,
then compare:

- per-record SHA-256;
- per-collection Merkle/root hash or sorted aggregate hash;
- JSON structures and array ordering;
- rich-text structures;
- dates and large integers;
- version history;
- immutable artifact and composition hashes;
- S3 object checksum and metadata; and
- LevelGraph reconstruction.

### Behavioral verification

Run the same API contract suite against both adapters:

- world create/read/update/delete;
- trait save and snapshot retention;
- draft validation and publication;
- immutable release rejection;
- concurrent identical composition creation;
- active binding transitions;
- idempotent command execution;
- ordered event append;
- continuation resolution/expiry;
- access isolation;
- search relevance; and
- error-code/HTTP response parity.

### Failure verification

- primary election during a transaction;
- duplicate-key races;
- transaction retry;
- network timeout;
- process termination during batched migration;
- resume after migration interruption;
- stale schema version;
- invalid document rejected by MongoDB validator;
- S3 metadata/object mismatch;
- backup restore; and
- rollback after post-cutover writes.

## CI and delivery changes

The MongoDB migration is incomplete until CI:

- boots a clean replica set;
- waits for primary election;
- applies checked-in CMS and application migrations;
- verifies migration status and checksums;
- verifies validators and indexes;
- loads representative documents for every collection and schema version;
- runs Payload acceptance tests;
- runs Nest unit, contract, concurrency, and migration tests;
- runs the PostgreSQL-to-MongoDB transformer against representative fixtures;
- compares canonical hashes;
- builds all production images;
- verifies MongoDB and Payload remain unpublished on the private network; and
- proves application startup fails when migrations are pending.

During transition, CI must run PostgreSQL and MongoDB adapters against the same
behavior suite.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Flexible schema creates silent drift | Invalid documents reach compiler/runtime | Runtime schemas, strict Mongo validators, checked-in migrations, read validation |
| Payload numeric IDs become ObjectIds | Broken relationships and API contracts | External IDs, opaque CMS IDs, durable ID map, two-pass import |
| Missing foreign keys/cascades | Orphans and partial cleanup | Transactional repository operations, reconciliation jobs, dangling-reference CI checks |
| Runtime transaction regression | Duplicate commands, events, or active bindings | Replica set, unique/partial indexes, transaction/concurrency gate |
| Unbounded embedded data | 16 MiB failures and degraded writes | Bounded arrays, subset pattern, separate event/proposal/history collections |
| Search quality regression | Poor global-search relevance | Fixed relevance corpus and MongoDB Search decision gate |
| Prisma MongoDB toolchain mismatch | Upgrade and migration dead end | Prefer official driver and application migration framework |
| CMS draft/version loss | Authoring history loss | Explicit version export/import and rehearsal hashes |
| Dual-write divergence | Uncertain source of truth | Durable outbox/change journal; never best-effort dual write |
| Operational complexity of replica sets | Local/CI instability and harder recovery | Replica-set health checks, managed production option, restore drills |
| Vendor dependence for advanced search | Cost or deployment constraint | Make search choice explicit; allow dedicated search engine |
| Graph behavior changes | Broken world traversal | Keep LevelGraph derived during initial migration |

## Estimated work

These are planning ranges, not commitments:

| Phase | Estimate | Exit artifact |
| --- | --- | --- |
| Decision spike | 1–2 weeks | Recorded go/hybrid/no-go decision |
| Contracts and repositories | 2–4 weeks | Adapter parity suite and opaque ID contracts |
| MongoDB infrastructure/migrations | 1–2 weeks | Clean replica-set deployment and drift gate |
| Payload migration tooling | 3–5 weeks | Rehearsed CMS archive/import with versions |
| Nest application migration | 4–8 weeks | All Prisma models transformed and verified |
| Shadow, rehearsal, and cutover | 2–4 weeks | Signed migration report and rollback proof |
| PostgreSQL retirement | 1–2 weeks after rollback window | Removed runtime dependency and archived sources |

The runtime-state phase is the largest uncertainty. Its estimate should be
revisited after the concurrency spike.

## Decision gates

### Gate A: approve MongoDB for Payload

Approve when:

- Payload adapter acceptance passes;
- drafts and versions migrate exactly;
- IDs and relationships have a stable strategy;
- Admin and access control behave identically;
- media remains private; and
- backup/restore is proven.

### Gate B: approve MongoDB for application documents

Approve when:

- canonical schemas generate TypeScript/runtime/Mongo validators;
- immutable aggregates and snapshots pass parity tests;
- migration/index drift is enforced in CI; and
- no public DTO depends on MongoDB types.

### Gate C: approve MongoDB for runtime state

Approve when:

- idempotency, active-binding uniqueness, event order, continuation state, and
  optimistic concurrency pass stress tests;
- transaction retry behavior is explicit;
- election/failure tests pass; and
- performance is within budget.

### Gate D: remove PostgreSQL

Approve only when:

- all prior gates pass;
- both production data stores have migrated and reconciled;
- search parity is accepted;
- reverse migration/rollback is proven;
- the rollback window has expired; and
- PostgreSQL-specific build, startup, CI, and operational paths have verified
  MongoDB replacements.

## Final recommendation

The application's authored and compiled artifacts are genuinely
document-oriented, and MongoDB can reduce the accidental relational complexity
visible in Payload's PostgreSQL mapping. The application is also early enough
that changing persistence now is less expensive than after the runtime event
and execution tables carry substantial production history.

Proceed with the spike and Payload-first migration. Treat a complete
PostgreSQL replacement as the intended destination, but keep the decision
reversible until mutable runtime-state tests pass. Preserve strong contracts by
moving them above the database adapter and reinforcing them below with MongoDB
validators and indexes. MongoDB should change the storage shape, not weaken the
rule language, API, authorization boundary, or correctness guarantees.
