# SOC-004: finite fixture manifests

Date: 2026-10-03. Status: fixture implementation delivered; live discovery and
durable approval acceptance remain open. No source or social write is enabled.

## Implemented behavior

The pure planner accepts a complete owner-bound snapshot, selected targets, a
per-account cap from 1 to 20 and an explicit cutoff time. It clones the input,
orders accounts as TikTok Personal, TikTok Business, Reddit, X, Pinterest Personal,
Pinterest Business, then selects articles oldest first with slug/ID tie breakers.
Missing accounts, duplicate identities/articles, unfinished pagination and invalid
scope fail closed. A shared Personal/Business account on one platform is rejected.

Each account independently excludes processed or unresolved article IDs before
checking copy, media references, destinations, visibility and music policy. Source
processed IDs must normalize posted, review pending and explicitly skipped results;
unresolved IDs must include pending preparations of unknown provenance and local
unknown submissions. Changed copy never makes a processed ID eligible again.
Exclusions and capped work remain visible in the manifest.

Canonical SHA-256 fingerprints bind the snapshot and entire frozen manifest,
including account IDs, exact title/caption, media URL/digest, destination,
visibility, music policy, limits, cutoff and exclusions. Delivery identity stays
stable across copy changes. Deep freezing prevents accidental local mutation;
digest validation catches altered JSON after transport.

The approval validator binds owner and full manifest digest, requires verified
account identities, and rejects future, expired or over-60-minute approvals.
This is a validation contract, not approval issuance or a publishing permission.
Durable approval storage and explicit owner confirmation remain to implement.

## WF-01 fixture integration

`workflows/SOC-004-manual-plan.json` implements the synchronous fixture subset of
WF-01: Manual Trigger -> authenticated HTTP GET -> safety IF -> Review/Blocked.
The finite fixture needs no asynchronous job or Wait node. There is no scheduling,
webhook, publishing branch, cloud Prepare, result write, media download or journal
write. Worker GET `/v1/plan-fixture` takes no arbitrary URL, path, mode or body.
It returns the fixed synthetic snapshot with six accounts, cap two and 12 items.
`identityVerified=false`, `sourceConnected=false`, `publishingEnabled=false`.
Bearer, loopback Host and Origin protections match the health operation.

With n8n stopped, import once using `npm run import:plan`, then restart n8n.
The importer requires the existing local owner and encrypted worker credential;
it refuses to overwrite a workflow with local edits. Open
`http://localhost:5678/workflow/omnisocialPlanFixture` and Execute workflow.
Review the complete output under Review fixture manifest. The n8n Publish button
is unrelated to owner approval to publish social content; this workflow stays
inactive and manual execution history is not retained.

## Read-only source adapter contract and remaining gate

The portfolio currently lacks a verified authenticated bulk discovery endpoint.
Its mobile UI is not a complete revision-bound snapshot; Prepare must never be
used to crawl it. A separately ticketed portfolio change must provide:

- An authenticated owner identity and revision consistent across all pages.
- Published article IDs/slugs, canonical URLs, timestamps, final rendered approved
  target copy, and validated media references/digests.
- Independent account mapping and complete processed/pending progress, not just
  the recent event window. Normalize cloud slugs into stable article IDs.
- Exhausted pagination before `complete=true`/`nextCursor=null`. Reject changed
  revisions, incomplete histories and unknown identity rather than assuming none.
- Read-only retrieval: no preparation, result updates or internal Next.js actions.

The planner checks HTTPS/media digest syntax only. Trusted-origin allowlists,
actual media byte hashing and download validation belong to the source/media
adapter; no real media reference is accepted by the fixed fixture endpoint.
Snapshots and manifests currently stay in memory. Persisting real manifests,
owner approvals, leases and recovery requires protected local storage; these
fixtures do not establish operational readiness or any real account identity.

## Evidence and post-implementation review

Seven local tests passed: independent account ordering/progress, finite caps,
immutable/replay-stable snapshots, changed-payload invalidation, incomplete and
duplicate rejection, future/unapproved/unsafe-media exclusions, owner/expiry/
identity approval checks, protected runtime HTTP and workflow export invariants.
The HTTP fixture operation rejects POST, query variants, missing authentication
and unavailable journal health. No cloud or provider clients exist in this path.

The sanitized workflow imported successfully into local n8n 2.41.6. Manual UI
execution produced `fixture_plan_ready`, 12 items, all six accounts in order and
disabled publishing. Stopping the worker produced `fixture_plan_blocked` with an
explicit inspection action. Restart/replay produced the same fixture manifest.
Worker journal readback before/after remained only `schema_version=1`.

Known follow-ups: supported live source endpoint, actual session identity,
durable approved-manifest storage and approval entry point. SOC-004 remains
partial until those acceptance gates are satisfied. SOC-005 is the next Git
allocation candidate after SOC-004 delivery; it has not been started here.
