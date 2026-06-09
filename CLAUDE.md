# The Sweep — project guide for agents

Mobile-first (and responsive desktop) web app for a community FIFA World Cup 2026 sweep
(~45 participants). The frontend (Matchday design) is built; we are now building the
backend to make it functional for a real deployment.

## Source of truth — read these first

- **Design spec:** `docs/superpowers/specs/2026-06-09-the-sweep-backend-design.md` — the
  full architecture, decisions, and data model. Read it before writing backend code.
- **Active plan:** `docs/superpowers/plans/2026-06-09-phase-1-db-foundation.md` — the
  current, step-by-step, test-first plan. Execute it task-by-task.

## How we work (non-negotiable)

- **TDD.** Every task is: write the failing test → run it (confirm fail) → minimal
  implementation → run it (confirm pass) → commit. The plan already encodes this.
- **Frequent, small commits.** Conventional Commits (`feat:`, `chore:`, `fix:`, `test:`).
- **DRY, YAGNI.** Build what the current task needs; no speculative features.
- **Verify before claiming done.** Run the actual command and read the output. Never say a
  test passes without running it.
- **Always build/test before handoff** (see global rule).

## Stack

- **Frontend:** `web/` — Vite + React 18 SPA (already built and verified). Consumes the API.
- **Backend:** `api/` — Node 22 (ESM) + Fastify 5 + Drizzle ORM over Postgres. Includes the
  REST API and the football-sync worker (Phase 2).
- **Infra:** `infra/` — Docker Compose; Caddy reverse-proxy + TLS in prod (Phase 6).
- **Tests:** Vitest + `@testcontainers/postgresql` (a real Postgres per test run — **Docker
  must be running**).
- Monorepo via **npm workspaces** (`web`, `api`).

## Commands

```bash
npm install                 # from repo root (workspaces)
npm run dev:web             # Vite dev server (proxies /api → :3000)
npm run dev:api             # Fastify with --watch
npm run test                # api test suite (Vitest)
npm run build               # web production build

# api workspace
npm run db:generate -w api  # drizzle-kit: generate migration SQL from schema
npm run db:migrate -w api   # apply migrations
npm run db:seed -w api      # seed Postgres from the ported generator

# dev stack (postgres + api)
cp .env.example .env
docker compose -f infra/docker-compose.dev.yml --env-file .env up --build
```

## Build order (one plan per phase — see spec §8)

1. **DB foundation** — *planned, ready to execute* (`docs/superpowers/plans/2026-06-09-phase-1-db-foundation.md`)
2. Football worker — provider adapter (API-Football Pro), baseline sync + windowed live poller
3. Frontend data layer — TanStack Query client replacing static `data.js`; loading/error states
4. Social layer + SSE — watch/support endpoints, `/api/stream`, optimistic updates
5. Photos + admin — moderated fan **and** profile photos, admin auth/cookie, approve→live
6. Prod deploy — Caddy container, prod Compose, TLS on a real domain

**Process:** finish a phase from its plan, get it green, then use the
`superpowers:writing-plans` skill to write the next phase's plan against the real code, then
execute. Don't pre-write all phase plans — they read better against existing code.

## Env vars (`.env`, never commit real secrets)

| Var | Phase | Notes |
|---|---|---|
| `DATABASE_URL`, `POSTGRES_*` | 1 | Postgres connection |
| `PORT` | 1 | api port (3000) |
| `API_FOOTBALL_KEY` | 2 | API-Football Pro key (human must provide) |
| `ADMIN_PASSCODE` | 5 | bcrypt-hashed admin passcode |
| `SESSION_SECRET` | 5 | signs the admin cookie |
| `PHOTOS_DIR`, `SITE_ORIGIN` | 5–6 | photo volume path, allowed origin |

## Notes

- The site **never** calls API-Football directly — only the worker does; the SPA reads our
  Postgres cache via the api. The cache is the contract.
- Light identity: viewers pick themselves (stored per device); admin is the only real auth.
- Nothing user-uploaded (fan or profile photos) is public until admin-approved.
- The original design bundle lives under `design_unpack/` (git-ignored) for reference.
