import { blocked, commonGate, handoff, type Item, type Context } from './common.ts';
export function pinterest(item: Item, context: Context) {
  if (!['pinterest_personal', 'pinterest_business'].includes(item.target)) return blocked(item, 'wrong_target');
  const gate = commonGate(item, context); if (gate) return blocked(item, gate);
  if (!item.payload.destination || context.boardId !== item.payload.destination || !context.boardWritable || !context.boardPublic) return blocked(item, 'owned_public_board_required');
  if (!item.payload.media || !['png', 'jpeg'].includes(context.mediaFormat ?? '')) return blocked(item, 'image_acceptance_required');
  if (item.payload.title.length > 100 || item.payload.caption.length > 800 || !item.payload.title.trim()) return blocked(item, 'pin_copy_review_required');
  let link: URL;
  try { link = new URL(item.canonicalUrl); } catch { return blocked(item, 'article_link_invalid'); }
  if (link.protocol !== 'https:' || link.hostname !== 'www.razvantodica.com' || link.username || link.password || !link.pathname.startsWith('/blog/')) return blocked(item, 'article_link_invalid');
  if (item.payload.visibility !== 'public') return blocked(item, 'public_destination_required');
  return handoff(item, context, 'https://www.pinterest.com/pin-builder/', [
    'Owner verifies the separate Personal/Business identity and approved writable public board.',
    'Use exact photo, title, description and canonical article link.',
    'Owner creates one Pin; no API or website automation is performed.',
    'Return a matching public Pin URL and board/account/content evidence for reconciliation.'
  ]);
}
