import { randomInt, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import type { Page, Locator } from 'playwright';
import { fingerprint, type Target } from './planner.ts';
import { providerOrigins, allowedProviderOrigins, composers, requireControls, type BrowserAccount, type Controls } from './browser-config.ts';
import { assertSession, BrowserSessions, BrowserStop, dismissOptionalCookies, one, waitForHydratedPage } from './browser-session.ts';
import type { BrowserItem } from './browser-source.ts';

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
export const destinationName = (text: string) => normalize(text).replace(/^r\//i, '').replace(/\s+/g, '').toLowerCase();
const cssValue = (text: string) => text.replace(/[^a-zA-Z0-9_-]/g, char => `\\${char.codePointAt(0)!.toString(16)} `);
const uploadPreviewTolerance = (target: Target) => target.startsWith('pinterest') ? 10 : target.startsWith('tiktok') ? 14 : 6;
function submitButton(page: Page, controls: Controls, item: BrowserItem) {
  // TikTok's Post button is reliably exposed by its accessible name, while the
  // CSS text selector intermittently stops matching after disclosure controls rerender.
  return item.target.startsWith('tiktok')
    ? page.getByRole('button', { name: 'Post', exact: true })
    : item.target.startsWith('pinterest')
      ? page.getByRole('button', { name: /^(Publish|Publish Pin|Publică|Publică Pin|Publică Pinul)$/ }).filter({ visible: true })
    : page.locator(controls.submit);
}
export function sameIdentity(observed: string, expected: string) {
  let value = observed.trim();
  if (value.startsWith('/')) value = value.split(/[?#]/, 1)[0]!;
  else try { value = new URL(value).pathname; } catch {}
  try { value = decodeURIComponent(value).split('/').filter(Boolean).at(-1) ?? ''; } catch {}
  return value.replace(/^(@|u\/)/, '').toLowerCase() === expected.replace(/^(@|u\/)/, '').toLowerCase();
}
function captionControl(target: Target, controls: Controls) {
  return target === 'x' ? '[role="dialog"] [data-testid="tweetTextarea_0"]' : controls.caption;
}
function uploadControl(target: Target, controls: Controls) {
  return target === 'x' ? '[role="dialog"] input[data-testid="fileInput"]' : controls.upload;
}
export function receiptURL(value: string, item: BrowserItem): string {
  const url = new URL(value);
  const target = item.target as Target;
  if (!allowedProviderOrigins(target).includes(url.origin) || url.username || url.password || url.hash || url.search) throw new BrowserStop('receipt_url_invalid');
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
export function pinterestBoardPinHrefMatches(value: string, pinId: string, allowedOrigins: readonly string[]) {
  if (!/^\d+$/.test(pinId)) return false;
  try {
    const url = new URL(value, 'https://www.pinterest.com');
    return allowedOrigins.includes(url.origin) && url.pathname === `/pin/${pinId}/` && !url.search && !url.hash;
  } catch { return false; }
}
function sameReceiptURL(left: string, right: string, target: Target) {
  const a = new URL(left), b = new URL(right);
  const sameHost = target.startsWith('pinterest')
    ? a.hostname.replace(/^(www|ro)\./, '') === b.hostname.replace(/^(www|ro)\./, '')
    : a.origin === b.origin;
  return sameHost && a.pathname === b.pathname && a.search === b.search && a.hash === b.hash;
}
async function fieldText(locator: Locator) {
  return locator.evaluate(element => element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
    ? element.value : (element as HTMLElement).innerText);
}
async function locatorText(locator: Locator, attribute?: string) {
  return attribute ? await locator.getAttribute(attribute) ?? '' : await locator.innerText();
}
function pinterestCopyMatches(observed: string, expected: string) {
  // Pinterest renders hashtag tokens as adjacent links, and innerText can omit
  // separators between those nodes. Preserve every visible character while
  // ignoring only whitespace introduced or removed by that rendering.
  const compact = (value: string) => value.normalize('NFKC').replace(/[\s\u200b-\u200f\ufeff]/g, '');
  return compact(observed).includes(compact(expected));
}
async function xReceiptCopyMatches(locator: Locator, caption: string) {
  const expectedURLs = [...caption.matchAll(/https?:\/\/[^\s]+/g)].map(match => match[0]);
  const expectedText = normalize(caption.replace(/https?:\/\/[^\s]+/g, ' '));
  const observed = await locator.evaluate((element, urls) => {
    const canonical = (value: string | null) => {
      if (!value) return null;
      try {
        const url = new URL(value, location.origin);
        if (url.protocol !== 'https:') return null;
        return `${url.hostname.replace(/^www\./, '')}${url.pathname}${url.search}`;
      } catch { return null; }
    };
    const expected = urls.map(url => ({ original: url, canonical: canonical(url) })).filter(
      (entry): entry is { original: string; canonical: string } => Boolean(entry.canonical));
    const clone = element.cloneNode(true) as HTMLElement;
    const matched = new Set<string>();
    const links: Array<{ text: string; candidates: string[] }> = [];
    for (const anchor of clone.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      const text = anchor.innerText.trim().replace(/(?:…|\.{3})$/, '');
      const displayed = canonical(/^https?:\/\//i.test(text) ? text : `https://${text}`);
      const href = new URL(anchor.href);
      const hrefTarget = canonical(anchor.href);
      const shortened = href.hostname === 't.co' && /^\/[a-zA-Z0-9]+$/.test(href.pathname)
        && !href.search && !href.hash;
      const candidates = [hrefTarget, anchor.getAttribute('data-expanded-url'), anchor.title,
        anchor.getAttribute('aria-label')].map(canonical).filter((url): url is string => Boolean(url));
      links.push({ text: anchor.innerText, candidates });
      const match = expected.find(url => displayed === url.canonical
        && (candidates.includes(url.canonical) || shortened));
      if (match) { matched.add(match.canonical); anchor.replaceWith(document.createTextNode(' ')); }
    }
    return { text: clone.innerText, matched: [...matched], links };
  }, expectedURLs);
  const normalizedExpectedURLs = expectedURLs.map(value => {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:') return null;
      return `${url.hostname.replace(/^www\./, '')}${url.pathname}${url.search}`;
    }
    catch { return null; }
  }).filter((url): url is string => Boolean(url));
  const matches = normalizedExpectedURLs.length === expectedURLs.length
    && new Set(normalizedExpectedURLs).size === normalizedExpectedURLs.length
    && normalizedExpectedURLs.every(url => observed.matched.includes(url))
    && normalize(observed.text) === expectedText;
  return { matches, detail: matches ? undefined : JSON.stringify({ expectedText, observedText: normalize(observed.text),
    expectedURLs: normalizedExpectedURLs, matchedURLs: observed.matched, observedLinks: observed.links }).slice(0, 1600) };
}
async function uploadedImageBytes(locator: Locator, expected?: Buffer, cropRoundedPreview = false) {
  let encoded: string | null;
  try {
    encoded = await locator.evaluate(async element => {
      const image = element as HTMLImageElement;
      const source = image.currentSrc || image.src;
      if (!source.startsWith(`blob:${location.origin}/`) && !source.startsWith('data:image/')) return null;
      const response = await fetch(source);
      if (!response.ok) return null;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.length || bytes.length > 25 * 1024 * 1024) return null;
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    });
  } catch { encoded = null; }
  if (!encoded) {
    // Some providers replace the local blob preview with a CDN-backed image.
    // Compare the visible preview pixels in that case; never accept an unreadable preview.
    const screenshot = await locator.screenshot().catch(() => null);
    if (!screenshot) throw new BrowserStop('uploaded_media_preview_unverifiable');
    if (!cropRoundedPreview) return screenshot;
    const { width, height } = await sharp(screenshot).metadata();
    if (!width || !height || width <= 12 || height <= 12) throw new BrowserStop('uploaded_media_preview_unverifiable');
    // Pinterest rounds the uploaded-image preview corners. Compare a narrow
    // range of edge trims to account for that frame while keeping the strict image threshold.
    const candidates = await Promise.all([2, 4, 6, 8, 10, 12].map(inset => sharp(screenshot)
      .extract({ left: inset, top: inset, width: width - inset * 2, height: height - inset * 2 })
      .png().toBuffer()));
    if (!expected) return candidates[0]!;
    const distances = await Promise.all(candidates.map(candidate => imageDistance(expected, candidate)));
    return candidates[distances.indexOf(Math.min(...distances))]!;
  }
  return Buffer.from(encoded, 'base64');
}
async function uploadedImageComparison(locator: Locator, expected: Buffer, target: Target) {
  const preview = await uploadedImageBytes(locator, expected, target.startsWith('pinterest'));
  const tolerance = uploadPreviewTolerance(target);
  const [source, rendered] = await Promise.all([sharp(expected).metadata(), sharp(preview).metadata()]);
  const result: { matches: boolean; directDistance: number; cropDistance?: number; sourceRatio?: number; previewRatio?: number } = {
    matches: false,
    directDistance: await imageDistance(expected, preview),
    ...(source.width && source.height ? { sourceRatio: Number((source.width / source.height).toFixed(3)) } : {}),
    ...(rendered.width && rendered.height ? { previewRatio: Number((rendered.width / rendered.height).toFixed(3)) } : {}),
  };
  if (result.directDistance <= tolerance) return { ...result, matches: true };
  if (target.startsWith('tiktok')) {
    if (source.width && source.height && rendered.width && rendered.height) {
      const sourceRatio = source.width / source.height;
      const renderedRatio = rendered.width / rendered.height;
      // TikTok's uploaded-photo strip uses center-cropped thumbnails even though
      // its full-size post preview preserves the original image proportions.
      // Compare that documented visual crop while keeping the same strict
      // pixel and perceptual thresholds.
      if (Math.abs(sourceRatio - renderedRatio) > 0.04) {
        const cropped = await sharp(expected).resize(rendered.width, rendered.height,
          { fit: 'cover', position: 'centre' }).png().toBuffer();
        result.cropDistance = await imageDistance(cropped, preview);
        if (result.cropDistance <= tolerance) return { ...result, matches: true };
      }
    }
  }
  return result;
}
async function uploadedImageMatches(locator: Locator, expected: Buffer, target: Target) {
  return (await uploadedImageComparison(locator, expected, target)).matches;
}
async function checked(locator: Locator) {
  const aria = await locator.getAttribute('aria-checked');
  if (aria !== null) {
    if (!['true', 'false'].includes(aria)) throw new BrowserStop('disclosure_control_unavailable');
    return aria === 'true';
  }
  const type = await locator.getAttribute('type');
  if (type === 'checkbox' || type === 'radio') return locator.isChecked();
  throw new BrowserStop('disclosure_control_unavailable');
}
async function setChecked(locator: Locator, wanted: boolean, control: string) {
  const aria = await locator.getAttribute('aria-checked');
  if (aria !== null) {
    if (!['true', 'false'].includes(aria)) throw new BrowserStop('disclosure_control_unavailable');
    if ((aria === 'true') !== wanted) await locator.click();
  } else {
    const type = await locator.getAttribute('type');
    if (type !== 'checkbox' && type !== 'radio') throw new BrowserStop('disclosure_control_unavailable');
    await locator.setChecked(wanted);
  }
  const observed = await checked(locator);
  if (observed !== wanted) throw new BrowserStop('disclosure_readback_mismatch', undefined, `${control}: expected=${wanted} observed=${observed}`);
}
export async function imageDistance(original: Buffer, screenshot: Buffer, maxAverageError = 16) {
  async function signature(bytes: Buffer) {
    return sharp(bytes).flatten({ background: '#ffffff' }).resize(9, 8, { fit: 'fill' }).greyscale().raw().toBuffer();
  }
  const [a, b] = await Promise.all([signature(original), signature(screenshot)]);
  const [colorsA, colorsB] = await Promise.all([original, screenshot].map(bytes => sharp(bytes).flatten({ background: '#ffffff' }).resize(16, 16, { fit: 'fill' }).removeAlpha().raw().toBuffer()));
  const averageError = colorsA.reduce((sum, value, index) => sum + Math.abs(value - colorsB[index]!), 0) / colorsA.length;
  if (averageError > maxAverageError) return 64;
  let distance = 0;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const offset = y * 9 + x;
    if ((a[offset]! > a[offset + 1]!) !== (b[offset]! > b[offset + 1]!)) distance++;
  }
  return distance;
}
export async function studioThumbnailMatches(original: Buffer, thumbnail: Buffer) {
  const { width, height } = await sharp(thumbnail).metadata();
  if (!width || !height) return false;
  // Studio shows a portrait cover crop, so compare the source after applying that crop.
  const coverCrop = await sharp(original).resize(width, height, { fit: 'cover', position: 'centre' }).png().toBuffer();
  return await imageDistance(coverCrop, thumbnail, 24) <= 16;
}
async function verifyReceiptMedia(page: Page, controls: Controls, mediaPaths: string[], target: Target) {
  if (!mediaPaths.length) return [];
  // X serves a downscaled, recompressed 3:2 rendition in public receipts.
  // Pinterest's public CDN thumbnail is resized to 735x490; allow the small
  // perceptual-hash drift observed in its recompressed public rendition.
  const tolerance = target.startsWith('pinterest') ? 12 : target === 'x' ? 12 : uploadPreviewTolerance(target);
  let images = page.locator(controls.receiptImage);
  let count = await images.count();
  if (target.startsWith('pinterest') && count < mediaPaths.length) {
    const closeupPinImages = page.locator('[data-test-id="closeup-image-main"]');
    const closeupCount = await closeupPinImages.count();
    if (closeupCount >= mediaPaths.length) { images = closeupPinImages; count = closeupCount; }
  }
  if (target.startsWith('pinterest') && count < mediaPaths.length) {
    const accessiblePinImages = page.getByRole('img', { name: /^(Pin story image|Imagine Pin povestire|Pin imagine)$/i });
    const accessibleCount = await accessiblePinImages.count();
    if (accessibleCount >= mediaPaths.length) { images = accessiblePinImages; count = accessibleCount; }
  }
  if (count < mediaPaths.length || count > 30) throw new BrowserStop('public_receipt_image_count_mismatch', target,
    `expected=${mediaPaths.length};observed=${count}`);
  const available = new Set(Array.from({ length: count }, (_, index) => index));
  const evidence: string[] = [];
  const inspected: Array<{ index: number; distance: number | null; naturalWidth: number; naturalHeight: number }> = [];
  for (const path of mediaPaths) {
    let match = -1;
    for (const index of available) {
      const image = images.nth(index);
      const dimensions = await image.evaluate(element => ({
        naturalWidth: (element as HTMLImageElement).naturalWidth,
        naturalHeight: (element as HTMLImageElement).naturalHeight,
      })).catch(() => ({ naturalWidth: 0, naturalHeight: 0 }));
      const screenshot = await image.screenshot().catch(() => null);
      const distance = screenshot ? await imageDistance(readFileSync(path), screenshot) : null;
      inspected.push({ index, distance, ...dimensions });
      if (screenshot && distance !== null && distance <= tolerance) {
        match = index;
        evidence.push(createHash('sha256').update(screenshot).digest('hex'));
        break;
      }
    }
    if (match < 0) throw new BrowserStop('public_media_mismatch', target, JSON.stringify(inspected));
    available.delete(match);
  }
  return evidence;
}

async function verifyPinterestBoard(page: Page, item: BrowserItem, pinURL: string) {
  const pinId = new URL(pinURL).pathname.split('/').filter(Boolean).at(-1);
  if (!pinId || !/^\d+$/.test(pinId)) throw new BrowserStop('receipt_url_invalid', item.target);
  const boardURL = new URL(item.payload.destination);
  if (!allowedProviderOrigins(item.target as Target).includes(boardURL.origin)) {
    throw new BrowserStop('public_destination_mismatch', item.target);
  }
  await page.goto(boardURL.href, { waitUntil: 'commit', timeout: 30_000 });
  await assertSession(page, allowedProviderOrigins(item.target as Target));
  const observedBoardURL = new URL(page.url());
  if (!allowedProviderOrigins(item.target as Target).includes(observedBoardURL.origin)
    || observedBoardURL.pathname.replace(/\/+$/, '').toLowerCase() !== boardURL.pathname.replace(/\/+$/, '').toLowerCase()) {
    throw new BrowserStop('public_destination_mismatch', item.target, 'board_route_mismatch');
  }
  let matchingPins = new Set<string>();
  for (let attempt = 0; attempt < 20 && !matchingPins.size; attempt++) {
    const pinHrefs = await page.locator('a[href]').evaluateAll(elements => elements.map(element => (element as HTMLAnchorElement).href));
    matchingPins = new Set(pinHrefs.filter(href => pinterestBoardPinHrefMatches(href, pinId,
      allowedProviderOrigins(item.target as Target))));
    if (!matchingPins.size && attempt < 19) await page.waitForTimeout(1_000);
  }
  if (!matchingPins.size) throw new BrowserStop('public_destination_mismatch', item.target, 'pin_missing_from_board');
  await page.goto(pinURL, { waitUntil: 'commit', timeout: 30_000 });
  await assertSession(page, allowedProviderOrigins(item.target as Target));
  if (!sameReceiptURL(receiptURL(page.url(), item), pinURL, item.target as Target)) {
    throw new BrowserStop('public_receipt_redirected', item.target);
  }
  const pinTitle = page.locator('[data-test-id="pinTitle"] h1');
  await pinTitle.waitFor({ state: 'visible', timeout: 20_000 })
    .catch(() => { throw new BrowserStop('public_receipt_content_unavailable', item.target, 'pin_title_after_board_readback'); });
  if (await pinTitle.count() !== 1 || !normalize(await pinTitle.innerText()).includes(normalize(item.payload.title))) {
    throw new BrowserStop('public_title_mismatch', item.target);
  }
}

async function tikTokStudioVisibility(page: Page, controls: Controls, handle: string, postId: string, caption: string) {
  const entries = await page.locator(controls.receiptLink).evaluateAll((elements, expected) => {
    const postIdentity = (element: Element) => {
      if (!(element instanceof HTMLAnchorElement)) return null;
      let link: URL;
      try { link = new URL(element.href, location.origin); } catch { return null; }
      if (link.origin !== location.origin) return null;
      const match = link.pathname.match(/^\/@([^/]+)\/(?:video|photo)\/([0-9]+)\/?$/);
      return match ? { handle: match[1]!.toLowerCase(), id: match[2]! } : null;
    };
    const wanted = elements.filter(element => {
      const identity = postIdentity(element);
      return identity?.handle === expected.handle && identity.id === expected.postId;
    });
    return wanted.map(element => {
      for (let row = element.parentElement, depth = 0; row && depth < 16; row = row.parentElement, depth++) {
        const anchors = [...(row.matches('a[href]') ? [row] : []), ...row.querySelectorAll('a[href]')];
        const identities = new Set(anchors.map(postIdentity).filter((identity): identity is { handle: string; id: string } => Boolean(identity))
          .map(identity => `${identity.handle}/${identity.id}`));
        if (identities.size !== 1 || !identities.has(`${expected.handle}/${expected.postId}`)) continue;
        const privacy = [...row.querySelectorAll('button,[role="button"]')].filter(button => {
          const box = button.getBoundingClientRect();
          return box.width > 0 && box.height > 0;
        }).map(button => (button.textContent ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean);
        if (privacy.length) {
          const images = [...row.querySelectorAll('img')].map(image => {
            const box = image.getBoundingClientRect();
            return { src: (image as HTMLImageElement).currentSrc, area: box.width * box.height,
              width: box.width, height: box.height };
          }).filter(image => image.src && image.area > 0).sort((a, b) => b.area - a.area);
          return { postId: expected.postId, handle: expected.handle, visibility: privacy.length === 1 ? privacy[0]! : '',
            postText: (element.textContent ?? '').replace(/\s+/g, ' ').trim(),
            rowText: (row.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 5000),
            thumbnailSrc: images[0]?.src ?? null, thumbnailWidth: images[0]?.width ?? 0,
            thumbnailHeight: images[0]?.height ?? 0, depth };
        }
      }
      return null;
    }).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  }, { handle: handle.replace(/^@/, '').toLowerCase(), postId, caption });
  if (!entries.length) throw new BrowserStop('studio_post_row_pending', undefined, `post=${postId}`);
  if (entries.length !== 1) throw new BrowserStop('public_visibility_readback_mismatch', undefined,
    `post=${postId};matching_rows=${entries.length};visibility=${entries[0]?.visibility ?? 'ambiguous'}`);
  if (!normalize(entries[0]!.postText).includes(normalize(caption))) throw new BrowserStop('public_copy_mismatch', undefined, `post=${postId}`);
  if (/content under review/i.test(entries[0]!.rowText)) throw new BrowserStop('studio_review_pending', undefined, `post=${postId}`);
  if (entries[0]!.visibility !== 'Everyone') throw new BrowserStop('public_visibility_readback_mismatch', undefined,
    `post=${postId};matching_rows=1;visibility=${entries[0]!.visibility}`);
  return entries[0]!;
}

export class BrowserProvider {
  readonly sessions: BrowserSessions;
  constructor(sessions: BrowserSessions) { this.sessions = sessions; }
  async identity(target: Target, account: BrowserAccount) {
    const allowed = allowedProviderOrigins(target);
    const page = target === 'x' ? await this.sessions.page(target) : await this.sessions.identityPage(target);
    const current = new URL(page.url());
    if (target !== 'x' || !allowed.includes(current.origin)) {
      await page.goto(account.identityUrl, { waitUntil: 'domcontentloaded' });
    }
    await assertSession(page, allowed);
    await waitForHydratedPage(page, allowed, target);
    const controls = requireControls(account, target);
    const identityControl = target === 'x'
      ? 'button[data-testid="SideNav_AccountSwitcher_Button"]' : controls.identity;
    await page.locator(identityControl).waitFor({ state: 'visible', timeout: 30_000 })
      .catch(() => { throw new BrowserStop('identity_control_unavailable', target); });
    const locator = await one(page, identityControl);
    const observed = target === 'x' ? await fieldText(locator)
      : controls.identityAttribute ? await locator.getAttribute(controls.identityAttribute) : await fieldText(locator);
    const identityMatches = typeof observed === 'string' && (target === 'x'
      ? normalize(observed).toLowerCase().includes(account.handle.toLowerCase())
      : sameIdentity(observed, account.handle));
    if (!identityMatches) throw new BrowserStop('active_account_mismatch', target);
    return { accountId: account.handle, observedAt: new Date().toISOString() };
  }
  async composer(item: BrowserItem, account: BrowserAccount, mediaPath: string[] | string | null) {
    const target = item.target as Target;
    const controls = requireControls(account, target);
    const mediaPaths = typeof mediaPath === 'string' ? [mediaPath] : mediaPath ?? [];
    if (item.payload.contentKind === 'reach') {
      if (mediaPaths.length < 2 || mediaPaths.length !== item.payload.mediaItems?.length) throw new BrowserStop('reach_media_set_invalid', target);
      if (target === 'x' && mediaPaths.length > 4) throw new BrowserStop('reach_x_thread_required', target);
      if (target === 'pinterest_business' && mediaPaths.length > 5) throw new BrowserStop('reach_pinterest_carousel_limit', target);
      if (target === 'pinterest_personal' && mediaPaths.length > 1) throw new BrowserStop('reach_pinterest_personal_multi_pin_required', target);
    }
    const page = await this.sessions.page(target);
    const composerURL = `${providerOrigins[target]}${composers[target]}`;
    const expectedURL = new URL(composerURL);
    const captionSelector = captionControl(target, controls);
    const uploadSelector = uploadControl(target, controls);
    let keepObservedComposer = false;
    if (target.startsWith('tiktok')) {
      try {
        const currentURL = new URL(page.url());
        const upload = page.locator(controls.upload);
        const observedTikTokPhotoComposer = target.startsWith('tiktok')
          && currentURL.pathname === '/tiktokstudio/upload/post/photo' && !currentURL.search;
        keepObservedComposer = currentURL.origin === expectedURL.origin
          && (currentURL.pathname === expectedURL.pathname && !currentURL.search || observedTikTokPhotoComposer)
          && await upload.count() === 1 && (observedTikTokPhotoComposer || await upload.isVisible());
      } catch { keepObservedComposer = false; }
    } else if (target.startsWith('pinterest')) {
      try {
        const currentURL = new URL(page.url());
        const upload = page.locator(controls.upload);
        keepObservedComposer = allowedProviderOrigins(target).includes(currentURL.origin)
          && ['/pin-creation-tool/', '/pin-builder/'].includes(currentURL.pathname)
          && await upload.count() === 1 && await upload.isVisible();
      } catch { keepObservedComposer = false; }
    }
    if (target === 'x') {
      await page.goto(`${providerOrigins[target]}/home`, { waitUntil: 'domcontentloaded' });
      await assertSession(page, allowedProviderOrigins(target));
      const newPost = page.locator('a[data-testid="SideNav_NewTweet_Button"]');
      await newPost.waitFor({ state: 'visible', timeout: 30_000 })
        .catch(() => { throw new BrowserStop('composer_not_loaded', target, 'a[data-testid="SideNav_NewTweet_Button"]'); });
      if (await newPost.count() !== 1) throw new BrowserStop('unexpected_ui', target, 'new_post_button_ambiguous');
      await newPost.click();
      await page.locator(captionSelector).waitFor({ state: 'visible', timeout: 30_000 })
        .catch(() => { throw new BrowserStop('composer_not_loaded', target, captionSelector); });
    } else if (target.startsWith('tiktok') && !keepObservedComposer) {
      await page.goto(account.identityUrl, { waitUntil: 'domcontentloaded' });
      await assertSession(page, allowedProviderOrigins(target));
      const uploadButton = page.getByRole('button', { name: 'Upload', exact: true }).filter({ visible: true });
      await uploadButton.waitFor({ state: 'visible', timeout: 30_000 })
        .catch(() => { throw new BrowserStop('upload_navigation_unavailable', target, 'Upload button did not hydrate'); });
      if (await uploadButton.count() !== 1) throw new BrowserStop('upload_navigation_unavailable', target, 'Upload button');
      await uploadButton.click();
      await assertSession(page, allowedProviderOrigins(target));
      const navigatedURL = new URL(page.url());
      if (navigatedURL.origin === expectedURL.origin && navigatedURL.pathname === '/tiktokstudio/upload/post/photo'
        && !navigatedURL.search) {
        // The current Studio editor exposes the photo section directly. Its
        // exact route and uploader are verified below, including resumed drafts.
      } else {
        const photos = page.getByRole('tab', { name: 'Photos', exact: true }).filter({ visible: true });
        await photos.waitFor({ state: 'visible', timeout: 30_000 })
          .catch(() => { throw new BrowserStop('desktop_photos_unavailable', target, 'Photos tab after Upload'); });
        if (await photos.count() !== 1) throw new BrowserStop('desktop_photos_unavailable', target, `Photos tab count=${await photos.count()}`);
        if (await photos.getAttribute('aria-selected') !== 'true') await photos.click();
        if (await photos.getAttribute('aria-selected') !== 'true') throw new BrowserStop('desktop_photos_unavailable', target, 'Photos tab not selected');
        const photoURL = new URL(page.url());
        if (photoURL.origin !== providerOrigins[target] || photoURL.pathname !== '/tiktokstudio/upload'
          || photoURL.searchParams.get('tab') !== 'photo') throw new BrowserStop('desktop_photos_unavailable', target, 'photo upload route not selected');
      }
    } else if (!keepObservedComposer) await page.goto(composerURL, { waitUntil: 'domcontentloaded' });
    await assertSession(page, allowedProviderOrigins(target));
    if (!target.startsWith('tiktok')) await waitForHydratedPage(page, allowedProviderOrigins(target), target);
    if (target.startsWith('tiktok')) await dismissOptionalCookies(page, target);
    let resumedUnsavedPhoto = false;
    if (target.startsWith('tiktok')) {
      const prompt = page.getByText('You have an unsaved photo post. Continue editing?', { exact: true });
      const promptCount = await prompt.count();
      if (promptCount > 1) throw new BrowserStop('unsaved_photo_prompt_ambiguous', target);
      if (promptCount === 1 && await prompt.isVisible()) {
        const continueButton = page.getByRole('button', { name: 'Continue', exact: true }).filter({ visible: true });
        if (await continueButton.count() !== 1) throw new BrowserStop('unsaved_photo_continue_unavailable', target);
        await continueButton.click();
        await prompt.waitFor({ state: 'hidden', timeout: 10_000 })
          .catch(() => { throw new BrowserStop('unsaved_photo_prompt_did_not_close', target); });
        await assertSession(page, allowedProviderOrigins(target));
        resumedUnsavedPhoto = true;
      }
    }
    if (target.startsWith('tiktok')) {
      const photos = page.getByRole('tab', { name: 'Photos', exact: true });
      const photoTabCount = await photos.count();
      let photoSectionVerified = false;
      if (photoTabCount === 1) {
        await photos.waitFor({ state: 'visible', timeout: 30_000 });
        if (await photos.getAttribute('aria-selected') !== 'true') {
          await photos.click();
          if (await photos.getAttribute('aria-selected') !== 'true') throw new BrowserStop('desktop_photos_unavailable', target, 'photo_tab_not_selected');
        }
      } else if (photoTabCount === 0) {
        // The current Studio photo editor combines the section label and photo count
        // in one visible node instead of exposing Photos as a separate tab.
        const currentURL = new URL(page.url());
        const addPhoto = page.locator(controls.upload);
        if (currentURL.pathname !== '/tiktokstudio/upload/post/photo') throw new BrowserStop('desktop_photos_unavailable', target, 'photo_section_unverified');
        await addPhoto.waitFor({ state: 'visible', timeout: 20_000 })
          .catch(() => { throw new BrowserStop('desktop_photos_unavailable', target, 'photo_editor_did_not_hydrate'); });
        if (await addPhoto.count() !== 1) throw new BrowserStop('desktop_photos_unavailable', target, 'photo_editor_control_ambiguous');
        photoSectionVerified = true;
      } else {
        throw new BrowserStop('desktop_photos_unavailable', target, `photo_tab_count=${photoTabCount}`);
      }
      const upload = page.locator(controls.upload);
      await upload.waitFor({ state: 'visible', timeout: 20_000 })
        .catch(() => { throw new BrowserStop('desktop_photos_unavailable', target, 'photo_upload_did_not_hydrate'); });
      const finalUploadCount = await upload.count();
      const photoSurfaceVerified = photoTabCount === 1
        ? await photos.getAttribute('aria-selected') === 'true'
        : photoSectionVerified;
      if (!photoSurfaceVerified
        || finalUploadCount !== 1 || !await upload.isVisible()) {
        throw new BrowserStop('desktop_photos_unavailable', target, `upload_count=${finalUploadCount}`);
      }
    }
    if (target === 'reddit') {
      const selector = item.payload.postType && controls.postTypeTabs?.[item.payload.postType];
      if (!selector) throw new BrowserStop('post_type_ui_calibration_required', target);
      const tab = await one(page, selector);
      await tab.click();
      if (await tab.getAttribute('aria-selected') !== 'true') throw new BrowserStop('post_type_readback_mismatch', target);
    }
    let existingDraftMedia = false;
    if (mediaPaths.length) {
      const previews = page.locator(controls.readyMedia).filter({ visible: true });
      const previewCount = await previews.count();
      if (previewCount > 0) {
        if (previewCount !== mediaPaths.length) throw new BrowserStop('existing_photo_draft_ambiguous', target);
        for (let index = 0; index < previewCount; index++) {
          if (!await uploadedImageMatches(previews.nth(index), readFileSync(mediaPaths[index]!), target)) {
            throw new BrowserStop('existing_photo_draft_mismatch', target);
          }
        }
        existingDraftMedia = true;
      }
      if (!existingDraftMedia) {
        if (target.startsWith('tiktok')) {
          const pageURL = new URL(page.url());
          const selectPhotos = page.getByRole('button', { name: 'Select photos', exact: true }).filter({ visible: true });
          const selectionPage = pageURL.pathname === '/tiktokstudio/upload' && pageURL.searchParams.get('tab') === 'photo';
          if (selectionPage) {
            if (await selectPhotos.count() !== 1) throw new BrowserStop('photo_picker_unavailable', target, 'Select photos button');
            const chooserPromise = page.waitForEvent('filechooser', { timeout: 10_000 }).catch(() => null);
            await selectPhotos.click();
            const chooser = await chooserPromise;
            if (!chooser) throw new BrowserStop('photo_picker_unavailable', target, 'Select photos');
            await chooser.setFiles(mediaPaths);
            existingDraftMedia = true;
          } else {
          const addPhoto = await one(page, controls.upload);
          const chooserPromise = page.waitForEvent('filechooser', { timeout: 10_000 }).catch(() => null);
          await addPhoto.click();
          const chooser = await chooserPromise;
          if (!chooser) throw new BrowserStop('photo_picker_unavailable', target, controls.upload);
          await chooser.setFiles(mediaPaths);
          }
        } else {
          const input = page.locator(uploadSelector);
          await input.first().waitFor({ state: 'attached', timeout: 30_000 })
            .catch(() => { throw new BrowserStop('upload_control_changed', target, `${uploadSelector};not_attached`); });
          const uploadCount = await input.count();
          if (uploadCount !== 1 || await input.getAttribute('type') !== 'file') {
            const observed = await input.evaluateAll(elements => elements.slice(0, 4).map(element => ({
              tag: element.tagName, type: element.getAttribute('type'), id: element.id || null,
              name: element.getAttribute('name'), accept: element.getAttribute('accept'),
              visible: element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0,
            })));
            throw new BrowserStop('upload_control_changed', target, `${uploadSelector} count=${uploadCount} ${JSON.stringify(observed)}`);
          }
          if (mediaPaths.length > 1 && await input.getAttribute('multiple') === null) throw new BrowserStop('reach_multi_upload_unavailable', target);
          await input.setInputFiles(mediaPaths);
        }
      }
      await previews.first().waitFor({ state: 'visible', timeout: 60_000 })
        .catch(() => { throw new BrowserStop(resumedUnsavedPhoto ? 'unsaved_photo_preview_unavailable' : 'uploaded_media_preview_unavailable', target); });
      if (await previews.count() !== mediaPaths.length) throw new BrowserStop('photo_preview_count_mismatch', target);
      for (let index = 0; index < mediaPaths.length; index++) {
        const comparison = await uploadedImageComparison(previews.nth(index), readFileSync(mediaPaths[index]!), target);
        if (!comparison.matches) {
          throw new BrowserStop(resumedUnsavedPhoto ? 'unsaved_photo_media_mismatch' : 'uploaded_media_mismatch', target,
            `position=${index + 1};direct=${comparison.directDistance};crop=${comparison.cropDistance ?? 'na'};sourceRatio=${comparison.sourceRatio ?? 'na'};previewRatio=${comparison.previewRatio ?? 'na'}`);
        }
      }
    }
    if (controls.title) await (await one(page, controls.title)).fill(item.payload.title);
    else if (target !== 'x') throw new BrowserStop('title_control_missing', target);
    let caption = page.locator(captionSelector);
    if (target.startsWith('pinterest') && await caption.count() === 0) {
      const description = page.getByRole('button', { name: /Descrie-ți Pinul/ }).filter({ visible: true });
      if (await description.count() !== 1) throw new BrowserStop('caption_control_unavailable', target);
      await description.click();
      await caption.waitFor({ state: 'visible', timeout: 10_000 })
        .catch(() => { throw new BrowserStop('caption_control_unavailable', target, controls.caption); });
    }
    await (await one(page, captionSelector)).fill(item.payload.caption);
    if (target.startsWith('pinterest')) {
      if (!controls.link) throw new BrowserStop('pin_link_control_missing', target);
      await (await one(page, controls.link)).fill(item.canonicalUrl);
    }
    if (target === 'reddit' || target.startsWith('pinterest')) {
      if (!controls.destination || !controls.destinationOption || !controls.destinationReadback) throw new BrowserStop('destination_control_missing', target);
      await (await one(page, controls.destination)).click();
      const destination = target === 'reddit' ? item.payload.destination : new URL(item.payload.destination).pathname.split('/').filter(Boolean).at(-1)!;
      const option = target.startsWith('pinterest')
        ? target === 'pinterest_personal'
          ? page.getByRole('button', { name: 'CodeOnRoids', exact: true }).filter({ visible: true })
          : page.locator(controls.destinationOption.replaceAll('{destination}', cssValue(destination)))
            .getByText('CodeOnRoids', { exact: true }).filter({ visible: true })
        : page.locator(controls.destinationOption.replaceAll('{destination}', cssValue(destination)));
      await option.first().waitFor({ state: 'visible', timeout: 10_000 })
        .catch(() => { throw new BrowserStop('destination_option_unavailable', target); });
      const optionCount = await option.count();
      if (optionCount !== 1) throw new BrowserStop('destination_option_ambiguous', target, `count=${optionCount}`);
      const optionName = await option.innerText();
      if (destinationName(optionName) !== destinationName(destination)) {
        throw new BrowserStop('destination_option_mismatch', target,
          `${JSON.stringify(optionName)} => ${destinationName(optionName)}; expected=${destinationName(destination)}`);
      }
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
      const items = page.locator('div[class*="collapsibleItems"]');
      if (await items.count() !== 1) throw new BrowserStop('disclosure_settings_ambiguous', target);
      if (await items.getAttribute('hidden') !== null) {
        const showMore = page.locator('div[class*="collapseToggle"]').filter({ hasText: 'Show more', visible: true });
        if (await showMore.count() !== 1) throw new BrowserStop('disclosure_settings_toggle_unavailable', target);
        await showMore.getByText('Show more', { exact: true }).click();
        await items.waitFor({ state: 'visible', timeout: 10_000 })
          .catch(() => { throw new BrowserStop('disclosure_settings_did_not_expand', target); });
      }
      const showLess = page.locator('div[class*="collapseToggle"]').filter({ hasText: 'Show less', visible: true });
      if (await showLess.count() !== 1 || await items.getAttribute('hidden') !== null) throw new BrowserStop('disclosure_settings_did_not_expand', target);
      if (disclosure.ownBrand || disclosure.paidPartnership) {
        await setChecked(await one(page, '[data-e2e="disclose_content_container"] .Switch__content'), true, 'disclosePostContent');
      }
      for (const key of ['ownBrand', 'paidPartnership', 'aiGenerated'] as const) {
        if (!controls[key]) throw new BrowserStop('disclosure_control_missing', target);
        const field = await one(page, controls[key]!);
        await setChecked(field, disclosure[key], key);
      }
    }
    await this.checkComposer(page, controls, item, mediaPaths);
    const links = await page.locator(controls.receiptLink).evaluateAll(elements => elements.map(e => e.getAttribute('href')).filter((v): v is string => Boolean(v)));
    return { page, sound, mediaPaths, previousLinks: links };
  }
  async checkComposer(page: Page, controls: Controls, item: BrowserItem, mediaPaths: string[] = []) {
    await assertSession(page, allowedProviderOrigins(item.target as Target));
    if (item.payload.visibility !== 'public') throw new BrowserStop('composer_payload_or_visibility_changed', item.target);
    if (normalize(await fieldText(await one(page, captionControl(item.target as Target, controls)))) !== normalize(item.payload.caption)
      || controls.title && normalize(await fieldText(await one(page, controls.title))) !== normalize(item.payload.title)
      || controls.publicReadback && controls.publicText
        && normalize(await (await one(page, controls.publicReadback)).innerText()) !== controls.publicText) throw new BrowserStop('composer_payload_or_visibility_changed', item.target);
    if (controls.link && await fieldText(await one(page, controls.link)) !== item.canonicalUrl) throw new BrowserStop('composer_link_changed', item.target);
    if (mediaPaths.length) {
      const previews = page.locator(controls.readyMedia);
      if (await previews.count() !== mediaPaths.length) throw new BrowserStop('photo_preview_count_mismatch', item.target);
      for (let index = 0; index < mediaPaths.length; index++) {
        const comparison = await uploadedImageComparison(previews.nth(index), readFileSync(mediaPaths[index]!), item.target as Target);
        if (!comparison.matches) throw new BrowserStop('uploaded_media_mismatch', item.target,
          `position=${index + 1};direct=${comparison.directDistance};crop=${comparison.cropDistance ?? 'na'};sourceRatio=${comparison.sourceRatio ?? 'na'};previewRatio=${comparison.previewRatio ?? 'na'}`);
      }
    }
    if (item.target === 'reddit' || item.target.startsWith('pinterest')) {
      const destination = item.target === 'reddit' ? item.payload.destination : new URL(item.payload.destination).pathname.split('/').filter(Boolean).at(-1)!;
      if (!controls.destinationReadback || destinationName(await (await one(page, controls.destinationReadback)).innerText()) !== destinationName(destination)) throw new BrowserStop('destination_readback_mismatch', item.target);
      if (item.target === 'reddit') {
        const selector = item.payload.postType && controls.postTypeTabs?.[item.payload.postType];
        if (!selector || await (await one(page, selector)).getAttribute('aria-selected') !== 'true') throw new BrowserStop('post_type_readback_mismatch', item.target);
        if (item.payload.flair && (!controls.flairReadback || normalize(await (await one(page, controls.flairReadback)).innerText()) !== item.payload.flair)) throw new BrowserStop('flair_readback_mismatch', item.target);
      }
    }
    const submit = submitButton(page, controls, item);
    const submitCount = await submit.count();
    if (submitCount !== 1 || !await submit.isVisible()) throw new BrowserStop('unexpected_ui', item.target, `submit_button_count=${submitCount}`);
    const allowed = item.target.startsWith('pinterest') ? ['Publish', 'Publish Pin', 'Publică', 'Publică Pin', 'Publică Pinul']
      : item.target === 'x' ? ['Post', 'Postează'] : ['Post'];
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
    const category = policy === 'random_for_you_top10' ? controls.musicForYou : controls.musicTrending;
    if (!['random_trending_top10', 'random_for_you_top10'].includes(policy) || !controls.musicOpen || !category || !controls.musicRows
      || !controls.musicName || !controls.musicUse || !controls.musicSelected) throw new BrowserStop('trending_music_controls_unavailable');
    const open = page.getByRole('button', { name: /^(Add sound|Replace)$/ }).filter({ visible: true });
    if (await open.count() !== 1) throw new BrowserStop('music_open_ui_changed');
    await open.click();
    const tab = await one(page, category);
    await tab.click();
    if (policy === 'random_for_you_top10' && (normalize(await tab.innerText()) !== 'For You'
      || await tab.getAttribute('aria-selected') !== 'true')) throw new BrowserStop('music_category_mismatch');
    const rows = page.locator(controls.musicRows);
    await rows.first().waitFor({ state: 'visible', timeout: 20_000 })
      .catch(() => { throw new BrowserStop('music_rows_unavailable'); });
    const count = Math.min(await rows.count(), 10);
    if (!count) throw new BrowserStop('trending_music_empty');
    const row = rows.nth(randomInt(count));
    const name = normalize((await row.locator(controls.musicName).innerText()).split('\n')[0] ?? '');
    const use = row.getByRole('button', { name: 'Use', exact: true });
    const useCount = await use.count();
    const useVisible = useCount === 1 && await use.isVisible();
    if (!name || !useVisible) throw new BrowserStop('trending_music_ui_changed', undefined,
      `musicName=${JSON.stringify(name)} useCount=${useCount} useVisible=${useVisible}`);
    await use.click();
    if (normalize(await (await one(page, controls.musicSelected)).innerText()) !== normalize(name)) throw new BrowserStop('music_selection_changed');
    return name;
  }
  async submit(page: Page, item: BrowserItem, account: BrowserAccount, sound: string | null, beforeClick: () => void, mediaPaths: string[] = []) {
    const controls = requireControls(account, item.target as Target);
    await this.checkComposer(page, controls, item, mediaPaths);
    if (item.target.startsWith('tiktok')) {
      if (sound) {
        if (!controls.musicSelected || normalize(await (await one(page, controls.musicSelected)).innerText()) !== normalize(sound)) throw new BrowserStop('music_selection_changed');
      } else if (!controls.musicEmpty || !await (await one(page, controls.musicEmpty)).isVisible()) throw new BrowserStop('music_selection_changed');
    }
    if (item.payload.disclosures) for (const key of ['ownBrand', 'paidPartnership', 'aiGenerated'] as const) {
      const observed = controls[key] ? await checked(await one(page, controls[key]!)) : null;
      if (observed !== item.payload.disclosures[key]) throw new BrowserStop('disclosure_readback_mismatch', undefined, `${key}: expected=${item.payload.disclosures[key]} observed=${observed}`);
    }
    const button = submitButton(page, controls, item);
    await button.waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {});
    const count = await button.count();
    if (count !== 1) throw new BrowserStop('unexpected_ui', item.target, `submit_button_count=${count}`);
    if (!await button.isVisible()) throw new BrowserStop('unexpected_ui', item.target, 'submit_button_visible=false');
    if (!await button.isEnabled()) throw new BrowserStop('submit_button_disabled', item.target);
    beforeClick();
    await button.click({ timeout: 15_000 });
  }
  async resultURL(page: Page, item: BrowserItem, account: BrowserAccount, previousLinks: string[]) {
    const controls = requireControls(account, item.target as Target);
    if (item.target.startsWith('tiktok')) {
      // TikTok Studio often finishes photo submission on the dashboard without
      // exposing the new permalink in the composer. Resolve it in the same
      // authenticated profile by matching the exact caption and account.
      const studio = await this.sessions.identityPage(item.target as Target);
      await studio.goto(`${providerOrigins[item.target as Target]}/tiktokstudio/content`,
        { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await assertSession(studio, allowedProviderOrigins(item.target as Target));
      const links = studio.locator(controls.receiptLink);
      await links.first().waitFor({ state: 'visible', timeout: 60_000 })
        .catch(() => { throw new BrowserStop('publication_outcome_uncertain', item.target); });
      const oldLinks = new Set(previousLinks.map(href => {
        try { return new URL(href, providerOrigins[item.target as Target]).href; } catch { return href; }
      }));
      const expectedCaption = normalize(item.payload.caption);
      for (let attempt = 0; attempt < 60; attempt++) {
        await assertSession(studio, allowedProviderOrigins(item.target as Target));
        const candidates = await links.evaluateAll((elements, expected) => elements.flatMap(element => {
          if (!(element instanceof HTMLAnchorElement)) return [];
          let url: URL;
          try { url = new URL(element.href, location.origin); } catch { return []; }
          const match = url.pathname.match(/^\/@([^/]+)\/(?:video|photo)\/\d+\/?$/);
          const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
          return match && match[1]!.toLowerCase() === expected.handle && text.includes(expected.caption)
            ? [url.href] : [];
        }), { handle: item.accountId.replace(/^@/, '').toLowerCase(), caption: expectedCaption });
        const fresh = [...new Set(candidates)].filter(href => !oldLinks.has(href));
        const valid: string[] = [];
        for (const href of fresh) {
          try { valid.push(receiptURL(href, item)); } catch {}
        }
        if (new Set(valid).size === 1) return valid[0]!;
        if (new Set(valid).size > 1) throw new BrowserStop('publication_outcome_uncertain', item.target);
        if (attempt < 59) await studio.waitForTimeout(1_000);
      }
      throw new BrowserStop('publication_outcome_uncertain', item.target);
    }
    await page.locator(controls.receiptLink).first().waitFor({ timeout: 60_000 });
    await assertSession(page, allowedProviderOrigins(item.target as Target));
    const hrefs = await page.locator(controls.receiptLink).evaluateAll(elements => elements.map(e => e.getAttribute('href')).filter((v): v is string => Boolean(v)));
    const fresh = hrefs.filter(href => !previousLinks.includes(href));
    const valid: string[] = [];
    for (const href of fresh) {
      try { valid.push(receiptURL(new URL(href, providerOrigins[item.target as Target]).href, item)); } catch {}
    }
    if (new Set(valid).size !== 1) throw new BrowserStop('publication_outcome_uncertain', item.target);
    return valid[0]!;
  }
  async verify(item: BrowserItem, account: BrowserAccount, url: string, mediaPath: string[] | string | null, runId: string, sound: string | null) {
    let verifiedURL = receiptURL(url, item);
    const controls = requireControls(account, item.target as Target);
    const target = item.target as Target;
    const mediaPaths = typeof mediaPath === 'string' ? [mediaPath] : mediaPath ?? [];
    if (item.payload.contentKind === 'reach' && mediaPaths.length !== item.payload.mediaItems?.length) throw new BrowserStop('reach_media_set_invalid', target);
    if (target.startsWith('tiktok')) {
      const postId = new URL(verifiedURL).pathname.split('/').filter(Boolean).at(-1);
      if (!postId || !/^\d+$/.test(postId)) throw new BrowserStop('receipt_url_invalid', target);
      const studio = await this.sessions.identityPage(target);
      await studio.goto(`${providerOrigins[target]}/tiktokstudio/content`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await assertSession(studio, allowedProviderOrigins(target));
      await studio.locator(controls.receiptLink).first().waitFor({ state: 'visible', timeout: 30_000 })
        .catch(() => { throw new BrowserStop('studio_posts_unavailable', target); });
      let studioRow: Awaited<ReturnType<typeof tikTokStudioVisibility>> | undefined;
      let reviewPending = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        try {
          studioRow = await tikTokStudioVisibility(studio, controls, account.handle, postId, item.payload.caption);
          if (studioRow.thumbnailSrc) break;
        }
        catch (error) {
          if (!(error instanceof BrowserStop) || !['studio_post_row_pending', 'studio_review_pending'].includes(error.message)) throw error;
          reviewPending ||= error.message === 'studio_review_pending';
        }
        if (attempt < 59) await studio.waitForTimeout(1_000);
      }
      if (!studioRow) throw new BrowserStop(reviewPending ? 'submitted_pending_review' : 'studio_post_row_unavailable', target, `post=${postId}`);
      let mediaEvidence: string[] = [];
      if (mediaPaths.length === 1) {
        if (!studioRow.thumbnailSrc) throw new BrowserStop('public_receipt_image_unavailable', target, `post=${postId}`);
        const images = await studio.locator('img').evaluateAll(elements => elements.map((element, index) => ({ index,
          src: (element as HTMLImageElement).currentSrc } )));
        const matches = images.filter(image => image.src === studioRow!.thumbnailSrc);
        if (matches.length !== 1) throw new BrowserStop('public_receipt_image_unavailable', target,
          `post=${postId};matching_thumbnails=${matches.length}`);
        const screenshot = await studio.locator('img').nth(matches[0]!.index).screenshot();
        if (!await studioThumbnailMatches(readFileSync(mediaPaths[0]!), screenshot)) throw new BrowserStop('public_media_mismatch', target);
        mediaEvidence = [createHash('sha256').update(screenshot).digest('hex')];
      } else if (mediaPaths.length > 1) {
        const publicPage = await this.sessions.page(target);
        await publicPage.goto(verifiedURL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await assertSession(publicPage, allowedProviderOrigins(target));
        await publicPage.locator(controls.receiptText).first().waitFor({ state: 'visible', timeout: 30_000 })
          .catch(() => { throw new BrowserStop('public_receipt_content_unavailable', target); });
        mediaEvidence = await verifyReceiptMedia(publicPage, controls, mediaPaths, target);
      }
      const screenshot = await this.sessions.evidence(studio, runId, item.itemId, 'studio_public');
      return { itemId: item.itemId, accountId: item.accountId, payloadDigest: item.payloadDigest,
        url: verifiedURL, public: true, evidenceDigest: fingerprint({ visibility: studioRow.visibility,
          handle: studioRow.handle, copy: studioRow.postText, title: item.payload.title,
          sound, media: mediaEvidence, thumbnailSize: [studioRow.thumbnailWidth, studioRow.thumbnailHeight],
          screenshot: createHash('sha256').update(screenshot).digest('hex') }) };
    }
    const page = await this.sessions.page(target);
    await page.goto(verifiedURL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    try { await assertSession(page, allowedProviderOrigins(item.target as Target)); }
    catch (error) {
      if (!(error instanceof BrowserStop) || error.message !== 'security_challenge') throw error;
      // Leave the receipt page visible for the owner to complete a provider challenge.
      await page.locator(controls.receiptText).first().waitFor({ state: 'visible', timeout: 10 * 60_000 }).catch(async () => {
        await assertSession(page, allowedProviderOrigins(item.target as Target));
        throw new BrowserStop('public_receipt_content_unavailable', item.target, controls.receiptText);
      });
    }
      await assertSession(page, allowedProviderOrigins(item.target as Target));
      const observedURL = receiptURL(page.url(), item);
      if (!sameReceiptURL(observedURL, verifiedURL, target)) throw new BrowserStop('public_receipt_redirected', item.target);
      verifiedURL = observedURL;
      if (controls.receiptExpand && await page.locator(controls.receiptExpand).isVisible()) await (await one(page, controls.receiptExpand)).click();
      // Pinterest may expose a partial description node while the rest of the
      // public copy is rendered in sibling rich-text nodes. Verify the exact
      // approved copy against the visible page text on both regional domains.
      let receiptText = target.startsWith('pinterest') ? page.locator('body') : page.locator(controls.receiptText);
      if (!target.startsWith('pinterest')) {
        try { await receiptText.first().waitFor({ state: 'visible', timeout: 30_000 }); }
        catch {
          await assertSession(page, allowedProviderOrigins(item.target as Target));
          const count = await receiptText.count();
          throw new BrowserStop('public_receipt_content_unavailable', item.target,
            `${controls.receiptText};count=${count}`);
        }
      }
      if (await receiptText.count() !== 1 || !await receiptText.isVisible()) {
        throw new BrowserStop('public_receipt_content_unavailable', item.target, 'description_ambiguous');
      }
      let text = await locatorText(receiptText, controls.receiptTextAttribute);
      if (target.startsWith('pinterest')) {
        // The Pin detail route can pass DOMContentLoaded before Pinterest has
        // hydrated its description and hashtag links. Wait for exact copy rather
        // than treating that transient partial body as a publication mismatch.
        for (let attempt = 0; attempt < 40 && !pinterestCopyMatches(text, item.payload.caption); attempt++) {
          await page.waitForTimeout(250);
          text = await locatorText(receiptText, controls.receiptTextAttribute);
        }
      }
      if (item.target === 'x') {
        const copy = await xReceiptCopyMatches(receiptText, item.payload.caption);
        if (!copy.matches) throw new BrowserStop('public_copy_mismatch', item.target, copy.detail);
      } else if (target.startsWith('pinterest')
        ? !pinterestCopyMatches(text, item.payload.caption)
        : !normalize(text).includes(normalize(item.payload.caption))) {
        throw new BrowserStop('public_copy_mismatch', item.target);
      }
      if (item.target !== 'x') {
        if (!controls.receiptTitle) throw new BrowserStop('public_title_mismatch', item.target);
        let receiptTitle = page.locator(controls.receiptTitle);
        if (target.startsWith('pinterest')) {
          receiptTitle = page.locator('[data-test-id="pinTitle"] h1');
          await receiptTitle.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
          if (await receiptTitle.count() === 0) {
            receiptTitle = page.getByRole('link', { name: item.payload.title, exact: true });
          }
          if (await receiptTitle.count() === 0) receiptTitle = page.locator('body');
        }
        if (await receiptTitle.count() !== 1 || !await receiptTitle.isVisible()) {
          throw new BrowserStop('public_title_mismatch', item.target, 'title_ambiguous');
        }
        if (!normalize(await locatorText(receiptTitle, controls.receiptTitleAttribute)).includes(normalize(item.payload.title))) {
          throw new BrowserStop('public_title_mismatch', item.target);
        }
      }
      if (sound && (!controls.receiptSound || !normalize(await locatorText(await one(page, controls.receiptSound), controls.receiptSoundAttribute)).includes(normalize(sound)))) throw new BrowserStop('public_sound_mismatch', item.target);
      let handle: string | null;
      if (item.target === 'x') {
        const identities = page.locator(controls.receiptAccount);
        const count = await identities.count();
        if (!count) throw new BrowserStop('public_account_mismatch', item.target);
        const observedHandles = await identities.evaluateAll((elements, attribute) => elements.map(element =>
          attribute ? element.getAttribute(attribute) : (element as HTMLElement).innerText), controls.receiptAccountAttribute);
        if (observedHandles.some(value => !value || !sameIdentity(value, account.handle))) {
          throw new BrowserStop('public_account_mismatch', item.target);
        }
        handle = observedHandles[0] ?? null;
      } else if (target.startsWith('pinterest')) {
        const identities = page.locator(controls.receiptAccount);
        const observedHandles = await identities.evaluateAll((elements, attribute) => elements.map(element =>
          attribute ? element.getAttribute(attribute) : (element as HTMLElement).innerText), controls.receiptAccountAttribute);
        if (!observedHandles.length || observedHandles.some(value => !value || !sameIdentity(value, account.handle))) {
          throw new BrowserStop('public_account_mismatch', item.target);
        }
        handle = observedHandles[0] ?? null;
      } else {
        const identity = await one(page, controls.receiptAccount);
        handle = controls.receiptAccountAttribute ? await identity.getAttribute(controls.receiptAccountAttribute) : await identity.innerText();
        if (!handle || !sameIdentity(handle, account.handle)) throw new BrowserStop('public_account_mismatch', item.target);
      }
      if (target.startsWith('pinterest')) {
        await this.sessions.evidence(page, runId, item.itemId, 'public_receipt_check');
      }
      const mediaEvidence = await verifyReceiptMedia(page, controls, mediaPaths, target);
      if (item.target.startsWith('pinterest')) {
        const screenshot = await this.sessions.evidence(page, runId, item.itemId, 'public_receipt');
        await verifyPinterestBoard(page, item, verifiedURL);
        return { itemId: item.itemId, accountId: item.accountId, payloadDigest: item.payloadDigest,
          url: verifiedURL, public: true, evidenceDigest: fingerprint({ text, handle, media: mediaEvidence,
            screenshot: createHash('sha256').update(screenshot).digest('hex'), boardVerified: true }) };
      } else if (item.target === 'reddit') {
        if (!controls.receiptDestination) throw new BrowserStop('public_destination_evidence_missing', item.target);
        const destination = await (await one(page, controls.receiptDestination)).getAttribute('href');
        const wanted = `/r/${item.payload.destination.slice(2)}/`;
        if (!destination || new URL(destination, providerOrigins[item.target as Target]).pathname.toLowerCase() !== wanted.toLowerCase()) throw new BrowserStop('public_destination_mismatch', item.target);
      }
      const screenshot = await this.sessions.evidence(page, runId, item.itemId, 'public_receipt');
      return { itemId: item.itemId, accountId: item.accountId, payloadDigest: item.payloadDigest,
        url: verifiedURL, public: true, evidenceDigest: fingerprint({ text, handle,
          media: mediaEvidence,
          screenshot: createHash('sha256').update(screenshot).digest('hex') }) };
  }
}
