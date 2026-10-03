# SOC-015: Manual n8n and Playwright execution

## Scope and current evidence

The owner selected website UI publishing and explicitly removed the former
platform-policy/API eligibility gate. This implementation uses Playwright for
portfolio discovery, preparation and result recording, social composers and
public receipt pages. It uses no provider publishing API or hidden server action.
n8n talks only to the authenticated loopback worker; that local HTTP transport is
not a social publishing API.

The browser execution engine, durable jobs and two manual n8n workflows are
implemented. Portfolio and both TikTok dedicated-profile logins are confirmed.
Remaining provider controls, the portfolio TOD-127 release and an exactly approved
live pilot are still required. Do not
interpret passing synthetic tests or imported workflows as successful public
posting. The previous assisted adapters remain available independently.

## Operator flow

1. Start the local worker and n8n. Run `npm run setup:browser` once. This preserves
   existing protected configuration and never imports everyday Chrome sessions.
2. Use **SOC-015 · Start browser flow**, action `login`, target `portfolio` or the
   selected account. Sign in interactively in Google Chrome for Testing. Passwords
   and MFA codes stay outside n8n and repository files.
   TikTok's Google sign-in popup may navigate to the exact HTTPS
   `accounts.google.com` origin during this explicit manual login step. Other
   external origins remain blocked. Entering automated work ends that allowance;
   the worker never drives Google sign-in or selects the OAuth popup as a composer.
3. Calibrate provider controls from observed UI in protected
   `runtime/browser/config.json`. Configuration is local and cannot be supplied
   through a worker request. Configure the approved source media origin, selected
   accounts, destinations, visibility, disclosures and music policy. The setup
   template initially selects Business TikTok for calibration; it does not enable
   all accounts or approve any post.
4. Start action `plan`. Read the complete owner archive and current account queues
   through the UI. Respect exact processed slug sets, including noncontiguous
   histories. Read compact X copy from the corresponding owner distribution form.
   Plan never presses Prepare, Post or Posted/public. Download only selected media
   and verify original bytes, then freeze the complete manifest.
5. Review `runtime/reports/source-plan.json`, including exact copy, image hashes,
   account, destination, visibility, disclosures and music policy. Set action
   `publish`, mode `publish`, ownerConfirmed `true`, and the reviewed manifest ID
   and digest in n8n. Press Start. A different digest or configuration blocks the
   run. Approval lasts at most one hour and a restart invalidates it.
6. The worker processes the frozen oldest-first lot, one account and item at a
   time. A caught-up account has zero items and no social submission. For each
   item, confirm identity, match the current portfolio queue, prepare if needed,
   download/check the image, open the composer, upload and verify the preview,
   fill title/caption/link, select the exact board/subreddit and settings, then
   check identity again. Persist the selected sound and `submitting` before Post.
   Recheck stop, lease and expiry immediately before the click.
7. Require a new matching permalink, open it in an unauthenticated context and
   verify account, full copy/title, destination, image and selected sound. Save
   screenshot evidence and a durable receipt before recording Posted/public in
   the portfolio. Read back the exact saved target/slug/result/URL and sync marker.
8. After the last approved item, read progress once more. This read does not add
   newly discovered posts to the run. A complete report can show 45/45; a capped
   or changed source can legitimately show a remaining count for a future run.

The cap supports 1 to 200 items per account, so a frozen 45-item backlog fits one
manifest. Provider UI limitations still stop the affected run. No recurring
trigger or automatic start after restart is configured.

## Music

`random_trending_top10` selects uniformly from the first at most ten rows in the
observed Trending UI, then verifies the selected name. A missing desktop picker
stops with `trending_music_controls_unavailable`; it never silently omits audio or
turns the photo into a video. `none` also requires an observed empty-music state.
The selected sound is journaled and checked on the public receipt before sync.

## Private worker operations

All routes require the existing owner-only bearer credential, an exact loopback
Host and no browser Origin header. Requests have fixed schemas and an 8 KiB limit.
No arbitrary navigation URL, script, profile path, filesystem path or shell can
be provided by n8n. Reconciliation accepts only a validated receipt permalink for
an existing item in the frozen manifest.

| Route | Behavior |
| --- | --- |
| POST /v1/browser/login | Open the fixed portfolio/account sign-in page |
| POST /v1/browser/inspect | Read a selected account's fixed identity/composer page; local protected report only |
| POST /v1/browser/plan | Read UI and save a protected finite review package |
| POST /v1/browser/publish | Bind exact explicit approval and run the finite lot |
| GET /v1/browser/jobs/:id | Read the durable job result |
| POST /v1/browser/stop | Reject future submissions in the selected run |
| POST /v1/browser/reconcile | Verify an existing submission or repair sync only |
| POST /v1/browser/close | Release a run only when all attempts are safely resolved |

Job IDs are operation keys. Repeating one request returns its existing job;
changing its input fails. Interrupted jobs remain interrupted and are not resumed.
Stopping n8n does not itself stop the browser; use **SOC-015 · Stop browser flow**.
An already in-flight click can remain uncertain and requires reconciliation.

## Recovery and limitations

- A login/challenge, wrong account, selector ambiguity, changed payload, missing
  music/destination control or verification mismatch stops the lot.
- After an uncertain click, reconcile the existing item and permalink. No helper
  in reconciliation can call composer or submit.
- After a public receipt and failed portfolio writeback, retry synchronization
  only. Preserve the receipt, sound and screenshot across worker restarts.
- A known pre-submit failure can be closed manually after safe resolution, then
  included in a new reviewed manifest. Closing cannot erase an unknown attempt.
- Cookie-less receipt access can be blocked by a provider login wall or review
  delay. That is not evidence of public publication; the attempt stays unresolved.
- Image comparison combines a perceptual signature with color error checks.
  Provider cropping or major changes can require owner review instead of an
  automatic public claim.
- Provider selectors are deliberately not invented. Live calibration must observe
  identity, upload, composer settings, submission and receipt controls. A missing
  control returns `ui_calibration_required`.
- Reddit still needs an exact selected community and any required flair in the
  reviewed lot. No engagement/comment activity is implemented.
- Portfolio DOM readback depends on the separate TOD-127 change. Older production
  UI returns `portfolio_ui_contract_update_required` rather than guessed progress.

## Validation recorded

42 local Node tests passed, including seventeen new runner/HTTP/job/image/UI/workflow fixtures.
Strict TypeScript checking passed. Fixtures cover a complete sequential six-account
lot, dry-plan mutation absence, uncertain submit, sync-only retry, stop during
composer, configuration drift, operation replay, interrupted jobs and protected
HTTP schemas. Seven tests launch real Playwright against intercepted fixture HTML:
noncontiguous source progress, missing source contract, and upload/copy/first-ten
music selection with a final click guard, and visible preparation/receipt writeback
with idempotent readback, and Reddit destination/post-type checks immediately
before submission, and a manual Google popup returning to TikTok with the OAuth
allowance revoked before automated work, and fixed profile inspection excluding
credential field values and URL queries from its protected control inventory.
They make no external network requests.
Provider identities and receipts in all these tests are synthetic.

Both manual workflows were imported inactive into the local n8n instance. A
dedicated portfolio browser authenticated. Both TikTok profiles were independently
confirmed by their own Studio profile links, `@todicarazvan95` and `@code.on.roids`,
after a graceful worker restart. TikTok composer inspection and execution wait for
the observed Photos tab before reading controls. Inspection accepts only a fixed
selected target and identity/composer view, never arbitrary URLs or scripts.
The actual Photos tab, file input and Select photos button were observed on both
TikTok accounts. Post-upload fields and music controls still need calibration.
No provider file
upload, Post click, cloud Prepare or result write has been performed.

## Post-merge source verification

On 2026-10-03, OmniSocial PRs #14 and #15 were squash merged as `b4ae571`
and `7e40dd6`. Portfolio PR #133 was squash merged as `bbb37c0`; Vercel
reported its production deployment READY with the portfolio custom domains.
The live owner page exposes the TOD-127 progress attributes.

Read-only source discovery found Personal at 45/46 and Business at 35/46,
producing twelve exact review items without cloud preparation or publication.
A hidden confirmation dialog adds an unrelated h2 inside the prepared Business
card. Queue discovery now selects visible post headings; the intercepted source
fixture includes this hidden dialog regression. All 42 tests and strict TypeScript
passed. Post-upload composer and receipt calibration, exact pilot approval and
remaining account setup are still pending.
