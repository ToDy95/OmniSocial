import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const targets = ['tiktok_personal', 'tiktok_codeonroids', 'reddit', 'x', 'pinterest_personal', 'pinterest_business'] as const;

export function protectDirectory(path: string) {
  if (existsSync(path) && (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink())) {
    throw new Error('Unsafe local directory');
  }
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}

export function secret(name: string): string {
  const path = join(root, '.secrets', name);
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()) {
    throw new Error('Local secret must be an owner-only regular file');
  }
  const value = readFileSync(path, 'utf8').trim();
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid local secret');
  return value;
}

export function setupLocal() {
  process.umask(0o077);
  for (const dir of ['.secrets', 'runtime', 'runtime/n8n', 'runtime/media', 'runtime/reports', 'profiles', 'profiles/portfolio', ...targets.map(t => `profiles/${t}`)]) {
    protectDirectory(join(root, dir));
  }
  for (const name of ['worker-token', 'n8n-encryption-key']) {
    const path = join(root, '.secrets', name);
    if (!existsSync(path)) writeFileSync(path, `${randomBytes(32).toString('hex')}\n`, { flag: 'wx', mode: 0o600 });
    secret(name);
  }
}
