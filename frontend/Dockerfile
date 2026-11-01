# syntax=docker/dockerfile:1
# Build context is the repo root: frontend/package.json depends on the root package (file:..).

FROM node:22-bookworm-slim AS base
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false NEXT_TELEMETRY_DISABLED=1
WORKDIR /app/frontend

# All dependencies, for building and for development.
FROM base AS deps
COPY package.json ../package.json
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

# Development: next dev, source synced by Compose (docker-compose.dev.yml).
FROM deps AS dev
ENV NODE_ENV=development
COPY --chown=node:node frontend/ ./
RUN mkdir -p .next && chown node:node . .next
USER node
EXPOSE 3000
CMD ["npm", "run", "dev"]

# The /api proxy target in next.config.ts is fixed at build time, so API_URL is a build argument.
FROM deps AS build
ARG API_URL=http://api:4000
ENV API_URL=$API_URL
COPY frontend/ ./
RUN npm run build

# Runtime dependencies only.
FROM base AS prod-deps
COPY package.json ../package.json
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --omit=dev

# Production: built Next.js app, non-root.
FROM base AS production
ENV NODE_ENV=production
COPY package.json ../package.json
COPY frontend/package.json frontend/next.config.ts ./
COPY --from=prod-deps /app/frontend/node_modules ./node_modules
COPY --from=build --chown=node:node /app/frontend/.next ./.next
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/login').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node_modules/.bin/next", "start", "-p", "3000"]
