import { chromium, type BrowserContext, type Locator, type Page } from 'playwright';
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { protectDirectory, root } from './local.ts';
import { portfolioOrigin, providerOrigins, composers, type BrowserAccount } from './browser-config.ts';
import { fingerprint } from './planner.ts';
import type { Target } from './planner.ts';

export class BrowserStop extends Error {
  readonly target?: string;
  constructor(code: string, target?: string) { super(code); this.target = target; }
}
export function allowedProfileNavigation(url: string, origin: string, manualGoogleLogin: boolean) {
  if (url === 'about:blank') return true;
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return false;
    return parsed.origin === origin || manualGoogleLogin && parsed.origin === 'https://accounts.google.com';
  } catch { return false; }
}
export function guardProfileNavigation(context: BrowserContext, origin: string, manualGoogleLogin: () => boolean) {
  const watch = (page: Page) => page.on('framenavigated', frame => {
    if (frame !== page.mainFrame()) return;
    if (!allowedProfileNavigation(frame.url(), origin, manualGoogleLogin())) void page.close().catch(() => {});
  });
  for (const page of context.pages()) watch(page);
  context.on('page', watch);
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
  private ownerLogins = new Set<string>();
  async identityPage(target: Target): Promise<Page> {
    const page = await this.page(target);
    let identity = this.identityPages.get(target);
    if (!identity || identity.isClosed()) {
      identity = await page.context().newPage(); this.identityPages.set(target, identity);
    }
    return identity;
  }
  async page(target: Target | 'portfolio'): Promise<Page> {
    // Entering automated work ends the manual-only OAuth navigation allowance.
    this.ownerLogins.delete(target);
    let context = this.contexts.get(target);
    if (!context) {
      const directory = join(root, 'profiles', target);
      protectDirectory(directory);
      context = await chromium.launchPersistentContext(directory, { headless: false, acceptDownloads: true,
        viewport: { width: 1400, height: 1000 }, locale: 'en-US', timeout: 30_000 });
      context.setDefaultTimeout(10_000);
      // Fixed origins only. The profile never points at the owner's daily Chrome data.
      const origin = target === 'portfolio' ? portfolioOrigin : providerOrigins[target];
      guardProfileNavigation(context, origin, () => target.startsWith('tiktok') && this.ownerLogins.has(target));
      this.contexts.set(target, context);
    }
    const origin = target === 'portfolio' ? portfolioOrigin : providerOrigins[target];
    const pages = context.pages();
    // An OAuth popup is never selected as the source/composer automation page.
    const page = pages.find(p => p.url().startsWith(`${origin}/`))
      ?? pages.find(p => p.url() === 'about:blank') ?? await context.newPage();
    return page;
  }
  async login(target: Target | 'portfolio', url: string) {
    const origin = target === 'portfolio' ? portfolioOrigin : providerOrigins[target];
    if (new URL(url).origin !== origin) throw new BrowserStop('login_origin_invalid');
    const page = await this.page(target);
    this.ownerLogins.add(target);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.bringToFront();
    return { status: 'awaiting_owner_login', target };
  }
  async inspect(target: Target, view: 'identity' | 'composer', account: BrowserAccount, jobId: string) {
    if (!/^[a-zA-Z0-9-]{1,72}$/.test(jobId)) throw new BrowserStop('inspection_input_invalid');
    const page = await this.page(target);
    const origin = providerOrigins[target];
    const url = view === 'identity' ? account.identityUrl : `${origin}${composers[target]}`;
    if (new URL(url).origin !== origin) throw new BrowserStop('inspection_origin_invalid');
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await assertSession(page, origin);
    if (target.startsWith('tiktok') && view === 'identity') await page.locator('a[href*="/@"]').first().waitFor();
    if (target.startsWith('tiktok') && view === 'composer') {
      await page.getByRole('tab', { name: 'Photos', exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
    }
    const controls = await page.locator('button, input:not([type="password"]), textarea, select, a, label, [role="tab"], [contenteditable="true"]')
      .evaluateAll(elements => elements.slice(0, 500).map(element => {
        const attributes: Record<string, string> = {};
        for (const name of ['id', 'class', 'name', 'type', 'role', 'aria-label', 'aria-selected', 'data-e2e', 'data-testid']) {
          const value = element.getAttribute(name); if (value) attributes[name] = value.slice(0, 250);
        }
        if (element instanceof HTMLAnchorElement) {
          try { const link = new URL(element.href); if (link.origin === location.origin) attributes.href = link.pathname; } catch {}
        }
        const box = element.getBoundingClientRect();
        return { tag: element.tagName.toLowerCase(), attributes,
          text: /^(BUTTON|A|LABEL)$/.test(element.tagName) || element.getAttribute('role') === 'tab'
            ? (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 180) : '',
          visible: box.width > 0 && box.height > 0 };
      }));
    await assertSession(page, origin);
    const directory = join(root, 'runtime/reports', `inspect-${jobId}`);
    protectDirectory(directory);
    const report = { target, view, url: new URL(page.url()).origin + new URL(page.url()).pathname,
      title: await page.title(), observedAt: new Date().toISOString(), controls };
    writeFileSync(join(directory, 'controls.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
    await this.evidence(page, `inspect-${jobId}`, fingerprint({ target, view }), 'ui_inspection');
    return { status: 'inspection_ready', target, view, report: join(directory, 'controls.json') };
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
    this.ownerLogins.clear();
    await Promise.allSettled(contexts.map(c => c.close()));
  }
}
