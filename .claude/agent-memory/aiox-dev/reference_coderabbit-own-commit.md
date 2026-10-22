---
name: coderabbit-own-commit
description: How to run the CodeRabbit CLI on only the story's commit when local main carries other unpushed commits
metadata:
  type: reference
---

The CLI at `~/.local/bin/coderabbit` (0.7.6) rejects `--prompt-only`. Stories here prescribe `review --agent --committed --base origin/main`, but local `main` often carries other agents' unpushed commits (e.g. 2026-10-21: four commits ahead of origin), so that diff reviews far more than the story.

**How to apply:** after the single story commit, run `coderabbit review --agent --committed --base-commit <parent-sha>` to review only that commit. Output is JSON lines; confirm a `complete`/`review_completed` line with `reviewedFiles` before counting the gate as run. See also [[project_worktree-setup-gotchas]].
