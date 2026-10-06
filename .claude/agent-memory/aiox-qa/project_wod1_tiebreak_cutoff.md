---
name: wod1-tiebreak-cutoff
description: Story 1.35 (gate PASS 2026-10-06) — "WOD 1" tie-break uses the division's first workout, except events dated before the fixed cutoff 2026-10-07, which keep the legacy event-wide rule to protect published rankings
metadata:
  type: project
---

Story 1.35 changed the getLeaderboard "Colocação no WOD 1" tie-break to use the division's first workout. Events whose `event.date` falls before `FIRST_WORKOUT_TIEBREAK_CUTOFF` (2026-10-07, in `src/lib/workoutOrder.ts`) keep the old event-wide first workout. The user approved this on 2026-10-06. The gate was PASS on the same day.

**Why:** the cutoff is load-bearing. A read-only prod simulation showed that without it, New City Games would break published shared places in 3 divisions: Intermediário Misto 3rd, Scaled Feminino 2nd, Iniciante Feminino 7th. Today the legacy set is New City Games, Copa Intergames Bull and Training Camp Fitblock.

**How to apply:**
- In any future leaderboard or eventStatus change, re-check that these 3 events' rankings stay identical.
- Known risk REL-001: the legacy classification comes from the free-text date. Editing a finished event's date to a format without a year flips it to the new rule.
- Known gap TEST-001: the getLeaderboard integration only has static tests.

Related: [[leaderboard-eligibility-athlete-session]].
