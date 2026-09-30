---
name: missing-commit-push-tasks
description: The devops mission router points at commit-workflow.md and push.md, which do not exist in this repo's AIOX install — use the pre-push gate task instead
metadata:
  type: reference
---

`.aiox-core/development/tasks/` in wodarena has **no `commit-workflow.md` and no `push.md`**, even though the aiox-devops spawn prompt's mission router maps the `commit` and `push` missions to exactly those filenames. Do not waste turns re-reading or globbing for them.

**Why:** this project's `.aiox-core` snapshot predates (or simply omits) those two task files. The git-related tasks that *do* exist are `github-devops-pre-push-quality-gate.md`, `github-devops-github-pr-automation.md`, `github-devops-repository-cleanup.md`, `github-devops-version-management.md`, plus `setup-github.md` and the issue-triage pair.

**How to apply:** for a `commit` or `push` mission, fall back to `github-devops-pre-push-quality-gate.md` + the `pre-push-checklist.md` checklist (at `.aiox-core/product/checklists/`, not `development/checklists/`) and log an `[AUTO-DECISION]` for the substitution. The gate's own deterministic checks are the authoritative definition of "safe to push" here. See [[push-agent-authority-env]] for the push invocation itself.

Also note: the repo's `npm audit` has long-standing CRITICAL/HIGH advisories coming entirely from `next@16.3.1` and its transitive deps (`sharp`, `browserslist`, `js-yaml`, `baseline-browser-mapping`). A literal reading of the gate's `determineSecurityGate` would block every single push.

**Downgrading that to CONCERNS is a waiver, not a pass — never silent.** "It was already on `origin/main`" is not by itself a reason to clear a CRITICAL: pre-existing means already exposed, not harmless. Before proceeding, all three must hold, and the push report must say so out loud:

1. `git diff --name-only origin/main..HEAD` shows **no** change to `package.json` / `package-lock.json` (the push introduces no new exposure);
2. the report names the offending packages and the counts (`critical/high/moderate`) instead of collapsing them into "CONCERNS";
3. the waiver is handed to the user with the remediation it needs so they own the decision — an agent does not grant itself an open-ended exemption. As of 2026-09-22 `npm audit` reports the fix as **non-major**: `next` 16.3.1 → 16.3.6 (`isSemVerMajor: false`), counts 1 critical / 3 high / 1 moderate. Re-check `fixAvailable` each time rather than repeating an old remediation.

If any of the three fails, the gate stays FAIL and the push waits.

**Dirty working tree is normal here.** The user often has unrelated WIP (skill syncs under `.claude/skills/`, `.cursor/`, `.gemini/`, `.github/`, `next-env.d.ts`) while asking for a scoped commit, so the gate's "working directory clean" check fails by design. Do not stash or touch that WIP. Instead, after committing, confirm `git status --short -uall -- src tests supabase bin package.json package-lock.json` is empty. That proves lint/typecheck/test/build in the main checkout exercise exactly the committed tree.
