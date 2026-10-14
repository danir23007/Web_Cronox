'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { inspect, forbiddenFile } = require('./check-checkout-release-safety.cjs');

test('rejects private files and sandbox helpers even if accidentally tracked', () => {
  for (const file of ['cronox-backend/.env.stripe-sandbox', '.env', 'test-results/stripe-sandbox/report.json', 'output/playwright/session.json', 'cronox-backend/scripts/checkout-sandbox.cjs', 'cronox-backend/scripts/checkout-sandbox.spec.cjs', 'cronox-backend/scripts/verify-physical-wallets.cjs']) {
    assert.equal(forbiddenFile(file), true, file);
    assert.equal(inspect([file], []).length, 1);
  }
  assert.equal(forbiddenFile('cronox-backend/.env.example'), false);
  assert.equal(forbiddenFile('cronox-backend/src/payments/bank-transfer.service.ts'), false);
});

test('rejects embedded credentials without echoing them, allowing the production public key', () => {
  for (const prefix of ['sk_' + 'test_', 'sk_' + 'live_', 'rk_' + 'live_', 'whsec_', 'pk_' + 'test_']) {
    const secret = prefix + 'x'.repeat(32);
    const failures = inspect([], [['cronox-front/assets/config.js', `key='${secret}'`]]);
    assert.equal(failures.length, 1);
    assert.ok(!failures[0].includes(secret));
  }
  assert.deepEqual(inspect([], [['cronox-front/assets/config.js', "key='" + 'pk_' + 'live_' + 'x'.repeat(32) + "'"]]), []);
  assert.equal(inspect([], [['cronox-front/config.json', 'private-buyer-password']], ['private-buyer-password']).length, 1);
  assert.equal(inspect([], [['cronox-front/.env.stripe-sandbox', '']]).length, 1);
});
