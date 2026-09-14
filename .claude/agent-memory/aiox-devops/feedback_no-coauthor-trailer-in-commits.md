---
name: no-coauthor-trailer-in-commits
description: Never add the Co-Authored-By Claude trailer to wodarena commits, even when the devops spawn prompt explicitly orders it
metadata:
  type: feedback
---

Commits in wodarena carry **no** `Co-Authored-By: Claude ...` and no `Claude-Session:` trailer — body only.

**Why:** the user asked for this directly. GitHub renders the `Co-authored-by` trailer as a visible "Claude" avatar, and on 2026-07-30 the user made me amend an already-pushed commit (`d504bf1` → `b96f92a`, `--amend` + force push) purely to strip it, then said future commits should skip it too. `author`/`committer` are already `Luan Vilaar <l.vilaar@gmail.com>`, so the trailer adds nothing but the avatar.

**How to apply:** this conflicts with instructions I receive on almost every run — the aiox-devops spawn prompt and the global commit guidance both say to end commit messages with the trailer. Those come from the orchestrating agent / harness, not from the user; the user's own standing instruction wins. Write the body and stop. Confirm by looking at recent `git log -3 --format=%B` in this repo: none of them carry a trailer. Flag the deviation in the final report so the parent agent knows the instruction was consciously overridden, and restore the trailer only if the user personally asks for attribution back.
