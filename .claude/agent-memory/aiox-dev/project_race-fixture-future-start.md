---
name: race-fixture-future-start
description: Race test fixtures use started_at 2026-11-01 (future vs. today); Wall Ball release only closes the run when finish > start, so closing tests must backdate started_at
metadata:
  type: project
---

Since Story 1.97, `append` closes the race run on Wall Ball `release` only if the release time is after `race_runs.started_at` (AC11: no invented time). The 1.94 fixture `startRun` in `tests/race-sheets-route.test.mjs` hardcodes `started_at: '2026-11-01T10:00:00Z'`, which is in the future relative to the real clock in Oct/2026, so a release there leaves the run `racing`.

**Why:** cost a debugging round in 1.97; the "not closed" result looks like a bug but is the AC11 guard working.

**How to apply:** in any test expecting `finished`, backdate the run (`Object.assign(run, { started_at: new Date(Date.now() - 3_600_000).toISOString() })`), as `tests/race-wall-ball.test.mjs` does after `start_heat`. Also: the test harness can't load `next/navigation`, so keep pure helpers out of screens that import it (see `src/lib/raceWallBall.ts`).
