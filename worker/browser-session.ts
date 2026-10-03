import { chromium, type BrowserContext, type Locator, type Page } from 'playwright';
import { chmodSync } from 'node:fs';
import { join } from 'node:path';
import { protectDirectory, root } from './local.ts';
import { portfolioOrigin, providerOrigins } from './browser-config.ts';
import type { Target } from './planner.ts';

export class BrowserStop extends Error {
  readonly target?: string;
  constructor(code: string, target?: string) { super(code); this.target = target; }
}
export async function one(page: Page, selector: string): Promise<Locator> {
  const locator = page.locator(selector);
  if (await locator.count() !== 1 || !await locator.isVisible()) throw new BrowserStop('unexpected_ui');
  return locator;
}
export async function assertSession(page: Page, origin: string) {
  if (new URL(page.url()).origin !== origin) throw new BrowserStop('login_or_navigation_required');
  if (/\/(login|auth|challenge)(\/|\?|$)/i.test(new URL(page.url()).pathname)) throw new BrowserStop('login_required');
  if (await page.locator('iframe[src*="captcha"], iframe[title*="captcha" i], input[autocomplete="one-time-code"]').count()) throw new BrowserStop('security_challenge');
  const challenge = page.getByText(/^(Verify you are human|Security verification|Enter verification code|Complete the CAPTCHA)$/i);
  if (await challenge.count() && await challenge.first().isVisible()) throw new BrowserStop('security_challenge');
}
export class BrowserSessions {
  private contexts = new Map<string, BrowserContext>();
  private identityPages = new Map<string, Page>();
  async identityPage(target: Target): Promise<Page> {
    const page = await this.page(target);
    let identity = this.identityPages.get(target);
    if (!identity || identity.isClosed()) {
      identity = await page.context().newPage(); this.identityPages.set(target, identity);
    }
    return identity;
  }
  async page(target: Target | 'portfolio'): Promise<Page> {
    let context = this.contexts.get(target);
    if (!context) {
      const directory = join(root, 'profiles', target);
      protectDirectory(directory);
      context = await chromium.launchPersistentContext(directory, { headless: false, acceptDownloads: true,
        viewport: { width: 1400, height: 1000 }, locale: 'en-US', timeout: 30_000 });
      context.setDefaultTimeout(10_000);
      // Fixed origins only. The profile never points at the owner's daily Chrome data.
      const origin = target === 'portfolio' ? portfolioOrigin : providerOrigins[target];
      context.on('page', page => page.on('framenavigated', frame => {
        if (frame !== page.mainFrame() || frame.url() === 'about:blank') return;
        try { if (new URL(frame.url()).origin !== origin) void page.close(); } catch { void page.close(); }
      }));
      this.contexts.set(target, context);
    }
    const pages = context.pages();
    const page = pages[0] ?? await context.newPage();
    return page;
  }
  async login(target: Target | 'portfolio', url: string) {
    const page = await this.page(target);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.bringToFront();
    return { status: 'awaiting_owner_login', target };
  }
  async evidence(page: Page, runId: string, itemId: string, stage: string) {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(runId) || !/^[a-f0-9]{64}$/.test(itemId)
      || !/^[a-z_]{1,40}$/.test(stage)) throw new Error('evidence_reference_invalid');
    const directory = join(root, 'runtime/reports', runId);
    protectDirectory(directory);
    const path = join(directory, `${itemId}-${stage}.png`);
    const bytes = await page.screenshot({ path, fullPage: false });
    chmodSync(path, 0o600);
    return bytes;
  }
  async close() {
    const contexts = [...this.contexts.values()]; this.contexts.clear();
    this.identityPages.clear();
    await Promise.allSettled(contexts.map(c => c.close()));
  }
}
