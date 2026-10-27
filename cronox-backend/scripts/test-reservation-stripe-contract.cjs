'use strict';
// Only new, uniquely tagged sandbox objects. No production DB or real money.
const fs = require('node:fs'), path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const backend = path.resolve(__dirname, '..');
const reportFile = path.resolve(backend, '../output/stock-reservations/stripe-contract.json');
const report = { provider: 'REAL_STRIPE_TEST_API', realMoney: false, checks: [], passed: false };
async function run() {
  const settings = require('dotenv').parse(fs.readFileSync(path.join(backend, '.env.stripe-sandbox')));
  assert.ok(settings.STRIPE_SECRET_KEY?.startsWith('sk_test_'), 'Only test keys accepted');
  require('ts-node').register({ project: path.join(backend, 'tsconfig.json'), transpileOnly: true });
  const { StripeService } = require('../src/payments/stripe.service');
  const service = new StripeService({ get: key => key === 'FRONTEND_URL' ? 'http://localhost:4173' : settings[key] });
  const sdk = service.stripe, owned = [];
  const check = name => { report.checks.push(name); console.log('[PASS]', name); };
  const configurations = await sdk.paymentMethodConfigurations.list({ limit: 100 });
  report.availableMethods = configurations.data.filter(c => c.active && c.is_default).flatMap(c => Object.entries(c).filter(([, value]) => value && typeof value === 'object' && value.available === true).map(([key]) => key));
  async function create() {
    const args = { checkoutSnapshotId: 'reservation_contract_' + randomUUID(), amount: 100, currency: 'eur' };
    const result = await service.createPaymentIntentForCheckout(args);
    const intent = await sdk.paymentIntents.retrieve(result.id);
    assert.equal(intent.livemode, false); assert.equal(intent.status, 'requires_payment_method');
    const fixture = { ...args, paymentIntentId: result.id, stripeAccountId: result.stripeAccountId };
    owned.push(fixture); return fixture;
  }
  const confirm = (f, payment_method) => sdk.paymentIntents.confirm(f.paymentIntentId, { payment_method, return_url: 'http://localhost:4173/checkout/exito' });
  try {
    const unconfirmed = await create();
    assert.equal((await service.reconcileExpiredCheckoutPayment(unconfirmed)).status, 'canceled');
    await assert.rejects(confirm(unconfirmed, 'pm_card_visa'));
    check('Prepared intent canceled; old client cannot confirm after cancellation');
    const card = await create();
    await assert.rejects(confirm(card, 'pm_card_visa_chargeDeclined'));
    assert.equal((await sdk.paymentIntents.retrieve(card.paymentIntentId)).status, 'requires_payment_method');
    assert.equal((await confirm(card, 'pm_card_visa')).status, 'succeeded');
    assert.equal((await service.reconcileExpiredCheckoutPayment(card)).status, 'succeeded');
    check('Real test-card decline/retry succeeds on same intent; expiration reconciliation recognizes paid intent');
    const challenge = await create();
    assert.equal((await confirm(challenge, 'pm_card_threeDSecure2Required')).status, 'requires_action');
    assert.equal((await service.reconcileExpiredCheckoutPayment(challenge)).status, 'canceled');
    await assert.rejects(confirm(challenge, 'pm_card_visa'));
    check('Outstanding 3DS challenge cancels before inventory may be released');
    if (report.availableMethods.includes('paypal')) {
      const paypal = await create();
      const intent = await sdk.paymentIntents.confirm(paypal.paymentIntentId, { payment_method_data: { type: 'paypal' }, return_url: 'http://localhost:4173/checkout/exito' });
      assert.equal(intent.status, 'requires_action');
      assert.equal((await service.reconcileExpiredCheckoutPayment(paypal)).status, 'canceled');
      check('PayPal test redirect remains pending and can be canceled before release (approval UI not exercised)');
    }
    if (report.availableMethods.includes('customer_balance')) {
      const bank = await create();
      await service.prepareBankTransfer({ ...bank, email: 'reservation-contract@example.test' });
      const intent = await service.confirmBankTransfer(bank.paymentIntentId, bank.checkoutSnapshotId);
      assert.equal(intent.status, 'requires_action');
      assert.equal((await service.reconcileExpiredCheckoutPayment(bank)).status, 'canceled');
      await sdk.testHelpers.customers.fundCashBalance(intent.customer, { amount: 100, currency: 'eur' });
      assert.equal((await sdk.paymentIntents.retrieve(bank.paymentIntentId)).status, 'canceled');
      const balance = await sdk.customers.retrieveCashBalance(intent.customer);
      assert.equal(balance.available.eur, 100);
      check('Bank instructions cancel; late synthetic transfer remains cash balance and does not resurrect canceled payment');
    }
    report.passed = true;
  } finally {
    report.cleanup = [];
    for (const fixture of owned) {
      try {
        const intent = await sdk.paymentIntents.retrieve(fixture.paymentIntentId);
        assert.equal(intent.livemode, false); assert.equal(intent.metadata.checkoutSnapshotId, fixture.checkoutSnapshotId);
        if (!['canceled', 'succeeded'].includes(intent.status)) await service.reconcileExpiredCheckoutPayment(fixture);
        report.cleanup.push({ intent: fixture.paymentIntentId, status: (await sdk.paymentIntents.retrieve(fixture.paymentIntentId)).status });
      } catch { report.cleanup.push({ intent: fixture.paymentIntentId, status: 'REVIEW_REQUIRED' }); }
    }
    report.note = 'Synthetic succeeded charges and test cash balance retained as test evidence; no automatic refunds. Wallet/PayPal approval UI and live bank timing require separate validation.';
  }
}
run().catch(error => { report.error = { name: error.name, code: error.code || 'ASSERTION_OR_PROVIDER_FAILURE' }; process.exitCode = 1; console.error(report.error); }).finally(() => {
  fs.mkdirSync(path.dirname(reportFile), { recursive: true }); fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
});
