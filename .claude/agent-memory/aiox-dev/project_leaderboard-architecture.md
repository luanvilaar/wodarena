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

**Fallback (load-bearing, added 2026-06-10):** because the sync gap above means `leaderboard_entries` can be empty for an event/division that genuinely has scored athletes (manual registration, insert-time approval before the trigger fix, or migrations not yet applied), `getLeaderboard` now has a defensive fallback: if NO `leaderboard_entries` rows exist for the `(eventId, divisionId)` pair, it uses ALL `divisionAthletes` from local state (pre-Fase-2 behavior) instead of an empty list. Guard var: `hasLeaderboardEntries = leaderboardAthleteIds.size > 0`. This applies to BOTH the `fitness_racing` and `functional_fitness` branches since `divisionAthletes` is computed once before the branch split. WITHOUT this, "Nenhum resultado lançado" appears even though scores exist. The trigger fix in `20260610120000_fix_leaderboard_sync_trigger.sql` (INSERT/UPDATE/DELETE) only repairs DB-persisted registrations — it cannot help non-persisted manual ones, which is why the client fallback is the actual fix.

See [[leaderboard-workout-scoping]] for the global-vs-division WOD distinction that governs score aggregation.
