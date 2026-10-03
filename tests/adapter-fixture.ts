import { fingerprint } from '../worker/planner.ts';
import type { Item, Context } from '../worker/adapters/common.ts';
export function personalFixture(): { item: Item; context: Context } {
  const payload = { title: 'Synthetic photo', caption: 'Synthetic caption', media: { url: 'https://example.invalid/photo.png', sha256: 'a'.repeat(64) },
    destination: 'fixture-personal', visibility: 'public', musicPolicy: 'none', disclosures: { ownBrand: false, paidPartnership: false, aiGenerated: true } };
  return { item: { itemId: 'fixture-personal-item', target: 'tiktok_personal', accountId: 'fixture-personal', payloadDigest: fingerprint(payload), canonicalUrl: 'https://example.invalid/article', payload },
    context: { mode: 'dry_run', now: '2026-01-01T00:00:00Z', observedAt: '2026-01-01T00:00:00Z', accountId: 'fixture-personal', identityVerified: true,
      loginStatus: 'valid', mediaDigest: 'a'.repeat(64), mediaFormat: 'png', device: 'iphone', transport: 'assisted' } };
}
