---
name: coderabbit-cli-state
description: CodeRabbit CLI on this machine — the AIOX task file's documented flags are stale, and the review service has been flaky
metadata:
  type: reference
---

CodeRabbit CLI lives at `~/.local/bin/coderabbit` (native macOS, no WSL wrapper needed despite what the AIOX task templates assume).

**The documented flags are stale.** `.aiox-core/development/tasks/github-devops-pre-push-quality-gate.md` and the `coderabbit-review` skill both prescribe `--prompt-only -t uncommitted` / `--prompt-only --base main`. The installed CLI rejects both: `--prompt-only` no longer exists and `-t` was replaced by explicit flags. Current shape:

- `coderabbit review --agent` — structured findings for agent workflows (replaces `--prompt-only`)
- `--committed` / `--uncommitted` / `--include-untracked` — scope selection (replaces `-t <scope>`)
- `--base <branch>` vs `--base-commit <commit>` — when already on `main`, `--base main` yields an empty diff; use `--base-commit <last-pushed-sha>` instead
- `--light` — reduced-context review

**Auth is under a different account.** `coderabbit auth status` reports `confederacaobff-a11y (confederacao.bff@gmail.com)`, not `luanvilaar`. It still authenticates fine — do not "fix" this the way you would for the gh account in [[github-account-context]]; they are unrelated credential stores.

**Service flakiness:** on 2026-08-28 both a full and a `--light` review failed immediately with `{"errorType":"connection","message":"Connection failed: WebSocket closed"}`. That is an upstream outage, not a code finding. Per the pre-push task's own error handling this degrades the gate to CONCERNS, not FAIL — proceed with the push if the deterministic gates (lint/typecheck/test/build/audit/secret-scan) are green, and say so explicitly in the report.
