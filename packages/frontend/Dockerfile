# Frontend Dockerfile for Railway
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./
COPY packages/frontend/package.json packages/frontend/

# Install dependencies
RUN npm ci --ignore-scripts --workspace=packages/frontend

# Copy frontend source
COPY packages/frontend/ packages/frontend/

# Build Next.js
RUN npm run build --workspace=packages/frontend

# Expose port
ENV PORT=3001
EXPOSE 3001

# Start Next.js
CMD ["npm", "run", "start", "--workspace=packages/frontend"]
