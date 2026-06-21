# Single-stage production build for Railway
FROM node:20-alpine

WORKDIR /app

# Copy package files first for better layer caching
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/services/package.json packages/services/
COPY packages/api-gateway/package.json packages/api-gateway/

# Install dependencies
RUN npm ci --ignore-scripts

# Copy Prisma schema and generate client
COPY packages/services/prisma packages/services/prisma/
RUN npx prisma generate --schema=packages/services/prisma/schema.prisma

# Copy tsconfig files
COPY tsconfig.json ./
COPY packages/shared/tsconfig.json packages/shared/
COPY packages/services/tsconfig.json packages/services/
COPY packages/api-gateway/tsconfig.json packages/api-gateway/

# Copy source code
COPY packages/shared/src packages/shared/src/
COPY packages/services/src packages/services/src/
COPY packages/api-gateway/src packages/api-gateway/src/

# Build all packages in order
RUN npx tsc -p packages/shared/tsconfig.json
RUN npx tsc -p packages/services/tsconfig.json
RUN npx tsc -p packages/api-gateway/tsconfig.json

# Expose port
ENV PORT=3000
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start
CMD ["node", "packages/api-gateway/dist/index.js"]
