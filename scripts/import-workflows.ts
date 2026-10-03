import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from '../worker/local.ts';
import { runN8n } from '../worker/n8n.ts';

const recovery = ['SOC-005-prepare-fixture', 'SOC-005-verify-fixture', 'SOC-005-reconcile-fixture', 'SOC-005-report-fixture', 'SOC-005-stop-fixture'];
const batch = ['SOC-011-tiktok-fixture', 'SOC-011-reddit-fixture', 'SOC-011-x-fixture', 'SOC-011-pinterest-fixture', 'SOC-011-item-fixture', 'SOC-011-account-fixture', 'SOC-011-batch-fixture'];
const browser = ['SOC-015-browser-run', 'SOC-015-browser-stop'];
if (process.argv[2] && !['batch', 'browser'].includes(process.argv[2])) throw new Error('Unknown workflow set');
const names = process.argv[2] === 'browser' ? browser : process.argv[2] === 'batch' ? batch : recovery;
process.umask(0o077);
const db = new DatabaseSync(join(root, 'runtime/n8n/.n8n/database.sqlite'), { readOnly: true });
const owners = db.prepare("SELECT id FROM user WHERE roleSlug='global:owner' AND disabled=0 AND password IS NOT NULL").all();
if (owners.length !== 1 || !db.prepare('SELECT id FROM credentials_entity WHERE id=?').get('omnisocialWorker')) throw new Error('Local owner/worker setup required');
const files = names.map(name => join(root, 'workflows', `${name}.json`));
for (const file of files) {
  const workflow = JSON.parse(readFileSync(file, 'utf8'));
  if (db.prepare('SELECT id FROM workflow_entity WHERE id=?').get(workflow.id)) throw new Error('Workflow exists; preserve local edits before importing');
}
db.close();
for (const file of files) {
  const child = runN8n(['import:workflow', '--input', file, '--userId', String(owners[0].id), '--activeState=false']);
  const [code] = await once(child, 'exit');
  if (code !== 0) throw new Error('Fixture workflow import failed');
}
console.log('Imported inactive manual workflows; no workflow was executed.');
