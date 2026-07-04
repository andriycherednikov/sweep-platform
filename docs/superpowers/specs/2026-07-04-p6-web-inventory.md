# P6 Web-Reality Inventory

**Date:** 2026-07-04 · **Method:** 48-agent audit (one per source file + 6
cross-cutting contract checks), zero API budget — the P5 feed-check precedent
applied to web/. Baseline at audit time: api 412 / web 436, web unmodified
since the fork. This note sizes decisions (a) scope and (b) wire rename.

## Headline

42 files audited (39 src modules + styles.css + desktop.css + index.html):
**1 rebuild · 15 rework · 4 relabel · 22 keep.** The coupling is concentrated:
half the modules port untouched; the soccer weight sits in the screens, the
assembly layer, and the reaction renderer. Two served bootstrap seams
(`readOnly`, `wageringEnabled`) die at web's `DATA_KEYS` whitelist
(`data.js:24-27`) — and **`sport`/`hasDraws` are not on the wire at all**:
one additive API change is required before any vocab layer can exist
(bootstrap gains `competition: {sport, hasDraws, name, season, format, logo}`
via one competition select + `sportConfig`; `requireSweep` already resolved
the sweep row).

## Per-file disposition

| Disposition | File | LOC | Coupling (count) — what |
|---|---|---|---|
| **rebuild** | screens-main.jsx | 935 | 28 — ~half the file is hardcoded WC2026: R32_DEFS bracket, BracketView, KnockoutsScreen, group-stage standings/pick-sheet grouping, scorer/cards summaries |
| rework | screens-detail.jsx | 1614 | 27 — draw-backer + 3-way prob bars branch on `stage==='group'` not hasDraws; Starting XI/formations/shootout sections; TeamsScreen PTS group column |
| rework | screens-coins.jsx | 820 | 17 — headline market hardcoded `toq→1x2` (:744); bettable filter requires toq/1x2 (:671) so ml-only fixtures invisible; "+N more" counts all keys (:786); `WAGERS_END='19 July 2026'` (:574); unconditional Draw |
| rework | components.jsx | 781 | 26 — CrowdPick draw zone off `stage==='group'` (:262); ProbBar 3-way; SquadList position buckets; PenScore; GROUP footer; Icon.ball; WORLD CUP 2026 (:417,:593); knockouts nav |
| rework | lib/assemble.js | 326 | 23 — prob helpers hardcode 1X2 draw shape; `KNOWN_KO_TEAMS` WC R32 codes (:203-206); KO_ROUNDS=5 (:248); standings gf/ga/gd; strength→outlook/title-odds off soccer meta |
| rework | screens-bet-detail.jsx | 215 | 17 — MARKET_ORDER 11 soccer keys (:14), :80 filter silently drops ml/ou/hcap; TEAM_MARKETS (:16) missing ml/hcap |
| rework | SweepDraw.jsx | 247 | 4 — flagcdn team rendering; Icon.ball "Run sweep" |
| rework | App.jsx | 196 | 15 — TABS hardcodes knockouts + coins (:29); unconditional KnockoutsScreen; `match_open` GA event; natural consumer for readOnly/wageringEnabled gating |
| rework | FloatingReactions.jsx | 196 | 14 — BET_MARKET_NAMES soccer-only (:86) so ml/ou/hcap fall to "Bet"; goal ⚽/card 🟥🟨/Kick-off renderers; unconditional Draw 🤝; flags throughout |
| rework | SweepProvider.jsx | 151 | 3 — GateBrand "WORLD CUP 2026" + trophy.png (:27-34; renders PRE-bootstrap → needs platform-brand fallback, not competition data); the bootstrap consumer = natural seam home |
| rework | social.js | 134 | 8 — DRAW sentinel, tie-score→DRAW fallback, home/draw/away `vote_cast` mapping: unconditional 3-way, must branch on hasDraws |
| rework | coins.js | 102 | 2 — `canWager()` (:29) checks only adult+optout, never wageringEnabled; `bet_placed` GA carries market key |
| rework | data.js | 59 | 6 — DATA_KEYS/emptySweep need slots for sport/hasDraws/readOnly/wageringEnabled (whitelist currently drops the served seams) |
| rework | lib/format.js | 58 | 11 — `flag()` = flagcdn country assumption; `gd()` goals; `liveLabel()` HT/ET/Pens phases; date/time fns keep |
| rework | lib/betLabels.js | 44 | 18 — market table 100% soccer keys; unconditional DRAW wording; needs ml/ou/hcap entries + line rendering |
| rework | styles.css | 1488 | 27 clusters — 3:2 country-flag boxes ~30 rules (need square/logo emblem variant); bracket layout (.b-half/.b-sf-group/…); .coin-mkt.cs/.gs market-key classes; referee-card chips |
| relabel | desktop.css | 195 | 16 — vocabulary only (coin-*, match-line/mgrid, flag sizing, comments) |
| relabel | screens-statement.jsx | 119 | 6 — "Yowie Dollars" brand, "Your team won"/WC-reward copy; logic sport-agnostic |
| relabel | lib/analytics.js | 49 | 2 — default GA4 ID `G-6PZ0DXRS2D` is the **WC property**; platform needs its own (or VITE_GA_ID) |
| relabel | index.html | 43 | 2 — title "The Sweep — World Cup 2026"; theme `#0b1f3a` WC navy (brand call) |
| keep | api/client.js | 113 | endpoint plumbing; market/bootstrap payloads pass through opaquely; `/api/coins` path is API-fixed |
| keep | hooks/useEventStream.js | 78 | goal/card branches mirror the stable API's event vocab, forward opaquely (reaction *renderer* is the rework, not the router) |
| keep | betslip.js · coins-store math | 37 | market keys opaque — ml/ou/hcap flow through unchanged |
| keep | 19 more: admin.js, sweeps.js, optout.js, spoiler.js, notifications.js, main.jsx, SuperRoot.jsx, screens-super.jsx, InstallPrompt.jsx, hooks/useInstallPrompt.js, sw.js, sw-routes.js, lib/{allocate, analytics-mechanics, bootstrapJoin, celebrate, joinLink, registerSW, superRoute, sweepDraw} | ~800 total | zero or comment-only coupling |

`screens-super.jsx:18` `readOnly` = **red herring confirmed**: standard React
DOM attribute on LinkField's `<input>` (tap-to-select token link). No action.

## Bootstrap contract (served vs consumed)

Exactly 7 fields (`api/src/routes/bootstrap.js:22-30`):

| Field | Web consumption | Verdict |
|---|---|---|
| `teams[]` | fully consumed; `{group,pool,strength,squad}` lifted from soccer `competitor.meta` — **all four null on NBA** → breaks outlook, title odds, group standings (assemble.js:3-8,124-139) | rework |
| `people[]`, `ownership`, `sweep{id,name,role}` | consumed | keep |
| `scoring{rule,coOwners}` | stored as `SWEEP.scoring`, **never rendered by any component** | dead weight; wire up or ignore |
| `readOnly` | **UNCONSUMED** (dropped by DATA_KEYS) — lapsed sweep UI looks writable, 403s on submit | consume: banner + disable writes |
| `wageringEnabled` | **UNCONSUMED** — coins tab always visible, writes 403 `wagering_disabled` | consume: gate the tab |
| *(sport/hasDraws/competition)* | **absent from the wire entirely**; web has zero refs to sport anywhere — all draw logic branches on `f.stage==='group'` instead | **additive API change required** |

## Market spine + the "+N more" drift, precisely

- API registry: **14 gradable keys** (`api/src/wagering/markets.js:45-138`);
  all 14 placeable (`routes/coins.js:13`). Soccer provider offers **12** incl.
  `hcap` (mapping.js:220); never `ml`/`ou`. Basketball offers none (odds-less
  free tier).
- Web renders **11** (MARKET_ORDER, screens-bet-detail.jsx:14). The drift:
  screens-coins.jsx:786 counts `Object.keys(f.markets).length - 1` —
  registry-blind — so `hcap` is counted but unrenderable on tap-through.
  Over-advertises by exactly 1 on every soccer fixture carrying Asian
  Handicap, live today.
- Worse on basketball arrival: list filter `toq||1x2` (screens-coins.jsx:671)
  means ml-only fixtures **never appear at all**.
- Fix set (structural, not key-by-key): share one renderable-key list between
  the two screens; add ml/ou/hcap to MARKET_ORDER + TEAM_MARKETS + betLabels
  (labels, selection branches: ml→team, ou→O/U+line, hcap→team+signed line);
  headline fallback `toq→1x2→ml`; count only renderable keys.
  `coins.js`/`betslip.js` need **zero** changes (market-agnostic).
- Bet wire shape web must render: `{id, fixtureId, market, selection,
  line:number|null, stake, odds, book, potentialPayout, status, placedAt,
  settledAt}`; parlay wraps `legs:[bet]`.

## Test suite map (the 436 bar)

436 tests / 40 files, all green. Split: **~200 break on rework** (class b:
shootouts, cards, goalscorers, DRAW sentinel, flags — components.test 74,
screens-detail.test 60, assemble.test 26 are the big three), **~60
fixture/label-only**, **~176 fully stable** (client 33, PWA 27, stores,
routing). DRAW-sentinel logic is pinned across 5 files (assemble, social,
components, screens-detail, FloatingReactions) — the hasDraws branch touches
all of them. **No shared fixture factory exists** — every coupled test builds
its own inline soccer bootstrap stub; a shared multi-sport fixture builder is
the first test-infrastructure task or the migration is 13× per-file. Seams
(`readOnly`/`wageringEnabled`/`sport`/`hasDraws`) have zero test references —
SweepProvider/data tests are their natural landing.

## Self-serve + billing surface (decision-a sizing)

- **Auth gotcha:** account layer is `x-account-token` **header** auth
  (localStorage), a second mechanism parallel to the sweep httpOnly cookie.
  The account API client wrapper + {400,401,402,403,409,503}→UI-state map is
  where the cost concentrates, not screen count.
- 10 endpoints, all built (P3/P4): login (5/15min rate limit; sendMail is a
  console logger — copy must not over-promise email), session redeem (creates
  account, no signup flow), whoami, catalog (max 50 curated rows, has `sport`
  per row — feeds the vocab layer), provision (402/403-cap/400/500 semantics;
  **synchronous feed sync → seconds-long request, needs real pending UX**;
  takes `wageringEnabled`), my-sweeps (includes archived), archive, checkout
  (409 already_subscribed), portal (409 not_subscribed), billing state.
- **Mandatory regardless of (a):** the API hardcodes redirect landings
  `/account/billing/success|cancelled` on platformHost (billing.js:31-32) and
  the magic-link path `/account/login/{token}` — a billing UI can't ship
  without at least the two static routes.
- Sizing: **self-serve = 4 screens + 1 redeem route** (sign-in, redeem,
  catalog+provision-modal, my-sweeps). **Billing UI = 0 full screens** — one
  4-state panel (fresh/trialing/subscribed/lapsed) on my-sweeps + the 2
  static routes; near-free once the account shell exists, awkward orphan
  without it (no signed-in surface to hang it on).

## Survival map (must ride through untouched)

- **PWA:** injectManifest contract = pwa.config.js only; manifest is
  hand-authored (`manifest:false`). **Art swap under same filenames =
  zero-code rebrand**; renaming files breaks literal refs
  (InstallPrompt.jsx:44) and the `favicon.svg` globIgnore (it's **3.4 MB of
  embedded WC raster** — replace with a small SVG). sw.js/sw-routes cache
  names already platform-branded (`sweep-*`). sw.js:52 reserves the
  match-reminders push marker — survives; future payload copy must come from
  the vocab layer.
- **GA4:** mechanics keep; default ID is the WC property — new property or
  VITE_GA_ID before deploy. Event vocab (`match_open`, `vote_cast{pick}`,
  pageview paths `/knockouts`,`/coins`) renames cleanly IF done at the same
  time as the property switch — one clean break, no continuity loss.
- **Platform-host:** brief correction — **PLATFORM_HOST logic is server-side
  only** (api/src/sweeps/resolve.js:11-33); web is host-agnostic (relative
  `/api` + credentials:include) and survives untouched. `/super` mount
  bypasses the Gate (main.jsx:16-24) — untouched.

## What this sizes

**(a) scope:** reskin core = 1 rebuild + 15 rework + 4 relabel + ~260 tests
touched + a shared fixture factory. Self-serve adds 4 screens + 1 route + the
header-token client — roughly a quarter to a third on top, mostly greenfield
(no soccer debt in it), and billing UI (already in scope) needs its account
shell anyway. **(b) rename:** web treats market keys and `/api/coins` paths
as opaque/API-fixed in every store (client.js, coins.js, betslip.js) — a wire
rename buys zero web simplification and costs api-test churn + GA continuity;
labels-only is structurally supported. GA route names (`/coins`→`/wagers`)
are web-local and renameable without the API.
