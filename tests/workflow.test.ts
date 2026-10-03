import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('manual health export cannot schedule, publish, pin execution data or embed credentials', () => {
  const workflow = JSON.parse(readFileSync(new URL('../workflows/SOC-003-manual-health.json', import.meta.url), 'utf8'));
  const allowed = new Set(['n8n-nodes-base.manualTrigger', 'n8n-nodes-base.httpRequest', 'n8n-nodes-base.if', 'n8n-nodes-base.set']);
  assert.equal(workflow.active, false);
  assert.deepEqual(workflow.pinData, {});
  assert.equal(workflow.nodes.filter((n: {type: string}) => n.type === 'n8n-nodes-base.manualTrigger').length, 1);
  for (const node of workflow.nodes) {
    assert.ok(allowed.has(node.type));
    assert.notEqual(node.retryOnFail, true);
    if (node.type === 'n8n-nodes-base.httpRequest') {
      assert.equal(node.parameters.url, 'http://127.0.0.1:8787/v1/health');
      assert.equal(node.parameters.method ?? 'GET', 'GET');
      assert.equal(node.parameters.sendBody ?? false, false);
      assert.equal(node.onError, 'continueRegularOutput');
      assert.deepEqual(node.credentials, { httpHeaderAuth: { id: 'omnisocialWorker', name: 'OmniSocial local worker' } });
      assert.equal(node.parameters.headerParameters, undefined);
    }
  }
  for (const key of ['saveDataSuccessExecution', 'saveDataErrorExecution']) assert.equal(workflow.settings[key], 'none');
  assert.equal(workflow.settings.saveManualExecutions, false);
  assert.ok(workflow.connections['Ready for dry run?'].main.every((branch: object[]) => branch.length === 1));
});

test('fixture planning workflow uses only the authenticated fixed read operation and retains review payload', () => {
  const workflow = JSON.parse(readFileSync(new URL('../workflows/SOC-004-manual-plan.json', import.meta.url), 'utf8'));
  assert.equal(workflow.active, false);
  assert.deepEqual(workflow.pinData, {});
  assert.equal(workflow.nodes.filter((n: any) => n.type.endsWith('manualTrigger')).length, 1);
  for (const node of workflow.nodes) {
    assert.ok(['manualTrigger', 'httpRequest', 'if', 'set'].some(type => node.type === `n8n-nodes-base.${type}`));
    assert.notEqual(node.retryOnFail, true);
    if (node.type.endsWith('httpRequest')) {
      assert.equal(node.parameters.url, 'http://127.0.0.1:8787/v1/plan-fixture');
      assert.equal(node.parameters.method ?? 'GET', 'GET');
      assert.equal(node.parameters.sendBody ?? false, false);
      assert.deepEqual(node.credentials, { httpHeaderAuth: { id: 'omnisocialWorker', name: 'OmniSocial local worker' } });
    }
  }
  assert.equal(workflow.nodes.find((n: any) => n.name === 'Review fixture manifest').parameters.includeOtherFields, true);
  assert.equal(workflow.settings.saveManualExecutions, false);
  assert.equal(workflow.settings.saveDataSuccessExecution, 'none');
  assert.equal(workflow.settings.saveDataErrorExecution, 'none');
});
