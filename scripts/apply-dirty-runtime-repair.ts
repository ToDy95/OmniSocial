import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// This is a source repair, never a worker/browser/job launcher.
const [targetArgument, option] = process.argv.slice(2);
if (!targetArgument || (option !== undefined && option !== '--apply') || process.argv.length > 4) {
  throw new Error('usage: node scripts/apply-dirty-runtime-repair.ts <checkout> [--apply]');
}
const target = resolve(targetArgument);
const artifactRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../patches/SOC-019');
const patchPath = resolve(artifactRoot, 'dirty-runtime.patch');
const manifest = JSON.parse(readFileSync(resolve(artifactRoot, 'manifest.json'), 'utf8')) as {
  schemaVersion: number; milestone: string; patchSha256: string;
  files: { path: string; beforeSha256: string; afterSha256: string }[];
};
const expectedPaths = ['worker/browser-provider.ts', 'tests/browser-provider-ui.test.ts',
  'tests/browser-runner.test.ts', 'tests/browser-source-ui.test.ts'];
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
if (manifest.schemaVersion !== 1 || manifest.milestone !== 'SOC-019'
  || JSON.stringify(manifest.files.map(file => file.path)) !== JSON.stringify(expectedPaths)
  || hash(readFileSync(patchPath)) !== manifest.patchSha256) throw new Error('repair_artifact_invalid');
for (const directory of [target, resolve(target, 'worker'), resolve(target, 'tests')]) {
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('repair_target_unsafe');
}
const currentHashes = manifest.files.map(file => {
  const path = resolve(target, file.path), info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('repair_target_unsafe');
  return hash(readFileSync(path));
});
if (manifest.files.every((file, index) => currentHashes[index] === file.afterSha256)) {
  console.log(JSON.stringify({ status: 'already_installed', milestone: manifest.milestone }));
} else {
  if (!manifest.files.every((file, index) => currentHashes[index] === file.beforeSha256)) {
    throw new Error('repair_base_drift');
  }
  const apply = (check: boolean) => {
    const result = spawnSync('git', ['-C', target, 'apply', ...(check ? ['--check'] : []), patchPath], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(check ? 'repair_patch_check_failed' : 'repair_patch_apply_failed');
  };
  apply(true);
  if (option === '--apply') {
    apply(false);
    if (!manifest.files.every(file => hash(readFileSync(resolve(target, file.path))) === file.afterSha256)) {
      throw new Error('repair_output_mismatch');
    }
  }
  console.log(JSON.stringify({ status: option === '--apply' ? 'installed' : 'checked',
    milestone: manifest.milestone, files: expectedPaths, patchSha256: manifest.patchSha256 }));
}
