---
name: test-harness-module-instance
description: importServerModule shares the module instance with the route under test; fake DB rows are live references (copy values before acting)
metadata:
  type: project
---

`importServerModule('lib/x.ts')` returns the same module instance the route imports via `@/lib/x`, so module-level setters (e.g. `setRaceRunPublisher` in serverRaceDecisions.ts, Story 1.98) can swap behavior in route tests — reset them in `seed()`.

`database.rows(table)` returns live row objects: a row grabbed before an action reflects the update afterwards. Copy the value (`const old = row.started_at`) before asserting "before" fields.

**Why:** cost a failing assertion on 1.98 (`decision.before.started_at` compared against a mutated row).
**How to apply:** any race/sheets test using fakeSupabase + serverModuleHarness. Related: [[test-inmemory-stores-shared]], [[race-fixture-future-start]].
