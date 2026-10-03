# Desktop photo handoff and account progress

SOC-014, 2026-10-03. Owner requested laptop execution, completion of each
account's bounded backlog before switching, and separate account progress.

## Observations and owner destinations

TikTok Studio displayed the Business identity and a Photos upload tab on the
owner's laptop. Its visible form accepted JPG/JPEG/PNG/WebP, up to 35 photos,
50 MB each. No media was uploaded and no post was submitted. Title, music,
visibility and disclosure controls after upload remain unverified.

Desktop support is now a fresh, per-account capability gate in the assisted
adapter. Personal must be observed independently. The owner still reviews and
submits the exact approved package in the composer. This observation does not
establish permission to automate TikTok website submission.

Owner-selected Pinterest board locators:

- Business: https://ro.pinterest.com/codeonroids/codeonroids/
- Personal: https://ro.pinterest.com/todyimmortal/codeonroids/

These are public board URLs, not verified API board IDs. Writable/public state
and active account identity require separate checks before submission.

Owner screenshots show Personal 45/45 processed and Business 35/45 processed:
Business has 10 remaining. These are portfolio ledger counts, not independent
provider receipt counts. A prepared article is included in the remaining count.
New source snapshots can change the denominator; each approved run keeps its
own immutable manifest and never silently adds new posts.

## Preparation and uncertain submissions

Portfolio `prepareMobilePublishingPost` records a source checkpoint; it does
not submit to a social provider. `pendingSlug` alone therefore does not prove
an uncertain provider submission. The existing planner conservatively excludes
that checkpoint until a scoped reconciliation is implemented. This milestone
does not clear it, erase history or override an uncertain local journal attempt.

The local source report now includes independent per-account processed, total,
remaining and prepared slug values, tied to the source timestamp and revision.
Duplicate and absent slugs cannot inflate progress. Public receipt count is
unknown rather than inferred from processed work, which can include skips.

## Remaining work

The owner's Reddit destination research request is explicit, bounded to blog
categories and community posting rules. No category is an automatic permission
to promote every article. Candidate destinations still need primary rule checks
and article-specific relevance review; comment-only promotion threads do not
authorize V1 comments. No Reddit community has been approved in this milestone.

Primary-source research observations (2026-10-03):

- Frontend: a [recent webdev moderator removal](https://www.reddit.com/r/webdev/comments/1wtapya/removed_by_moderator/)
  limits project/portfolio promotion to Showoff Saturday. This is a timing
  restriction, not acceptance of every blog article.
- Infrastructure: [devops weekly self-promotion thread](https://www.reddit.com/r/devops/comments/1ws736h/weekly_self_promotion_thread/)
  is a candidate promotional channel requiring comment participation, outside
  the current V1 new-post flow.
- Weekend adventures: [hiking moderator announcement](https://www.reddit.com/r/hiking/comments/1rt621q/when_is_a_hike_a_hike_and_other_rule_based/)
  requires context from an actual hike and describes anti-spam/AI controls.
  Generated cover images alone do not establish personal hiking experience.
- Backend, AI/business, developer life and weekend reset: no destination rule
  acceptance established yet. Research remains open; no fallback is auto-approved.

Validation: 25 local tests passed, strict type checking passed, and whitespace
checks passed. These validate the local gate/report logic, not provider posting.

Real guarded orchestration, prepared-checkpoint reconciliation, portfolio receipt
writeback and the exact first publishing manifest remain incomplete. No live
publishing, cloud preparation or cloud result update was performed.
