# Sweep Portal — deployment

Deployed to the shared box (`134.199.153.212`, hostname `test`) as its own
stack, alongside — and independent of — the World Cup app. Images build for
**linux/amd64** on the dev Mac, push to **GCP Artifact Registry**, and are
pulled on the server. The stack plugs into the shared **Postgres**
(`simulation-postgres`, database `sweep_portal`) and shared **Caddy**
(`vcv-caddy`) over the `simulation-network`. No host ports are published.

```
              sweep-portal.yowiebay.au (TLS auto)
                              │
                      ┌───────▼────────┐  shared vcv-caddy
                      │  /api/*  /photos/* → portal-api:3000  (SSE: flush_interval -1)
                      │  /*               → portal-web:80     (static SPA + history fallback)
                      └───────┬────────┘
        ┌─────────────┬───────┴───────┬──────────────┐
   portal-migrate   portal-api    portal-worker   portal-web
   (one-shot)       :3000         (feed sync)     :80
        └──────── simulation-postgres (db: sweep_portal) ───────┘
   portal-api mounts the `portal-photos` volume at /data/photos
```

The site is the **platform host**: an unauthenticated visitor gets the account
landing, `/g/<token>` links mint a sweep-scoped session. There is no default
sweep — every sweep is provisioned self-serve by an owner.

| Image | Dockerfile | Runs |
|---|---|---|
| `…/sweep/sweep-portal-api` | `api/Dockerfile` | api (`src/server.js`), worker (`src/worker.js`), migrate (`src/db/migrate.js`) |
| `…/sweep/sweep-portal-web` | `web/Dockerfile` | internal Caddy serving the built SPA |

> ⚠️ The server is x86_64, the dev Mac arm64 — always cross-build via
> `docker buildx --platform linux/amd64` (the build script does).

## One-time server setup

```bash
# 1. Database
ssh root@134.199.153.212 "docker exec simulation-postgres createdb -U simulation sweep_portal"

# 2. Compose + env
ssh root@134.199.153.212 "mkdir -p /root/sweep-portal"
scp docker/docker-compose.yml root@134.199.153.212:/root/sweep-portal/
cp docker/.env.docker.example docker/.env.docker      # fill in, then:
scp docker/.env.docker root@134.199.153.212:/root/sweep-portal/.env.docker

# 3. DNS: A sweep-portal.yowiebay.au → 134.199.153.212 (DNS-only, no proxy)

# 4. Caddy — only after DNS resolves
ssh root@134.199.153.212
cp /root/caddy/Caddyfile /root/caddy/Caddyfile.bak
cat >> /root/caddy/Caddyfile   # paste caddy/sweep-portal.Caddyfile, Ctrl-D
docker exec vcv-caddy caddy reload --config /etc/caddy/Caddyfile
```

**Stripe:** create a webhook endpoint at
`https://sweep-portal.yowiebay.au/api/stripe/webhook` for the three events the
handler acts on — `checkout.session.completed`,
`customer.subscription.updated`, `customer.subscription.deleted` — and put its
signing secret in `STRIPE_WEBHOOK_SECRET`.

## Deploy

```bash
make deploy          # build+push → scp compose → compose pull && up -d → status
make deploy-status   # container state + https health
make logs S=worker   # tail a service
```

Migrations run automatically in the `migrate` one-shot before api/worker start.

## First-boot data (one-time)

The portal ships empty — no seed data. Only the league catalog needs priming
(the worker refreshes it daily thereafter):

```bash
cd /root/sweep-portal
docker compose run --rm api node src/worker/catalog-sync.js          # ~1 request per provider
# then mark the leagues that may be provisioned (nothing is offered until curated):
docker compose run --rm api node src/worker/catalog-curate.js apifootball 39    # Premier League
docker compose run --rm api node src/worker/catalog-curate.js apifootball 140   # La Liga
docker compose run --rm api node src/worker/catalog-curate.js apifootball 135   # Serie A
docker compose run --rm api node src/worker/catalog-curate.js apifootball 78    # Bundesliga
docker compose run --rm api node src/worker/catalog-curate.js apifootball 61    # Ligue 1
docker compose run --rm api node src/worker/catalog-curate.js apifootball 1     # World Cup
docker compose run --rm api node src/worker/catalog-curate.js apibasketball 12  # NBA
```

## Verify

```bash
curl https://sweep-portal.yowiebay.au/api/health   # {"ok":true}
curl https://sweep-portal.yowiebay.au/api/whoami   # {"sweepId":null,"role":null}
```

Then sign in: request a magic link in the SPA and read it out of the api log
(`make logs S=api` — `sendMail` is still a console stub, so links are not
emailed). Provision a sweep from the catalog, open the join link.

## Operations

- **Logs:** `make logs S=api|worker|web`
- **Restart:** `ssh … "cd /root/sweep-portal && docker compose restart api"`
- **Backup:** `docker exec simulation-postgres pg_dump -U simulation sweep_portal > portal.sql`
  plus the `sweep-portal_portal-photos` volume.
