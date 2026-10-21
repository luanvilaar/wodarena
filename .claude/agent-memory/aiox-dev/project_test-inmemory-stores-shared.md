---
name: test-inmemory-stores-shared
description: In-memory module stores (rateLimitStore, telão valid-link cache) persist across tests in one node --test file; budget actors/IPs per test
metadata:
  type: project
---

Route tests in `tests/live-broadcast.test.mjs` import the real route modules once, so module-level in-memory state survives `seed()`: `rateLimitStore` in serverSecurity.ts (e.g. `telao-control:{actorId}` 60/min, `telao-miss:{ip}` 120/min, IP `unknown` when no x-forwarded-for) and the valid-link cache in `src/app/api/telao/[token]/route.ts`.

**Why:** the OWNER actor is exhausted by the "60 ações por minuto" test, and a shared IP accumulates 404s across tests; new tests that reuse them fail with 429 for reasons unrelated to what they test.

**How to apply:** in new telão/mesa tests use MANAGER (has headroom, ~30 calls used across the file) and a fresh `x-forwarded-for` IP for any rate-limit scenario. Related: [[project_leaderboard-architecture]].
