import type { SourceExport } from './source.ts';

// Portfolio checkpoints measure processed work, which may include skipped posts.
// They are not independent provider receipts or local submission journal entries.
export function sourceProgress(source: SourceExport) {
  if (!source.complete || source.nextCursor !== null) throw new Error('complete_source_required');
  const catalog = new Set(source.articles.map(article => article.slug));
  return source.accounts.map(account => {
    const processed = new Set(account.processedSlugs.filter(slug => catalog.has(slug)));
    const prepared = account.pendingSlug !== null && catalog.has(account.pendingSlug)
      && !processed.has(account.pendingSlug);
    return { target: account.target, handle: account.handle, processed: processed.size,
      total: catalog.size, remaining: catalog.size - processed.size,
      preparedSlug: prepared ? account.pendingSlug : null,
      asOf: source.asOf, revision: source.revision, publicReceiptCount: null };
  });
}
