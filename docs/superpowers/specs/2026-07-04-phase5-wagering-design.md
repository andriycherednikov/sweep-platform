# Phase 5 — Wagering Generalization: Design

**Status:** Drafted 2026-07-04; presented in-session (owner AFK — per-section
review gate pending, P4 precedent). Owner decisions locked this session:
**(a)** basketball odds = spine + auto-hide, zero new spend (feed facts:
`2026-07-04-p5-odds-shape.md` — free plan reaches `/odds` but no odds exist
for any free-window season, and the ~$19/mo upgrade buys nothing until the
NBA is in season ~Oct 2026); **(b)** rename = internal/docs/new-surfaces
only, wire frozen, web stays 436. Pre-locked by the feasibility spec §6:
per-sweep `wageringEnabled` OFF by default, organizer opts in; per-person
self-exclusion stacks under it; spine = moneyline/1X2-where-hasDraws,
totals, handicap; soccer exotics stay the reference add-on; settlement
plumbing reused as-is.

**AFK defaults to veto:**
- **(c) flag surface:** provision-body option + sweep-admin toggle endpoint
  (owner's stated lean; not confirmed — AFK at the ask).
- **Backfill:** existing sweeps get `wageringEnabled = true` (keeps the WC
  default sweep's live coins behavior provably unchanged); only NEW sweeps
  start OFF.
- **Exclusion enforcement:** bet/parlay placement gains a server-side
  `excludedUntil` check (403 `self_excluded`). Today the exclusion is
  recorded and serialized but never enforced on the write path — UI-only,
  curl bypasses it. In-scope because P5 builds the very gate it stacks under.

## 1. Approach

One declarative market registry, per-sport variation only via config.
`resolveBet`'s football-shaped switch (`api/src/coins/settle.js`) becomes a
registry in `api/src/wagering/markets.js`: each market key declares how it
grades and whether it needs draws. `sports.js` `SPORTS` gains
`gradeOn: 'regulation' | 'final'` (football keeps grading bets on the 90'
score exactly as today; every other sport grades on the final score, OT
included). Rejected:

- **Per-sport grading modules** — duplicates spine math that is
  sport-agnostic once the score measure is configured. DRY.
- **Flag only, no spine** — fails the P5 success criteria (spine markets
  must offer + settle from stored `detail.markets`).
- **Basketball fetchOdds now** — no non-empty basketball odds response
  exists to record (see odds-shape note); a mapping written from an assumed
  shape is the anti-pattern the feed-reality check exists to prevent.

## 2. Schema (one additive migration)

- `sweep.wageringEnabled boolean not null default false`.
- Migration backfills `true` for all existing rows (see AFK defaults).
- Nothing else changes; `coin_ledger`/`bet`/`parlay` stay as-is (wire and
  DB names frozen until P6).

## 3. Gating stack (all veto, in order)

1. **P4 read-only gate** (global preHandler) — lapsed sweep already refuses
   `/api/bet`/`/api/parlay` writes; unchanged.
2. **Member auth** (`requireSweep(['member','admin'])`) — unchanged.
3. **`wageringEnabled === false` → 403 `{error:'wagering_disabled'}`** —
   stable error, both POST routes, one shared guard.
4. **Minor** (`p.adult === false` → 403 `minor_not_allowed`) — existing.
5. **Self-exclusion** (`isExcluded(p)` → 403 `{error:'self_excluded'}`) —
   NEW enforcement of the existing `excludedUntil` field.
6. **Market validation** (stored market + selection + odds) — existing,
   extended with the hasDraws veto (§5).

Reads stay open regardless of the flag: `GET /api/coins`,
`GET /api/coins/ledger`, bootstrap, SSE — wallet history is readable on a
wagering-off or lapsed sweep. Settlement of already-open bets is untouched
by a later toggle-off: placement is gated, resolution is not (money must
resolve).

## 4. Flag surface (AFK default c)

- `POST /api/account/sweeps` body gains optional
  `wageringEnabled: boolean` (default false).
- New `POST /api/admin/wagering {enabled: boolean}` — sweep-admin token,
  flips the resolved sweep's flag. Covered by the read-only gate for free
  (lapsed sweeps can't toggle). Toggling OFF with open bets is allowed —
  open bets settle, new stakes are refused.
- `GET /api/bootstrap` gains additive `wageringEnabled: boolean` (the
  `readOnly` field precedent — frozen web ignores unknown fields; the P6
  reskin consumes it).

## 5. Market spine

Normalized market keys stored per-event in `detail.markets` (existing
mechanism — the bet routes are already data-driven: no stored market → 400
`no_odds`, which is what makes auto-hide free).

New spine keys (additive; frozen web never sends them):

| Key | Market | Selections | Grades on |
|---|---|---|---|
| `ml` | Moneyline 2-way | `HOME`/`AWAY` | `fixtureResult` (winnerCode → OT included) |
| `ou` | Totals O/U (stored `line`) | `OVER`/`UNDER` | score sum per `gradeOn` |
| `hcap` | Handicap (home-relative stored `line`) | `HOME`/`AWAY` | `score1 + line` vs `score2` per `gradeOn` |

- **Half-point lines only**, selected as the most-balanced priced pair from
  the book — no push/void handling. (ponytail: whole-line pushes excluded at
  offer time; add push→refund when a sport's books force integer lines.)
- **hasDraws rules** (enforced at offer, validation, grading):
  - `hasDraws=true` (football): head market is `1x2`; `ml` is never
    offered. Existing football keys unchanged.
  - `hasDraws=false` (basketball): head market is `ml`; `1x2`, `dc`,
    `fh1x2` and any DRAW-bearing selection are refused — validation rejects
    the market key for the sweep's sport, and the registry's grade guard
    refuses DRAW-market grading as the belt.
  - The bet/parlay routes learn the sweep's sport with one competition
    select (`req.sweep.competitionId` → `competition.sport` →
    `sportConfig`).
- **Registry** (`api/src/wagering/markets.js`): each key →
  `{needsDraws, grade(f, selection, line, sportCfg)}`. `resolveBet`
  delegates; existing football markets (`1x2`, `toq`, `ou25`, `cards`,
  `fh1x2`, `cs`, `btts`, `dc`, `oe`, `fhou`, `gs`) move into the registry
  verbatim as the reference add-on — same behavior, same tests.
- **Football offer**: `mapMarkets` gains `hcap` from bet id 4 (Asian
  Handicap), parsed against the live capture
  `api/test/fixtures/apifootball/odds-spine-live.json` (13 books; the old
  `odds.json` is a synthetic trim with no handicap). `ou25` stays as-is —
  it IS the football totals spine entry (fixed 2.5 line is a football
  choice, not a schema one).
- **Bet body enums** extend with `ml`/`ou`/`hcap` (additive).

## 6. Basketball seam (deferred per decision a)

- Basketball provider keeps NO `fetchOdds` — `syncBaseline` skips odds
  (`if (provider.fetchOdds)` guard, unchanged), events store no markets,
  betting on them 400s `no_odds`: auto-hide with zero code.
- The spine is proven for `hasDraws=false` by injecting normalized markets
  onto recorded-NBA events in tests (post-mapping shape is OUR shape —
  legitimately testable without a feed sample): place + settle `ml`/`ou`/
  `hcap` singles and parlays on recorded finals; DRAW refused everywhere.
- When a paid basketball key + in-season odds exist: implement
  `fetchOdds(gameId)` + a `mapBasketMarkets` (bet ids 2/3/4 per the
  odds-shape note), respecting the 100/day budget and the existing ≤7d
  pre-kickoff window. One function + one mapping file — the seam.

## 7. Rename (decision b)

`git mv api/src/coins → api/src/wagering` + import updates (mechanical, one
commit). New names for new things (`wageringEnabled`,
`/api/admin/wagering`, `wagering_disabled`). Frozen until the P6 reskin:
route paths (`/api/coins`, `/api/bet`, `/api/parlay`), JSON field names,
market keys, DB table names (`coin_ledger`). Docs say Wagering.

## 8. Untouched

Settlement plumbing (`settleBets`/`settleParlay`/stale cron), rewards +
weekly grants (keep accruing when OFF — invisible to the UI, warm if
enabled later; revisit only if ledger noise bites), all P4 billing
behavior, web (436).

## 9. Testing

Strict TDD, testcontainers, recorded feeds only — zero live calls.

- Flag gate: OFF sweep → 403 `wagering_disabled` on bet + parlay; reads
  stay 200; WC default sweep (backfilled ON) unchanged through the frozen
  wire; provision option + admin toggle round-trip; toggle-off leaves open
  bets settleable.
- Exclusion: excluded person → 403 `self_excluded` on both routes; expiry
  restores.
- Spine: registry grading units per key (incl. line math, OT-inclusive
  `ml`, `gradeOn` split); `mapMarkets` hcap from the live capture fixture;
  NBA injected-markets e2e — place `ml`/`ou`/`hcap` singles + a parlay on
  recorded upcoming games, flip to final, settle, balances correct.
- hasDraws: `1x2`/DRAW refused for basketball at validation AND grading;
  football unaffected.
- Bootstrap: additive `wageringEnabled` field.
- Suites green: api (393 + new), web 436 untouched.

## 10. Post-implementation (2026-07-04, branch ccb3dac..0356655)

Landed as designed; final whole-branch review READY-TO-MERGE-WITH-FIXES, all
fixes applied and re-reviewed clean (api 412 / web 436 unmodified / build
green). Owner decisions and deviations recorded:

- **hcap-on-football drift (owner-decided: keep).** The frozen web's
  "+N more markets" chip counts all `detail.markets` keys, but its
  bet-detail whitelist predates `hcap` — once LIVE football odds sync, the
  count includes a market the detail screen doesn't show. Cosmetic only;
  accepted; the P6 reskin resolves it. Do not "fix" in web/.
- **Audit-parity fix beyond the plan text:** `openBetsBySweep`/`gradeNow`
  (wagering/ledger.js) now threads the sweep's sport like `settleBets`
  does — the plan only threaded settlement; the admin stale-bet audit
  diverged for basketball (final review, RED-proven fix `04c89e2`).
- **Tickets out of P5:** integer-line push leaves a bet open with stake
  deducted (refund plumbing only if integer lines become offerable); `ml`
  grades the final result regardless of `gradeOn` (fine for every sport
  that offers it; comment-only); `hcap` equal-gap tie-break is first-seen;
  `cs` draw scorelines aren't hasDraws-vetoed (unreachable — never offered
  for no-draw sports).
- **AFK defaults still standing for veto:** decision (c) surface
  (provision option + admin toggle), backfill-ON, server-side exclusion
  enforcement.

## 11. Out of scope

P6 reskin (wire rename, wagering UI), basketball live odds fetch (seam
only), push/void handling for integer lines, per-sport exotics beyond
football's existing set, rewards/grants gating, P4 tickets (carried
separately as cleanups), first-deploy gate items.
