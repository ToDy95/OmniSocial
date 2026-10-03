import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { once } from 'node:events';
import { root } from '../worker/local.ts';
import { runN8n } from '../worker/n8n.ts';

process.umask(0o077);
const db = new DatabaseSync(join(root, 'runtime/n8n/.n8n/database.sqlite'), { readOnly: true });
const owners = db.prepare("SELECT id FROM user WHERE roleSlug='global:owner' AND disabled=0 AND password IS NOT NULL").all();
if (owners.length !== 1) throw new Error('Complete local owner setup first');
if (!db.prepare('SELECT id FROM credentials_entity WHERE id=?').get('omnisocialWorker')) throw new Error('Import the health workflow first');
if (db.prepare('SELECT id FROM workflow_entity WHERE id=?').get('omnisocialPlanFixture')) throw new Error('Plan workflow exists; preserve local edits before reimporting');
db.close();
const child = runN8n(['import:workflow', '--input', join(root, 'workflows/SOC-004-manual-plan.json'), '--userId', String(owners[0].id), '--activeState=false']);
const [code] = await once(child, 'exit');
if (code !== 0) throw new Error('Local plan import failed');
console.log('Imported inactive manual fixture plan. Publishing remains disabled.');
