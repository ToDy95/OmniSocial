import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceManifest, type Choices, type SourceExport } from '../worker/source.ts';
const now = '2026-01-10T00:00:00.000Z';
function source(): SourceExport {
  return { schemaVersion: 1, source: 'portfolio', complete: true, nextCursor: null, owner: 'fixture-owner', revision: 'a'.repeat(64), asOf: now,
    accounts: [{ target: 'x', handle: '@fixture', processedSlugs: ['old'], pendingSlug: 'pending' }],
    articles: ['new', 'pending', 'old'].map((slug, i) => ({ id: `fixture-${slug}`, slug, canonicalUrl: `https://example.invalid/${slug}`,
      publishedAt: `2026-01-0${3 - i}T00:00:00.000Z`, mediaUrl: 'https://fixture.supabase.co/media.png',
      payloads: { x: { title: slug, caption: `Fixture ${slug}`, approved: true } } })) };
}
const choices: Choices = { owner: 'fixture-owner', selected: ['x'], cap: 1, allowedMediaOrigins: ['https://fixture.supabase.co'],
  accounts: { x: { accountId: 'fixture-x', handle: '@fixture', identityVerified: false, destination: 'fixture-profile', visibility: 'public', musicPolicy: 'none' } } };
test('source adapter binds owner and fresh complete export, normalizes progress and hashes only selected media', async () => {
  let downloads = 0;
  const media: any = async () => { downloads++; return { sha256: 'b'.repeat(64), width: 100, height: 100, format: 'png', bytes: 100, path: 'synthetic-only' }; };
  const result = await sourceManifest(source(), choices, now, media);
  assert.equal(result.manifest.items.length, 1); assert.equal(downloads, 1);
  const item: any = result.manifest.items[0];
  assert.equal(item.slug, 'new'); assert.equal(item.payload.media.sha256, 'b'.repeat(64));
  assert.ok(result.manifest.exclusions.some(e => e.reason === 'already_processed'));
  assert.ok(result.manifest.exclusions.some(e => e.reason === 'unresolved_submission'));
  assert.equal(result.manifest.accounts[0].identityVerified, false);
  await assert.rejects(sourceManifest(source(), { ...choices, owner: 'wrong' }, now, media), /stale_or_invalid/);
  await assert.rejects(sourceManifest(source(), choices, '2026-01-10T01:00:00.000Z', media), /stale_or_invalid/);
  await assert.rejects(sourceManifest({ ...source(), complete: false }, choices, now, media), /stale_or_invalid/);
  await assert.rejects(sourceManifest(source(), { ...choices, accounts: {} }, now, media), /mapping/);
});
