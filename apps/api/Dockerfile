FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.30.0 --activate

# ── Build stage ──────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app

# Copy workspace-level files first (pnpm + turbo)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./

# Copy all packages (shared, db) — needed for workspace: dependencies
COPY packages/ ./packages/

# Copy the API app
COPY apps/api/ ./apps/api/

# Install dependencies (frozen lockfile for reproducibility)
RUN pnpm install --frozen-lockfile

# Build shared packages first, then the API
RUN pnpm --filter @finsentinel/shared build && \
    pnpm --filter @finsentinel/db build && \
    pnpm --filter @finsentinel/api build

# ── Production dependencies ──────────────────────────────────────────────
FROM base AS deps
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/ ./packages/
COPY apps/api/package.json ./apps/api/package.json

RUN pnpm install --frozen-lockfile --prod

# ── Runtime stage ────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

# Copy production node_modules
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages ./packages

# Copy built API dist
COPY --from=builder /app/apps/api/dist ./dist

EXPOSE 3001

CMD ["node", "dist/main.js"]
