import { fingerprint } from '../planner.ts';
export type Item = { itemId: string; target: string; accountId: string; payloadDigest: string;
  canonicalUrl: string; payload: { title: string; caption: string; media: { url: string; sha256: string } | null;
    destination: string; visibility: string; musicPolicy: string;
    disclosures?: { ownBrand: boolean; paidPartnership: boolean; aiGenerated: boolean };
    postType?: 'image' | 'text'; flair?: string | null } };
export type Context = { mode: 'dry_run' | 'publish'; now: string; observedAt: string;
  accountId: string; identityVerified: boolean; loginStatus: 'valid' | 'expired' | 'challenge';
  mediaDigest: string | null; mediaFormat: string | null; device: 'iphone' | 'android' | 'mac';
  transport: 'assisted' | 'api'; rulesReviewed?: boolean; boardId?: string; boardWritable?: boolean;
  boardPublic?: boolean; flair?: string; postType?: 'image' | 'text'; weightedLength?: number; soundRightsVerified?: boolean; mediaBytes?: number };
export type Decision = { status: 'blocked' | 'dry_run_validated' | 'awaiting_owner'; reason?: string;
  automatedSubmission: false; target: string; itemId: string; handoff?: { destination: string; steps: string[]; package: Item } };
export function blocked(item: Item, reason: string): Decision {
  return { status: 'blocked', reason, automatedSubmission: false, target: item.target, itemId: item.itemId };
}
export function commonGate(item: Item, context: Context): string | null {
  if (!['dry_run', 'publish'].includes(context.mode)) return 'invalid_mode';
  if (context.transport !== 'assisted') return 'api_transport_not_enabled';
  if (context.loginStatus !== 'valid') return 'interactive_login_required';
  const age = Date.parse(context.now) - Date.parse(context.observedAt);
  if (!Number.isFinite(age) || age < 0 || age > 5 * 60 * 1000 || !context.identityVerified || context.accountId !== item.accountId) return 'fresh_matching_identity_required';
  if (fingerprint(item.payload) !== item.payloadDigest) return 'payload_changed';
  if (item.payload.media && item.payload.media.sha256 !== context.mediaDigest) return 'media_changed';
  return null;
}
export function handoff(item: Item, context: Context, destination: string, steps: string[]): Decision {
  return { status: context.mode === 'dry_run' ? 'dry_run_validated' : 'awaiting_owner', automatedSubmission: false,
    target: item.target, itemId: item.itemId,
    ...(context.mode === 'publish' ? { handoff: { destination, steps, package: structuredClone(item) } } : {}) };
}
