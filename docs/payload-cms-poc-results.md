# Payload CMS proof of concept

| Field | Result |
| --- | --- |
| Date | 2026-07-14 |
| Scope | The pre-migration proof requested by the CMS market survey |
| Implementation | [`poc/payload-cms`](../poc/payload-cms/) |
| Verdict | **Conditional pass; retain Payload, deploy it separately, and upgrade from the tested dependency set** |

## 1. Decision

The PoC validates Payload's architectural fit. It demonstrates code-defined content models and reversible PostgreSQL migrations, Auth0-derived actor propagation, workspace isolation, authorized media delivery, multipart generated-image upload with metadata, lossless Lexical rich-text transport, representative nested content reads, and a production Admin UI build. It also proves that Payload and its database can run on an internal Docker network without publishing host ports.

At the time of this run, Payload 3.84.0 was the newest tested release whose `@payloadcms/next` peer range accepted the project's then-current Next.js 16.2.2. The combination built and ran, but `npm audit` reported known high-severity advisories in both Next.js 16.2.2 and Payload 3.84.0. Current Payload installation guidance requires a newer patched Next.js release. Therefore:

1. keep Payload as a separately versioned `cms` service behind NestJS;
2. upgrade that service to a mutually compatible, non-vulnerable Next/Payload pair before production implementation;
3. do not colocate Payload with the existing frontend until the frontend is independently upgraded and this suite passes again; and
4. make a clean audit and the checks in this PoC release gates.

This is a dependency-version constraint, not a failure of Payload's content, authorization, upload, or migration model. Follow-up release `v0.1.1` upgraded the application frontend to Next.js 16.2.10. The separate CMS implementation subsequently repeated and passed this suite with Payload 3.86.0, Next.js 16.2.10, PostgreSQL 17, and private S3-compatible storage. See [Payload CMS service implementation](./payload-cms-implementation.md).

## 2. Tested stack and compatibility

The project frontend pinned Next.js 16.2.2, React 19.2.4, and TypeScript 6.0.2 when this PoC was executed. The PoC used those exact versions with Payload 3.84.0; release `v0.1.1` subsequently upgraded the frontend to Next.js 16.2.10.

| Check | Evidence | Result |
| --- | --- | --- |
| Production compilation | `next build`; all Admin, REST, and GraphQL routes emitted | Pass |
| Type checking | TypeScript 6.0.2 completed during `next build` | Pass with one local declaration shim for Payload's side-effect CSS import |
| Production Admin render | `GET /admin` returned 200 and 43,051 bytes; first local render 519.8 ms | Pass |
| Container Admin render | Clean container `GET /admin` returned 200 and 43,062 bytes | Pass |
| Build footprint | `.next` 48,596 KiB; `.next/static` 3,064 KiB across 64 files | Informational baseline, not a browser-transfer measurement |
| Newer Payload compatibility | `npm view @payloadcms/next@3.86.0 peerDependencies` requires Next `>=16.2.6 <17`; 3.84.0 accepts 16.2.2 | Colocation blocked until Next is upgraded |
| Dependency audit | 17 findings: 1 low, 7 moderate, 9 high, 0 critical | Production blocker for this pinned stack |

The CSS declaration shim only supplies TypeScript with a declaration for `@payloadcms/next/css`; it does not replace or alter the Admin stylesheet. Its necessity should be retested after upgrading Payload and Next.

## 3. Acceptance evidence

The automated harness is [`scripts/run-poc.ts`](../poc/payload-cms/scripts/run-poc.ts). It exercises the production REST server and uses the Local API only to arrange isolated test fixtures. The captured run is reproducible with `npm run test:poc` after migrations and the production server are running.

| Requirement | Demonstration | Result |
| --- | --- | --- |
| Code-only schema change | Added required `worlds.summary` in TypeScript; generated and checked in `20260714_230652_add_world_summary` | Pass |
| Rollback | `migrate:down` removed `worlds.summary` and `_worlds_v.version_summary` while retaining the base tables; reapplying restored both | Pass |
| Auth0 identity propagation | A trusted custom strategy mapped `x-auth0-sub` to a Payload user only when accompanied by the internal service token | Pass |
| Server-side actor scope | Submitted content received the actor's workspace server-side rather than trusting a client workspace value | Pass |
| Private asset authorization | Anonymous 403; different workspace 403; owning workspace 200 | Pass |
| Multipart generated-image ingestion | One authenticated multipart request persisted PNG bytes plus purpose, tags, provider, model, prompt hash, and correlation ID | Pass |
| Asset fidelity | Authorized response bytes exactly matched the uploaded PNG | Pass |
| Rich-text round trip | Submitted Lexical JSON and REST response were deeply equal | Pass |
| Representative nested content | One world populated 12 locations and 24 characters at relationship depth 2 | Pass |
| Query behavior | 20 warm local REST reads; p95 25.8 ms; 77,785-byte response | Pass against PoC thresholds of 250 ms and 1 MB |
| Cross-workspace content isolation | A user in another workspace received 404 for the world | Pass |

The latency figure is a single-machine functional baseline, not a capacity result. Production design still needs load tests, query telemetry, explicit pagination/projections, and an agreed service-level objective.

## 4. Migration and schema controls

The adapter contains literal, unconditional `push: false`. The PoC checks in:

- the initial schema migration and snapshot;
- the additive `world.summary` up/down migration and snapshot;
- Payload-generated TypeScript types; and
- Payload's generated PostgreSQL schema.

`npm run verify:generated` regenerates both artifacts and fails if either was stale. `npm run verify:policy` rejects `push: true`, a missing literal `push: false`, published CMS/database ports, a non-internal Docker network, or failure to exclude `.env` from the image build context. `npm run cms:verify-schema` composes those gates with migration status and the production build.

A uniquely named Docker Compose project was started with new volumes. Startup applied both migrations to the empty PostgreSQL 17 database: the initial schema in 140 ms and the summary migration in 2 ms. `migrate:status` then reported both as batch 1, ran `Yes`, with no pending migration.

## 5. Network and authorization boundary

[`compose.yml`](../poc/payload-cms/compose.yml) places Payload and PostgreSQL on `cms_private` with `internal: true`. Neither service has a `ports` entry. Runtime inspection reported empty `Ports` and `Publishers` arrays for both containers. Payload listens on `0.0.0.0:3000` only inside that network; the local non-container scripts bind it to `127.0.0.1:3100`.

The Auth0 check intentionally models the proposed NestJS boundary: Nest validates the external Auth0 token, then sends an actor subject over the private service network with a service credential. The PoC proves identity propagation and Payload's independent workspace access rules. It does **not** replace Nest's JWT verification, credential rotation, replay controls, or transport authentication. Production should use a short-lived signed service assertion or mutually authenticated transport rather than a long-lived static header token.

The Admin UI remains part of the private Payload service. Operators should reach it only through the private access method described in the market survey; it must not be exposed by the public Nest API.

## 6. Deliberate limits and remaining Phase 0 work

This targeted PoC answers the two quoted pre-migration questions. It does not claim all ten broader acceptance criteria in the market survey are complete. Before migrating production content, Phase 0 must still prove:

- S3-compatible storage and signed/revocable delivery rather than the PoC's private local upload volume;
- user-uploaded maps as well as generated portraits, public derivative caching, and media lifecycle/orphan handling;
- generated Payload types consumed through the actual Nest `ContentRepository` adapter;
- a reviewed breaking data migration with representative existing rows;
- version restore, trash/soft-delete behavior, idempotent legacy import, and migration reconciliation with LevelGraph;
- metadata/object backup and restore with missing-counterpart detection; and
- production-scale load, query-count, failure, retry, and timeout tests.

## 7. Reproduction

From `poc/payload-cms`, copy `.env.example` to `.env`, provide an isolated PostgreSQL database, and run:

```text
npm ci
npm run verify:policy
npm run migrate
npm run verify:generated
npm run build
npm run start
npm run test:poc
npm run migrate:status
```

The clean private-network proof uses `docker compose up --build`. It publishes no endpoint to the host; inspection and tests must run from a container attached to `cms_private`.

## 8. Sources

- [Payload installation and supported Next.js versions](https://payloadcms.com/docs/getting-started/installation)
- [Payload custom authentication strategies](https://payloadcms.com/docs/authentication/custom-strategies)
- [Payload collection access control](https://payloadcms.com/docs/access-control/collections)
- [Payload upload collections](https://payloadcms.com/docs/upload/overview)
- [Payload Local API access behavior](https://payloadcms.com/docs/local-api/access-control)
- [Payload PostgreSQL migrations](https://payloadcms.com/docs/database/migrations)
