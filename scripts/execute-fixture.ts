import { once } from 'node:events';
import { runN8n } from '../worker/n8n.ts';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from '../worker/local.ts';
import { fingerprint } from '../worker/planner.ts';
import { connect } from 'node:net';
const editorRunning = await new Promise<boolean>(resolve => {
  const socket = connect({ host: '127.0.0.1', port: 5678 });
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('error', () => resolve(false));
  socket.setTimeout(1000, () => { socket.destroy(); resolve(true); });
});
if (editorRunning) throw new Error('Stop the local n8n editor before the isolated CLI fixture');
const names = ['tiktok', 'reddit', 'x', 'pinterest', 'item', 'account'];
const db = new DatabaseSync(join(root, 'runtime/n8n/.n8n/database.sqlite'), { readOnly: true });
const ids: string[] = [];
for (const name of [...names, 'batch']) {
  const expected = JSON.parse(readFileSync(join(root, 'workflows', `SOC-011-${name}-fixture.json`), 'utf8'));
  const stored = db.prepare('SELECT nodes, connections, settings, activeVersionId FROM workflow_entity WHERE id=?').get(expected.id);
  if (!stored || stored.activeVersionId) throw new Error('Fixture must be imported and unpublished');
  for (const key of ['nodes', 'connections', 'settings']) {
    if (fingerprint(JSON.parse(String(stored[key]))) !== fingerprint(expected[key])) throw new Error('Preserve edited fixture; import does not match');
  }
  if (name !== 'batch') ids.push(expected.id);
}
db.close();
async function command(args: string[]) {
  const capture = args[0] === 'execute';
  const child = runN8n(args, true, capture);
  let output = '';
  child.stdout?.on('data', chunk => { output += chunk.toString(); });
  const [code] = await once(child, 'exit');
  if (code !== 0) throw new Error('Fixture command failed');
  if (capture) {
    const start = output.indexOf('{', output.indexOf('Execution was successful:'));
    const end = output.lastIndexOf('}');
    const execution = JSON.parse(output.slice(start, end + 1));
    const rows = execution.data.resultData.runData['Finite fixture report'];
    const report = rows?.at(-1)?.data?.main?.[0]?.[0]?.json;
    if (report?.result !== 'batch_fixture_completed' || report.validated !== 12 || report.submitted !== 0 || report.verifiedPublic !== 0) throw new Error('Fixture report incomplete');
    console.log('Finite n8n fixture completed: 12 validated, 0 submitted, 0 public.');
  }
}
const enabled: string[] = [];
try {
  // n8n 2 requires published child versions even for CLI fixture executions.
  // These children have only sub-workflow triggers and synthetic fixed endpoints.
  for (const id of ids) { enabled.push(id); await command(['publish:workflow', '--id', id]); }
  await command(['execute', '--id=omnisocialBatchFixture']);
} finally {
  for (const id of enabled.reverse()) await command(['unpublish:workflow', '--id', id]);
}
