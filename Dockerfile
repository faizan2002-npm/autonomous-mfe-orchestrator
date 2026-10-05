# Multi-stage build for the Autonomous MFE Orchestrator API Gateway
# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@9

# Copy package files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./

# Copy all packages and apps
COPY packages ./packages
COPY apps/api-gateway ./apps/api-gateway
COPY .npmrc .npmrc

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build the gateway and every workspace package it depends on, in dependency order
RUN pnpm --filter "@orchestrator/gateway..." build

# Bundle the gateway with only its production dependencies (workspace packages included)
RUN pnpm --filter @orchestrator/gateway deploy --prod /out

# Stage 2: Runtime
FROM node:20-alpine

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init curl

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Copy the self-contained production bundle from the builder
COPY --from=builder --chown=nodejs:nodejs /out ./

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
