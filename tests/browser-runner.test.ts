import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { BrowserRunner, type PublishingBackend, type Prepared } from '../worker/browser-runner.ts';
import { BrowserJobs } from '../worker/browser-jobs.ts';
import { BrowserAPI } from '../worker/browser-api.ts';
import { BrowserSessions, BrowserStop } from '../worker/browser-session.ts';
import { BrowserProvider, receiptURL, sameIdentity, imageDistance } from '../worker/browser-provider.ts';
import { mobileCaption, type BrowserItem } from '../worker/browser-source.ts';
import type { BrowserConfig } from '../worker/browser-config.ts';
import { createWorker } from '../worker/server.ts';
import { Operations } from '../worker/operations.ts';
import { fixturePlan } from '../worker/fixture.ts';
import { fingerprint, type Target } from '../worker/planner.ts';
import sharp from 'sharp';

const now = '2026-01-10T00:00:00.000Z';
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE runtime_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
  const operations = new Operations(db);
  const { manifestId: _id, digest: _digest, ...body } = structuredClone(fixturePlan().manifest);
  for (const account of body.accounts) account.identityVerified = true;
  const manifest = { ...body, manifestId: fingerprint(body), digest: fingerprint(body) };
  const calls: string[] = [];
  let failure = '';
  let stopComposer = false;
  const config = { schemaVersion: 1, owner: manifest.owner, selected: manifest.targetOrder, cap: manifest.cap,
    accounts: Object.fromEntries(manifest.accounts.map(a => [a.target, { handle: a.accountId }])) } as BrowserConfig;
  const backend: PublishingBackend = {
    async discover() { calls.push('discover'); return { manifest, progress: [], media: [] }; },
    async identity(target) { calls.push(`identity:${target}`); return { accountId: manifest.accounts.find(a => a.target === target)!.accountId, observedAt: now }; },
    async prepare(item) { calls.push(`prepare:${item.target}`); },
    async media() { return null; },
    async composer(item) { calls.push(`composer:${item.target}`); if (stopComposer) operations.stop('fixture-run'); return { sound: null }; },
    async submit(item, _config, _prepared, beforeClick) { beforeClick(); calls.push(`submit:${item.target}`); if (failure === 'submit') throw new Error('response_lost'); },
    async result(item) { return item.target.startsWith('tiktok') ? 'https://www.tiktok.com/@fixture/photo/1'
      : item.target === 'x' ? 'https://x.com/fixture/status/1'
      : item.target === 'reddit' ? 'https://www.reddit.com/r/fixture/comments/abc/title/' : 'https://www.pinterest.com/pin/1/'; },
    async verify(item, _config, url) { calls.push(`verify:${item.target}`); return { itemId: item.itemId, accountId: item.accountId,
      payloadDigest: item.payloadDigest, url, public: true, evidenceDigest: fingerprint('synthetic-public-proof') }; },
    async sync(item, url, _sound, syncKey) { calls.push(`sync:${item.target}`); if (failure === 'sync') throw new Error('source_unavailable'); return { syncKey, externalUrl: url, result: 'posted' }; },
    async finish(target) { calls.push(`finish:${target}`); return { target, processed: 2, total: 2, remaining: 0 }; },
  };
  const runner = new BrowserRunner(operations, backend, () => config, () => now, () => {});
  operations.saveManifest(manifest);
  db.prepare('INSERT INTO browser_choices VALUES(?,?)').run(manifest.manifestId, JSON.stringify(config));
  operations.approve(manifest.manifestId, manifest.owner, manifest.digest, now);
  return { db, operations, runner, backend, config, manifest, calls, setFailure: (value: string) => { failure = value; }, stopComposer: () => { stopComposer = true; } };
}
test('real orchestration contract is sequential and dry planning never submits, prepares or synchronizes', async () => {
  const f = fixture();
  try {
    const result = await f.runner.plan();
    assert.equal(result.status, 'review_required');
    assert.equal(f.calls.filter(c => /^(submit|prepare|sync):/.test(c)).length, 0);
    f.calls.length = 0;
    const published = await f.runner.publish('fixture-run', f.manifest.manifestId, f.manifest.digest);
    assert.equal(published.status, 'completed');
    assert.equal(f.calls.filter(c => c.startsWith('submit:')).length, 12);
    assert.deepEqual(f.calls.filter(c => c.startsWith('submit:')).map(c => c.slice(7)), f.manifest.targetOrder.flatMap(t => [t, t]));
    assert.equal(f.operations.report('fixture-run').attempts.every(a => a.state === 'completed'), true);
    await assert.rejects(f.runner.publish('fixture-run', f.manifest.manifestId, f.manifest.digest), /reconciliation/);
    assert.equal(f.calls.filter(c => c.startsWith('submit:')).length, 12);
  } finally { f.db.close(); }
});
test('uncertain submission stops the lot and reconciliation has no submission capability', async () => {
  const f = fixture();
  try {
    f.setFailure('submit');
    const result = await f.runner.publish('fixture-run', f.manifest.manifestId, f.manifest.digest);
    assert.equal(result.status, 'stopped');
    const item = f.manifest.items[0] as BrowserItem;
    assert.equal(f.operations.attempt('fixture-run', item.itemId).state, 'submission_unknown');
    assert.equal(f.calls.filter(c => c.startsWith('submit:')).length, 1);
    await assert.rejects(f.runner.reconcile('fixture-run', item.itemId), /receipt_url_required/);
    f.setFailure('');
    await f.runner.reconcile('fixture-run', item.itemId, 'https://www.tiktok.com/@fixture/photo/1');
    assert.equal(f.calls.filter(c => c.startsWith('submit:')).length, 1);
    assert.equal(f.operations.attempt('fixture-run', item.itemId).state, 'completed');
  } finally { f.db.close(); }
});
test('known receipt survives source failure and reconciliation retries only synchronization', async () => {
  const f = fixture();
  try {
    f.setFailure('sync');
    await f.runner.publish('fixture-run', f.manifest.manifestId, f.manifest.digest);
    const item = f.manifest.items[0] as BrowserItem;
    assert.equal(f.operations.attempt('fixture-run', item.itemId).state, 'public_verified_sync_pending');
    f.calls.length = 0; f.setFailure('');
    await f.runner.reconcile('fixture-run', item.itemId);
    assert.deepEqual(f.calls, [`sync:${item.target}`]);
  } finally { f.db.close(); }
});
test('stop during composer and changed configuration cannot reach Post', async () => {
  const f = fixture();
  try {
    f.stopComposer();
    assert.equal((await f.runner.publish('fixture-run', f.manifest.manifestId, f.manifest.digest)).status, 'stopped');
    assert.equal(f.calls.some(c => c.startsWith('submit:')), false);
    f.config.cap++;
    await assert.rejects(f.runner.publish('another-run', f.manifest.manifestId, f.manifest.digest), /configuration_changed/);
  } finally { f.db.close(); }
});
test('durable browser jobs replay the same operation and restart never resumes work', async () => {
  const f = fixture();
  try {
    const jobs = new BrowserJobs(f.db);
    let calls = 0;
    let finish!: (value: unknown) => void;
    const work = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
    jobs.start('job', 'publish', { digest: 'fixture' }, work);
    jobs.start('job', 'publish', { digest: 'fixture' }, work);
    assert.throws(() => jobs.start('job', 'publish', { digest: 'changed' }, work), /conflict/);
    assert.throws(() => jobs.start('other', 'plan', {}, work), /busy/);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1);
    finish({ status: 'fixture_done' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(jobs.status('job').state, 'finished');
    f.db.prepare('INSERT INTO browser_jobs VALUES(?,?,?,?,NULL)').run('crashed', 'publish', 'fixture', 'running');
    assert.equal(new BrowserJobs(f.db).status('crashed').state, 'interrupted');
  } finally { f.db.close(); }
});
test('HTTP browser operations are authenticated, bounded and require the exact owner approval', async () => {
  const f = fixture();
  const api = new BrowserAPI(new BrowserJobs(f.db), f.runner, new BrowserSessions());
  const server = createWorker('fixture', () => true, f.operations, api);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const post = (operation: string, body: object, authorized = true) => fetch(`${base}/v1/browser/${operation}`, {
    method: 'POST', headers: { ...(authorized ? { authorization: 'Bearer fixture' } : {}), 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await post('publish', {}, false)).status, 401);
    assert.equal((await post('plan', { jobId: 'plan', url: 'https://evil.invalid' })).status, 400);
    assert.equal((await post('publish', { jobId: 'run', manifestId: f.manifest.manifestId, digest: f.manifest.digest, mode: 'dry_run', ownerConfirmed: true })).status, 400);
    assert.equal((await post('publish', { jobId: 'run', manifestId: f.manifest.manifestId, digest: f.manifest.digest, mode: 'publish', ownerConfirmed: false })).status, 400);
    assert.equal(f.calls.length, 0);
    assert.equal((await post('navigate', {})).status, 404);
    assert.equal((await post('plan', { jobId: 'safe-plan' })).status, 200);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal((await fetch(`${base}/v1/browser/jobs/safe-plan`, { headers: { authorization: 'Bearer fixture' } })).status, 200);
    assert.equal(f.calls.some(c => c.startsWith('submit:')), false);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); f.db.close(); }
});
test('receipt URL and identity validators reject foreign providers, wrong accounts and destinations', () => {
  const item = { target: 'tiktok_codeonroids', accountId: '@fixture', payload: { destination: '@fixture' } } as BrowserItem;
  assert.equal(receiptURL('https://www.tiktok.com/@fixture/photo/123', item), 'https://www.tiktok.com/@fixture/photo/123');
  assert.throws(() => receiptURL('https://www.tiktok.com/@other/photo/123', item));
  assert.throws(() => receiptURL('https://evil.invalid/@fixture/photo/123', item));
  assert.throws(() => receiptURL('https://www.tiktok.com/@fixture/photo/123?tracking=1', item));
  assert.equal(sameIdentity('https://www.tiktok.com/@fixture', '@fixture'), true);
  assert.equal(sameIdentity('https://www.tiktok.com/@other', '@fixture'), false);
  assert.match(mobileCaption('Approved body\n\n#old\n\nMore of the work behind the work: https://old.invalid', 'tiktok_codeonroids'), /#softwaredeveloper/);
  assert.equal(mobileCaption('Raw compact #original', 'x'), 'Raw compact #original');
});
test('image verification accepts a resized image and rejects a different fixture', async () => {
  const pixels = Buffer.from(Array.from({ length: 30 * 20 * 3 }, (_, index) => (index * 37) % 256));
  const original = await sharp(pixels, { raw: { width: 30, height: 20, channels: 3 } }).png().toBuffer();
  const resized = await sharp(original).resize(300, 200).png().toBuffer();
  assert.ok(await imageDistance(original, resized) <= 6);
  const blank = await sharp({ create: { width: 30, height: 20, channels: 3, background: 'white' } }).png().toBuffer();
  assert.ok(await imageDistance(original, blank) > 6);
});
