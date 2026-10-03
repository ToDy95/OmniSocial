import { blocked, commonGate, handoff, type Item, type Context } from './common.ts';
const desktopComposer = 'https://www.tiktok.com/tiktokstudio/upload?from=creator_center&tab=photo';
function photoGate(item: Item, context: Context) {
  if (context.device === 'mac' && !context.desktopPhotoUploadVerified) return 'desktop_photo_capability_required';
  const formats = context.device === 'mac' ? ['png', 'jpeg', 'webp'] : ['png', 'jpeg'];
  if (!item.payload.media || !formats.includes(context.mediaFormat ?? '')) return 'photo_format_acceptance_required';
  return null;
}
export function tiktokPersonal(item: Item, context: Context) {
  if (item.target !== 'tiktok_personal') return blocked(item, 'wrong_target');
  const gate = commonGate(item, context); if (gate) return blocked(item, gate);
  const photo = photoGate(item, context); if (photo) return blocked(item, photo);
  if (item.payload.title.length > 90 || item.payload.caption.length > 4000) return blocked(item, 'copy_limit_exceeded');
  if (!['public', 'private'].includes(item.payload.visibility)) return blocked(item, 'visibility_required');
  if (!/^(none|original_owned|licensed:[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+)$/.test(item.payload.musicPolicy)) return blocked(item, 'exact_music_rights_required');
  if (item.payload.musicPolicy !== 'none' && !context.soundRightsVerified) return blocked(item, 'sound_rights_verification_required');
  const disclosures = item.payload.disclosures;
  if (!disclosures || (['ownBrand', 'paidPartnership', 'aiGenerated'] as const).some(key => typeof disclosures[key] !== 'boolean')) return blocked(item, 'disclosures_required');
  return handoff(item, context, context.device === 'mac' ? desktopComposer : 'TikTok native photo composer', [
    'Verify the displayed personal identity and approved photo.',
    'Use exact title/caption and the approved sound/visibility/disclosures.',
    'Owner verifies composer controls and submits in TikTok; do not treat upload or toast as public.',
    'Return the canonical photo URL and matching public/review evidence for reconciliation.'
  ]);
}

export function tiktokBusiness(item: Item, context: Context & { accountTypeVerified: boolean; commercialRightsVerified: boolean }) {
  if (item.target !== 'tiktok_codeonroids') return blocked(item, 'wrong_target');
  const gate = commonGate(item, context); if (gate) return blocked(item, gate);
  if (!context.accountTypeVerified) return blocked(item, 'business_account_type_required');
  const photo = photoGate(item, context); if (photo) return blocked(item, photo);
  if (item.payload.title.length > 90 || item.payload.caption.length > 4000) return blocked(item, 'copy_limit_exceeded');
  if (!['public', 'private'].includes(item.payload.visibility)) return blocked(item, 'visibility_required');
  if (item.payload.musicPolicy !== 'none' && (!/^(cml|licensed):[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+$/.test(item.payload.musicPolicy)
    || !context.commercialRightsVerified)) return blocked(item, 'commercial_music_rights_required');
  const disclosures = item.payload.disclosures;
  if (!disclosures || (['ownBrand', 'paidPartnership', 'aiGenerated'] as const).some(key => typeof disclosures[key] !== 'boolean')) return blocked(item, 'disclosures_required');
  return handoff(item, context, context.device === 'mac' ? desktopComposer : 'TikTok native Business photo composer', [
    'Verify the separate Business identity, approved photo and account type.',
    'Use exact title/caption, approved commercial sound, visibility and brand/AI disclosures.',
    'Owner verifies composer controls and submits in TikTok; retain a matching public/review receipt.',
    'Reconcile Business history independently from Personal; never retry uncertain submissions.'
  ]);
}
