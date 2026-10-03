import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadMedia, validateImage } from '../worker/media.ts';

test('media verifies actual bytes, dimensions, origin, MIME, redirects and owner-only cache', async () => {
  const bytes = await sharp({ create: { width: 120, height: 200, channels: 3, background: '#abc' } }).png().toBuffer();
  const dir = mkdtempSync(join(tmpdir(), 'omnisocial-media-'));
  const response = async () => new Response(bytes, { headers: { 'content-type': 'image/png' } });
  try {
    const media = await downloadMedia('https://fixture.supabase.co/storage/cover.png', ['https://fixture.supabase.co'], dir, response as typeof fetch);
    assert.equal(media.width, 120); assert.equal(media.height, 200);
    assert.equal(statSync(media.path).mode & 0o777, 0o600);
    assert.deepEqual(await downloadMedia('https://fixture.supabase.co/storage/cover.png', ['https://fixture.supabase.co'], dir, response as typeof fetch), media);
    await assert.rejects(downloadMedia('http://localhost/private', ['http://localhost'], dir, response as typeof fetch), /origin/);
    await assert.rejects(downloadMedia('https://other.invalid/x', ['https://fixture.supabase.co'], dir, response as typeof fetch), /origin/);
    await assert.rejects(downloadMedia('https://fixture.supabase.co/x', ['https://fixture.supabase.co'], dir, (async () => new Response(bytes, { headers: { 'content-type': 'text/html' } })) as typeof fetch), /type_mismatch/);
    await assert.rejects(downloadMedia('https://fixture.supabase.co/x', ['https://fixture.supabase.co'], dir, (async () => new Response(null, { status: 302 })) as typeof fetch), /download_failed/);
    await assert.rejects(validateImage(Buffer.from('<html>not an image</html>')), /decode/);
    await assert.rejects(validateImage(Buffer.alloc(11 * 1024 * 1024)), /size/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
