import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixturePlan } from '../worker/fixture.ts';
import { fixtureObservation, itemFixture, batchFixture } from '../worker/batch-fixture.ts';
import { dryRunBatch, reportCSV } from '../worker/batch.ts';
test('all six accounts run serially from the fixed finite manifest without side effects', async () => {
  const { manifest } = fixturePlan(); let active = 0, maximum = 0;
  const report = await dryRunBatch(manifest, async item => { active++; maximum = Math.max(maximum, active); await Promise.resolve(); active--; return fixtureObservation(item); });
  assert.equal(maximum, 1); assert.equal(report.validated, 12); assert.equal(report.submitted, 0); assert.equal(report.skipped, 0);
  assert.deepEqual(report.rows.map(r => r.target), manifest.items.map((i: any) => i.target));
  assert.ok(report.rows.every(r => !r.handoff && !r.automatedSubmission));
  assert.equal((await batchFixture()).accounts.length, 6);
  assert.equal(itemFixture({ itemId: (manifest.items[0] as any).itemId, target: 'tiktok_personal' }).status, 'dry_run_validated');
  assert.throws(() => itemFixture({ target: 'x', itemId: 'new' }));
  assert.throws(() => itemFixture({ target: 'x', itemId: 'new', mode: 'publish' }));
});
test('identity/login failure stops later work and edited manifests are rejected', async () => {
  const { manifest } = fixturePlan();
  const report = await dryRunBatch(manifest, async item => ({ ...fixtureObservation(item), loginStatus: 'challenge' }));
  assert.equal(report.blocked, 12); assert.equal(report.rows[1].reason, 'prior_identity_or_login_stop');
  const changed: any = structuredClone(manifest); changed.items.pop();
  await assert.rejects(dryRunBatch(changed, async item => fixtureObservation(item)), /manifest_changed/);
  assert.ok(reportCSV([{ ...report.rows[0], itemId: '=formula' }]).includes("'=formula"));
});
