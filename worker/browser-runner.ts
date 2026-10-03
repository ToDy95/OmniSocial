import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { fingerprint, type Target, type Manifest } from './planner.ts';
import { Operations } from './operations.ts';
import { BrowserSource, mobileQueue, type BrowserItem } from './browser-source.ts';
import { BrowserProvider } from './browser-provider.ts';
import { BrowserSessions, BrowserStop } from './browser-session.ts';
import { readBrowserConfig, portfolioOrigin, requireControls, type BrowserConfig } from './browser-config.ts';
import { downloadMedia } from './media.ts';
import { protectDirectory, root, targets } from './local.ts';

export type PublicReceipt = { itemId: string; accountId: string; payloadDigest: string;
  url: string; public: boolean; evidenceDigest: string };
export type Prepared = { sound: string | null; [key: string]: unknown };
export interface PublishingBackend {
  discover(config: BrowserConfig): Promise<{ manifest: Manifest; progress: unknown; media: unknown }>;
  identity(target: Target, config: BrowserConfig): Promise<{ accountId: string; observedAt: string }>;
  prepare(item: BrowserItem, config: BrowserConfig): Promise<void>;
  media(item: BrowserItem, config: BrowserConfig): Promise<string | null>;
  composer(item: BrowserItem, config: BrowserConfig, media: string | null): Promise<Prepared>;
  submit(item: BrowserItem, config: BrowserConfig, prepared: Prepared, beforeClick: () => void): Promise<void>;
  result(item: BrowserItem, config: BrowserConfig, prepared: Prepared): Promise<string>;
  verify(item: BrowserItem, config: BrowserConfig, url: string, media: string | null, runId: string, sound: string | null): Promise<PublicReceipt>;
  sync(item: BrowserItem, url: string, sound: string | null, syncKey: string): Promise<{ syncKey: string; externalUrl: string; result: string }>;
  finish(target: Target, config: BrowserConfig): Promise<unknown>;
}
export class LiveBackend implements PublishingBackend {
  readonly source: BrowserSource;
  readonly provider: BrowserProvider;
  readonly sessions: BrowserSessions;
  constructor(sessions: BrowserSessions) { this.sessions = sessions; this.source = new BrowserSource(sessions); this.provider = new BrowserProvider(sessions); }
  discover(config: BrowserConfig) { return this.source.discover(config); }
  identity(target: Target, config: BrowserConfig) { return this.provider.identity(target, config.accounts[target]!); }
  prepare(item: BrowserItem, config: BrowserConfig) { return this.source.prepare(item, config.accounts[item.target as Target]!.handle); }
  async media(item: BrowserItem, config: BrowserConfig) {
    if (!item.payload.media) return null;
    const result = await downloadMedia(item.payload.media.url, config.allowedMediaOrigins, join(root, 'runtime/media', item.itemId));
    if (result.sha256 !== item.payload.media.sha256) throw new BrowserStop('media_changed', item.target);
    return result.path;
  }
  async composer(item: BrowserItem, config: BrowserConfig, media: string | null): Promise<Prepared> {
    return this.provider.composer(item, config.accounts[item.target as Target]!, media);
  }
  async submit(item: BrowserItem, config: BrowserConfig, prepared: Prepared, beforeClick: () => void) {
    await this.provider.submit(prepared.page as Awaited<ReturnType<BrowserSessions['page']>>, item, config.accounts[item.target as Target]!, prepared.sound, beforeClick);
  }
  result(item: BrowserItem, config: BrowserConfig, prepared: Prepared) {
    return this.provider.resultURL(prepared.page as Awaited<ReturnType<BrowserSessions['page']>>, item,
      config.accounts[item.target as Target]!, prepared.previousLinks as string[]);
  }
  verify(item: BrowserItem, config: BrowserConfig, url: string, media: string | null, runId: string, sound: string | null) {
    return this.provider.verify(item, config.accounts[item.target as Target]!, url, media, runId, sound);
  }
  sync(item: BrowserItem, url: string, sound: string | null, syncKey: string) { return this.source.sync(item, url, sound, syncKey); }
  async finish(target: Target, config: BrowserConfig) {
    const queue = await mobileQueue(await this.sessions.page('portfolio'), target);
    if (queue.handle !== config.accounts[target]!.handle) throw new BrowserStop('portfolio_mapping_mismatch');
    // The last read does not expand the immutable manifest. New posts belong to another run.
    return { target, processed: queue.processed, total: queue.total, remaining: queue.total - queue.processed };
  }
}

export class BrowserRunner {
  readonly operations: Operations;
  readonly backend: PublishingBackend;
  readonly config: () => BrowserConfig;
  readonly clock: () => string;
  readonly saveReport: (result: unknown) => void;
  constructor(operations: Operations, backend: PublishingBackend,
    config: () => BrowserConfig = readBrowserConfig,
    clock: () => string = () => new Date().toISOString(), saveReport: (result: unknown) => void = result => {
      protectDirectory(join(root, 'runtime/reports'));
      writeFileSync(join(root, 'runtime/reports/source-plan.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
    }) {
    this.operations = operations; this.backend = backend; this.config = config; this.clock = clock;
    this.saveReport = saveReport;
    operations.db.exec(`CREATE TABLE IF NOT EXISTS browser_choices(manifest_id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS browser_prepared(run_id TEXT NOT NULL,item_id TEXT NOT NULL,sound TEXT,
      receipt_url TEXT, PRIMARY KEY(run_id,item_id));`);
  }
  async plan() {
    const config = this.config();
    const result = await this.backend.discover(config);
    for (const account of result.manifest.accounts.filter(a => a.count > 0)) {
      const observed = await this.backend.identity(account.target, config);
      if (observed.accountId !== account.accountId) throw new BrowserStop('active_account_mismatch', account.target);
    }
    this.operations.saveManifest(result.manifest);
    this.operations.db.prepare('INSERT OR IGNORE INTO browser_choices VALUES(?,?)').run(result.manifest.manifestId, JSON.stringify(config));
    this.saveReport(result);
    return { status: result.manifest.items.length ? 'review_required' : 'caught_up',
      manifestId: result.manifest.manifestId, digest: result.manifest.digest, itemCount: result.manifest.items.length, progress: result.progress };
  }
  private choices(manifestId: string) {
    const row = this.operations.db.prepare('SELECT body FROM browser_choices WHERE manifest_id=?').get(manifestId);
    if (!row) throw new BrowserStop('browser_choices_missing');
    const config: BrowserConfig = JSON.parse(String(row.body));
    if (fingerprint(config) !== fingerprint(this.config())) throw new BrowserStop('browser_configuration_changed');
    return config;
  }
  async publish(runId: string, manifestId: string, digest: string) {
    const manifest = this.operations.manifest(manifestId);
    if (manifest.digest !== digest) throw new BrowserStop('approval_digest_mismatch');
    const config = this.choices(manifestId);
    const run = this.operations.openRun(runId, manifestId, this.clock());
    if (run.state !== 'active' || run.stopped || run.epoch !== this.operations.epoch) throw new BrowserStop('run_requires_reconciliation');
    const progress: unknown[] = [];
    try {
      for (const target of manifest.targetOrder) {
        const items = (manifest.items as BrowserItem[]).filter(i => i.target === target);
        for (const item of items) {
          const attempt = this.operations.prepare(runId, item.itemId, run.fence, this.clock());
          if (attempt.state === 'completed') continue;
          if (attempt.state !== 'ready_to_submit') throw new BrowserStop('attempt_requires_reconciliation', target);
          try {
            await this.backend.identity(target, config);
            await this.backend.prepare(item, config);
            const media = await this.backend.media(item, config);
            const prepared = await this.backend.composer(item, config, media);
            const fresh = await this.backend.identity(target, config);
            if (fresh.accountId !== item.accountId || Date.parse(this.clock()) - Date.parse(fresh.observedAt) > 30_000) throw new BrowserStop('fresh_identity_required', target);
            this.operations.db.prepare('INSERT OR REPLACE INTO browser_prepared(run_id,item_id,sound) VALUES(?,?,?)')
              .run(runId, item.itemId, prepared.sound);
            // Persist the marker and recheck stop/lease/approval immediately before Post.
            this.operations.submitting(runId, item.itemId, run.fence, this.clock(), { accountId: fresh.accountId, payloadDigest: fingerprint(item.payload) });
            await this.backend.submit(item, config, prepared, () => this.operations.authorizeClick(runId, item.itemId, run.fence, this.clock()));
            const url = await this.backend.result(item, config, prepared);
            this.operations.db.prepare('UPDATE browser_prepared SET receipt_url=? WHERE run_id=? AND item_id=?').run(url, runId, item.itemId);
            const receipt = await this.backend.verify(item, config, url, media, runId, prepared.sound);
            const saved = this.operations.receipt(runId, item.itemId, receipt);
            const readback = await this.backend.sync(item, receipt.url, prepared.sound, saved.sync_key!);
            this.operations.synced(runId, item.itemId, readback);
          } catch (error) {
            const state = this.operations.attempt(runId, item.itemId).state;
            if (state === 'submitting') this.operations.unknown(runId, item.itemId);
            else if (state === 'ready_to_submit') this.operations.failBeforeSubmit(runId, item.itemId);
            throw error;
          }
        }
        progress.push(await this.backend.finish(target, config));
      }
      this.operations.release(runId);
      return { status: 'completed', runId, progress, report: this.operations.report(runId) };
    } catch (error) {
      this.operations.stop(runId);
      return { status: 'stopped', runId, reason: error instanceof BrowserStop ? error.message : 'browser_operation_failed',
        target: error instanceof BrowserStop ? error.target : undefined, progress, report: this.operations.report(runId) };
    }
  }
  async reconcile(runId: string, itemId: string, suppliedURL?: string) {
    const report = this.operations.report(runId);
    const config = this.choices(report.run.manifest_id);
    const item = (this.operations.manifest(report.run.manifest_id).items as BrowserItem[]).find(i => i.itemId === itemId);
    if (!item) throw new BrowserStop('item_out_of_scope');
    const attempt = this.operations.attempt(runId, itemId);
    if (attempt.state === 'completed') return { status: 'already_completed', runId, itemId };
    const prepared = this.operations.db.prepare('SELECT sound,receipt_url FROM browser_prepared WHERE run_id=? AND item_id=?').get(runId, itemId);
    let receipt: PublicReceipt;
    if (attempt.receipt) receipt = JSON.parse(attempt.receipt);
    else {
      if (attempt.state !== 'submission_unknown') throw new BrowserStop('attempt_not_reconcilable');
      const url = suppliedURL ?? prepared?.receipt_url;
      if (!url || typeof url !== 'string') throw new BrowserStop('receipt_url_required');
      receipt = await this.backend.verify(item, config, url, await this.backend.media(item, config), runId, typeof prepared?.sound === 'string' ? prepared.sound : null);
      this.operations.receipt(runId, itemId, receipt);
    }
    const saved = this.operations.attempt(runId, itemId);
    const readback = await this.backend.sync(item, receipt.url, typeof prepared?.sound === 'string' ? prepared.sound : null, saved.sync_key!);
    this.operations.synced(runId, itemId, readback);
    // There is no resume into fresh submissions after reconciliation.
    return { status: 'synchronized', runId, itemId, report: this.operations.report(runId) };
  }
}

export const fixedLoginURL = (target: Target | 'portfolio', config: BrowserConfig) => target === 'portfolio'
  ? `${portfolioOrigin}/admin/mobile?target=tiktok_codeonroids` : config.accounts[target]?.identityUrl;
