# syntax=docker/dockerfile:1
# Build context is the repo root: backend/package.json depends on the root package (file:..).

FROM node:22-bookworm-slim AS base
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
WORKDIR /app/backend

# All dependencies, for compiling and for development.
FROM base AS deps
COPY package.json ../package.json
COPY backend/package.json backend/package-lock.json ./
RUN npm ci

# Development: watch mode, source synced by Compose (docker-compose.dev.yml).
# nest --watch stops the old process with ps, which the slim image does not include.
FROM deps AS dev
ENV NODE_ENV=development
RUN apt-get update && apt-get install -y --no-install-recommends procps && rm -rf /var/lib/apt/lists/*
COPY --chown=node:node backend/ ./
RUN mkdir -p dist storage && chown node:node . dist storage
USER node
EXPOSE 4000
CMD ["npm", "run", "start:dev"]

FROM deps AS build
COPY backend/ ./
RUN npm run build

# Runtime dependencies only.
FROM base AS prod-deps
COPY package.json ../package.json
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

# Production: compiled API, non-root. CVs and attachments live on the storage volume.
FROM base AS production
ENV NODE_ENV=production
COPY package.json ../package.json
COPY backend/package.json ./
COPY --from=prod-deps /app/backend/node_modules ./node_modules
COPY --from=build /app/backend/dist ./dist
RUN mkdir -p storage && chown node:node storage
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4000/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "dist/main.js"]
