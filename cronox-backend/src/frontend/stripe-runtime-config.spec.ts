import { readFileSync, readdirSync } from 'fs';
import path from 'path';

describe('Stripe frontend runtime configuration', () => {
  const frontendRoot = path.resolve(__dirname, '../../../cronox-front');
  const checkoutHtml = readFileSync(
    path.join(frontendRoot, 'checkout.html'),
    'utf8',
  );
  const checkoutScript = readFileSync(
    path.join(frontendRoot, 'assets/checkout.js'),
    'utf8',
  );
  const runtimeConfig = readFileSync(
    path.join(frontendRoot, 'assets/runtime-config.js'),
    'utf8',
  );

  it('loads explicit runtime configuration before Stripe and checkout', () => {
    const configPosition = checkoutHtml.indexOf('assets/runtime-config.js');
    const stripePosition = checkoutHtml.indexOf('https://js.stripe.com/v3/');
    const checkoutPosition = checkoutHtml.indexOf('assets/checkout.js');

    expect(configPosition).toBeGreaterThan(-1);
    expect(configPosition).toBeLessThan(stripePosition);
    expect(stripePosition).toBeLessThan(checkoutPosition);
  });

  it('provides a public test-key slot without embedding a credential', () => {
    expect(runtimeConfig).toContain(
      "window.CRONOX_STRIPE_PUBLISHABLE_KEY = '';",
    );
    expect(runtimeConfig).toContain('pk_test_...');
    expect(runtimeConfig).toContain('publishable keys are not secrets');
    expect(runtimeConfig).not.toMatch(/pk_(?:test|live)_[A-Za-z0-9]+/);
    expect(runtimeConfig).not.toMatch(/sk_(?:test|live)_[A-Za-z0-9]+/);
  });

  it('keeps checkout fail-closed without a hardcoded fallback', () => {
    expect(checkoutScript).toContain('window.CRONOX_STRIPE_PUBLISHABLE_KEY');
    expect(checkoutScript).toContain('STRIPE_PUBLISHABLE_KEY_NOT_CONFIGURED');
    expect(checkoutScript).not.toMatch(/pk_(?:test|live)_[A-Za-z0-9]+/);
  });

  it('keeps Stripe.js and its runtime key config scoped to checkout', () => {
    const otherPages = readdirSync(frontendRoot)
      .filter((file) => file.endsWith('.html') && file !== 'checkout.html')
      .map((file) => readFileSync(path.join(frontendRoot, file), 'utf8'))
      .join('\n');

    expect(otherPages).not.toContain('https://js.stripe.com/v3/');
    expect(otherPages).not.toContain('assets/runtime-config.js');
  });
});
