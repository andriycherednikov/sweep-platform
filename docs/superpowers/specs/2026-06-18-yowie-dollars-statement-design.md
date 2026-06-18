# Yowie Dollars statement — design

**Date:** 2026-06-18
**Status:** Approved, ready for planning

## Problem

Participants can see their current Yowie Dollars *balance* (Wagers tab, People → Yowie
Dollars list, person detail) but have no way to see *how* that balance came to be — which
grants, bets, and payouts added or subtracted from it. The data already exists: every
credit and debit is one signed, append-only row in the `coin_ledger` table. It is simply
never exposed beyond a `SUM()` for the balance.

This adds a read-only **statement** screen: your own ledger history, newest first, with a
running balance and a plain-English reason per row.

## Scope

- **Whose:** your *own* statement. Reached from the Wagers tab. The endpoint takes a
  `personId` (the same trust model as `GET /api/coins`, which already accepts any
  `?personId=`) — "own" is enforced by the UI passing your own id, not by the server. This
  matches the existing model where balances are already public (People → Yowie Dollars list)
  and keeps us from inventing a person-level auth concept the backend doesn't have.
- **Detail:** each row shows match + selection (for bets) and the bet's outcome.
- **Layout:** flat list, newest first, each row labelled with its own date. No day-grouping
  (ledger volume is low — a handful of grants plus bets).
- **Running balance:** shown per row (balance *after* that entry).

Out of scope: admin manual adjustments, refunds (no code currently writes `refund` rows —
handled defensively but not exercised), editing/deleting ledger entries, exporting.

## Background — existing data model (already built)

- **`coin_ledger`** (`api/src/db/schema.js`): append-only signed rows.
  `{ id, sweepId, personId, type, amount, refId, createdAt }`.
  - `type` ∈ `grant | stake | payout | refund`.
  - `amount` is **signed** (positive = credit, negative = debit).
  - `refId` = week index (`"0"`, `"1"`…) for grants; the `bet.id` for stake/payout/refund.
  - Balance is derived: `balanceOf()` = `SUM(amount)` (`api/src/coins/ledger.js`).
- **`bet`** (`api/src/db/schema.js`): `{ id, sweepId, personId, fixtureId, selection,
  market, line, stake, oddsDecimal, book, potentialPayout, status, placedAt, settledAt }`.
  `status` ∈ `open | won | lost | refunded`.
- Ledger writes happen in exactly three places: `ensureGrants` (grants),
  `POST /api/bet` (stake debit), `settleBets()` (payout credit for winners only — **losers
  get no row**, so a lost bet appears as a lone stake debit).
- Constants (`api/src/coins/constants.js`): `STARTING_COINS = 1000` (week 0),
  `WEEKLY_COINS = 1000`.

## Design

### Backend — new endpoint

`GET /api/coins/ledger?personId=<id>`

- Auth: `member | admin` (same `requireSweep` guard as `GET /api/coins`). Sweep-isolated:
  all reads scoped by `req.sweep.id`.
- Person validation mirrors `GET /api/coins`: if `personId` is missing or not a member of
  this sweep, return `{ balance: 0, entries: [] }` (no error). No person-level "own" guard —
  the backend has no notion of the caller's person; the UI passes your own id.
- Runs `ensureGrants` first (so the statement matches the wallet, including any
  newly-due weekly grant), then reads `coin_ledger` rows for `(sweepId, personId)`.
- **No fixture join.** For `stake`/`payout`/`refund` rows it attaches the matching `bet`
  (looked up by `refId = bet.id`) serialized via the existing `serializeBet` from
  `ledger.js`. The web client already resolves team names + selection wording from the
  in-memory `SWEEP` data (`S.fixture(fixtureId)`, `betSelectionLabel`), so the server only
  needs the bet's own fields.
- Computes **running balance** server-side: order rows ascending by `(createdAt, id)`, take a
  cumulative sum, attach `balanceAfter` to each, then return **newest first** (reverse).
  The newest entry's `balanceAfter` equals the wallet `balance`.
- Response shape:

  ```json
  {
    "balance": 1730,
    "entries": [
      {
        "id": 42,
        "type": "payout",
        "amount": 230,
        "createdAt": "2026-06-18T12:00:00.000Z",
        "balanceAfter": 1730,
        "weekIndex": null,
        "bet": {
          "id": "uuid…", "fixtureId": "f1", "market": "1x2", "selection": "HOME",
          "line": null, "stake": 100, "odds": 2.3, "book": "Pinnacle",
          "potentialPayout": 230, "status": "won", "placedAt": "…", "settledAt": "…"
        }
      },
      {
        "id": 12, "type": "grant", "amount": 1000,
        "createdAt": "2026-06-09T00:00:00.000Z",
        "balanceAfter": 1000, "weekIndex": 0, "bet": null
      }
    ]
  }
  ```

  - `bet` is `null` for `grant` rows; `weekIndex` (parsed from `refId`) is set on grant rows
    (and `null` otherwise) so the client labels "Starting bankroll" (0) vs "Weekly Yowie
    Dollars" (>0).
  - For a `stake`/`payout` row whose bet was pruned from the feed, `bet` is `null` — the
    client falls back to a generic label.
- Composing logic lives next to `walletFor`/`leaderboard` in `api/src/coins/ledger.js` as a
  new `statementFor(db, sweepId, personId, now)`, keeping the route thin.

### Frontend

- **`web/src/api/client.js`:** add `fetchLedger(personId)` → `GET /api/coins/ledger?personId=`.
- **New overlay `web/src/screens-statement.jsx`** exporting `StatementScreen`:
  - Header: back button + "Statement" title + current balance (reuse `AppHeader` /
    `WalletHeader` conventions).
  - Scrollable flat list, newest first. Each row:
    - sign-coloured amount — green `+N` for credits, red `−N` for debits;
    - a one-line **reason label** (see below);
    - the entry **date** (formatted in local TZ, consistent with prediction-history dates);
    - muted **running balance** (`balanceAfter`) on the right.
  - Empty state when there are no entries yet (shouldn't happen once week-0 grant exists,
    but handle it).
- **Reason labels** — composed on the client, **reusing the bet-slip's existing
  selection/market formatter** (`betSelectionLabel`, `betSelectionFlag`, `MARKET_LABELS` —
  exported from `screens-coins.jsx` for reuse) so selection wording stays DRY and
  consistent. Team names come from `S.fixture(bet.fixtureId)` exactly as `MyBets` does:
  - `grant`, `weekIndex === 0` → **"Starting bankroll"**
  - `grant`, `weekIndex > 0` → **"Weekly Yowie Dollars"**
  - `stake` → **"Bet on {home} v {away} — {selection} ({Status})"** where `Status` is the
    bet's outcome (Open / Won / Lost / Refunded). Fallback "Bet placed" if `bet` is null.
  - `payout` → **"Won bet on {home} v {away} — {selection}"**. Fallback "Bet payout".
  - `refund` → **"Refund"** (defensive; unused today).
- **Routing (`web/src/App.jsx`):** register the overlay in the overlay switch with an
  `openStatement()` navigator (mirrors `openBet`/`betdetail`, `overlay.type === "statement"`).
- **Entry point:** a "View statement ›" affordance in the Wagers screen body
  (`CoinsScreen`), rendered above the tab toggle so it shows in *both* the desktop
  (`WalletHeader`) and mobile (`AppHeader`) layouts — mobile has no `WalletHeader`, so the
  link lives in the screen body, not the header. Calls `openStatement()`.
- **Data/query:** dedicated TanStack Query `['coins', 'ledger', personId]` (lazy — only
  fetched when the statement opens). Invalidated on `bet` and `bet-settled` SSE events
  (extend the existing handler in `web/src/hooks/useEventStream.js`, which already
  invalidates `['coins']`) so the statement stays live.

## Data flow

1. User taps "View statement" on the wallet header → `openStatement()` pushes the overlay.
2. `StatementScreen` mounts → `['coins','ledger', me.id]` query → `fetchLedger(me.id)` →
   `GET /api/coins/ledger`.
3. Backend reads ledger + joins bet/fixture, computes running balance, returns newest-first.
4. Screen renders rows; labels composed client-side.
5. When a bet is placed or settled, the SSE `bet`/`bet-settled` event invalidates the query
   → refetch → statement updates.

## Error handling

- Missing/unknown `personId` → `{ balance: 0, entries: [] }` (mirrors `/api/coins`).
- Unauthenticated → handled by the existing `requireSweep` middleware.
- Pruned bet → `bet: null` → generic fallback label (no crash).
- Frontend query error → inline error state in the overlay; balance still visible from the
  cached wallet store.

## Testing (TDD)

**api (`api/src/.../*.test.js`, Vitest + Testcontainers):**
- grant rows return with correct `weekIndex` and `balanceAfter`;
- stake debit row (negative amount) joined to its bet + fixture team names;
- payout credit row for a won bet;
- a **lost** bet yields a lone stake row with `bet.status === "lost"` (no payout row);
- newest-first ordering; running-balance cumulative math; newest `balanceAfter` == wallet
  balance;
- unknown / missing `personId` → `{ balance: 0, entries: [] }` (mirrors `/api/coins`);
- sweep isolation (no cross-sweep rows).

**web (`web/src/screens-statement.test.jsx`, Vitest + RTL):**
- renders each row type with correct sign, colour, reason label, date, running balance;
- lost-bet stake row shows `(Lost)`;
- empty state;
- the "View statement" affordance in `CoinsScreen` calls `openStatement`.

## YAGNI / non-goals

- No person-level auth (the backend has none; "own" is a UI convention), no admin
  adjustments, no refund-writing path, no export, no pagination (ledger is small), no
  day-grouping (flat list, each row dated).
