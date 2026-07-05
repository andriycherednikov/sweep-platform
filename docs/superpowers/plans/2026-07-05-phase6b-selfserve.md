# Phase 6b — Self-Serve Back Half Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The SaaS front door grows its missing half: browse the competition
catalog, provision a sweep from the UI (name + wagering toggle, real pending
state, full error map), and land back on my-sweeps with the invite links.

**Architecture:** Spec §9 of `docs/superpowers/specs/2026-07-04-phase6-frontend-reskin-design.md`.
Everything rides the existing P6a account shell: `web/src/AccountRoot.jsx`
(path-switch mini-router), `web/src/screens-account.jsx` (AccountHome/
BillingPanel/SweepList), `web/src/lib/accountClient.js` (header-token client,
errors throw `{status, code}`). No react-query in the account shell; plain
hooks. Wire (all built, P3/P4): `GET /api/catalog?sport=&q=` (≤50 curated
rows `{provider, sport, leagueId, name, type, logo, country{name,code,flag},
seasons:[{season,start,end,current,standings,odds}]}`, seasons newest-first);
`POST /api/account/sweeps {name, provider, leagueId, season,
wageringEnabled?}` → 201 `{id, name, memberLink, adminLink, …}` | 400
`unknown_competition` | 402 `subscription_required` | 403 `{error:'sweep_cap',
cap}` | 500 `provision_failed` (retryable). Provision runs a synchronous feed
sync in a row lock — seconds-long; the UI must show a real pending state.

**Tech Stack:** React 18, Vitest + RTL (vi.mock the accountClient). Browser
verification via claude-in-chrome against dev servers (`PLATFORM_HOST=localhost:3000`,
browse via 127.0.0.1 — see the P6a dev note).

## Global Constraints

- api/ is UNTOUCHED this plan (the self-serve API is complete). Bars at start: api 416 / web 514; both suites green at every commit; hooks run suites + build; never `--no-verify`.
- No browser `alert()`/`confirm()`; inline two-tap patterns only.
- Reuse P6a pieces: `call()`-based accountClient wrappers, `.sweep-card`/`.block`/`.cta` CSS, `LinkField` (exported from screens-super.jsx). No new deps.
- Stripe stays test mode; no deploy-gate work.
- Conventional Commits; push after each task; record the web bar per task in the SDD ledger.

## File Structure

- `web/src/lib/accountClient.js` — + `getCatalog(params)` (T1)
- `web/src/screens-catalog.jsx` — NEW: CatalogScreen + ProvisionSheet (T1/T2)
- `web/src/AccountRoot.jsx` — route `/account/new` → CatalogScreen (T1)
- `web/src/screens-account.jsx` — AccountHome links to `/account/new`; empty-state CTA; refresh after provision (T2)
- Tests: `web/src/screens-catalog.test.jsx` (new), `web/src/lib/accountClient.test.js`, `web/src/screens-account.test.jsx`

---

### Task 1: catalog client + screen

**Files:**
- Modify: `web/src/lib/accountClient.js`, `web/src/AccountRoot.jsx`
- Create: `web/src/screens-catalog.jsx`, `web/src/screens-catalog.test.jsx`
- Test also: `web/src/lib/accountClient.test.js`

**Interfaces:**
- Produces: `getCatalog({sport, q} = {})` → GET `/api/catalog` with only non-empty params in the query string, token header attached. `CatalogScreen({onBack})` rendered at `/account/new`; it renders sport filter chips (derived from the distinct `sport` values in the results + an All chip), a search input (fires only at ≥2 chars, else full curated list), and one row per league (logo img null-guarded, name, `country?.name`, season `<select>` from `seasons[]` defaulting to the first (newest)). Each row's "Set up sweep" button calls `onPick(row, season)` — T2 wires it; this task renders the button and exposes the callback prop.

- [ ] **Step 1: Failing tests.** accountClient.test.js: after `setAccountToken('t1')`, `getCatalog({sport:'basketball', q:'nb'})` fetches `/api/catalog?sport=basketball&q=nb` with the header; `getCatalog()` fetches bare `/api/catalog`. screens-catalog.test.jsx (vi.mock accountClient): renders rows from a 2-league mock (one football, one basketball, each 2 seasons); sport chip filters client-side… NO — re-query the API with the sport param (server is the filter; assert getCatalog called with `{sport:'basketball'}` when the chip is clicked); typing 1 char does NOT re-query, 2 chars does (`{q:'nb'}`); season select defaults to `seasons[0].season`; "Set up sweep" calls the `onPick` prop with `(row, selectedSeason)`.
- [ ] **Step 2: Run** (`cd web && npx vitest run src/screens-catalog.test.jsx src/lib/accountClient.test.js`) → FAIL.
- [ ] **Step 3: Implement.** accountClient.js:

```js
export const getCatalog = (params = {}) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString()
  return call('GET', `/api/catalog${qs ? `?${qs}` : ''}`)
}
```

screens-catalog.jsx: plain hooks; `useEffect` loads on mount and on (sport, debounced q≥2) change; loading line, error line with retry (reuse the account shell's inline-error pattern), empty-state "No competitions match." AccountRoot: `if (path === '/account/new') return <RequireAccount><CatalogScreen onBack={() => window.location.assign('/account')} …/></RequireAccount>` — follow the file's existing token-check pattern (reuse Entry's check or extract the small guard the same way the file already structures Redeem/Landing).
- [ ] **Step 4: Full web suite green; record the bar.**
- [ ] **Step 5: Commit** — `feat(web): self-serve catalog screen (sport filter, search, season picker)` — push.

---

### Task 2: provision flow (sheet, pending state, error map, my-sweeps hookup)

**Files:**
- Modify: `web/src/screens-catalog.jsx` (ProvisionSheet + onPick wiring), `web/src/screens-account.jsx` (empty-state CTA + "New sweep" button → `/account/new`)
- Test: `web/src/screens-catalog.test.jsx`, `web/src/screens-account.test.jsx`

**Interfaces:**
- Consumes: `createSweep` — ADD to accountClient: `export const createSweep = (body) => call('POST', '/api/account/sweeps', body)`. ProvisionSheet props: `{league, season, onClose, onDone}`.

- [ ] **Step 1: Failing tests** (vi.mock accountClient). ProvisionSheet: renders name input (default `${league.name} ${season}`) + wagering toggle (default OFF) + "Start sweep" button; submit → button disabled with pending copy ("Setting up — fetching teams and games…") while the promise is unresolved; resolve → success panel with member/admin LinkFields + "Done" calling `onDone`; reject `{status:402, code:'subscription_required'}` → message + "Go to billing" link to `/account`; reject `{status:403, code:'sweep_cap'}` (mock err also carries no cap field — the API returns `{error:'sweep_cap', cap}`; have `call()`'s thrown error expose the body: check accountClient — if the body isn't retained beyond `code`, extend the thrown error with `body` additively and assert cap renders when present, generic copy when not); reject 400 → "That competition can't be set up right now."; reject 500 → "Something went wrong — try again." + button re-enabled. screens-account.test.jsx: empty sweeps state renders a "Set up your first sweep" link to `/account/new`; non-empty list renders a "New sweep" button.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** ProvisionSheet as an overlay within screens-catalog.jsx (reuse `.overlay`/`.sheet` classes). CatalogScreen wires `onPick` → opens the sheet. On success `onDone` → `window.location.assign('/account')` (my-sweeps refetches on mount — no cross-screen state). accountClient `call()`: additively attach `body` to the thrown error (`Object.assign(new Error(...), { status, code, body: data })`) so `cap` is renderable — existing consumers unaffected.
- [ ] **Step 4: Full web suite green; record the bar.**
- [ ] **Step 5: Commit** — `feat(web): provision sheet — pending state, error map, wagering toggle; my-sweeps entry points` — push.

---

### Task 3: live pass + P6 close-out

- [ ] **Step 1: Suites at HEAD** (`cd api && npm test`; `npm test -w web`; `npm run build`).
- [ ] **Step 2: Browser pass (controller):** signed-in throwaway → /account/new → filter basketball → search → pick NBA 2023-2024 → provision (watch the pending state — competition reuse makes it fast; the copy must still show) → success links → Done → my-sweeps shows the new sweep → open its member link → basketball UI. Also: cap/402 path — the canceled throwaway account should now 402 on provision (subscription canceled + trial may still be live: verify actual state; if trial still active, assert the happy path only and note it).
- [ ] **Step 3: Ledger + design doc** — P6b section in `.superpowers/sdd/progress.md`; extend design §13a with the Plan B close-out; note PHASE 6 COMPLETE.
- [ ] **Step 4: Commit** — `docs(p6b): SDD ledger P6b section + phase 6 close-out` — push.

---

## Self-Review (done at write time)

- Spec §9 coverage: catalog screen T1; provision modal + pending + error map T2; my-sweeps linkage T2; live verification T3. Billing CTA on 402 reuses the account home (no new billing surface).
- Type consistency: `getCatalog(params)`/`createSweep(body)` match accountClient's `call()` contract; error `{status, code, body}` extension is additive; `LinkField` import already exported (P6a T12).
- No api/ changes anywhere; the one client-contract change (error `body`) is additive.
