# Repository Agent Guidance

These instructions apply to the entire repository. More specific `AGENTS.md` files may add constraints but must not weaken these requirements.

## Frontend visual consistency

- New pages and setup flows must use the frontend's established visual system from `apps/frontend/app/globals.css`; do not ship ad hoc inline page, form, input, panel, or button styling.
- Before implementing or reviewing a frontend page, inspect the nearest analogous production page and reuse shared layout and control classes such as `dashboard-container`, `dashboard-header`, `card-surface`, `rule-set-field`, `rule-set-form-actions`, `primary-action`, and `secondary-action` where appropriate.
- Encounter authoring pages are part of the main authenticated application and must visually match the dashboard and other authoring flows. Functional acceptance is incomplete when an encounter page renders as an unstyled prototype.

## Payload CMS PostgreSQL schema policy

When Payload CMS is added, PostgreSQL schema changes must be explicit, reviewable, and reproducible. Drizzle schema push is prohibited in this repository, including local development.

### Required configuration

- Configure Payload's `postgresAdapter` with `push: false` as a literal value.
- Do not make `push` conditional on `NODE_ENV`, an environment variable, a command-line flag, or any other runtime setting.
- Do not introduce scripts, one-off commands, test setup, or documentation that enables `push: true` or relies on Payload/Drizzle push to synchronize a database.
- Shared, test, preview, staging, and production environments must apply checked-in Payload migrations before starting the application.

Expected configuration:

```ts
postgresAdapter({
  pool: {
    connectionString: process.env.CMS_DATABASE_URL,
  },
  push: false,
})
```

### Every content-model change requires a migration

A change to a Payload collection, global, field, relationship, index, localization setting, versions/drafts configuration, upload configuration that affects the database, or reusable field factory is incomplete until its database migration is checked in.

For every such change, agents must:

1. Update the Payload configuration in code.
2. Generate a named migration with the repository's Payload migration command.
3. Inspect the generated migration and correct unsafe or destructive SQL.
4. Add explicit data backfills or transformations when existing records require them.
5. Ensure the migration has valid `up` and `down` behavior. If a change cannot be reversed without data loss, document that fact in the migration and use an expand/backfill/contract sequence instead of silently discarding data.
6. Regenerate and check in Payload and database types/schemas produced by the repository's generation commands.
7. Commit the model configuration, migration, and generated artifacts together.
8. Apply all migrations to a clean PostgreSQL database and run the relevant build and tests before declaring the work complete.
9. Run migration status and confirm there are no unapplied or untracked schema changes.

Do not hand-edit Payload's managed database schema as a substitute for a migration. Do not use `migrate:fresh`, `migrate:reset`, database drops, or other destructive commands against an existing environment unless the user explicitly requests and approves that operation.

### Required enforcement when bootstrapping `cms/`

The first change that introduces the Payload service must also add automated enforcement. At minimum, CI and the CMS verification script must fail when:

- the PostgreSQL adapter does not contain literal `push: false`;
- `push: true` appears in executable CMS configuration;
- generated Payload/database types are stale;
- checked-in migrations do not apply successfully to an empty PostgreSQL database;
- migration status reports pending migrations after setup; or
- a content-model change is present without a corresponding checked-in migration.

Prefer a repository script such as `npm run cms:verify-schema` that performs these checks identically in local development and CI. Add that command to the required CMS build/test workflow.

### Agent completion gate

Before completing any task that touches the Payload model or PostgreSQL adapter, explicitly report:

- that `push: false` remains literal and unconditional;
- the migration file created or updated;
- the generated types/schema refreshed;
- the clean-database migration result; and
- the migration-status result.

If any item cannot be completed, the task is not complete. Report the blocker instead of suggesting that schema push can be used temporarily.

## Payload CMS network isolation policy

Payload's REST API, GraphQL API, Local API bridge endpoints, static/upload routes, and management interface must not be publicly reachable. NestJS is the only application service permitted to call Payload over the container network.

### Required Docker topology

When bootstrapping `cms/`, agents must:

- attach Payload, its PostgreSQL database, and local S3-compatible object storage to a dedicated Docker network configured with `internal: true`;
- attach NestJS to that private network as the application gateway;
- omit `ports` for the Payload container in committed Docker Compose and deployment configuration;
- use `expose` only when documenting the container port for private service discovery;
- never bind Payload to `0.0.0.0` on a host-published port;
- keep the CMS database and private object-storage administration/API ports unpublished as well; and
- configure Nest to reach Payload by its private service DNS name, never through a public URL.

The Next.js frontend and browser code must not call Payload directly or receive CMS service credentials. Public application content requests go to NestJS or an existing Next.js route that proxies to NestJS.

### Management access

- The Payload management interface must be disabled in environments where it is not required, or protected behind a private operator-only access path such as a VPN, identity-aware proxy, or SSH/port-forward session.
- Do not publish the management interface merely to simplify development. If direct local access is necessary, use an uncommitted developer override that binds only to `127.0.0.1`, contains no production credentials, and cannot be selected in CI, preview, staging, or production.
- Network isolation does not replace Payload authentication or access control. Keep both enabled as defense in depth.

### Required enforcement when bootstrapping `cms/`

The first Payload service change must add an automated Docker/network policy check. CI must fail if committed deployment configuration:

- publishes a Payload, CMS database, or private object-storage management port;
- omits the internal CMS network;
- makes the frontend depend on a Payload public URL; or
- contains browser-exposed CMS service credentials.

Before completing a task that changes CMS deployment or connectivity, agents must report the network-policy verification result and identify the only services that can reach Payload.
