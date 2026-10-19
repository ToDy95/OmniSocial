import { BrowserJobs } from './browser-jobs.ts';
import { BrowserRunner, fixedLoginURL } from './browser-runner.ts';
import { BrowserSessions, BrowserStop } from './browser-session.ts';
import { readBrowserConfig } from './browser-config.ts';
import { targets } from './local.ts';
import type { Target } from './planner.ts';

function exact(input: Record<string, unknown>, allowed: string[]) {
  if (!input || Array.isArray(input) || typeof input !== 'object' || Object.keys(input).some(k => !allowed.includes(k))) throw new BrowserStop('browser_input_invalid');
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(value)) throw new BrowserStop('reference_invalid');
  return value;
}
function digest(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new BrowserStop('digest_invalid');
  return value;
}
export function validInspectionView(target: Target, view: string) {
  return view === 'identity' || view === 'composer' || view === 'posts' && target.startsWith('tiktok');
}
export class BrowserAPI {
  readonly jobs: BrowserJobs;
  readonly runner: BrowserRunner;
  readonly sessions: BrowserSessions;
  constructor(jobs: BrowserJobs, runner: BrowserRunner, sessions: BrowserSessions) {
    this.jobs = jobs; this.runner = runner; this.sessions = sessions;
  }
  command(operation: string, input: Record<string, unknown>) {
    if (operation === 'stop' || operation === 'close') {
      exact(input, ['runId', 'target']); const runId = id(input.runId);
      const target = input.target === undefined ? undefined : input.target as Target;
      if (target !== undefined && !targets.includes(target)) throw new BrowserStop('target_invalid');
      this.runner.assertRunScope(runId, target);
      if (operation === 'stop') this.runner.operations.stop(runId);
      else { this.runner.operations.report(runId); this.runner.operations.release(runId); }
      return { status: operation === 'stop' ? 'stop_requested' : 'closed', runId };
    }
    if (operation === 'plan') {
      exact(input, ['jobId', 'target', 'contentKind', 'packId']); const jobId = id(input.jobId);
      const target = input.target === undefined ? undefined : input.target as Target;
      if (target !== undefined && !targets.includes(target)) throw new BrowserStop('target_invalid');
      const contentKind = input.contentKind === undefined ? 'blog' : input.contentKind;
      if (contentKind !== 'blog' && contentKind !== 'reach') throw new BrowserStop('content_kind_invalid');
      const packId = input.packId;
      if (packId !== undefined && (contentKind !== 'reach' || typeof packId !== 'string' || !/^[a-f0-9-]{36}$/i.test(packId))) {
        throw new BrowserStop('reach_pack_id_invalid');
      }
      return this.jobs.start(jobId, operation, input, () => this.runner.plan(target, contentKind, packId as string | undefined));
    }
    if (operation === 'inspect') {
      exact(input, ['jobId', 'target', 'view']); const jobId = id(input.jobId);
      if (!targets.includes(input.target as Target) || !validInspectionView(input.target as Target, input.view as string)
        || jobId.length > 72) throw new BrowserStop('inspection_input_invalid');
      const target = input.target as Target, view = input.view as 'identity' | 'composer' | 'posts';
      return this.jobs.start(jobId, operation, input, async () => {
        const config = readBrowserConfig();
        if (!config.accounts[target]) throw new BrowserStop('target_out_of_scope');
        return this.sessions.inspect(target, view, config.accounts[target]!, jobId);
      });
    }
    if (operation === 'login') {
      exact(input, ['jobId', 'target']); const jobId = id(input.jobId);
      if (input.target !== 'portfolio' && !targets.includes(input.target as Target)) throw new BrowserStop('target_invalid');
      const target = input.target as Target | 'portfolio';
      return this.jobs.start(jobId, operation, input, async () => {
        const config = readBrowserConfig();
        const url = fixedLoginURL(target, config);
        if (!url || target !== 'portfolio' && !config.accounts[target]) throw new BrowserStop('target_out_of_scope');
        return this.sessions.login(target, url);
      });
    }
    if (operation === 'publish') {
      exact(input, ['jobId', 'manifestId', 'digest', 'mode', 'ownerConfirmed', 'target']);
      const jobId = id(input.jobId), manifestId = digest(input.manifestId), approvedDigest = digest(input.digest);
      const target = input.target === undefined ? undefined : input.target as Target;
      if (target !== undefined && !targets.includes(target)) throw new BrowserStop('target_invalid');
      if (input.mode !== 'publish' || input.ownerConfirmed !== true || manifestId !== approvedDigest) throw new BrowserStop('exact_owner_approval_required');
      return this.jobs.start(jobId, operation, input, async () => {
        const manifest = this.runner.operations.manifest(manifestId);
        this.runner.assertManifestScope(manifest, target);
        this.runner.operations.approve(manifestId, manifest.owner, approvedDigest, new Date().toISOString());
        return this.runner.publish(jobId, manifestId, approvedDigest, target);
      });
    }
    if (operation === 'reconcile') {
      exact(input, ['jobId', 'runId', 'itemId', 'url', 'target']);
      const jobId = id(input.jobId), runId = id(input.runId), itemId = digest(input.itemId);
      const target = input.target === undefined ? undefined : input.target as Target;
      if (target !== undefined && !targets.includes(target)) throw new BrowserStop('target_invalid');
      if (input.url !== undefined && (typeof input.url !== 'string' || input.url.length > 2000)) throw new BrowserStop('receipt_url_invalid');
      this.runner.assertRunScope(runId, target);
      return this.jobs.start(jobId, operation, input, () => this.runner.reconcile(runId, itemId, input.url as string | undefined, target));
    }
    throw new BrowserStop('operation_unavailable');
  }
}
