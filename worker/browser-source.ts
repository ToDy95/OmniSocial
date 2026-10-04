import type { Page } from 'playwright';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { portfolioOrigin, type BrowserConfig } from './browser-config.ts';
import { assertSession, BrowserSessions, BrowserStop } from './browser-session.ts';
import { fingerprint, type Manifest, type Target } from './planner.ts';
import { sourceManifest, type SourceExport, type Choices } from './source.ts';
import { protectDirectory, root, targets } from './local.ts';
import type { Item } from './adapters/common.ts';

export type BrowserItem = Item & { slug: string; articleId: string; publishedAt: string };
export type Queue = { target: Target; handle: string; processed: number; total: number;
  processedSlugs: string[]; slug: string | null; title: string | null; mediaUrl: string | null; caption: string | null; prepared: boolean };
export async function mobileQueue(page: Page, target: Target): Promise<Queue> {
  await page.goto(`${portfolioOrigin}/admin/mobile?target=${target}`, { waitUntil: 'domcontentloaded' });
  await assertSession(page, portfolioOrigin);
  const progress = page.getByRole('progressbar', { name: 'Publishing progress', exact: true });
  if (await progress.count() !== 1) throw new BrowserStop('portfolio_login_required', 'portfolio');
  const card = progress.locator('xpath=ancestor::*[@data-slot="card"][1]');
  const handle = (await card.locator('[data-slot="card-description"]').first().innerText()).trim();
  const processed = Number(await progress.getAttribute('aria-valuenow'));
  const total = Number(await progress.getAttribute('aria-valuemax'));
  const processedJSON = await progress.getAttribute('data-mobile-processed-slugs');
  if (!processedJSON || await progress.getAttribute('data-mobile-target') !== target) throw new BrowserStop('portfolio_ui_contract_update_required', 'portfolio');
  const processedSlugs: string[] = JSON.parse(processedJSON);
  if (!Array.isArray(processedSlugs) || processedSlugs.some(s => typeof s !== 'string')
    || new Set(processedSlugs).size !== processedSlugs.length) throw new BrowserStop('portfolio_progress_invalid');
  if (!Number.isInteger(processed) || !Number.isInteger(total) || processed < 0 || processed > total) throw new BrowserStop('portfolio_progress_invalid');
  const title = card.locator('h2:visible');
  if (!await title.count()) {
    if (processed !== total) throw new BrowserStop('portfolio_copy_or_media_missing', target);
    return { target, handle, processed, total, processedSlugs, slug: null, title: null, mediaUrl: null, caption: null, prepared: false };
  }
  if (await title.count() !== 1) throw new BrowserStop('unexpected_source_ui');
  const slugText = await title.locator('xpath=following-sibling::p[1]').innerText();
  const slug = slugText.trim().replace(/^\//, '');
  if (!/^[a-zA-Z0-9-]+$/.test(slug)) throw new BrowserStop('source_slug_invalid');
  const caption = page.locator('#mobile-post-caption');
  const image = card.locator('img');
  if (await image.count() > 1) throw new BrowserStop('unexpected_source_ui');
  return { target, handle, processed, total, processedSlugs, slug, title: (await title.innerText()).trim(),
    mediaUrl: await image.count() ? await image.getAttribute('src') : null,
    caption: await caption.count() ? await caption.inputValue() : null, prepared: await caption.count() === 1 };
}

const siteLine = 'More of the work behind the work: https://www.razvantodica.com';
const tiktokTags = ['#softwaredeveloper', '#programmer', '#codinglife', '#webdeveloper', '#softwaredevelopment',
  '#softwareengineering', '#appdevelopment', '#webdevelopment', '#learntocode', '#techinnovation'];
export function mobileCaption(content: string, target: Target) {
  if (target === 'x') return content.trim();
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  while (lines.length && (!lines.at(-1)!.trim() || /more of the work behind the work:\s*https?:\/\/\S+/i.test(lines.at(-1)!)
    || /^(?:#[\p{L}\p{N}_-]+\s*)+$/u.test(lines.at(-1)!.trim()))) lines.pop();
  const body = lines.join('\n').trim();
  const seen = new Set((body.match(/#[\p{L}\p{N}_-]+/gu) ?? []).map(tag => tag.toLowerCase()));
  const additions = (target.startsWith('tiktok') ? tiktokTags : ['#CodeOnRoids']).filter(tag => !seen.has(tag.toLowerCase()));
  return [body, ...(additions.length ? [additions.join(' ')] : []), siteLine].join('\n\n');
}

export class BrowserSource {
  readonly sessions: BrowserSessions;
  readonly saveSource: (source: SourceExport) => void;
  constructor(sessions: BrowserSessions, saveSource: (source: SourceExport) => void = source => {
    protectDirectory(join(root, 'runtime/browser'));
    writeFileSync(join(root, 'runtime/browser/source.json'), JSON.stringify(source, null, 2), { mode: 0o600 });
  }) { this.sessions = sessions; this.saveSource = saveSource; }
  async discover(config: BrowserConfig) {
    const page = await this.sessions.page('portfolio');
    const queues: Queue[] = [];
    for (const target of targets.filter(t => config.selected.includes(t))) {
      const queue = await mobileQueue(page, target);
      if (queue.handle !== config.accounts[target]!.handle) throw new BrowserStop('portfolio_mapping_mismatch', target);
      queues.push(queue);
    }
    await page.goto(`${portfolioOrigin}/admin/posts/archive`, { waitUntil: 'domcontentloaded' });
    await assertSession(page, portfolioOrigin);
    if (await page.getByRole('heading', { name: 'Historical content archive', exact: true }).count() !== 1) throw new BrowserStop('portfolio_login_required', 'portfolio');
    // Read the owner UI only. No portfolio API, hidden server action or cloud mutation.
    const cards = page.locator('[data-slot="card"]').filter({ has: page.getByRole('tablist') });
    const count = await cards.count();
    if (count > 10_000) throw new BrowserStop('source_catalog_too_large');
    const articles: SourceExport['articles'] = [];
    for (let index = count - 1; index >= 0; index--) {
      const card = cards.nth(index);
      const slug = (await card.locator('[data-slot="card-description"]').innerText()).trim().replace(/^\//, '');
      const title = (await card.locator('[data-slot="card-title"]').innerText()).trim();
      const full = await card.locator('pre').innerText();
      const published = await card.getAttribute('data-archive-published-at');
      const articleId = await card.getAttribute('data-archive-post-id');
      const url = /^URL: (https:\/\/\S+)$/m.exec(full)?.[1];
      if (!published || !url || !articleId || !Number.isFinite(Date.parse(published))) throw new BrowserStop('source_archive_metadata_invalid');
      const mediaUrl = await card.locator('img').count() ? await card.locator('img').getAttribute('src') : null;
      const approved = (await card.innerText()).includes('Long: approved');
      await card.getByRole('tab', { name: 'Long social post', exact: true }).click();
      const long = await card.locator('pre').count() ? await card.locator('pre').innerText() : '';
      const payloads: SourceExport['articles'][number]['payloads'] = {};
      if (config.selected.includes('x')) payloads.x = { title, caption: '', approved: false };
      for (const target of config.selected.filter(t => t !== 'x')) payloads[target] = { title, caption: mobileCaption(long, target), approved: approved && Boolean(long) };
      articles.push({ id: articleId, slug, canonicalUrl: url, publishedAt: new Date(published).toISOString(), mediaUrl, payloads });
    }
    if (config.selected.includes('x')) await this.compactCopy(page, articles);
    const now = new Date().toISOString();
    const source: SourceExport = { schemaVersion: 1, source: 'portfolio', owner: config.owner,
      complete: true, nextCursor: null, asOf: now, revision: '', articles, accounts: [] };
    for (const queue of queues) {
      const eligible = articles.filter(a => a.payloads[queue.target]?.approved && a.payloads[queue.target]?.caption?.trim()
        && (!(queue.target.startsWith('tiktok') || queue.target.startsWith('pinterest')) || a.mediaUrl));
      if (eligible.length !== queue.total) throw new BrowserStop('source_catalog_progress_mismatch', queue.target);
      const remaining = eligible.filter(a => !queue.processedSlugs.includes(a.slug));
      if (remaining.length !== queue.total - queue.processed || (remaining[0]?.slug ?? null) !== queue.slug) throw new BrowserStop('source_queue_changed', queue.target);
      if (queue.prepared && queue.caption !== remaining[0]?.payloads[queue.target]?.caption) throw new BrowserStop('source_copy_changed', queue.target);
      // A prepared portfolio checkpoint is not a social submission; local attempts are
      // checked separately before publishing, including after restart.
      source.accounts.push({ target: queue.target, handle: queue.handle,
        processedSlugs: queue.processedSlugs, pendingSlug: null });
    }
    source.revision = fingerprint({ articles, accounts: source.accounts });
    const choices: Choices = { owner: config.owner, selected: config.selected, cap: config.cap,
      allowedMediaOrigins: config.allowedMediaOrigins,
      destinations: Object.fromEntries(config.selected.map(target => [target, Object.fromEntries(articles.flatMap(article => {
        const entries = Object.entries(config.accounts[target]!.destinationByCategory ?? {}).filter(([prefix]) => article.slug.startsWith(`${prefix}-`));
        if (entries.length > 1) throw new BrowserStop('ambiguous_category_destination', target);
        return entries.length ? [[article.slug, entries[0]![1]]] : [];
      }))])),
      accounts: Object.fromEntries(config.selected.map(target => [target, { ...config.accounts[target]!,
        accountId: config.accounts[target]!.handle, identityVerified: true }])) };
    const result = await sourceManifest(source, choices, now);
    this.saveSource(source);
    return { ...result, progress: queues.map(q => ({ target: q.target, processed: q.processed, total: q.total, remaining: q.total - q.processed })) };
  }
  private async compactCopy(page: Page, articles: SourceExport['articles']) {
    // Resolve the published article's distribution link through paginated owner UI.
    const links = new Map<string, string>();
    await page.goto(`${portfolioOrigin}/admin/posts?status=published&pageSize=100`, { waitUntil: 'domcontentloaded' });
    const visited = new Set<string>();
    while (true) {
      await assertSession(page, portfolioOrigin);
      if (visited.has(page.url()) || visited.size >= 1000) throw new BrowserStop('source_pagination_invalid');
      visited.add(page.url());
      for (const card of await page.locator('[data-slot="card"]').all()) {
        const description = card.locator('[data-slot="card-description"]');
        const link = card.locator('a[href$="/distribution"]');
        if (await description.count() === 1 && await link.count() === 1) {
          links.set((await description.innerText()).trim().replace(/^\//, ''), (await link.getAttribute('href'))!);
        }
      }
      const next = page.getByRole('link', { name: 'Next', exact: true }).last();
      if (!await next.count() || await next.getAttribute('aria-disabled') === 'true') break;
      const href = await next.getAttribute('href');
      if (!href || new URL(href, portfolioOrigin).origin !== portfolioOrigin) throw new BrowserStop('source_pagination_invalid');
      await page.goto(new URL(href, portfolioOrigin).href, { waitUntil: 'domcontentloaded' });
    }
    for (const article of articles) {
      const link = links.get(article.slug);
      if (!link || !/^\/admin\/posts\/[a-zA-Z0-9-]+\/distribution$/.test(link)) throw new BrowserStop('source_distribution_missing');
      await page.goto(`${portfolioOrigin}${link}`, { waitUntil: 'domcontentloaded' });
      await assertSession(page, portfolioOrigin);
      const tab = page.getByRole('tab').filter({ hasText: /Compact social/i });
      if (await tab.count() !== 1) throw new BrowserStop('source_compact_tab_missing');
      const approved = /approved/i.test(await tab.innerText());
      await tab.click();
      const form = page.locator('form').filter({ has: page.locator('input[name="platform"][value="social_compact"]') });
      if (await form.count() !== 1) throw new BrowserStop('source_compact_copy_missing');
      const caption = await form.locator('textarea[name="content"]').inputValue();
      article.payloads.x = { title: article.payloads.x!.title,
        caption: caption.trim(), approved };
    }
  }
  async prepare(item: BrowserItem, handle: string) {
    const page = await this.sessions.page('portfolio');
    let queue = await mobileQueue(page, item.target as Target);
    if (queue.handle !== handle || queue.slug !== item.slug || queue.title !== item.payload.title
      || queue.mediaUrl !== (item.payload.media?.url ?? null)) throw new BrowserStop('source_item_changed', item.target);
    if (!queue.prepared) {
      const button = page.getByRole('button', { name: 'Prepare this post', exact: true });
      if (await button.count() !== 1) throw new BrowserStop('unexpected_source_ui');
      await button.click();
      await page.locator('#mobile-post-caption').waitFor();
      queue = await mobileQueue(page, item.target as Target);
    }
    if (queue.slug !== item.slug || queue.caption !== item.payload.caption) throw new BrowserStop('source_copy_changed', item.target);
  }
  async sync(item: BrowserItem, url: string, sound: string | null, syncKey: string) {
    const page = await this.sessions.page('portfolio');
    const queue = await mobileQueue(page, item.target as Target);
    if (queue.slug !== item.slug) {
      // Only exact saved event evidence can resolve an ambiguous writeback.
      return this.readback(page, item, url, syncKey);
    }
    const form = page.locator('form').filter({ has: page.locator('input[name="externalUrl"]') });
    if (await form.count() !== 1 || await form.locator('input[name="target"]').inputValue() !== item.target
      || await form.locator('input[name="slug"]').inputValue() !== item.slug) throw new BrowserStop('source_sync_target_changed');
    await form.locator('input[name="externalUrl"]').fill(url);
    await form.locator('input[name="note"]').fill(`OmniSocial receipt ${syncKey}; ${item.itemId}`);
    if (item.target.startsWith('tiktok')) {
      await form.locator('input[name="sound"]').fill(sound ?? 'None');
      await form.locator('input[name="privacyState"]').fill('Public');
    }
    if (item.target.startsWith('pinterest')) await form.locator('input[name="board"]').fill(item.payload.destination);
    if (item.target === 'reddit') await form.locator('input[name="subreddit"]').fill(item.payload.destination);
    await form.getByRole('button', { name: 'Posted / public', exact: true }).click();
    await page.getByText(/Posted result saved in the cloud ledger|This exact result was already recorded/).waitFor();
    return this.readback(page, item, url, syncKey);
  }
  private async readback(page: Page, item: BrowserItem, url: string, syncKey: string) {
    const activity = page.locator('[data-slot="card"]').filter({ hasText: 'Recent cloud activity' });
    const event = activity.locator('[data-mobile-event-slug]').filter({ has: page.getByText(item.slug, { exact: true }) });
    const link = event.locator('a');
    if (await event.count() !== 1 || !(await event.innerText()).includes('Posted / public')
      || await event.getAttribute('data-mobile-event-target') !== item.target
      || await event.getAttribute('data-mobile-event-result') !== 'posted'
      || await event.getAttribute('data-mobile-event-note') !== `OmniSocial receipt ${syncKey}; ${item.itemId}`
      || await link.count() !== 1 || await link.getAttribute('href') !== url) throw new BrowserStop('source_url_readback_unavailable');
    return { syncKey, externalUrl: url, result: 'posted' };
  }
}
