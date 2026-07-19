# Build context: repo root
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate

# ── deps: install with frozen lockfile ────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/frontend/package.json ./apps/frontend/
RUN pnpm install --filter=@world-building/frontend --frozen-lockfile

# ── dev: hot-reload target used by docker compose ────────────────────────────
FROM base AS dev
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/frontend/package.json ./apps/frontend/
RUN pnpm install --filter=@world-building/frontend --frozen-lockfile
COPY apps/frontend/ ./apps/frontend/
ENV NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000
ENV PORT=3000
WORKDIR /app/apps/frontend
CMD ["pnpm", "exec", "next", "dev", "--hostname", "0.0.0.0"]

# ── builder: production build ─────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/frontend/node_modules ./apps/frontend/node_modules
COPY apps/frontend/ ./apps/frontend/
RUN mkdir -p apps/frontend/public
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app/apps/frontend
RUN pnpm build

# ── runner: minimal production image ─────────────────────────────────────────
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

RUN mkdir -p apps/frontend/.next && chown nextjs:nodejs apps/frontend/.next

# Requires output: 'standalone' in next.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/apps/frontend/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/frontend/.next/static ./apps/frontend/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/frontend/public ./apps/frontend/public

USER nextjs
EXPOSE 3000
ENV PORT=3000
WORKDIR /app/apps/frontend
CMD HOSTNAME="0.0.0.0" node server.js
