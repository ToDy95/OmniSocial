# V1 assisted platform handoffs

SOC-006 implements TikTok Personal validation and a native owner handoff contract.
It does not operate a social website, upload content, submit through an API or
establish real device/account acceptance. Dry run returns validation only, with
no composer package or provider side effects. Publication authorization remains
the separate stored manifest approval and durable run guard.

Every handoff requires a matching fresh identity observation (five minutes), valid
login, matching payload/media digest and the permitted assisted transport.
MFA/CAPTCHA, expired login, changed media/text or unknown identity blocks the item.
TikTok Personal additionally requires iPhone/Android photo mode, verified PNG/JPEG,
reviewed visibility, exact music rights and explicit own-brand/paid/AI disclosures.
Title 90 / caption 4000 UTF-16 limits are conservative local validation based on
the official photo API contract; actual native controls still need pilot acceptance.
WebP and desktop photo flows remain blocked until confirmed, with no silent conversion.

Sources reviewed 2026-10-03: [TikTok photo contract](https://developers.tiktok.com/docs/en/content-posting-api-reference-photo-post),
[sharing guidelines](https://developers.tiktok.com/docs/en/content-sharing-guidelines).
Real native pilot, identity, device, sound, visibility and receipt acceptance remain
open. No real account was connected or real post submitted by these fixtures.

SOC-007 adds separate Business identity and account-type checks. Sound must be
none or an exact CML/licensed track plus rights reference, with commercial rights
verified. Own-brand, paid-partnership and AI disclosure choices bind the payload
digest, including when loaded through the source adapter. Personal identities and
histories cannot satisfy Business acceptance. No random trending music is chosen.
Source: [TikTok Commercial Music Library](https://ads.tiktok.com/resources/help/article/commercial-music-library).
Business native pilot and actual commercial sound/disclosure acceptance remain open.
