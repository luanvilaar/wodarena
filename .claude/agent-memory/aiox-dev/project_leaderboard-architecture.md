---
name: leaderboard-architecture
description: WODArena leaderboard data flow — denormalized leaderboard_entries table gates public visibility; getLeaderboard branches by eventType.
metadata:
  type: project
---

WODArena leaderboard pipeline (Fase 2 architecture):

- **Visibility gate:** `leaderboard_entries` (denormalized table) lists only athletes with `payment_status = 'payment_approved'`. Populated by trigger `trg_sync_leaderboard_on_payment_change` on the `registrations` table (INSERT/UPDATE/DELETE). `getLeaderboard` filters `divisionAthletes` to ids present in `leaderboardEntries`.
- **Bootstrap:** `src/app/api/app/bootstrap/route.ts` loads all `leaderboard_entries` into AppContext state (`leaderboardEntries`).
- **Aggregator:** `getLeaderboard(eventId, divisionId)` in `src/context/AppContext.tsx` branches on `event.eventType`:
  - `fitness_racing` → ranks strictly by the TOTAL workout time (early return).
  - `functional_fitness` → CrossFit low-point: sums per-WOD placement points, penalty = `divisionAthletes.length + 1` for unscored, tie-breaks by direct confrontation then WOD-1 placement.

**Caveat:** the manual admin "bilheteria" registration (`registerTicket` in AppContext) only mutates local React state — it does NOT persist to the DB, so it never fires the trigger nor creates a `leaderboard_entries` row. Real entries come through the checkout/webhook payment flow. Keep this in mind when a manually-added athlete is missing from the public leaderboard.

See [[leaderboard-workout-scoping]] for the global-vs-division WOD distinction that governs score aggregation.
