---
name: project-qualifier-result-edit-delete
description: Design decision (2026-09-22) for manager edit/delete of already-reviewed Functional Fitness Qualifier results; pending owner approval
metadata:
  type: project
---

On 2026-09-22 the product owner asked that managers/owners be able to EDIT and DELETE qualifier results already reviewed by a judge (revert mistaken validation; let the athlete resubmit from scratch). Architect review recommended:

- Edit: reuse `qualifier_apply_review` via `/api/judge/reviews` (managers are not blocked by the already-reviewed check), plus DB-level mandatory justification when re-reviewing a finalized submission.
- Delete: do NOT reuse `qualifier_reopen_submission`. It returns the submission to `pending_review` with the old video, so judges could re-validate it before the athlete resubmits. It is also shared with the contestation flow. Instead: new status `awaiting_resubmission`, new review decision `resubmission_requested`, and a new RPC `qualifier_request_resubmission`. That RPC blocks when the window is closed or a contestation is open, requires `REVOKE FROM PUBLIC`, and is paired with a `CREATE OR REPLACE` of `qualifier_submit_submission`.
- Closed submission window: block in the DB (option a). Rejected: reopening the global workout window, because `qualifier_protect_workout_after_submission` locks it on purpose for fairness. A per-athlete `resubmission_deadline` is a possible follow-up, but it is a sporting-policy decision for the owner.

**Why:** product owner wants reversible judge mistakes without weakening the immutable audit trail or competitive fairness.
**How to apply:** check whether this was approved/implemented (look for a migration adding `awaiting_resubmission`) before re-proposing; if the owner later asks for post-deadline resubmission, start from the per-athlete deadline design, not window extension.
