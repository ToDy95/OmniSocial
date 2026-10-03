import { blocked, commonGate, handoff, type Item, type Context } from './common.ts';
export function tiktokPersonal(item: Item, context: Context) {
  if (item.target !== 'tiktok_personal') return blocked(item, 'wrong_target');
  const gate = commonGate(item, context); if (gate) return blocked(item, gate);
  if (context.device === 'mac') return blocked(item, 'native_photo_device_required');
  if (!item.payload.media || !['png', 'jpeg'].includes(context.mediaFormat ?? '')) return blocked(item, 'photo_format_acceptance_required');
  if (item.payload.title.length > 90 || item.payload.caption.length > 4000) return blocked(item, 'copy_limit_exceeded');
  if (!['public', 'private'].includes(item.payload.visibility)) return blocked(item, 'visibility_required');
  if (!/^(none|original_owned|licensed:[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+)$/.test(item.payload.musicPolicy)) return blocked(item, 'exact_music_rights_required');
  const disclosures = item.payload.disclosures;
  if (!disclosures || Object.values(disclosures).some(v => typeof v !== 'boolean')) return blocked(item, 'disclosures_required');
  return handoff(item, context, 'TikTok native photo composer', [
    'Verify the displayed personal identity and approved photo.',
    'Use exact title/caption and the approved sound/visibility/disclosures.',
    'Owner submits in the native app; do not treat upload or toast as public.',
    'Return the canonical photo URL and matching public/review evidence for reconciliation.'
  ]);
}
