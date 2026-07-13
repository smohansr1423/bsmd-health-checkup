# Single-stage production build for Railway
FROM node:20-alpine

WORKDIR /app

# Prisma on Alpine (musl) needs OpenSSL present to detect libssl and load the query engine
RUN apk add --no-cache openssl libc6-compat

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

# --- Calorie & Cortisol (CC) TypeScript packages (additive, Option A1) ---
# The CC tool is a SEPARATE npm project with its own lockfile / workspaces /
# @calorie-cortisol/* aliases. Build its TS packages so their dist/ (and the
# workspace node_modules that resolve @calorie-cortisol/* at runtime) exist in
# the image; the gateway then require()s the compiled bundles lazily at runtime.
# Copied after the health-checkup build so those layers stay cached when only CC
# source changes. Only the Node/TS services are folded in — the CC Python
# (food-vision, nutrition-lookup, insights-ml) and Go (user-profile) services
# are NOT part of this single-Node-container integration.
COPY packages/calorie-cortisol-tool/package.json packages/calorie-cortisol-tool/package-lock.json packages/calorie-cortisol-tool/
COPY packages/calorie-cortisol-tool/tsconfig.json packages/calorie-cortisol-tool/
COPY packages/calorie-cortisol-tool/shared/package.json packages/calorie-cortisol-tool/shared/
COPY packages/calorie-cortisol-tool/gateway/package.json packages/calorie-cortisol-tool/gateway/
COPY packages/calorie-cortisol-tool/services/cortisol-data/package.json packages/calorie-cortisol-tool/services/cortisol-data/
COPY packages/calorie-cortisol-tool/services/notification/package.json packages/calorie-cortisol-tool/services/notification/
COPY packages/calorie-cortisol-tool/clients/pwa/package.json packages/calorie-cortisol-tool/clients/pwa/
COPY packages/calorie-cortisol-tool/clients/shared/package.json packages/calorie-cortisol-tool/clients/shared/
RUN npm ci --ignore-scripts --prefix packages/calorie-cortisol-tool || npm install --prefix packages/calorie-cortisol-tool
# Copy the CC source + tsconfigs, then build all CC TS packages (tsc --build).
COPY packages/calorie-cortisol-tool packages/calorie-cortisol-tool/
RUN npm run build --prefix packages/calorie-cortisol-tool

# Expose port
ENV PORT=3000
EXPOSE 3000

# Health check (uses the runtime PORT, which Railway injects)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider "http://localhost:${PORT:-3000}/health" || exit 1

# Start
CMD ["node", "packages/api-gateway/dist/index.js"]
