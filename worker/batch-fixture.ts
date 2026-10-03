import { fixturePlan } from './fixture.ts';
import { dryRunBatch, dispatch, type Observation } from './batch.ts';
import type { Item } from './adapters/common.ts';
export function fixtureObservation(item: Item): Observation {
  return { mode: 'dry_run', now: '2026-01-10T00:00:00Z', observedAt: '2026-01-10T00:00:00Z',
    accountId: item.accountId, identityVerified: true, loginStatus: 'valid', mediaDigest: item.payload.media?.sha256 ?? null,
    mediaFormat: 'png', mediaBytes: 512, device: 'iphone', transport: 'assisted', accountTypeVerified: true,
    commercialRightsVerified: true, rulesReviewed: true, postType: 'image',
    boardId: item.payload.destination, boardWritable: true, boardPublic: true };
}
export async function batchFixture() {
  const { manifest } = fixturePlan();
  const report = await dryRunBatch(manifest, async item => fixtureObservation(item));
  return { status: 'batch_fixture_ready', synthetic: true, publishingEnabled: false, sourceConnected: false, manifestId: manifest.manifestId,
    report, accounts: manifest.targetOrder.map(target => ({ target, items: (manifest.items as Item[]).filter(i => i.target === target).map(i => ({ itemId: i.itemId, target })) })) };
}
export function itemFixture(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).sort().join(',') !== 'itemId,target') throw new Error('fixture_input_invalid');
  const { itemId, target } = input as { itemId: string; target: string };
  const item = (fixturePlan().manifest.items as Item[]).find(i => i.itemId === itemId && i.target === target);
  if (!item) throw new Error('fixture_item_unavailable');
  return { synthetic: true, publishingEnabled: false, sourceConnected: false, mode: 'dry_run', ...dispatch(item, fixtureObservation(item)) };
}
