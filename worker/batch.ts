import { fingerprint, type Manifest } from './planner.ts';
import { targets } from './local.ts';
import { type Item, type Context, type Decision, blocked } from './adapters/common.ts';
import { tiktokPersonal, tiktokBusiness } from './adapters/tiktok.ts';
import { reddit } from './adapters/reddit.ts';
import { x } from './adapters/x.ts';
import { pinterest } from './adapters/pinterest.ts';
export type Observation = Context & { accountTypeVerified: boolean; commercialRightsVerified: boolean };
export function dispatch(item: Item, context: Observation): Decision {
  switch (item.target) {
    case 'tiktok_personal': return tiktokPersonal(item, context);
    case 'tiktok_codeonroids': return tiktokBusiness(item, context);
    case 'reddit': return reddit(item, context);
    case 'x': return x(item, context);
    case 'pinterest_personal': case 'pinterest_business': return pinterest(item, context);
    default: return blocked(item, 'target_unavailable');
  }
}
export async function dryRunBatch(manifest: Manifest, observe: (item: Item) => Promise<Observation>) {
  const { manifestId, digest, ...body } = manifest;
  if (fingerprint(body) !== digest || manifestId !== digest) throw new Error('manifest_changed');
  const order = targets.filter(t => manifest.targetOrder.includes(t));
  if (JSON.stringify(order) !== JSON.stringify(manifest.targetOrder) || new Set((manifest.items as Item[]).map(i => i.itemId)).size !== manifest.items.length) throw new Error('invalid_batch_scope');
  const rows: Decision[] = [];
  let stopped = false;
  for (const target of order) {
    const items = (manifest.items as Item[]).filter(item => item.target === target);
    if (items.length > manifest.cap) throw new Error('batch_cap_exceeded');
    for (const item of items) {
      if (stopped) { rows.push(blocked(item, 'prior_identity_or_login_stop')); continue; }
      const decision = dispatch(item, { ...await observe(item), mode: 'dry_run' });
      rows.push(decision);
      if (['interactive_login_required', 'fresh_matching_identity_required'].includes(decision.reason ?? '')) stopped = true;
    }
  }
  if (rows.length !== manifest.items.length) throw new Error('unscoped_batch_items');
  return { mode: 'dry_run', manifestId, requested: rows.length, validated: rows.filter(r => r.status === 'dry_run_validated').length,
    blocked: rows.filter(r => r.status === 'blocked').length, verifiedPublic: 0, submitted: 0, skipped: 0, rows };
}
export function reportCSV(rows: Decision[]) {
  function field(value: string) { const safe = /^[=+@\-\t\r]/.test(value) ? `'${value}` : value; return `"${safe.replaceAll('"', '""')}"`; }
  return ['itemId,target,status,reason,automatedSubmission', ...rows.map(r => [r.itemId, r.target, r.status, r.reason ?? '', 'false'].map(field).join(','))].join('\r\n') + '\r\n';
}
