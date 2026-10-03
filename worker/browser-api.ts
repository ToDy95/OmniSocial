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
export class BrowserAPI {
  readonly jobs: BrowserJobs;
  readonly runner: BrowserRunner;
  readonly sessions: BrowserSessions;
  constructor(jobs: BrowserJobs, runner: BrowserRunner, sessions: BrowserSessions) {
    this.jobs = jobs; this.runner = runner; this.sessions = sessions;
  }
  command(operation: string, input: Record<string, unknown>) {
    if (operation === 'stop' || operation === 'close') {
      exact(input, ['runId']); const runId = id(input.runId);
      if (operation === 'stop') this.runner.operations.stop(runId);
      else { this.runner.operations.report(runId); this.runner.operations.release(runId); }
      return { status: operation === 'stop' ? 'stop_requested' : 'closed', runId };
    }
    if (operation === 'plan') {
      exact(input, ['jobId']); const jobId = id(input.jobId);
      return this.jobs.start(jobId, operation, input, () => this.runner.plan());
    }
    if (operation === 'login') {
      exact(input, ['jobId', 'target']); const jobId = id(input.jobId);
      if (input.target !== 'portfolio' && !targets.includes(input.target as Target)) throw new BrowserStop('target_invalid');
      const target = input.target as Target | 'portfolio';
      return this.jobs.start(jobId, operation, input, async () => {
        const config = readBrowserConfig();
        const url = fixedLoginURL(target, config);
        if (!url || target !== 'portfolio' && !config.selected.includes(target)) throw new BrowserStop('target_out_of_scope');
        return this.sessions.login(target, url);
      });
    }
    if (operation === 'publish') {
      exact(input, ['jobId', 'manifestId', 'digest', 'mode', 'ownerConfirmed']);
      const jobId = id(input.jobId), manifestId = digest(input.manifestId), approvedDigest = digest(input.digest);
      if (input.mode !== 'publish' || input.ownerConfirmed !== true || manifestId !== approvedDigest) throw new BrowserStop('exact_owner_approval_required');
      return this.jobs.start(jobId, operation, input, async () => {
        const manifest = this.runner.operations.manifest(manifestId);
        this.runner.operations.approve(manifestId, manifest.owner, approvedDigest, new Date().toISOString());
        return this.runner.publish(jobId, manifestId, approvedDigest);
      });
    }
    if (operation === 'reconcile') {
      exact(input, ['jobId', 'runId', 'itemId', 'url']);
      const jobId = id(input.jobId), runId = id(input.runId), itemId = digest(input.itemId);
      if (input.url !== undefined && (typeof input.url !== 'string' || input.url.length > 2000)) throw new BrowserStop('receipt_url_invalid');
      return this.jobs.start(jobId, operation, input, () => this.runner.reconcile(runId, itemId, input.url as string | undefined));
    }
    throw new BrowserStop('operation_unavailable');
  }
}
