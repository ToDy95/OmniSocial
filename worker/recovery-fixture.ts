import { DatabaseSync } from 'node:sqlite';
import { Operations } from './operations.ts';
import { fixtureSnapshot } from './fixture.ts';
import { plan } from './planner.ts';

export function recoveryFixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE runtime_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
  try {
    const ops = new Operations(db), now = '2026-01-10T00:00:00.000Z';
    const source = fixtureSnapshot(); source.accounts.forEach(a => a.identityVerified = true);
    const manifest = plan(source, ['x'], 1, now), item: any = manifest.items[0];
    ops.saveManifest(manifest); ops.approve(manifest.manifestId, manifest.owner, manifest.digest, now);
    const run = ops.openRun('fixture-recovery', manifest.manifestId, now);
    ops.prepare(run.id, item.itemId, run.fence, now);
    ops.submitting(run.id, item.itemId, run.fence, now, item);
    const restarted = new Operations(db);
    const unknown = restarted.attempt(run.id, item.itemId).state;
    let retryBlocked = false;
    try { restarted.submitting(run.id, item.itemId, run.fence, now, item); } catch { retryBlocked = true; }
    const receipt = { itemId: item.itemId, accountId: item.accountId, payloadDigest: item.payloadDigest,
      url: 'https://x.com/fixture/status/123', public: true, evidenceDigest: 'a'.repeat(64) };
    const saved = restarted.receipt(run.id, item.itemId, receipt);
    const syncPending = saved.state;
    restarted.synced(run.id, item.itemId, { syncKey: saved.sync_key!, externalUrl: receipt.url, result: 'posted' });
    restarted.release(run.id);
    return { status: 'recovery_fixture_ready', synthetic: true, publishingEnabled: false,
      sourceConnected: false, mode: 'dry_run', unknown, retryBlocked, syncPending,
      reconciled: restarted.attempt(run.id, item.itemId).state, manifestId: manifest.manifestId };
  } finally { db.close(); }
}
