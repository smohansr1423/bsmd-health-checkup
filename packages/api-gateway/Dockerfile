# ============================================
# Stage 1: Build
# ============================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root workspace files for dependency resolution
COPY package.json package-lock.json tsconfig.json ./

# Copy ALL workspace package manifests
COPY packages/shared/package.json packages/shared/tsconfig.json packages/shared/
COPY packages/services/package.json packages/services/tsconfig.json packages/services/
COPY packages/api-gateway/package.json packages/api-gateway/tsconfig.json packages/api-gateway/

# Copy Prisma schema (needed for prisma generate)
COPY packages/services/prisma packages/services/prisma/

# Install all dependencies (including dev for build)
RUN npm ci

# Generate Prisma client
RUN npx prisma generate --schema=packages/services/prisma/schema.prisma

# Copy source code for all referenced packages
COPY packages/shared/src packages/shared/src/
COPY packages/services/src packages/services/src/
COPY packages/api-gateway/src packages/api-gateway/src/

# Build packages in dependency order
RUN npx tsc -p packages/shared/tsconfig.json && \
    npx tsc -p packages/services/tsconfig.json && \
    npx tsc -p packages/api-gateway/tsconfig.json

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

# Copy Prisma schema (needed for @prisma/client runtime)
COPY packages/services/prisma packages/services/prisma/

# Install production dependencies only
RUN npm ci --omit=dev && \
    npx prisma generate --schema=packages/services/prisma/schema.prisma

# Copy compiled output from builder
COPY --from=builder /app/packages/shared/dist packages/shared/dist/
COPY --from=builder /app/packages/services/dist packages/services/dist/
COPY --from=builder /app/packages/api-gateway/dist packages/api-gateway/dist/

# Set ownership to non-root user
RUN chown -R appuser:appgroup /app

USER appuser

# Port configured via environment variable
ENV PORT=3000
EXPOSE 3000

# Health check using the /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start the API Gateway
CMD ["node", "packages/api-gateway/dist/index.js"]
