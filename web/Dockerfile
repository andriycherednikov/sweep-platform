# =============================================================================
# The Sweep — Web image (static Vite SPA served by an internal Caddy)
# =============================================================================
# Build context is the MONOREPO ROOT. Build for the server's architecture:
#   docker buildx build --platform linux/amd64 -f web/Dockerfile -t sweep-web .
#
# The SPA uses RELATIVE API paths (/api, /photos), so there are NO build-time
# URL args — this image is domain-agnostic and the shared Caddy routes by path.
# =============================================================================

# ---- build stage: produce web/dist ----
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Manifests + root lockfile (npm ci validates all workspaces).
COPY package.json package-lock.json ./
COPY api/package.json ./api/
COPY web/package.json ./web/
# --ignore-scripts skips the root `prepare: husky` hook (absent in Docker).
RUN npm ci --ignore-scripts

COPY web ./web
RUN npm run build -w web

# ---- runtime stage: tiny static file server ----
FROM caddy:2-alpine
COPY web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/web/dist /usr/share/caddy
EXPOSE 80
