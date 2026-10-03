import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('manual browser workflows keep private credentials, dry defaults and exact recovery inputs', () => {
  for (const name of ['run', 'stop']) {
    const workflow = JSON.parse(readFileSync(new URL(`../workflows/SOC-015-browser-${name}.json`, import.meta.url), 'utf8'));
    assert.equal(workflow.active, false);
    assert.equal(workflow.nodes.filter((node: any) => node.type.endsWith('manualTrigger')).length, 1);
    assert.equal(workflow.nodes.some((node: any) => /scheduleTrigger|cron|webhook|executeCommand/.test(node.type)), false);
    assert.deepEqual(workflow.pinData, {});
    assert.equal(workflow.settings.saveManualExecutions, false);
    assert.equal(workflow.settings.saveDataSuccessExecution, 'none');
    assert.equal(workflow.settings.saveDataErrorExecution, 'none');
    for (const node of workflow.nodes.filter((node: any) => node.type.endsWith('httpRequest'))) {
      assert.match(node.parameters.url, /http:\/\/127\.0\.0\.1:8787\/v1\/browser\//);
      assert.deepEqual(node.credentials, { httpHeaderAuth: { id: 'omnisocialWorker', name: 'OmniSocial local worker' } });
    }
    if (name === 'run') {
      const choices = workflow.nodes.find((node: any) => node.id === 'choices').parameters.assignments.assignments;
      assert.equal(choices.find((field: any) => field.name === 'mode').value, 'dry_run');
      assert.equal(choices.find((field: any) => field.name === 'ownerConfirmed').value, false);
      const expression = workflow.nodes.find((node: any) => node.id === 'command').parameters.jsonBody;
      const body = (operation: string) => JSON.parse(new Function('$json', '$execution', `return ${expression.slice(3, -2)}`)({
        operation, runId: 'fixture-run', target: 'portfolio', itemId: 'a'.repeat(64), manifestId: 'b'.repeat(64), digest: 'b'.repeat(64), mode: 'publish', ownerConfirmed: true,
      }, { id: 'fixture-job' }));
      assert.deepEqual(body('close'), { runId: 'fixture-run' });
      assert.deepEqual(body('stop'), { runId: 'fixture-run' });
      assert.deepEqual(body('plan'), { jobId: 'browser-fixture-job' });
      assert.equal(body('publish').ownerConfirmed, true);
      assert.deepEqual(body('reconcile'), { jobId: 'browser-fixture-job', runId: 'fixture-run', itemId: 'a'.repeat(64) });
    }
  }
});
