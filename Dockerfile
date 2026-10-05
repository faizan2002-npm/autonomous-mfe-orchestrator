# Multi-stage build for the Autonomous MFE Orchestrator API Gateway
# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@9

# Copy package files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

# Copy all packages and apps
COPY packages ./packages
COPY apps/api-gateway ./apps/api-gateway
COPY .npmrc .npmrc

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build shared packages first, then gateway
RUN pnpm --filter @orchestrator/shared-types build
RUN pnpm --filter @orchestrator/database build
RUN pnpm --filter @orchestrator/core build
RUN pnpm --filter @orchestrator/crypto build
RUN pnpm --filter @orchestrator/config build
RUN pnpm --filter @orchestrator/adapter-runtime build
RUN pnpm --filter @orchestrator/gemini-client build
RUN pnpm --filter @orchestrator/upstream-client build
RUN pnpm --filter api-gateway build

# Stage 2: Runtime
FROM node:20-alpine

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init curl

# Install pnpm
RUN npm install -g pnpm@9

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Copy from builder: only production dependencies
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/packages ./packages
COPY --from=builder --chown=nodejs:nodejs /app/apps/api-gateway/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/apps/api-gateway/package.json ./package.json

# Copy .env.example for reference (not used at runtime)
COPY --chown=nodejs:nodejs .env.example .env.example

USER nodejs

EXPOSE 4000 9090

# Health check (liveness probe)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:4000/health/live || exit 1

# Use dumb-init to properly handle signals (SIGTERM for graceful shutdown)
ENTRYPOINT ["/usr/sbin/dumb-init", "--"]

CMD ["node", "dist/main.js"]
