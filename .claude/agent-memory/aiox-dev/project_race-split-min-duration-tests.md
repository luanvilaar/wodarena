---
name: race-split-min-duration-tests
description: Since Story 1.106 race splits need >= 1 s; test events with deviceAt=Date.now() produce no split — use past deviceAt per event
metadata:
  type: project
---

Since Story 1.106 (2026-10-31), `buildRaceSplits` only writes a station split when the attempt lasted at least 1 s (`RACE_MIN_SPLIT_SECONDS`). Most race test helpers send every event with `deviceAt: Date.now()`, so start and release land in the same instant and **no split key appears**.

**Why:** AC2 forbids "00:00" in the public result; before, sub-second durations became "00:00".

**How to apply:** when a test asserts on `score.splits[stageId]`, give each event an explicit past `deviceAt` (e.g. `Date.now() - 900_000` for start, `- 780_000` for release) and send `clientNow: Date.now()` so the batch offset is ~0; see `tests/race-splits.test.mjs` (`ev(event, secondsAgo)`). Related: [[race-fixture-future-start]].
