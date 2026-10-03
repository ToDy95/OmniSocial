import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { root, protectDirectory } from '../worker/local.ts';
import { protectedJSON, sourceManifest } from '../worker/source.ts';
import { openJournal } from '../worker/journal.ts';
import { Operations } from '../worker/operations.ts';

process.umask(0o077);
try {
  const result = await sourceManifest(protectedJSON(join(root, 'runtime/source/snapshot.json')),
    protectedJSON(join(root, 'runtime/source/choices.json')), new Date().toISOString());
  const db = openJournal(join(root, 'runtime/journal.sqlite'));
  try { new Operations(db, false).saveManifest(result.manifest); } finally { db.close(); }
  protectDirectory(join(root, 'runtime/reports'));
  writeFileSync(join(root, 'runtime/reports/source-plan.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(`Saved local dry-run manifest: ${result.manifest.manifestId}; ${result.manifest.items.length} items. Publishing disabled.`);
} catch { console.error('Source plan blocked. Supply a fresh owner export and reviewed account/destination choices in protected runtime/source files.'); process.exitCode = 1; }
