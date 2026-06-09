# Worker runbook

1. Put the real key in `.env`: `API_FOOTBALL_KEY=...` (Pro tier; league 1 / season 2026).
2. Seed the team crosswalk (provider team ids) — requires the key:
   `npm run crosswalk:sync -w api`
   Review the printed report; for any UNMATCHED team, find its id in the API-Football
   dashboard and set it: `update team_crosswalk set provider_team_id=<id> where team_code='<code>';`
   Re-run until "matched 48/48".
3. One-shot baseline pull: `npm run sync -w api` (replaces seeded fixtures/standings with real data).
4. Run the worker (baseline schedule + windowed live poller): `npm run worker -w api`.
5. Freshness: `GET /api/sync-status` → `{stale:false}` after a successful baseline.
