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
