import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { BrowserSource, mobileCaption, type BrowserItem } from '../worker/browser-source.ts';
import { BrowserSessions } from '../worker/browser-session.ts';
import type { BrowserConfig } from '../worker/browser-config.ts';

const config: BrowserConfig = { schemaVersion: 1, owner: 'fixture-owner', selected: ['reddit'], cap: 200,
  allowedMediaOrigins: ['https://fixture.supabase.co'], accounts: { reddit: {
    handle: 'u/Fixture', identityUrl: 'https://www.reddit.com/', destination: 'r/fixture', visibility: 'public', musicPolicy: 'none', postType: 'text',
  } } };
function mobile(processed: string[], omitContract = false) {
  return `<html><body><div data-slot="card"><div data-slot="card-description">u/Fixture</div>
    <div role="progressbar" aria-label="Publishing progress" aria-valuenow="${processed.length}" aria-valuemax="2"
      ${omitContract ? '' : `data-mobile-target="reddit" data-mobile-processed-slugs='${JSON.stringify(processed)}'`}></div>
    <h2>Fixture 1</h2><p>/fixture-1</p><button>Prepare this post</button></div></body></html>`;
}
function archive() {
  return `<html><body><h1>Historical content archive</h1>${[2, 1].map(index => `<div data-slot="card"
    data-archive-post-id="id-${index}" data-archive-published-at="2026-01-0${index}T00:00:00Z">
    <div data-slot="card-description">/fixture-${index}</div><div data-slot="card-title">Fixture ${index}</div>
    <span>Long: approved</span><div role="tablist"><button role="tab" onclick="this.parentElement.parentElement.querySelector('pre').innerText='Approved fixture ${index}'">Long social post</button></div>
    <pre>Published: Jan ${index}, 2026\nURL: https://www.razvantodica.com/blog/fixture-${index}</pre></div>`).join('')}</body></html>`;
}
test('Playwright UI discovery respects noncontiguous ledger slugs with no mutation or external network', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); const requests: string[] = [];
    await page.route('**/*', async route => {
      const request = route.request(); requests.push(request.method());
      assert.equal(new URL(request.url()).origin, 'https://www.razvantodica.com');
      await route.fulfill({ contentType: 'text/html', body: request.url().includes('/archive') ? archive() : mobile(['fixture-2']) });
    });
    const sessions = new BrowserSessions(); sessions.page = async () => page;
    const result = await new BrowserSource(sessions, () => {}).discover(config);
    assert.equal(result.manifest.items.length, 1);
    assert.equal((result.manifest.items[0] as any).articleId, 'id-1');
    assert.equal((result.manifest.items[0] as any).payload.caption, mobileCaption('Approved fixture 1', 'reddit'));
    assert.equal(requests.every(method => method === 'GET'), true);
    assert.deepEqual(result.progress, [{ target: 'reddit', processed: 1, total: 2, remaining: 1 }]);
  } finally { await browser.close(); }
});
test('old portfolio UI is a contract stop, never guessed from the numeric count', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: mobile([], true) }));
    const sessions = new BrowserSessions(); sessions.page = async () => page;
    await assert.rejects(new BrowserSource(sessions, () => {}).discover(config), /ui_contract_update_required/);
  } finally { await browser.close(); }
});

test('Playwright portfolio preparation and receipt writeback use visible forms and exact saved evidence', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const caption = mobileCaption('Approved fixture 1', 'reddit');
    const item = { target: 'reddit', slug: 'fixture-1', itemId: 'a'.repeat(64),
      payload: { title: 'Fixture 1', caption, destination: 'r/fixture', media: null } } as unknown as BrowserItem;
    let prepared = false, posted = false;
    let saved: Record<string, string> = {};
    const requests: string[] = [];
    await page.route('**/*', async route => {
      const request = route.request();
      assert.equal(new URL(request.url()).origin, 'https://www.razvantodica.com');
      requests.push(request.method());
      if (request.method() === 'POST') {
        if (request.url().endsWith('/fixture-prepare')) prepared = true;
        else { saved = request.postDataJSON(); posted = true; }
        await route.fulfill({ contentType: 'application/json', body: '{}' }); return;
      }
      const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
      await route.fulfill({ contentType: 'text/html', body: `<html><body><div data-slot="card">
        <div data-slot="card-description">u/Fixture</div><div role="progressbar" aria-label="Publishing progress"
        aria-valuenow="${posted ? 2 : 1}" aria-valuemax="2" data-mobile-target="reddit"
        data-mobile-processed-slugs='${JSON.stringify(posted ? ['fixture-1', 'fixture-2'] : ['fixture-2'])}'></div>
        ${posted ? '' : `<h2>Fixture 1</h2><p>/fixture-1</p>${prepared ? `<textarea id="mobile-post-caption">${escape(caption)}</textarea>` :
          '<button onclick="fetch(\'/fixture-prepare\',{method:\'POST\'}).then(()=>location.reload())">Prepare this post</button>'}`}
        </div>${prepared && !posted ? `<form onsubmit="event.preventDefault();fetch('/fixture-result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(this)))}).then(()=>location.reload())">
        <input name="target" value="reddit"><input name="slug" value="fixture-1"><input name="externalUrl"><input name="note"><input name="subreddit"><button>Posted / public</button></form>` : ''}
        ${posted ? `<p>Posted result saved in the cloud ledger</p><div data-slot="card"><h3>Recent cloud activity</h3>
        <div data-mobile-event-slug="fixture-1" data-mobile-event-target="reddit" data-mobile-event-result="posted"
        data-mobile-event-note="${escape(saved.note!)}"><span>fixture-1</span><span>Posted / public</span>
        <a href="${escape(saved.externalUrl!)}">Published receipt</a></div></div>` : ''}</body></html>` });
    });
    const sessions = new BrowserSessions(); sessions.page = async () => page;
    const source = new BrowserSource(sessions, () => {});
    await source.prepare(item, 'u/Fixture');
    assert.equal(prepared, true);
    const url = 'https://www.reddit.com/r/fixture/comments/fixture/example/';
    assert.deepEqual(await source.sync(item, url, null, 'fixture-sync'), { syncKey: 'fixture-sync', externalUrl: url, result: 'posted' });
    assert.equal(saved.subreddit, 'r/fixture');
    assert.equal(saved.note, `OmniSocial receipt fixture-sync; ${item.itemId}`);
    assert.equal(requests.filter(method => method === 'POST').length, 2);
    assert.deepEqual(await source.sync(item, url, null, 'fixture-sync'), { syncKey: 'fixture-sync', externalUrl: url, result: 'posted' });
    assert.equal(requests.filter(method => method === 'POST').length, 2);
    await assert.rejects(source.sync(item, url, null, 'wrong-sync'), /source_url_readback_unavailable/);
  } finally { await browser.close(); }
});
