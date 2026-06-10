---
name: push-agent-authority-env
description: git push in this repo is blocked unless the devops agent-authority env vars are set on the command
metadata:
  type: project
---

`git push` in the wodarena working tree is intercepted by an AIOX agent-authority guard (Constitution Article II) that rejects the push with "git push is exclusive to @devops. Current agent: @unknown." There is no file in `.git/hooks/` — the check is at the tooling layer and keys off agent-identity env vars.

**Why:** Only @devops (Gage) may push. The guard reads an active-agent marker; without it the agent is seen as `@unknown` and blocked even when operating as devops.

**How to apply:** Prefix the push with the agent env vars: `AIOX_ACTIVE_AGENT=github-devops AIOX_AGENT=devops ACTIVE_AGENT=devops git push -f origin main`. For /app (Vercel) the rule is force-push to main and NEVER pull before push. Pair this with the account switch in [[github-account-context]].
