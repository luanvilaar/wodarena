# AIOX DevOps (Gage) — Memory Index

- [GitHub account context](project_github-account-context.md) — push wodarena as active `luanvilaar` gh account, not `confederacaobff-a11y`, or you get a false "repo not found"
- [Push agent-authority env](project_push-agent-authority-env.md) — `git push` blocked unless devops agent env vars prefixed; `-f` also trips the permission classifier
- [CodeRabbit CLI state](reference_coderabbit-cli-state.md) — the AIOX task's `--prompt-only -t` flags no longer exist; use `review --agent --committed --base-commit <sha>`; severities are critical/major/minor
- [Missing commit/push task files](reference_missing-commit-push-tasks.md) — the mission router's `commit-workflow.md`/`push.md` don't exist here; fall back to the pre-push gate task
