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

- **Whose:** the caller's *own* statement only. Reached from the wallet header on the
  Wagers tab. No viewing other people's statements (the public People → Yowie Dollars list
  already exposes balances; per-entry history stays private for now).
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

- Auth: `member | admin` (same guard pattern as `GET /api/coins`).
- **Own-person guard:** `personId` must match the authenticated caller's person; otherwise
  403. (Admins included — this is a personal statement, not a moderation tool.)
- Reads `coin_ledger` rows for `(sweepId, personId)`.
- Left-joins `bet` on `refId = bet.id` (for `stake`/`payout`/`refund` rows) and `fixture`
  on `bet.fixtureId` for team names.
- Computes **running balance** server-side: order ascending by `(createdAt, id)`, take a
  cumulative sum, attach `balanceAfter` to each row, then return **newest first**
  (descending by `(createdAt, id)`). The final row's `balanceAfter` equals the wallet
  balance from `GET /api/coins`.
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
        "bet": {
          "homeTeam": "Brazil",
          "awayTeam": "Croatia",
          "market": "1x2",
          "selection": "home",
          "line": null,
          "status": "won"
        }
      },
      {
        "id": 12,
        "type": "grant",
        "amount": 1000,
        "createdAt": "2026-06-09T00:00:00.000Z",
        "balanceAfter": 1000,
        "bet": null,
        "weekIndex": 0
      }
    ]
  }
  ```

  - `bet` is `null` for `grant` rows. `weekIndex` (parsed from `refId`) is present on grant
    rows so the client can distinguish "Starting bankroll" (week 0) from "Weekly Yowie
    Dollars" (week n).
  - For `stake`/`payout` rows whose bet/fixture has been pruned from the feed, `bet` may be
    `null` — the client falls back to a generic label.
- Sweep-isolated like every other route (scoped by `sweepId` from the session).
- Composing logic lives next to `walletFor`/`leaderboard` in `api/src/coins/ledger.js`
  (e.g. a `statementFor(db, sweepId, personId)`), keeping the route thin.

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
  selection/market formatter** (whatever `MyBets`/`BetSheet` already use) so selection
  wording stays DRY and consistent:
  - `grant`, `weekIndex === 0` → **"Starting bankroll"**
  - `grant`, `weekIndex > 0` → **"Weekly Yowie Dollars"**
  - `stake` → **"Bet on {home} v {away} — {selection} ({Status})"** where `Status` is the
    bet's outcome (Open / Won / Lost / Refunded). Fallback "Bet placed" if `bet` is null.
  - `payout` → **"Won bet on {home} v {away} — {selection}"**. Fallback "Bet payout".
  - `refund` → **"Refund"** (defensive; unused today).
- **Routing (`web/src/App.jsx`):** register the overlay in the overlay switch with an
  `openStatement()` navigator (mirrors `openBet`/`betdetail`).
- **Entry point:** `WalletHeader` (`web/src/screens-coins.jsx`) gains a "View statement"
  link/button → `openStatement()`.
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

- Missing/invalid `personId`, or `personId` ≠ caller → 403 (own-person guard) / 400.
- Unauthenticated → 401 (existing auth middleware).
- Pruned bet/fixture → `bet: null` → generic fallback label (no crash).
- Frontend query error → inline error state in the overlay; balance still visible from the
  cached wallet.

## Testing (TDD)

**api (`api/src/.../*.test.js`, Vitest + Testcontainers):**
- grant rows return with correct `weekIndex` and `balanceAfter`;
- stake debit row (negative amount) joined to its bet + fixture team names;
- payout credit row for a won bet;
- a **lost** bet yields a lone stake row with `bet.status === "lost"` (no payout row);
- newest-first ordering; running-balance cumulative math; final `balanceAfter` == wallet
  balance;
- auth required; own-person guard (caller cannot fetch another person's ledger);
- sweep isolation (no cross-sweep rows).

**web (`web/src/screens-statement.test.jsx`, Vitest + RTL):**
- renders each row type with correct sign, colour, reason label, date, running balance;
- lost-bet stake row shows `(Lost)`;
- empty state;
- "View statement" link on the wallet header opens the overlay.

## YAGNI / non-goals

- No other-person statements, no admin adjustments, no refund-writing path, no export, no
  pagination (ledger is small), no day-grouping.
