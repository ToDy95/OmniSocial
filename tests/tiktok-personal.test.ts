import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fingerprint } from '../worker/planner.ts';
import { tiktokPersonal } from '../worker/adapters/tiktok.ts';
import type { Item, Context } from '../worker/adapters/common.ts';
export function personalFixture(): { item: Item; context: Context } {
  const payload = { title: 'Synthetic photo', caption: 'Synthetic caption', media: { url: 'https://example.invalid/photo.png', sha256: 'a'.repeat(64) },
    destination: 'fixture-personal', visibility: 'public', musicPolicy: 'none', disclosures: { ownBrand: false, paidPartnership: false, aiGenerated: true } };
  return { item: { itemId: 'fixture-personal-item', target: 'tiktok_personal', accountId: 'fixture-personal', payloadDigest: fingerprint(payload), canonicalUrl: 'https://example.invalid/article', payload },
    context: { mode: 'dry_run', now: '2026-01-01T00:00:00Z', observedAt: '2026-01-01T00:00:00Z', accountId: 'fixture-personal', identityVerified: true,
      loginStatus: 'valid', mediaDigest: 'a'.repeat(64), mediaFormat: 'png', device: 'iphone', transport: 'assisted' } };
}
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
