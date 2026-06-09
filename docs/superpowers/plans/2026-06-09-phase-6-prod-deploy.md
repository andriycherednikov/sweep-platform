# Phase 6 — Prod Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship The Sweep as a self-hosted, containerized stack — Caddy (TLS + static SPA + approved photos + `/api` proxy), the Fastify api, the football worker, Postgres, and a one-shot migrate — orchestrated by a single prod `docker-compose.yml`, verified end-to-end locally.

**Architecture:** Five services per spec §2. One `api/Dockerfile` (Node 22) builds an image used by **three** services via command override: `api` (`node src/server.js`), `worker` (`node src/worker.js`), and the one-shot `migrate` (`node src/db/migrate.js`). A separate `web/Dockerfile` is a multi-stage build: a Node stage runs `vite build`, and the final stage is `caddy` serving `web/dist` as the SPA, the **approved** photos dir (a shared volume) at `/photos`, and reverse-proxying `/api/*` to `api:3000` with streaming enabled so SSE flushes. Postgres uses a named `pgdata` volume; the `photos` volume is shared read-write by `api` (writes pending+approved) and read-only by `caddy` (serves approved only — pending is never mounted into Caddy, preserving the kid-safety guarantee). The migrate service runs to completion before `api`/`worker` start.

**Tech Stack:** Docker + Docker Compose, Caddy 2 (automatic TLS), `node:22-bookworm-slim` (glibc — `sharp` prebuilt binaries work without a musl build). No application code changes — every entrypoint already reads `process.env` and binds `0.0.0.0`.

---

## Decisions locked for this plan

- **Base image `node:22-bookworm-slim`, not alpine** — `sharp` ships prebuilt glibc binaries; alpine (musl) would force a libvips compile. Slim keeps size down while staying glibc.
- **One image for api/worker/migrate** — they share all code; only the command differs. Avoids drift and a second build.
- **`migrate` reads env from the compose `environment`, runs `node src/db/migrate.js` directly** (NOT the `db:migrate` npm script, which hardcodes `--env-file=../.env` that doesn't exist in-container).
- **Caddy serves only `approved/`** — the `photos` volume is mounted into Caddy at the approved subpath only; pending files are never reachable through Caddy. The api mounts the whole `photos` volume.
- **SSE through Caddy** needs `flush_interval -1` on the `/api/*` reverse_proxy, else Caddy buffers `/api/stream` and live events stall.
- **First-boot data provisioning is a documented manual sequence, NOT automated.** The real teams/roster were human-curated (Phase 2 cutover, Phase 2.5 roster import). Automating a blind seed would overwrite curated data. Migrations are automated; seeding/roster/crosswalk/baseline are a one-time `docker compose run` checklist (Task 7).
- **Local prod smoke uses `http://localhost` with auto-HTTPS disabled** (`SITE_DOMAIN=localhost`, `auto_https off` via env) so the stack is verifiable without a real domain/cert. Real TLS is a one-line domain swap, documented.
- **Workspace install trade-off:** the api image runs `npm ci --omit=dev` at the repo root (workspaces need every manifest present). `web`'s few runtime deps get installed too — a small, accepted size cost in exchange for a simple, correct build. Documented in the Dockerfile.

---

## File Structure

**New:**
- `.dockerignore` (repo root) — keep `node_modules`, `.git`, `web/dist`, `photos-data`, `.env` out of build context.
- `api/Dockerfile` — Node 22 slim; installs prod deps; runs `node src/server.js` by default.
- `web/Dockerfile` — multi-stage: `vite build` → `caddy` final image with `web/dist` + Caddyfile baked in.
- `infra/Caddyfile` — TLS, SPA static + try_files fallback, `/photos` file server, `/api/*` streaming reverse proxy.
- `infra/docker-compose.yml` — postgres + migrate(one-shot) + api + worker + caddy; `pgdata` + `photos` volumes.
- `infra/.env.example` — prod env template (DB creds, domain, secrets, keys).
- `infra/README.md` — deploy + first-boot provisioning + TLS-go-live runbook.

**Modified:**
- `CLAUDE.md` — fix the stale `infra/docker-compose.dev.yml` reference (there is no dev compose); point the deploy command at `infra/docker-compose.yml`.
- `.gitignore` — ignore `infra/.env` (real prod secrets).

**No application source changes.** (If Task 5 finds Caddy can't reach a healthy api, the only allowed code touch is confirming `server.js` binds `0.0.0.0` — it already does.)

---

## Chunk A — Container images (Tasks 1–3)

### Task 1: `.dockerignore` + api image

**Files:**
- Create: `.dockerignore`, `api/Dockerfile`

> Verification here is a real image build + running the migrator against a throwaway Postgres — not a unit test (infra). Each step runs an actual command and checks output.

- [ ] **Step 1: Write `.dockerignore` (repo root)**

```
node_modules
**/node_modules
.git
.github
web/dist
dist
photos-data
**/photos-data
.env
infra/.env
*.log
.remember
design_unpack
docs
```

- [ ] **Step 2: Write `api/Dockerfile`**

```dockerfile
# Build context is the REPO ROOT (npm workspaces need every manifest present).
# One image serves api / worker / migrate — only the command differs.
FROM node:22-bookworm-slim AS base
WORKDIR /app

# Install prod dependencies using the workspace manifests + lockfile.
# (web's runtime deps install too — workspaces require all manifests; accepted size cost.)
COPY package.json package-lock.json ./
COPY api/package.json ./api/package.json
COPY web/package.json ./web/package.json
RUN npm ci --omit=dev

# Copy the api source + migrations (web source is not needed in this image).
COPY api ./api

ENV NODE_ENV=production
WORKDIR /app/api
EXPOSE 3000
CMD ["node", "src/server.js"]
```

- [ ] **Step 3: Build the api image**

Run: `docker build -f api/Dockerfile -t sweep-api:test .`
Expected: builds successfully; final line `naming to docker.io/library/sweep-api:test`. (First build pulls the base image + compiles nothing — `sharp` uses prebuilt binaries.)

- [ ] **Step 4: Smoke the migrator against a throwaway Postgres**

Run:
```bash
docker network create sweepnet || true
docker run -d --name sweep-pg-smoke --network sweepnet \
  -e POSTGRES_USER=sweep -e POSTGRES_PASSWORD=sweep -e POSTGRES_DB=sweep postgres:16
sleep 5
docker run --rm --network sweepnet \
  -e DATABASE_URL=postgres://sweep:sweep@sweep-pg-smoke:5432/sweep \
  sweep-api:test node src/db/migrate.js
```
Expected: prints `migrations applied`.

- [ ] **Step 5: Verify the schema landed, then tear down the smoke Postgres**

Run:
```bash
docker exec sweep-pg-smoke psql -U sweep -d sweep -c "\dt" | grep -E "person|fixture|photo|watch|support"
docker rm -f sweep-pg-smoke
docker network rm sweepnet
```
Expected: the table list includes `person`, `fixture`, `photo`, `watch`, `support`.

- [ ] **Step 6: Commit**

```bash
git add .dockerignore api/Dockerfile
git commit -m "feat(infra): api/worker/migrate Docker image (node 22 slim)"
```

---

### Task 2: web + Caddy image

**Files:**
- Create: `web/Dockerfile`
- (uses `infra/Caddyfile` from Task 3 — to keep this task self-contained, the Dockerfile copies the Caddyfile; build it in Task 3's verification once the Caddyfile exists.)

- [ ] **Step 1: Write `web/Dockerfile`**

```dockerfile
# Stage 1 — build the SPA. Context is the REPO ROOT (workspaces).
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json ./api/package.json
COPY web/package.json ./web/package.json
RUN npm ci
COPY web ./web
RUN npm run build -w web   # outputs web/dist

# Stage 2 — Caddy serving the SPA + approved photos + /api proxy.
FROM caddy:2
COPY --from=build /app/web/dist /srv/www
COPY infra/Caddyfile /etc/caddy/Caddyfile
# /srv/photos is the approved-photos volume mount (see docker-compose.yml).
```

- [ ] **Step 2: (Defer build to Task 3)**

The image needs `infra/Caddyfile` (Task 3). After Task 3 exists, build is verified there. For now, just commit the Dockerfile.

- [ ] **Step 3: Commit**

```bash
git add web/Dockerfile
git commit -m "feat(infra): multi-stage web build served by Caddy"
```

---

### Task 3: Caddyfile

**Files:**
- Create: `infra/Caddyfile`

- [ ] **Step 1: Write `infra/Caddyfile`**

```caddyfile
{
	# In local-smoke mode SITE_DOMAIN=localhost and AUTO_HTTPS=off disables cert issuance.
	auto_https {$AUTO_HTTPS:off}
}

{$SITE_DOMAIN:localhost} {
	encode gzip

	# API + SSE — stream responses immediately (flush_interval -1 is essential for /api/stream).
	handle /api/* {
		reverse_proxy api:3000 {
			flush_interval -1
		}
	}

	# Approved fan/profile photos (read-only volume mount; pending is never mounted here).
	handle_path /photos/* {
		root * /srv/photos
		file_server
	}

	# SPA — static assets with history-API fallback to index.html.
	handle {
		root * /srv/www
		try_files {path} /index.html
		file_server
	}
}
```

- [ ] **Step 2: Build the web+Caddy image (now that the Caddyfile exists)**

Run: `docker build -f web/Dockerfile -t sweep-web:test .`
Expected: stage 1 runs `vite build` (`✓ built`), stage 2 copies dist + Caddyfile; image tagged.

- [ ] **Step 3: Validate the Caddyfile syntax**

Run: `docker run --rm sweep-web:test caddy validate --config /etc/caddy/Caddyfile`
Expected: `Valid configuration`.

- [ ] **Step 4: Commit**

```bash
git add infra/Caddyfile
git commit -m "feat(infra): Caddyfile — SPA, approved photos, streaming /api proxy"
```

---

## Chunk B — Compose orchestration (Tasks 4–5)

### Task 4: prod `docker-compose.yml` + env template

**Files:**
- Create: `infra/docker-compose.yml`, `infra/.env.example`
- Modify: `.gitignore`

- [ ] **Step 1: Write `infra/.env.example`**

```
# ---- Postgres (the bundled prod container) ----
POSTGRES_USER=sweep
POSTGRES_PASSWORD=change-me-strong
POSTGRES_DB=sweep
# api/worker reach Postgres by its compose service name:
DATABASE_URL=postgres://sweep:change-me-strong@postgres:5432/sweep

# ---- App ----
PORT=3000
WC_SEASON=2026
# In-container photos root (the `photos` volume mounts here):
PHOTOS_DIR=/data/photos
NODE_ENV=production

# ---- Football worker ----
API_FOOTBALL_KEY=your-api-football-pro-key

# ---- Admin / sessions ----
# bcrypt hash — generate: docker compose run --rm api npm run admin:hash -- <passcode>
ADMIN_PASSCODE=
SESSION_SECRET=change-me-long-random

# ---- Caddy / site ----
# Local smoke: SITE_DOMAIN=localhost + AUTO_HTTPS=off
# Production:  SITE_DOMAIN=sweep.example.com + AUTO_HTTPS=on
SITE_DOMAIN=localhost
AUTO_HTTPS=off
SITE_ORIGIN=http://localhost
```

- [ ] **Step 2: Write `infra/docker-compose.yml`**

```yaml
name: the-sweep

services:
  postgres:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 5s
      timeout: 5s
      retries: 10

  migrate:
    build: { context: .., dockerfile: api/Dockerfile }
    command: ["node", "src/db/migrate.js"]
    environment:
      DATABASE_URL: ${DATABASE_URL}
    depends_on:
      postgres: { condition: service_healthy }
    restart: "no"

  api:
    build: { context: .., dockerfile: api/Dockerfile }
    command: ["node", "src/server.js"]
    environment:
      DATABASE_URL: ${DATABASE_URL}
      PORT: ${PORT}
      PHOTOS_DIR: ${PHOTOS_DIR}
      ADMIN_PASSCODE: ${ADMIN_PASSCODE}
      SESSION_SECRET: ${SESSION_SECRET}
      SITE_ORIGIN: ${SITE_ORIGIN}
      NODE_ENV: ${NODE_ENV}
    volumes:
      - photos:/data/photos
    depends_on:
      postgres: { condition: service_healthy }
      migrate: { condition: service_completed_successfully }
    restart: unless-stopped

  worker:
    build: { context: .., dockerfile: api/Dockerfile }
    command: ["node", "src/worker.js"]
    environment:
      DATABASE_URL: ${DATABASE_URL}
      API_FOOTBALL_KEY: ${API_FOOTBALL_KEY}
      WC_SEASON: ${WC_SEASON}
    depends_on:
      postgres: { condition: service_healthy }
      migrate: { condition: service_completed_successfully }
    restart: unless-stopped

  caddy:
    build: { context: .., dockerfile: web/Dockerfile }
    environment:
      SITE_DOMAIN: ${SITE_DOMAIN}
      AUTO_HTTPS: ${AUTO_HTTPS}
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - photos:/srv/photos/approved-src:ro   # placeholder; see note below
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - api
    restart: unless-stopped

volumes:
  pgdata:
  photos:
  caddy_data:
  caddy_config:
```

> **Photos mount note:** Caddy must serve the **approved** subdir of the photos volume at `/photos`. The api writes to `${PHOTOS_DIR}` = `/data/photos`, with `approved/` and `pending/` underneath. Mount the volume into Caddy and point the Caddyfile `root` at the approved subdir. Replace the caddy `photos` volume line with:
> ```yaml
>       - photos:/srv/photos-vol:ro
> ```
> and set the Caddyfile photos block `root * /srv/photos-vol/approved`. Update `infra/Caddyfile` Task 3 accordingly in this task (it's a one-line change): change `root * /srv/photos` → `root * /srv/photos-vol/approved`, and the `web/Dockerfile` comment. Re-validate the Caddyfile after the change (Task 3 Step 3 command).

- [ ] **Step 3: Apply the photos-path correction**

Edit `infra/Caddyfile`: change the photos `root` line to `root * /srv/photos-vol/approved`. Edit `infra/docker-compose.yml` caddy volume to `- photos:/srv/photos-vol:ro`. Rebuild + re-validate:
```bash
docker build -f web/Dockerfile -t sweep-web:test .
docker run --rm sweep-web:test caddy validate --config /etc/caddy/Caddyfile
```
Expected: `Valid configuration`.

- [ ] **Step 4: Validate the compose file**

Run:
```bash
cp infra/.env.example infra/.env
docker compose -f infra/docker-compose.yml --env-file infra/.env config >/dev/null && echo "compose OK"
```
Expected: `compose OK` (no schema/interpolation errors).

- [ ] **Step 5: Ignore real prod secrets**

Append `infra/.env` to `.gitignore`.

- [ ] **Step 6: Commit**

```bash
git add infra/docker-compose.yml infra/.env.example infra/Caddyfile .gitignore
git commit -m "feat(infra): prod docker-compose — postgres, migrate, api, worker, caddy"
```

---

### Task 5: Full-stack bring-up smoke

**Files:** none (verification task; may produce a one-line fix to env/compose if something misbinds).

- [ ] **Step 1: Build + start the whole stack**

Run:
```bash
docker compose -f infra/docker-compose.yml --env-file infra/.env up --build -d
```
Expected: images build; `postgres` becomes healthy; `migrate` exits 0; `api`, `worker`, `caddy` start.

- [ ] **Step 2: Confirm migrate completed and services are up**

Run:
```bash
docker compose -f infra/docker-compose.yml --env-file infra/.env ps
docker compose -f infra/docker-compose.yml --env-file infra/.env logs migrate | grep "migrations applied"
```
Expected: `migrate` shows `Exit 0`; api/worker/caddy `running`; log shows `migrations applied`.

- [ ] **Step 3: Hit the api through Caddy**

Run:
```bash
curl -s http://localhost/api/health
curl -s http://localhost/api/sync-status
```
Expected: `{"ok":true}`; sync-status JSON (likely `{"stale":true,...}` until provisioning + a baseline run — expected on a fresh DB).

- [ ] **Step 4: Confirm the SPA is served**

Run: `curl -s http://localhost/ | grep -o "<title>[^<]*</title>"`
Expected: the app's HTML title (the SPA shell) returns — Caddy is serving `web/dist`.

- [ ] **Step 5: Confirm SSE streams through Caddy (flush works)**

Run:
```bash
( curl -N -s http://localhost/api/stream & sleep 1; \
  curl -s -X POST http://localhost/api/watch -H 'content-type: application/json' \
    -d '{"fixtureId":"__none__","personId":"__none__"}' >/dev/null; sleep 1; kill %1 ) 2>/dev/null
```
Expected: the stream connection stays open and the `retry: 3000` preamble flushes immediately (the POST 400s on bogus ids — that's fine; this only proves the stream isn't buffered). For a real event, provision data first (Task 7) and toggle a real watch.

- [ ] **Step 6: Tear down (keep volumes)**

Run: `docker compose -f infra/docker-compose.yml --env-file infra/.env down`
Expected: containers stop/removed; `pgdata`/`photos` volumes persist.

- [ ] **Step 7: Commit (only if a fix was needed)**

If Steps 1–5 required an env/compose correction, commit it:
```bash
git add infra/docker-compose.yml infra/.env.example infra/Caddyfile
git commit -m "fix(infra): correct <what> so the stack comes up cleanly"
```
Otherwise no commit — this task is pure verification.

---

## Chunk C — Provisioning runbook + docs (Tasks 6–7)

### Task 6: Deploy + provisioning README

**Files:**
- Create: `infra/README.md`

- [ ] **Step 1: Write `infra/README.md`**

````markdown
# The Sweep — production deploy

Five services via `infra/docker-compose.yml`: `postgres`, one-shot `migrate`, `api`,
`worker`, `caddy`. One `api/Dockerfile` image runs api/worker/migrate; `web/Dockerfile`
builds the SPA and bakes it into Caddy.

## 1. Configure

```bash
cp infra/.env.example infra/.env
# edit infra/.env: strong POSTGRES_PASSWORD (mirror it into DATABASE_URL),
# API_FOOTBALL_KEY, SESSION_SECRET, and the admin passcode hash:
docker compose -f infra/docker-compose.yml --env-file infra/.env run --rm api npm run admin:hash -- <passcode>
# paste the printed hash into ADMIN_PASSCODE in infra/.env
```

For real TLS set `SITE_DOMAIN=your.domain` and `AUTO_HTTPS=on` (point the domain's
A/AAAA records at the host first; Caddy fetches a Let's Encrypt cert on boot).
For a local trial keep `SITE_DOMAIN=localhost` + `AUTO_HTTPS=off`.

## 2. Bring it up

```bash
docker compose -f infra/docker-compose.yml --env-file infra/.env up --build -d
```

`migrate` applies `api/migrations` and exits; `api`/`worker` start after it succeeds.

## 3. First-boot data provisioning (ONE TIME — manual, by design)

Prod Postgres starts empty. The reference data (teams/people/ownership) and the
curated roster are loaded by hand so an automated seed never clobbers them:

```bash
C="docker compose -f infra/docker-compose.yml --env-file infra/.env run --rm"
$C -e DATABASE_URL=$DATABASE_URL api npm run db:seed         # reference teams/people/ownership/scoring
$C api npm run import:roster                                  # 48 players + 96 picks
$C -e API_FOOTBALL_KEY=$API_FOOTBALL_KEY api npm run crosswalk:sync   # map our codes → provider ids
$C api npm run cutover                                        # pin the real WC-2026 field
```
The `worker` runs a baseline sync on boot and on its cron schedule; standings/scores
populate from there. Verify: `curl -s http://<host>/api/bootstrap | head`.

## 4. Operate

- Logs: `docker compose -f infra/docker-compose.yml --env-file infra/.env logs -f api worker`
- Force a football refresh: `... run --rm api npm run sync`
- Backups (real pot — do this): nightly `pg_dump` of the `postgres` service +
  a copy of the `photos` volume. Example:
  ```bash
  docker compose -f infra/docker-compose.yml --env-file infra/.env exec -T postgres \
    pg_dump -U $POSTGRES_USER $POSTGRES_DB > sweep-$(date +%F).sql
  ```
- Update: `git pull && docker compose -f infra/docker-compose.yml --env-file infra/.env up --build -d`
  (migrate re-runs idempotently).

## Notes
- Caddy serves only the **approved** photos subdir; pending uploads are never web-served.
- SSE relies on Caddy `flush_interval -1` (already set) — don't put a buffering proxy in front.
````

- [ ] **Step 2: Commit**

```bash
git add infra/README.md
git commit -m "docs(infra): production deploy + first-boot provisioning runbook"
```

---

### Task 7: Fix stale CLAUDE.md command + final verification

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Correct the dev-stack command block in `CLAUDE.md`**

The `## Commands` section currently references a non-existent `infra/docker-compose.dev.yml`. Replace that
`# dev stack` block with the prod reality:
```bash
# prod stack (caddy + api + worker + postgres + one-shot migrate)
cp infra/.env.example infra/.env   # then edit secrets
docker compose -f infra/docker-compose.yml --env-file infra/.env up --build
```
And in the "Build order" section, mark Phase 6 as done and point to `infra/README.md` for the runbook.

- [ ] **Step 2: Full repo verification (no regressions from infra work)**

Run:
```bash
npm run test -w api 2>&1 | tail -3
npm run test -w web 2>&1 | tail -3
npm run build 2>&1 | tail -3
```
Expected: api green, web green, build green (infra changes touch no app code).

- [ ] **Step 3: Confirm the stack still validates**

Run: `docker compose -f infra/docker-compose.yml --env-file infra/.env config >/dev/null && echo OK`
Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: point deploy commands at the real prod compose; mark Phase 6 done"
```

---

## Final verification (lead, before declaring Phase 6 done)

- [ ] `docker build -f api/Dockerfile -t sweep-api:test .` and `docker build -f web/Dockerfile -t sweep-web:test .` both succeed.
- [ ] `docker compose -f infra/docker-compose.yml --env-file infra/.env up --build -d` → migrate exits 0; api/worker/caddy healthy.
- [ ] `curl http://localhost/api/health` → `{"ok":true}`; `curl http://localhost/` serves the SPA shell; `/api/stream` flushes immediately.
- [ ] (Optional, full end-to-end) run the Task-6 provisioning sequence, then confirm `/api/bootstrap` returns the 48 teams and the SPA renders real data; upload→approve a photo and see it served at `/photos/...`.
- [ ] `npm run test -w api` + `npm run test -w web` + `npm run build` all green.
- [ ] `docker compose ... down` (volumes preserved).
- [ ] Push: `git push origin main` (pre-push runs web+api tests + build; Docker must be up).
- [ ] Update `.remember/remember.md` with the Phase 6 handoff (project is now fully deployable).

---

## Self-review notes (author)

- **Spec §2/§7 coverage:** five services (caddy/api/worker/postgres/migrate) (T4); one-shot migrate runs Drizzle migrations then exits (T1/T4); Caddy auto-TLS from the domain + serves SPA + `/photos` (approved only) + proxies `/api` (T3); worker shares the api image, different entrypoint (T1/T4); `photos` + `pgdata` volumes (T4); config via `.env` with all spec'd vars (T4); backups runbook (T6). ✓
- **Cache-is-the-contract preserved:** no app code changes; the api keeps serving last-good from Postgres regardless of worker/API-Football state. ✓
- **Kid-safety preserved in prod:** Caddy mounts only the approved subdir; pending never web-served (T3/T4 note). ✓
- **SSE in prod:** `flush_interval -1` on the `/api/*` proxy so `/api/stream` isn't buffered (T3, verified T5 Step 5). ✓
- **No-placeholder check:** every Dockerfile/compose/Caddyfile is complete; verification steps are real commands with expected output. The one intentional in-task correction (photos path, T4 Step 3) is spelled out with exact edits. ✓
- **Provisioning honesty:** first-boot data load is documented manual (T6), not silently automated — the real field/roster were human-curated; `log`-style transparency rather than a blind seed that could clobber. ✓
- **Open items from spec §9 surfaced in the runbook:** domain/TLS choice (T6 §1), backups cadence (T6 §4). Knockout-bracket data model remains a v2 extension (out of scope). ✓
- **Deferred from Phase 5 (noted for the operator):** upload-route rate-limiting and admin fixture/sweep-data/sync endpoints are not built; they don't block deploy.
