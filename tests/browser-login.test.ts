import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { root } from '../worker/local.ts';
import { allowedProfileNavigation, assertSession, BrowserSessions, existingProfileInUse, guardProfileNavigation, waitForHydratedPage } from '../worker/browser-session.ts';

test('an already-open persistent profile is reported without starting a duplicate browser', () => {
  assert.equal(existingProfileInUse(new Error('Opening in existing browser session. This usually means that the profile is already in use.')), true);
  assert.equal(existingProfileInUse(new Error('browser executable was not found')), false);
  assert.equal(existingProfileInUse('profile is busy'), false);
});

test('Google OAuth allowance is exact, manual-only and never accepts another host or embedded credentials', () => {
  const origin = 'https://www.tiktok.com';
  assert.equal(allowedProfileNavigation('https://accounts.google.com/o/oauth2/auth', origin, true), true);
  assert.equal(allowedProfileNavigation('https://accounts.google.com/o/oauth2/auth', origin, false), false);
  for (const url of ['https://accounts.google.com.evil.invalid/', 'http://accounts.google.com/',
    'https://accounts.google.com:8443/', 'https://user:secret@accounts.google.com/', 'https://mail.google.com/']) {
    assert.equal(allowedProfileNavigation(url, origin, true), false);
  }
  assert.equal(allowedProfileNavigation(`${origin}/login`, origin, false), true);
});

test('session checks ignore hidden challenge controls but stop on a visible CAPTCHA', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: `<html><body>
      <iframe id="captcha-frame" src="/captcha" style="display:none"></iframe>
      <input id="otp" autocomplete="one-time-code" style="display:none">
    </body></html>` }));
    await page.goto('https://www.tiktok.com/@fixture/photo/123');
    await assertSession(page, 'https://www.tiktok.com');
    await page.locator('#captcha-frame').evaluate(element => (element as HTMLElement).style.display = 'block');
    await assert.rejects(assertSession(page, 'https://www.tiktok.com'), /security_challenge/);
  } finally { await browser.close(); }
});

test('fixed inspection stops on a provider shell that never hydrates', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<html><head></head><body></body></html>' }));
    await page.goto('https://x.com/home');
    await assert.rejects(waitForHydratedPage(page, 'https://x.com', 'x', 25), /provider_page_not_hydrated/);
  } finally { await browser.close(); }
});

test('fixed profile inspection reads selected UI without writes and excludes credential field values', async () => {
  const browser = await chromium.launch({ headless: true });
  const jobId = `fixture-${randomUUID()}`;
  const directory = join(root, 'runtime/reports', `inspect-${jobId}`);
  try {
    const context = await browser.newContext(); await context.newPage();
    await context.route('**/*', async route => {
      assert.equal(route.request().method(), 'GET');
      assert.equal(new URL(route.request().url()).origin, 'https://www.tiktok.com');
      await route.fulfill({ contentType: 'text/html', body: `<a href="/@fixture?token=never-export">fixture</a>
        <input name="email" value="never-export"><input type="password" value="private-fixture">
        <button data-e2e="upload">Upload</button>` });
    });
    const sessions = new BrowserSessions(); (sessions as any).contexts.set('personal', context);
    const account = { handle: '@fixture', identityUrl: 'https://www.tiktok.com/tiktokstudio',
      destination: '@fixture', visibility: 'public', musicPolicy: 'none' } as const;
    const result = await sessions.inspect('tiktok_personal', 'identity', account, jobId);
    assert.equal(result.status, 'inspection_ready');
    const text = readFileSync(result.report, 'utf8');
    assert.equal(text.includes('never-export'), false); assert.equal(text.includes('private-fixture'), false);
    assert.equal(text.includes('"href": "/@fixture"'), true);
    assert.equal(statSync(result.report).mode & 0o077, 0);
    assert.equal(statSync(directory).mode & 0o077, 0);
    await assert.rejects(sessions.inspect('tiktok_personal', 'identity', account, '../unsafe'), /inspection_input_invalid/);
    await sessions.close();
  } finally { await browser.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('Playwright preserves manual Google popup, returns to TikTok and ends OAuth allowance before automation', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await context.route('**/*', async route => {
      const origin = new URL(route.request().url()).origin;
      assert.ok(['https://www.tiktok.com', 'https://accounts.google.com'].includes(origin));
      await route.fulfill({ contentType: 'text/html', body: origin === 'https://www.tiktok.com'
        ? '<a target="_blank" href="https://accounts.google.com/o/oauth2/auth">Continue with Google</a>'
        : '<h1>Fixture Google sign-in</h1><a href="https://www.tiktok.com/oauth/callback">Return to TikTok</a>' });
    });
    const sessions = new BrowserSessions();
    // Inject only an intercepted headless fixture context, never real browser state.
    (sessions as any).contexts.set('business', context);
    guardProfileNavigation(context, 'https://www.tiktok.com', () => (sessions as any).ownerLogins.has('business'));
    await sessions.login('tiktok_codeonroids', 'https://www.tiktok.com/login');
    const popupEvent = page.waitForEvent('popup');
    await page.getByRole('link', { name: 'Continue with Google' }).click();
    const popup = await popupEvent;
    await popup.getByRole('heading', { name: 'Fixture Google sign-in' }).waitFor();
    assert.equal(popup.isClosed(), false);
    await assert.rejects(assertSession(popup, 'https://www.tiktok.com'), /login_or_navigation_required/);
    await popup.getByRole('link', { name: 'Return to TikTok' }).click();
    await popup.waitForURL('https://www.tiktok.com/oauth/callback');
    assert.equal(popup.isClosed(), false);
    await sessions.page('tiktok_codeonroids');
    assert.equal((sessions as any).ownerLogins.has('business'), false);
    const closed = popup.waitForEvent('close');
    await popup.goto('https://accounts.google.com/o/oauth2/auth').catch(() => {});
    await closed;
    await assert.rejects(sessions.login('tiktok_codeonroids', 'https://accounts.google.com/'), /login_origin_invalid/);
    await sessions.close();
  } finally { await browser.close(); }
});
