import { chromium, type BrowserContext, type Locator, type Page } from 'playwright';
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { protectDirectory, root, targets } from './local.ts';
import { portfolioOrigin, providerOrigins, allowedProviderOrigins, composers, requireControls, type BrowserAccount } from './browser-config.ts';
import { fingerprint } from './planner.ts';
import type { Target } from './planner.ts';

export class BrowserStop extends Error {
  readonly target?: string;
  readonly uiControl?: string;
  constructor(code: string, target?: string, uiControl?: string) { super(code); this.target = target; this.uiControl = uiControl; }
}
export function existingProfileInUse(error: unknown) {
  return error instanceof Error && /Opening in existing browser session|user data directory is already in use|profile.*already in use/i.test(error.message);
}
type ProfileKey = 'portfolio' | 'personal' | 'business';
function profileKey(target: Target | 'portfolio'): ProfileKey {
  if (target === 'portfolio') return 'portfolio';
  return target === 'tiktok_personal' || target === 'pinterest_personal' || target === 'reddit'
    ? 'personal' : 'business';
}
function profileDirectory(profile: ProfileKey) {
  return profile === 'personal' ? 'tiktok_personal'
    : profile === 'business' ? 'tiktok_codeonroids' : 'portfolio';
}
function profileOrigins(profile: ProfileKey): string[] {
  if (profile === 'portfolio') return [portfolioOrigin];
  return [...new Set(targets.filter(target => profileKey(target) === profile).flatMap(target => allowedProviderOrigins(target)))];
}
export function allowedProfileNavigation(url: string, origins: string | readonly string[], manualGoogleLogin: boolean) {
  if (url === 'about:blank') return true;
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return false;
    const allowed = typeof origins === 'string' ? [origins] : origins;
    return allowed.includes(parsed.origin) || manualGoogleLogin && parsed.origin === 'https://accounts.google.com';
  } catch { return false; }
}
export function guardProfileNavigation(context: BrowserContext, origins: string | readonly string[], manualGoogleLogin: () => boolean) {
  const watch = (page: Page) => page.on('framenavigated', frame => {
    if (frame !== page.mainFrame()) return;
    if (!allowedProfileNavigation(frame.url(), origins, manualGoogleLogin())) void page.close().catch(() => {});
  });
  for (const page of context.pages()) watch(page);
  context.on('page', watch);
}
export function selectAutomationPage(pages: Page[], origin: string | readonly string[], identityPage?: Page,
  preferredPaths: readonly string[] = []) {
  const origins = typeof origin === 'string' ? [origin] : origin;
  const candidates = pages.filter(page => page !== identityPage && !page.isClosed());
  const preferred = candidates.find(page => {
    try { const url = new URL(page.url()); return origins.includes(url.origin) && preferredPaths.includes(url.pathname); }
    catch { return false; }
  });
  const photoComposer = candidates.find(page => {
    try {
      const url = new URL(page.url());
      return origins.includes(url.origin) && url.pathname === '/tiktokstudio/upload/post/photo';
    } catch { return false; }
  });
  return preferred ?? photoComposer
    ?? candidates.find(page => {
      try { return origins.includes(new URL(page.url()).origin); } catch { return false; }
    })
    ?? candidates.find(page => page.url() === 'about:blank');
}
export async function one(page: Page, selector: string): Promise<Locator> {
  const locator = page.locator(selector);
  const count = await locator.count();
  if (count !== 1) throw new BrowserStop('unexpected_ui', undefined, `${selector};count=${count}`);
  if (!await locator.isVisible()) throw new BrowserStop('unexpected_ui', undefined, `${selector};count=1;visible=false`);
  return locator;
}
export async function assertSession(page: Page, origins: string | readonly string[]) {
  const allowed = typeof origins === 'string' ? [origins] : origins;
  if (!allowed.includes(new URL(page.url()).origin)) throw new BrowserStop('login_or_navigation_required');
  if (/\/(login|auth|challenge)(\/|\?|$)/i.test(new URL(page.url()).pathname)) throw new BrowserStop('login_required');
  const challengeControls = page.locator('iframe[src*="captcha"], iframe[title*="captcha" i], input[autocomplete="one-time-code"]')
    .filter({ visible: true });
  if (await challengeControls.count()) throw new BrowserStop('security_challenge');
  const challenge = page.getByText(/^(Verify you are human|Security verification|Enter verification code|Complete the CAPTCHA|Drag the slider to fit the puzzle)$/i);
  if (await challenge.count() && await challenge.first().isVisible()) throw new BrowserStop('security_challenge');
}
export async function waitForHydratedPage(page: Page, origins: string | readonly string[], target: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    await assertSession(page, origins);
    const title = (await page.title()).trim();
    const body = (await page.locator('body').innerText().catch(() => '')).trim();
    if (title && body) return;
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new BrowserStop('provider_page_not_hydrated', target);
    await page.waitForTimeout(Math.min(250, remaining));
  }
}
export async function dismissOptionalCookies(page: Page, target?: string): Promise<string> {
  const banner = page.locator('tiktok-cookie-banner');
  try { await banner.waitFor({ state: 'visible', timeout: 10_000 }); } catch { return 'no_banner'; }
  await page.waitForTimeout(500);
  const decline = page.getByRole('button', { name: 'Decline optional cookies', exact: true }).filter({ visible: true });
  const count = await decline.count();
  if (count > 1) throw new BrowserStop('cookie_choice_ambiguous', target);
  if (count === 1) {
    await decline.click();
    await decline.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {
      throw new BrowserStop('cookie_choice_unconfirmed', target);
    });
    return 'rejected_semantic_button';
  }
  // TikTok renders its banner in a closed shadow root; use the visible reject button's
  // stable location only at the worker's fixed desktop viewport, then verify it cleared.
  if (await banner.count() !== 1) throw new BrowserStop('cookie_choice_ambiguous', target);
  const viewport = page.viewportSize();
  if (!viewport || viewport.width !== 1400 || viewport.height !== 1000) throw new BrowserStop('cookie_choice_ui_changed', target);
  const x = Math.round(viewport.width * 0.747);
  const y = viewport.height - 113;
  await page.mouse.click(x, y);
  await page.waitForTimeout(750);
  const state = await page.evaluate(({ x, y }) => ({
    hit: document.elementFromPoint(x, y)?.tagName.toLowerCase() ?? null,
    banner: (() => { const el = document.querySelector('tiktok-cookie-banner'); if (!el) return null;
      const box = el.getBoundingClientRect(), style = getComputedStyle(el);
      return { x: box.x, y: box.y, width: box.width, height: box.height,
        display: style.display, visibility: style.visibility, pointerEvents: style.pointerEvents,
        shadowOpen: Boolean((el as HTMLElement).shadowRoot) };
    })(),
  }), { x, y });
  if (state.hit === 'tiktok-cookie-banner' || state.banner?.pointerEvents !== 'none') {
    throw new BrowserStop('cookie_choice_unconfirmed', target, JSON.stringify(state));
  }
  return 'rejected_coordinate_button';
}
export class BrowserSessions {
  private contexts = new Map<ProfileKey, BrowserContext>();
  private identityPages = new Map<string, Page>();
  private ownerLogins = new Set<ProfileKey>();
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
    const profile = profileKey(target);
    this.ownerLogins.delete(profile);
    let context = this.contexts.get(profile);
    if (!context) {
      const directory = join(root, 'profiles', profileDirectory(profile));
      protectDirectory(directory);
      try {
        context = await chromium.launchPersistentContext(directory, { headless: false, acceptDownloads: true,
          viewport: { width: 1400, height: 1000 }, locale: 'en-US', timeout: 30_000 });
      } catch (error) {
        if (existingProfileInUse(error)) throw new BrowserStop('existing_profile_in_use', target, profile);
        throw error;
      }
      context.setDefaultTimeout(10_000);
      // Each dedicated profile has a fixed provider allowlist and never uses daily Chrome data.
      guardProfileNavigation(context, profileOrigins(profile), () => profile !== 'portfolio' && this.ownerLogins.has(profile));
      this.contexts.set(profile, context);
    }
    const origin = target === 'portfolio' ? portfolioOrigin : providerOrigins[target];
    const origins = target === 'portfolio' ? [portfolioOrigin] : allowedProviderOrigins(target);
    const preferredPaths = target.startsWith('tiktok') ? ['/tiktokstudio/upload/post/photo']
      : target.startsWith('pinterest') ? ['/pin-creation-tool/', '/pin-builder/']
        : target === 'x' ? ['/compose/post', '/home'] : ['/submit'];
    const pages = context.pages();
    // An OAuth popup is never selected as the source/composer automation page.
    const page = selectAutomationPage(pages, origins, target === 'portfolio' ? undefined : this.identityPages.get(target), preferredPaths)
      ?? await context.newPage();
    return page;
  }
  async login(target: Target | 'portfolio', url: string) {
    const allowed = target === 'portfolio' ? [portfolioOrigin] : allowedProviderOrigins(target);
    if (!allowed.includes(new URL(url).origin)) throw new BrowserStop('login_origin_invalid');
    const page = await this.page(target);
    this.ownerLogins.add(profileKey(target));
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.bringToFront();
    return { status: 'awaiting_owner_login', target };
  }
  async inspect(target: Target, view: 'identity' | 'composer' | 'posts', account: BrowserAccount, jobId: string) {
    if (!/^[a-zA-Z0-9-]{1,72}$/.test(jobId)) throw new BrowserStop('inspection_input_invalid');
    const page = view === 'posts' ? await this.identityPage(target) : await this.page(target);
    const origin = providerOrigins[target];
    const url = view === 'composer' ? `${origin}${composers[target]}` : account.identityUrl;
    const allowed = allowedProviderOrigins(target);
    if (!allowed.includes(new URL(url).origin)) throw new BrowserStop('inspection_origin_invalid');
    let disclosureProbe: object | undefined;
    let disclosureOptionsProbe: object | undefined;
    let cookieChoice: unknown;
    const current = new URL(page.url());
    const alreadyOnComposer = view === 'composer' && allowed.includes(current.origin)
      && (target.startsWith('pinterest') && ['/pin-creation-tool/', '/pin-builder/'].includes(current.pathname)
        || target === 'x' && current.pathname === '/compose/post');
    if (!alreadyOnComposer) await page.goto(url, { waitUntil: 'domcontentloaded' });
    await assertSession(page, allowed);
    if (!target.startsWith('tiktok')) await waitForHydratedPage(page, allowed, target);
    if (target.startsWith('tiktok')) {
      try { cookieChoice = await dismissOptionalCookies(page, target); }
      catch (error) { cookieChoice = { status: 'error', reason: error instanceof BrowserStop ? error.message : error instanceof Error ? error.name : 'unknown' }; }
    }
    if (target.startsWith('tiktok') && (view === 'identity' || view === 'posts')) await page.locator('a[href*="/@"]').first().waitFor();
    if (target.startsWith('tiktok') && view === 'posts') {
      const posts = page.getByRole('button', { name: 'Posts', exact: true }).filter({ visible: true });
      const count = await posts.count();
      if (count !== 2) throw new BrowserStop('posts_management_control_ambiguous', target, `posts_button_count=${count}`);
      await posts.first().click();
      await page.waitForTimeout(1_000);
      await assertSession(page, allowed);
    }
    if (target.startsWith('tiktok') && view === 'composer') {
      await page.getByRole('tab', { name: 'Photos', exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
      const prompt = page.getByText('You have an unsaved photo post. Continue editing?', { exact: true });
      if (await prompt.count() === 1 && await prompt.isVisible()) {
        const continueButton = page.getByRole('button', { name: 'Continue', exact: true }).filter({ visible: true });
        if (await continueButton.count() !== 1) throw new BrowserStop('unsaved_photo_continue_unavailable', target);
        await continueButton.click();
        await prompt.waitFor({ state: 'hidden', timeout: 10_000 });
        await assertSession(page, allowed);
      }
      const switchInputs = page.locator('input[role="switch"]');
      for (let attempt = 0; attempt < 20 && await switchInputs.count() === 0; attempt++) await page.waitForTimeout(250);
      await page.waitForTimeout(500);
      const disclosureToggle = page.locator('div[class*="collapseToggle"]').filter({ hasText: 'Show more', visible: true });
      if (await disclosureToggle.count() > 1) throw new BrowserStop('inspection_settings_ambiguous', target);
      let disclosureExpanded = false;
      let disclosureToggleResult: object | null = null;
      if (await disclosureToggle.count() === 1) {
        const contents = page.locator('div[class*="collapsibleItems"]');
        const beforeHidden = await contents.getAttribute('hidden');
        let clickError: string | null = null;
        try { await disclosureToggle.getByText('Show more', { exact: true }).click({ timeout: 3_000 }); }
        catch (error) { clickError = error instanceof Error ? `${error.name}: ${error.message.slice(0, 800)}` : 'click_failed'; }
        await page.waitForTimeout(500);
        const afterHidden = await contents.getAttribute('hidden');
        disclosureExpanded = afterHidden === null;
        disclosureToggleResult = { beforeHidden, afterHidden, clickError };
      }
      if (disclosureExpanded) {
        const master = page.locator('[data-e2e="disclose_content_container"] .Switch__content');
        if (await master.count() !== 1) throw new BrowserStop('inspection_disclosure_master_ambiguous', target);
        const before = await master.getAttribute('aria-checked');
        if (before !== 'true' && before !== 'false') throw new BrowserStop('inspection_disclosure_master_unreadable', target);
        let afterOpen: string | null = before;
        let optionText = '';
        let optionSnippets: string[] = [];
        let restoreError: string | null = null;
        try {
          if (before === 'false') {
            await master.click();
            await page.waitForTimeout(400);
          }
          afterOpen = await master.getAttribute('aria-checked');
          optionText = await page.locator('div[class*="collapsibleItems"]').innerText();
          const html = await page.locator('div[class*="collapsibleItems"]').evaluate(element => element.innerHTML);
          optionSnippets = ['Your brand', 'Branded content'].map(label => {
            const index = html.indexOf(label);
            return index < 0 ? `${label}: not present` : `${label}: ${html.slice(Math.max(0, index - 900), Math.min(html.length, index + 1800))}`;
          });
        } finally {
          if (before === 'false') {
            try {
              if (await master.getAttribute('aria-checked') === 'true') {
                await master.click();
                await page.waitForTimeout(250);
              }
              if (await master.getAttribute('aria-checked') !== 'false') restoreError = 'master_not_restored';
            } catch { restoreError = 'master_restore_failed'; }
          }
        }
        disclosureOptionsProbe = { before, afterOpen, optionText: optionText.slice(0, 1600), optionSnippets, afterRestore: await master.getAttribute('aria-checked'), restoreError };
      }
      disclosureProbe = {
        disclosureExpanded,
        disclosureToggleResult,
        showMore: await disclosureToggle.count(),
        collapsibleParents: await page.locator('div[class*="collapsibleItems"]').evaluateAll(elements => elements.slice(0, 5).map(element => ({
          className: element.className.toString(), hidden: element.hasAttribute('hidden'), text: (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 500),
          parentHtml: element.parentElement?.outerHTML.slice(0, 8000) ?? '',
          grandparentHtml: element.parentElement?.parentElement?.outerHTML.slice(0, 12000) ?? '',
        }))),
        candidates: await page.locator('[class*="title-line"], input[role="switch"], [class*="setting"], [class*="Setting"]')
          .evaluateAll(elements => elements.slice(0, 60).map(element => {
            const ancestors = [];
            let context: Element | null = element;
            for (let depth = 0; context && depth < 8; depth++, context = context.parentElement) {
              ancestors.push({ tag: context.tagName.toLowerCase(), className: context.className?.toString().slice(0, 180) ?? '',
                role: context.getAttribute('role'), ariaChecked: context.getAttribute('aria-checked'),
                text: (context.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 600),
                html: context.outerHTML.slice(0, 3000) });
            }
            return { tag: element.tagName.toLowerCase(), className: element.className?.toString().slice(0, 180) ?? '',
              role: element.getAttribute('role'), checked: element instanceof HTMLInputElement ? element.checked : undefined,
              text: (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 450), ancestors };
          })),
      };
    }
    const controls = await page.locator('button, input:not([type="password"]), textarea, select, a, label, [role="tab"], [contenteditable="true"]')
      .evaluateAll(elements => elements.slice(0, 500).map(element => {
        const attributes: Record<string, string> = {};
        for (const name of ['id', 'class', 'name', 'type', 'accept', 'multiple', 'role', 'aria-label', 'aria-hidden', 'aria-selected', 'data-e2e', 'data-testid']) {
          const value = element.getAttribute(name); if (value) attributes[name] = value.slice(0, 250);
        }
        if (element instanceof HTMLAnchorElement) {
          try { const link = new URL(element.href); if (link.origin === location.origin) attributes.href = link.pathname; } catch {}
        }
        const box = element.getBoundingClientRect();
        const fileParents: object[] = [];
        if (element instanceof HTMLInputElement && element.type === 'file') {
          let parent = element.parentElement;
          for (let depth = 0; parent && depth < 4; depth++, parent = parent.parentElement) {
            fileParents.push({ tag: parent.tagName.toLowerCase(), id: parent.id || null,
              className: parent.className?.toString().slice(0, 180) ?? '',
              role: parent.getAttribute('role'), label: parent.getAttribute('aria-label'),
              dataE2e: parent.getAttribute('data-e2e') });
          }
        }
        return { tag: element.tagName.toLowerCase(), attributes,
          text: /^(BUTTON|A|LABEL)$/.test(element.tagName) || element.getAttribute('role') === 'tab'
            ? (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 180) : '',
          visible: box.width > 0 && box.height > 0,
          ...(fileParents.length ? { fileParents } : {}) };
      }));
    await assertSession(page, allowed);
    const directory = join(root, 'runtime/reports', `inspect-${jobId}`);
    protectDirectory(directory);
    const imageNodes = await page.locator('img').evaluateAll(elements => elements.slice(0, 160).map(element => {
      const image = element as HTMLImageElement, box = image.getBoundingClientRect(), source = image.currentSrc || image.src;
      let sourceKind = 'unknown';
      if (source.startsWith('blob:')) sourceKind = 'blob';
      else if (source.startsWith('data:')) sourceKind = 'data';
      else try { sourceKind = new URL(source).hostname; } catch {}
      const parent = image.closest('[data-test-id],[data-testid]');
      return { alt: image.alt.slice(0, 220), className: image.className.toString().slice(0, 180),
        sourceKind, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight,
        visible: box.width > 0 && box.height > 0, width: Math.round(box.width), height: Math.round(box.height),
        testId: parent?.getAttribute('data-test-id') ?? parent?.getAttribute('data-testid') ?? null };
    }));
    const report = { target, view, url: new URL(page.url()).origin + new URL(page.url()).pathname,
      title: await page.title(), observedAt: new Date().toISOString(),
      ...(cookieChoice !== undefined ? { cookieChoice } : {}),
      bodyText: (await page.locator('body').innerText()).slice(0, 12_000), controls, images: imageNodes,
      ...(disclosureProbe ? { disclosureProbe, disclosureOptionsProbe } : {}) };
    writeFileSync(join(directory, 'controls.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
    if (view === 'composer') {
      const preview = page.locator(requireControls(account, target).readyMedia);
      if (await preview.count() === 1 && await preview.isVisible()) {
        writeFileSync(join(directory, 'uploaded-media-preview.png'), await preview.screenshot(), { mode: 0o600 });
      }
    }
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
