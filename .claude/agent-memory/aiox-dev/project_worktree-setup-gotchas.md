---
name: worktree-setup-gotchas
description: Isolated agent worktrees under .claude/worktrees/ lack node_modules and any untracked files (e.g. fresh migrations) from the main checkout
metadata:
  type: project
---

Agent worktrees (`.claude/worktrees/agent-*`) are created from the last commit, so they do NOT contain:
- `node_modules` (npm test / lint / typecheck fail until it exists). Fix used on 2026-09-22: `ln -s <main-checkout>/node_modules node_modules` inside the worktree. The symlink is covered by the `node_modules` line in `.gitignore`, so it does not show up in `git status`.
- Untracked files that other agents created in the main checkout. Example: migration `20260922120000_qualifier_manager_result_actions.sql` existed only in the main checkout. It was copied verbatim, and the shasum was checked to make sure it was byte-identical.

**Why:** static regression tests read migrations and source files by path. If those files are missing, tests fail or silently check the wrong baseline.
**How to apply:** at the start of any worktree mission, check `ls node_modules` and compare the latest files in `supabase/migrations/` with the main checkout before coding. Git commands must target the worktree only, because cd-ing into the main checkout is blocked. See also [[project-qualifier-manager-result-actions]].
