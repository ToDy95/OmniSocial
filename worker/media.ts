import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { protectDirectory } from './local.ts';

const maxBytes = 10 * 1024 * 1024;
export async function validateImage(bytes: Buffer) {
  if (!bytes.length || bytes.length > maxBytes) throw new Error('media_size_invalid');
  try {
    const image = sharp(bytes, { failOn: 'warning', limitInputPixels: 40_000_000 });
    const meta = await image.metadata();
    if ((meta.format !== 'png' && meta.format !== 'jpeg' && meta.format !== 'webp') || !meta.width || !meta.height
      || meta.width > 10_000 || meta.height > 10_000 || (meta.pages ?? 1) > 1) throw new Error();
    // Decode every pixel before accepting bytes; metadata alone is not enough.
    await image.raw().toBuffer();
    return { sha256: createHash('sha256').update(bytes).digest('hex'), format: meta.format!, width: meta.width, height: meta.height, bytes: bytes.length };
  } catch { throw new Error('media_decode_invalid'); }
}
type Media = Awaited<ReturnType<typeof validateImage>> & { path: string };
const pending = new WeakMap<typeof fetch, Map<string, Promise<Media>>>();

function immutablePublicHash(url: URL) {
  if (url.search || url.hash || !url.hostname.endsWith('.supabase.co')) return null;
  const match = url.pathname.match(/^\/storage\/v1\/object\/public\/blog-media-public\/.+\/(?:\d+-)?([a-f0-9]{64})\.(?:png|jpe?g|webp)$/i);
  return match?.[1]?.toLowerCase() ?? null;
}

async function cachedMedia(directory: string, expectedHash: string): Promise<Media | null> {
  protectDirectory(directory);
  for (const format of ['png', 'jpeg', 'webp'] as const) {
    const path = join(directory, `${expectedHash}.${format}`);
    if (!existsSync(path)) continue;
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid?.()
      || (info.mode & 0o077) !== 0 || info.size > maxBytes) throw new Error('media_cache_unsafe');
    const media = await validateImage(readFileSync(path));
    if (media.sha256 !== expectedHash || media.format !== format) throw new Error('media_cache_conflict');
    return { ...media, path };
  }
  return null;
}

export async function downloadMedia(urlValue: string, allowedOrigins: string[], directory: string, request = fetch): Promise<Media> {
  const url = new URL(urlValue);
  if (url.protocol !== 'https:' || url.username || url.password || !allowedOrigins.includes(url.origin)
    || !allowedOrigins.every(origin => /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(origin) || origin === 'https://www.razvantodica.com')) throw new Error('media_origin_forbidden');
  const expectedHash = immutablePublicHash(url);
  if (!expectedHash) return downloadMediaBytes(url, directory, request);
  protectDirectory(resolve(directory));
  const scope = createHash('sha256').update(`${url.origin}${url.pathname}`).digest('hex');
  const scopedDirectory = join(resolve(directory), `public-${scope}`);
  let requests = pending.get(request);
  if (!requests) { requests = new Map(); pending.set(request, requests); }
  const key = scopedDirectory;
  const existing = requests.get(key);
  if (existing) return existing;
  const operation = (async () => {
    const cached = await cachedMedia(scopedDirectory, expectedHash);
    return cached ?? downloadMediaBytes(url, scopedDirectory, request, expectedHash);
  })();
  requests.set(key, operation);
  try { return await operation; }
  finally { requests.delete(key); }
}

async function downloadMediaBytes(url: URL, directory: string, request: typeof fetch, expectedHash?: string): Promise<Media> {
  const response = await request(url, { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
  if (response.status !== 200 || !response.body) {
    await response.body?.cancel();
    throw new Error('media_download_failed');
  }
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > maxBytes) { await response.body.cancel(); throw new Error('media_size_invalid'); }
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length; if (size > maxBytes) throw new Error('media_size_invalid'); chunks.push(value);
    }
  } catch (error) { await reader.cancel(); throw error; }
  const bytes = Buffer.concat(chunks), media = await validateImage(bytes);
  if (expectedHash && media.sha256 !== expectedHash) throw new Error('media_hash_mismatch');
  const expectedType = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }[media.format];
  if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== expectedType) throw new Error('media_type_mismatch');
  protectDirectory(directory);
  const path = join(directory, `${media.sha256}.${media.format}`);
  if (existsSync(path)) {
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) throw new Error('media_cache_unsafe');
    if (!readFileSync(path).equals(bytes)) throw new Error('media_cache_conflict');
  } else writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 });
  return { ...media, path };
}
