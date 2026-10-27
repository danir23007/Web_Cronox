import { localCheckoutTestEnabled } from './local-checkout-test';

describe('explicit local checkout worker opt-in', () => {
  const original = { ...process.env };
  afterEach(() => { process.env = { ...original }; });
  it('only enables a development loopback database with explicit opt-in and test key', () => {
    const valid = { CRONOX_LOCAL_DEV: 'true', NODE_ENV: 'development', CRONOX_LOCAL_CHECKOUT_TEST: 'true', STRIPE_SECRET_KEY: 'sk_test_fixture', DATABASE_URL: 'postgresql://local@127.0.0.1:5433/cronox_dev' };
    Object.assign(process.env, valid);
    expect(localCheckoutTestEnabled()).toBe(true);
    for (const patch of [{ NODE_ENV: 'production' }, { STRIPE_SECRET_KEY: 'sk_live_fixture' }, { DATABASE_URL: 'postgresql://remote/db' }, { CRONOX_LOCAL_CHECKOUT_TEST: 'false' }, { CRONOX_LOCAL_DEV: 'false' }]) {
      Object.assign(process.env, valid, patch);
      expect(localCheckoutTestEnabled()).toBe(false);
    }
  });
});
