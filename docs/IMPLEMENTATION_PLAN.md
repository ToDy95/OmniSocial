# OmniSocial V1 Implementation Plan

Date: 2026-10-03. Timezone for operator-facing dates: Europe/Bucharest.

Status: SOC-001 through SOC-012 are squash-merged into main after explicit owner
authorization. Local fixture runtime, finite batch, recovery and type checks pass;
the authenticated local portfolio export is verified. SOC-013 records delivery
evidence in [the merge audit](DELIVERY-AUDIT.md). Real account/device/destination
checks, guarded live orchestration, receipt-bound portfolio writeback and an
exactly approved pilot remain open. Real publication stays disabled; V2 is deferred.

## 1. Goal and scope

### Owner transport override — 2026-10-03

The owner explicitly selected Playwright UI publishing and removed platform-policy
approval and API eligibility as project blockers. This direction supersedes the
policy-based transport gates elsewhere in this plan and earlier feasibility
documents; those passages remain historical research, not active acceptance
requirements. Do not redirect this flow to an API integration. Preserve bounded
owner-approved manifests, dedicated browser profiles, account checks, stops for
CAPTCHA/MFA/login expiry, and receipt verification before portfolio writeback.
This documentation change does not enable submission or establish that the live
browser runner is implemented or validated.

Reduce the owner's daily work distributing already published portfolio articles
and approved social copy through https://www.razvantodica.com/admin/mobile.
Preserve the familiar two-tab handoff: the portfolio page selects the destination
and prepares the post; the other page is the matching social account. Use n8n to
learn and manage orchestration, with a local browser worker where permitted and
official API adapters where eligible. Some destinations can remain assisted.

The desired order is TikTok Personal, TikTok Business, Reddit, X, Pinterest
Personal, then Pinterest Business. Finish eligible items for one account before
moving to the next. The owner can select a smaller subset or change the order in
the run manifest. Work is sequential; one article can have independent outcomes
for different accounts. A run ends when its frozen manifest is exhausted, not
when a live page happens to offer more newly created content.

Included: manual start, account/session checks, source discovery, preparation,
approved title/caption/media, platform routing, permitted submission or assisted
handoff, receipt verification, portfolio result recording, restart-safe recovery,
pause/cancel, and local reports. Initial format is a blog article with cover image
and platform copy. Reach packs, video production, carousels, and new AI generation
are additional scope and require later explicit decisions.

Excluded: a new public app, a hosted social-account database, bulk scraping,
schedules, autonomous engagement, mass replies, DMs, likes/follows, paid generation,
social analytics dashboards, and implementation of V2.

## 2. Evidence and feasibility baseline

The portfolio source was inspected locally on 2026-10-03. This is code evidence,
not a live authenticated UI observation or a publication receipt.

| Source | Observed contract |
| --- | --- |
| `lib/mobile-publishing.ts` | Six target keys, public handle mappings, composer URLs, eligibility, oldest-first order, and prepared caption builders |
| `app/admin/mobile/page.tsx` | Owner-protected page, `social_publishing_state`, published articles, approved variants, and pending-post selection |
| `components/admin/mobile-publishing-workspace.tsx` | Prepare, download/copy/handoff, result form, URL, sound/privacy, board, subreddit, and notes |
| `app/admin/actions.ts` | Owner-protected prepare and record actions; existing cloud persistence |

The current source uses `social_publishing_state` for per-target progress. Verify
the event/RPC schema and its relation to `integration_deliveries` before adding an
adapter. Do not assume an older ledger note is the current mobile contract.

| Portfolio target | Repository handle candidate | Platform-specific input |
| --- | --- | --- |
| `tiktok_personal` | `@todicarazvan95` | Title, caption, image, sound, visibility |
| `tiktok_codeonroids` | `@code.on.roids` | Same fields, Business music policy |
| `reddit` | `u/Inner_Student_5236` | Owner-reviewed subreddit, post type, flair, title/body/media |
| `x` | `@RazvanTodica` | Approved compact copy, image, canonical article link |
| `pinterest_personal` | `@todyimmortal` | Pin title, description, image, destination link, board |
| `pinterest_business` | `@codeonroids` | Same fields, separate account and board |

These are configuration candidates from source, not proof of current logged-in
accounts. The owner confirms actual platform identity during setup and every
submission checks the account again. Prefer stable platform account IDs when
available; a changed handle requires explicit mapping reconciliation.

### Platform transport decisions

No blanket promise of unattended publication on all six targets is made.
SOC-002 must assign each account a supported, assisted, or blocked transport.
Manual start does not override platform restrictions.

| Platform | V1 decision and gate |
| --- | --- |
| TikTok Personal/Business | Validate the actual photo + title + caption + music workflow on the chosen device. Direct Post guidelines reject private utilities limited to an owner's/team's accounts, so Direct Post is not the assumed solution for this project. Evaluate an eligible approved integration or owner-operated native handoff; website automation requires affirmative policy and capability evidence. |
| X | Website scripting is prohibited by X automation rules. Use an authorized API adapter if available, or an owner-operated composer handoff. No automatic X website clicks. Verify access, costs, media support, and rate limits before enabling the API path. |
| Reddit | API use requires explicit approval under the Responsible Builder Policy. Confirm current approval and terms, and owner-reviewed subreddit rules. Without eligible access, retain an owner-operated submission handoff; do not work around rejected access through scraping or hidden endpoints. |
| Pinterest Personal/Business | Check each account's app/OAuth access, accepted use case, board permissions, and Pin creation support. Prefer an eligible official adapter; retain owner-operated Pin builder handoff otherwise. Login or stored boards alone do not establish API approval. |

For Business TikTok use commercially available sounds from the Commercial Music
Library. Personal-account access to a broader library does not establish rights
for promotional content. Initially use owner-selected audio or a reviewed set of
eligible tracks. Random choice, if enabled later, selects only from that eligible
set, records the sound, and respects region, account, and content-use constraints.
If no track is eligible, ask for an owner decision; never silently choose one or
remove music. Do not download or redistribute trending songs.

Photo-mode and music controls may require a native mobile app. A desktop video
upload page is not evidence that a photo-with-music workflow works. If the pilot
requires native interaction, V1 pauses for that owner step. Adding Appium or a
mobile-device runner is a separate, explicitly scoped decision.

## 3. Architecture and persistence

Proposed runtime: local/self-hosted n8n plus a small TypeScript/Playwright worker.
Use HTTP Request nodes to call fixed worker operations on a private authenticated
connection. Do not rely on arbitrary shell execution inside n8n Code nodes.
Choose and pin supported Node, n8n, Playwright, and browser versions in SOC-003.
No dependencies are installed by SOC-001. SOC-003 uses the pinned npm distribution
and Node built-in SQLite; see [local runtime](LOCAL-RUNTIME.md) for actual scope.

The worker owns browser pages, uploads, account checks, local media, and receipts.
n8n owns manual entry points, sequencing, routing, waits, and reporting. A native
or API adapter implements the same structured operation contract as the browser
adapter. OmniRoids can supply planning/reliability context; it is not a required
publishing executor or a second credential store.

Use dedicated browser profiles, preferably separate sessions for accounts on the
same platform. Each active account has an admin page and a social page. Reuse or
open the proper account session on a switch, then verify its identity. Never
control the default daily Chrome profile. Browser profiles and storage-state
exports contain credentials and need filesystem protection; persistence alone is
not encryption. The owner performs login/MFA interactively, outside workflow
inputs. n8n receives status such as `login_required`, never passwords or cookies.

n8n itself needs persistent internal data. "No database UI" means no new hosted
business database or admin application, not zero runtime persistence. Keep a
small local SQLite execution journal, plus n8n's own persistent volume. The
portfolio ledger remains the source of portfolio delivery progress. The journal
stores attempt state, durable receipts, locks, and outstanding portfolio writes;
it does not overwrite the cloud truth or authorize publication by itself.

Reports: one JSON, CSV, and Markdown report per run, with a short operator summary.
Suggested defaults to confirm in SOC-003: media cleanup seven days after terminal
completion, redacted screenshots seven days, compact journal and reports 90 days.
Unresolved receipts and pending synchronization are protected from cleanup. Keep
all real runtime data ignored by Git. Do not export secrets or private pinned
execution data with n8n workflow JSON.

## 4. Run approval and job contracts

Two distinct manual entry points are planned: Plan/Dry Run and Publish Approved
Manifest. Executing Plan is not publication approval. In Publish, the owner
confirms a frozen manifest ID and digest, mode, exact accounts/posts, per-account
caps, destinations, visibility, and music policy. That manual action authorizes
the specified lot. Per-post confirmation is required where a platform demands it
or where the manifest does not cover a changed choice. No forced extra approval
is needed for unchanged already-approved operations within the same valid lot.

Default mode: `dry_run`. A publish input must explicitly set `mode=publish` and
`ownerConfirmed=true` and reference a non-expired approved manifest. A boolean
alone is insufficient: the worker must validate the referenced approval record,
digest, owner, account scope, and expiry. Do not put approvals or resume tokens in
committed examples. Initially propose an approval expiry of 60 minutes, confirmed
at implementation. Waits and timeouts never create approval. Revalidate after a
restart or long pause; expired authorization requires a new explicit start.

| Record | Minimum fields |
| --- | --- |
| Run | runId, n8nExecutionId, mode, owner reference, manifestId/digest, approvedAt/expiresAt, target order, caps, status, start/end, workflow version |
| Item | itemId, articleId, slug, canonical URL, publishedAt, source revision/fingerprint, targetKey, platformAccountId/verified handle, title/caption, media digest/path, board/subreddit, visibility, music policy |
| Attempt | delivery key, attemptId, operation key, stage, fencing token, timestamps, submission certainty, receipt reference, error code |
| Receipt | target/account, article/content/media digest, providerId when available, canonical post URL, visibility/review evidence, sound/board/subreddit, verifiedAt, evidence reference |
| Result | posted, review pending, owner skipped, blocked, failed before submit, unknown submission, or pending portfolio synchronization |

Keep delivery identity stable as `(owner, articleId, targetKey, platformAccountId)`.
A changed content hash does not make a previously posted article automatically
eligible again. Reposting requires a separate explicit owner decision. Bind the
current attempt to exact payload/media fingerprints and destination metadata.
Keys must remain stable on request retry; n8n execution IDs alone are not delivery
keys across manual reruns. Store the result before responding to a repeated call.

## 5. End-to-end operator flow

1. Owner starts Plan/Dry Run in n8n with selected accounts, caps, and date range.
2. Check worker health, source login, platform identity/eligibility, current
   journals, unresolved submissions, and existing cloud progress. Dry-run login
   checks do not submit, prepare, skip, or mark any source post.
3. Discover already published articles with approved destination copy and required
   media, oldest first. Remove posted, review-pending, explicitly skipped, or
   unresolved items for each account. Produce a finite manifest and preview.
4. Owner reviews and explicitly starts Publish Approved Manifest.
5. Acquire an exclusive run lease with a fencing token. A second publishing run
   cannot use the same source/account/session while the first is live or has an
   unresolved submission. An expired timer alone never proves the browser stopped.
6. For the first account, set the corresponding admin target and verify the social
   account. Load only that account's approved items from the frozen manifest.
7. Recheck cloud progress and source fingerprint before each item. If already
   recorded, return its known result. If a pending item has unknown provenance,
   reconcile it before treating it as a new job.
8. Click Prepare this post once through the supported source adapter. Read back
   target, slug, title, and prepared caption. Capture all content before opening
   a composer; avoid relying on a shared clipboard as durable storage.
9. Download the approved cover to a per-attempt local directory. Check allowed
   origin, file size, real content type, dimensions, and digest; wait for download
   completion. Do not assume a `.webp` filename proves the provider accepts it.
10. Route to the platform adapter. Confirm account, destination, text limits,
    media, visibility, disclosures, and sound before submitting. Pause for any
    required native/manual input or unsupported capability.
11. Persist `submitting` before the side effect. Submit once when permitted, or
    let the owner perform the final action in the assisted flow. Assisted owner
    submission is journaled before verification and is not labeled automated.
12. Verify the resulting post: matching account, content/media, correct board or
    subreddit, public visibility, and canonical permalink. A URL without matching
    content, or a success toast without publication evidence, is insufficient.
13. Persist the receipt locally before portfolio synchronization. Return to the
    source tab and check target/slug again. Populate URL and relevant fields.
14. For verified public results choose Posted / public. For TikTok review-pending
    choose Sent, waiting for review. Other pending outcomes remain local until
    a supported portfolio state is available. Read back the saved source result.
15. Continue to the next approved item, then account, subject to configured limits
    and documented provider limits. End with a partial or complete report and
    release the lease only after the journal records the final state.

The current mobile page may expose only the next/pending article, not a supported
bulk snapshot API. SOC-002 must confirm a read-only discovery route through the
owner archive/admin surfaces. Start with a one-item manifest if necessary. If
bulk enumeration requires a thin owner-protected portfolio endpoint, define its
contract and create a separate portfolio ticket/PR; do not call private Next.js
server-action internals, mutate Prepare to crawl the queue, or assume an endpoint
already exists. Pagination must finish before freezing a batch manifest.

## 6. Platform subflows

### TikTok Personal and Business

One adapter with independent configuration and sessions. Personal first verifies
the configured personal account; Business verifies its separate account. Prepare
the respective admin target, download cover, retain prepared title and TikTok
caption, and enter the supported creation experience. Validate actual photo-mode
support, upload, title/caption limits, selected audio, visibility, and commercial
disclosures. Never silently replace the image post with a slideshow video.

If audio needs an owner choice, report `awaiting_owner` with account/item context.
Resume only after capturing the chosen permitted sound and validating current
approval. Record sound and privacy alongside URL. Upload/processing/review or
`SELF_ONLY` is not public; preserve a pending receipt and reconcile manually later.
Unaudited Direct Post private-only behavior is not a public-publishing solution.
The same article can have a Personal success and a Business pending outcome.

### Reddit

Require one owner-selected reviewed subreddit per item; do not send the same
article to every community. Confirm current self-promotion/link rules, permitted
post type, flair, and account identity. Use API only with accepted approval and
access. Otherwise supply title/body/image as an assisted owner handoff.

Respect the selected text/link/image format rather than assuming every subreddit
supports image plus full caption. An unsupported body/media combination blocks
the item and requests an owner choice. Capture moderation-pending separately from
public. After matching public evidence, record permalink, subreddit, and notes.
Any rejection or login/CAPTCHA stop produces no automatic skip or retry.

### X

Use approved compact copy with canonical link and image. Check the current text
limit and provider counting, including links, before approval; do not silently
truncate or split into a thread. This V1 scope is a single post. Verify the account
and image processing before an eligible API submission. If access is unavailable,
open the owner composer handoff with copy and media instructions; the owner
performs upload/publication. Do not script X website interactions. Verify the
matching status URL and synchronize the portfolio result.

### Pinterest Personal and Business

One adapter, two independent sessions/account configurations. Verify the chosen
account and an explicit writable board for that account. Prepare the admin target,
upload cover, fill approved Pin title/description, canonical article destination,
and available alt text. Check field/media limits during the platform preflight.
A board from Business cannot be silently reused on Personal. Use eligible API
creation or an owner-operated Pin builder, as determined by SOC-002. Verify the
Pin permalink, board, image, destination link, and visibility; then record URL
and board in the portfolio. A private board is not a public Pin success.

## 7. n8n construction blueprint

Workflow IDs below are design names, not existing imported workflows. Implement
in sequence with synthetic inputs and inactive/no-schedule entry points. Store
sanitized workflow exports under `workflows/` only once implemented.

### WF-01: Manual Plan / Dry Run

`Manual Trigger -> Edit Fields -> HTTP Request: create planning job -> Wait ->
HTTP Request: job status -> IF/Switch -> HTTP Request: manifest -> report`

- Edit Fields defines target order, date range, finite caps, and `mode=dry_run`.
- HTTP Request sends authenticated JSON to the worker and retains run/job IDs.
- Long operations return a job ID; poll with GET, using a bounded interval and
  deadline. A timeout does not resubmit a side effect.
- The report shows proposed post/account pairs, source availability, payload
  previews, destinations, platform transport, and exclusions with reasons.
- This workflow never calls prepare, submit, skip, or record-result operations.

### WF-02: Manual Publish Approved Manifest

`Manual Trigger -> Edit Fields: manifest approval -> HTTP Request: open run ->
IF: lease/approval valid -> Loop Over Items: accounts -> Execute Sub-workflow:
WF-03 -> Switch: account result -> WF-11: final report/close`

- Edit Fields requires manifest ID/digest and explicit publish confirmation.
- The worker validates immutable payload approval and acquires the fenced lease.
- Loop Over Items uses Batch Size 1. The final account result connects back to
  the loop input; its done output closes the run. No new manifests are generated
  inside this publish workflow.
- Execute Sub-workflow waits for completion. A blocked or unknown outcome stops
  the publishing run by default and includes remaining items in the report.
- GET polling and Wait intervals may continue an already authorized run; neither
  starts a new one nor authorizes publication after approval expires.

### WF-03: Process Account

`Execute Sub-workflow Trigger -> HTTP Request: account preflight -> IF: identity
matches -> HTTP Request: approved item list -> Loop Over Items: posts ->
Execute Sub-workflow: WF-04 -> Switch: item outcome -> Wait: permitted pacing ->
loop input; done -> return account summary`

Use a separate inner workflow for the post loop so the two loop contexts do not
overwrite each other. Set Batch Size 1 and wait for child completion. Items come
only from the frozen manifest. Identity and lease checks recur before each submit.

### WF-04: Prepare and Route One Post

`Execute Sub-workflow Trigger -> HTTP Request: recheck item -> Switch: known/new/
unresolved -> HTTP Request: prepare -> HTTP Request: capture package ->
HTTP Request: download/validate media -> Switch: target -> WF-05/06/07/08 -> WF-09`

Pass runId, itemId, operation keys, and lease token; keep media in the worker and
pass handles/digests rather than cookies or large binary payloads through n8n.
Known receipts route directly to synchronization/reconciliation, never to submit.
Each operation returns a structured status and safe error code.

### WF-05 through WF-08: Platform Adapters

| Workflow | Node behavior |
| --- | --- |
| WF-05 TikTok | Validate transport -> account/media/audio checks -> assisted wait or supported submit -> bounded status polling |
| WF-06 Reddit | Validate approved access, subreddit/type/flair -> supported submit or owner handoff -> result |
| WF-07 X | Validate API eligibility -> submit API or owner composer handoff -> result; no website scripting |
| WF-08 Pinterest | Verify account/board/media/fields -> supported API or owner handoff -> result |

Each has an Execute Sub-workflow Trigger, HTTP Request operations, and Switch/IF
branches for known status codes. An `awaiting_owner` branch pauses via Wait and
polls worker state, or uses a secured authenticated Wait resume/form mechanism
after its version-specific behavior has been validated. Resume references are
one-use, bound to run/item and expiry. They never accept a bare URL as proof.
Do not expose unauthenticated resume URLs. Timeout returns blocked, not approved.

### WF-09: Verify Receipt and Synchronize Portfolio

`Execute Sub-workflow Trigger -> HTTP Request: verify -> Switch: public/pending/
unknown -> HTTP Request: journal receipt -> HTTP Request: synchronize source ->
HTTP Request: source readback -> return`

Posted/public needs verified URL and matching evidence even though the source
form currently makes URL optional. Review-pending maps only to states the source
actually supports. Successful publication with failed writeback returns
`public_verified_sync_pending`; it does not re-enter the publishing adapter.

### WF-10: Manual Reconcile / Resume

`Manual Trigger -> Edit Fields: run or item reference -> HTTP Request: outstanding
attempts -> Loop Over Items -> HTTP Request: verify status -> WF-09 -> report`

Reconcile mode checks existing submissions and repairs portfolio synchronization;
it cannot submit new posts. A confirmed pre-submit failure may become eligible
only in a new explicitly approved publish manifest. Existing public receipts are
never republished. Uncertain cases stay blocked for owner inspection.

### WF-11: Failure Recording and Reports

Use explicit result branches and child-workflow returns for expected errors.
Configure HTTP Request errors to a handled output rather than losing the run
context. Unexpected failures require durable worker journaling and a report on
the next manual reconciliation.

n8n Error Trigger does not run for manually executed workflow failures according
to current documentation. It must not be the only failure-reporting or cleanup
mechanism. Do not add an automatic trigger merely to make error handling work.
Generic n8n "Retry execution" is not a publication recovery mechanism.

### WF-12: Manual Stop / Cancel

`Manual Trigger -> Edit Fields: runId -> HTTP Request: request stop -> HTTP Request:
safe state -> report`

Stopping n8n alone does not prove the separate worker stopped. The worker must
reject future submissions after stop, including buffered child requests. If
submission was already in flight, cancel records an uncertain or known receipt
for reconciliation. It cannot undo an external post. Restarting services must not
automatically resume publishing. No external messages are sent by these workflows.

### Import/build order and settings

1. Pin versions, configure local authentication, persistent volumes, journal,
   encryption-key handling, timezone, filesystem permissions, and redacted logs.
2. Build WF-11 reports and fixture worker responses first.
3. Build WF-01 planning and prove absence of publish/prepare mutations.
4. Build WF-09/WF-10/WF-12 verification, recovery, and cancellation with fixtures.
5. Build WF-04 and the first eligible platform child workflow.
6. Build WF-03, then WF-02; connect loop-back and done paths explicitly.
7. Add the remaining platform adapters one at a time.
8. Run replay/concurrency/error fixtures before any owner-authorized pilot.
9. Export sanitized JSON, re-import into a clean pinned n8n instance, and verify
   credential mapping and sub-workflow IDs without real submissions.

Set child-workflow input schemas and Wait for Sub-Workflow Completion=true. Keep
publication request retries off. Retrying a job-creation call is allowed only
when the worker's operation key guarantees the same job/result; provider-submit
retries are never delegated to n8n blindly. Save sufficient redacted manual-run
data for diagnosis and configure explicit pruning. No Schedule Trigger, event
watcher, or publicly callable publication trigger is part of V1.

## 8. Proposed worker boundary

These endpoints describe a future fixed-operation contract, not existing routes.
They must be authenticated, validated, allowlisted, and available only locally or
on a private network. Docker n8n `localhost` is the container, not the Mac worker;
document the private host/network mapping before implementation.

| Operation | Proposed contract |
| --- | --- |
| Health | GET /health; version and capability status, no secrets |
| Plan | POST /plans; validated dry-run settings, idempotent operation key, job ID |
| Job status | GET /jobs/:id; state, safe error code, output handles |
| Manifest | GET /plans/:id; frozen preview/digest, scoped owner access |
| Open publish run | POST /runs; manifest approval, exclusive lease/fencing token |
| Prepare/submit/verify/sync | POST /runs/:id/items/:itemId/operations; fixed enum, scoped keys, lease; long operation returns job ID |
| Reconcile | POST /reconciliations; existing attempt IDs, no publish capability |
| Stop | POST /runs/:id/stop; durable stop flag and known safe stage |
| Report | GET /runs/:id/report; scoped redacted results, no credentials |

The proposed methods are transport choices, not permission to automatically retry
POST. Persist each operation result transactionally. Validate run/item ownership,
approved digest, state transition, and stop/lease state at the worker boundary.
Do not accept arbitrary scripts, profile paths, URLs, or media paths from n8n.

## 9. State machine and recovery

Normal path: planned -> approved -> prepared -> media_ready -> awaiting_owner or
ready_to_submit -> submitting -> submitted -> verified_public ->
public_verified_sync_pending -> completed.

Branches: already_recorded, owner_skipped, blocked_before_submit,
failed_before_submit, submitted_pending_review, submission_unknown,
cancel_requested, stopped. Separate platform submission state from portfolio
synchronization state. n8n node success is neither state.

| Failure | Required behavior |
| --- | --- |
| Wrong account, expired login, MFA/CAPTCHA | Stop account/run and request interactive owner correction; no login guessing |
| Missing/unapproved source copy, media failure, excessive length | Block with exact reason; do not silently truncate, regenerate, or skip |
| Page or selector changed | Save redacted diagnostic evidence and stop; do not guess submit controls |
| Download interrupted | Retry download with validation; publication has not happened |
| Provider rate limit | Honor supported retry timing/caps within approval lifetime; otherwise stop |
| Response lost during submit | Persist submission_unknown and reconcile; no automatic publish retry |
| Public post verified, source write failed | Preserve receipt and retry only source synchronization |
| Source write response lost | Read back target-specific result before repeating idempotent synchronization |
| Review pending or non-public post | Preserve pending state; manual status reconciliation, no duplicate |
| Manual Stop, Mac sleep, runner crash, n8n restart | Journal survives; reject fresh submissions until explicit recovery/approval |
| Second run or stale lease | Reject publishing; unresolved prior side effects block takeover |
| Owner requests skip | Record explicit decision and source readback; an error never auto-skips |
| Cloud/local disagreement | Prefer evidence-backed reconciliation; never infer eligibility just from one absent record |

Guarantee replay-safe orchestration with explicit ambiguous outcomes, not universal
exactly-once provider execution. Keep a durable pre-submit marker and receipt to
narrow the uncertainty window. A provider without idempotency/reliable lookup
requires owner review after an unknown outcome.

## 10. Reports and operational procedure

Each report identifies run, source snapshot, workflow/adapter versions, requested
and processed account/post counts, verified public URLs, pending reviews, assisted
actions, failures, skips, unknown outcomes, and remaining approved work. Include
sound, board, subreddit, timestamps, and pending portfolio sync where relevant.
Do not count submitted_pending_review as public or count a manual handoff as an
automated publication. CSV rows and JSON records share the same stable item ID.

The operator procedure is: start local services -> check sessions -> Plan ->
review exact manifest -> Publish -> handle requested native steps -> inspect
report -> manually Reconcile pending cases. A later run discovers new eligible
work afresh. Reports are local; sending email/Slack/DM notifications is separate
scope. Sessions can be revoked locally; metadata never stores passwords.

## 11. Milestones and delivery order

SOC-001 through SOC-015 are allocated after Git audits. Later IDs are proposed
roadmap reservations; audit all refs before allocating each new task. Split an
oversized milestone if needed and update the roadmap rather than reuse IDs.

| ID | Scope and dependency | Acceptance / exit evidence | Status |
| --- | --- | --- | --- |
| SOC-001 | Initial repository, English implementation plan, agent/commit/PR conventions | Initial commit, reviewed documentation checks, pushed feature branch and draft PR; runtime explicitly unimplemented | Documentation authored; PR review pending |
| SOC-002 | Source/transport feasibility, all account mappings, current terms and approvals | Six-target matrix with supported/assisted/blocked decisions; verified device/media path; current source discovery/ledger contract; required portfolio PRs identified | Evidence documented; account/device acceptance pending. See [feasibility report](SOC-002-FEASIBILITY.md) |
| SOC-003 | Local n8n + worker skeleton, sessions and protected persistence; after SOC-002 | Pinned versions, health operation, protected dedicated profiles, manual login, journal durability, private network, sanitized config; no real submission | Installed and running; owner setup complete; inactive manual n8n-to-worker health workflow imported and verified for ready/blocked results. Synthetic persistence/security and blank Chromium checks passed. Social profile login/identity acceptance pending. See [local runtime](LOCAL-RUNTIME.md) |
| SOC-004 | Read-only discovery, immutable manifests, approvals and WF-01 | Exact per-account oldest-first finite jobs, approved content/media fingerprints, existing progress respected; dry-run fixture proves zero mutations | Fixture planner and manual WF-01 subset implemented and validated; complete live discovery and durable owner approval acceptance pending. See [dry-run manifests](SOC-004-DRY-RUN.md) |
| SOC-005 | Durable operations, lease/stop semantics, common preparation, receipt/sync and WF-04/09/10/11/12 | Crash/retry/concurrency and sync-only recovery fixtures; matching source readback; no unsupported Next.js internal calls | Durable library, source/media preparation and manual recovery fixture exports implemented; local tests/imports passed. Live writeback and provider evidence remain gated. See [operations](SOC-005-OPERATIONS.md). |
| SOC-006 | TikTok Personal adapter and WF-05 pilot; after SOC-002 through SOC-005 | One separately owner-authorized photo/title/caption/sound pilot via permitted transport, matching account and receipt; native gaps remain explicit | Assisted validation/handoff contract implemented with fixtures. Real native device, identity and separately approved pilot remain pending. See [handoffs](PLATFORM-HANDOFFS.md). |
| SOC-007 | TikTok Business configuration/pilot | Separate identity/history, eligible commercial sound and disclosures, Personal cannot contaminate Business; owner-authorized receipt | Assisted Business validation and fingerprint-bound disclosure choices implemented with fixtures. Actual account type, rights and owner-approved native pilot pending. |
| SOC-008 | Reddit adapter and WF-06 | Current accepted API access or assisted route, reviewed single subreddit/type/flair, no duplicate, evidence-backed result and source sync | Assisted subreddit/type/flair validator implemented with fixtures; API disabled. Actual community, identity, pilot receipt and source sync acceptance pending. |
| SOC-009 | X adapter and WF-07 | Eligible API or assisted owner handoff, compact copy/media validation, no website scripting, receipt/source sync | Assisted composer/compact-copy validator implemented with fixtures; website scripting and API disabled. Real identity/media/public receipt and sync acceptance pending. |
| SOC-010 | Pinterest Personal and Business adapter and WF-08 | Separate eligible account/board mappings, image/link/description verification, independent owner-authorized receipts | Assisted two-account board/copy/link validator implemented with fixtures; API disabled. Actual board/identity and owner-approved Pin receipts pending. |
| SOC-011 | Account/post loops, WF-02/03, full finite batch and reports | Imported exports round-trip, sequential target order, cap/expiry enforcement, no schedules, replay-safe full fixture batch and authorized small mixed pilot | Fixture implementation validated: 22 tests passed and n8n CLI completed all 12 synthetic items with zero submissions. Seven imports matched; children unpublished after rehearsal. [Evidence](SOC-011-FINITE-BATCH.md). Real mixed pilot gated. |
| SOC-012 | V1 readiness audit, runbook, recovery rehearsal and report review | Failure/security/replay cases pass, documentation matches actual capabilities, unsupported targets clearly assisted/blocked, owner accepts operating procedure | Local audit/runbook and strict worker/script type checking implemented; 23 fixtures passed. [Readiness matrix](V1-READINESS.md) records live source, real guarded orchestration/writeback, pilot and owner acceptance gates. Full V1 not ready. |
| SOC-013 | Delivery reconciliation after owner-authorized merges | One squash commit per feature milestone, resulting main trees match reviewed branches, current documentation separates merges from live acceptance | [Delivery audit](DELIVERY-AUDIT.md) records merged SOC-001 through SOC-012 and portfolio TOD-126, passing checks, preserved local work and remaining owner inputs. Documentation only. |
| SOC-014 | Desktop photo handoff and independent account progress | Fresh per-account desktop capability gate, protected source progress report, preparation distinct from public receipts | [Desktop and progress record](SOC-014-DESKTOP-PROGRESS.md) documents observed Business Photos support, owner board locators and remaining integration gates. Assisted handoff only; no real submission. |
| SOC-015 | Owner-requested Playwright UI execution and manual n8n orchestration | UI source discovery, protected profiles, exact approval, sequential submit/receipt/writeback, restart-safe reconciliation and fixed private operations | [Browser execution](SOC-015-PLAYWRIGHT.md) implemented and validated with 42 local tests, including seven Playwright UI fixtures, and strict TypeScript. Two inactive manual n8n workflows imported and read back. Dedicated portfolio and both TikTok logins confirmed across a worker restart; fixed read-only inspection added and composer hydration wait corrected. Google popup closure fixed with a manual-only exact OAuth origin allowance. Portfolio TOD-127 production release and one separately approved Playwright pilot with public receipt and cloud ledger readback verified. Result forms now bind the exact target independently of Reach forms. General runner For You policy/selectors, remaining providers and a live n8n end-to-end publishing run remain pending. |

SOC-015 follow-up: the distinct `random_for_you_top10` policy is implemented.
All 44 local tests, including nine Playwright UI fixtures, and strict TypeScript
pass. Provider selector calibration and a live n8n end-to-end run remain pending.
No new milestone is allocated; the next candidate remains SOC-016.

During implementation, maintain a capability matrix per account: transport,
source/device checks, fixture validation, real-pilot evidence, and enablement
state. A platform's unsupported automation does not block working supported or
assisted destinations, but the report must not call the whole product fully
automated. Explicitly blocked accounts do not quietly disappear from reports.

## 12. Validation plan

SOC-001 validation is documentation-only. Later phases test meaningful invariants:
duplicate manual start, concurrent run, wrong account, content changed after
approval, unsafe media origin/path, login expiry, unsupported photo/music flow,
manual-step timeout, approval expiry, pre-submit crash, post-submit response loss,
review pending, failed portfolio sync, repeated reconciliation, stop during submit,
unknown-outcome restart, and separate Personal/Business histories.

Use synthetic fixtures for node contracts, media, provider responses, source
forms, journals, and reports. Integration-test n8n -> worker and child workflow
input/return contracts. Re-import sanitized workflow exports in the pinned version.
Test manual failure reporting directly because Error Trigger is not sufficient.
Verify local secrets/access and report redaction. A real social pilot requires
separate owner authorization at that time; never publish test posts just to make
an implementation test pass. Record exact command/UI/API receipts and limitations.

The OmniRoids lifecycle query returned research, planning, pre-implementation
audit, implementation, tests, post-implementation audit, post-mortem,
documentation, technology review, and publish stages. Apply these as a work
discipline. Its Core skill-bundle publication receipts are not GitHub document PR
requirements and are not evidence that this new product has been implemented.

## 13. Git and review procedure

Use the local skills under `.codex/skills/`:

1. Preflight: read rules/plan/status/diffs and fetch refs if authorized; audit SOC
   IDs and confirm the next allocation against Git and roadmap reservations.
2. Use `codex/SOC-###-short-description`; keep one milestone's scope reviewable.
3. Validate the actual change; stage explicit files and inspect the staged diff.
4. Commit with `[SOC-###]type(scope): imperative description`, at most 100 chars.
5. On explicit push + PR requests, push the feature branch and write ignored
   `tmp/mr-description.md` with problem, outcome, validation, security, follow-ups.
6. Open/update one draft PR, attach it to the Codex chat, and return factual URLs.
7. If separately authorized, mark ready and squash merge; verify resulting main
   commit and update milestone evidence. No force push, bypassed hooks, or
   automatic branch deletion.

SOC-001 bootstrap exception: main needs one initial commit because an empty GitHub
repository has no PR base. Publish the minimal initial main, then push the
SOC-001 feature branch containing this plan and conventions and open its draft
PR. Both commits belong to SOC-001; subsequent tasks use ordinary feature PRs.
No GitHub Actions or deployment is configured in this documentation milestone.

## 14. Deferred V2

Potential direction only: collect owner-approved LinkedIn observations, draft and
review meaningful replies/comments, extend reviewed engagement to Threads and
Instagram, retain source URLs/context/receipts, and synthesize an original daily
or weekly blog digest as a separate draft. Cadence, storage, consent, platform
permissions, editorial source handling, and human approval need a new plan.
V1 publication approval does not authorize V2 collection or engagement. Do not
import old social logs or activate paused jobs as part of this repository setup.

## 15. Primary-source register

Checked for planning on 2026-10-03. Recheck platform policy, eligibility, and pinned
node behavior before implementation. These sources establish capabilities or
restrictions; they do not establish access for the owner's apps/accounts.

- [n8n Manual Trigger](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.manualworkflowtrigger/): manually executed entry point.
- [n8n Loop Over Items](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.splitinbatches/): batch size, loop/done outputs, termination conditions.
- [n8n Execute Sub-workflow](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.executeworkflow/): child input contracts and completion waits.
- [n8n HTTP Request](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/): worker/API transport.
- [n8n Wait](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.wait/): persistence and authenticated resume modes.
- [n8n Error Trigger](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.errortrigger/): manual-execution limitation.
- [n8n encryption key](https://docs.n8n.io/hosting/configuration/configuration-examples/encryption-key/): credential encryption configuration.
- [Playwright BrowserType](https://playwright.dev/docs/api/class-browsertype): persistent sessions and restriction on automating default Chrome profiles.
- [TikTok Content Sharing Guidelines](https://developers.tiktok.com/docs/en/content-sharing-guidelines): Direct Post eligibility, private unaudited restrictions, creator controls.
- [TikTok upload guide](https://developers.tiktok.com/docs/en/content-posting-api-get-started-upload-content): approved upload scope, draft completion by the user, photo support.
- [TikTok Commercial Music Library](https://ads.tiktok.com/resources/help/article/how-to-use-the-commercial-music-library?lang=en): Personal/Business library differences and region/placement selection.
- [X automation rules](https://help.x.com/en/rules-and-policies/x-automation): no non-API website scripting, consent and duplication constraints.
- [Reddit Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy): explicit API-access approval and commercial-use approval.
- [Pinterest Developers](https://developers.pinterest.com/): API/access documentation entry point; exact account eligibility and Pin field contract remain to be verified in SOC-002.
