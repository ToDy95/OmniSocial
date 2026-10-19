import type { Page } from 'playwright';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { portfolioOrigin, type BrowserConfig } from './browser-config.ts';
import { assertSession, BrowserSessions, BrowserStop } from './browser-session.ts';
import { fingerprint, type Manifest, type Target } from './planner.ts';
import { protectedJSON, sourceManifest, type SourceExport, type Choices } from './source.ts';
import { protectDirectory, root, targets } from './local.ts';
import type { Item } from './adapters/common.ts';

export type BrowserItem = Item & { slug: string; articleId: string; publishedAt: string };
export type Queue = { target: Target; handle: string; processed: number; total: number;
  processedSlugs: string[]; slug: string | null; title: string | null; mediaUrl: string | null; caption: string | null; prepared: boolean };
type ReachImage = { position: number; url: string; alt: string };
type ReachPackUI = { id: string; topic: string; slideCount: number; images: ReachImage[]; caption: string;
  status: string; deliveryId: string | null; externalUrl: string | null };
type PinterestCaptionApproval = { schemaVersion: number; approved: boolean; approvedTargets: Target[];
  approvalSource: string; sourceReport: string; sourceReportSha256: string;
  captions: Record<string, { title: string; characterCount: number; canonicalUrl: string; caption: string }> };
function readPinterestCaptionApproval(): PinterestCaptionApproval | null {
  const approvalPath = join(root, 'runtime/reports/pinterest-caption-approval-280.json');
  let approval: PinterestCaptionApproval;
  try { approval = protectedJSON(approvalPath) as PinterestCaptionApproval; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new BrowserStop('pinterest_caption_approval_invalid');
  }
  if (approval.schemaVersion !== 1 || approval.approved !== true || approval.approvalSource !== 'owner_reply'
    || approval.sourceReport !== '20261011-pinterest-caption-approval-280.md'
    || !/^[a-f0-9]{64}$/.test(approval.sourceReportSha256)
    || !Array.isArray(approval.approvedTargets)
    || approval.approvedTargets.length !== 2 || new Set(approval.approvedTargets).size !== 2
    || !approval.approvedTargets.includes('pinterest_personal') || !approval.approvedTargets.includes('pinterest_business')
    || !approval.captions || typeof approval.captions !== 'object' || Array.isArray(approval.captions)
    || Object.keys(approval.captions).length !== 6) {
    throw new BrowserStop('pinterest_caption_approval_invalid');
  }
  const reportPath = join(root, 'runtime/reports', approval.sourceReport);
  try {
    const info = lstatSync(reportPath);
    if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0 || info.size > 20 * 1024 * 1024) {
      throw new BrowserStop('pinterest_caption_approval_invalid');
    }
    const digest = createHash('sha256').update(readFileSync(reportPath)).digest('hex');
    const report = readFileSync(reportPath, 'utf8');
    if (digest !== approval.sourceReportSha256) throw new BrowserStop('pinterest_caption_approval_invalid');
    for (const entry of Object.values(approval.captions)) {
      if (!report.includes(entry.caption)) throw new BrowserStop('pinterest_caption_approval_invalid');
    }
  } catch (error) {
    if (error instanceof BrowserStop) throw error;
    throw new BrowserStop('pinterest_caption_approval_invalid');
  }
  for (const [slug, entry] of Object.entries(approval.captions)) {
    if (!/^[a-z0-9-]+$/.test(slug) || !entry || typeof entry.title !== 'string'
      || !Number.isInteger(entry.characterCount) || typeof entry.caption !== 'string'
      || entry.characterCount !== entry.caption.length || entry.characterCount > 280
      || typeof entry.canonicalUrl !== 'string' || !entry.caption.includes(entry.canonicalUrl)
      || !entry.caption.endsWith('#CodeOnRoids')) throw new BrowserStop('pinterest_caption_approval_invalid');
  }
  return approval;
}
function approvedPinterestCaption(approval: PinterestCaptionApproval | null, target: Target, slug: string, canonicalUrl: string) {
  const entry = approval?.captions[slug];
  if (!entry) return undefined;
  if (!approval!.approvedTargets.includes(target) || entry.canonicalUrl !== canonicalUrl) {
    throw new BrowserStop('pinterest_caption_approval_mismatch', target, slug);
  }
  return entry.caption;
}
function isApprovedPinterestItem(item: BrowserItem) {
  if (item.target !== 'pinterest_personal' && item.target !== 'pinterest_business') return false;
  return approvedPinterestCaption(readPinterestCaptionApproval(), item.target, item.slug, item.canonicalUrl) === item.payload.caption;
}
const reachCategories = ['os-shortcuts', 'git-github', 'ai-prompts', 'comparisons', 'languages',
  'architecture', 'automation', 'design-systems', 'palettes', 'optimization'] as const;
const reachCategoryLabels = Object.fromEntries(reachCategories.map(category => [category.replaceAll('-', ' '), category]));
const reachStatusLabels: Record<string, string> = {
  'manual handoff': 'manual', manual: 'manual', Published: 'succeeded', published: 'succeeded',
  Waiting: 'pending', waiting: 'pending', pending: 'pending', Publishing: 'publishing', publishing: 'publishing',
  Failed: 'failed', failed: 'failed',
};
const reachAccountLabels: Record<Target, string> = {
  tiktok_personal: 'TikTok Personal', tiktok_codeonroids: 'TikTok Code On Roids',
  x: 'X', reddit: 'Reddit', pinterest_business: 'Pinterest Business', pinterest_personal: 'Pinterest Personal',
};
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
function sourceCopyBody(content: string) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  while (lines.length && (!lines.at(-1)!.trim() || /more of the work behind the work:\s*https?:\/\/\S+/i.test(lines.at(-1)!)
    || /^(?:#[\p{L}\p{N}_-]+\s*)+$/u.test(lines.at(-1)!.trim()))) lines.pop();
  return lines.join('\n').trim();
}
export function mobileCaption(content: string, target: Target) {
  if (target === 'x') return content.trim();
  if (target.startsWith('pinterest')) return content.trim();
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
  async discover(config: BrowserConfig, contentKind: 'blog' | 'reach' = 'blog', packId?: string) {
    if (contentKind === 'reach') return this.discoverReach(config, packId);
    if (packId !== undefined) throw new BrowserStop('reach_pack_id_invalid');
    const page = await this.sessions.page('portfolio');
    const queues: Queue[] = [];
    for (const target of targets.filter(t => config.selected.includes(t))) {
      const queue = await mobileQueue(page, target);
      if (queue.handle !== config.accounts[target]!.handle) throw new BrowserStop('portfolio_mapping_mismatch', target);
      queues.push(queue);
    }
    const pinterestApproval = config.selected.some(target => target.startsWith('pinterest'))
      ? readPinterestCaptionApproval() : null;
    await page.goto(`${portfolioOrigin}/admin/posts/archive`, { waitUntil: 'domcontentloaded' });
    await assertSession(page, portfolioOrigin);
    if (await page.getByRole('heading', { name: 'Historical content archive', exact: true }).count() !== 1) throw new BrowserStop('portfolio_login_required', 'portfolio');
    // Read the owner UI only. No portfolio API, hidden server action or cloud mutation.
    const cards = page.locator('[data-slot="card"]').filter({ has: page.getByRole('tablist') });
    const count = await cards.count();
    if (count > 10_000) throw new BrowserStop('source_catalog_too_large');
    const articles: SourceExport['articles'] = [];
    if (config.selected.includes('x')) {
      // The archive defaults every platform's extra hashtags on. Leave only X's
      // extras selected so its visible export matches the account-specific copy.
      const extras = ['Facebook', 'Instagram', 'Threads', 'Bluesky', 'LinkedIn', 'Pinterest', 'Reddit', 'TikTok'];
      for (const name of extras) {
        const toggle = page.getByRole('switch', { name: `Include ${name} extras`, exact: true });
        if (await toggle.count() !== 1) throw new BrowserStop('source_export_options_changed', 'x', name);
        if (await toggle.getAttribute('aria-checked') === 'true') await toggle.click();
      }
    }
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
      const cardText = await card.innerText();
      const approved = /\bLong:\s*approved\b/i.test(cardText);
      await card.getByRole('tab', { name: 'Long social post', exact: true }).click();
      const longPanel = card.locator('[role="tabpanel"][data-state="active"]');
      if (await longPanel.count() !== 1) throw new BrowserStop('source_long_copy_panel_missing');
      const longCopy = longPanel.locator('pre');
      const long = await longCopy.count() ? await longCopy.innerText() : '';
      const payloads: SourceExport['articles'][number]['payloads'] = {};
      const needsCompactCopy = config.selected.includes('x');
      let compact = '', compactApproved = false;
      if (needsCompactCopy) {
        await card.getByRole('tab', { name: 'Short social posts', exact: true }).click();
        const shortPanel = card.locator('[role="tabpanel"][data-state="active"]');
        if (await shortPanel.count() !== 1) throw new BrowserStop('source_short_copy_panel_missing');
        const shortCopy = shortPanel.locator('pre');
        compact = await shortCopy.count() ? (await shortCopy.innerText()).trim() : '';
        compactApproved = /\bShort:\s*approved\b/i.test(cardText) && Boolean(compact);
        if (config.selected.includes('x')) payloads.x = { title, caption: compact, approved: compactApproved };
      }
      for (const target of config.selected.filter(t => t !== 'x')) {
        if (target.startsWith('pinterest')) {
          const approvedCaption = approvedPinterestCaption(pinterestApproval, target, slug, url);
          const caption = approvedCaption ?? mobileCaption(long, target);
          payloads[target] = { title, caption, approved: approvedCaption !== undefined || approved && Boolean(long) };
        } else {
          payloads[target] = { title, caption: mobileCaption(long, target), approved: approved && Boolean(long) };
        }
      }
      articles.push({ id: articleId, slug, canonicalUrl: url, publishedAt: new Date(published).toISOString(), mediaUrl, payloads });
    }
    // Match the mobile queue's exact oldest-first order, including its slug
    // tie-break for posts sharing a publish timestamp.
    articles.sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt) || a.slug.localeCompare(b.slug));
    const now = new Date().toISOString();
    const source: SourceExport = { schemaVersion: 1, source: 'portfolio', owner: config.owner,
      complete: true, nextCursor: null, asOf: now, revision: '', articles, accounts: [] };
    for (const queue of queues) {
    const eligible = articles.filter(a => a.payloads[queue.target]?.approved && a.payloads[queue.target]?.caption?.trim()
        && (!(queue.target.startsWith('tiktok') || queue.target.startsWith('pinterest')) || a.mediaUrl));
      if (eligible.length !== queue.total) throw new BrowserStop('source_catalog_progress_mismatch', queue.target,
        `eligible=${eligible.length};total=${queue.total}`);
      const remaining = eligible.filter(a => !queue.processedSlugs.includes(a.slug));
      if (remaining.length !== queue.total - queue.processed || (remaining[0]?.slug ?? null) !== queue.slug) {
        throw new BrowserStop('source_queue_changed', queue.target,
          `eligible=${eligible.length};remaining=${remaining.length};processed=${queue.processed};total=${queue.total};archiveNext=${remaining[0]?.slug ?? 'none'};workspaceNext=${queue.slug ?? 'none'}`);
      }
      if (queue.prepared) {
        const expectedCopy = remaining[0]?.payloads[queue.target]?.caption ?? '';
        const approvedCopy = queue.target.startsWith('pinterest') && remaining[0]
          ? approvedPinterestCaption(pinterestApproval, queue.target, remaining[0].slug, remaining[0].canonicalUrl)
          : undefined;
        const matches = queue.target === 'x'
          ? sourceCopyBody(queue.caption ?? '') === sourceCopyBody(expectedCopy)
          : queue.caption === expectedCopy;
        if (!matches && approvedCopy !== expectedCopy) throw new BrowserStop('source_copy_changed', queue.target, JSON.stringify({
          slug: queue.slug, prepared: queue.prepared, currentLength: queue.caption?.length ?? null,
          expectedLength: expectedCopy.length,
          normalizedLineEndingsMatch: (queue.caption ?? '').replace(/\r\n/g, '\n') === expectedCopy.replace(/\r\n/g, '\n'),
          currentDigest: fingerprint(queue.caption ?? ''), expectedDigest: fingerprint(expectedCopy),
        }));
      }
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
        accountId: config.accounts[target]!.handle, identityVerified: Boolean(config.accounts[target]!.controls?.identity) }])) };
    const result = await sourceManifest(source, choices, now);
    this.saveSource(source);
    return { ...result, progress: queues.map(q => ({ target: q.target, processed: q.processed, total: q.total, remaining: q.total - q.processed })) };
  }
  private async readReachPack(page: Page, target: Target, packId: string): Promise<ReachPackUI> {
    const url = new URL('/admin/mobile', portfolioOrigin);
    url.searchParams.set('reachPack', packId);
    await page.goto(url.href, { waitUntil: 'domcontentloaded' });
    await assertSession(page, portfolioOrigin);
    const section = page.locator('section[aria-labelledby="reach-mobile-title"]');
    if (await section.count() !== 1) throw new BrowserStop('reach_section_unavailable', 'portfolio');
    const packSelect = section.locator('select[name="reachPack"]');
    if (await packSelect.count() !== 1) throw new BrowserStop('reach_archive_unavailable', 'portfolio');
    const packOption = packSelect.locator(`option[value="${packId}"]`);
    if (await packOption.count() !== 1) throw new BrowserStop('reach_pack_unavailable', 'portfolio', packId);
    const expectedTopic = (await packOption.innerText()).trim();
    await packSelect.selectOption(packId);
    if (await packSelect.inputValue() !== packId) throw new BrowserStop('reach_pack_selection_mismatch', 'portfolio');
    const loadPack = section.getByRole('button', { name: 'Load pack', exact: true });
    if (await loadPack.count() !== 1 || !await loadPack.isEnabled()) throw new BrowserStop('reach_pack_load_unavailable', 'portfolio');
    await loadPack.click();
    await page.waitForFunction(({ packId, expectedTopic }) => {
      const section = document.querySelector('section[aria-labelledby="reach-mobile-title"]');
      const selected = section?.querySelector('select[name="reachPack"]') as HTMLSelectElement | null;
      const workspace = section?.querySelector('section[aria-label="Tips & Tricks pack"]');
      const topic = workspace?.querySelector('h3')?.textContent?.trim();
      const counts = /^(\d+)\/(\d+) images/.exec(workspace?.textContent?.match(/\d+\/\d+ images[^\n]*/)?.[0]?.trim() ?? '');
      return selected?.value === packId && topic === expectedTopic && Boolean(counts)
        && Number(counts![1]) > 0 && counts![1] === counts![2];
    }, { packId, expectedTopic }, { timeout: 20_000 })
      .catch(() => { throw new BrowserStop('reach_pack_load_unconfirmed', 'portfolio', packId); });
    const workspace = section.locator('section[aria-label="Tips & Tricks pack"]');
    if (await workspace.count() !== 1) throw new BrowserStop('reach_pack_unavailable', 'portfolio');
    const topic = (await workspace.locator('h3').innerText()).trim();
    const countText = await workspace.getByText(/^\d+\/\d+ images · same description on every network$/).innerText();
    const counts = /^(\d+)\/(\d+) images/.exec(countText);
    if (!topic || !counts) throw new BrowserStop('reach_pack_metadata_invalid', 'portfolio');
    const imageCount = Number(counts[1]), slideCount = Number(counts[2]);
    const imageElements = workspace.locator('.grid img');
    const images: ReachImage[] = [];
    for (let index = 0; index < await imageElements.count(); index++) {
      const image = imageElements.nth(index);
      const card = image.locator('xpath=..');
      const saveButtons = card.getByRole('button', { name: /^Save \d+$/ });
      if (await saveButtons.count() !== 1) throw new BrowserStop('reach_image_order_unavailable', 'portfolio');
      const saveLabel = await saveButtons.innerText();
      const position = Number(/^Save (\d+)$/.exec(saveLabel)?.[1]);
      const src = await image.getAttribute('src');
      if (!Number.isInteger(position) || !src || !src.startsWith('https://')) throw new BrowserStop('reach_image_metadata_invalid', 'portfolio');
      images.push({ position, url: src, alt: await image.getAttribute('alt') ?? '' });
    }
    images.sort((a, b) => a.position - b.position);
    if (images.length !== imageCount || images.some((item, index) => item.position !== index + 1)) {
      throw new BrowserStop('reach_pack_incomplete', 'portfolio');
    }
    const destinationSelect = workspace.locator('select');
    if (await destinationSelect.count() !== 1) throw new BrowserStop('reach_delivery_selector_unavailable', target);
    const optionList = destinationSelect.locator('option');
    if (await optionList.count() === 0) {
      await optionList.first().waitFor({ state: 'attached', timeout: 10_000 }).catch(() => undefined);
    }
    const options = await destinationSelect.locator('option').evaluateAll(elements => elements.map(element => {
      const option = element as HTMLOptionElement;
      return { value: option.value, label: (option.textContent ?? '').replace(/\s+/g, ' ').trim() };
    }));
    let statusLabel = '';
    const matches = options.filter(option => option.label.split(' · ')[0]?.trim() === reachAccountLabels[target]);
    if (options.length && matches.length === 1) {
      const selected = matches[0]!;
      await destinationSelect.selectOption(selected.value);
      if (await destinationSelect.inputValue() !== selected.value) throw new BrowserStop('reach_delivery_selection_mismatch', target);
      statusLabel = selected.label.split(' · ').at(-1)?.trim() ?? '';
    } else if (!options.length) {
      const buttonPicker = workspace.getByRole('button', { name: 'Network / account', exact: true });
      const comboPicker = workspace.getByRole('combobox', { name: 'Network / account', exact: true });
      const buttonCount = await buttonPicker.count(), comboCount = await comboPicker.count();
      if (buttonCount + comboCount !== 1) throw new BrowserStop('reach_delivery_selector_unavailable', target,
        `nativeOptions=0;accountPicker=${buttonCount};accountCombobox=${comboCount}`);
      const picker = comboCount === 1 ? comboPicker : buttonPicker;
      await picker.click();
      const choices = ['manual', 'succeeded', 'pending', 'publishing', 'failed'];
      const visibleChoices = await Promise.all(choices.map(async status => {
        const label = `${reachAccountLabels[target]} · ${status}`;
        const choice = page.getByText(label, { exact: true });
        return await choice.count() === 1 && await choice.isVisible() ? { status, choice } : null;
      }));
      const available = visibleChoices.filter((value): value is NonNullable<typeof value> => value !== null);
      if (available.length !== 1) {
        const visibleLabels = (await page.locator('body').innerText()).split('\n')
          .map(line => line.trim()).filter(line => /^(TikTok|Pinterest|Reddit|X)(?: ·| ).+ · [a-z]+$/i.test(line)).slice(0, 20);
        const pickerState = await picker.evaluate(element => ({ tag: element.tagName.toLowerCase(),
          role: element.getAttribute('role'), label: element.getAttribute('aria-label'), value: element.getAttribute('aria-valuetext'),
          disabled: (element as HTMLButtonElement).disabled, text: (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 100),
          html: element.outerHTML.slice(0, 350) }));
        const workspaceText = (await workspace.innerText()).replace(/\s+/g, ' ').trim();
        const controlIndex = workspaceText.indexOf('Network / account');
        const nearControl = controlIndex < 0 ? workspaceText.slice(0, 350) : workspaceText.slice(controlIndex, controlIndex + 350);
        throw new BrowserStop('reach_delivery_missing', target,
          `label=${reachAccountLabels[target]};matches=${available.length};nativeOptions=0;picker=${JSON.stringify(pickerState)};visible=${visibleLabels.join('|').slice(0, 250)};near=${nearControl.slice(0, 350)}`);
      }
      await available[0]!.choice.click();
      statusLabel = available[0]!.status;
      if (!(await picker.innerText()).replace(/\s+/g, ' ').includes(reachAccountLabels[target])) {
        throw new BrowserStop('reach_delivery_selection_mismatch', target);
      }
    } else {
      throw new BrowserStop('reach_delivery_missing', target,
        `label=${reachAccountLabels[target]};matches=${matches.length};available=${options.map(option => option.label).join('|').slice(0, 500)}`);
    }
    const status = reachStatusLabels[statusLabel] ?? 'unknown';
    const captions = await workspace.locator('pre').allInnerTexts();
    if (captions.length !== 1) throw new BrowserStop('reach_copy_unavailable', target);
    const deliveryIdInput = workspace.locator('input[name="deliveryId"]');
    const deliveryId = await deliveryIdInput.count() === 1 ? await deliveryIdInput.inputValue() : null;
    const publication = workspace.getByRole('link', { name: 'View publication', exact: true });
    const externalUrl = await publication.count() === 1 ? await publication.getAttribute('href') : null;
    return { id: packId, topic, slideCount, images, caption: captions[0]!, status, deliveryId, externalUrl };
  }
  private async reachMetadata(page: Page, packId: string, topic: string) {
    await page.goto(`${portfolioOrigin}/admin/reach?pack=${encodeURIComponent(packId)}`, { waitUntil: 'domcontentloaded' });
    await assertSession(page, portfolioOrigin);
    if (await page.getByRole('heading', { name: 'Reach Studio', exact: true }).count() !== 1) throw new BrowserStop('reach_archive_unavailable', 'portfolio');
    const marker = page.getByText('Generated pack', { exact: true });
    if (await marker.count() !== 1) throw new BrowserStop('reach_pack_metadata_unavailable', 'portfolio');
    const card = marker.locator('xpath=ancestor::*[@data-slot="card"][1]');
    if (await card.count() !== 1 || await card.locator('[data-slot="card-title"]').innerText() !== topic) throw new BrowserStop('reach_pack_identity_mismatch', 'portfolio');
    const description = (await card.locator('[data-slot="card-description"]').innerText()).trim();
    const parsed = /^(\d+) slides · (.+) · created (.+)$/.exec(description);
    const category = parsed ? reachCategoryLabels[parsed[2]!.trim().toLowerCase()] : undefined;
    const createdAt = parsed ? Date.parse(parsed[3]!.trim()) : Number.NaN;
    if (!parsed || Number(parsed[1]) < 2 || !category || !Number.isFinite(createdAt)) throw new BrowserStop('reach_pack_metadata_invalid', 'portfolio');
    return { category, publishedAt: new Date(createdAt).toISOString(), slideCount: Number(parsed[1]) };
  }
  private async discoverReach(config: BrowserConfig, packId?: string) {
    if (config.selected.length !== 1) throw new BrowserStop('reach_target_flow_required');
    const target = config.selected[0]!;
    const account = config.accounts[target]!;
    const page = await this.sessions.page('portfolio');
    const queueURL = new URL('/admin/mobile', portfolioOrigin);
    await page.goto(queueURL.href, { waitUntil: 'domcontentloaded' });
    await assertSession(page, portfolioOrigin);
    const section = page.locator('section[aria-labelledby="reach-mobile-title"]');
    if (await section.count() !== 1) throw new BrowserStop('reach_section_unavailable', 'portfolio');
    const packSelect = section.locator('select[name="reachPack"]');
    if (await packSelect.count() !== 1) throw new BrowserStop('reach_archive_unavailable', 'portfolio');
    const packIds = await packSelect.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value).filter(Boolean));
    if (packIds.length > 30 || packIds.some(id => !/^[a-f0-9-]{36}$/i.test(id)) || new Set(packIds).size !== packIds.length) throw new BrowserStop('reach_archive_invalid', 'portfolio');
    if (packIds.length === 30) throw new BrowserStop('reach_archive_limit_exceeded', 'portfolio');
    if (packId !== undefined && !packIds.includes(packId)) throw new BrowserStop('reach_pack_unavailable', target, packId);
    const articles: SourceExport['articles'] = [];
    const processedSlugs: string[] = [];
    const unresolvedSlugs: string[] = [];
    const plannedPacks = packId === undefined ? [...packIds].reverse() : [packId];
    for (const plannedPackId of plannedPacks) {
      const pack = await this.readReachPack(page, target, plannedPackId);
      const metadata = await this.reachMetadata(page, plannedPackId, pack.topic);
      const slug = `reach-${plannedPackId}`;
      const mediaLimit = target === 'x' ? 4 : target === 'pinterest_business' ? 5 : target === 'pinterest_personal' ? 1 : 10;
      if (pack.status === 'succeeded') processedSlugs.push(`reach-${plannedPackId}`);
      const complete = metadata.slideCount === pack.slideCount && pack.images.length === pack.slideCount;
      const redditRoute = target === 'reddit' ? account.reachDestinationByCategory?.[metadata.category]?.destination : undefined;
      const eligible = pack.status === 'manual' && Boolean(pack.deliveryId) && complete && pack.images.length <= mediaLimit
        && Boolean(pack.caption.trim()) && (target !== 'reddit' || Boolean(redditRoute));
      if (pack.status !== 'succeeded' && !eligible) unresolvedSlugs.push(slug);
      const payloads: SourceExport['articles'][number]['payloads'] = {};
      const destination = target === 'reddit' ? redditRoute ?? '' : account.destination;
      payloads[target] = { title: pack.topic, caption: pack.caption, approved: eligible, destination,
        ...(target === 'reddit' ? { postType: account.reachDestinationByCategory?.[metadata.category]?.postType ?? 'image',
          flair: account.reachDestinationByCategory?.[metadata.category]?.flair ?? null } : {}),
        packId: plannedPackId, ...(pack.deliveryId ? { deliveryId: pack.deliveryId } : {}) };
      articles.push({ id: plannedPackId, slug, canonicalUrl: `${portfolioOrigin}/socials`,
        publishedAt: metadata.publishedAt, mediaUrl: pack.images[0]?.url ?? null,
        mediaUrls: pack.images.map(item => item.url), contentKind: 'reach', payloads });
    }
    if (!articles.length) throw new BrowserStop('reach_packs_empty', target);
    const now = new Date().toISOString();
    const source: SourceExport = { schemaVersion: 1, source: 'portfolio', owner: config.owner, complete: true,
      nextCursor: null, asOf: now, revision: fingerprint({ target, packs: articles, processedSlugs, unresolvedSlugs }),
      articles, accounts: [{ target, handle: account.handle, processedSlugs, unresolvedSlugs, pendingSlug: null }] };
    const choices: Choices = { owner: config.owner, selected: [target], cap: config.cap, allowedMediaOrigins: config.allowedMediaOrigins,
      accounts: { [target]: { ...account, accountId: account.handle, identityVerified: Boolean(account.controls?.identity) } } };
    const result = await sourceManifest(source, choices, now, undefined, 'reach');
    this.saveSource(source);
    return { ...result, progress: [{ target, contentKind: 'reach', processed: processedSlugs.length,
      total: articles.length, remaining: articles.length - processedSlugs.length, unresolved: unresolvedSlugs.length }] };
  }
  async finishReach(target: Target, handle: string) {
    const page = await this.sessions.page('portfolio');
    const url = new URL('/admin/mobile', portfolioOrigin);
    url.searchParams.set('target', target);
    await page.goto(url.href, { waitUntil: 'domcontentloaded' });
    await assertSession(page, portfolioOrigin);
    const section = page.locator('section[aria-labelledby="reach-mobile-title"]');
    const select = section.locator('select[name="reachPack"]');
    if (await section.count() !== 1 || await select.count() !== 1) throw new BrowserStop('reach_archive_unavailable', 'portfolio');
    const ids = await select.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value).filter(Boolean));
    let processed = 0, total = 0, unresolved = 0;
    for (const id of ids) {
      const pack = await this.readReachPack(page, target, id);
      total++;
      if (pack.status === 'succeeded') processed++;
      else if (pack.status !== 'manual' || !pack.deliveryId || pack.images.length !== pack.slideCount) unresolved++;
    }
    if (ids.length === 30) throw new BrowserStop('reach_archive_limit_exceeded', target);
    if (!/^(@|u\/)[a-zA-Z0-9_.-]+$/.test(handle)
      || await section.getByRole('heading', { name: 'Tips & Tricks', exact: true }).count() !== 1) {
      throw new BrowserStop('portfolio_mapping_mismatch', target);
    }
    return { target, contentKind: 'reach', processed, total, remaining: total - processed, unresolved };
  }
  async prepare(item: BrowserItem, handle: string) {
    const page = await this.sessions.page('portfolio');
    if (item.payload.contentKind === 'reach') {
      const packId = item.payload.packId, deliveryId = item.payload.deliveryId;
      if (!packId || !deliveryId || item.articleId !== packId || !item.payload.mediaItems?.length) throw new BrowserStop('reach_manifest_invalid', item.target);
      const pack = await this.readReachPack(page, item.target as Target, packId);
      if (pack.topic !== item.payload.title || pack.caption !== item.payload.caption || pack.status !== 'manual'
        || pack.deliveryId !== deliveryId || pack.slideCount !== item.payload.mediaItems.length
        || pack.images.length !== item.payload.mediaItems.length) throw new BrowserStop('reach_pack_changed', item.target);
      return;
    }
    let queue = await mobileQueue(page, item.target as Target);
    if (queue.handle !== handle || queue.slug !== item.slug || queue.title !== item.payload.title
      || queue.mediaUrl !== (item.payload.media?.url ?? null)) throw new BrowserStop('source_item_changed', item.target);
    const reuse = item.payload.captionReuse;
    const validBusinessReuse = item.target === 'pinterest_personal'
      && reuse?.sourceTarget === 'pinterest_business'
      && /^[a-f0-9]{64}$/.test(reuse.sourceManifestId)
      && /^[a-f0-9]{64}$/.test(reuse.sourcePayloadDigest);
    const approvedPinterestCompact = isApprovedPinterestItem(item);
    const copyMatches = item.target === 'x'
      ? sourceCopyBody(queue.caption ?? '') === sourceCopyBody(item.payload.caption)
      : queue.caption === item.payload.caption;
    if (!queue.prepared || !copyMatches && !validBusinessReuse && !approvedPinterestCompact) {
      const button = page.getByRole('button', { name: 'Prepare this post', exact: true });
      if (await button.count() !== 1) throw new BrowserStop('unexpected_source_ui');
      await button.click();
      await page.locator('#mobile-post-caption').waitFor();
      queue = await mobileQueue(page, item.target as Target);
    }
    const finalCopyMatches = item.target === 'x'
      ? sourceCopyBody(queue.caption ?? '') === sourceCopyBody(item.payload.caption)
      : queue.caption === item.payload.caption;
    if (queue.slug !== item.slug) throw new BrowserStop('source_copy_changed', item.target);
    if (!finalCopyMatches && !validBusinessReuse && !approvedPinterestCompact) throw new BrowserStop('source_copy_changed', item.target);
  }
  async sync(item: BrowserItem, url: string, sound: string | null, syncKey: string) {
    const page = await this.sessions.page('portfolio');
    if (item.payload.contentKind === 'reach') {
      const packId = item.payload.packId, deliveryId = item.payload.deliveryId;
      if (!packId || !deliveryId || item.articleId !== packId) throw new BrowserStop('reach_manifest_invalid', item.target);
      let pack = await this.readReachPack(page, item.target as Target, packId);
      if (pack.status === 'succeeded') {
        if (pack.externalUrl !== url) throw new BrowserStop('reach_sync_conflict', item.target);
        return { syncKey, externalUrl: url, result: 'posted' };
      }
      if (pack.status !== 'manual' || pack.deliveryId !== deliveryId) throw new BrowserStop('reach_delivery_changed', item.target);
      const workspace = page.locator('section[aria-label="Tips & Tricks pack"]');
      const form = workspace.locator('form').filter({ has: page.locator('input[name="deliveryId"]') });
      if (await form.count() !== 1 || await form.locator('input[name="packId"]').inputValue() !== packId
        || await form.locator('input[name="deliveryId"]').inputValue() !== deliveryId) throw new BrowserStop('reach_sync_target_changed', item.target);
      await form.locator('input[name="externalUrl"]').fill(url);
      const confirmed = form.locator('input[name="confirmed"]');
      if (await confirmed.count() !== 1) throw new BrowserStop('reach_confirmation_unavailable', item.target);
      await confirmed.check();
      if (!await confirmed.isChecked()) throw new BrowserStop('reach_confirmation_unavailable', item.target);
      const button = form.getByRole('button', { name: 'Confirm manual publication', exact: true });
      if (await button.count() !== 1 || !await button.isEnabled()) throw new BrowserStop('reach_sync_button_unavailable', item.target);
      await button.click();
      await workspace.getByRole('status').getByText('Manual publication recorded for this destination.', { exact: true }).waitFor({ timeout: 20_000 })
        .catch(() => { throw new BrowserStop('reach_sync_confirmation_missing', item.target); });
      pack = await this.readReachPack(page, item.target as Target, packId);
      if (pack.status !== 'succeeded' || pack.externalUrl !== url) throw new BrowserStop('reach_sync_readback_mismatch', item.target);
      return { syncKey, externalUrl: url, result: 'posted' };
    }
    const queue = await mobileQueue(page, item.target as Target);
    if (queue.slug !== item.slug) {
      // Only exact saved event evidence can resolve an ambiguous writeback.
      return this.readback(page, item, url, syncKey);
    }
    const form = page.locator('form')
      .filter({ has: page.locator('input[name="externalUrl"]') })
      .filter({ has: page.locator(`input[name="target"][value="${item.target}"]`) });
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
      || await link.count() !== 1 || await link.getAttribute('href') !== url) throw new BrowserStop('source_url_readback_unavailable');
    return { syncKey, externalUrl: url, result: 'posted' };
  }
}
