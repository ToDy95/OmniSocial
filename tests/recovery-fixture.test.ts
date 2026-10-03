import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recoveryFixture } from '../worker/recovery-fixture.ts';
test('isolated recovery harness is repeatable and only reconciles synthetic receipts', () => {
  const first = recoveryFixture();
  assert.deepEqual(recoveryFixture(), first);
  assert.equal(first.unknown, 'submission_unknown');
  assert.equal(first.retryBlocked, true);
  assert.equal(first.syncPending, 'public_verified_sync_pending');
  assert.equal(first.reconciled, 'completed');
  assert.equal(first.synthetic, true);
  assert.equal(first.publishingEnabled, false);
});
