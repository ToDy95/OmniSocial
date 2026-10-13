# SOC-018 - Immutable public media reuse

The owner authorized immediate implementation and repository release on 2026-10-13.
SOC-016 Reach work and the SOC-017 schedule reservation exist in the original dirty
checkout; their work is preserved and neither is activated by this change.

## Workload and policy

OmniSocial reads the Portfolio UI/source export and downloads approved media from
allowlisted origins. It does not directly query Supabase tables. Source planning
already deduplicates identical URLs inside a plan. Repeated calls to the media loader
previously downloaded the same bytes again, even when a protected local copy existed.

Only query-free public `blog-media-public` Storage paths whose filename contains the
actual SHA-256 are eligible for cache-first reuse. The current Portfolio uploader uses
`posts/<id>/<sha256>.webp`; older timestamp-prefixed names are also supported. The
loader checks origin allowlists before reuse, scopes each cache by origin, object path
and caller directory, and validates ownership, permissions, file type, size, decoded
pixels, format and content hash on every hit. Concurrent eligible calls share one
in-flight download, and failures are removed so a later authorized call can recover.

Signed/private Reach URLs, mutable filenames, query variants and fragments always
perform a fresh network request. No manifest approval, account identity, lease,
submission outcome or receipt is cached. Current source/identity checks and exact
owner publication approvals are unchanged. Media bytes, original references and
stored objects are not modified or deleted.

The original dirty local checkout had a fallback that accepted hash filenames from
any path after a failed response, including signed/private URLs. The bounded local
deployment must replace that fallback with the stricter public-only policy. Other
Reach discovery, multi-image, workflow, publication and reconciliation changes remain
untouched. Existing cached files remain on disk; older unscoped copies are not trusted
for cross-origin reuse. Cache-first does not substitute for fresh source approval.

## Evidence and release

Pinned Node 24.21.0 passed strict TypeScript and all 50 tests, including Playwright
fixtures. Media tests cover concurrent one-fetch operation, warm zero-fetch reuse,
origin/path/directory isolation, private/signed/query fetches, revoked private URLs,
unsafe files, hash mismatches, decoded corruption and error recovery. An isolated
authenticated health worker on port 3204 returned 200 with dry-run mode, publishing
disabled, source disconnected and browser operations disabled.

A read-only measurement of one current production public blog image returned
198,812 bytes for the cold request, then zero network requests/bytes for a validated
warm call in the same directory. This is one original image, not an account-wide
Supabase billing reduction. Cache reuse across different caller directories is not
claimed. The directory hierarchy retains the existing owner-controlled cleanup policy.

This project has no hosted deployment provider or cloud preview configuration.
Its production surface is the owner's local worker, not Vercel. Port 8787 had no
listener during preflight. A repository merge and a surgical local file deployment
are recorded separately from a running worker. No existing owner worker is stopped,
no journal is replaced, and no workflow/scheduler/publishing operation is enabled.
Detailed receipts are in local `tmp/SOCIAL-SUPABASE-RELEASE.md`.

Rollback uses an application revert and the protected pre-change local media-module
backup. It requires no Supabase migration, object deletion or lease manipulation.

## References

- [Supabase egress](https://supabase.com/docs/guides/platform/manage-your-usage/egress)
- [Supabase Storage access](https://supabase.com/docs/guides/storage/serving/downloads)
- Portfolio `lib/blog-media.ts` and `lib/reach-media.ts`, inspected read-only.
