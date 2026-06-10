# =============================================================================
# The Sweep — API image (also runs the worker and one-shot migrations)
# =============================================================================
# Build context is the MONOREPO ROOT (npm workspaces need every manifest +
# the root lockfile). Build for the server's architecture:
#   docker buildx build --platform linux/amd64 -f api/Dockerfile -t sweep-api .
#
# bookworm-slim (glibc) is deliberate: `sharp` installs its prebuilt linux-x64
# libvips binary on Debian — no native compile (alpine/musl would compile or fail).
# =============================================================================
FROM node:22-bookworm-slim

WORKDIR /app

# Manifests first for layer caching. All workspace manifests are required so
# `npm ci` can validate them against the single root lockfile.
COPY package.json package-lock.json ./
COPY api/package.json ./api/
COPY web/package.json ./web/

# Production deps only. --ignore-scripts skips the root `prepare: husky` hook
# (husky is a devDep, absent here). sharp's prebuilt binary arrives as a
# platform optional-dependency (@img/sharp-linux-x64), not a postinstall script,
# so it is still installed correctly for the amd64 target.
RUN npm ci --omit=dev --ignore-scripts

# API source + migration SQL (the migrate one-shot reads ./migrations).
COPY api ./api

# Persistent photo volume mountpoint — pre-create and own it as `node` so the
# (initially empty) named volume inherits writable ownership on first mount.
RUN mkdir -p /data/photos && chown -R node:node /data/photos

WORKDIR /app/api
ENV NODE_ENV=production
ENV PORT=3000
ENV PHOTOS_DIR=/data/photos
EXPOSE 3000
USER node

# Default command runs the API server; compose overrides it for migrate/worker.
CMD ["node", "src/server.js"]
