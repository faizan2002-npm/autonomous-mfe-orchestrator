# Multi-stage build for the Autonomous MFE Orchestrator API Gateway
# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

# Install pnpm (version from package.json's packageManager)
RUN npm install -g pnpm@9.12.0

# Workspace manifests and shared TypeScript config
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./

# Only the gateway and the packages it depends on
COPY packages ./packages
COPY apps/api-gateway ./apps/api-gateway

# The lockfile covers the whole workspace; projects not copied here are skipped.
# --ignore-scripts skips the root "prepare" (husky), which needs .git.
RUN pnpm install --frozen-lockfile --ignore-scripts

# Build the gateway and its workspace dependencies, then drop dev dependencies
RUN pnpm --filter "@orchestrator/gateway..." build
RUN pnpm prune --prod --ignore-scripts

# Stage 2: Runtime
FROM node:22-alpine

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init curl

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# pnpm links workspace packages and dependencies with relative symlinks, so the layout is kept.
COPY --from=builder --chown=nodejs:nodejs /app /app

USER nodejs

WORKDIR /app/apps/api-gateway

EXPOSE 4000 9090

# Health check (liveness probe)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:4000/health/live || exit 1

# Use dumb-init to properly handle signals (SIGTERM for graceful shutdown)
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

CMD ["node", "dist/main.js"]
