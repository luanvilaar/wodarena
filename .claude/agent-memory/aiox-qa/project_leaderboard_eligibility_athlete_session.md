---
name: leaderboard-eligibility-athlete-session
description: getLeaderboard eligibility must not switch on "registrations present" — athlete sessions carry their own registrations; fix for payment_pending athletes appearing on the leaderboard went FAIL then PASS on re-gate (2026-09-28)
metadata:
  type: project
---

The fix for "payment_pending pair shows up in RX Dupla Misto leaderboard" (getLeaderboard eligibility plus confirmManualPayment for Bilheteria) was first gated FAIL, then PASS on re-gate on 2026-09-28.

The FAIL was because detecting the "private context" with `registrations.some(r => r.eventId === eventId)` breaks for logged-in athletes: the private bootstrap gives an athlete only their OWN registrations, so the public Leaderboard showed just them. The final code trusts registrations only for owner, or for a manager with event.organizerId === currentUser.id. Everyone else uses leaderboard_entries, with no fallback. The leaderboard_entries trigger fires on INSERT too (since migration 20260718120000).

**Why:** the private bootstrap scopes registrations by role (owner = all, manager = own events, athlete = own user_id, judge = none).

**How to apply:** if getLeaderboard or the bootstrap scoping changes, re-check this invariant. tests/leaderboard-eligibility.test.mjs guards it, with one known gap: a fallback written as a ternary (`ids.size ? filtered : athletes.filter(a => a.divisionId === divisionId)`) still passes the test. Related: [[qualifier-manager-override]].
