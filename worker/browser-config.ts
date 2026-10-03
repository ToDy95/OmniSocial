import { join } from 'node:path';
import { protectedJSON } from './source.ts';
import { root, targets } from './local.ts';
import type { Target } from './planner.ts';

export const portfolioOrigin = 'https://www.razvantodica.com';
export const providerOrigins: Record<Target, string> = {
  tiktok_personal: 'https://www.tiktok.com', tiktok_codeonroids: 'https://www.tiktok.com',
  reddit: 'https://www.reddit.com', x: 'https://x.com',
  pinterest_personal: 'https://www.pinterest.com', pinterest_business: 'https://www.pinterest.com',
};
export const composers: Record<Target, string> = {
  tiktok_personal: '/tiktokstudio/upload?from=creator_center&tab=photo',
  tiktok_codeonroids: '/tiktokstudio/upload?from=creator_center&tab=photo',
  reddit: '/submit', x: '/compose/post',
  pinterest_personal: '/pin-builder/', pinterest_business: '/pin-builder/',
};
export type Controls = {
  identity: string; identityAttribute?: string;
  upload: string; caption: string; title?: string; link?: string;
  destination?: string; destinationOption?: string; destinationReadback?: string;
  publicControl?: string; publicOption?: string; publicReadback: string; publicText: string;
  ownBrand?: string; paidPartnership?: string; aiGenerated?: string;
  submit: string; receiptLink: string; receiptText: string; receiptImage: string;
  receiptAccount: string; receiptAccountAttribute?: string;
  receiptTitle?: string; receiptSound?: string; receiptExpand?: string;
  flair?: string; flairOption?: string; flairReadback?: string;
  receiptDestination?: string;
  musicOpen?: string; musicTrending?: string; musicRows?: string;
  musicName?: string; musicUse?: string; musicSelected?: string;
  musicClear?: string; musicEmpty?: string;
  readyMedia: string;
  postTypeTabs?: { image: string; text: string };
};
export type BrowserAccount = {
  handle: string; identityUrl: string; destination: string;
  visibility: 'public'; musicPolicy: 'none' | 'random_trending_top10';
  disclosures?: { ownBrand: boolean; paidPartnership: boolean; aiGenerated: boolean };
  postType?: 'image' | 'text'; flair?: string | null;
  destinationByCategory?: Record<string, { destination: string; postType?: 'image' | 'text'; flair?: string | null }>;
  controls?: Controls;
};
export type BrowserConfig = {
  schemaVersion: 1; owner: string; selected: Target[]; cap: number;
  allowedMediaOrigins: string[]; accounts: Partial<Record<Target, BrowserAccount>>;
};
export function readBrowserConfig(): BrowserConfig {
  const config: BrowserConfig = protectedJSON(join(root, 'runtime/browser/config.json'));
  if (config.schemaVersion !== 1 || typeof config.owner !== 'string' || !config.owner.trim()
    || !Array.isArray(config.selected) || !config.selected.length
    || new Set(config.selected).size !== config.selected.length
    || config.selected.some(t => !targets.includes(t))
    || !Number.isInteger(config.cap) || config.cap < 1 || config.cap > 200
    || !Array.isArray(config.allowedMediaOrigins) || !config.allowedMediaOrigins.length) throw new Error('browser_config_invalid');
  for (const origin of config.allowedMediaOrigins) {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password) throw new Error('media_origin_invalid');
  }
  for (const target of config.selected) {
    const account = config.accounts[target];
    if (!account || !/^(@|u\/)[a-zA-Z0-9_.-]+$/.test(account.handle)
      || account.visibility !== 'public' || !['none', 'random_trending_top10'].includes(account.musicPolicy)) throw new Error('account_configuration_required');
    const identity = new URL(account.identityUrl);
    if (identity.origin !== providerOrigins[target] || identity.username || identity.password) throw new Error('identity_origin_invalid');
    if (target.startsWith('pinterest')) {
      const board = new URL(account.destination);
      if (!['https://www.pinterest.com', 'https://ro.pinterest.com'].includes(board.origin)
        || board.pathname.split('/').filter(Boolean).length !== 2 || board.username || board.password
        || board.pathname.split('/')[1]?.toLowerCase() !== account.handle.slice(1).toLowerCase()) throw new Error('board_mapping_invalid');
    } else if (target === 'reddit') {
      const routes = Object.entries(account.destinationByCategory ?? {});
      if (routes.length > 100 || routes.some(([prefix, route]) => !/^[a-z0-9-]+$/.test(prefix)
        || !/^r\/[a-zA-Z0-9_]{2,40}$/.test(route.destination))) throw new Error('reddit_category_mapping_invalid');
      if (!/^r\/[a-zA-Z0-9_]{2,40}$/.test(account.destination) && !routes.length) throw new Error('reddit_destination_required');
    } else if (account.destination !== account.handle) throw new Error('account_destination_mismatch');
    if (target.startsWith('tiktok') && !account.disclosures) throw new Error('disclosures_required');
    if (!target.startsWith('tiktok') && account.musicPolicy !== 'none') throw new Error('music_target_invalid');
  }
  return config;
}
export function requireControls(account: BrowserAccount): Controls {
  const controls = account.controls;
  for (const name of ['identity', 'upload', 'caption', 'publicReadback', 'publicText', 'submit',
    'receiptLink', 'receiptText', 'receiptImage', 'receiptAccount', 'readyMedia'] as const) {
    if (!controls || typeof controls[name] !== 'string' || !controls[name].trim()) throw new Error('ui_calibration_required');
  }
  return controls!;
}
