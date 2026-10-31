---
name: coverage-waiting-estimate
description: Story 1.105 coverage panel — open furthest attempt means athlete is AT the station (not waiting next); deviation from AC3 literal awaiting QA/Luan confirmation
metadata:
  type: project
---

In `estimateRaceWaitingStationKey` (src/lib/raceCoverage.ts, Story 1.105) an athlete whose furthest attempt is still open counts as being at that station, not waiting the next. AC3 literally says "aberta ou encerrada" defines position and the athlete waits the following one.

**Why:** counting athletes already being judged as "waiting" would inflate "Judges lotados" / "Atletas sem judge". Recorded as AUTO-DECISION in the story's Dev Agent Record (2026-10-31), not yet confirmed by @qa or Luan.

**How to apply:** if @qa flags AC3 deviation, the fix is one line (drop the `isRaceAttemptActive` early return) plus the "cartão aberto está na estação" test and the panel footnote `RACE_COVERAGE_ESTIMATE_NOTE`. Also: escala table missing (1.104 migration) is handled as "sem escala" with `assignmentsAvailable: false`; see [[race-judge-capacity-tests]].
