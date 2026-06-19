# Kickoff prompt — multi-bet parlay (subagent-driven)

Paste everything below the line into a fresh Claude Code session at the repo root
(`/Users/andriycherednikov/code/personal/sweep`) to execute the plan.

---

Execute the multi-bet (parlay) implementation plan in **subagent-driven** mode.

**Source of truth**
- Plan (execute task-by-task, in order, Slice 0 → 5): `docs/superpowers/plans/2026-06-19-multi-bet-parlay.md`
- Spec (the why / decisions): `docs/superpowers/specs/2026-06-19-multi-bet-parlay-design.md`
- Project guide: `CLAUDE.md` (TDD is non-negotiable; Conventional Commits; Docker required for api tests).

**Branch**
- Work on `feat/multi-bet-parlay` — the spec + plan are already committed there. Run `git branch --show-current`; if it's not that branch, `git checkout feat/multi-bet-parlay`. Do **not** work on `main`. Do **not** merge — when the feature is done, stop and present options (use `superpowers:finishing-a-development-branch`).

**How to run it**
- Use the **`superpowers:subagent-driven-development`** skill: one fresh subagent per task, two-stage review between tasks.
- Each task in the plan is already TDD-structured (write the failing test → run it and confirm it FAILS → minimal implementation → run it and confirm it PASSES → commit). Actually run every command and read the output — never claim a test passes without running it.
- Commit after each task using the exact commit message given in that task.

**Hard requirements (read before Slice 0)**
- **Docker must be running** — the api Vitest suite spins up Testcontainers Postgres 16. Confirm with `docker ps` first.
- **Migrate the shared dev DB after generating:** any `npm run db:generate -w api` must be followed by `npm run db:migrate -w api`. Green tests do NOT migrate the shared dev DB. (Tasks 0.2 and 1.1 each generate a migration — 0014 `regScore`, 0015 `parlay`.)
- Test commands: api → `npm run test -- <pattern>` (from repo root); web → `npm run test -w web -- <pattern>`.
- **Slice 0 intentionally rewrites existing settlement + tests** (group bets now grade on the 90-minute `regScore`, which equals the final score for group stage, so behaviour is preserved). Updating `coins-settle.test.js` and `coins.test.js` as the plan specifies is expected — not a regression.
- The betslip store is a module global; the plan's web tests `clearBetslip()` in `beforeEach`. Keep that — without it, tests pollute each other.

**Review gates — pause and report to me at each:**
1. **After Slice 0** — regulation-time settlement + full-tournament unlock (independently shippable: knockout single bets now work). Run the api suite green before pausing.
2. **After Slice 3** — backend complete (storage, `POST /api/parlay`, settlement rollup, prune→refund). api suite green.
3. **After Slice 5** — full feature. Final gate: `npm run test -w web` **and** `npm run test` (api) **and** `npm run build` all green.

**Start:** read the plan top-to-bottom, confirm the branch + `docker ps`, then begin **Slice 0, Task 0.1**.
