---
name: github-account-context
description: Which GitHub account/credential to use when pushing the wodarena repo, and the multi-account gotcha
metadata:
  type: project
---

Pushing to `luanvilaar/wodarena` (private repo) requires the `luanvilaar` gh account to be the **active** one.

**Why:** `gh auth status` shows two authenticated accounts on this machine — `confederacaobff-a11y` (often the default/active) and `luanvilaar`. The repo belongs to `luanvilaar`. When `confederacaobff-a11y` is active, `git push` and `gh api repos/luanvilaar/wodarena` both return "Repository not found" / HTTP 404 (GitHub masks 403 as 404 for private repos the credential can't see). This looks like a missing repo but is really an account mismatch.

**How to apply:** Before pushing wodarena, run `gh auth switch --user luanvilaar` then `gh auth setup-git`. Verify with `gh api user --jq .login` (should print `luanvilaar`) and `gh api repos/luanvilaar/wodarena --jq .permissions.push` (should be true). Commit author for this project is `Luan Vilaar <l.vilaar@gmail.com>`. See [[push-agent-authority-env]].
