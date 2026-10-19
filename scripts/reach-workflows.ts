export const reachWorkflowTargets = [
  { target: 'tiktok_personal', id: 'omnisocialReachTiktokPersonal', slug: 'tiktok-personal', label: 'TikTok Personal' },
  { target: 'tiktok_codeonroids', id: 'omnisocialReachTiktokBusiness', slug: 'tiktok-business', label: 'TikTok Business' },
  { target: 'x', id: 'omnisocialReachX', slug: 'x', label: 'X' },
  { target: 'reddit', id: 'omnisocialReachReddit', slug: 'reddit', label: 'Reddit' },
  { target: 'pinterest_business', id: 'omnisocialReachPinterestBusiness', slug: 'pinterest-business', label: 'Pinterest Business' },
  { target: 'pinterest_personal', id: 'omnisocialReachPinterestPersonal', slug: 'pinterest-personal', label: 'Pinterest Personal' },
] as const;

export function buildReachWorkflow(entry: typeof reachWorkflowTargets[number]) {
  const target = entry.target;
  const label = entry.label;
  const field = (name: string, value: string | boolean, type: 'string' | 'boolean') => ({
    id: name, name, value, type,
  });
  return {
    id: entry.id,
    name: `SOC-016 · Reach · ${label}`,
    active: false,
    nodes: [
      { id: 'manual', name: `Start ${label} Reach flow`, type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
      { id: 'choices', name: `Choose ${label} action and approved pack lot`, type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [240, 0], parameters: {
        assignments: { assignments: [
          field('operation', 'plan', 'string'), field('mode', 'dry_run', 'string'), field('ownerConfirmed', false, 'boolean'),
          field('manifestId', '', 'string'), field('digest', '', 'string'), field('view', 'identity', 'string'),
          field('runId', '', 'string'), field('itemId', '', 'string'), field('url', '', 'string'),
          field('contentKind', 'reach', 'string'),
        ] }, options: {},
      } },
      { id: 'command', name: `Run ${label} browser action`, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [480, 0], parameters: {
        method: 'POST', url: "={{ 'http://127.0.0.1:8787/v1/browser/' + $json.operation }}",
        authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', sendBody: true, specifyBody: 'json',
        jsonBody: `={{ JSON.stringify($json.operation === 'publish' ? { jobId: 'reach-${target}-' + $execution.id, manifestId: $json.manifestId, digest: $json.digest, mode: $json.mode, ownerConfirmed: $json.ownerConfirmed, target: '${target}' } : $json.operation === 'login' ? { jobId: 'reach-${target}-' + $execution.id, target: '${target}' } : $json.operation === 'inspect' ? { jobId: 'reach-${target}-' + $execution.id, target: '${target}', view: $json.view } : $json.operation === 'reconcile' ? { jobId: 'reach-${target}-' + $execution.id, runId: $json.runId, itemId: $json.itemId, target: '${target}', ...($json.url ? { url: $json.url } : {}) } : ['stop', 'close'].includes($json.operation) ? { runId: $json.runId, target: '${target}' } : { jobId: 'reach-${target}-' + $execution.id, target: '${target}', contentKind: 'reach' }) }}`,
        options: { timeout: 10000, response: { response: { neverError: true } } },
      }, credentials: { httpHeaderAuth: { id: 'omnisocialWorker', name: 'OmniSocial local worker' } }, onError: 'continueRegularOutput' },
      { id: 'running', name: `${label} Reach browser still working?`, type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [720, 0], parameters: {
        conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          conditions: [{ id: 'running', leftValue: '={{ $json.state === \'running\' }}', rightValue: true,
            operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {},
      } },
      { id: 'wait', name: `Wait for ${label} Reach browser`, type: 'n8n-nodes-base.wait', typeVersion: 1.1, position: [960, -120], parameters: { resume: 'timeInterval', amount: 5, unit: 'seconds' } },
      { id: 'status', name: `Read ${label} Reach browser result`, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [1200, -120], parameters: {
        url: "={{ 'http://127.0.0.1:8787/v1/browser/jobs/' + $json.jobId }}", authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
        options: { timeout: 10000, response: { response: { neverError: true } } },
      }, credentials: { httpHeaderAuth: { id: 'omnisocialWorker', name: 'OmniSocial local worker' } }, onError: 'continueRegularOutput' },
      { id: 'result', name: `${label} Reach result and next step`, type: 'n8n-nodes-base.code', typeVersion: 2, position: [960, 140], parameters: {
        jsCode: `const value = $input.first().json; const result = value.result ?? value; const action = result.reason === 'existing_profile_in_use' ? 'The existing ${label} browser profile is already open. Bring that window forward; do not launch another browser or profile.' : result.status === 'review_required' && result.accountReadiness?.some(item => item.identityVerified === false) ? 'Reach manifest ready for review, but this account has no calibrated identity selector. Do not publish until the existing account profile has been checked and its UI controls are configured.' : result.status === 'review_required' ? '${label} Reach manifest ready. Review the exact pack, every ordered image, copy, account, destination and visibility; approve this digest only after review.' : result.status === 'awaiting_owner_login' ? 'Finish login in the existing ${label} browser profile, then run plan again. No new browser profile is needed.' : result.status === 'caught_up' && result.progress?.some(item => item.unresolved > 0) ? 'No eligible ${label} Reach packs. Review unresolved or unsupported deliveries in the report before trying again.' : result.status === 'caught_up' || result.status === 'completed' || result.status === 'synchronized' ? 'Read the ${label} Reach progress and receipt report. This workflow never switches accounts.' : 'Inspect the stop reason and reconcile the exact ${label} Reach item before any retry.'; return [{ json: { ...value, action } }];`,
      } },
    ],
    connections: {
      [`Start ${label} Reach flow`]: { main: [[{ node: `Choose ${label} action and approved pack lot`, type: 'main', index: 0 }]] },
      [`Choose ${label} action and approved pack lot`]: { main: [[{ node: `Run ${label} browser action`, type: 'main', index: 0 }]] },
      [`Run ${label} browser action`]: { main: [[{ node: `${label} Reach browser still working?`, type: 'main', index: 0 }]] },
      [`${label} Reach browser still working?`]: { main: [[{ node: `Wait for ${label} Reach browser`, type: 'main', index: 0 }], [{ node: `${label} Reach result and next step`, type: 'main', index: 0 }]] },
      [`Wait for ${label} Reach browser`]: { main: [[{ node: `Read ${label} Reach browser result`, type: 'main', index: 0 }]] },
      [`Read ${label} Reach browser result`]: { main: [[{ node: `${label} Reach browser still working?`, type: 'main', index: 0 }]] },
    },
    settings: { executionOrder: 'v1', saveExecutionProgress: false, saveManualExecutions: false,
      saveDataSuccessExecution: 'none', saveDataErrorExecution: 'none', executionTimeout: 3600 },
    pinData: {}, tags: [],
  };
}
