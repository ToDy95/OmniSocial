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
test('desktop photos need fresh per-account capability and remain an owner handoff', () => {
  const { item, context } = personalFixture();
  const desktop = { ...context, device: 'mac' as const, desktopPhotoUploadVerified: true, mediaFormat: 'webp' };
  assert.equal(tiktokPersonal(item, desktop).status, 'dry_run_validated');
  assert.equal(tiktokPersonal(item, { ...desktop, desktopPhotoUploadVerified: false }).reason, 'desktop_photo_capability_required');
  assert.equal(tiktokPersonal(item, { ...desktop, observedAt: '2025-12-31T23:00:00Z' }).reason, 'fresh_matching_identity_required');
  assert.equal(tiktokPersonal(item, { ...desktop, accountId: 'other' }).status, 'blocked');
  assert.equal(tiktokPersonal(item, { ...desktop, transport: 'api' }).status, 'blocked');
  assert.equal(tiktokPersonal(item, { ...desktop, device: 'iphone' }).reason, 'photo_format_acceptance_required');
  const decision = tiktokPersonal(item, { ...desktop, mode: 'publish' });
  assert.equal(decision.status, 'awaiting_owner');
  assert.equal(decision.automatedSubmission, false);
  assert.match(decision.handoff!.destination, /tiktokstudio\/upload/);
});
