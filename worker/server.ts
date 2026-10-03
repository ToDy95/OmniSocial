import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root, secret } from './local.ts';
import { openJournal } from './journal.ts';
import { fixturePlan } from './fixture.ts';

export function createWorker(token: string, journalReady: () => boolean) {
  return createServer((req, res) => {
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
    if (req.method !== 'GET' || !['/v1/health', '/v1/plan-fixture'].includes(req.url ?? '')) return reply(404, { error: 'operation_unavailable' });
    try {
      if (!journalReady()) throw new Error('Journal unavailable');
      if (req.url === '/v1/plan-fixture') return reply(200, fixturePlan());
      reply(200, { status: 'ok', mode: 'dry_run', publishingEnabled: false, sourceConnected: false, schemaVersion: 1 });
    } catch {
      reply(503, { error: 'journal_unavailable' });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.umask(0o077);
  const db = openJournal(join(root, 'runtime', 'journal.sqlite'));
  const server = createWorker(secret('worker-token'), () => Boolean(db.prepare("SELECT value FROM runtime_metadata WHERE key='schema_version'").get()));
  server.listen(8787, '127.0.0.1', () => console.log('OmniSocial worker: http://127.0.0.1:8787 (dry run only)'));
  server.on('error', () => { db.close(); console.error('Worker could not start'); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
}
