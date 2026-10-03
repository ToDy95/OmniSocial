import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { BrowserProvider } from '../worker/browser-provider.ts';
import { BrowserSessions } from '../worker/browser-session.ts';
import { fingerprint } from '../worker/planner.ts';
import type { BrowserAccount } from '../worker/browser-config.ts';
import type { BrowserItem } from '../worker/browser-source.ts';

const controls: BrowserAccount['controls'] = { identity: '#identity', upload: '#upload', title: '#title', caption: '#caption',
  readyMedia: '#preview', publicReadback: '#privacy', publicText: 'Public', ownBrand: '#brand', paidPartnership: '#paid', aiGenerated: '#ai',
  submit: '#post', receiptLink: '#receipt', receiptText: '#receipt-text', receiptImage: '#receipt-image', receiptAccount: '#account',
  musicOpen: '#music', musicTrending: '#trending', musicRows: '.track', musicName: '.name', musicUse: '.use', musicSelected: '#selected' };
const account: BrowserAccount = { handle: '@fixture', identityUrl: 'https://www.tiktok.com/tiktokstudio',
  destination: '@fixture', visibility: 'public', musicPolicy: 'random_trending_top10', controls,
  disclosures: { ownBrand: true, paidPartnership: false, aiGenerated: true } };
function fixtureHTML() {
  return `<html><body><button role="tab" aria-selected="true">Photos</button><input type="file" id="upload">
    <img id="preview" width="300" height="200" style="display:none"><input id="title"><textarea id="caption"></textarea>
    <span id="privacy">Public</span><input id="brand" type="checkbox"><input id="paid" type="checkbox"><input id="ai" type="checkbox">
    <button id="music">Music</button><button id="trending">Trending</button><div id="tracks">
    ${Array.from({ length: 12 }, (_, index) => `<div class="track"><span class="name">Track ${index + 1}</span><button class="use" onclick="document.querySelector('#selected').innerText='Track ${index + 1}'">Use</button></div>`).join('')}</div>
    <span id="selected"></span><button id="post" onclick="document.querySelector('#posted').innerText='clicked'">Post</button><span id="posted"></span>
    <script>document.querySelector('#upload').onchange = event => { const image = document.querySelector('#preview'); image.onload = () => image.style.display='block'; image.src = URL.createObjectURL(event.target.files[0]); };</script></body></html>`;
}
test('Playwright composer uploads exact fixture, fills copy and selects only the first ten UI tracks', async () => {
  const browser = await chromium.launch({ headless: true });
  const directory = mkdtempSync(join(tmpdir(), 'omnisocial-provider-fixture-'));
  try {
    const bytes = await sharp(Buffer.from(Array.from({ length: 30 * 20 * 3 }, (_, i) => (i * 37) % 256)),
      { raw: { width: 30, height: 20, channels: 3 } }).png().toBuffer();
    const media = join(directory, 'fixture.png'); writeFileSync(media, bytes, { mode: 0o600 });
    const page = await browser.newPage();
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: fixtureHTML() }));
    const sessions = new BrowserSessions(); sessions.page = async () => page;
    const provider = new BrowserProvider(sessions);
    const payload = { title: 'Exact approved fixture title', caption: 'Exact approved fixture caption\n\n#fixture',
      media: { url: 'https://fixture.supabase.co/fixture.png', sha256: 'a'.repeat(64) }, destination: '@fixture',
      visibility: 'public', musicPolicy: 'random_trending_top10', disclosures: account.disclosures };
    const item = { itemId: 'b'.repeat(64), target: 'tiktok_codeonroids', accountId: '@fixture',
      payloadDigest: fingerprint(payload), payload } as BrowserItem;
    const prepared = await provider.composer(item, account, media);
    assert.match(prepared.sound!, /^Track ([1-9]|10)$/);
    assert.equal(await page.locator('#title').inputValue(), payload.title);
    assert.equal(await page.locator('#caption').inputValue(), payload.caption);
    assert.equal(await page.locator('#brand').isChecked(), true);
    assert.equal(await page.locator('#paid').isChecked(), false);
    assert.equal(await page.locator('#ai').isChecked(), true);
    await assert.rejects(provider.submit(page, item, account, prepared.sound, () => { throw new Error('stopped'); }), /stopped/);
    assert.equal(await page.locator('#posted').innerText(), '');
    let guards = 0;
    await provider.submit(page, item, account, prepared.sound, () => { guards++; });
    assert.equal(guards, 1);
    assert.equal(await page.locator('#posted').innerText(), 'clicked');
    // The only click here is inside intercepted fixture HTML, not TikTok.
  } finally { await browser.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('Playwright Reddit composer binds the exact destination and post type through the final click', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: `<html><body>
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
