import { createHash } from 'node:crypto';
import { targets } from './local.ts';

export type Target = typeof targets[number];
export type Payload = { title: string; caption: string; media: { url: string; sha256: string } | null;
  destination: string; visibility: 'public' | 'private'; musicPolicy: string; approved: boolean;
  disclosures?: { ownBrand: boolean; paidPartnership: boolean; aiGenerated: boolean } };
export type Snapshot = { owner: string; revision: string; complete: boolean; nextCursor: string | null;
  accounts: { target: Target; accountId: string; identityVerified: boolean;
    processed: string[]; unresolved: string[] }[];
  articles: { id: string; slug: string; canonicalUrl: string; publishedAt: string;
    payloads: Partial<Record<Target, Payload>> }[] };

// Canonical object order is essential: the digest must survive JSON round trips.
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
}
export function fingerprint(value: unknown) { return createHash('sha256').update(canonical(value)).digest('hex'); }
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function requireValue(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Error(reason);
}
function safeUrl(value: string) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }
  catch { return false; }
}

export function plan(snapshot: Snapshot, selected: Target[], cap: number, asOf: string) {
  const source: Snapshot = structuredClone(snapshot);
  requireValue(source.complete === true && source.nextCursor === null, 'incomplete_snapshot');
  requireValue(typeof source.owner === 'string' && source.owner.trim() && typeof source.revision === 'string' && source.revision.trim(), 'missing_source_identity');
  requireValue(Number.isInteger(cap) && cap >= 1 && cap <= 20, 'invalid_cap');
  requireValue(selected.length > 0 && new Set(selected).size === selected.length && selected.every(t => targets.includes(t)), 'invalid_targets');
  const now = Date.parse(asOf);
  requireValue(Number.isFinite(now), 'invalid_as_of');
  requireValue(new Set(source.accounts.map(a => a.target)).size === source.accounts.length, 'duplicate_target');
  requireValue(source.accounts.every(a => targets.includes(a.target) && a.accountId && typeof a.identityVerified === 'boolean'
    && Array.isArray(a.processed) && Array.isArray(a.unresolved)
    && [...a.processed, ...a.unresolved].every(id => typeof id === 'string' && id.trim())), 'invalid_accounts');
  requireValue(new Set(source.accounts.map(a => `${a.target.split('_')[0]}:${a.accountId}`)).size === source.accounts.length, 'shared_platform_account');
  requireValue(new Set(source.articles.map(a => a.id)).size === source.articles.length, 'duplicate_article');
  requireValue(source.articles.every(a => a.id && a.slug && safeUrl(a.canonicalUrl) && Number.isFinite(Date.parse(a.publishedAt))), 'invalid_article');
  const order = targets.filter(t => selected.includes(t));
  const articles = [...source.articles].sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt)
    || a.slug.localeCompare(b.slug, 'en') || a.id.localeCompare(b.id, 'en'));
  const items: object[] = [];
  const exclusions: { target: Target; articleId: string; reason: string }[] = [];
  const accounts = order.map(target => {
    const account = source.accounts.find(a => a.target === target);
    requireValue(account, 'missing_account');
    let count = 0;
    for (const article of articles) {
      const payload = article.payloads[target];
      let reason = '';
      if (account.processed.includes(article.id)) reason = 'already_processed';
      else if (account.unresolved.includes(article.id)) reason = 'unresolved_submission';
      else if (Date.parse(article.publishedAt) > now) reason = 'not_published_yet';
      else if (payload?.approved !== true || !payload.title?.trim() || !payload.caption?.trim()) reason = 'unapproved_or_missing_copy';
      else if (!payload.destination?.trim() || !['public', 'private'].includes(payload.visibility) || !payload.musicPolicy?.trim()) reason = 'missing_destination_policy';
      else if ((target.startsWith('tiktok') || target.startsWith('pinterest')) && !payload.media) reason = 'required_media_missing';
      else if (payload.media && (!safeUrl(payload.media.url) || !/^[a-f0-9]{64}$/.test(payload.media.sha256))) reason = 'invalid_media_reference';
      else if (count >= cap) reason = 'cap_reached';
      if (reason) { exclusions.push({ target, articleId: article.id, reason }); continue; }
      const delivery = { owner: source.owner, articleId: article.id, target, accountId: account.accountId };
      items.push({ itemId: fingerprint(delivery), ...delivery, slug: article.slug, canonicalUrl: article.canonicalUrl,
        publishedAt: article.publishedAt, sourceRevision: source.revision, payload: structuredClone(payload), payloadDigest: fingerprint(payload) });
      count++;
    }
    return { target, accountId: account.accountId, identityVerified: account.identityVerified, count };
  });
  const body = { schemaVersion: 1, mode: 'dry_run', owner: source.owner, sourceRevision: source.revision,
    snapshotDigest: fingerprint(source), asOf, cap, targetOrder: order, accounts, items, exclusions };
  return freeze({ ...body, manifestId: fingerprint(body), digest: fingerprint(body) });
}

export type Manifest = ReturnType<typeof plan>;
export type Approval = { owner: string; manifestDigest: string; approvedAt: string; expiresAt: string };
// Contract validation only. No approval endpoint or publishing operation is enabled.
export function validateApproval(manifest: Manifest, approval: Approval, now: string) {
  const { manifestId, digest, ...body } = manifest;
  requireValue(digest === fingerprint(body) && manifestId === digest, 'manifest_changed');
  requireValue(approval.owner === manifest.owner && approval.manifestDigest === digest, 'approval_mismatch');
  const start = Date.parse(approval.approvedAt), end = Date.parse(approval.expiresAt), current = Date.parse(now);
  requireValue(Number.isFinite(start) && Number.isFinite(end) && Number.isFinite(current)
    && start <= current && current < end && end > start && end - start <= 60 * 60 * 1000, 'approval_expired_or_invalid');
  requireValue(manifest.accounts.every(a => a.identityVerified), 'account_identity_unverified');
  return true;
}
