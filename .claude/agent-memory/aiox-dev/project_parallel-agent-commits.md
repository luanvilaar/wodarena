---
name: parallel-agent-commits
description: Other agents (@qa) commit on main while @dev works, so `git commit --amend` can land on their commit; check HEAD first
metadata:
  type: project
---

On 2026-10-22, during Story 1.63, @qa committed its 1.62 gate between my commit and my `git commit --amend`. The amend rewrote the @qa commit and put my story edit inside it. I fixed it with `git reset --keep <my commit>`, re-applied my patch, amended my commit, and cherry-picked the @qa commit back. Its content stayed identical, but its hash changed.

**Why:** the coordinator runs @dev and @qa at the same time on the same checkout and branch (main), and both commit locally.

**How to apply:** before any `--amend`, run `git log -1 --format=%s` and confirm HEAD is still your own commit. If it is not, do not amend. Report it, or rebuild the history as above and say in the report that the other agent's commit hash changed. See also [[coderabbit-own-commit]].
