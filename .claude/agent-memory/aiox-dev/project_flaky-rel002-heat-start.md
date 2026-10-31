---
name: flaky-rel002-heat-start
description: race-penalties-panel [REL-002] adjust_heat_start was flaky from a same-millisecond updated_at collision in updateRunIf; fixed 2026-10-31 (Story 1.103) by also checking status
metadata:
  type: project
---

`tests/race-penalties-panel.test.mjs` "[REL-002] adjust_heat_start ..." used to fail ~2 in 15 runs (`ath-bia com a largada nova` ~60 s off). Root cause was not the clock seconds: `updateRunIf` in `serverRaceDecisions.ts` verified a conditional update only by `updated_at`; when the test hook closed the run in the same millisecond as `decisionTime()`, the update (`.eq('status','racing')`) silently missed but `updated_at` matched. Fixed 2026-10-31 by also requiring `fresh.status === (patch.status ?? run.status)`; 30/30 runs passed.

**Why:** the "timestamp equality as write confirmation" pattern can be fooled by another writer in the same ms; same pattern exists in `updateInfractionIf`.

**How to apply:** if REL-002 fails again, it is a real regression now, not flake. When adding conditional updates verified by `updated_at`, also verify the condition column. Related: [[test-inmemory-stores-shared]], [[race-judge-capacity-tests]].
