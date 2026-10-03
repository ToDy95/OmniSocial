---
name: commit
description: Create an intentional OmniSocial commit using the SOC milestone convention.
---

# Commit

Read AGENTS.md and the relevant implementation milestone. Inspect branch, status,
unstaged/staged diffs, and refs. Use the explicitly supplied SOC ID or the audited
allocation; never invent one from commit count. Preserve unrelated changes.

Run relevant checks, including `git diff --check`. Stage explicit files and inspect
the staged diff. Commit one logical change with the format below:

```text
[SOC-001]docs: define v1 implementation plan
```

Allowed types: build, chore, ci, docs, feat, fix, perf, refactor, revert, style,
test. Optional lowercase scope is permitted. Use a lowercase imperative subject,
no final period, at most 100 characters. Never use `--no-verify`, destructive
resets, or tool attribution. Fix hook failures rather than bypass them.

Commit-only requests do not authorize push or PR creation. For explicitly
authorized commit + push + PR, use the publish skill. Do not amend or force-push
shared history without explicit owner authorization.
