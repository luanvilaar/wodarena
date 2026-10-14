---
name: pglite-migration-validation
description: How to validate a new supabase/migrations file in PGlite outside the repo (stubs the 53+ prior migrations need) without touching package.json
metadata:
  type: project
---

Migration stories here (1.38, 1.40, 1.41) are validated by applying ALL prior migrations plus the new one in PGlite installed in a fresh scratchpad dir (`npm install --ignore-scripts @electric-sql/pglite`, never in the project). The script lives in a separate dir and imports PGlite by absolute path.

Prior migrations only apply cleanly after stubbing Supabase pieces first:
- roles `anon`, `authenticated`, `service_role` (CREATE ROLE if missing);
- extension `uuid-ossp` (load `uuid_ossp` from `@electric-sql/pglite/dist/contrib/uuid_ossp.js`; `leaderboard_entries` uses `uuid_generate_v4()`);
- schema `storage` with tables `buckets(id, name, public, file_size_limit, allowed_mime_types)` and `objects(id, bucket_id, name)` (event-media bucket migration).

Seeding `events` needs a `users` row first (`events_organizer_id_fkey`) and `status` in ('upcoming','live','finished') (`events_status_check`).

**Why:** the user forbids applying migrations to the remote Supabase; PGlite is the agreed local proof, and rediscovering these stubs costs several failed runs.
**How to apply:** for any new migration, reuse this setup, then check columns/CHECKs/idempotent re-apply/RLS-policies-grants unchanged, and pin the SHA-256 fingerprint of the previous migrations in the static test (see `tests/event-map-migration.test.mjs`). Related: [[worktree-setup-gotchas]].
