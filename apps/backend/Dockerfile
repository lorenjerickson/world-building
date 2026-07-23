# Build context: repo root
# ── Stage 1: build ────────────────────────────────────────────────────────────
# Swap to nvidia/cuda image below for GPU support:
# FROM nvidia/cuda:12.4.1-devel-ubuntu22.04 AS builder
FROM node:24-bookworm AS builder

# System dependencies for llama.cpp / node-gyp
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake g++ make python3 wget \
    && rm -rf /var/lib/apt/lists/*

# node-llama-cpp needs CMake >= 3.19
RUN wget -q https://github.com/Kitware/CMake/releases/download/v3.26.0/cmake-3.26.0-linux-x86_64.sh \
    && chmod +x cmake-3.26.0-linux-x86_64.sh \
    && ./cmake-3.26.0-linux-x86_64.sh --skip-license --prefix=/usr/local \
    && rm cmake-3.26.0-linux-x86_64.sh

RUN corepack enable && corepack prepare pnpm@10.13.1 --activate

WORKDIR /app

# Copy workspace manifests before source (layer-cache friendly)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/backend/package.json ./apps/backend/
COPY packages/common/package.json ./packages/common/

# Force node-llama-cpp to compile from source inside Linux
ENV NODE_LLAMA_CPP_SKIP_DOWNLOAD=true
# Uncomment to target CPU features like AVX2:
# ENV GGML_OPENMP=1

RUN pnpm install --filter=@world-building/backend... --frozen-lockfile

COPY apps/backend/ ./apps/backend/
COPY packages/common/ ./packages/common/
RUN pnpm --filter=@world-building/backend... build

# ── Stage 2: production runtime ───────────────────────────────────────────────
FROM node:20-bookworm-slim AS runner

RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.13.1 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/backend/package.json ./apps/backend/
COPY packages/common/package.json ./packages/common/
RUN pnpm install --filter=@world-building/backend... --frozen-lockfile --prod

COPY --from=builder /app/apps/backend/dist ./apps/backend/dist
COPY --from=builder /app/packages/common/dist ./packages/common/dist

ENV NODE_ENV=production
WORKDIR /app/apps/backend

EXPOSE 8000
CMD ["node", "dist/main"]
