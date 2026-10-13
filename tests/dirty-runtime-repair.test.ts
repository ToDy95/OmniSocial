import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const paths = ['worker/browser-provider.ts', 'tests/browser-provider-ui.test.ts',
  'tests/browser-runner.test.ts', 'tests/browser-source-ui.test.ts'];
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'soc019-installer-test-'));
  const target = resolve(root, 'target'), release = resolve(root, 'release');
  const before = 'synthetic before\n', after = 'synthetic after\n';
  const patch = paths.map(path => `--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-${before}+${after}`).join('');
  for (const path of paths) {
    mkdirSync(dirname(resolve(target, path)), { recursive: true });
    writeFileSync(resolve(target, path), before);
  }
  mkdirSync(resolve(release, 'scripts'), { recursive: true });
  mkdirSync(resolve(release, 'patches/SOC-019'), { recursive: true });
  writeFileSync(resolve(release, 'scripts/apply-dirty-runtime-repair.ts'),
    readFileSync(fileURLToPath(new URL('../scripts/apply-dirty-runtime-repair.ts', import.meta.url))));
  writeFileSync(resolve(release, 'patches/SOC-019/dirty-runtime.patch'), patch);
  const manifest = { schemaVersion: 1, milestone: 'SOC-019', patchSha256: digest(patch),
    files: paths.map(path => ({ path, beforeSha256: digest(before), afterSha256: digest(after) })) };
  const save = () => writeFileSync(resolve(release, 'patches/SOC-019/manifest.json'), JSON.stringify(manifest));
  save();
  const run = (apply = false) => spawnSync(process.execPath,
    [resolve(release, 'scripts/apply-dirty-runtime-repair.ts'), target, ...(apply ? ['--apply'] : [])], { encoding: 'utf8' });
  const contents = () => paths.map(path => readFileSync(resolve(target, path), 'utf8'));
  return { root, target, release, before, after, manifest, save, run, contents };
}

test('dirty source repair checks without writing and applies the verified patch idempotently', () => {
  const f = fixture();
  try {
    assert.equal(f.run().status, 0);
    assert.deepEqual(f.contents(), paths.map(() => f.before));
    assert.equal(f.run(true).status, 0);
    assert.deepEqual(f.contents(), paths.map(() => f.after));
    const replay = f.run(true);
    assert.equal(replay.status, 0);
    assert.match(replay.stdout, /already_installed/);
    assert.deepEqual(f.contents(), paths.map(() => f.after));
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
test('a corrupt output manifest is rejected before any owner source mutation', () => {
  const f = fixture();
  try {
    f.manifest.files[0]!.afterSha256 = 'f'.repeat(64); f.save();
    for (const apply of [false, true]) {
      const result = f.run(apply);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /repair_output_manifest_invalid/);
      assert.deepEqual(f.contents(), paths.map(() => f.before));
    }
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
test('base drift and mixed repair state fail closed without changing any other file', () => {
  const f = fixture();
  try {
    writeFileSync(resolve(f.target, paths[0]!), f.after);
    const before = f.contents(), result = f.run(true);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /repair_base_drift/);
    assert.deepEqual(f.contents(), before);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
test('symbolic link source files and changed patch bytes are rejected without mutation', () => {
  const f = fixture();
  try {
    const path = resolve(f.target, paths[0]!), backing = resolve(f.root, 'backing.ts');
    writeFileSync(backing, f.before); unlinkSync(path); symlinkSync(backing, path);
    assert.match(f.run(true).stderr, /repair_target_unsafe/);
    assert.deepEqual(f.contents(), paths.map(() => f.before));
    unlinkSync(path); writeFileSync(path, f.before);
    writeFileSync(resolve(f.release, 'patches/SOC-019/dirty-runtime.patch'), 'changed');
    assert.match(f.run(true).stderr, /repair_artifact_invalid/);
    assert.deepEqual(f.contents(), paths.map(() => f.before));
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
