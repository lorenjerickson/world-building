# Build context: repo root

# ── Stage 1: install dependencies ────────────────────────────────────────────
FROM node:24-bookworm-slim AS dependencies
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/cms/package.json ./apps/cms/
COPY packages/common/package.json ./packages/common/
RUN pnpm install --filter=@world-building/cms... --frozen-lockfile

# ── Stage 2: build ────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/apps/cms/node_modules ./apps/cms/node_modules
COPY --from=dependencies /app/packages/common/node_modules ./packages/common/node_modules
COPY apps/cms/ ./apps/cms/
COPY packages/common/ ./packages/common/
ENV NEXT_TELEMETRY_DISABLED=1
# Dummy build-time secrets (Payload requires them even during next build)
ENV PAYLOAD_SECRET=payload-cms-build-only-secret
ENV CMS_DATABASE_URL=postgresql://unused:unused@127.0.0.1:1/unused
ENV S3_ACCESS_KEY_ID=build-only-access-key
ENV S3_SECRET_ACCESS_KEY=build-only-secret-key
ENV S3_BUCKET=build-only-bucket
ENV S3_ENDPOINT=http://127.0.0.1:9000
RUN pnpm --filter=@world-building/cms... build

# ── Stage 3: runtime ──────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS runtime
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/apps/cms ./apps/cms
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/common/package.json ./packages/common/package.json
COPY --from=build /app/packages/common/dist ./packages/common/dist
EXPOSE 3000
WORKDIR /app/apps/cms
CMD ["sh", "-c", "pnpm migrate && pnpm start:container"]
