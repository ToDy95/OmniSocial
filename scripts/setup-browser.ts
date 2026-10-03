import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { protectDirectory, root, setupLocal } from '../worker/local.ts';
import type { BrowserConfig } from '../worker/browser-config.ts';

setupLocal();
protectDirectory(join(root, 'runtime/browser'));
const path = join(root, 'runtime/browser/config.json');
const config: BrowserConfig = {
  schemaVersion: 1, owner: 'portfolio-owner', selected: ['tiktok_codeonroids'], cap: 200,
  allowedMediaOrigins: [],
  accounts: {
    tiktok_personal: { handle: '@todicarazvan95', identityUrl: 'https://www.tiktok.com/tiktokstudio',
      destination: '@todicarazvan95', visibility: 'public', musicPolicy: 'random_trending_top10',
      disclosures: { ownBrand: true, paidPartnership: false, aiGenerated: true } },
    tiktok_codeonroids: { handle: '@code.on.roids', identityUrl: 'https://www.tiktok.com/tiktokstudio',
      destination: '@code.on.roids', visibility: 'public', musicPolicy: 'random_trending_top10',
      disclosures: { ownBrand: true, paidPartnership: false, aiGenerated: true } },
    x: { handle: '@RazvanTodica', identityUrl: 'https://x.com/home', destination: '@RazvanTodica', visibility: 'public', musicPolicy: 'none' },
    reddit: { handle: 'u/Inner_Student_5236', identityUrl: 'https://www.reddit.com/', destination: '', visibility: 'public', musicPolicy: 'none', postType: 'image' },
    pinterest_personal: { handle: '@todyimmortal', identityUrl: 'https://www.pinterest.com/settings/edit-profile/',
      destination: 'https://ro.pinterest.com/todyimmortal/codeonroids/', visibility: 'public', musicPolicy: 'none' },
    pinterest_business: { handle: '@codeonroids', identityUrl: 'https://www.pinterest.com/settings/edit-profile/',
      destination: 'https://ro.pinterest.com/codeonroids/codeonroids/', visibility: 'public', musicPolicy: 'none' },
  },
};
if (!existsSync(path)) writeFileSync(path, JSON.stringify(config, null, 2), { flag: 'wx', mode: 0o600 });
console.log('Protected browser configuration ready. Existing choices preserved. Source media origin and observed UI controls still need calibration; no submission enabled.');
