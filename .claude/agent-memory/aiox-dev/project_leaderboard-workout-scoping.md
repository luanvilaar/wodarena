---
name: leaderboard-workout-scoping
description: WODArena leaderboard — functional_fitness WODs are global (division_id NULL); fitness_racing WODs are division-bound. Filtering must allow both.
metadata:
  type: project
---

In WODArena, the two event types scope workouts to divisions differently, and this drives all leaderboard score aggregation logic.

**Fact:**
- `fitness_racing` events: each WOD has a concrete `division_id` (built by `buildFitnessRacingDefaults`, one "TOTAL" workout per division).
- `functional_fitness` events: WODs are typically GLOBAL — created via admin with `wodDivisionId` defaulting to `''` → persisted as `division_id = NULL`, meaning "applies to every division." Selecting a specific division per WOD is optional/rare.

**Why:** Functional fitness comps run the same WODs across all categories; fitness racing has per-division courses. The admin leaderboard preview encodes this correctly: `workouts.filter(w => !w.divisionId || w.divisionId === catId)` (the `!w.divisionId ||` clause is load-bearing).

**How to apply:** Any code filtering workouts by division for scoring/leaderboard MUST keep the `!w.divisionId ||` (global-workout) clause. Dropping it makes `workoutIds` empty for functional_fitness, collapsing every athlete's `totalPoints` to 0. The canonical leaderboard aggregator is `getLeaderboard` in `src/context/AppContext.tsx`; the public render is `src/components/Leaderboard.tsx` (`divisionWorkouts` memo). See [[leaderboard-architecture]].

**Migration note:** `20260610110000_teams_4_6_formats.sql` only widened the `divisions.type` CHECK constraint to include `team4`/`team6`. It is SELECT-irrelevant and never affects leaderboard queries — do not chase it for leaderboard bugs.
