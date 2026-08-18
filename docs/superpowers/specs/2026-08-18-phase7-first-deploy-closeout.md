# Phase 7 — first deploy (close-out)

**Status: DONE 2026-08-18.** The platform is live at
**https://sweep-portal.yowiebay.au** on the shared test box
(`134.199.153.212`), running beside — and independent of — the World Cup app.
This closes decision (c), the only launch blocker left after phase 6.

## What was decided at deploy time

| Question | Decision |
|---|---|
| Domain | `sweep-portal.yowiebay.au` (GoDaddy zone, A → 134.199.153.212, DNS-only). Owner added the record. |
| Isolation | Own compose project (`sweep-portal`), own containers (`portal-*`), own database (`sweep_portal`), own images (`sweep-portal-{api,web}`), own photos volume. The WC stack was not touched. |
| Seed data | **None.** Migrations + league catalog only — the portal is pure self-serve, there is no default sweep. |
| Worker | **On.** Daily catalog refresh + baseline/live sync, sharing the one API-Sports key with the WC worker. |
| Magic-link email | **Still the console stub.** Sign-in links are read from `docker compose logs api`. A real sender is the next gate for anyone but the owner using it. |
| Stripe | Test mode, sandbox `acct_1HSAmEFrvfTu4edQ`, price `price_1TpPGWFrvfTu4edQvNn36Wmh` ($5/mo). Webhook endpoint `we_1U5l9F…` → `/api/stripe/webhook`, subscribed to the three events the handler acts on. |
| GA | **Off.** The analytics default no longer falls back to the WC property; a build sets `VITE_GA_ID` when the platform gets its own. |

## Code changes this phase

- `trustProxy: 1` on Fastify (`api/src/app.js`). Behind the shared Caddy every
  request arrived from the proxy address, so the per-client rate limits
  (magic-link, checkout) shared one bucket and `req.protocol` never read https.
  Covered by `api/test/trust-proxy.test.js`.
- `web/src/lib/analytics.js`: GA id comes from `VITE_GA_ID` only — no inherited
  WC property. `web/Dockerfile` takes it as a build arg.
- `docker/` rebuilt for this repo's stack; `make deploy` / `deploy-status` /
  `logs` re-added (the WC-era block was deleted in `fb0ca1c`).

## Live verification (2026-08-18, against the public host)

- `migrate` ran clean on the empty `sweep_portal` DB; api + web healthy, worker up.
- Catalog primed: 1239 football + 427 basketball leagues; 7 curated
  (EPL, La Liga, Serie A, Bundesliga, Ligue 1, World Cup, NBA).
- Magic-link sign-in → account created; `/api/catalog` served the curated set
  with provisionable seasons.
- Provisioned **NBA 2023-2024** through the API: 30 competitors, 1376 events,
  standings grouped Eastern/Western, `hasDraws:false`, wagering on, trial
  started (ends 2026-09-01). Member link joined and rendered basketball-native.
- Billing: Checkout with 4242 in the browser → success landing → **Stripe
  webhook delivered and verified** → `{"subscribed":true,"subscriptionStatus":
  "active","liveSweeps":1,"quantity":1}`. Archive dropped a duplicate sweep and
  the count followed.
- Suites at deploy: **api 417 / web 535 / build green**. WC stack still healthy
  on its own domains.

## Still open (not blockers for a test deployment)

1. **Magic-link email delivery** — console stub; nobody but the log reader can sign in.
2. **GA property** — analytics off until a measurement id exists.
3. **Live Stripe keys** — test mode only; going live also needs a live-mode webhook + price.
4. **Fresh visual identity** — the shell still wears the WC trophy mark (decision d).
5. Backups/monitoring for `sweep_portal` are not set up.
