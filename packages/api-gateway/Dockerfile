# ============================================
# Stage 1: Build
# ============================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root workspace files for dependency resolution
COPY package.json package-lock.json tsconfig.json ./

# Copy workspace package manifests
COPY packages/shared/package.json packages/shared/
COPY packages/services/package.json packages/services/
COPY packages/api-gateway/package.json packages/api-gateway/

# Install all dependencies (including dev for build)
RUN npm ci

# Copy source code for referenced packages
COPY packages/shared/ packages/shared/
COPY packages/services/ packages/services/
COPY packages/api-gateway/ packages/api-gateway/

# Build shared and services first (api-gateway depends on them)
RUN npm run build --workspace=packages/shared && \
    npm run build --workspace=packages/services && \
    npm run build --workspace=packages/api-gateway

# ============================================
# Stage 2: Production
# ============================================
FROM node:20-alpine AS production

# Security: run as non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

WORKDIR /app

# Copy root package files for workspace resolution
COPY package.json package-lock.json ./

# Copy workspace package manifests
COPY packages/shared/package.json packages/shared/
COPY packages/services/package.json packages/services/
COPY packages/api-gateway/package.json packages/api-gateway/

# Install production dependencies only
RUN npm ci --omit=dev

# Copy compiled output from builder
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/packages/services/dist packages/services/dist
COPY --from=builder /app/packages/api-gateway/dist packages/api-gateway/dist

# Copy Prisma schema if present (needed for @prisma/client)
COPY packages/services/prisma packages/services/prisma/ 2>/dev/null || true

# Set ownership to non-root user
RUN chown -R appuser:appgroup /app

USER appuser

# Port configured via environment variable
ENV PORT=3000
EXPOSE ${PORT}

# Health check using the /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/health || exit 1

# Start the API Gateway
CMD ["node", "packages/api-gateway/dist/index.js"]
