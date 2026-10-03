import { blocked, commonGate, handoff, type Item, type Context } from './common.ts';
// Conservative bound: do not infer entitlement, shorten links or truncate copy.
export function conservativeXLength(text: string) {
  return [...text].reduce((length, character) => length + (character.codePointAt(0)! <= 0x7f ? 1 : 2), 0);
}
export function x(item: Item, context: Context) {
  if (item.target !== 'x') return blocked(item, 'wrong_target');
  const gate = commonGate(item, context); if (gate) return blocked(item, gate);
  if (!item.payload.caption.trim() || conservativeXLength(item.payload.caption) > 280) return blocked(item, 'compact_copy_review_required');
  if (item.payload.visibility !== 'public') return blocked(item, 'public_destination_required');
  if (item.payload.media && (!['png', 'jpeg'].includes(context.mediaFormat ?? '') || !context.mediaBytes || context.mediaBytes > 5 * 1024 * 1024)) return blocked(item, 'image_acceptance_required');
  return handoff(item, context, 'https://x.com/compose/post', [
    'Owner opens the composer and verifies the displayed account.',
    'Use exact approved compact caption and optional approved image; no silent shortening.',
    'Owner submits once. No website scripting or API call is performed by this adapter.',
    'Return the canonical status URL with matching account/content/media/public evidence.'
  ]);
}
