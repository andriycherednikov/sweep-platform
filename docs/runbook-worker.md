# Worker runbook

Requires `API_FOOTBALL_KEY` in `.env` (Pro tier; league 1 / season 2026).

## Real-data cutover (done 2026-06-09)

The Phase 1 seed was demo data. To switch the database to the **real** WC 2026 field:

```bash
npm run cutover -w api
```

This is one idempotent command that:
1. clears the placeholder fixtures + standings,
2. reconciles the `team` table to the real 48 (keeps codes for name/alias matches so
   ownership survives, inserts new real teams, drops teams absent from the field along
   with their orphaned ownership picks), and fills `team_crosswalk`,
3. baseline-syncs real fixtures + standings + predictions.

After the 2026-06-09 cutover: 37 teams matched, 11 inserted, 11 dropped (→ 48), 72 fixtures,
12 groups, 27 ownership picks (5 dropped: Denmark/Italy/Peru/Nigeria/Wales — each owner kept
their other team). `GET /api/sync-status` → `{stale:false}`.

> New teams get a placeholder `flag_code` (the lowercased 3-letter provider code) and a neutral
> color/strength — refine these in the frontend phase if exact flags/colors matter.

## Ongoing operation

- `npm run worker -w api` — long-running: baseline sync on a schedule + a 60s live poller that
  only calls the API inside kickoff windows. Run this for the tournament.
- `npm run sync -w api` — one-shot baseline pull (no team reconciliation; use after cutover).
- `npm run crosswalk:sync -w api` — re-match provider team ids if the field changes; review the
  printed UNMATCHED report and fix any by hand:
  `update team_crosswalk set provider_team_id=<id> where team_code='<code>';`
- Freshness: `GET /api/sync-status` → `{stale:true}` if the newest OK baseline is >18h old.
