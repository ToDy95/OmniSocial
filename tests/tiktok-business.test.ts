import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fingerprint } from '../worker/planner.ts';
import { tiktokBusiness } from '../worker/adapters/tiktok.ts';
import { personalFixture } from './adapter-fixture.ts';
test('Business uses distinct identity and commercially reviewed sound with exact disclosures', () => {
  const { item, context } = personalFixture();
  item.target = 'tiktok_codeonroids'; item.accountId = 'fixture-business';
  item.payload.musicPolicy = 'cml:fixturetrack:fixturerights';
  item.payload.disclosures!.ownBrand = true; item.payloadDigest = fingerprint(item.payload);
  const business = { ...context, accountId: 'fixture-business', accountTypeVerified: true, commercialRightsVerified: true };
  assert.equal(tiktokBusiness(item, business).status, 'dry_run_validated');
  assert.equal(tiktokBusiness(item, { ...business, accountId: 'fixture-personal' }).status, 'blocked');
  assert.equal(tiktokBusiness(item, { ...business, commercialRightsVerified: false }).reason, 'commercial_music_rights_required');
  assert.equal(tiktokBusiness(item, { ...business, accountTypeVerified: false }).reason, 'business_account_type_required');
  const changed = structuredClone(item); changed.payload.disclosures!.aiGenerated = false;
  assert.equal(tiktokBusiness(changed, business).reason, 'payload_changed');
});
