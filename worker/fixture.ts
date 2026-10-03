import { targets } from './local.ts';
import { plan, type Snapshot } from './planner.ts';

// All identities, copy and URLs below are synthetic. No network source is read.
export function fixtureSnapshot(): Snapshot {
  return { owner: 'fixture-owner', revision: 'fixture-v1', complete: true, nextCursor: null,
    accounts: targets.map(target => ({ target, accountId: `fixture-${target}`, identityVerified: false,
      processed: target === 'tiktok_personal' ? ['article-a'] : [],
      unresolved: target === 'pinterest_business' ? ['article-b'] : [] })),
    articles: ['c', 'a', 'b'].map(letter => ({ id: `article-${letter}`, slug: `fixture-${letter}`,
      canonicalUrl: `https://example.invalid/articles/${letter}`,
      publishedAt: `2026-01-0${letter.charCodeAt(0) - 96}T00:00:00.000Z`,
      payloads: Object.fromEntries(targets.map(target => [target, { approved: true, title: `Fixture ${letter}`,
        caption: `Synthetic ${letter} copy for ${target}.`, media: { url: `https://example.invalid/media/${letter}.png`, sha256: letter.repeat(64) },
        destination: target === 'reddit' ? 'r/fixture' : target.startsWith('pinterest') ? 'fixture-board' : 'fixture-profile',
        visibility: 'public', musicPolicy: 'none' }])) })) };
}
export function fixturePlan() {
  const manifest = plan(fixtureSnapshot(), [...targets], 2, '2026-01-10T00:00:00.000Z');
  return { status: 'fixture_ready', mode: 'dry_run', synthetic: true, sourceConnected: false,
    publishingEnabled: false, manifest, itemCount: manifest.items.length };
}
