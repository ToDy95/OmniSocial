# SOC-005: durable operations and recovery

Local implementation with synthetic acceptance. Provider submission, automated
source preparation/writeback and real owner approvals are not exposed via HTTP.

## Journal behavior

The protected SQLite journal now stores immutable manifests, approval records,
run epochs/fencing tokens, per-account leases, attempts, receipts and pending sync
keys. An explicit approval binds the stored owner/digest and expires within one
hour; unverified account identities cannot be approved. Restart invalidates old
approvals and active runs. A submitting attempt becomes submission_unknown.

Opening a run transactionally reserves every selected account. Repeated run keys
return the existing run; conflicting keys and concurrent account leases are
rejected. Lease timers do not cause takeover. Stop rejects buffered submissions,
and in-flight submissions remain uncertain. Release refuses unresolved attempts.
A new approved run may retry a proven pre-submit failure, but known/unknown prior
attempts require reconciliation and never become eligible just from new copy.

Submission markers validate fresh account and payload observations against the
approved manifest. These are library contracts, not an implemented provider
transport. Receipt matching checks item, account, payload, platform URL, public
status and evidence digest. Evidence collection must be performed by the adapter
or an explicit owner-assisted verification; a caller-provided boolean is not
independent public verification. All committed receipt examples are synthetic.

Receipts are stored before source synchronization. A failed/lost source response
leaves public_verified_sync_pending, never a new publish attempt. Completion
requires matching sync key, external URL and source posted readback. Real source
write/readback adapters still require their own portfolio contract and acceptance.

## Preparation and live source bridge

`npm run plan:source` reads only protected fixed files:
`runtime/source/snapshot.json` and `runtime/source/choices.json`. Export support is
implemented in portfolio TOD-126 / PR #132. SOC-012 subsequently downloaded the
complete export through the authenticated local owner workspace; hosted
deployment, source writes and real publication acceptance remain unverified.
The local importer requires the expected owner, complete export, recent timestamp
(15 minutes), matching public handles, selected accounts and bounded cap. It maps
full processed slugs and pending preparations to stable article IDs. Destination,
visibility and music choices must be explicitly configured, not inferred.

Media downloads are limited to eligible selected items and configured trusted
portfolio/Supabase HTTPS origins. Redirects are refused, streams cap at 10 MiB,
MIME must match decoded PNG/JPEG/WebP, and full pixel decoding verifies dimensions
and corruption. Animated/oversized images are blocked. SHA-256 files stay 0600 in
0700 runtime directories; no media is converted or generated. Sharp is pinned to
0.35.3. The npm dependency update retained pinned n8n/Playwright versions; existing
n8n optional-install-script blocks and dependency audit findings remain separate.

The resulting manifest and media handles are saved locally for owner review.
No source progress, submitted/skipped result or social content is changed by a
dry run. A new export is needed for rechecking source before any real submission.
`npm run approve:manifest` requires an interactive owner terminal, displays the
complete saved source manifest and asks for its exact digest. It binds the
configured owner, refuses unverified identities and stores the one-hour approval.
It does not submit content. This entry point has not been used for a real lot.

## n8n fixtures

Five inactive manually started exports model WF-04/09/10/11/12 recovery contracts.
`npm run import:recovery` with n8n stopped refuses to replace existing workflows.
Their fixed authenticated GET operations use an isolated in-memory synthetic
journal, never actual source or provider clients. They validate unknown restart,
blocked retry, sync-pending receipt and matching readback completion. They are
fixture subsets; their names do not establish production readiness.

POST `/v1/save-fixture-plan` saves only the fixed synthetic manifest in the local
journal with no approval. It rejects bodies/query variations and cannot publish.
Existing fixture plan GET remains read-only. No URL/script/profile/filesystem
operation, approval grant, live publishing or cloud mutation is exposed.

## Acceptance and remaining gates

Tests cover immutable persistence, competing starts, fencing, stop, unknown
restart, invalidated approvals, receipt conflict, lost/failed sync, repeat
reconciliation, media corruption/MIME/redirect/origin/size and source completeness.
Source integration is still blocked on an actual owner-session export and reviewed
account/destination choices. Real provider receipts and source synchronization
have not run. Remaining platform milestones can implement assisted validation and
handoff with fixtures while these live gates stay explicit.

Validation: 14 local tests passed. All five sanitized workflow imports matched
database readback and all five authenticated fixed HTTP recovery operations
returned retryBlocked=true/reconciled=completed with synthetic=true. No live
approval, provider request or source write was made. Dependency lock updates were
reviewed; pinned n8n and Playwright versions remain unchanged. SOC-006 is the next
Git allocation candidate after this task, subject to a fresh audit.
