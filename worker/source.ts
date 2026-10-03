import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { root, targets } from './local.ts';
import { downloadMedia } from './media.ts';
import { plan, type Snapshot, type Target, type Payload } from './planner.ts';

export type SourceExport = { schemaVersion: number; source: string; complete: boolean; nextCursor: string | null;
  owner: string; revision: string; asOf: string;
  accounts: { target: Target; handle: string; processedSlugs: string[]; pendingSlug: string | null }[];
  articles: { id: string; slug: string; canonicalUrl: string; publishedAt: string; mediaUrl: string | null;
    payloads: Partial<Record<Target, { title: string; caption: string | null; approved: boolean }>> }[] };
export type Choices = { owner: string; selected: Target[]; cap: number; allowedMediaOrigins: string[];
  accounts: Partial<Record<Target, { accountId: string; handle: string; identityVerified: boolean;
    destination: string; visibility: 'public' | 'private'; musicPolicy: string }>> };
export function protectedJSON(path: string) {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0 || info.size > 20 * 1024 * 1024) throw new Error('source_file_unsafe');
  return JSON.parse(readFileSync(path, 'utf8'));
}
export async function sourceManifest(source: SourceExport, choices: Choices, now: string, media = downloadMedia) {
  if (source.schemaVersion !== 1 || source.source !== 'portfolio' || !source.complete || source.nextCursor !== null
    || source.owner !== choices.owner || !/^[a-f0-9]{64}$/.test(source.revision)
    || !Number.isFinite(Date.parse(source.asOf)) || !Number.isFinite(Date.parse(now))
    || Date.parse(now) < Date.parse(source.asOf) || Date.parse(now) - Date.parse(source.asOf) > 15 * 60 * 1000) throw new Error('source_snapshot_stale_or_invalid');
  if (!Array.isArray(choices.selected) || !choices.selected.length || choices.selected.some(t => !targets.includes(t))
    || !Number.isInteger(choices.cap) || choices.cap < 1 || choices.cap > 20) throw new Error('source_scope_invalid');
  if (source.articles.length > 10_000 || new Set(source.accounts.map(a => a.target)).size !== source.accounts.length) throw new Error('source_snapshot_invalid');
  const snapshot: Snapshot = { owner: source.owner, revision: source.revision, complete: true, nextCursor: null,
    accounts: choices.selected.map(target => {
      const from = source.accounts.find(a => a.target === target), account = choices.accounts[target];
      if (!from || !account || from.handle !== account.handle) throw new Error('account_mapping_required');
      return { target, accountId: account.accountId, identityVerified: account.identityVerified,
        processed: source.articles.filter(a => from.processedSlugs.includes(a.slug)).map(a => a.id),
        unresolved: source.articles.filter(a => a.slug === from.pendingSlug).map(a => a.id) };
    }), articles: source.articles.map(article => ({ id: article.id, slug: article.slug,
      canonicalUrl: article.canonicalUrl, publishedAt: article.publishedAt,
      payloads: Object.fromEntries(choices.selected.map(target => {
        const copy = article.payloads[target], account = choices.accounts[target]!;
        return [target, { title: copy?.title ?? '', caption: copy?.caption ?? '', approved: copy?.approved === true,
          destination: account.destination, visibility: account.visibility, musicPolicy: account.musicPolicy,
          // Preliminary references let the planner limit downloads to selected eligible work.
          media: article.mediaUrl ? { url: article.mediaUrl, sha256: '0'.repeat(64) } : null } satisfies Payload];
      })) })) };
  const preliminary = plan(snapshot, choices.selected, choices.cap, now);
  const mediaByUrl = new Map<string, Awaited<ReturnType<typeof downloadMedia>>>();
  for (const item of preliminary.items as any[]) {
    const reference = item.payload.media;
    if (!reference || mediaByUrl.has(reference.url)) continue;
    mediaByUrl.set(reference.url, await media(reference.url, choices.allowedMediaOrigins, join(root, 'runtime/media', source.revision)));
  }
  for (const article of snapshot.articles) for (const payload of Object.values(article.payloads)) {
    if (payload.media && mediaByUrl.has(payload.media.url)) payload.media.sha256 = mediaByUrl.get(payload.media.url)!.sha256;
  }
  return { manifest: plan(snapshot, choices.selected, choices.cap, now), media: [...mediaByUrl.values()] };
}
