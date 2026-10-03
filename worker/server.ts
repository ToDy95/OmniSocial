import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root, secret } from './local.ts';
import { openJournal } from './journal.ts';
import { fixturePlan } from './fixture.ts';
import { recoveryFixture } from './recovery-fixture.ts';
import { Operations } from './operations.ts';
import { batchFixture, itemFixture } from './batch-fixture.ts';
import { BrowserAPI } from './browser-api.ts';
import { BrowserSessions, BrowserStop } from './browser-session.ts';
import { BrowserJobs } from './browser-jobs.ts';
import { BrowserRunner, LiveBackend } from './browser-runner.ts';

export function createWorker(token: string, journalReady: () => boolean, operations?: Operations, browser?: BrowserAPI) {
  return createServer(async (req, res) => {
    const reply = (status: number, body: object) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    if (![`127.0.0.1:${req.socket.localPort}`, `localhost:${req.socket.localPort}`].includes(req.headers.host ?? '') || req.headers.origin) {
      return reply(403, { error: 'forbidden' });
    }
    const supplied = Buffer.from(req.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${token}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return reply(401, { error: 'unauthorized' });
    }
    const browserCommand = /^\/v1\/browser\/(plan|publish|login|reconcile|stop|close)$/.exec(req.url ?? '');
    const browserStatus = /^\/v1\/browser\/jobs\/([a-zA-Z0-9-]{1,80})$/.exec(req.url ?? '');
    if (browser && (browserCommand && req.method === 'POST' || browserStatus && req.method === 'GET')) {
      try {
        if (!journalReady()) return reply(503, { error: 'journal_unavailable' });
        if (browserStatus) return reply(200, browser.jobs.status(browserStatus[1]!));
        if (req.headers['content-type']?.split(';')[0] !== 'application/json') return reply(400, { error: 'browser_input_invalid' });
        const chunks: Buffer[] = []; let size = 0;
        req.setTimeout(5000, () => req.destroy());
        for await (const chunk of req) { size += chunk.length; if (size > 8192) return reply(413, { error: 'browser_input_too_large' }); chunks.push(chunk); }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        return reply(200, browser.command(browserCommand![1]!, body));
      } catch (error) {
        return reply(400, { error: error instanceof BrowserStop ? error.message : 'browser_input_invalid' });
      }
    }
    const fixtures = ['/v1/fixture/prepare', '/v1/fixture/verify', '/v1/fixture/reconcile', '/v1/fixture/report', '/v1/fixture/stop'];
    const save = req.method === 'POST' && req.url === '/v1/save-fixture-plan' && operations
      && !req.headers['transfer-encoding'] && (!req.headers['content-length'] || req.headers['content-length'] === '0');
    const item = req.method === 'POST' && req.url === '/v1/fixture/item';
    if (!save && !item && (req.method !== 'GET' || !['/v1/health', '/v1/plan-fixture', '/v1/fixture/batch', ...fixtures].includes(req.url ?? ''))) return reply(404, { error: 'operation_unavailable' });
    try {
      if (!journalReady()) throw new Error('Journal unavailable');
      if (item) {
        if (req.headers['content-type']?.split(';')[0] !== 'application/json') return reply(400, { error: 'fixture_input_invalid' });
        const chunks: Buffer[] = []; let size = 0;
        req.setTimeout(5000, () => req.destroy());
        for await (const chunk of req) { size += chunk.length; if (size > 4096) return reply(413, { error: 'fixture_input_too_large' }); chunks.push(chunk); }
        try { return reply(200, itemFixture(JSON.parse(Buffer.concat(chunks).toString('utf8')))); }
        catch { return reply(400, { error: 'fixture_input_invalid' }); }
      }
      if (req.url === '/v1/fixture/batch') return reply(200, await batchFixture());
      if (save) {
        const result = fixturePlan(); operations!.saveManifest(result.manifest);
        return reply(200, { ...result, persisted: true, approvalRequired: true });
      }
      if (fixtures.includes(req.url ?? '')) return reply(200, recoveryFixture());
      if (req.url === '/v1/plan-fixture') return reply(200, fixturePlan());
      reply(200, { status: 'ok', mode: 'dry_run', publishingEnabled: false, sourceConnected: false,
        approvedBrowserOperations: Boolean(browser), schemaVersion: 1 });
    } catch {
      reply(503, { error: 'journal_unavailable' });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.umask(0o077);
  const db = openJournal(join(root, 'runtime', 'journal.sqlite'));
  const operations = new Operations(db);
  const sessions = new BrowserSessions();
  const browser = new BrowserAPI(new BrowserJobs(db), new BrowserRunner(operations, new LiveBackend(sessions)), sessions);
  const server = createWorker(secret('worker-token'), () => Boolean(db.prepare("SELECT value FROM runtime_metadata WHERE key='schema_version'").get()), operations, browser);
  server.listen(8787, '127.0.0.1', () => console.log('OmniSocial worker: http://127.0.0.1:8787 (dry run default; exact manual approval required for browser submission)'));
  server.on('error', () => { db.close(); console.error('Worker could not start'); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
    for (const row of db.prepare("SELECT id FROM runs WHERE state='active'").all()) operations.stop(String(row.id));
    server.close();
    void sessions.close().finally(() => {
      // Keep the journal alive until an in-flight operation has recorded its outcome.
      const timer = setInterval(() => { if (!browser.jobs.running) { clearInterval(timer); db.close(); process.exit(0); } }, 100);
    });
  });
}
