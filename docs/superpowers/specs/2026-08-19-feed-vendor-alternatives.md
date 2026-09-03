# Feed vendor alternatives — research read

**Date:** 2026-08-19 · **Question:** API-Sports charges per sport; at 5 sports that's
5 subscriptions. What are the alternatives?

**Answer: the per-sport price is not the problem, and it's smaller than we assumed.
Our poller is the problem. Fix the poller, stay on API-Sports, buy sports on demand.**

Method: 6 parallel research lanes (incumbent, commercial aggregators, free/official
feeds, odds-only vendors, push-vs-poll, licensing), each adversarially fact-checked,
then every decision-critical number re-verified by hand against the live API and the
live pricing pages. Numbers below marked **[verified]** were confirmed in this session.

---

## 1. What we got wrong

Three assumptions the research overturned:

| We assumed | Reality **[verified]** |
|---|---|
| Every sport costs ~$19/mo like football | Football is the **only** $19 API. AFL, baseball, basketball, handball, hockey, NBA, NFL, rugby, volleyball are all **$15/$25/$35** (PRO/ULTRA/MEGA) |
| 5 sports ≈ $95–145/mo | 5 sports on PRO = **$79/mo** monthly, or **$55.30/mo** on 12-month prepay (−30%) |
| Peak matchday ≈ 2,500 req/competition (P4 spec) | ≈ **3,700**. The spec modelled 120 ticks; the code's window is 160 min at 60s = **160 ticks**. Pro holds **2** soccer competitions, not 2–3 |

And one thing nobody was looking for:

> **The football key is on the Free plan right now — 100 req/day, expires 2026-09-09.**
> `fetchResults` uses `/fixtures?ids=`, which Free blocks. It returns **HTTP 200** with
> `{"errors":{"plan":"Free plans do not have access to the Ids parameter."},"results":0}`.
> `api-sports-base.js` never inspects `j.errors`, so `api-football-provider.js` does
> `j.response ?? []` → `[]` → `pollLive` writes `syncLog status:'ok'`.
> **Live scores are silently returning nothing, and the sync log says everything is fine.**
> Reproduced live this session. Quota exhaustion presents identically.

---

## 2. Verified prices

`api-sports.io/sports/<slug>` pricing cards, read 2026-08-19 **[verified]**:

| Sport API | PRO (7,500/day) | ULTRA (75,000/day) | MEGA (150,000/day) |
|---|---|---|---|
| football | **$19** | $29 | $39 |
| afl · baseball · basketball · handball · hockey · nba · nfl · rugby · volleyball | **$15** | $25 | $35 |

- **−30% on 12-month prepay** — AFL PRO $180/yr → **$126/yr = $10.50/mo** **[verified]**.
  Football PRO → $159.60/yr = $13.30/mo.
- **No bundle exists.** One key authenticates against every sport host, but each carries
  its own independent quota and expiry — confirmed against 5 hosts simultaneously,
  each returning its own free 100/day counter **[verified]**.
- All paid tiers: *"ALL Endpoints, ALL Competitions"*. Odds included at every tier
  including Free.
- Hard daily cap, **no overage** — at the limit requests fail until 00:00 UTC.
- Prepay is all-sales-final, and **downgrades are not possible**. Start monthly.

**5-sport totals:** soccer + NBA + NFL + NHL + MLB on PRO = $19 + 4×$15 = **$79/mo**
monthly, **$55.30/mo** on annual. Against $4.56 net per sweep, that's ~17 paying sweeps
to cover the whole feed at monthly rates, ~12 at annual.

---

## 3. The real cost driver — our own tick

`worker.js:99-155` runs a 60s tick. Per live fixture it calls **three** endpoints:

```
pollLive(liveIds)        → 1 batched /fixtures?ids=   (shared, 20 fixtures/call)
pollEvents(liveIds)      → 1 call PER FIXTURE          ← live-poller.js:139
pollStatistics(liveIds)  → 1 call PER FIXTURE          ← live-poller.js:180
```

Peak matchday, EPL-class, 10 concurrent matches, 160-tick window:

| | calls |
|---|---|
| `fetchResults` — 1 batched call/tick | 160 |
| `fetchEvents` — per fixture, per tick | 1,600 |
| `fetchStatistics` — per fixture, per tick | 1,600 |
| `fetchLineups` — per fixture until published | ~300 |
| baseline ×4/day + odds loop | ~70 |
| **total** | **~3,730** |

**~93% of that is bytes we already paid for.** `GET /fixtures?id=<one>` returns
`events`, `lineups`, `statistics` and `players` **inline** — verified live against
fixture 867946 (Crystal Palace v Arsenal): `events` 12 entries, `lineups` 2 entries
with `formation` + `startXI` (11) + `substitutes` (9), `statistics` 2 teams × 16
**[verified]**. Identical shapes to what `mapEvents`/`mapLineups`/`mapStatistics`
already consume. We make three requests a minute per match for data the first request
already carried.

Also verified: `/fixtures?live=all` returns **every in-play fixture worldwide in one
page** (33 at time of test) with `events` inline, and it **works on the Free key**
against the current season — so the hybrid design below is testable before spending
anything **[verified]**.

### Fixes, ranked

| | Change | File | Effort | Effect |
|---|---|---|---|---|
| **A** | **Check `j.errors`.** `errors` is `[]` when healthy, an **object** when not — check both shapes and throw. Without this, nothing else is observable. | `providers/api-sports-base.js:7-21` | 15 min | catches the live silent failure |
| **B** | **Use the inline objects.** Have `fetchResults` return `events`/`lineups`/`statistics` alongside the mapped fixture; delete the three separate calls from the tick. | `api-football-provider.js`, `worker.js:117-131` | ½ day | 3 calls/fixture/tick → 1 |
| **C** | **Skip finals in the in-window arm.** `fixturesToPoll` is purely time-based — a match final at ko+115m keeps drawing calls to ko+150m. Add `r.status !== 'final' &&`. | `live-poller.js:28` | 10 min | ~20% of the window |
| **D** | **Split the recovery ids.** The 24h recovery arm returns into the *same* array fed to `pollEvents`/`pollStatistics`. One postponed fixture = 1,440 ticks × 2 = **2,880 req/day**, silently (see A). Return `{live, recover}`; poll recover through `pollLive` only, every 15 min. | `live-poller.js:23-32` | 1 hr | 0 normally, 2,880/day per stuck fixture on a bad day |
| **E** | **`live=all` hybrid** — one global call/tick for scores+events across *all* competitions; `?id=` at 5–15 min for statistics/lineups and at FT for the final transition. **`live=all` cannot replace the per-fixture poll**: it drops a match the instant it ends, and `final` is what fires `settleBets`/`grantMatchRewards`/`recomputeStandings`. | `worker.js`, `live-poller.js` | 1–2 days | see table |

| Scenario | peak req/day/comp | Comps per PRO $19 | $/comp/mo |
|---|---|---|---|
| Today | ~3,730 | **2** | $9.50 |
| A–D | ~1,670 | **4** | $4.75 |
| A–E (stats at 15 min) | ~110 + ~480 shared | **15–25** | **$0.76–1.27** |

Target was $1–2/competition/month. A–D alone doesn't reach it; A–E does.

**Cancel one backlog item:** P4's *"gate `pollLineups` on per-season coverage flags"*
is obsoleted by change B — uncovered leagues return `lineups: []` on the same single
call, so the flag stops mattering.

---

## 4. What the alternatives actually offer

Full vendor sweep. Nothing beats "fix the tick and stay" on effort-adjusted cost.

**Worth keeping in the drawer:**

| Vendor | Price | Why it's on the list | Why not now |
|---|---|---|---|
| **Highlightly** | $12.49 PRO / $25.99 ULTRA, **9 sports, one pooled quota**, odds included | Only credible flat multi-sport price. ToS §6.1 expressly allows distribution and storage | Its headline advantage — inline match objects killing our fan-out — was **refuted**: `/matches` returns *"only general match information"*; events/statistics are still per-match. §7 prohibits use supporting any *"wagering"* operation. No NRL, no AFL. Hard cap, zero overage, at every tier. Status page shows a 7h56m outage 2026-07-20. **Revisit when the 3rd paid sport goes live** |
| **The Odds API** | $30/mo | Best licensing found (*"commercial use, provided our data is not the primary product"*); Australian entity; `/sports` and `/events` cost **0 credits**; only vendor covering `aussierules_afl` and `rugbyleague_nrl` | Odds are already bundled free in every API-Sports tier. **Buy only when AFL/NRL wagering ships** |
| **Squiggle** (AFL) | free, SSE push, commercial use granted in writing | Real push feed, zero cost | REST is deliberately stale (games 60s, standings 5 min); **SSE is mandatory for live AFL**. Requires a contact email in the User-Agent (bare curl → 403) |
| **TheSportsDB** | $9–20 flat | Most permissive terms found; only vendor flagging per-asset Creative-Commons status on artwork | Standings are *"featured soccer leagues ONLY"*; returns **HTTP 200 with a zero-byte body** for NFL/MLB/NRL. Buy the $9 tier for CC-safe artwork and NRL schedule, never as the spine |

**Killed** (reason in one line):

- **live-score-api.com** (€11, 14,500/day, soft overage) — logos under CC **NonCommercial**, feed scoped to *"private use"*, €75 late fee, 10.25% daily-compounded interest on unpaid overage.
- **AllSportsAPI** ($149 websockets) — *"solely for your personal, **non-commercial** use"*.
- **football-data.org** (€49/30 comps) — after cancellation you may not *"reference the football data… on their own site or service"*. A sweep's whole value is the persistent season record.
- **TheRundown** (free 20k/day) — caching capped at 24h, redistribution prohibited.
- **BetsAPI** ($10–30/sport, covers our entire wishlist) — `/l/terms` and `/mm/terms` both **404**. No terms of service exists at all; the docs are organised per-bookmaker.
- **ESPN / MLB StatsAPI / NHL api-web / NBA stats** ($0, covers all 7 sports incl. NRL and AFL) — Disney ToU bans commercial use in four clauses; MLB ships *"non-commercial, non-bulk use"* in every response; NHL ToS §7 specifically bans use for **subscription** revenue. **Prototyping only.**
- **Goalserve** — right pricing *shape* (flat, unlimited), wrong number: $300/mo soccer-only, $800 all-sports, +$200 websockets. Revisit at ~150 paying sweeps.
- **Sportradar / Stats Perform / Genius / SportsDataIO / Broadage / OddsJam / OpticOdds** — contact-sales, enterprise minimums. Sportradar additionally requires destroying all data on termination.
- **SportDevs** — domain does not resolve (two independent resolvers).
- **API4Sports / api-baseball.com** — API-Sports lookalike, domains registered 2025-07 behind privacy shields, $25 for 1,000 calls/**month** vs $19 for 7,500/**day**. Do not credential.
- **RapidAPI as an overage escape hatch** — API-Sports' listings are delisted (307 → NOT_FOUND), though their own ToS still documents RapidAPI overages. One support question before writing it off.

---

## 5. Recommended architecture, sport by sport

The adapter interface already makes per-sport vendor mixing cheap. Use it — don't consolidate.

| Sport | Vendor | Verified |
|---|---|---|
| **Soccer** | API-Sports `v3.football` — $19 PRO | 1,240 leagues, `/leagues` carries `seasons[].current` (the picker needs this), 33 bookmakers |
| **NBA** | API-Sports `v1.basketball` league 12 — **$15**, not `v2.nba` | `v1.basketball/bets` → **245 bet types**. `v2.nba` has no odds endpoint at all |
| **NFL** | API-Sports `v1.american-football` — $15 | NFL league id 1, 17 seasons, 2026 current. ⚠️ `coverage.standings: false` on 2026 — but `/standings?league=1&season=2023` returned **32 rows**, so compute or trust-but-verify |
| **NHL** | API-Sports `v1.hockey` — $15 | NHL present in 262 leagues; standings OK |
| **MLB** | API-Sports `v1.baseball` — $15 | MLB present in 77 leagues; standings OK |
| **AFL** | API-Sports `v1.afl` ($15) for results/standings; **Squiggle (free, SSE)** for live | AFL Premiership, 16 seasons |
| **NRL** | ⚠️ **no affordable legal source** | Rugby API returns **144 leagues, union only — no NRL** [verified]. TheSportsDB has the schedule but 200+0-byte standings. The Odds API covers `rugbyleague_nrl` for odds only. **Defer.** |

**Odds caveat.** `/odds` exists on every sport host, but `/bets` (the market taxonomy)
exists **only** on football and basketball — NFL/NHL/MLB/AFL/rugby return
`{"endpoint":"This endpoint do not exist."}` **[verified]**. And odds are pre-match
only, so the Free tier's 2022–2024 season window can never contain any. **Non-football
odds quality is unverifiable without paying $15.** Buy one month of one sport to check
before promising wagering on it.

---

## 6. Do this, in order

1. **Change A** (15 min) — `j.errors`. Until this lands, nothing else is observable.
2. **Re-subscribe football PRO, $19 monthly** (not the prepay — no downgrades ever).
3. **Same hour:** `curl '…/fixtures?ids=867946-867947'` on the paid key. If plural `ids=`
   also embeds `events`/`lineups`/`statistics`, change B gets ~20× better than the
   singular path. Singular embedding is proven; plural is untestable on Free.
4. **Changes B, C, D** (~1 day). Re-measure a real matchday against `sync_log`.
5. **Change E** if step 4 doesn't clear the $1–2/comp target.
6. **Buy a sport when a paying sweep asks for it — $15 each.** Not before.
7. **Build the admin re-settle override.** No vendor ships corrections, and API-Sports'
   ToS says bad data *"does not constitute a valid reason for a refund"*. A wrong score
   settles a sweep wrong; there is currently no way to undo that by hand. This is a
   mandatory feature, and it's the only genuinely new build this research surfaced.

## 7. Still open

- **Non-football odds quality** — unverifiable without buying a month (§5).
- **Club crest rights.** Every vendor disclaims logo IP and pushes it onto us. Cheapest
  posture: serve logos from the vendor's CDN URL, never re-host — which is what we do.
  TheSportsDB is the only vendor that flags per-asset CC status. Vendor-hosted widgets
  are the licence-shifting option nobody costed.
- **PRO's per-minute rate limit** — unread. ToS calls a breach *"material"* (suspension,
  no refund). Change E must fit under it.
- **Play-money wagering under the Interactive Gambling Act 2001** — whether a $5/mo
  subscription is consideration for a chance to win is a question no vendor doc answers.
  API-Sports' own ToS is narrower than feared (it bans *reselling the feed*, names
  *"fantasy soccer games"* as an intended use, has **no anti-caching clause and no
  attribution requirement**) but warns that betting/fantasy platforms *"may require
  additional licenses"*.
- **Mid-season backfill** — a sweep created in March for an August season. Free tiers
  are season-gated; odds windows are narrow. Unbudgeted.
