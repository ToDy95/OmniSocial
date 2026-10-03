import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const names = ['tiktok', 'reddit', 'x', 'pinterest', 'item', 'account', 'batch'];
test('finite fixture exports have fixed authenticated operations and sequential waits without live triggers', () => {
  for (const name of names) {
    const workflow = JSON.parse(readFileSync(new URL(`../workflows/SOC-011-${name}-fixture.json`, import.meta.url), 'utf8'));
    assert.equal(workflow.active, false);
    assert.deepEqual(workflow.pinData, {});
    for (const node of workflow.nodes) {
      assert.ok(['manualTrigger', 'executeWorkflowTrigger', 'httpRequest', 'if', 'set', 'switch', 'executeWorkflow', 'splitOut', 'splitInBatches', 'aggregate'].some(type => node.type === `n8n-nodes-base.${type}`));
      if (node.type.endsWith('.httpRequest')) {
        assert.ok(['http://127.0.0.1:8787/v1/fixture/item', 'http://127.0.0.1:8787/v1/fixture/batch'].includes(node.parameters.url));
        assert.equal(node.credentials.httpHeaderAuth.id, 'omnisocialWorker');
        assert.notEqual(node.retryOnFail, true);
      }
      if (node.type.endsWith('.executeWorkflow')) assert.equal(node.parameters.options.waitForSubWorkflow, true);
      if (node.type.endsWith('.splitInBatches')) assert.equal(node.parameters.batchSize, 1);
    }
    assert.ok(!JSON.stringify(workflow).includes('Bearer '));
  }
});
