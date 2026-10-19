import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { BrowserProvider, studioThumbnailMatches } from '../worker/browser-provider.ts';
import { BrowserSessions } from '../worker/browser-session.ts';
import { fingerprint } from '../worker/planner.ts';
import type { BrowserAccount } from '../worker/browser-config.ts';
import type { BrowserItem } from '../worker/browser-source.ts';

const controls: BrowserAccount['controls'] = { identity: '#identity', upload: '#upload-button', title: '#title', caption: '#caption',
  readyMedia: '#preview', publicReadback: '#privacy', publicText: 'Public', ownBrand: '#brand', paidPartnership: '#paid', aiGenerated: '#ai',
  submit: '#post', receiptLink: '#receipt', receiptText: '#receipt-text', receiptImage: '#receipt-image', receiptAccount: '#account',
  musicOpen: '#music', musicTrending: '#trending', musicForYou: '#for-you', musicRows: '.track', musicName: '.name', musicUse: '.use', musicSelected: '#selected' };
const account: BrowserAccount = { handle: '@fixture', identityUrl: 'https://www.tiktok.com/tiktokstudio',
  destination: '@fixture', visibility: 'public', musicPolicy: 'random_trending_top10', controls,
  disclosures: { ownBrand: true, paidPartnership: false, aiGenerated: true } };
test('TikTok Studio portrait thumbnail matches its source cover crop but rejects different media', async () => {
  const width = 96, height = 64;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 3;
    pixels[offset] = (x * 7 + y * 3) % 256;
    pixels[offset + 1] = (x * 2 + y * 11) % 256;
    pixels[offset + 2] = (x * 13 + y * 5) % 256;
  }
  const source = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
  const thumbnail = await sharp(source).resize(40, 60, { fit: 'cover', position: 'centre' }).png().toBuffer();
  const different = await sharp(Buffer.alloc(width * height * 3, 220), { raw: { width, height, channels: 3 } }).png().toBuffer();
  assert.equal(await studioThumbnailMatches(source, thumbnail), true);
  assert.equal(await studioThumbnailMatches(different, thumbnail), false);
});
function fixtureHTML(unsavedPhotoPrompt = false, photosClickRemovesUploader = false, delayPhotoUploader = false, revealPhotoUploaderOnContinue = false) {
  const uploaderStyle = delayPhotoUploader ? 'style="display:none"' : '';
  const continueAction = `this.parentElement.remove();${revealPhotoUploaderOnContinue ? "document.querySelector('#upload-button').style.display='block';" : ''}`;
  return `<html><head><title>TikTok Studio fixture</title></head><body><button onclick="location.href='/tiktokstudio/upload/post/photo'">Upload</button>${unsavedPhotoPrompt ? `<div id="unsaved-prompt"><span>You have an unsaved photo post. Continue editing?</span><button onclick="${continueAction}">Continue</button></div>` : ''}
    <tiktok-cookie-banner><button onclick="this.parentElement.style.display='none'">Decline optional cookies</button></tiktok-cookie-banner>
    <button role="tab" aria-selected="true" onclick="${photosClickRemovesUploader ? "window.photoTabClicks=(window.photoTabClicks||0)+1;document.querySelector('#upload-button').remove()" : ''}">Photos</button><button id="upload-button" aria-label="Add photo" ${uploaderStyle} onclick="document.querySelector('#upload').click()"></button><input type="file" id="upload" style="display:none">
    <img id="preview" width="92" height="92" style="display:none;object-fit:cover"><input id="title"><textarea id="caption"></textarea>
    <span id="privacy">Public</span><div class="collapseToggle">Show less</div><div class="collapsibleItems">
    <div data-e2e="disclose_content_container"><button class="Switch__content" aria-checked="false"
      onclick="this.setAttribute('aria-checked','true')">Disclose post content</button></div>
    <button id="brand" role="switch" aria-checked="false" onclick="this.setAttribute('aria-checked','true')">Your brand</button>
    <input id="paid" type="checkbox"><button id="ai" role="switch" aria-checked="false" onclick="this.setAttribute('aria-checked','true')">AI-generated</button></div>
    <button id="music">Add sound</button><button id="trending">Trending</button>
    <button id="for-you" role="tab" aria-selected="false" onclick="this.setAttribute('aria-selected','true')">For You</button><div id="tracks">
    ${Array.from({ length: 12 }, (_, index) => `<div class="track"><span class="name">Track ${index + 1}</span><button class="use" onclick="document.querySelector('#selected').innerText='Track ${index + 1}'">Use</button></div>`).join('')}</div>
    <span id="selected"></span><button id="post" onclick="document.querySelector('#posted').innerText='clicked'">Post</button><span id="posted"></span>
    <script>document.querySelector('#upload').onchange = event => { const image = document.querySelector('#preview'); image.onload = () => image.style.display='block'; image.src = URL.createObjectURL(event.target.files[0]); };</script>
    ${delayPhotoUploader && !revealPhotoUploaderOnContinue ? `<script>setTimeout(()=>document.querySelector('#upload-button').style.display='block',75)</script>` : ''}</body></html>`;
}
for (const policy of ['random_trending_top10', 'random_for_you_top10'] as const) test(`Playwright composer binds ${policy} and selects only the first ten UI tracks`, async () => {
  const browser = await chromium.launch({ headless: true });
  const directory = mkdtempSync(join(tmpdir(), 'omnisocial-provider-fixture-'));
  try {
    const bytes = await sharp(Buffer.from(Array.from({ length: 30 * 20 * 3 }, (_, i) => (i * 37) % 256)),
      { raw: { width: 30, height: 20, channels: 3 } }).png().toBuffer();
    const media = join(directory, 'fixture.png'); writeFileSync(media, bytes, { mode: 0o600 });
    const page = await browser.newPage();
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: fixtureHTML() }));
    if (policy === 'random_for_you_top10') await page.goto('https://www.tiktok.com/tiktokstudio/upload/post/photo');
    let composerNavigations = 0;
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) composerNavigations++; });
    const sessions = new BrowserSessions(); sessions.page = async () => page;
    const provider = new BrowserProvider(sessions);
    const payload = { title: 'Exact approved fixture title', caption: 'Exact approved fixture caption\n\n#fixture',
      media: { url: 'https://fixture.supabase.co/fixture.png', sha256: 'a'.repeat(64) }, destination: '@fixture',
      visibility: 'public', musicPolicy: policy, disclosures: account.disclosures };
    const item = { itemId: 'b'.repeat(64), target: 'tiktok_codeonroids', accountId: '@fixture',
      payloadDigest: fingerprint(payload), payload } as BrowserItem;
    const prepared = await provider.composer(item, account, media);
    if (policy === 'random_for_you_top10') assert.equal(composerNavigations, 0);
    if (policy === 'random_for_you_top10') assert.equal(await page.locator('#for-you').getAttribute('aria-selected'), 'true');
    assert.match(prepared.sound!, /^Track ([1-9]|10)$/);
    assert.equal(await page.locator('#title').inputValue(), payload.title);
    assert.equal(await page.locator('#caption').inputValue(), payload.caption);
    assert.equal(await page.locator('#brand').getAttribute('aria-checked'), 'true');
    assert.equal(await page.locator('#paid').isChecked(), false);
    assert.equal(await page.locator('#ai').getAttribute('aria-checked'), 'true');
    await assert.rejects(provider.submit(page, item, account, prepared.sound, () => { throw new Error('stopped'); }), /stopped/);
    assert.equal(await page.locator('#posted').innerText(), '');
    let guards = 0;
    await provider.submit(page, item, account, prepared.sound, () => { guards++; });
    assert.equal(guards, 1);
    assert.equal(await page.locator('#posted').innerText(), 'clicked');
    // The only click here is inside intercepted fixture HTML, not TikTok.
  } finally { await browser.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('TikTok Studio photo section works without a Photos tab on the exact photo composer route', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html',
      body: fixtureHTML().replace('role="tab" aria-selected="true"', 'class="photo-section"') }));
    let composerNavigations = 0;
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) composerNavigations++; });
    const sessions = new BrowserSessions(); sessions.page = async () => page;
    const provider = new BrowserProvider(sessions);
    const payload = { title: 'Exact approved fixture title', caption: 'Exact approved fixture caption',
      media: null, destination: '@fixture', visibility: 'public', musicPolicy: 'random_trending_top10', disclosures: account.disclosures };
    const item = { itemId: 'e'.repeat(64), target: 'tiktok_codeonroids', accountId: '@fixture',
      payloadDigest: fingerprint(payload), payload } as BrowserItem;
    await provider.composer(item, account, null);
    assert.equal(composerNavigations, 2);
    assert.equal(await page.url(), 'https://www.tiktok.com/tiktokstudio/upload/post/photo');
    assert.equal(await page.getByRole('tab', { name: 'Photos', exact: true }).count(), 0);
    assert.equal(await page.getByText('Photos', { exact: true }).count(), 1);
    assert.equal(await page.locator('#upload-button').isVisible(), true);
    assert.equal(await page.locator('#title').inputValue(), payload.title);
  } finally { await browser.close(); }
});

test('TikTok uploads the approved image after continuing an empty unsaved photo draft', async () => {
  const browser = await chromium.launch({ headless: true });
  const directory = mkdtempSync(join(tmpdir(), 'omnisocial-empty-draft-'));
  try {
    const bytes = await sharp(Buffer.from(Array.from({ length: 30 * 20 * 3 }, (_, i) => (i * 37) % 256)),
      { raw: { width: 30, height: 20, channels: 3 } }).png().toBuffer();
    const media = join(directory, 'fixture.png'); writeFileSync(media, bytes, { mode: 0o600 });
    const page = await browser.newPage();
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: fixtureHTML(true, true, true, true) }));
    const sessions = new BrowserSessions(); sessions.page = async () => page;
    const provider = new BrowserProvider(sessions);
    const payload = { title: 'Exact approved fixture title', caption: 'Exact approved fixture caption\n\n#fixture',
      media: { url: 'https://fixture.supabase.co/fixture.png', sha256: 'a'.repeat(64) }, destination: '@fixture',
      visibility: 'public', musicPolicy: 'random_trending_top10', disclosures: account.disclosures };
    const item = { itemId: 'd'.repeat(64), target: 'tiktok_codeonroids', accountId: '@fixture',
      payloadDigest: fingerprint(payload), payload } as BrowserItem;
    await provider.composer(item, account, media);
    assert.equal(await page.locator('#unsaved-prompt').count(), 0);
    assert.equal(await page.evaluate(() => (window as typeof window & { photoTabClicks?: number }).photoTabClicks ?? 0), 0);
    assert.equal(await page.locator('#preview').isVisible(), true);
    assert.equal(await page.locator('#upload').evaluate(element => (element as HTMLInputElement).files?.length), 1);
    assert.equal(await page.locator('#title').inputValue(), payload.title);
    assert.equal(await page.locator('#caption').inputValue(), payload.caption);
    // A resumed draft with visible foreign media must stop before another upload.
    const different = await sharp({ create: { width: 30, height: 20, channels: 3, background: 'white' } }).png().toBuffer();
    await page.locator('#preview').evaluate((element, encoded) => new Promise<void>(resolve => {
      const image = element as HTMLImageElement; image.onload = () => resolve(); image.src = `data:image/png;base64,${encoded}`;
    }), different.toString('base64'));
    await assert.rejects(provider.composer(item, account, media), /existing_photo_draft_mismatch/);
    assert.equal(await page.locator('#upload').evaluate(element => (element as HTMLInputElement).files?.length), 1);
    assert.equal(await page.locator('#posted').innerText(), '');
  } finally { await browser.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('For You requires its exact selected category and never falls back to Trending', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html',
      body: fixtureHTML().replace("this.setAttribute('aria-selected','true')", '') }));
    const sessions = new BrowserSessions(); sessions.page = async () => page;
    const provider = new BrowserProvider(sessions);
    const payload = { title: 'Fixture', caption: 'Exact fixture', destination: '@fixture', visibility: 'public',
      musicPolicy: 'random_for_you_top10', disclosures: account.disclosures, media: null };
    const item = { itemId: 'b'.repeat(64), target: 'tiktok_codeonroids', accountId: '@fixture',
      payloadDigest: fingerprint(payload), payload } as unknown as BrowserItem;
    await assert.rejects(provider.composer(item, account, null), /music_category_mismatch/);
    assert.equal(await page.locator('#selected').innerText(), '');
    await assert.rejects(provider.composer(item, { ...account, controls: { ...controls!, musicForYou: undefined } }, null), /music_controls_unavailable/);
    assert.equal(await page.locator('#posted').innerText(), '');
    assert.notEqual(fingerprint(payload), fingerprint({ ...payload, musicPolicy: 'random_trending_top10' }));
    await page.goto('https://foreign.invalid/tiktokstudio/upload/post/photo');
    await assert.rejects(provider.composer(item, account, null), /music_category_mismatch/);
    assert.equal(await page.url(), 'https://www.tiktok.com/tiktokstudio/upload/post/photo');
    assert.equal(await page.locator('#posted').innerText(), '');
  } finally { await browser.close(); }
});

test('TikTok identity waits for the expected profile link to hydrate before checking the account', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: `<html><head><title>Identity fixture</title></head><body>
      <div id="profile"></div><script>setTimeout(()=>document.querySelector('#profile').innerHTML='<a id="identity" href="/@fixture">fixture</a>',75)</script>
      </body></html>` }));
    const sessions = new BrowserSessions(); sessions.identityPage = async () => page;
    const provider = new BrowserProvider(sessions);
    const fixtureAccount: BrowserAccount = { ...account, controls: { ...controls!, identity: '#identity', identityAttribute: 'href' } };
    const result = await provider.identity('tiktok_codeonroids', fixtureAccount);
    assert.equal(result.accountId, '@fixture');
    assert.equal(await page.locator('#identity').count(), 1);
  } finally { await browser.close(); }
});

test('TikTok resolves the new photo permalink from Studio when the composer has no receipt link', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const studioPage = await browser.newPage();
    await studioPage.route('**/*', route => route.fulfill({ contentType: 'text/html', body: `<html><body>
      <div class="post-row"><a href="/@fixture/photo/123">Exact approved caption for the new photo post</a></div>
      </body></html>` }));
    const sessions = new BrowserSessions();
    sessions.identityPage = async () => studioPage;
    const provider = new BrowserProvider(sessions);
    const receiptControls = { ...controls!, receiptLink: 'a[href*="/@fixture/"]' };
    const fixtureAccount: BrowserAccount = { ...account, musicPolicy: 'none', controls: receiptControls };
    const payload = { title: 'Receipt title', caption: 'Exact approved caption for the new photo post', media: null,
      destination: '@fixture', visibility: 'public', musicPolicy: 'none' };
    const item = { target: 'tiktok_codeonroids', accountId: '@fixture', itemId: 'd'.repeat(64),
      payloadDigest: fingerprint(payload), payload } as BrowserItem;
    const url = await provider.resultURL(await browser.newPage(), item, fixtureAccount, []);
    assert.equal(url, 'https://www.tiktok.com/@fixture/photo/123');
    assert.equal(await studioPage.url(), 'https://www.tiktok.com/tiktokstudio/content');
  } finally { await browser.close(); }
});

test('TikTok public receipt verification reuses its authenticated profile and confirms Everyone in Studio', async t => {
  const browser = await chromium.launch({ headless: true });
  try {
    const studioPage = await browser.newPage();
    const payload = { title: 'Receipt title', caption: 'Receipt caption', media: null,
      destination: '@fixture', visibility: 'public', musicPolicy: 'none' };
    const item = { target: 'tiktok_codeonroids', accountId: '@fixture', itemId: 'c'.repeat(64),
      payloadDigest: fingerprint(payload), payload } as BrowserItem;
    const receiptControls = { ...controls!, receiptLink: 'a[href^="/@fixture/"]' };
    let studioVisibility = 'Everyone';
    let reviewStatus = '';
    await studioPage.route('**/*', route => route.fulfill({ contentType: 'text/html', body: `<html><body>
      <div class="post-row"><img width="40" height="40" src="/thumbnail.jpg"><a class="post-link" href="/@fixture/video/123">Receipt caption</a>
        <button>${studioVisibility}</button>${reviewStatus ? `<span id="review-status">${reviewStatus}</span>` : ''}</div>
      ${reviewStatus ? `<script>setTimeout(()=>{document.querySelector('button').textContent='Everyone';document.querySelector('#review-status')?.remove()},1200)</script>` : ''}
      </body></html>` }));
    const sessions = new BrowserSessions();
    sessions.page = async () => { throw new Error('unexpected_post_page'); };
    sessions.identityPage = async () => studioPage;
    sessions.evidence = async () => Buffer.from('fixture-evidence');
    t.mock.method(chromium, 'launch', async () => { throw new Error('unexpected_new_browser'); });
    const provider = new BrowserProvider(sessions);
    const fixtureAccount: BrowserAccount = { ...account, musicPolicy: 'none', controls: receiptControls };
    const receipt = await provider.verify(item, fixtureAccount, 'https://www.tiktok.com/@fixture/photo/123', null, 'fixture-run', null);
    assert.equal(receipt.public, true);
    assert.equal(receipt.url, 'https://www.tiktok.com/@fixture/photo/123');
    assert.equal(await studioPage.url(), 'https://www.tiktok.com/tiktokstudio/content');
    studioVisibility = 'Only me';
    reviewStatus = 'Content under review';
    const reviewedReceipt = await provider.verify(item, fixtureAccount, receipt.url, null, 'fixture-run', null);
    assert.equal(reviewedReceipt.public, true);
    studioVisibility = 'Only me';
    reviewStatus = '';
    await assert.rejects(provider.verify(item, fixtureAccount, receipt.url, null, 'fixture-run', null), /public_visibility_readback_mismatch/);
  } finally { await browser.close(); }
});

test('Playwright Reddit composer binds the exact destination and post type through the final click', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: `<html><head><title>Reddit fixture</title></head><body>
      <button id="type-text" aria-selected="false" onclick="this.setAttribute('aria-selected','true')">Text</button>
      <button id="type-image" aria-selected="false">Images</button><input id="title"><textarea id="caption"></textarea>
      <span id="privacy">Public</span><button id="destination">Choose community</button>
      <button id="option" onclick="document.querySelector('#destination-name').innerText='r/fixture'">r/fixture</button><span id="destination-name"></span>
      <button id="post" onclick="document.querySelector('#posted').innerText='clicked'">Post</button><span id="posted"></span></body></html>` }));
    const sessions = new BrowserSessions(); sessions.page = async () => page;
    const provider = new BrowserProvider(sessions);
    const reddit: BrowserAccount = { handle: 'u/fixture', identityUrl: 'https://www.reddit.com/',
      destination: 'r/fixture', visibility: 'public', musicPolicy: 'none', postType: 'text',
      controls: { ...controls!, destination: '#destination', destinationOption: '#option', destinationReadback: '#destination-name',
        postTypeTabs: { text: '#type-text', image: '#type-image' } } };
    const payload = { title: 'Fixture title', caption: 'Fixture caption', media: null,
      destination: 'r/fixture', visibility: 'public', musicPolicy: 'none', postType: 'text', flair: null };
    const item = { target: 'reddit', accountId: 'u/fixture', itemId: 'a'.repeat(64), payload, payloadDigest: fingerprint(payload) } as BrowserItem;
    await provider.composer(item, reddit, null);
    await page.locator('#option').evaluate(el => el.remove());
    await page.locator('#destination-name').evaluate(el => el.textContent = 'r/other');
    await assert.rejects(provider.submit(page, item, reddit, null, () => {}), /destination_readback_mismatch/);
    assert.equal(await page.locator('#posted').innerText(), '');
    await page.locator('#destination-name').evaluate(el => el.textContent = 'r/fixture');
    await page.locator('#type-text').evaluate(el => el.setAttribute('aria-selected', 'false'));
    await assert.rejects(provider.submit(page, item, reddit, null, () => {}), /post_type_readback_mismatch/);
    assert.equal(await page.locator('#posted').innerText(), '');
    await page.locator('#type-text').click();
    await provider.submit(page, item, reddit, null, () => {});
    assert.equal(await page.locator('#posted').innerText(), 'clicked');
  } finally { await browser.close(); }
});
