import { test } from 'node:test';
import assert from 'node:assert/strict';
import { personalFixture } from './adapter-fixture.ts';
import { fingerprint } from '../worker/planner.ts';
import { reddit } from '../worker/adapters/reddit.ts';
test('Reddit requires reviewed subreddit/type/flair and returns owner-only assisted submission', () => {
  const { item, context } = personalFixture(); item.target = 'reddit';
  item.payload.destination = 'r/fixture'; item.payload.postType = 'image'; item.payload.flair = 'fixture-flair'; item.payloadDigest = fingerprint(item.payload);
  const reviewed = { ...context, rulesReviewed: true, postType: 'image' as const, flair: 'fixture-flair' };
  assert.equal(reddit(item, reviewed).status, 'dry_run_validated');
  assert.equal(reddit(item, { ...reviewed, mode: 'publish' }).status, 'awaiting_owner');
  assert.equal(reddit(item, { ...reviewed, rulesReviewed: false }).reason, 'subreddit_rules_review_required');
  assert.equal(reddit(item, { ...reviewed, flair: 'changed' }).reason, 'post_type_or_flair_changed');
  assert.equal(reddit(item, { ...reviewed, transport: 'api' }).reason, 'api_transport_not_enabled');
});
