import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { canonical, fingerprint, validateApproval, type Approval, type Manifest } from './planner.ts';

type Run = { id: string; manifest_id: string; epoch: number; fence: number; stopped: number; state: string };
type Attempt = { run_id: string; item_id: string; state: string; receipt: string | null; sync_key: string | null };
function check(value: unknown, reason: string): asserts value { if (!value) throw new Error(reason); }
export class Operations {
  readonly epoch: number;
  readonly db: DatabaseSync;
  constructor(db: DatabaseSync, boot = true) {
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS manifests(id TEXT PRIMARY KEY, owner TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS approvals(manifest_id TEXT PRIMARY KEY, epoch INTEGER NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, manifest_id TEXT NOT NULL, epoch INTEGER NOT NULL,
        fence INTEGER NOT NULL, stopped INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS leases(scope TEXT PRIMARY KEY, run_id TEXT NOT NULL, fence INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS attempts(run_id TEXT NOT NULL, item_id TEXT NOT NULL, state TEXT NOT NULL,
        receipt TEXT, sync_key TEXT, PRIMARY KEY(run_id,item_id));
      INSERT OR IGNORE INTO runtime_metadata VALUES('epoch','0');
      INSERT OR IGNORE INTO runtime_metadata VALUES('fence','0');`);
    this.epoch = boot ? this.transaction(() => {
      const epoch = Number(db.prepare("SELECT value FROM runtime_metadata WHERE key='epoch'").get()!.value) + 1;
      db.prepare("UPDATE runtime_metadata SET value=? WHERE key='epoch'").run(String(epoch));
      db.exec("UPDATE attempts SET state='submission_unknown' WHERE state='submitting'; UPDATE runs SET stopped=1,state='restart_requires_reconciliation' WHERE state='active';");
      return epoch;
    }) : Number(db.prepare("SELECT value FROM runtime_metadata WHERE key='epoch'").get()!.value);
  }
  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  saveManifest(manifest: Manifest) {
    const { manifestId, digest, ...body } = manifest;
    check(fingerprint(body) === digest && manifestId === digest, 'manifest_changed');
    const previous = this.db.prepare('SELECT body FROM manifests WHERE id=?').get(manifestId);
    check(!previous || previous.body === canonical(manifest), 'manifest_collision');
    this.db.prepare('INSERT OR IGNORE INTO manifests VALUES(?,?,?)').run(manifestId, manifest.owner, canonical(manifest));
    return manifestId;
  }
  manifest(id: string): Manifest {
    const row = this.db.prepare('SELECT body FROM manifests WHERE id=?').get(id);
    check(row, 'manifest_missing');
    return JSON.parse(String(row.body));
  }
  approve(id: string, owner: string, digest: string, now: string) {
    const manifest = this.manifest(id);
    const approval: Approval = { owner, manifestDigest: digest, approvedAt: now,
      expiresAt: new Date(Date.parse(now) + 60 * 60 * 1000).toISOString() };
    validateApproval(manifest, approval, now);
    check(this.epoch === Number(this.db.prepare("SELECT value FROM runtime_metadata WHERE key='epoch'").get()!.value), 'worker_restarted');
    this.db.prepare('INSERT OR REPLACE INTO approvals VALUES(?,?,?)').run(id, this.epoch, canonical(approval));
    return approval;
  }
  private approved(id: string, now: string) {
    const approval = this.db.prepare('SELECT epoch,body FROM approvals WHERE manifest_id=?').get(id);
    check(approval && approval.epoch === this.epoch, 'fresh_approval_required');
    validateApproval(this.manifest(id), JSON.parse(String(approval.body)), now);
  }
  openRun(id: string, manifestId: string, now: string) {
    check(/^[a-zA-Z0-9-]{1,80}$/.test(id), 'invalid_run_id');
    return this.transaction(() => {
      const existing = this.db.prepare('SELECT * FROM runs WHERE id=?').get(id) as Run | undefined;
      if (existing) { check(existing.manifest_id === manifestId, 'run_key_conflict'); return existing; }
      this.approved(manifestId, now);
      const manifest = this.manifest(manifestId);
      const items = manifest.items as { itemId: string }[];
      check(items.length, 'empty_manifest');
      for (const item of items) check(!this.db.prepare("SELECT 1 FROM attempts WHERE item_id=? AND state != 'failed_before_submit'").get(item.itemId), 'prior_attempt_requires_reconciliation');
      const scopes = manifest.accounts.map(a => fingerprint({ owner: manifest.owner, target: a.target, accountId: a.accountId }));
      for (const scope of scopes) check(!this.db.prepare('SELECT 1 FROM leases WHERE scope=?').get(scope), 'account_leased');
      const fence = Number(this.db.prepare("SELECT value FROM runtime_metadata WHERE key='fence'").get()!.value) + 1;
      this.db.prepare("UPDATE runtime_metadata SET value=? WHERE key='fence'").run(String(fence));
      this.db.prepare('INSERT INTO runs(id,manifest_id,epoch,fence,state) VALUES(?,?,?,?,?)').run(id, manifestId, this.epoch, fence, 'active');
      for (const scope of scopes) this.db.prepare('INSERT INTO leases VALUES(?,?,?)').run(scope, id, fence);
      return this.db.prepare('SELECT * FROM runs WHERE id=?').get(id) as Run;
    });
  }
  private guard(id: string, fence: number, now: string) {
    const run = this.db.prepare('SELECT * FROM runs WHERE id=?').get(id) as Run | undefined;
    check(run && run.fence === fence && run.epoch === this.epoch && !run.stopped && run.state === 'active', 'stopped_or_stale_run');
    check(this.epoch === Number(this.db.prepare("SELECT value FROM runtime_metadata WHERE key='epoch'").get()!.value), 'worker_restarted');
    this.approved(run.manifest_id, now);
    check(this.db.prepare('SELECT 1 FROM leases WHERE run_id=? AND fence=?').get(id, fence), 'lease_missing');
    return run;
  }
  prepare(id: string, itemId: string, fence: number, now: string) {
    return this.transaction(() => {
      const run = this.guard(id, fence, now);
      check(this.manifest(run.manifest_id).items.some((i: any) => i.itemId === itemId), 'item_out_of_scope');
      const previous = this.db.prepare('SELECT * FROM attempts WHERE run_id=? AND item_id=?').get(id, itemId) as Attempt | undefined;
      if (previous) return previous;
      this.db.prepare('INSERT INTO attempts(run_id,item_id,state) VALUES(?,?,?)').run(id, itemId, 'ready_to_submit');
      return this.attempt(id, itemId);
    });
  }
  submitting(id: string, itemId: string, fence: number, now: string, observed: { accountId: string; payloadDigest: string }) {
    return this.transaction(() => {
      const run = this.guard(id, fence, now);
      const item: any = this.manifest(run.manifest_id).items.find((i: any) => i.itemId === itemId);
      check(item && item.accountId === observed.accountId && item.payloadDigest === observed.payloadDigest, 'identity_or_payload_changed');
      check(this.attempt(id, itemId).state === 'ready_to_submit', 'submission_retry_forbidden');
      this.db.prepare('UPDATE attempts SET state=? WHERE run_id=? AND item_id=?').run('submitting', id, itemId);
      return this.attempt(id, itemId);
    });
  }
  attempt(id: string, itemId: string) {
    const row = this.db.prepare('SELECT * FROM attempts WHERE run_id=? AND item_id=?').get(id, itemId) as Attempt | undefined;
    check(row, 'attempt_missing'); return row;
  }
  authorizeClick(id: string, itemId: string, fence: number, now: string) {
    this.guard(id, fence, now);
    check(this.attempt(id, itemId).state === 'submitting', 'submission_no_longer_authorized');
  }
  unknown(id: string, itemId: string) {
    check(this.attempt(id, itemId).state === 'submitting', 'invalid_unknown_transition');
    this.db.prepare('UPDATE attempts SET state=? WHERE run_id=? AND item_id=?').run('submission_unknown', id, itemId);
  }
  receipt(id: string, itemId: string, receipt: { itemId: string; accountId: string; payloadDigest: string; url: string; public: boolean; evidenceDigest: string }) {
    return this.transaction(() => {
      const run = this.db.prepare('SELECT * FROM runs WHERE id=?').get(id) as Run | undefined;
      check(run, 'run_missing');
      const item: any = this.manifest(run.manifest_id).items.find((i: any) => i.itemId === itemId);
      check(item && receipt.itemId === itemId && receipt.accountId === item.accountId && receipt.payloadDigest === item.payloadDigest, 'receipt_mismatch');
      const url = new URL(receipt.url);
      const hosts: Record<string, string[]> = { tiktok: ['www.tiktok.com'], reddit: ['www.reddit.com'], x: ['x.com'], pinterest: ['www.pinterest.com'] };
      check(url.protocol === 'https:' && !url.username && !url.password && hosts[item.target.split('_')[0]].includes(url.hostname)
        && url.pathname !== '/' && receipt.public === true && /^[a-f0-9]{64}$/.test(receipt.evidenceDigest), 'receipt_unverified');
      const attempt = this.attempt(id, itemId), body = canonical(receipt);
      if (attempt.receipt) { check(attempt.receipt === body, 'receipt_conflict'); return attempt; }
      check(['submitting', 'submission_unknown'].includes(attempt.state), 'invalid_receipt_transition');
      this.db.prepare('UPDATE attempts SET state=?,receipt=?,sync_key=? WHERE run_id=? AND item_id=?')
        .run('public_verified_sync_pending', body, fingerprint({ itemId, receipt }), id, itemId);
      return this.attempt(id, itemId);
    });
  }
  synced(id: string, itemId: string, readback: { syncKey: string; externalUrl: string; result: string }) {
    const attempt = this.attempt(id, itemId);
    check(attempt.receipt && readback.syncKey === attempt.sync_key && readback.result === 'posted'
      && readback.externalUrl === JSON.parse(attempt.receipt).url, 'source_readback_mismatch');
    this.db.prepare('UPDATE attempts SET state=? WHERE run_id=? AND item_id=?').run('completed', id, itemId);
    return this.attempt(id, itemId);
  }
  stop(id: string) {
    this.transaction(() => {
      check(this.db.prepare('SELECT 1 FROM runs WHERE id=?').get(id), 'run_missing');
      this.db.prepare('UPDATE runs SET stopped=1,state=? WHERE id=?').run('stop_requested', id);
      this.db.prepare("UPDATE attempts SET state='submission_unknown' WHERE run_id=? AND state='submitting'").run(id);
    });
  }
  release(id: string) {
    this.transaction(() => {
      check(!this.db.prepare("SELECT 1 FROM attempts WHERE run_id=? AND state NOT IN ('completed','failed_before_submit')").get(id), 'unresolved_attempts');
      this.db.prepare('DELETE FROM leases WHERE run_id=?').run(id);
      this.db.prepare('UPDATE runs SET stopped=1,state=? WHERE id=?').run('closed', id);
    });
  }
  failBeforeSubmit(id: string, itemId: string) {
    check(this.attempt(id, itemId).state === 'ready_to_submit', 'side_effect_possible');
    this.db.prepare('UPDATE attempts SET state=? WHERE run_id=? AND item_id=?').run('failed_before_submit', id, itemId);
  }
  report(id: string) {
    const run = this.db.prepare('SELECT * FROM runs WHERE id=?').get(id) as Run | undefined;
    check(run, 'run_missing');
    return { run, attempts: this.db.prepare('SELECT * FROM attempts WHERE run_id=? ORDER BY item_id').all(id) };
  }
}

export const newRunId = () => randomUUID();
