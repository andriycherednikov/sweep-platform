# Phase 6 — Frontend Reskin + Self-Serve Surface: Design

**Status:** Drafted 2026-07-04; presented in-session (owner AFK — per-section
review gate pending, P4/P5 precedent). Decisions locked this session:
**(b)** labels-only rename (confirmed — wire keys `1x2`/`ou25`, `/api/coins`,
`coin_ledger` stay internal ids; web-local route/label renames free),
**(c)** deploy = separate follow-up (confirmed), **(d)** keep the current
Matchday look, sport-neutral labels (confirmed).
**AFK default to veto: (a) = BOTH, with an explicit go/no-go checkpoint
after the reskin half ships** (owner's stated lean; if the reskin overruns,
self-serve cuts to P7 without renegotiation).

Inputs: `2026-07-04-p6-web-inventory.md` (48-agent audit: 1 rebuild /
15 rework / 4 relabel / 22 keep), feasibility §2/§8, P4 §5/§6, P5 §4/§5/§10.
Inversion rule this phase: **api 412 stays green throughout; API changes are
additive-only.** Web count moves; each task records the new bar in the SDD
ledger, which also formally retires the 436 invariant.

## 1. Approach

One client-side **sport-vocab module** + one additive **bootstrap
competition seam**; every soccer branch in web keys off wire facts
(`hasDraws`, `format`, `sport`) instead of soccer proxies (`stage==='group'`,
flagcdn, hardcoded market keys). Rejected:

- **Server-side label service** (labels in bootstrap) — couples the stable
  API to UI copy; violates the additive-only inversion for zero gain.
- **Per-sport component forks** — duplicates the 25-module shell; for
  head-to-head sports the delta is vocab + a handful of conditionals.
- **CSS-only relabel** — cannot fix 3-way logic, draw zones, or market
  rendering; fails the NBA success criteria.

Critical wire fact driving this: NBA regular-season events arrive with
`stage:'group'` (basketball-mapping.js:32), so today's `stage==='group'`
draw-branches would show Draw UI on NBA games. `stage` remains only a
KO-bracket hint; **all draw logic moves to `hasDraws`.**

## 2. API changes (additive-only, the complete list)

1. **Bootstrap** gains `competition: {sport, hasDraws, name, season, format,
   logo}` — one `competition` select on `req.sweep.competitionId` +
   `sportConfig(sport).hasDraws` (bootstrap.js already has the sweep row).
   `format` is `'league' | 'groups_then_ko' | 'knockout'` (schema.js:200).
2. **`serializeCompetitor` gains `logo`** — column exists (schema.js:214),
   populated for NBA, null for soccer. Feeds the emblem policy (§4).
3. **Standings route** (routes/standings.js): rows keep the soccer shape and
   additionally spread the raw ranking `stats` through (`pf/pa/pct` for NBA);
   group key falls back `meta.group ?? meta.conference ?? ''`; sort gains
   `pct` as tiebreak after `pts` (football rows have no `pct` → unaffected).
4. Nothing else. No renames, no field removals, no route changes.

Each lands with additive api tests (bar moves 412 → recorded per task).

## 3. Web store + vocab layer

- **`data.js`**: `DATA_KEYS` gains `competition`, `readOnly`,
  `wageringEnabled` (today's whitelist silently drops the served seams —
  inventory headline finding). `emptySweep` defaults: `hasDraws:true`,
  `readOnly:false`, `wageringEnabled:true` (matches the WC default sweep so
  nothing flashes during load).
- **`lib/vocab.js`** (new): keyed by `competition.sport`, generic 2-way
  fallback for unknown sports. Exports the term table (fixture noun
  match/game, tab labels, standings column set, live-phase labels — football
  keeps HT/ET/Pens via `liveLabel`, basketball passes the feed `phase`
  through (Q1..Q4/OT), scorer/cards event copy gates), consumed by screens
  via `S.vocab`. Market display names merge INTO `betLabels.js` (one label
  source, §6) rather than duplicating there.
- `format.js`: `flag()`/`gd()`/`liveLabel()` fold behind vocab/emblem;
  date/time formatters untouched.

## 4. Team identity — Emblem component

`<Emblem code/>` replaces direct `S.flag()`/flagcdn usage (components,
screens, reactions, draw, coins): competitor `logo` present → logo img;
else national-team football → existing flagcdn flag; else colored monogram
from the `color` column. One square emblem CSS variant alongside the 3:2
flag boxes (~30 rules keep working for football). Tests: emblem policy unit
+ swap flag assertions where fixtures go multi-sport.

## 5. hasDraws + format logic (the rework core)

- Every `stage==='group'` **draw**-branch → `S.hasDraws`: CrowdPick draw
  zone (components.jsx:262), ProbBar 3-way→2-way (NBA `prob.d` null),
  MatchSheet prediction bar + draw-backer (screens-detail), `social.js`
  DRAW sentinel + tie→DRAW fallback (guarded: no-draw sports never emit it),
  FloatingReactions 🤝 Draw path, coins Draw buttons/labels.
- **`format` drives structure**: knockouts tab exists only when
  `format !== 'league'`; the WC bracket (R32_DEFS etc.) is extracted from
  screens-main.jsx into its own module, rendered for `groups_then_ko` —
  WC keeps full function, NBA never mounts it. Standings columns from vocab
  (football W/D/L/GF/GA/Pts; basketball W/L/Pct/PF/PA), table headings from
  the wire group keys ("Group A" / "Eastern Conference") verbatim.
- Soccer-only renderers (goalscorer summaries, card chips, PenScore,
  SquadList position buckets, Starting XI) render only when the data exists
  AND vocab enables them — data-driven hide, zero NBA special cases.

## 6. Market rendering (kills the "+N more" drift)

- **One renderable-market list** exported from `betLabels.js`; both
  `MARKET_ORDER` (bet-detail) and the "+N more" count (screens-coins:786)
  consume it — the drift dies structurally, not key-by-key.
- `betLabels.js` gains `ml` (Moneyline, team names), `ou` (O/U + stored
  `line`), `hcap` (team + signed line); `TEAM_MARKETS` gains `ml`/`hcap`.
- screens-coins: bettable filter (:671) and headline (:744) become
  `toq → 1x2 → ml`; FloatingReactions `BET_MARKET_NAMES` deleted in favor of
  betLabels. `coins.js`/`betslip.js` untouched (already market-agnostic).
- Result: hcap renders + places on WC today; ml/ou light up the moment any
  sport offers them. DRAW selections simply never arrive for no-draw sports
  (server-vetoed), so no client filtering needed beyond hasDraws labels.

## 7. Wagering UI states (bootstrap-driven, no guesswork)

- `!wageringEnabled` → the Wagers tab, routes, bet affordances, and bet/multi
  reaction toasts don't render at all (success criterion: "no wagering UI").
  `canWager()` also checks it as the belt.
- `readOnly` → persistent banner ("Sweep is read-only — the owner's
  subscription has lapsed") + write affordances disabled (place-bet, photo
  upload, support taps, admin mutations, draw commit). Server still enforces;
  the UI stops lying about writability. SSE + reads untouched.
- Self-exclusion UI unchanged (`optout.js` mirrors the now-server-enforced
  403 `self_excluded`).
- The `WAGERS_END='19 July 2026'` hardcode + World-Cup-Final copy
  (screens-coins:574,610) is replaced with generic weekly-grant copy —
  the end date is a server concern.
- SPA route `/coins` → `/wagers`, tab label "Wagers" (web-local; wire
  untouched per (b)).

## 8. Account shell + billing UI (front half — required even reskin-only)

Billing endpoints are `x-account-token` (header) auth'd — a second auth
mechanism parallel to the sweep cookie. Mounted like `/super`: `main.jsx`
routes `/account/*` to a standalone `AccountRoot` (Gate untouched).

- **Account client** (`lib/accountClient.js`): token in localStorage, header
  injection, {400,401,402,403,409,503} → UI-state map.
- **Screens/routes:** sign-in (email form → "check your email"; copy honest
  about console `sendMail` in dev); `/account/login/:token` redeem (spinner →
  store token → `/account`); **account home** = my-sweeps list (member/admin
  links, archive w/ confirm) + **billing panel**: 4-state machine off
  `GET /api/account/billing` — fresh ("trial starts with your first sweep"),
  trialing (countdown + subscribe CTA), subscribed (liveSweeps × price +
  "Manage billing" → portal; soft `past_due` warning), lapsed (subscribe
  CTA). Checkout/Portal are redirects to Stripe-hosted pages — never
  hand-rolled.
- **Static routes** `/account/billing/success` and `/account/billing/
  cancelled` — hardcoded in the API (billing.js:31-32), mandatory.

## 9. Self-serve back half (post go/no-go checkpoint)

- **Catalog screen**: sport filter + search (min 2 chars, ≤50 rows), season
  picker from `seasons[]`; provision as a modal (name + wagering toggle).
- **Provision UX**: the request runs a synchronous feed sync inside a row
  lock — seconds long; real pending state, then success panel with
  member/admin links. Error map: 402 → billing CTA, 403 `sweep_cap` shows
  cap, 400 unknown_competition, 500 retryable.
- My-sweeps already exists from the front half; catalog links into it.

## 10. Survival constraints (must hold at every commit)

PWA injectManifest contract untouched (`pwa.config.js`, `sw.js` +
`__WB_MANIFEST`); **art swap under existing filenames** (192/512 icons,
apple-touch, favicons, trophy.png; shrink the 3.4 MB favicon.svg);
`site.webmanifest` + `index.html` titles → "The Sweep" (drop "— World Cup
2026"); GateBrand falls back to platform branding (renders pre-bootstrap).
GA4: mechanics untouched; property swap + event renames (`match_open` etc.)
**deferred to the deploy gate (c)** — one clean break with the new property;
only the pageview path changes with the `/wagers` route rename. `/super`
mount, notifications bus, SW caches, InstallPrompt logic: untouched.

## 11. Testing

- **Shared fixture factory first** (`web/test/factories.js`):
  `makeBootstrap({sport})` football + basketball variants — 13 coupled test
  files currently build inline soccer stubs; without the factory the
  migration is 13× per-file.
- Tests evolve WITH each task (RTL/vitest): ~200 class-b tests updated as
  their screens rework; new tests for vocab, emblem policy, hasDraws
  branches (both sports), market rendering incl. drift regression ("+N"
  equals renderable∩offered), readOnly/wageringEnabled gating, account
  client error map, billing panel states, catalog/provision UX.
- **No Playwright suite this phase** — the jsdom suite + claude-in-chrome
  live passes cover it; new e2e infra is deferred until the SPA surface
  stabilizes post-reskin.
- Suites green at every commit; web bar recorded per task in the SDD ledger;
  436 invariant formally retired there.

## 12. Verification (live, Stripe test mode)

Per visual task: real-browser screenshot (claude-in-chrome). Final
whole-branch review + live pass: WC sweep full function (soccer vocab from
config), NBA sweep `sw_aX7u2IQSwCDR` basketball-native end to end (no
groups/flags/matchday/goalscorer/cards, 2-way language), wagering on/off/
opt-out, lapsed read-only banner, billing checkout 4242 + Portal via Chrome.

## 13. Execution order

1. API seams (bootstrap competition, competitor logo, standings stats) —
   api bar up, additive.
2. Fixture factory + store/vocab layer (data.js keys, vocab.js).
3. Emblem component + flag CSS variant.
4. Market rendering + drift fix.
5. hasDraws rework (components, detail, social, reactions, coins).
6. Format rework (tabs, bracket extraction, standings columns).
7. Relabel pass (manifest, index.html, GateBrand, statement, CSS vocab,
   /wagers route).
8. readOnly banner + wageringEnabled gating.
9. Account shell + billing UI + static billing routes.
10. **GO/NO-GO checkpoint** (owner; AFK → proceed, veto standing).
11. Catalog + provision + my-sweeps polish.
12. Final review + live browser pass (§12).

Carried cleanups (P3/P4/P5 tickets) picked up only where a task already
touches the file. First-deploy gate items excluded per (c).

## 14. Out of scope

Wire renames (per b), deploy/infra/GA-property/live-keys (per c), fresh
visual identity (per d), basketball live odds fetch, Playwright e2e,
push-notification payloads (seam survives), account deletion, sport #3.
