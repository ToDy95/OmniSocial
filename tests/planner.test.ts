import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan, validateApproval, fingerprint } from '../worker/planner.ts';
import { fixtureSnapshot, fixturePlan } from '../worker/fixture.ts';
import { targets } from '../worker/local.ts';

const asOf = '2026-01-10T00:00:00.000Z';
test('finite immutable manifest respects account order, caps, independent progress and replay', () => {
  const source = fixtureSnapshot(), before = fingerprint(source);
  const manifest = plan(source, [...targets].reverse(), 2, asOf);
  assert.deepEqual(manifest.targetOrder, targets);
  assert.equal(manifest.items.length, 12);
  assert.equal(fingerprint(source), before);
  assert.deepEqual(manifest, plan(JSON.parse(JSON.stringify(source)), [...targets], 2, asOf));
  const personal = manifest.items.filter((i: any) => i.target === 'tiktok_personal') as any[];
  const business = manifest.items.filter((i: any) => i.target === 'tiktok_codeonroids') as any[];
  assert.deepEqual(personal.map(i => i.articleId), ['article-b', 'article-c']);
  assert.deepEqual(business.map(i => i.articleId), ['article-a', 'article-b']);
  assert.ok(manifest.exclusions.some(e => e.target === 'pinterest_business' && e.articleId === 'article-b' && e.reason === 'unresolved_submission'));
  assert.throws(() => (manifest as any).items.push({}), TypeError);
  source.articles[0].payloads.x!.caption = 'Changed source';
  assert.notEqual(manifest.digest, plan(source, [...targets], 2, asOf).digest);
  assert.equal(fixturePlan().publishingEnabled, false);
});
test('incomplete, duplicate and invalid scopes fail closed; copy/media/future exclusions remain explicit', () => {
  for (const change of [ (s: any) => s.complete = false, (s: any) => s.nextCursor = 'next',
    (s: any) => s.accounts.push(s.accounts[0]), (s: any) => s.articles.push(s.articles[0]) ]) {
    const s = fixtureSnapshot(); change(s); assert.throws(() => plan(s, [...targets], 2, asOf));
  }
  assert.throws(() => plan(fixtureSnapshot(), ['unknown' as any], 2, asOf));
  assert.throws(() => plan(fixtureSnapshot(), [...targets], 0, asOf));
  const s = fixtureSnapshot();
  s.articles[0].payloads.x!.approved = false;
  s.articles[1].payloads.pinterest_personal!.media = null;
  s.articles[2].publishedAt = '2027-01-01T00:00:00.000Z';
  s.articles[0].payloads.reddit!.media!.url = 'file:///tmp/private';
  const m = plan(s, [...targets], 20, asOf);
  for (const reason of ['unapproved_or_missing_copy', 'required_media_missing', 'not_published_yet', 'invalid_media_reference']) {
    assert.ok(m.exclusions.some(e => e.reason === reason));
  }
});
test('approval binds entire manifest, identity, owner and bounded expiry; changed payload never gains new delivery identity', () => {
  const s = fixtureSnapshot(); s.accounts.forEach(a => a.identityVerified = true);
  const m = plan(s, ['x'], 1, asOf);
  const approval = { owner: m.owner, manifestDigest: m.digest, approvedAt: asOf, expiresAt: '2026-01-10T01:00:00.000Z' };
  assert.equal(validateApproval(m, approval, asOf), true);
  assert.throws(() => validateApproval(m, approval, approval.expiresAt));
  assert.throws(() => validateApproval(m, { ...approval, owner: 'other' }, asOf));
  assert.throws(() => validateApproval(m, { ...approval, expiresAt: '2026-01-10T02:00:00.000Z' }, asOf));
  assert.throws(() => validateApproval(plan(fixtureSnapshot(), ['x'], 1, asOf), approval, asOf));
  const unverified = plan(fixtureSnapshot(), ['x'], 1, asOf);
  assert.throws(() => validateApproval(unverified, { ...approval, manifestDigest: unverified.digest }, asOf), /account_identity_unverified/);
  for (const field of ['caption', 'destination', 'visibility', 'musicPolicy', 'media']) {
    const changed: any = structuredClone(m);
    changed.items[0].payload[field] = 'changed';
    assert.throws(() => validateApproval(changed, approval, asOf), /manifest_changed/);
  }
  s.articles.find(a => a.id === 'article-a')!.payloads.x!.caption = 'Updated';
  const changed = plan(s, ['x'], 1, asOf);
  assert.equal((m.items[0] as any).itemId, (changed.items[0] as any).itemId);
  assert.notEqual(m.digest, changed.digest);
});
