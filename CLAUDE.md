# Sweep Platform — project guide for agents

Multi-sport sweep SaaS: a person picks a competition (league season or world event,
any head-to-head 2-team sport) from the sports feed, spins up a sweep for their group,
and pays a small subscription to keep it running.

Forked from the World Cup 2026 sweep app (`upstream` remote,
`andriycherednikov/world-cup-sweep`) with full history. This repo is a **greenfield
rebuild** on that codebase: no data migration, no back-compat — the generalized model
is designed fresh, and the football app becomes the reference sport ported onto it.

## Source of truth — read first

- **Feasibility read / scope:** `docs/superpowers/specs/2026-07-01-multi-sport-sweep-platform-feasibility.md`
  — what was decided (competition-per-sweep, 2-team sports only, per-sweep Wagering,
  Stripe subscription), what ports free vs what changes, phasing, open questions.
- Everything else under `docs/superpowers/specs/` and the schema/code is the inherited
  World Cup implementation — treat it as the reference to generalize from, not as
  current design.

## Scope decisions (locked)

- Same mechanic, more sports: own competitors → score by placement/results.
- A sweep is bound to ONE competition instance `(provider, sport, leagueId, season)`.
- Head-to-head (exactly-2-participant) sports only for now.
- Coins is renamed **Wagering**: a per-sweep on/off feature, all 2-team sports,
  shared market spine (moneyline/1X2, totals, handicap); soccer exotics are add-ons.
- ~$5/mo Stripe subscription; lapse → sync pauses, sweep read-only.
- **Before building billing:** validate feed-cost unit economics (spec §7).

## How we work (inherited, non-negotiable)

- **TDD.** Failing test → run it → minimal implementation → run it → commit.
- **Frequent, small commits.** Conventional Commits.
- **DRY, YAGNI.** Build what the current task needs.
- **Verify before claiming done.** Run the command, read the output.

## Stack (inherited)

- `web/` — Vite + React 18 SPA. `api/` — Node 22 (ESM) + Fastify 5 + Drizzle over
  Postgres. `infra/` — Docker Compose + Caddy. npm workspaces; Vitest +
  `@testcontainers/postgresql` (Docker must be running).

## Commands

```bash
npm install                 # repo root (workspaces)
npm run dev:web             # Vite dev server
npm run dev:api             # Fastify --watch
npm run test                # api suite   ·   npm test -w web  # web suite
npm run build               # web production build
```

## Cautions

- `upstream` remote is the live WC app; its push URL is disabled on purpose.
  Cherry-pick fixes from it; never push to it.
- `.env` was copied from the WC repo — `DATABASE_URL` still points at the shared
  local Postgres `sweep` database. Create a separate `sweep_platform` database
  before running migrations/seed here, and do NOT touch the `sweep` database
  (the live WC app's dev data).
- No production exists for this repo yet; the inherited `Makefile`/`infra/` deploy
  targets still point at WC prod — do not deploy until they're repointed.
