import type { DatabaseSync } from 'node:sqlite';
import { fingerprint } from './planner.ts';
import { BrowserStop } from './browser-session.ts';

type Job = { id: string; operation: string; input_digest: string; state: string; output: string | null };
export class BrowserJobs {
  private busy = false;
  readonly db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS browser_jobs(id TEXT PRIMARY KEY,operation TEXT NOT NULL,
      input_digest TEXT NOT NULL,state TEXT NOT NULL,output TEXT);
      UPDATE browser_jobs SET state='interrupted',output='{"status":"stopped","reason":"restart_requires_reconciliation"}' WHERE state='running';`);
  }
  start(id: string, operation: string, input: object, work: () => Promise<unknown>) {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new BrowserStop('job_id_invalid');
    const digest = fingerprint(input);
    const existing = this.db.prepare('SELECT * FROM browser_jobs WHERE id=?').get(id) as Job | undefined;
    if (existing) {
      if (existing.operation !== operation || existing.input_digest !== digest) throw new BrowserStop('job_key_conflict');
      return this.status(id);
    }
    if (this.busy) throw new BrowserStop('browser_busy');
    this.busy = true;
    this.db.prepare('INSERT INTO browser_jobs VALUES(?,?,?, ?,NULL)').run(id, operation, digest, 'running');
    void Promise.resolve().then(work).then(output => {
      this.db.prepare('UPDATE browser_jobs SET state=?,output=? WHERE id=?').run('finished', JSON.stringify(output), id);
    }, error => {
      this.db.prepare('UPDATE browser_jobs SET state=?,output=? WHERE id=?').run('finished', JSON.stringify({ status: 'stopped',
        reason: error instanceof BrowserStop ? error.message : 'browser_operation_failed',
        target: error instanceof BrowserStop ? error.target : undefined }), id);
    }).finally(() => { this.busy = false; });
    return this.status(id);
  }
  status(id: string) {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new BrowserStop('job_id_invalid');
    const row = this.db.prepare('SELECT * FROM browser_jobs WHERE id=?').get(id) as Job | undefined;
    if (!row) throw new BrowserStop('job_missing');
    return { jobId: row.id, operation: row.operation, state: row.state,
      ...(row.output ? { result: JSON.parse(row.output) } : {}) };
  }
  get running() { return this.busy; }
}
