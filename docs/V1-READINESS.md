# V1 readiness audit and operator runbook

SOC-012, 2026-10-03. **Local fixture rehearsal passed; real V1 acceptance remains
blocked on owner setup and live integration.** This document does not enable a
publisher. See [the implementation plan](IMPLEMENTATION_PLAN.md),
[runtime](LOCAL-RUNTIME.md), [operations](SOC-005-OPERATIONS.md),
[platform handoffs](PLATFORM-HANDOFFS.md) and [batch evidence](SOC-011-FINITE-BATCH.md).

## Account capability matrix

| Account | Implemented transport | Owner setup still needed | Live acceptance |
| --- | --- | --- | --- |
| TikTok Personal | Assisted desktop or native photo package | Fresh identity and device capability, exact sound/privacy/disclosures | Not run |
| TikTok Business | Separate assisted desktop or native photo package | Fresh Business identity, device capability, commercial sound/disclosures | Desktop Photos tab observed; submission not run |
| Reddit | Assisted owner composer | Fresh identity, allowed community, rules/type/flair | Not run |
| X | Assisted owner composer, conservative copy bound | Fresh identity and image/copy approval | Not run |
| Pinterest Personal | Assisted owner Pin builder | Fresh identity and exact writable public board | Not run |
| Pinterest Business | Separate assisted owner Pin builder | Separate fresh identity and exact writable public board | Not run |

All API transports are disabled. TikTok private utility Direct Post is unsuitable
for this project. X website scripting is disabled. The six account adapters
validate inputs and return handoff instructions; they do not submit posts.

## Observed local checks

- Node fixture suite: 23 tests passed. Covers immutable scope, caps, independent
  progress, authentication/host/origin rejection, bounded fixture JSON, identity
  and login stops, actual media decoding, approval expiry, fencing/concurrency,
  unknown-outcome restart, stop during submit, receipt-before-sync and replay.
- Strict TypeScript checking is configured for worker and scripts. Format and
  disclosure key narrowing fixes preserve runtime behavior. TypeScript 7.0.2 and
  Node 24.10.1 types are explicit development pins.
- n8n 2.41.6 completed a 12-item six-account fixture through serial child flows,
  with zero submissions and zero public receipts. After CLI cleanup, all 13
  imported fixture workflows had null active versions. Editor execution then
  exposed the child publication requirement. The six SOC-011 children were
  published through the local owner UI, using the default publication service;
  they have only sub-workflow triggers and fixed synthetic validation operations.
  The parent remains manual and unpublished. No real publisher is enabled.
- Manual editor execution then reached `Finite fixture report` with
  `batch_fixture_completed`, 12 validated, `dry_run`, zero submitted and zero
  verified public. A synthetic screenshot is stored only in ignored local reports.
- Portfolio TOD-126 PR 132, now squash-merged, contains an owner-only read-only source export.
  Its local suite/type/build/auth checks are recorded in that repository. The
  source was subsequently downloaded through the authenticated local owner
  workspace. The complete export contained 45 articles, with no pagination
  remainder. It remains ignored and owner-only; no source result was changed.
  Snapshot observation found TikTok Personal fully processed, TikTok Business
  and Reddit each with an existing pending preparation, and eligible archive
  content on other accounts. Cloud processed status is not independent proof of
  matching public publications. Existing pending preparations must be reconciled.
- Existing dependency audit findings remain: npm reported 157 findings in the
  installed dependency tree, and 15 optional install scripts remain blocked.
  This audit is not a claim of security certification or production acceptance.
- Python task runner is unavailable; internal runner and npm hosting have
  deprecation warnings. No Python/Code nodes, remote worker, CI or schedules exist.

## Continue from owner login

1. Owner signs in at the local portfolio on `http://127.0.0.1:3001/auth/login`,
   using the existing owner account. Never paste credentials into chat or Git.
2. Verify the owner workspace and retrieve the fixed owner snapshot endpoint
   `/api/admin/omnisocial/snapshot?download=1` through the authenticated browser.
   Save it only as owner-only `runtime/source/snapshot.json` in a protected local
   directory. The export expires after 15 minutes; refresh before real planning.
3. Review actual identities and destinations. Store only reviewed choices in
   `runtime/source/choices.json`: owner, selected target keys, cap 1..20, trusted
   media origins and per-target account ID/public handle/destination/privacy/music.
   TikTok also binds disclosures; Reddit binds post type/flair. Never use fixture
   identities, synthetic observations or guessed board IDs for a real lot.
4. Run `npm run plan:source` with Node 24.21.0. It downloads only selected eligible
   media, verifies actual bytes and saves an immutable local review report.
   It does not Prepare, submit, skip or record a portfolio result.
5. Inspect every package and exclusions. Any text/image/account/destination/music
   change requires a new manifest and approval. An interactive digest approval
   can be saved with `npm run approve:manifest` only after real identity checks.
   Approval is limited to one hour and invalid after worker restart.
6. Complete and validate the real guarded handoff orchestration and portfolio
   Prepare/receipt-bound writeback contract before a pilot. These are still open;
   the fixture HTTP endpoints cannot process the real manifest. Cross-repository
   changes require a newly audited portfolio ticket and separate draft PR.
7. Owner explicitly approves one exact small pilot lot. Owner performs assisted
   native/composer submissions. Recheck source state and matching account directly
   before each action. No automatic retry, account expansion or new-post discovery.
8. Verify matching content/media/account and public URL independently. Public
   boolean/evidence hashes supplied to the journal are contracts, not verification.
   Review pending, private or uncertain outcomes cannot be recorded as public.
9. Store verified receipt before source sync. Confirm matching source posted
   readback before marking completed. Failed writeback means sync pending only.

## Recovery procedure

Stop on login challenge, identity mismatch, unexpected UI or uncertain outcome.
Do not advance the real batch. After restart, approvals expire and submitting
attempts become unknown. Inspect/reconcile the existing publication before any
retry. Do not clear leases with unresolved attempts or create replacement content
to evade duplicate protection. A verified receipt with failed source sync resumes
only writeback/readback, never the platform submission.

For normal fixture rehearsal, run the manual SOC-011 parent in the local editor.
For the isolated CLI alternative, first unpublish the six children through the
owner UI, stop n8n, keep the worker running, then run `npm run execute:fixture`;
review the semantic final report and restart the editor.
The script refuses edited imports. If interrupted during temporary child
publication, inspect and unpublish only the six SOC-011 children before rerunning.
Restore the six child versions through the owner UI before using the editor
again. CLI publishing in this n8n version does not populate the new publication
service records. All logs, profiles, journal, exports and reports stay ignored locally.

## Remaining acceptance gates

Authenticated local source read is verified. Fresh account identities,
devices/destinations/music,
guarded real handoff orchestration, receipt-bound portfolio integration, separately
approved real pilot and owner runbook acceptance remain open. SOC-001 through
SOC-012 and portfolio TOD-126 are squash-merged; see [delivery evidence](DELIVERY-AUDIT.md).
The portfolio merge commit has a successful Vercel status, but authenticated
production endpoint readback is not verified. The full V1 is not complete or
enabled. [SOC-014](SOC-014-DESKTOP-PROGRESS.md) adds desktop capability gating and
source progress reporting after a fresh Git audit. SOC-015 is the next candidate,
subject to fresh refs and scope authorization. V2 remains deferred.
