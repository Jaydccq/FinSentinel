FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.30.0 --activate

# ── Build stage ──────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app

ARG INTERNAL_API_ORIGIN=http://localhost:3001
ENV INTERNAL_API_ORIGIN=${INTERNAL_API_ORIGIN}
ENV INTERNAL_API_BASE_URL=${INTERNAL_API_ORIGIN}

# Copy workspace-level files first
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./

# Copy all packages (shared) — needed for workspace: dependencies
COPY packages/ ./packages/

# Copy the web app
COPY apps/web/ ./apps/web/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build shared packages first, then the web app
RUN pnpm --filter @finsentinel/shared build && \
    pnpm --filter @finsentinel/web build

# ── Runtime stage ────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ARG INTERNAL_API_ORIGIN=http://localhost:3001
ENV INTERNAL_API_ORIGIN=${INTERNAL_API_ORIGIN}
ENV INTERNAL_API_BASE_URL=${INTERNAL_API_ORIGIN}

# Copy the standalone Next.js output
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

ENV NODE_ENV=production
ENV HOSTNAME="0.0.0.0"
EXPOSE 3000

# Next.js standalone output produces a server.js at the app root
CMD ["node", "apps/web/server.js"]
