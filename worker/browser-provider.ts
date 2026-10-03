import { randomInt, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { chromium, type Page, type Locator } from 'playwright';
import { fingerprint, type Target } from './planner.ts';
import { providerOrigins, composers, requireControls, type BrowserAccount, type Controls } from './browser-config.ts';
import { assertSession, BrowserSessions, BrowserStop, one } from './browser-session.ts';
import type { BrowserItem } from './browser-source.ts';

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
const destinationName = (text: string) => normalize(text).replace(/^r\//i, '').toLowerCase();
const cssValue = (text: string) => text.replace(/[^a-zA-Z0-9_-]/g, char => `\\${char.codePointAt(0)!.toString(16)} `);
export function sameIdentity(observed: string, expected: string) {
  let value = observed.trim();
  try { const url = new URL(value); value = decodeURIComponent(url.pathname).split('/').filter(Boolean).at(-1) ?? ''; } catch {}
  return value.replace(/^(@|u\/)/, '').toLowerCase() === expected.replace(/^(@|u\/)/, '').toLowerCase();
}
export function receiptURL(value: string, item: BrowserItem): string {
  const url = new URL(value);
  const target = item.target as Target;
  if (url.origin !== providerOrigins[target] || url.username || url.password || url.hash || url.search) throw new BrowserStop('receipt_url_invalid');
  if (target.startsWith('tiktok')) {
    if (!/^\/@[a-zA-Z0-9_.-]+\/(video|photo)\/\d+\/?$/.test(url.pathname)
      || !sameIdentity(url.pathname.split('/')[1]!, item.accountId)) throw new BrowserStop('receipt_account_mismatch');
  } else if (target === 'x') {
    if (!/^\/[a-zA-Z0-9_]+\/status\/\d+\/?$/.test(url.pathname)
      || !sameIdentity(url.pathname.split('/')[1]!, item.accountId)) throw new BrowserStop('receipt_account_mismatch');
  } else if (target === 'reddit') {
    if (!/^\/r\/[a-zA-Z0-9_]+\/comments\/[a-zA-Z0-9]+\/[^/]*\/?$/.test(url.pathname)
      || url.pathname.split('/').slice(1, 3).join('/').toLowerCase() !== item.payload.destination.toLowerCase()) throw new BrowserStop('receipt_destination_mismatch');
  } else if (!/^\/pin\/\d+\/$/.test(url.pathname)) throw new BrowserStop('receipt_url_invalid');
  return url.href;
}
async function fieldText(locator: Locator) {
  return locator.evaluate(element => element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
    ? element.value : (element as HTMLElement).innerText);
}
export async function imageDistance(original: Buffer, screenshot: Buffer) {
  async function signature(bytes: Buffer) {
    return sharp(bytes).flatten({ background: '#ffffff' }).resize(9, 8, { fit: 'fill' }).greyscale().raw().toBuffer();
  }
  const [a, b] = await Promise.all([signature(original), signature(screenshot)]);
  const [colorsA, colorsB] = await Promise.all([original, screenshot].map(bytes => sharp(bytes).flatten({ background: '#ffffff' }).resize(16, 16, { fit: 'fill' }).removeAlpha().raw().toBuffer()));
  const averageError = colorsA.reduce((sum, value, index) => sum + Math.abs(value - colorsB[index]!), 0) / colorsA.length;
  if (averageError > 16) return 64;
  let distance = 0;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const offset = y * 9 + x;
    if ((a[offset]! > a[offset + 1]!) !== (b[offset]! > b[offset + 1]!)) distance++;
  }
  return distance;
}
export class BrowserProvider {
  readonly sessions: BrowserSessions;
  constructor(sessions: BrowserSessions) { this.sessions = sessions; }
  async identity(target: Target, account: BrowserAccount) {
    const page = await this.sessions.identityPage(target);
    await page.goto(account.identityUrl, { waitUntil: 'domcontentloaded' });
    await assertSession(page, providerOrigins[target]);
    const controls = requireControls(account);
    const locator = await one(page, controls.identity);
    const observed = controls.identityAttribute ? await locator.getAttribute(controls.identityAttribute) : await locator.innerText();
    if (!observed || !sameIdentity(observed, account.handle)) throw new BrowserStop('active_account_mismatch', target);
    return { accountId: account.handle, observedAt: new Date().toISOString() };
  }
  async composer(item: BrowserItem, account: BrowserAccount, mediaPath: string | null) {
    const target = item.target as Target;
    const controls = requireControls(account);
    const page = await this.sessions.page(target);
    await page.goto(`${providerOrigins[target]}${composers[target]}`, { waitUntil: 'domcontentloaded' });
    await assertSession(page, providerOrigins[target]);
    if (target.startsWith('tiktok')) {
      const photos = page.getByRole('tab', { name: 'Photos', exact: true });
      if (await photos.count() === 1) await photos.click();
      if (await photos.count() !== 1 || await photos.getAttribute('aria-selected') !== 'true') throw new BrowserStop('desktop_photos_unavailable', target);
    }
    if (target === 'reddit') {
      const selector = item.payload.postType && controls.postTypeTabs?.[item.payload.postType];
      if (!selector) throw new BrowserStop('post_type_ui_calibration_required', target);
      const tab = await one(page, selector);
      await tab.click();
      if (await tab.getAttribute('aria-selected') !== 'true') throw new BrowserStop('post_type_readback_mismatch', target);
    }
    if (mediaPath) {
      const input = page.locator(controls.upload);
      if (await input.count() !== 1 || await input.getAttribute('type') !== 'file') throw new BrowserStop('upload_control_changed', target);
      await input.setInputFiles(mediaPath);
      await page.locator(controls.readyMedia).waitFor({ state: 'visible', timeout: 60_000 });
      const preview = await one(page, controls.readyMedia);
      if (await imageDistance(readFileSync(mediaPath), await preview.screenshot()) > 6) throw new BrowserStop('uploaded_media_mismatch', target);
    }
    if (controls.title) await (await one(page, controls.title)).fill(item.payload.title);
    else if (target !== 'x') throw new BrowserStop('title_control_missing', target);
    await (await one(page, controls.caption)).fill(item.payload.caption);
    if (target.startsWith('pinterest')) {
      if (!controls.link) throw new BrowserStop('pin_link_control_missing', target);
      await (await one(page, controls.link)).fill(item.canonicalUrl);
    }
    if (target === 'reddit' || target.startsWith('pinterest')) {
      if (!controls.destination || !controls.destinationOption || !controls.destinationReadback) throw new BrowserStop('destination_control_missing', target);
      await (await one(page, controls.destination)).click();
      const destination = target === 'reddit' ? item.payload.destination : new URL(item.payload.destination).pathname.split('/').filter(Boolean).at(-1)!;
      const option = await one(page, controls.destinationOption.replaceAll('{destination}', cssValue(destination)));
      if (destinationName(await option.innerText()) !== destinationName(destination)) throw new BrowserStop('destination_option_mismatch', target);
      await option.click();
      if (destinationName(await (await one(page, controls.destinationReadback)).innerText()) !== destinationName(destination)) throw new BrowserStop('destination_readback_mismatch', target);
      if (target === 'reddit' && item.payload.flair) {
        if (!controls.flair || !controls.flairOption || !controls.flairReadback) throw new BrowserStop('flair_ui_calibration_required', target);
        await (await one(page, controls.flair)).click();
        const option = await one(page, controls.flairOption);
        if (normalize(await option.innerText()) !== item.payload.flair) throw new BrowserStop('flair_option_mismatch', target);
        await option.click();
        if (normalize(await (await one(page, controls.flairReadback)).innerText()) !== item.payload.flair) throw new BrowserStop('flair_readback_mismatch', target);
      }
    }
    const sound = target.startsWith('tiktok') ? await this.music(page, controls, item.payload.musicPolicy) : null;
    if (controls.publicControl) {
      await (await one(page, controls.publicControl)).click();
      if (!controls.publicOption) throw new BrowserStop('public_option_missing');
      await (await one(page, controls.publicOption)).click();
    }
    const disclosure = item.payload.disclosures;
    if (disclosure) {
      for (const key of ['ownBrand', 'paidPartnership', 'aiGenerated'] as const) {
        if (!controls[key]) throw new BrowserStop('disclosure_control_missing', target);
        const field = await one(page, controls[key]!);
        await field.setChecked(disclosure[key]);
        if (await field.isChecked() !== disclosure[key]) throw new BrowserStop('disclosure_readback_mismatch', target);
      }
    }
    await this.checkComposer(page, controls, item);
    const links = await page.locator(controls.receiptLink).evaluateAll(elements => elements.map(e => e.getAttribute('href')).filter((v): v is string => Boolean(v)));
    return { page, sound, previousLinks: links };
  }
  async checkComposer(page: Page, controls: Controls, item: BrowserItem) {
    await assertSession(page, providerOrigins[item.target as Target]);
    if (normalize(await fieldText(await one(page, controls.caption))) !== normalize(item.payload.caption)
      || controls.title && normalize(await fieldText(await one(page, controls.title))) !== normalize(item.payload.title)
      || normalize(await (await one(page, controls.publicReadback)).innerText()) !== controls.publicText) throw new BrowserStop('composer_payload_or_visibility_changed', item.target);
    if (controls.link && await fieldText(await one(page, controls.link)) !== item.canonicalUrl) throw new BrowserStop('composer_link_changed', item.target);
    if (item.target === 'reddit' || item.target.startsWith('pinterest')) {
      const destination = item.target === 'reddit' ? item.payload.destination : new URL(item.payload.destination).pathname.split('/').filter(Boolean).at(-1)!;
      if (!controls.destinationReadback || destinationName(await (await one(page, controls.destinationReadback)).innerText()) !== destinationName(destination)) throw new BrowserStop('destination_readback_mismatch', item.target);
      if (item.target === 'reddit') {
        const selector = item.payload.postType && controls.postTypeTabs?.[item.payload.postType];
        if (!selector || await (await one(page, selector)).getAttribute('aria-selected') !== 'true') throw new BrowserStop('post_type_readback_mismatch', item.target);
        if (item.payload.flair && (!controls.flairReadback || normalize(await (await one(page, controls.flairReadback)).innerText()) !== item.payload.flair)) throw new BrowserStop('flair_readback_mismatch', item.target);
      }
    }
    const submit = await one(page, controls.submit);
    const allowed = item.target.startsWith('pinterest') ? ['Publish', 'Publish Pin'] : ['Post'];
    if (!allowed.includes(normalize(await submit.innerText()))) throw new BrowserStop('submit_control_changed', item.target);
    if (!await submit.isEnabled()) throw new BrowserStop('submit_unavailable', item.target);
  }
  private async music(page: Page, controls: Controls, policy: string): Promise<string | null> {
    if (policy === 'none') {
      if (!controls.musicEmpty) throw new BrowserStop('music_controls_unavailable');
      if (controls.musicClear && await page.locator(controls.musicClear).isVisible()) await (await one(page, controls.musicClear)).click();
      await one(page, controls.musicEmpty);
      return null;
    }
    if (policy !== 'random_trending_top10' || !controls.musicOpen || !controls.musicTrending || !controls.musicRows
      || !controls.musicName || !controls.musicUse || !controls.musicSelected) throw new BrowserStop('trending_music_controls_unavailable');
    await (await one(page, controls.musicOpen)).click();
    await (await one(page, controls.musicTrending)).click();
    const rows = page.locator(controls.musicRows);
    const count = Math.min(await rows.count(), 10);
    if (!count) throw new BrowserStop('trending_music_empty');
    const row = rows.nth(randomInt(count));
    const name = (await row.locator(controls.musicName).innerText()).trim();
    const use = row.locator(controls.musicUse);
    if (!name || await use.count() !== 1 || !await use.isVisible()) throw new BrowserStop('trending_music_ui_changed');
    await use.click();
    if (normalize(await (await one(page, controls.musicSelected)).innerText()) !== normalize(name)) throw new BrowserStop('music_selection_changed');
    return name;
  }
  async submit(page: Page, item: BrowserItem, account: BrowserAccount, sound: string | null, beforeClick: () => void) {
    const controls = requireControls(account);
    await this.checkComposer(page, controls, item);
    if (item.target.startsWith('tiktok')) {
      if (sound) {
        if (!controls.musicSelected || normalize(await (await one(page, controls.musicSelected)).innerText()) !== normalize(sound)) throw new BrowserStop('music_selection_changed');
      } else if (!controls.musicEmpty || !await (await one(page, controls.musicEmpty)).isVisible()) throw new BrowserStop('music_selection_changed');
    }
    if (item.payload.disclosures) for (const key of ['ownBrand', 'paidPartnership', 'aiGenerated'] as const) {
      if (!controls[key] || await (await one(page, controls[key]!)).isChecked() !== item.payload.disclosures[key]) throw new BrowserStop('disclosure_readback_mismatch');
    }
    const button = await one(page, controls.submit);
    beforeClick();
    await button.click({ timeout: 15_000 });
  }
  async resultURL(page: Page, item: BrowserItem, account: BrowserAccount, previousLinks: string[]) {
    const controls = requireControls(account);
    await page.locator(controls.receiptLink).first().waitFor({ timeout: 60_000 });
    await assertSession(page, providerOrigins[item.target as Target]);
    const hrefs = await page.locator(controls.receiptLink).evaluateAll(elements => elements.map(e => e.getAttribute('href')).filter((v): v is string => Boolean(v)));
    const fresh = hrefs.filter(href => !previousLinks.includes(href));
    const valid: string[] = [];
    for (const href of fresh) {
      try { valid.push(receiptURL(new URL(href, providerOrigins[item.target as Target]).href, item)); } catch {}
    }
    if (new Set(valid).size !== 1) throw new BrowserStop('publication_outcome_uncertain', item.target);
    return valid[0]!;
  }
  async verify(item: BrowserItem, account: BrowserAccount, url: string, mediaPath: string | null, runId: string, sound: string | null) {
    const verifiedURL = receiptURL(url, item);
    const controls = requireControls(account);
    // Public means readable in a fresh unauthenticated context, not an owner dashboard.
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ locale: 'en-US' });
      const page = await context.newPage();
      await page.goto(verifiedURL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await assertSession(page, providerOrigins[item.target as Target]);
      if (receiptURL(page.url(), item) !== verifiedURL) throw new BrowserStop('public_receipt_redirected', item.target);
      if (controls.receiptExpand && await page.locator(controls.receiptExpand).isVisible()) await (await one(page, controls.receiptExpand)).click();
      const text = await (await one(page, controls.receiptText)).innerText();
      if (!normalize(text).includes(normalize(item.payload.caption))) throw new BrowserStop('public_copy_mismatch', item.target);
      if (item.target !== 'x' && (!controls.receiptTitle || normalize(await (await one(page, controls.receiptTitle)).innerText()) !== normalize(item.payload.title))) throw new BrowserStop('public_title_mismatch', item.target);
      if (sound && (!controls.receiptSound || !normalize(await (await one(page, controls.receiptSound)).innerText()).includes(normalize(sound)))) throw new BrowserStop('public_sound_mismatch', item.target);
      const identity = await one(page, controls.receiptAccount);
      const handle = controls.receiptAccountAttribute ? await identity.getAttribute(controls.receiptAccountAttribute) : await identity.innerText();
      if (!handle || !sameIdentity(handle, account.handle)) throw new BrowserStop('public_account_mismatch', item.target);
      if (item.target === 'reddit' || item.target.startsWith('pinterest')) {
        if (!controls.receiptDestination) throw new BrowserStop('public_destination_evidence_missing', item.target);
        const destination = await (await one(page, controls.receiptDestination)).getAttribute('href');
        const wanted = item.target === 'reddit' ? `/r/${item.payload.destination.slice(2)}/` : new URL(item.payload.destination).pathname;
        if (!destination || new URL(destination, providerOrigins[item.target as Target]).pathname.toLowerCase() !== wanted.toLowerCase()) throw new BrowserStop('public_destination_mismatch', item.target);
      }
      if (mediaPath) {
        const image = await one(page, controls.receiptImage);
        if (await imageDistance(readFileSync(mediaPath), await image.screenshot()) > 6) throw new BrowserStop('public_media_mismatch', item.target);
      }
      const screenshot = await this.sessions.evidence(page, runId, item.itemId, 'public_receipt');
      return { itemId: item.itemId, accountId: item.accountId, payloadDigest: item.payloadDigest,
        url: verifiedURL, public: true, evidenceDigest: fingerprint({ text, handle,
          screenshot: createHash('sha256').update(screenshot).digest('hex') }) };
    } finally { await browser.close(); }
  }
}
