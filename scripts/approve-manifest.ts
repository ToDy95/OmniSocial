import { createInterface } from 'node:readline/promises';
import { join } from 'node:path';
import { root } from '../worker/local.ts';
import { protectedJSON } from '../worker/source.ts';
import { openJournal } from '../worker/journal.ts';
import { Operations } from '../worker/operations.ts';

process.umask(0o077);
if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Owner approval requires an interactive terminal');
const { manifest } = protectedJSON(join(root, 'runtime/reports/source-plan.json'));
console.log(JSON.stringify(manifest, null, 2));
const input = createInterface({ input: process.stdin, output: process.stdout });
try {
  const confirmation = await input.question('Review every account, destination, text, media digest, visibility and music choice. Type the full manifest digest to approve this finite lot for one hour: ');
  if (confirmation.trim() !== manifest.digest) throw new Error('Approval cancelled');
  const choices = protectedJSON(join(root, 'runtime/source/choices.json'));
  const db = openJournal(join(root, 'runtime/journal.sqlite'));
  try { new Operations(db, false).approve(manifest.manifestId, choices.owner, confirmation.trim(), new Date().toISOString()); }
  finally { db.close(); }
  console.log('Exact manifest approval saved locally. No post was submitted. Restart or changed payload requires renewed approval.');
} finally { input.close(); }
