---
name: implementation-plan-keeper
description: Audit SOC ticket allocations and reconcile the implementation plan with Git evidence.
---

# Implementation Plan Keeper

Use preflight before scope, branch, milestone, or plan changes, and finalize after
the change. Read AGENTS.md, docs/IMPLEMENTATION_PLAN.md, status, staged/unstaged
diffs, refs, and commit subjects. Do not discard or rename unrelated work.

## Preflight

Inspect all locally available branches and remotes using `git for-each-ref` and
all commit subjects using `git log --all --format=%s`. Extract exact ticket tokens
matching `\[SOC-[0-9]{3,}\]`. Repeated tickets count as one milestone. Use the
maximum Git ticket + 1 as the candidate next allocation. Check proposed roadmap
reservations, branch collisions, and remote freshness before reserving it.
In an empty repo the Git maximum is zero and SOC-001 is the initial allocation.

Do not use a TOD-only audit as proof of SOC consistency. Report scope, current
branch/HEAD, dirty changes, highest SOC ID, next candidate, and any conflict.
Proposed future roadmap IDs do not mean implementation completed or override Git.

## Finalize

Inspect the actual diff/history and re-run the same audit. Reconcile milestone
status with delivered evidence: documentation, fixtures, source/UI observations,
provider receipts, PR review, merge, and deployment are distinct states.
Do not mark runtime milestones complete because their plan or branch exists.
Check ordering, unique milestone rows, branch/ticket match, English content,
local document links, and `git diff --check`. Record the next candidate ID and
unverified work. Keep operational credentials and provider enablement separate.

This skill authorizes documentation reconciliation within the requested scope,
not product implementation, commits, pushes, merges, or external actions by itself.
