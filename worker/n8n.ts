import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { root, secret } from './local.ts';

export function runN8n(args: string[]) {
process.umask(0o077);
const child = spawn(process.execPath, [join(root, 'node_modules/n8n/bin/n8n'), ...args], {
  stdio: 'inherit',
  env: {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: 'production',
    N8N_USER_FOLDER: join(root, 'runtime/n8n'),
    N8N_ENCRYPTION_KEY: secret('n8n-encryption-key'),
    N8N_LISTEN_ADDRESS: '127.0.0.1',
    N8N_HOST: 'localhost',
    N8N_PORT: '5678',
    N8N_PROTOCOL: 'http',
    N8N_EDITOR_BASE_URL: 'http://localhost:5678',
    N8N_SECURE_COOKIE: 'true',
    N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS: 'true',
    N8N_DIAGNOSTICS_ENABLED: 'false',
    N8N_VERSION_NOTIFICATIONS_ENABLED: 'false',
    N8N_TEMPLATES_ENABLED: 'false',
    N8N_PUBLIC_API_DISABLED: 'true',
    N8N_BLOCK_ENV_ACCESS_IN_NODE: 'true',
    N8N_BLOCK_FILE_ACCESS_TO_N8N_FILES: 'true',
    N8N_COMMUNITY_PACKAGES_ENABLED: 'false',
    NODES_EXCLUDE: JSON.stringify(['n8n-nodes-base.executeCommand', 'n8n-nodes-base.readWriteFile']),
    EXECUTIONS_DATA_SAVE_ON_ERROR: 'none',
    EXECUTIONS_DATA_SAVE_ON_SUCCESS: 'none',
    EXECUTIONS_DATA_SAVE_MANUAL_EXECUTIONS: 'false',
    GENERIC_TIMEZONE: 'Europe/Bucharest',
    TZ: 'Europe/Bucharest'
  }
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));
child.on('error', () => { console.error('n8n could not start'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
return child;
}
