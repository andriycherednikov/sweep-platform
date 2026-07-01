# Multi-Sport Sweep Platform — Feasibility & Effort Read

**Status:** Exploratory. This is a feasibility/effort assessment, not yet a build
spec. Greenfield: production will be wiped and rebuilt, so there is **no data
migration and no backward-compat constraint** — we design the generalized model
once, correctly, and seed fresh.

**Goal:** Turn the single-purpose World Cup 2026 sweep app into a small SaaS where
a person picks a **competition** (a league season, or a world event like the World
Cup) from the sports feed, spins up a sweep for their group, and pays a small
subscription (~$5/mo) to keep it running.

---

## 1. What the exploration decided

| Question | Decision |
|---|---|
| Generalization axis | **Same mechanic, more sports.** Own competitors → score by placement/results. Not a generic prediction platform. |
| Unit of a sweep | **One selected competition instance** = `(provider, sport, leagueId, season)`, chosen from the feed catalog. Covers both leagues and world events. |
| Sports in scope | **Head-to-head (exactly-2-participant) sports only** for now. Excludes field sports (golf/racing/multi-player tennis draws). |
| Wagering (was "coins") | **Renamed to Wagering; a per-sweep on/off feature.** Supported for all 2-team sports via a shared market spine, not football-only. |
| Monetization | **Stripe subscription**, ~$5/mo per running sweep (or per owner). Lapse → sync pauses / sweep read-only. |
| Deployment | Greenfield rebuild. No migration. |

---

## 2. What ports for free vs what fights us

The codebase is already cleanly split into an **event-agnostic shell** and a
**football-coupled feed layer**. The shell is the asset; the feed layer is the work.

### Ports for free (event-agnostic, already multi-tenant)
- **Sweep tenancy** — member/admin tokens, per-sweep isolation, composite tenant FKs (`api/src/sweeps/`)
- **Draw-from-hat allocation** + `ownership` + admin allocation UI
- **Social layer** — support/watch picks, SSE stream, floating reactions
- **Wagering engine mechanics** — wallet, ledger, single-bet + parlay lifecycle, settlement state machine (the *plumbing*; the *market definitions* are sport-specific — see §6)
- **Photos + moderation, PWA/offline, GA4, worker scheduling pattern** (baseline sync + windowed live poll)

### Fights us (football/World-Cup-coupled)
- **Schema** — `team`(group/pool/flag/strength/squad), `fixture`(matchday/venue/pen/HT/lineups/soccer-stats/derby/stage), `standing`(W/D/L/GF/GA). Deeply soccer-shaped (`api/src/db/schema.js`).
- **Provider** — a single adapter, API-Football only, + crosswalk/mapping (`api/src/providers/`)
- **Scoring** — `scoring_rule='top3'` = group-stage placement
- **Settlement markets** — 1x2/BTTS/goalscorer/cards, all soccer
- **Frontend language** — the UI speaks fluent soccer (groups, flags, "matchday", shootouts). Backend generality does **not** buy this back; reskin is its own line item.

**Headline:** the sweep + social + wagering-plumbing + PWA shell is reusable. All the
work lives where the app touches the feed — data model, provider adapter, scoring,
and market/settlement definitions.

---

## 3. Generalized core schema (greenfield)

Design these fresh. Sport-agnostic columns; sport specifics live in `jsonb`.

- **`competition`** *(new)* — `id, provider, sport, leagueId, season, format, name, logo`.
  `format ∈ { league, groups_then_ko, knockout }` drives scoring + standings shape.
  `sweep.competitionId → competition`.
- **`team → competitor`** — keep `code/name/color/logo`; soccer-only
  group/pool/strength/squad → `meta jsonb`.
- **`fixture → event`** — keep `id`, two participants, `startUtc`, `status`, scores,
  `winnerCode`; matchday/venue/pen/HT/lineups/soccer-stats/derby/phase → `detail jsonb`;
  keep generic `round`/`stage`. Exactly-2-participant invariant holds (head-to-head only).
- **`standing → ranking`** — generic `rank` + `points` + `stats jsonb` (W/D/L/GF/GA for
  soccer, W/L for basketball, etc.).
- **`scoring_rule`** — small registry keyed off `competition.format`:
  `league_topN`, `group_placement`, `knockout_survival`. Already stored as text.
- **Draw handling** — a per-sport config flag (`hasDraws`). Soccer/rugby-union → 3-way;
  basketball/hockey (play to a winner) → 2-way. `winnerCode` + the `'DRAW'` sentinel
  already carry this end to end (see the winnerCode source-of-truth rule).

Because it's greenfield, football becomes **one configured sport among several**, not a
retrofit. Cleaner boundaries, same effort.

---

## 4. Provider registry

One interface, many sports:

```
fetchCompetitions()        // catalog: /leagues across sports
fetchCompetitors(comp)
fetchSchedule(comp)
fetchResults(comp)
fetchStandings(comp)
resultToWinnerCode(event)  // per-sport result → winnerCode/'DRAW'
```

**The leverage:** API-Sports' per-sport APIs (football / basketball / rugby / hockey /
baseline etc.) are near-identical in request/response shape. So it's **one base
adapter + per-sport field maps**, not N ground-up integrations. The existing
API-Football adapter becomes the reference implementation ported behind this interface.

**Proof obligation:** wire one non-football 2-team sport end to end (e.g. NBA) — that's
the real test that the abstraction holds, and it flushes out per-sport quirks early.

---

## 5. Self-serve + the account layer

The sweep is already multi-tenant (member/admin tokens); what's missing is something
that **owns** sweeps and holds billing.

- **`account`/`owner`** *(new)* — sits above `sweep`; the billable entity.
- **Flow:** sign in → pick sport → search league/season from the cached catalog →
  provision a sweep bound to that competition → fire a baseline sync → invite the group
  via the existing member token.
- Admin-per-sweep already exists via the admin token; the new layer is only about
  ownership + billing, not a new permission system.

---

## 6. Wagering (renamed from Coins) — per-sweep feature, all 2-team sports

- **Per-sweep flag** `sweep.wageringEnabled` (off by default; organizer opts in). Existing
  per-*person* self-exclusion/opt-out stays and stacks under it.
- **Shared market spine across head-to-head sports:** moneyline (2-way) / 1X2 (3-way where
  `hasDraws`), totals (O/U), handicap/spread. These generalize because every 2-team sport
  has them, and API-Sports exposes odds per sport.
- **Sport-specific exotics are optional add-ons** layered on the spine: soccer's
  BTTS/goalscorer/cards/corners, basketball player props, etc. Ship a sport with just the
  spine; add exotics later per sport. YAGNI.
- **Settlement plumbing is reused as-is** (wallet, ledger, parlay, state machine); only the
  per-market grading function is sport-specific.

---

## 7. Monetization (~$5/mo)

- **Stripe subscription** per running sweep (or per owner — see open question). Use the
  Stripe SDK + Checkout + webhook; do not hand-roll billing.
- **`account` + `subscription`** tables; subscription status gates sweep liveness.
- **Lapse behavior:** sync pauses and the sweep goes read-only until renewed (data
  retained, not deleted).
- **⚠ Unit-economics flag (the real risk to the business model, not the build):** live
  polling hits the *paid* feed per active sweep. At $5/mo, **feed cost per active sweep**
  is what decides viability. Mitigations to model before committing: share one poll across
  all sweeps on the same competition (dedupe by `competitionId` — many groups will pick the
  same big leagues), poll windows tied to actual kickoff times, and a cheaper feed tier for
  non-live sweeps. This needs a spreadsheet, not a hunch.

---

## 8. Phasing (greenfield)

1. **Generic core schema** — competition/competitor/event/ranking + account/sweep, fresh, no migration.
2. **Provider registry** — port football onto it (reuses ~all existing logic) + prove one 2nd 2-team sport (NBA) end to end.
3. **Catalog + self-serve creation + account layer.**
4. **Stripe subscription + lifecycle gating** + feed-cost dedupe by competition.
5. **Wagering generalization** — per-sweep flag + shared market spine across 2-team sports; soccer exotics stay as the reference add-on.
6. **Frontend reskin** — strip soccer-specific language/UI; sport-driven labels. (Runs alongside 2–5, not after.)

**Effort shape:** phases 1–2 are the substance and are mostly *mechanical* on greenfield
(define + port, no migration). Phase 6 (reskin) is easy to underestimate. Phase 4's risk
is commercial (unit economics), not technical.

---

## 9. Open questions (decide before a build spec)

- **Billing granularity:** per-sweep vs per-owner subscription? (Affects account model + Stripe product setup.)
- **Feed vendor lock-in:** commit to the API-Sports family (shared shape = the whole leverage), or keep the provider interface truly vendor-neutral from day one?
- **Free tier:** is there one (e.g. one sweep, no live sync), or paid-only?
- **Which non-football sport proves phase 2** — NBA (no draws, clean 2-way) is the recommended first, precisely because it stresses the draw/market abstractions differently from soccer.
- **Feed-cost model** must be validated (§7) before phase 4 is worth building.

---

## 10. One-line honest summary

The shell is genuinely reusable and greenfield removes the scary migration; the work is a
straight (if wide) generalization of the feed layer plus a self-serve + billing wrapper.
The build is tractable. The open risk is **commercial** — whether $5/mo covers per-sweep
feed cost — and that's answerable with a spreadsheet before writing a line of the build spec.
