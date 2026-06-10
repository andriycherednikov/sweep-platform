# The Sweep — Deployment

Production deploy to the shared server (`134.199.153.212`). Images are built for
**linux/amd64** locally, pushed to **GCP Artifact Registry** (repo `sweep`), and
pulled on the server. The app plugs into the server's **shared Postgres**
(`simulation-postgres`) and **shared Caddy** (`vcv-caddy`) over the shared
`simulation-network`. No host ports are published — Caddy routes the domain by
container name.

> **Domains:** currently live on `sweep.andriycherednikov.com` (temporary).
> The permanent home will be `sweep.yowiebay.au` — add it to the Caddy site
> block once that zone's DNS points at this host (see `caddy/sweep.Caddyfile`).

```
              sweep.andriycherednikov.com (TLS auto)
                              │
                      ┌───────▼────────┐  shared vcv-caddy
                      │  /api/*  /photos/* → sweep-api:3000  (SSE: flush_interval -1)
                      │  /*               → sweep-web:80     (static SPA + history fallback)
                      └───────┬────────┘
        ┌─────────────┬───────┴───────┬──────────────┐
   sweep-migrate   sweep-api      sweep-worker     sweep-web
   (one-shot)      :3000          (poller)         :80
        └──────────── simulation-postgres (db: sweep) ─────────┘
   sweep-api mounts the `sweep-photos` volume at /data/photos
```

## Images

| Image | Dockerfile | Runs |
|---|---|---|
| `…/sweep/sweep-api` | `api/Dockerfile` | api (`node src/server.js`), worker (`node src/worker.js`), migrate (`node src/db/migrate.js`) |
| `…/sweep/sweep-web` | `web/Dockerfile` | internal Caddy serving the built SPA |

> ⚠️ The server is **x86_64**; the dev Mac is **arm64**. Always build with
> `docker buildx --platform linux/amd64` (the build script does this). A plain
> `docker build` produces an arm64 image the server can't run.

## One-time server setup

1. **Create the database** in the shared Postgres:
   ```bash
   ssh root@134.199.153.212 "docker exec simulation-postgres createdb -U simulation sweep"
   ```
   (Confirm the shared Postgres user/password and update `DATABASE_URL` accordingly.)

2. **Place compose + env on the server:**
   ```bash
   ssh root@134.199.153.212 "mkdir -p /root/sweep"
   scp docker/docker-compose.yml root@134.199.153.212:/root/sweep/
   cp docker/.env.docker.example docker/.env.docker   # then fill in secrets
   scp docker/.env.docker root@134.199.153.212:/root/sweep/.env.docker
   ```
   Secrets to fill: `API_FOOTBALL_KEY`, `ADMIN_PASSCODE` (bcrypt hash via
   `make admin-hash PASS=…`), `SESSION_SECRET` (`openssl rand -base64 48`).
   (Re-`scp` the compose file whenever it changes — deploy does not copy it.)

3. **Wire up the shared Caddy:**
   ```bash
   ssh root@134.199.153.212
   cp /root/caddy/Caddyfile /root/caddy/Caddyfile.bak
   cat >> /root/caddy/Caddyfile   # paste docker/caddy/sweep.Caddyfile, then Ctrl-D
   docker exec vcv-caddy caddy reload --config /etc/caddy/Caddyfile
   ```

4. **DNS:** point the site's A/AAAA at the host so Caddy can issue TLS. Use a
   **DNS-only** record (no Cloudflare proxy) so Caddy can complete the ACME
   challenge directly. Currently `sweep.andriycherednikov.com`; add
   `sweep.yowiebay.au` once that zone is live.

## Deploy

From the dev machine (requires `gcloud auth login` + Docker running):

```bash
make deploy        # build+push amd64 images → ssh login → compose pull && up -d → health check
```

On first `up -d`, the `migrate` container runs migrations to completion, then api,
worker, and web start.

## First-boot data provisioning (manual, one-time)

The schema is migrated automatically. The reference data is human-curated, so seed
it deliberately (run on the server from `/root/sweep`):

```bash
docker compose run --rm api node src/seed/seed.js            # teams/people/ownership/scoring
docker compose run --rm api node src/seed/import-roster.js   # 48 players + 96 picks
docker compose run --rm api node src/worker/crosswalk-sync.js  # provider ids (needs API_FOOTBALL_KEY)
docker compose run --rm api node src/worker/cutover.js         # pin to the real WC-2026 field
```

The long-running `worker` service then keeps fixtures/standings/scores synced.

## Verify

```bash
curl https://sweep.andriycherednikov.com/api/health     # {"ok":true}
curl -N https://sweep.andriycherednikov.com/api/stream  # SSE stays open / streams events
```
Then load the site, refresh a deep link (e.g. `/teams/ar`) to confirm the SPA
history fallback, and check an approved photo renders via `/photos/…`.

## Operations

- **Logs:** `ssh root@… "cd /root/sweep && docker compose logs -f api"`
- **Restart:** `docker compose restart api` (or `up -d` after a new push)
- **Backups:** `docker exec simulation-postgres pg_dump -U simulation sweep > sweep.sql`
  and copy the `sweep-photos` volume (`/var/lib/docker/volumes/sweep_sweep-photos`).
- **Registry cleanup:** `make docker-cleanup` (keeps `:latest`).
