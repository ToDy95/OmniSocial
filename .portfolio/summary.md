# OmniSocial

## What it is

OmniSocial is a private publishing operations toolkit for an owner or small content team that already has approved articles and needs a controlled way to distribute them across social accounts.

## The problem and business value

Posting the same source to several destinations creates more than a formatting task. Each account needs the correct media, caption and delivery record. Interrupted runs also create uncertainty about what was actually published.

OmniSocial organizes that work around explicit approvals, separate account sessions and a recoverable journal. Its value is a reviewable distribution process: an operator can see what is ready, what needs attention and what must be reconciled before retrying.

## What it does today

- Reads eligible portfolio content and builds account-specific publishing manifests.
- Includes browser publishing adapters for TikTok, X, Reddit and Pinterest.
- Separates accounts, validates media and binds approval to the selected payload.
- Tracks attempts, leases, receipts and pending source synchronization.
- Supplies n8n workflow entry points and deterministic fixture runs.
- Provides reconciliation paths for interrupted or uncertain submissions.

These are implemented capabilities, not a promise that every account is logged in or every provider is currently available. There is no public self-service app.

## Integrations and data flow

Portfolio source content becomes a bounded manifest. An approved worker run prepares the destination payload, uses the configured account session and records evidence. Results can be written back to the portfolio ledger. A provider receipt and matching public destination must be checked before recording publication.

## AI or automation workflow

The publishing worker handles distribution rather than promising AI content generation. Scheduling or an owner-started run does not remove account, payload or verification requirements.

## Lead, email and collaboration flow

The current offer is content distribution and operational visibility. Lead outreach, DMs, comments and email campaigns are outside this publishing workflow.

## Security and privacy boundaries

Browser sessions, credentials, journal records and media stay private. The worker is intended for local or protected operation with authenticated, fixed commands. Authentication challenges and uncertain outcomes require operator attention.

## What is coming next

Operational priorities include account readiness, provider-specific verification and reliable recovery. Wider social research or engagement is a separate scope. A commercial implementation would need agreed channels, account access, hosting and acceptance criteria.

## Current activity and next step

Reviewed against the default-branch implementation on 15 November 2026. Browser adapters, journal recovery and manual reach workflows are present; account-by-account live publication was not tested for this brief.

[Discuss a controlled publishing workflow](https://www.razvantodica.com/#contact). Start with one approved source, one account and a verified receipt before expanding.
