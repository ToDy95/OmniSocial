# SOC-002: V1 source and transport feasibility

Evidence date: 2026-10-03, Europe/Bucharest. This report establishes a safe local
implementation path. It does not enable publication or claim live API access.

## Allocation and delivery

Fetched origin and audited every available ref and commit subject. Highest
allocated ticket was SOC-001; SOC-002 had no branch or commit collision and is
reserved for this report. Clean OmniSocial checkout started at
`9d7a0284d86ba67ddb5549b505c506e3b3341b8a`.
The branch is `codex/SOC-002-v1-feasibility`, based on the published SOC-001
branch. Its draft PR targets `codex/SOC-001-v1-implementation-plan` because
[PR #1](https://github.com/ToDy95/OmniSocial/pull/1) is still pending.
No merge was performed. SOC-003 is the next allocation candidate, subject to
a fresh audit. Other roadmap IDs remain proposals.

## Source contract observed locally

Inspected portfolio HEAD `e75e29fea29e5ffeabcab886fe8d623e1b00e3c3` without editing
that repository. Its unrelated untracked `.codex/environments/` was preserved.
Evidence is repository code, not a deployed database inspection or authenticated
account observation.

| Source file | Finding |
| --- | --- |
| `app/admin/mobile/page.tsx` | Reads published posts with `published_at <= now`, variants, one owner/target state, and eight latest events. Renders one pending or next article, not the full eligible list. |
| `lib/mobile-publishing.ts` | Filters approved nonempty copy; X uses `social_compact`, other targets use `social`. TikTok/Pinterest require cover; X/Reddit do not. Orders by publication date then slug. |
| `lib/archive-export.ts` | Non-X captions remove trailing export extras, add target hashtags and site line. Hash the final rendered caption, not only the saved variant. |
| `app/admin/posts/archive/page.tsx` | Read-only historical exports are available, newest first, with variant status. This surface does not provide per-target processed history or a complete paginated snapshot guarantee. |
| `lib/auth.ts` | `requireAdmin` checks an authenticated active admin; it does not enforce a separate owner-only role. A worker must additionally bind the expected owner identity. |
| `app/admin/actions.ts` | Prepare/result actions reload eligibility and call the ledger RPCs. They are internal Next.js server actions, not a supported external adapter API. |
| `20260907120000_mobile_social_publishing_ledger.sql` | State unique by owner/target; events reference that same owner/target state. RLS and authenticated admin RPC checks exist. Event deduplication is by state/idempotency key. |
| `20260917120000_expand_mobile_social_targets.sql` | Expands both ledger tables and RPC checks to all six targets; latest RPC definitions inspected. |

The inspected mobile path does not use `integration_deliveries`. That table serves
other provider delivery paths. No foreign key or synchronization between it and
the mobile ledger was found in these definitions. An automatic adapter must not
assume either ledger includes all historic publications from the other route.
Reconcile prior manual/API publications during setup before approving candidates.

Prepare locks the state row, rejects an already processed slug, then replaces
`pending_post`. It does not reserve an immutable payload or refuse replacement of
another pending slug. Recording any of `posted`, `submitted_pending_review`, or
`skipped` appends the slug to `processed_slugs`, replaces `last_post`, and clears
`pending_post`. Duplicate event keys return the existing event without comparing
the replacement payload. The UI builds keys as
`mobile:<target>:<slug>:<result>`; different results have different keys.

Posted URLs are optional; provided URLs are checked only for HTTP(S). There is
no platform account ID, content/media digest, public visibility verification,
submission certainty, or receipt enforcement in this existing write contract.
The result action requires a subreddit for non-skipped Reddit results; board,
sound and privacy are optional metadata. Local receipt checks must be stronger.
Never infer public publication from a cloud `posted` flag alone.

## Discovery and synchronization decision

Start local development with synthetic snapshots. A first assisted live plan may
contain only the currently visible article after authenticated source readback,
confirmed owner identity and history reconciliation. Do not click Prepare to
enumerate candidates. A missing ledger or pending article is a gate to inspect,
not permission to initialize state during a dry run.

Bulk discovery needs a supported owner-protected portfolio contract. Proposed
follow-up, not implemented or ticket-reserved here: cursor pagination over exact
published articles, approved final copy, media references, revision tokens,
owner/target processed state and relevant events, with an explicit complete
snapshot boundary. Do not assume current unpaginated Supabase queries return all
rows. The archive alone cannot prove safe eligibility across accounts.

Before automatic preparation/writeback, a separate portfolio ticket/PR should
provide authenticated fixed operations with owner binding, expected source
revision, pending-slug checks, payload-bound idempotency, receipt-backed result
validation and exact event readback. Existing RPC deduplication alone cannot
prove sync correctness. Preserve the established portfolio ledger as progress
truth; keep attempts and pending synchronization in the local journal.
No portfolio ticket was invented and no portfolio changes were made.

## Per-account transport decision

All handles below are source configuration candidates. None was authenticated
live during this audit. No credentials, account applications or test posts were
created. `Assisted` is the selected design path, conditional on owner identity
and item validation; it is not an enabled adapter.

| Order / target | Candidate | Decision | Open gate |
| --- | --- | --- | --- |
| 1 `tiktok_personal` | `@todicarazvan95` | Assisted native owner handoff; private-utility Direct Post blocked by intended-use guidance | Device, photo/title/caption/music controls, visibility, content disclosure, identity and receipt |
| 2 `tiktok_codeonroids` | `@code.on.roids` | Assisted native owner handoff; private-utility Direct Post blocked | Separate identity, actual account type, commercially eligible sound and disclosures; same device/media gates |
| 3 `reddit` | `u/Inner_Student_5236` | Assisted owner submission; API disabled pending explicit accepted access | Owner-selected subreddit rules, post type/flair, identity and moderation/public receipt |
| 4 `x` | `@RazvanTodica` | Assisted owner composer; website scripting blocked; official API disabled pending access | Actual identity, compact copy/media limits, API entitlement/cost if later selected, matching status URL |
| 5 `pinterest_personal` | `@todyimmortal` | Assisted owner Pin builder; API disabled pending account/app eligibility | Account type, eligible app/OAuth, owned writable public board, field/media checks and receipt |
| 6 `pinterest_business` | `@codeonroids` | Assisted owner Pin builder; API disabled pending account/app eligibility | Independent app/account/board evidence, image/link/description and public Pin receipt |

TikTok's desktop upload URL in portfolio configuration is not evidence of photo
mode plus music. The actual device path remains unverified; owner input was
requested. Do not silently convert photos to videos. Any native device runner
requires separate scope. Business audio must use CML or documented applicable
rights; no random trending track selection is implemented.

## Official sources checked

- [TikTok sharing guidelines](https://developers.tiktok.com/docs/en/content-sharing-guidelines): private account-management utilities fail Direct Post intended-use criteria; unaudited posting has private restrictions. Photo API capability does not establish this project's eligibility.
- [TikTok commercial music](https://ads.tiktok.com/resources/help/article/commercial-music-library): general music library is unavailable for business commercial use; use eligible commercial audio.
- [X automation rules](https://help.x.com/en/rules-and-policies/x-automation): non-API website scripting is prohibited. Owner-operated composer remains the fallback.
- [Reddit Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy): explicit API approval is required, with additional commercial-use requirements; no application or duplicate request submitted.
- [Pinterest official OpenAPI](https://github.com/pinterest/api-description/blob/main/v5/openapi.yaml): `POST /pins` creates original owner content on an owned board/section; schema includes media source and board; documented OAuth scopes include boards and pins access. This proves a provider operation exists, not owner entitlement. The rendered developer endpoint did not expose its full contract, so the official schema was inspected instead.

## Validation and remaining acceptance

Read the source and latest relevant migrations; rechecked official policy pages;
audited refs, authenticated GitHub identity and stacked base. Documentation
validation covers local links, unique milestone rows, staged diff review and
whitespace. No browser, database, device, API submission or production test ran.

SOC-002 feasibility findings are documented. Its full acceptance remains open
until actual source/account/device observations are recorded in private local
evidence. This does not block SOC-003's fixture-only local skeleton. Real
discovery, source writes and publication remain gated by the findings above.
