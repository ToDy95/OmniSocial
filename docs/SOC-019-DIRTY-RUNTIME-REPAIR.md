# SOC-019 bounded dirty runtime repair

The owner's uncommitted Reach runtime produced 49 passes and 11 failures in its
60-test fixture suite. Merged main does not contain that runtime's photo-editor,
resumed-draft, diagnostics and receipt-recovery contracts. This release delivers
an exact source patch for that existing dirty state, rather than merging the
pending Reach feature or changing main's publishing implementation.

## Repair and boundary

[The patch](../patches/SOC-019/dirty-runtime.patch) targets four source files.
[The manifest](../patches/SOC-019/manifest.json) locks every input and output by
SHA-256 and locks the patch itself. It preserves all unrelated dirty files,
including the owner's deleted AGENTS.md, workflows, configuration and local data.

Three actual photo-composer defects are corrected:

- An already open exact-origin photo editor is retained instead of navigating
  away, including when its uploader is temporarily hidden by a draft prompt.
- Hidden empty media placeholders do not count as existing uploaded photos.
- Continuing an empty draft still uploads the approved media; visible existing
  photos must match the complete approved media set before reuse.

The fixtures now model Upload navigation, document-title hydration, visible active
archive panels and the Page.isClosed method. Reconcile assertions include the
actual structured diagnostics. Saved-receipt recovery across local synchronization
keys requires the exact article, account target, posted result and URL; the test
still rejects a different public URL and proves no duplicate POST occurs.
Composer regressions also prove that a foreign-origin photo editor is never
reused and visible wrong media stops without another upload or submit click.

No test is removed, skipped or renamed. The fix does not enable a worker, browser
profile, scheduler, publication, source writeback or new account mapping.

## Apply and verify

Use pinned Node 24.21.0 from the reviewed release checkout:

```text
node scripts/apply-dirty-runtime-repair.ts /absolute/path/to/owner-checkout
node scripts/apply-dirty-runtime-repair.ts /absolute/path/to/owner-checkout --apply
```

The first command checks only. Both refuse mismatched input hashes, mixed partial
states, symbolic-link targets or a changed artifact. The installer derives all
patched outputs in temporary staging and validates their manifest hashes before
any target write, then checks the target input hashes again. An already installed exact
output returns `already_installed` without mutation. Back up the four source
files before applying; neither command touches runtime journals or credentials.

Validation uses the existing synthetic Playwright fixtures with intercepted
network responses. The isolated owner snapshot retains every original 60 tests;
the merged main's six SOC-018 media-cache tests add six independent checks. The
combined snapshot passed 66/66 before release. Exact owner installation and clean
main validation are recorded separately in the final release receipt.
Four installer tests cover no-write checks, successful installation and replay,
corrupt output hashes rejected before mutation, partial/base drift, symbolic
links and tampered patch bytes.

This is a patch-artifact repository release and a bounded local source repair.
It is not a merge of Reach, a hosted deployment or a public social receipt. The
canonical worker remains inactive after verification.
