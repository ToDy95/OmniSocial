import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from '../worker/local.ts';
import { buildReachWorkflow, reachWorkflowTargets } from './reach-workflows.ts';

for (const entry of reachWorkflowTargets) {
  const file = join(root, 'workflows', `SOC-016-reach-${entry.slug}.json`);
  writeFileSync(file, `${JSON.stringify(buildReachWorkflow(entry), null, 2)}\n`, { mode: 0o600 });
}
