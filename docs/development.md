# Development configuration

Each application owns its environment file. The repository root `.env` is not
used by Turbo or Docker Compose.

| Application | Local file | Template |
| --- | --- | --- |
| NestJS API | `apps/backend/.env` | `apps/backend/.env.example` |
| Next.js UI | `apps/frontend/.env.local` | `apps/frontend/.env.local.example` |
| Payload CMS | `apps/cms/.env` | `apps/cms/.env.example` |

Some internal credentials are intentionally repeated in the two applications
that use them: `CMS_INTERNAL_TOKEN` is shared by CMS and backend, and
`RULE_API_INTERNAL_TOKEN` is shared by backend and frontend. Keep each pair in
sync. Do not put either value in a `NEXT_PUBLIC_*` variable.

## Local development

Copy each template to its local filename and fill in credentials. Local CMS
dependencies need loopback-only port mappings, which repository policy requires
to remain uncommitted. Create `docker-compose.local.yml` with:

```yaml
services:
  cms-db-local:
    image: alpine/socat:1.8.0.3
    command: tcp-listen:5432,fork,reuseaddr tcp-connect:cms-db:5432
    ports:
      - "127.0.0.1:5433:5432"
    depends_on:
      cms-db:
        condition: service_healthy
    networks:
      - default
      - cms_private

  cms-storage-local:
    image: alpine/socat:1.8.0.3
    command: tcp-listen:9000,fork,reuseaddr tcp-connect:cms-storage:9000
    ports:
      - "127.0.0.1:9000:9000"
    depends_on:
      - cms-storage
    networks:
      - default
      - cms_private
```

The filename is ignored by Git. Then run:

```sh
pnpm run dev
```

This starts PostgreSQL and the private CMS dependencies through Docker, then
runs the three application development servers through Turbo. The UI is at
`http://localhost:3000`, Payload is loopback-only at `http://127.0.0.1:3100`,
and NestJS is at `http://localhost:8000`.

### Local Payload admin access

Payload's email/password login is disabled by default because application users
authenticate through the trusted Auth0 bridge. To use the loopback-only Payload
admin interface during local development, add the following to the ignored
`apps/cms/.env` file:

```dotenv
CMS_ENABLE_LOCAL_ADMIN=true
CMS_LOCAL_ADMIN_EMAIL=your-local-admin@example.test
CMS_LOCAL_ADMIN_PASSWORD=choose-a-long-local-only-password
```

Create or reset that local administrator, then restart the CMS development
server so its authentication configuration is reloaded:

```sh
pnpm --filter @world-building/cms admin:local
pnpm --filter @world-building/cms dev
```

Open `http://127.0.0.1:3100/admin` and sign in with those local credentials.
The mode is ignored when `NODE_ENV=production`, and Docker Compose explicitly
forces it off. Do not publish port 3100 or put these credentials in a tracked
environment file.

The preparation step stops only the frontend, backend, and CMS application
containers from a previous full Compose run. It does not remove containers,
images, networks, databases, storage, or volumes. The two local proxy containers
publish loopback access without changing or recreating the internal CMS network.

## Docker Compose

```sh
docker compose up --build
```

Compose loads the same app-owned env files. It overrides only URLs and model
paths that differ on the container network. Payload, its PostgreSQL database,
and S3-compatible storage remain unpublished on the internal `cms_private`
network; only NestJS can reach Payload.

## API pathing convention

Use path parameters for resource identity instead of query parameters or
action-specific top-level paths.

General rules:

- Anchor each API at its owning aggregate resource.
- Use hierarchical path parameters for child resources.
- Keep identifiers in the path, not in request bodies when the resource is
  already addressed by the URL.
- Reserve query parameters for filtering, pagination, sorting, and projection,
  not identity.

Encounter API rule (ownership-based):

- Encounter definition and authored artifact routes are encounter-owned:
  - `/encounters/:encId/maps/:mapId/drafts/:draftId`
  - `/encounters/:encId/maps/:mapId/revisions/:revisionId/artifacts/:artifactKind/:profile`
- Encounter runtime routes are session-owned:
  - `/sessions/:sessionId/encounters/:instanceId/snapshot`

Use this split to preserve has-a semantics:

- sessions have encounter instances;
- encounter definitions have maps, drafts, revisions, and compiled artifacts.

Identifier naming rule:

- Use `encId` for encounter definition identifiers.
- Use `instanceId` for session encounter runtime identifiers.
- Do not use `encId` to refer to runtime encounter instances.

When introducing new encounter-accessible artifact families, extend the
encounter-owned definition hierarchy instead of creating disconnected top-level
resource groups.

## API route PR checklist

Before merging endpoint changes, verify:

- Route identity uses path parameters.
- Route is anchored at the owning aggregate resource.
- Child resources follow hierarchical path segments.
- Query parameters are used only for filtering, pagination, sorting, or
  projection.
- Request bodies do not duplicate identifiers already present in the path.
- Encounter definition endpoints are encounter-owned and runtime endpoints are
  session-owned.
- Encounter runtime paths use `:instanceId` for instance identity, not
  `:encId`.
