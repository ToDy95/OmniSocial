# SOC-021: stale-worker run allocation and recovery boundary

Source candidate, 16 November 2026. Base `825063d38557b6faab1f66e1b073a05e52064e76`.
Branch `codex/SOC-021-stale-run-fencing`; actual Git maximum was SOC-020 after
fresh origin/all-ref/commit-subject audit. No real-account/runtime/provider operation,
schedule change or live publication is part of this task.

## Observed defect and bounded change

The durable worker epoch advances when another `Operations` instance boots.
Approval creation and submission guards already compare the durable epoch, but
new `openRun` allocation previously only compared an approval with the stale
instance's cached epoch. A deterministic in-memory fixture reproduced an old
epoch 1 instance creating an active epoch 1 run and an account lease after boot 2.
The fresh instance then failed with `account_leased`. Submission itself remained
fenced; this is an allocation/recovery defect, not evidence of a duplicate post.

The candidate checks the current durable epoch inside the existing immediate
transaction, before approval validation or any new run/fence/lease allocation.
A stale instance fails with `worker_restarted`. Existing run-key lookup remains
idempotent; it cannot authorize publication because existing run/epoch/approval
and click guards still apply. No lease expiry, takeover, submission retry, schema
or recovery-state transition is added.

Acceptance: after an epoch advance, a stale instance changes no run/fence/lease;
the current instance can obtain fresh approval and create its own valid run.
Existing `submission_unknown` attempts and their leases survive restart and
continue to block new work until supported reconciliation. An existing run can
still be inspected through its original key, without becoming publishable.

## Authorization matrix as of 16 November 2026

This is a source/decision chronology, not an inspection of current schedules,
accounts, session files or private journals. No such files were opened.

| Path | Latest dated source decision | Source implementation/evidence boundary | This task |
| --- | --- | --- | --- |
| Manual portfolio blog publishing | Owner transport override 3 October 2026; finite approved content/account/destination, Playwright route | Planner, approval, operations and browser adapter code exist; synthetic fixtures are distinct from current account/publication proof | No account runs; ephemeral synthetic browser QA only |
| Existing Reach packs | Owner started SOC-016 on 6 October 2026; existing assets, exact ordered media and per-target manifest; no generation | Current main contains Reach planning/manual workflows; historical live and provider claims retain their dates | Source recovery invariants only |
| Standing scheduled publishing | Plan records 12 October 2026 authorization, 17:00 Europe/Bucharest, six existing target mappings; supersedes older per-run/manual-only rule only for that fixed scope | README/plan report heartbeat active, but scheduled worker integration/current sessions/public receipts are explicitly unverified. No scheduler or runtime configuration was inspected | Neither enable nor disable; no schedule execution |
| Six scheduled targets | TikTok Personal, TikTok Business, Pinterest Personal, Pinterest Business, X, Reddit, in that order; existing article copy/media and independent target stops | Current code target order differs for manual plans; code availability is not a new account/action authorization | No account selection or mapping changes |
| X under the later standing decision |12 October 2026 requires official API automation and canonical-link preview card, not scripted X website | Older generic browser-X code is not proof that this newer scheduled transport contract is implemented or eligible | No X transport/API changes or calls |
| Uncertain publication | Reconcile exact attempt/public receipt before retry; never infer success from click/toast/provider ID | Journal boot converts submitting to unknown; leases stay held; browser reconciliation verifies receipt or retries synchronization without submitting | Preserve behavior and fixture-test fencing |
| Verified receipt, failed writeback | Store receipt before source synchronization; retry sync/readback only | `public_verified_sync_pending` remains non-publishable; explicit close/release is available only after terminal attempts | No cloud/source writes |
| Engagement, DMs, replies, follows, new accounts/media | Outside this V1 publishing authorization; any later separate owner task has its own boundary | Not inferred from publishing/schedule documentation or this estate task | No actions or capability additions |

The newer dated plan decision explains the stale manual-only/no-schedules sentence
in committed `AGENTS.md`; this task does not silently rewrite it or treat that
historical conflict as authority to change a runtime. The parent instruction for
this lane explicitly limits work to source and deterministic fixtures.

## Recovery paths intentionally preserved

- Planner excludes processed/unresolved items, and stable delivery IDs prevent
  changed copy alone from making prior attempts eligible again.
- Prepared work is not submission. Before-click markers and fresh identity/payload
  checks remain the boundary for a possible external effect.
- Restart and stop preserve uncertain attempts; elapsed time never grants takeover.
- Verified receipt plus failed synchronization stays sync-pending. Reconciliation
  does not re-enter composer/submit. Explicit close already exists; a retained lease
  after reconciliation is not automatically a defect or a reason to bypass it.
- No real account/session, browser profile, journal, source snapshot or credentials
  were read to establish these source invariants.

## Actual checks and remaining boundary

On 16 November 2026, exact pinned Node 24.21.0 ran
`node --test tests/operations.test.ts tests/planner.test.ts`: 11 tests passed,
including two in-memory stale/recovery cases and a separate-connection synthetic
temporary-journal case. Strict `tsc -p tsconfig.json` passed using the existing
TypeScript cache, with the identical accepted lockfile and no installation;
the temporary dependency link was removed. `git diff --check` passed.

The full repository suite then passed all 73 tests across 22 files using
`node --test --test-concurrency=1 tests/*.test.ts` on Node 24.21.0. File concurrency
one was a disclosed capacity choice; assertions/timeouts were unchanged. The three
browser fixture files launched fresh ephemeral Chromium, intercepted every tested
provider/portfolio request with synthetic HTML, and injected temporary contexts
instead of opening real account profiles. Other tests used synthetic journals,
mocks and own ephemeral authenticated loopback workers. No real account/profile/
provider browser actions, actual worker, scheduler or external posts were run.
The suite took 49.393 seconds; bounded retained output was 7,625 bytes. No observed
owned process remained after completion, and the dependency link was removed.

Independent review and repository publication remain separate. Production/runtime
installation and any no-replay worker transition require their own source/state
proof; these fixture results do not establish either. No merge, deployment,
scheduler readback or live provider success is claimed. Only synthetic journals
were opened; none came from the actual account runtime.
