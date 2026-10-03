import { test } from 'node:test';
import assert from 'node:assert/strict';
import { personalFixture } from './adapter-fixture.ts';
import { fingerprint } from '../worker/planner.ts';
import { pinterest } from '../worker/adapters/pinterest.ts';
test('Pinterest requires distinct identities and the exact writable public board/link', () => {
  const { item, context } = personalFixture();
  item.target = 'pinterest_personal'; item.canonicalUrl = 'https://www.razvantodica.com/blog/fixture';
  item.payload.destination = 'fixture-board'; item.payloadDigest = fingerprint(item.payload);
  const board = { ...context, boardId: 'fixture-board', boardWritable: true, boardPublic: true };
  assert.equal(pinterest(item, board).status, 'dry_run_validated');
  assert.equal(pinterest(item, { ...board, boardId: 'other' }).reason, 'owned_public_board_required');
  assert.equal(pinterest(item, { ...board, boardPublic: false }).status, 'blocked');
  item.target = 'pinterest_business'; item.accountId = 'fixture-business';
  assert.equal(pinterest(item, board).reason, 'fresh_matching_identity_required');
  assert.equal(pinterest(item, { ...board, accountId: 'fixture-business' }).status, 'dry_run_validated');
  assert.equal(pinterest(item, { ...board, accountId: 'fixture-business', transport: 'api' }).reason, 'api_transport_not_enabled');
});
