# P4 unit economics — feed cost per active sweep vs $5/mo

**Status:** Full model, owner-confirmed 2026-07-04 (the §9 waiver expired at
phase 4; CLAUDE.md gate satisfied). Request counts are derived from the shipped
worker/poller code, not estimates; plan limits from the live-verified
catalog-shape note (`2026-07-04-p3-catalog-shape.md`); pricing per the API-Sports
published tiers (verified 2026-07-04, see §3).

**Headline: the model works, with one structural condition — football
competitions must be shared.** A football competition costs **$6–10/mo** of
feed capacity at Pro-tier pricing — a single $5 sweep does not cover it alone;
**~2 sweeps on the same competition break even**, and at Ultra it drops to
**$1.16/competition** (one sweep covers four competitions' worth). Basketball-
style baseline-only sports are ~free. Curation is the throttle that keeps the
denominator honest.

## 1. Request cost per active competition (from code)

All numbers are per ACTIVE competition — a competition with ≥1 unarchived
(P4: ≥1 live) sweep. N sweeps on one competition = one poll (worker
`activeCompetitions()` dedupe, feasibility §7).

**Football (live sport), EPL-class (20 teams, ~10 matches/wk):**

| Source | Calls | Per day |
|---|---|---|
| Baseline 4×/day: `/fixtures` + `/standings` | 2 × 4 | 8 |
| Odds loop 4×/day: non-final fixtures ≤7d out (~10/wk) × 1–2 (`/odds`, `/predictions` fallback) | ~15 × 4 | ~60 |
| Live tick (60s, ko−10m → ko+150m, ~120 ticks/match): per live match `/fixtures/events` + `/fixtures/statistics` = 2/tick + shared batched scores (`ids=` ≤20/call) + ~1 lineup call | ~270/match | matchday only |
| **Steady day (no matches)** | | **~70** |
| **Peak matchday (8–10 matches, weekend cluster)** | ~2,200–2,700 live + 70 | **~2,500** |

Season total ≈ 380 matches × ~270 + ~70/day × 270d ≈ **~120k requests/season**
≈ ~440/day averaged — but the binding constraint is the **peak day**, because
European leagues all play the same weekend and daily caps reset daily.

**Basketball (baseline-only, `live: false` — no tick, no odds):**

| Source | Per day |
|---|---|
| Baseline 4×/day: games + standings | 8 |
| Daily feed-born roster re-sync | 2 |
| **Total** | **10** |

**Catalog:** 2/day total across ALL competitions (1 `/leagues` per provider).

## 2. Competitions per key (peak-day bound)

- **Football Pro (7,500/day):** 7,500 ÷ ~2,500 peak = **2–3 EPL-class
  competitions per key** (3 is zero-headroom; call it 2 + margin). Note: the
  current Pro key is shared with the live WC app through 2026-07-07 — after
  that it is entirely ours.
- **Football Ultra (75,000/day):** ~**25–30** EPL-class competitions.
- **Basketball Free (100/day):** catalog 2 + ~**8–9 competitions**. Any paid
  basketball tier makes basketball a rounding error (10/day per competition).

## 3. Plan pricing (verified 2026-07-04)

| API | Tier | Limit/day | Rate/min | Price/mo |
|---|---|---|---|---|
| Football | Free | 100 | — | $0 |
| Football | Pro | 7,500 | ~300 | **$19** |
| Football | Ultra | 75,000 | 450 | **$29** |
| Football | Mega | 150,000 | 900 | **$39** |
| Basketball | Free | 100 | — | $0 |
| Basketball | Pro | 7,500 | ~300 | **$19** |

Pricing is **per-API** (each sport subscribed separately — matches our own
account: football Pro + basketball Free on one key). Source:
api-football.com/pricing via web search 2026-07-04 (the pricing pages 403
behind Cloudflare for direct fetch; Pro=7,500/day cross-checks against the
live `/status` capture in the catalog-shape note). Per-minute limits only
matter at Ultra scale: ~25 concurrent football competitions × ~10 live
matches × 2 calls/min ≈ 500/min brushes Ultra's 450/min — batch or stagger
the tick before that point.

## 4. Revenue per sweep, net

$5.00 − Stripe (2.9% + $0.30) = **$4.56/sweep/mo** (≈$4.50 after Stripe
Billing's recurring fee, if it applies to the chosen integration).

## 5. Break-even: sweeps per football competition

feed cost/competition/mo = tier price ÷ competitions-per-key (peak-bound):

| Tier | Cost per competition | Sweeps to break even |
|---|---|---|
| Pro ($19) ÷ 2 comps | $9.50 | **2.1** |
| Pro ($19) ÷ 3 comps | $6.33 | **1.4** |
| Ultra ($29) ÷ 25 comps | $1.16 | **0.25** |
| Mega ($39) ÷ 55 comps | $0.71 | **0.16** |

Basketball: ~10 req/day rides free-tier or costs cents at any paid tier —
**every basketball sweep is ~pure margin**.

## 6. What this decides for the P4 design

1. **Lapse gating is a cost control, not just product policy.** A lapsed/
   trial-expired sweep must drop its competition from `activeCompetitions()`
   (unless another live sweep shares it) — dormant competitions must cost 0.
2. **Trial burn is bounded and acceptable:** a 14d cardless trial on a fresh
   EPL-class competition ≈ 4 matchdays ≈ ~11k requests with $0 revenue —
   fine on Ultra, noticeable on Pro. Trial sweeps predominantly land on
   already-shared big leagues (that's why they're curated), so marginal trial
   cost is usually ~0.
3. **Curation stays the throttle.** Each newly curated football league
   commits ~2,500 peak-day requests if anyone provisions it. Curating a
   league is a capacity decision, not a UX decision.
4. **Football scaling path:** stay on Pro (shared with nothing after
   2026-07-07) while ≤2 football competitions are live; first upgrade
   trigger is the 3rd concurrently-active football competition.

## 7. Sensitivities / landmines found while modeling (feed-budget bugs, not billing)

- **Lineup polling retries every tick until the provider publishes** —
  a league WITHOUT lineup coverage burns up to ~195 calls/match for nothing.
  The catalog carries per-season coverage flags; gate `pollLineups` on them
  (or cap attempts) before curating any league beyond the big five.
- **The 24h recovery arm** re-polls a stuck non-final fixture (postponement,
  abandonment) every tick — worst case ~2,900 calls/day until it ages out.
  Known, bounded, acceptable; worth a status-based exclusion eventually.

Neither blocks P4; both are cheap worker guards if curation widens.
