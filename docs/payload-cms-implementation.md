# Payload CMS service implementation

| Field | Value |
| --- | --- |
| Status | Foundation implemented; content migration pending |
| Implemented | 2026-07-14 |
| CMS runtime | Payload 3.86.0, Next.js 16.2.10, Node.js 24 |
| Structured store | Dedicated PostgreSQL 17 database |
| Media store | Private S3-compatible MinIO bucket |

## Architecture now present

The repository contains a separately deployable [`cms/`](../cms/) service. It owns its Payload configuration, generated types and PostgreSQL schema, reversible migrations, production image, authorization rules, and acceptance tests. It is not colocated with the application frontend.

The top-level Docker Compose stack adds:

- `cms`: Payload REST, GraphQL, upload, and Admin routes;
- `cms-db`: the separate `worldcms` PostgreSQL database;
- `cms-storage`: S3-compatible object storage;
- `cms-storage-init`: idempotent private-bucket creation; and
- `cms_private`: an internal-only Docker network.

Payload, its database, and object storage publish no host ports. The Nest backend joins both the ordinary application network and `cms_private`; the frontend does not join the private network and receives no CMS URL or credential. The Admin UI therefore requires an explicit private operator access path and is not available through the public application ports.

## Schema workflow

The PostgreSQL adapter contains literal, unconditional `push: false`. Model changes are represented by checked-in TypeScript migrations and snapshots:

1. `20260714_230614_initial_schema`
2. `20260714_230652_add_world_summary`
3. `20260714_234515_add_media_storage_prefix`

The third migration was generated while promoting the PoC to Payload 3.86.0 and adds the S3 adapter's media prefix column. Its `down` migration removes that column.

The CMS verification commands enforce:

- Docker/network policy and absence of published CMS infrastructure ports;
- current generated Payload types and PostgreSQL schema;
- absence of collection-model drift without a migration;
- migration status; and
- a production Next/Payload build.

The GitHub workflow at [`.github/workflows/cms.yml`](../.github/workflows/cms.yml) recreates the stack with empty volumes, waits for health, checks migration status, and executes the acceptance suite.

## Authorization boundary

Auth0 remains canonical. The CMS custom strategy accepts an Auth0 subject only when the request also carries the private service credential. Payload then applies workspace access rules independently. This is defense in depth; Nest is still responsible for validating the external Auth0 token and deriving application capabilities before constructing CMS actor context.

The Nest [`ContentRepository`](../backend/src/cms/content.repository.ts) is an application-owned boundary. Its initial Payload implementation maps CMS responses into application DTOs and supplies actor context without exporting Payload types into public contracts. Existing content endpoints have not yet been cut over to this repository.

## Media behavior

The Payload S3 adapter stores media under the `media/` prefix in a private bucket. `disablePayloadAccessControl` is not enabled, so requests continue through Payload and collection read rules. The browser never receives MinIO credentials or a directly reachable object-store endpoint.

The clean-stack acceptance run demonstrated:

- authenticated multipart generated-image upload into the S3 bucket;
- persisted purpose, tags, and generation provenance;
- anonymous and wrong-workspace asset responses of 403;
- owning-workspace response of 200 with exact byte fidelity;
- Auth0 actor propagation and server-side workspace assignment;
- exact Lexical JSON round trips;
- a depth-2 world containing 12 locations and 24 characters;
- 27.2 ms p95 across 20 warm local representative reads; and
- a successful production Admin render.

The test object was independently listed at `worldcms-media/media/...png`, confirming that the adapter did not fall back to CMS-local disk.

## Local startup

Copy the CMS variables from the root [`.env.example`](../.env.example) into the ignored root `.env`, replace every placeholder, then run:

```text
docker compose up --build cms
```

There is intentionally no host URL for Payload. Use `docker compose exec cms ...` for verification. If an operator needs the Admin UI, use a separately reviewed loopback-only port-forward or private access proxy; do not add a committed `ports` mapping.

Useful commands from `cms/`:

```text
npm run verify:policy
npm run verify:generated
npm run verify:migrations
npm run migrate:status
npm run build
```

## Remaining migration work

This change establishes the Phase 1 service boundary; it does not move production content. Follow-up work must:

- expand the model to campaigns, sessions, organizations, events, items, documents, tags, and generation records with reviewed migrations;
- implement create/update/media methods and contract tests on `ContentRepository`;
- route content APIs and generation persistence through the repository behind a feature flag;
- inventory and idempotently migrate existing PostgreSQL, upload, browser-local, and LevelGraph content;
- add MIME sniffing, upload limits, quarantine/virus scanning, checksums, lifecycle processing, backups, restore tests, and object reconciliation; and
- replace the static internal token with a short-lived signed assertion or mutually authenticated service transport.

The current production dependency audit reports seven moderate findings and no high or critical findings. Most originate in Payload's migration toolchain and Next's bundled PostCSS. Track upstream fixes and keep the CMS dependency set pinned and independently upgradeable.
