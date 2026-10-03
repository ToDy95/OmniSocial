import { test } from 'node:test';
import assert from 'node:assert/strict';
import { personalFixture } from './adapter-fixture.ts';
import { fingerprint } from '../worker/planner.ts';
import { x, conservativeXLength } from '../worker/adapters/x.ts';
test('X uses a conservative compact bound and owner composer; never scripts the website', () => {
  const { item, context } = personalFixture(); item.target = 'x'; item.payload.media = null; item.payloadDigest = fingerprint(item.payload);
  assert.equal(x(item, context).status, 'dry_run_validated');
  assert.equal(x(item, { ...context, mode: 'publish' }).handoff!.destination, 'https://x.com/compose/post');
  assert.equal(x(item, { ...context, transport: 'api' }).reason, 'api_transport_not_enabled');
  assert.equal(conservativeXLength('你好'), 4);
  item.payload.caption = '界'.repeat(141); item.payloadDigest = fingerprint(item.payload);
  assert.equal(x(item, context).reason, 'compact_copy_review_required');
  assert.equal(item.payload.caption.length, 141);
});
