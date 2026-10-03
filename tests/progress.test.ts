import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceProgress } from '../worker/progress.ts';
import type { SourceExport } from '../worker/source.ts';
test('account progress deduplicates ledger checkpoints and separates preparation from receipts', () => {
  const source = { complete: true, nextCursor: null, asOf: 'fixture-time', revision: 'fixture-revision',
    articles: [{ slug: 'a' }, { slug: 'b' }, { slug: 'b' }], accounts: [
      { target: 'tiktok_personal', handle: '@personal', processedSlugs: ['a', 'b', 'b', 'absent'], pendingSlug: null },
      { target: 'tiktok_codeonroids', handle: '@business', processedSlugs: ['a'], pendingSlug: 'b' }
    ] } as SourceExport;
  const [personal, business] = sourceProgress(source);
  assert.equal(personal.processed, 2); assert.equal(personal.total, 2); assert.equal(personal.remaining, 0);
  assert.equal(business.remaining, 1); assert.equal(business.preparedSlug, 'b');
  assert.equal(business.publicReceiptCount, null);
  assert.throws(() => sourceProgress({ ...source, complete: false }), /complete_source/);
  assert.throws(() => sourceProgress({ ...source, nextCursor: 'more' }), /complete_source/);
});
