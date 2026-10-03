---
name: publish
description: Commit, push, and open or update an OmniSocial draft pull request when authorized.
---

# Publish

Use only on an explicit commit + push + PR request. Read AGENTS.md, the plan,
commit, implementation-plan-keeper, and mr-description skills. Run preflight.
Confirm exact origin, authenticated GitHub account, branch/base, and scope.

1. Preserve unrelated work. Check all available refs for branch/ticket collisions.
2. Use `codex/SOC-###-short-description` by default.
3. Validate the change and commit explicit files through the commit skill.
4. Run plan finalize and inspect the commit and status.
5. Push the feature branch with tracking. Never force-push or skip hooks.
6. Write ignored `tmp/mr-description.md` through the mr-description skill.
7. Check for an existing PR for this exact head. Update it rather than duplicate it.
8. Prefer an available GitHub connector; use authenticated `gh` as fallback.
9. Open a draft PR against the remote default branch. Attach the created PR to
   the current chat through the Codex artifact tool when available.
10. Return branch, commit, check results, and PR URL. Separate draft, merged, and
    deployed states.

For an empty repository only, establish the minimal initial main commit as the
PR base before pushing the documented SOC-001 feature branch. Record this
bootstrap exception in the plan.

Mark ready and merge only when explicitly authorized. Merge feature PRs with
squash; verify the resulting main commit. Do not delete branches unless requested.
Do not configure GitHub Actions, deploy, or publish social content as a side effect
of publishing repository documentation.
