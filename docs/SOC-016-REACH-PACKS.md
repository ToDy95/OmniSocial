# SOC-016: Tips & Tricks Reach packs

SOC-016 extends the owner-started Playwright UI route to existing multi-image
Reach packs. It reads the visible owner workspace at `/admin/mobile`, binds one
account to one run, freezes the pack topic, caption, ordered media, delivery row,
destination and public visibility into the manifest, and downloads each image
before planning. A pack is not marked complete until a public permalink has been
verified and the matching Reach delivery row has been read back from the owner
workspace.

## Manual account workflows

`npm run export:reach-workflows` writes one n8n export per configured manual
account. `npm run import:reach` imports those workflows as inactive manual flows.
Each starts with a dry-run `plan` for `contentKind=reach`, is fixed to one
account, and reuses the existing local worker credential. A human must review
the exact manifest before changing the same flow to `publish`; the workflow does
not switch accounts, schedule itself, generate content, or publish from a
start-only click.

The six flows are:

- TikTok Personal
- TikTok Business
- X
- Reddit
- Pinterest Personal
- Pinterest Business

Glassdoor is not a configured manual destination in the portfolio or local
worker. It needs a separate account and destination contract before an
additional workflow can be defined.

## Pack discovery and progress

Reach discovery is single-target only and reads the latest 30 packs exposed by
the owner workspace. If the visible list is full, planning stops because the
UI does not prove that the archive is complete. Each target's delivery status
is read independently: `Published` counts as processed, `Manual handoff` is
eligible when the complete ordered pack and copy are present, and all other
states remain unresolved. The owner UI currently exposes category-specific
Reddit routing; `runtime/browser/config.json` must have a matching
`reachDestinationByCategory` entry before Reddit packs become eligible.

The worker checks the complete image set against the account composer preview
before submission. It rechecks the public post for matching copy, account,
destination and media. If the provider UI cannot accept or publicly show every
image, the run stops without submitting or updating the portfolio delivery.

## Current provider limits and gaps

This is a bounded first implementation, not evidence that all six live UIs have
been calibrated. It refuses a pack before submission when the one-post UI path
cannot preserve the full set:

| Account | Current pack path | Stops before submission when |
| --- | --- | --- |
| TikTok Personal | One photo post with the ordered image set | The composer preview or public receipt does not show every image |
| TikTok Business | One photo post with the ordered image set | The composer preview or public receipt does not show every image |
| Reddit | One gallery submission | Category/subreddit mapping is missing or the gallery UI does not accept all images |
| X | One post with up to four images | The pack has more than four images; a thread flow is not implemented |
| Pinterest Business | One carousel Pin with up to five images | The pack has more than five images or the UI does not support the carousel |
| Pinterest Personal | One standard Pin | Multi-Pin sequencing for a pack is not implemented |

The portfolio Reach delivery stores one permalink per account and exposes a
confirmation that all images were published. Multi-post strategies (X threads,
Pinterest Personal per-image Pins, or splitting a long Business carousel) need
an explicit grouped-receipt design before they can safely mark one pack as
complete. The current flow leaves those packs unresolved rather than silently
dropping images or confirming a partial set.

## Operating boundary

Keep the Personal and Business automation profiles separate and reuse the
existing profiles. Never launch a new browser for a run. If another browser
process already owns a profile, return `existing_profile_in_use` and use that
existing window; do not start a duplicate. Stop for login expiry, CAPTCHA, MFA,
account mismatch, unexpected UI or an uncertain publication outcome. Reconcile
an uncertain post before retrying it. Keep workflow exports inactive,
credentials out of Git, and local source/media/receipt data protected.

SOC-016 code and workflow exports do not constitute a live provider test,
publication receipt, owner ledger writeback, or complete multi-network posting
run. Record each of those independently when observed.

## Live check — 2026-10-12

The owner workspace showed “Architecture decisions worth documenting” with all
10 images and manual rows for TikTok Personal, TikTok Business, Pinterest
Personal, Pinterest Business, Reddit, and X. The dedicated TikTok Personal
profile displayed the expected `@todicarazvan95` identity. The separate
Playwright portfolio profile rendered the same pack, but its Network / account
control was an empty `<select>` and the workspace still exposed “Open X”. The
target-bound plan stopped before creating a manifest with
`reach_delivery_missing`; no carousel was submitted and no Reach delivery row
was changed. The six account-bound n8n workflows remain imported and inactive.
Resume publishing only after the Playwright portfolio profile exposes the
selected account's delivery row and ID.
