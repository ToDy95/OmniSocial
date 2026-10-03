import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { once } from 'node:events';
import { root, secret } from '../worker/local.ts';
import { runN8n } from '../worker/n8n.ts';

process.umask(0o077);
const db = new DatabaseSync(join(root, 'runtime/n8n/.n8n/database.sqlite'), { readOnly: true });
const owners = db.prepare("SELECT id FROM user WHERE roleSlug='global:owner' AND disabled=0 AND password IS NOT NULL").all();
if (owners.length !== 1) throw new Error('Complete the local owner setup first');
if (db.prepare('SELECT id FROM workflow_entity WHERE id=?').get('omnisocialHealth')) {
  throw new Error('Health workflow already exists; preserve local edits and reconcile before importing');
}
const hasCredential = Boolean(db.prepare('SELECT id FROM credentials_entity WHERE id=?').get('omnisocialWorker'));
db.close();
mkdirSync(join(root, 'runtime/import'), { recursive: true, mode: 0o700 });
const temporary = mkdtempSync(join(root, 'runtime/import/health-'));
async function command(args: string[]) {
  const child = runN8n(args);
  const [code] = await once(child, 'exit');
  if (code !== 0) throw new Error('Local n8n import failed');
}
try {
  if (!hasCredential) {
    const file = join(temporary, 'credential.json');
    writeFileSync(file, JSON.stringify([{ id: 'omnisocialWorker', name: 'OmniSocial local worker', type: 'httpHeaderAuth',
      data: { name: 'Authorization', value: `Bearer ${secret('worker-token')}` } }]), { mode: 0o600, flag: 'wx' });
    await command(['import:credentials', '--input', file, '--userId', String(owners[0].id)]);
  }
  await command(['import:workflow', '--input', join(root, 'workflows/SOC-003-manual-health.json'), '--userId', String(owners[0].id), '--activeState=false']);
  console.log('Imported inactive manual health workflow. No credentials were exported.');
} finally { rmSync(temporary, { recursive: true, force: true }); }
