# Agent Rules

## Scope and preflight

Read this file, the relevant part of `docs/IMPLEMENTATION_PLAN.md`, the applicable
local skill, Git status, and staged and unstaged diffs before changing this project.
Preserve unrelated user changes. Use `apply_patch` for manual file edits.

SOC-001 establishes documentation and delivery conventions only. Later milestones
must be started explicitly. Do not implement or activate the plan merely because
it is documented. V2 is deferred.

Use the implementation-plan-keeper skill before and after scope or milestone
changes. The authoritative milestone namespace is SOC, not TOD. Never infer a
ticket from old chat messages or the number of commits. Future roadmap IDs are
proposals until checked against all available Git refs and explicitly reserved.

## Product behavior

- Every publishing run is started explicitly by the owner and has a bounded,
  immutable manifest of posts and accounts. Start permission never authorizes a
  recurring job, another account, or newly discovered posts.
- Dry run is the default and must not prepare a cloud post, submit social content,
  or update a published/skipped result.
- Owner approval must bind exact content, media, account, destination, visibility,
  and the chosen music policy. Changed payloads require renewed approval.
- Confirm active account identity before submission. Keep histories independent.
- Use Playwright UI interaction for the owner-requested publishing flow.
  Platform-policy approval and API eligibility are not project prerequisites for
  this route, as explicitly directed by the owner on 2026-10-03. Keep an assisted
  handoff available for technical or authentication blockers.
- Stop on CAPTCHA, MFA, login expiry, identity mismatch, unexpected UI, or an
  uncertain publication outcome. Do not bypass security challenges.
- A click, upload, draft, success toast, or provider job ID alone is not proof of
  public publication. Require a matching receipt and URL before recording public.
- Reconcile uncertain submissions before any retry. Never auto-republish after a
  journal restart, a changed content hash, or a portfolio writeback failure.
- Do not create comments, replies, DMs, follows, likes, or social research in V1.
- Use no automatic publishing schedules and no GitHub Actions or billed GitHub CI.

## Data and security

Use separate local automation browser profiles; never automate the default daily
Chrome profile. Browser state is sensitive and is not automatically encrypted by
Playwright. Protect local files with owner-only permissions and disk encryption.
Keep credentials, cookies, storage state, n8n secrets, real execution data, reports,
media, and screenshots out of Git and PR bodies. No session cookies in portfolio
tables. Account metadata can contain public handles and board IDs only.

Keep the worker service local or on a private authenticated network. Do not expose
an arbitrary browser, URL navigation, filesystem, shell, or publish endpoint to
the internet. Configure allowlists, authenticated requests, and fixed operations.
Export n8n workflows without credential values, pinned personal data, or resume
URLs. Use synthetic fixtures and redact logs. No Supabase service key is needed
in a browser or in workflow exports.

The portfolio cloud ledger records portfolio progress; the local journal records
attempts, receipts, leases, and pending synchronization. Do not create two
competing publication truth sources. Cross-repository changes require their own
ticket and PR in the target repository.

## Validation and evidence

Run validation appropriate to the change. Documentation tasks require staged
diff review, local-link checks, milestone consistency, and `git diff --check`.
Do not claim application, n8n, API, browser, provider, or production tests that
were not run. Product changes require focused failure/replay tests and relevant
integration checks using fixtures before any separately authorized real pilot.

## Git delivery

Use branches `codex/SOC-###-short-description` by default. The owner may supply
another explicit branch. Check for collisions before creating a branch.

Commit format:

```text
[SOC-001]docs: define v1 implementation plan
```

Allowed types: build, chore, ci, docs, feat, fix, perf, refactor, revert, style,
test. Use a lowercase imperative description without a trailing period, keep
the full subject at most 100 characters, and make one logical change per commit.
Never add tool attribution unless requested. Stage explicit files. Never use
`git add -A`, destructive resets, `--no-verify`, or force pushes as shortcuts.

Use the local commit skill for commit-only requests. Use the publish and PR
description skills for commit + push + PR requests. Default PRs are drafts;
write the body to ignored `tmp/mr-description.md`. Do not push without owner
authorization. Do not mark a PR ready or merge unless authorized. When authorized
to merge, use squash so main receives one task-level change from the feature PR.

The empty-repository SOC-001 bootstrap is the one initial main commit needed to
establish a PR base. SOC-001 planning documents are reviewed on a feature branch.
Multiple commits bearing one ticket still represent one milestone.
