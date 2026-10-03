import { blocked, commonGate, handoff, type Item, type Context } from './common.ts';
export function reddit(item: Item, context: Context) {
  if (item.target !== 'reddit') return blocked(item, 'wrong_target');
  const gate = commonGate(item, context); if (gate) return blocked(item, gate);
  if (!/^r\/[a-zA-Z0-9_]{3,21}$/.test(item.payload.destination) || !context.rulesReviewed) return blocked(item, 'subreddit_rules_review_required');
  if (!['image', 'text'].includes(item.payload.postType ?? '') || context.postType !== item.payload.postType
    || (context.flair ?? null) !== (item.payload.flair ?? null)) return blocked(item, 'post_type_or_flair_changed');
  if (item.payload.title.length > 300 || item.payload.caption.length > 40000 || /[\r\n]/.test(item.payload.title)) return blocked(item, 'copy_limit_exceeded');
  if (item.payload.visibility !== 'public') return blocked(item, 'public_destination_required');
  if (item.payload.postType === 'image' && (!item.payload.media || !['png', 'jpeg'].includes(context.mediaFormat ?? ''))) return blocked(item, 'image_acceptance_required');
  return handoff(item, context, `https://www.reddit.com/${item.payload.destination}/submit`, [
    'Verify the approved subreddit, displayed account, community rules, post type and flair.',
    'Owner enters the exact approved title/caption and uploads approved media when required.',
    'Owner submits once; moderation pending remains pending, never public by assumption.',
    'Return a matching comments permalink with public/moderation evidence for reconciliation.'
  ]);
}
