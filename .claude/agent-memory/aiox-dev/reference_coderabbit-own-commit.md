---
name: coderabbit-own-commit
description: How to run the CodeRabbit CLI on only the story's commit when local main carries other unpushed commits
metadata:
  type: reference
---

The CLI at `~/.local/bin/coderabbit` (0.7.6) rejects `--prompt-only`. Stories here prescribe `review --agent --committed --base origin/main`, but local `main` often carries other agents' unpushed commits (e.g. 2026-10-21: four commits ahead of origin), so that diff reviews far more than the story.

**How to apply:** after the single story commit, run `coderabbit review --agent --committed --base-commit <parent-sha>` to review only that commit. Output is JSON lines; confirm a `complete`/`review_completed` line with `reviewedFiles` before counting the gate as run. The repo is not connected to a CodeRabbit org, so the CLI runs on the free allowance (3 reviews, then `rate_limit` with a `waitTime` of a few minutes, as on 2026-10-21). On that error, retry in a background command after the wait instead of counting the gate as not run.

See also [[project_worktree-setup-gotchas]].
