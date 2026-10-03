# SOC-011 finite batch fixtures

Implemented locally on 2026-10-03. This is synthetic integration evidence, not
live publication acceptance. See [the plan](IMPLEMENTATION_PLAN.md) and
[durable operations](SOC-005-OPERATIONS.md).

## Contracts

Seven inactive exports provide a manual parent, a serial account child, a serial
post child, and four platform children. TikTok and Pinterest keep their two
account identities distinct. Both loops use batch size one and await child
completion. The worker accepts only the exact fixed synthetic item ID and target;
extra fields, changed targets, malformed JSON and oversized requests fail closed.
No endpoint accepts real content or a publishing mode. The library dispatcher
also verifies the frozen manifest and caps, stops after identity/login failures,
and produces bounded JSON/CSV reports. CSV fields escape formula prefixes.

These exports use passthrough child input with worker validation. They are fixture
contracts, not a production publisher or a real approval-resume interface.

## Rehearsal

With the local n8n editor stopped, run `npm run execute:fixture` using Node 24.
The script checks that all seven imports match their committed nodes, connections
and settings and are unpublished. n8n 2.41.6 CLI execution requires published
child versions. Its CLI publish command updates the legacy active version but
does not populate the new publication-service record. The rehearsal therefore
uses the installed `N8N_USE_WORKFLOW_PUBLICATION_SERVICE=false` compatibility
setting only for its CLI processes, temporarily publishes the six fixed children,
and unpublishes them in `finally`. The ordinary editor keeps its default setting.
There are no schedules, webhooks or platform submission triggers in these children.
An interrupted process can leave a child published: inspect the six IDs and use
the scoped n8n unpublish command before another rehearsal. Never use `--all`.

The execution script checks the final report, rather than accepting exit code
zero as sufficient evidence. Logs remain ignored and owner-only under runtime.

## Observed evidence

- Node fixture suite: 22 tests passed, including serial dispatch, edited manifests,
  login stop, media validation, replay/restart, receipt-before-sync and HTTP bounds.
- All seven exports imported in n8n 2.41.6; pre-execution readback matched.
- Full CLI execution reached `Finite fixture report`, `batch_fixture_completed`,
  12 validated, zero submitted and zero verified public. All six children were
  unpublished after execution.
- Earlier CLI attempts failed on unpublished child execution; the compatibility
  setting above resolved the observed issue. Python task-runner environment is
  unavailable; these workflows do not use Python or Code nodes.

Real source login, platform identity/device/board/subreddit checks, an approved
small mixed pilot, real receipt verification and portfolio writeback are still
open. No real source export, provider API, native submission, cloud Prepare/result,
merge or deployment was exercised by this milestone.

SOC-012 follow-up: the editor also requires published child versions. The six
fixed synthetic children were published through the owner UI under the normal
publication service for manual editor use. The parent stays unpublished/manual.
Manual editor execution returned `batch_fixture_completed`, 12 validated and
zero submitted/public after this setup. Unpublish those children in the UI before the isolated CLI procedure above, which
deliberately refuses already-published workflows. See [readiness](V1-READINESS.md).
