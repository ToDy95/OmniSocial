import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tiktokPersonal } from '../worker/adapters/tiktok.ts';
import type { Context } from '../worker/adapters/common.ts';
import { personalFixture } from './adapter-fixture.ts';
test('TikTok Personal validates exact native photo handoff; dry run prepares nothing', () => {
  const { item, context } = personalFixture();
  assert.equal(tiktokPersonal(item, context).status, 'dry_run_validated');
  assert.equal(tiktokPersonal(item, context).handoff, undefined);
  const result = tiktokPersonal(item, { ...context, mode: 'publish' });
  assert.equal(result.status, 'awaiting_owner'); assert.equal(result.automatedSubmission, false);
  assert.deepEqual(result.handoff!.package, item);
  for (const change of [{ device: 'mac' }, { transport: 'api' }, { loginStatus: 'challenge' }, { accountId: 'wrong' }, { mediaDigest: 'changed' }]) {
    assert.equal(tiktokPersonal(item, { ...context, ...change } as Context).status, 'blocked');
  }
  const changed = structuredClone(item); changed.payload.caption += ' changed';
  assert.equal(tiktokPersonal(changed, context).reason, 'payload_changed');
});
