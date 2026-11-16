import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openJournal } from '../worker/journal.ts';
import { Operations } from '../worker/operations.ts';
import { fixtureSnapshot } from '../worker/fixture.ts';
import { plan } from '../worker/planner.ts';

const now = '2026-01-10T00:00:00.000Z';
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'omnisocial-operations-'));
  const db = openJournal(join(dir, 'journal.sqlite')), ops = new Operations(db);
  const source = fixtureSnapshot(); source.accounts.forEach(a => a.identityVerified = true);
  const manifest = plan(source, ['x'], 1, now), item: any = manifest.items[0];
  ops.saveManifest(manifest); ops.approve(manifest.manifestId, manifest.owner, manifest.digest, now);
  return { dir, db, ops, manifest, item, clean: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}
test('durable manifests, exclusive leases, idempotent starts and stopped/fenced submissions', () => {
  const s = setup();
  try {
    assert.deepEqual(s.ops.manifest(s.manifest.manifestId), s.manifest);
    const run = s.ops.openRun('fixture-run', s.manifest.manifestId, now);
    assert.deepEqual(s.ops.openRun(run.id, s.manifest.manifestId, now), run);
    assert.throws(() => s.ops.openRun('second', s.manifest.manifestId, now), /account_leased/);
    s.ops.prepare(run.id, s.item.itemId, run.fence, now);
    assert.throws(() => s.ops.submitting(run.id, s.item.itemId, run.fence + 1, now, s.item), /stale/);
    assert.throws(() => s.ops.submitting(run.id, s.item.itemId, run.fence, now, { ...s.item, accountId: 'wrong' }), /identity/);
    s.ops.stop(run.id);
    assert.throws(() => s.ops.submitting(run.id, s.item.itemId, run.fence, now, s.item), /stale/);
    assert.throws(() => s.ops.release(run.id), /unresolved/);
    s.ops.failBeforeSubmit(run.id, s.item.itemId); s.ops.release(run.id);
  } finally { s.clean(); }
});
test('unknown submission survives restart, approval is invalidated and no retry can publish', () => {
  const s = setup();
  try {
    const run = s.ops.openRun('fixture-run', s.manifest.manifestId, now);
    s.ops.prepare(run.id, s.item.itemId, run.fence, now);
    s.ops.submitting(run.id, s.item.itemId, run.fence, now, s.item);
    assert.throws(() => s.ops.submitting(run.id, s.item.itemId, run.fence, now, s.item), /retry_forbidden/);
    const restarted = new Operations(s.db);
    assert.equal(restarted.attempt(run.id, s.item.itemId).state, 'submission_unknown');
    assert.throws(() => restarted.openRun('new-run', s.manifest.manifestId, now), /fresh_approval/);
    restarted.approve(s.manifest.manifestId, s.manifest.owner, s.manifest.digest, now);
    assert.throws(() => restarted.openRun('new-run', s.manifest.manifestId, now), /prior_attempt/);
    assert.throws(() => restarted.release(run.id), /unresolved/);
  } finally { s.clean(); }
});
test('expiry blocks starts and prepared submissions without recording a submission', () => {
  const s = setup();
  try {
    assert.throws(() => s.ops.openRun('late', s.manifest.manifestId, '2026-01-10T02:00:00.000Z'), /approval/);
    const run = s.ops.openRun('fixture-run', s.manifest.manifestId, now);
    s.ops.prepare(run.id, s.item.itemId, run.fence, now);
    assert.throws(() => s.ops.submitting(run.id, s.item.itemId, run.fence, '2026-01-10T02:00:00.000Z', s.item), /approval/);
    assert.equal(s.ops.attempt(run.id, s.item.itemId).state, 'ready_to_submit');
  } finally { s.clean(); }
});
test('a stale worker cannot allocate a new run, fence or account lease after another boot', () => {
  const s = setup();
  try {
    const current = new Operations(s.db);
    const fence = s.db.prepare("SELECT value FROM runtime_metadata WHERE key='fence'").get()!.value;
    assert.throws(() => s.ops.openRun('stale-run', s.manifest.manifestId, now), /worker_restarted/);
    assert.equal(s.db.prepare('SELECT count(*) AS n FROM runs').get()!.n, 0);
    assert.equal(s.db.prepare('SELECT count(*) AS n FROM leases').get()!.n, 0);
    assert.equal(s.db.prepare("SELECT value FROM runtime_metadata WHERE key='fence'").get()!.value, fence);
    current.approve(s.manifest.manifestId, s.manifest.owner, s.manifest.digest, now);
    const run = current.openRun('current-run', s.manifest.manifestId, now);
    assert.equal(run.epoch, current.epoch);
    assert.equal(s.db.prepare('SELECT count(*) AS n FROM leases').get()!.n, 1);
    // Idempotent lookup is a read, not permission for this stale instance to submit.
    assert.deepEqual(s.ops.openRun(run.id, s.manifest.manifestId, now), run);
    assert.throws(() => s.ops.prepare(run.id, s.item.itemId, run.fence, now), /stale/);
  } finally { s.clean(); }
});
test('new-run epoch fencing preserves existing uncertainty, leases and recovery reads', () => {
  const s = setup();
  try {
    const run = s.ops.openRun('existing-run', s.manifest.manifestId, now);
    s.ops.prepare(run.id, s.item.itemId, run.fence, now);
    s.ops.submitting(run.id, s.item.itemId, run.fence, now, s.item);
    const current = new Operations(s.db);
    const stopped = s.ops.openRun(run.id, s.manifest.manifestId, now);
    assert.equal(stopped.state, 'restart_requires_reconciliation');
    assert.equal(current.attempt(run.id, s.item.itemId).state, 'submission_unknown');
    assert.throws(() => s.ops.openRun('stale-new-run', s.manifest.manifestId, now), /worker_restarted/);
    current.approve(s.manifest.manifestId, s.manifest.owner, s.manifest.digest, now);
    assert.throws(() => current.openRun('fresh-new-run', s.manifest.manifestId, now), /prior_attempt_requires_reconciliation/);
    assert.throws(() => current.release(run.id), /unresolved_attempts/);
    assert.equal(s.db.prepare('SELECT count(*) AS n FROM leases WHERE run_id=?').get(run.id)!.n, 1);
  } finally { s.clean(); }
});
test('new-run fencing reads the durable epoch across separate synthetic journal connections', () => {
  const s = setup(), other = openJournal(join(s.dir, 'journal.sqlite'));
  try {
    const current = new Operations(other);
    assert.throws(() => s.ops.openRun('stale-connection', s.manifest.manifestId, now), /worker_restarted/);
    assert.equal(other.prepare('SELECT count(*) AS n FROM leases').get()!.n, 0);
    current.approve(s.manifest.manifestId, s.manifest.owner, s.manifest.digest, now);
    const run = current.openRun('current-connection', s.manifest.manifestId, now);
    assert.equal(s.ops.report(run.id).run.epoch, current.epoch);
  } finally { other.close(); s.clean(); }
});
test('receipt precedes sync, failed/readback-lost sync cannot submit, repeated receipts reconcile only', () => {
  const s = setup();
  try {
    const run = s.ops.openRun('fixture-run', s.manifest.manifestId, now);
    s.ops.prepare(run.id, s.item.itemId, run.fence, now);
    s.ops.submitting(run.id, s.item.itemId, run.fence, now, s.item);
    const receipt = { itemId: s.item.itemId, accountId: s.item.accountId, payloadDigest: s.item.payloadDigest,
      url: 'https://x.com/fixture/status/123', public: true, evidenceDigest: 'a'.repeat(64) };
    assert.throws(() => s.ops.receipt(run.id, s.item.itemId, { ...receipt, accountId: 'wrong' }), /mismatch/);
    const saved = s.ops.receipt(run.id, s.item.itemId, receipt);
    assert.equal(saved.state, 'public_verified_sync_pending');
    assert.deepEqual(s.ops.receipt(run.id, s.item.itemId, receipt), saved);
    assert.throws(() => s.ops.synced(run.id, s.item.itemId, { syncKey: saved.sync_key!, externalUrl: 'wrong', result: 'posted' }), /mismatch/);
    assert.throws(() => s.ops.submitting(run.id, s.item.itemId, run.fence, now, s.item), /retry_forbidden/);
    s.ops.synced(run.id, s.item.itemId, { syncKey: saved.sync_key!, externalUrl: receipt.url, result: 'posted' });
    s.ops.release(run.id);
    assert.equal(s.ops.attempt(run.id, s.item.itemId).state, 'completed');
    assert.throws(() => s.ops.openRun('new-run', s.manifest.manifestId, now), /prior_attempt/);
  } finally { s.clean(); }
});

test('journal reopen retains submitting uncertainty and stop cannot erase an in-flight marker', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omnisocial-reopen-')), path = join(dir, 'journal.sqlite');
  let db = openJournal(path);
  try {
    let ops = new Operations(db);
    const source = fixtureSnapshot(); source.accounts.forEach(a => a.identityVerified = true);
    const manifest = plan(source, ['x'], 1, now), item: any = manifest.items[0];
    ops.saveManifest(manifest); ops.approve(manifest.manifestId, manifest.owner, manifest.digest, now);
    const run = ops.openRun('fixture-run', manifest.manifestId, now);
    ops.prepare(run.id, item.itemId, run.fence, now); ops.submitting(run.id, item.itemId, run.fence, now, item);
    db.close(); db = openJournal(path); ops = new Operations(db);
    assert.equal(ops.attempt(run.id, item.itemId).state, 'submission_unknown');
    ops.stop(run.id);
    assert.equal(ops.attempt(run.id, item.itemId).state, 'submission_unknown');
    assert.throws(() => ops.release(run.id), /unresolved/);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
