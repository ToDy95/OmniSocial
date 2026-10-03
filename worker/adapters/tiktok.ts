import { blocked, commonGate, handoff, type Item, type Context } from './common.ts';
export function tiktokPersonal(item: Item, context: Context) {
  if (item.target !== 'tiktok_personal') return blocked(item, 'wrong_target');
  const gate = commonGate(item, context); if (gate) return blocked(item, gate);
  if (context.device === 'mac') return blocked(item, 'native_photo_device_required');
  if (!item.payload.media || !['png', 'jpeg'].includes(context.mediaFormat ?? '')) return blocked(item, 'photo_format_acceptance_required');
  if (item.payload.title.length > 90 || item.payload.caption.length > 4000) return blocked(item, 'copy_limit_exceeded');
  if (!['public', 'private'].includes(item.payload.visibility)) return blocked(item, 'visibility_required');
  if (!/^(none|original_owned|licensed:[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+)$/.test(item.payload.musicPolicy)) return blocked(item, 'exact_music_rights_required');
  if (item.payload.musicPolicy !== 'none' && !context.soundRightsVerified) return blocked(item, 'sound_rights_verification_required');
  const disclosures = item.payload.disclosures;
  if (!disclosures || ['ownBrand', 'paidPartnership', 'aiGenerated'].some(key => typeof disclosures[key] !== 'boolean')) return blocked(item, 'disclosures_required');
  return handoff(item, context, 'TikTok native photo composer', [
    'Verify the displayed personal identity and approved photo.',
    'Use exact title/caption and the approved sound/visibility/disclosures.',
    'Owner submits in the native app; do not treat upload or toast as public.',
    'Return the canonical photo URL and matching public/review evidence for reconciliation.'
  ]);
}

export function tiktokBusiness(item: Item, context: Context & { accountTypeVerified: boolean; commercialRightsVerified: boolean }) {
  if (item.target !== 'tiktok_codeonroids') return blocked(item, 'wrong_target');
  const gate = commonGate(item, context); if (gate) return blocked(item, gate);
  if (!context.accountTypeVerified) return blocked(item, 'business_account_type_required');
  if (context.device === 'mac') return blocked(item, 'native_photo_device_required');
  if (!item.payload.media || !['png', 'jpeg'].includes(context.mediaFormat ?? '')) return blocked(item, 'photo_format_acceptance_required');
  if (item.payload.title.length > 90 || item.payload.caption.length > 4000) return blocked(item, 'copy_limit_exceeded');
  if (!['public', 'private'].includes(item.payload.visibility)) return blocked(item, 'visibility_required');
  if (item.payload.musicPolicy !== 'none' && (!/^(cml|licensed):[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+$/.test(item.payload.musicPolicy)
    || !context.commercialRightsVerified)) return blocked(item, 'commercial_music_rights_required');
  const disclosures = item.payload.disclosures;
  if (!disclosures || ['ownBrand', 'paidPartnership', 'aiGenerated'].some(key => typeof disclosures[key] !== 'boolean')) return blocked(item, 'disclosures_required');
  return handoff(item, context, 'TikTok native Business photo composer', [
    'Verify the separate Business identity, approved photo and account type.',
    'Use exact title/caption, approved commercial sound, visibility and brand/AI disclosures.',
    'Owner submits in the native app; retain a matching public/review receipt.',
    'Reconcile Business history independently from Personal; never retry uncertain submissions.'
  ]);
}
