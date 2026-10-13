import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadMedia } from '../worker/media.ts';

const origin = 'https://fixture.supabase.co';
async function fixture() {
  const bytes = await sharp({ create: { width: 120, height: 200, channels: 3, background: '#abc' } }).png().toBuffer();
  const hash = createHash('sha256').update(bytes).digest('hex');
  const url = `${origin}/storage/v1/object/public/blog-media-public/posts/post/123-${hash}.png`;
  const directory = mkdtempSync(join(tmpdir(), 'omnisocial-reuse-'));
  let calls = 0;
  const request = (async () => { calls++; await new Promise(resolve => setTimeout(resolve, 5)); return new Response(bytes, { headers: { 'content-type': 'image/png' } }); }) as typeof fetch;
  return { bytes, hash, url, directory, request, calls: () => calls };
}

test('immutable public media reuses fully verified bytes and deduplicates concurrent downloads', async () => {
  const f = await fixture();
  try {
    const results = await Promise.all(Array.from({ length: 8 }, () => downloadMedia(f.url, [origin], f.directory, f.request)));
    assert.equal(f.calls(), 1);
    assert.ok(results.every(media => media.path === results[0]!.path));
    assert.deepEqual(readFileSync(results[0]!.path), f.bytes);
    await downloadMedia(f.url, [origin], f.directory, f.request);
    assert.equal(f.calls(), 1);
    const canonical = f.url.replace('/123-', '/');
    await downloadMedia(canonical, [origin], f.directory, f.request);
    await downloadMedia(canonical, [origin], f.directory, f.request);
    assert.equal(f.calls(), 2);
    // Approval/source state is not stored or reused by this media-only cache.
    await assert.rejects(downloadMedia(f.url, ['https://other.supabase.co'], f.directory, f.request), /origin_forbidden/);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test('private, signed, mutable and query-varied URLs always fetch current authorization', async () => {
  const f = await fixture();
  try {
    const urls = [f.url.replace('/public/blog-media-public/', '/sign/reach-assets-private/') + '?token=expired', f.url + '?width=120', f.url + '#fragment', `${origin}/storage/v1/object/public/blog-media-public/cover.png`];
    for (const url of urls) {
      await downloadMedia(url, [origin], f.directory, f.request);
      await downloadMedia(url, [origin], f.directory, f.request);
    }
    assert.equal(f.calls(), urls.length * 2);
    await assert.rejects(downloadMedia(urls[0]!, [origin], f.directory, (async () => new Response(null, { status: 403 })) as typeof fetch), /download_failed/);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test('reuse is isolated by origin, path and caller directory', async () => {
  const f = await fixture();
  try {
    await downloadMedia(f.url, [origin], f.directory, f.request);
    await downloadMedia(f.url.replace('fixture.supabase.co', 'other.supabase.co'), ['https://other.supabase.co'], f.directory, f.request);
    await downloadMedia(f.url.replace('/posts/post/', '/posts/another/'), [origin], f.directory, f.request);
    await downloadMedia(f.url, [origin], join(f.directory, 'another-manifest'), f.request);
    assert.equal(f.calls(), 4);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test('hash mismatch, cache corruption and unsafe permissions are rejected', async () => {
  const f = await fixture();
  try {
    await assert.rejects(downloadMedia(f.url.replace(f.hash, 'a'.repeat(64)), [origin], f.directory, f.request), /hash_mismatch/);
    const media = await downloadMedia(f.url, [origin], f.directory, f.request);
    chmodSync(media.path, 0o644);
    await assert.rejects(downloadMedia(f.url, [origin], f.directory, f.request), /cache_unsafe/);
    chmodSync(media.path, 0o600);
    writeFileSync(media.path, await sharp({ create: { width: 120, height: 200, channels: 3, background: '#def' } }).png().toBuffer());
    await assert.rejects(downloadMedia(f.url, [origin], f.directory, f.request), /cache_conflict/);
    writeFileSync(media.path, Buffer.from('corrupt'));
    await assert.rejects(downloadMedia(f.url, [origin], f.directory, f.request), /decode_invalid/);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test('failed shared downloads are not retained and a later request can recover', async () => {
  const f = await fixture(); let calls = 0;
  const request = (async () => { calls++; return calls === 1 ? new Response(null, { status: 403 }) : new Response(f.bytes, { headers: { 'content-type': 'image/png' } }); }) as typeof fetch;
  try {
    const failed = await Promise.allSettled([downloadMedia(f.url, [origin], f.directory, request), downloadMedia(f.url, [origin], f.directory, request)]);
    assert.ok(failed.every(result => result.status === 'rejected'));
    assert.equal(calls, 1);
    await downloadMedia(f.url, [origin], f.directory, request);
    assert.equal(calls, 2);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test('an immutable-media caller directory cannot be a symbolic link', async () => {
  const f = await fixture();
  try {
    const link = join(f.directory, 'linked-root');
    symlinkSync(f.directory, link, 'dir');
    await assert.rejects(downloadMedia(f.url, [origin], link, f.request), /Unsafe local directory/);
    assert.equal(f.calls(), 0);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});
