import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { createWorker } from '../worker/server.ts';
import { openJournal } from '../worker/journal.ts';

test('journal survives reopen and keeps independent synthetic account rows', () => {
  process.umask(0o077);
  const dir = mkdtempSync(join(tmpdir(), 'omnisocial-fixture-'));
  const path = join(dir, 'journal.sqlite');
  try {
    let db = openJournal(path);
    db.prepare('INSERT INTO runtime_metadata VALUES (?, ?)').run('fixture:personal', 'pending');
    db.prepare('INSERT INTO runtime_metadata VALUES (?, ?)').run('fixture:business', 'blocked');
    db.close();
    db = openJournal(path);
    assert.equal(db.prepare('SELECT value FROM runtime_metadata WHERE key=?').get('fixture:personal')?.value, 'pending');
    assert.equal(db.prepare('SELECT value FROM runtime_metadata WHERE key=?').get('fixture:business')?.value, 'blocked');
    db.close();
    assert.equal(statSync(path).mode & 0o777, 0o600);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('worker refuses missing auth, browser origin, foreign host and side-effect routes; health failures are handled', async () => {
  const token = 'fixture-only-token';
  let ready = true;
  const server = createWorker(token, () => ready);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  const headers = { authorization: `Bearer ${token}` };
  try {
    assert.equal((await fetch(`${url}/v1/health`)).status, 401);
    assert.equal((await fetch(`${url}/v1/health`, { headers: { ...headers, origin: 'https://example.invalid' } })).status, 403);
    const foreignHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(`${url}/v1/health`, { headers: { ...headers, host: 'example.invalid' } }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject);
      req.end();
    });
    assert.equal(foreignHostStatus, 403);
    for (const path of ['/v1/publish', '/v1/prepare', '/v1/navigate', '/v1/record']) {
      assert.equal((await fetch(`${url}${path}`, { method: 'POST', headers })).status, 404);
    }
    const result = await fetch(`${url}/v1/health`, { headers });
    assert.equal(result.status, 200);
    assert.equal((await result.json()).publishingEnabled, false);
    const fixture = await fetch(`${url}/v1/plan-fixture`, { headers });
    const manifest = await fixture.json();
    assert.equal(fixture.status, 200);
    assert.equal(manifest.itemCount, 12);
    assert.equal(manifest.synthetic, true);
    assert.equal(manifest.sourceConnected, false);
    assert.deepEqual(await (await fetch(`${url}/v1/plan-fixture`, { headers })).json(), manifest);
    assert.equal((await fetch(`${url}/v1/plan-fixture?mode=publish`, { headers })).status, 404);
    assert.equal((await fetch(`${url}/v1/plan-fixture`, { method: 'POST', headers })).status, 404);
    assert.equal((await fetch(`${url}/v1/plan-fixture`)).status, 401);
    const batch = await (await fetch(`${url}/v1/fixture/batch`, { headers })).json();
    assert.equal(batch.report.validated, 12);
    const scope = batch.accounts[0].items[0];
    const post = (body: string) => fetch(`${url}/v1/fixture/item`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body });
    const item = await (await post(JSON.stringify(scope))).json();
    assert.equal(item.status, 'dry_run_validated');
    assert.equal(item.automatedSubmission, false);
    assert.equal((await post(JSON.stringify({ ...scope, mode: 'publish' }))).status, 400);
    assert.equal((await post('{')).status, 400);
    assert.equal((await post('x'.repeat(4097))).status, 413);
    assert.equal((await fetch(`${url}/v1/fixture/item`, { method: 'POST', headers, body: '{}' })).status, 400);
    ready = false;
    assert.equal((await fetch(`${url}/v1/health`, { headers })).status, 503);
    assert.equal((await fetch(`${url}/v1/plan-fixture`, { headers })).status, 503);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
