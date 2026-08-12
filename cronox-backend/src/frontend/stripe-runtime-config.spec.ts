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
  const checkoutStyles = readFileSync(
    path.join(frontendRoot, 'assets/checkout.css'),
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

  it('provides a public test key without secret-key material', () => {
    const configuredKey = runtimeConfig.match(
      /window\.CRONOX_STRIPE_PUBLISHABLE_KEY\s*=\s*'([^']+)'/,
    )?.[1];
    expect(configuredKey).toMatch(/^pk_test_[A-Za-z0-9]+$/);
    expect(runtimeConfig).toContain('publishable keys are not secrets');
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

  it('removes the old hero, numbered steps and complete storefront topbar', () => {
    expect(checkoutHtml).not.toContain('FINALIZA TU PEDIDO');
    expect(checkoutHtml).not.toContain('Finaliza tu pedido');
    expect(checkoutHtml).not.toContain('checkout__head');
    expect(checkoutHtml).not.toContain('checkout-step__number');
    expect(checkoutHtml).not.toContain('class="topbar');
    expect(checkoutHtml).not.toContain('id="btnMenu"');
    expect(checkoutHtml).not.toContain('id="btnSearch"');
  });

  it('uses the existing linked logo and an unbadged cart icon as the only top navigation', () => {
    expect(checkoutHtml).toMatch(
      /<a href="index\.html" class="checkout-brand"[\s\S]*?<img src="assets\/logo_banner\.png"/,
    );
    const cartLink = checkoutHtml.match(
      /<a href="cart\.html" id="cart-icon-btn"[\s\S]*?<\/a>/,
    )?.[0];
    expect(cartLink).toContain('<svg');
    expect(cartLink).not.toContain('cart-count');
    expect(cartLink).not.toContain('badge');
  });

  it('uses a genuine Stripe Express Checkout Element for PayPal and Google Pay only', () => {
    expect(checkoutHtml).toContain('id="express-checkout-element"');
    expect(checkoutScript).toContain(
      "elements.create(\n        'expressCheckout'",
    );
    expect(checkoutScript).toContain(
      "paymentMethodOrder: ['paypal', 'google_pay']",
    );
    expect(checkoutScript).toMatch(
      /paymentMethods:\s*\{[\s\S]*?applePay:\s*'never'[\s\S]*?googlePay:\s*'auto'[\s\S]*?amazonPay:\s*'never'[\s\S]*?klarna:\s*'never'[\s\S]*?link:\s*'never'[\s\S]*?paypal:\s*'auto'/,
    );
    expect(checkoutScript).toContain("paypal: 'paypal'");
    expect(checkoutScript).toContain("googlePay: 'checkout'");
  });

  it('keeps Apple Pay in Stripe conventional wallet capability and Amazon Pay in Payment Element', () => {
    expect(checkoutScript).toMatch(
      /wallets:\s*\{[\s\S]*?applePay:\s*'auto'[\s\S]*?googlePay:\s*'never'/,
    );
    expect(checkoutScript).toContain(
      "paymentMethodOrder: ['card', 'klarna', 'amazon_pay', 'paypal']",
    );
  });

  it('includes the uppercase express separator and CONTACTO account row', () => {
    expect(checkoutHtml).toContain('<span>O</span>');
    expect(checkoutHtml).toContain(
      'id="contact-title" class="checkout-section-title">CONTACTO</h2>',
    );
    expect(checkoutHtml).toContain('id="checkout-customer-email"');
    expect(checkoutScript).toContain('renderCustomerContact');
    expect(checkoutScript).toContain('profile?.email');
  });

  it('loads and preserves the saved address while exposing native address controls', () => {
    expect(checkoutHtml).toContain('<details id="address-details"');
    expect(checkoutHtml).toContain('Predeterminada');
    expect(checkoutHtml).toContain('+ Usar una dirección diferente');
    expect(checkoutScript).toContain('API.getDefaultAddress()');
    expect(checkoutScript).toContain('savedDefaultAddress');
    expect(checkoutScript).not.toContain('API.upsertAddress');
    expect(checkoutScript).toContain(
      'userEditedShippingFields.has(input.name)',
    );
  });

  it('reveals the complete Spanish alternative-address form without changing account data', () => {
    for (const field of [
      'country',
      'firstName',
      'lastName',
      'address',
      'addressLine2',
      'zip',
      'city',
      'state',
      'phone',
    ]) {
      expect(checkoutHtml).toContain(`name="${field}"`);
    }
    expect(checkoutScript).toContain('showAlternativeAddress');
    expect(checkoutScript).toContain('shippingForm.hidden = false');
  });

  it('uses a native shipping accordion populated only by backend summary methods', () => {
    expect(checkoutHtml).toContain('<details id="shipping-details"');
    expect(checkoutHtml).toContain('>ENVÍO</span>');
    expect(checkoutScript).toContain('API.getCheckoutSummary({');
    expect(checkoutScript).toContain('data.shippingMethods');
    expect(checkoutScript).toContain('state.shippingMethods.forEach');
    expect(checkoutScript).not.toContain('Pick Up Point');
  });

  it('retains the compact secure Payment Element and mounted-state guard', () => {
    expect(checkoutHtml).toContain('>PAGO</h2>');
    expect(checkoutHtml).toContain(
      'Todas las transacciones son seguras y están encriptadas.',
    );
    expect(checkoutHtml).toContain('id="payment-element"');
    expect(checkoutHtml).toContain('id="pay-button"');
    expect(checkoutScript).toContain(
      "elements.create('payment', paymentElementOptions)",
    );
    expect(checkoutScript).toContain('!paymentElementMounted');
    expect(checkoutScript).toContain('setPayButtonState(false)');
  });

  it('excludes Bancontact and EPS from every configured frontend method list', () => {
    expect(checkoutScript).not.toMatch(/['"]bancontact['"]/i);
    expect(checkoutScript).not.toMatch(/['"]eps['"]/i);
  });

  it('renders compact live cart rows, quantity badges and the existing discount controls', () => {
    expect(checkoutHtml).toContain('id="checkout-cart-items"');
    expect(checkoutScript).toContain('checkout-item__qty');
    expect(checkoutScript).toContain('item.product?.name');
    expect(checkoutScript).toContain('item.size');
    expect(checkoutHtml).toContain('Código de descuento');
    expect(checkoutScript).toContain('API.applyPromoCode');
  });

  it('loads non-hardcoded in-stock recommendations and revalidates every quick add', () => {
    expect(checkoutHtml).toContain('También te puede gustar');
    expect(checkoutScript).toContain('API.getProducts({');
    expect(checkoutScript).toContain('getRecommendationCandidates');
    expect(checkoutScript).toContain(
      "API.getProductBySlug(slug, { cache: 'no-store' })",
    );
    expect(checkoutScript).toContain('getProductVariants?.(product)');
    expect(checkoutScript).toContain('selectRecommendationVariant');
    expect(checkoutScript).toContain('data-recommendation-variant');
    expect(checkoutScript).not.toMatch(/variants\s*\[\s*0\s*\]/);
  });

  it('renders only backend-authoritative totals and the server-provided tax amount', () => {
    expect(checkoutScript).toContain('state.totals = data.totals');
    expect(checkoutHtml).toContain('id="summary-subtotal"');
    expect(checkoutHtml).toContain('id="summary-shipping"');
    expect(checkoutHtml).toContain('id="summary-discount"');
    expect(checkoutHtml).toContain('id="summary-total"');
    expect(checkoutHtml).toContain('id="summary-tax-note"');
    expect(checkoutScript).toContain('Number(summary.taxAmount)');
    expect(checkoutScript).toContain(
      'Incluye ${formatMoney(taxAmount)} de impuestos',
    );
    expect(checkoutScript).toContain('data.summary');
    expect(checkoutHtml).not.toContain('Impuestos y aranceles incluidos');
  });

  it('implements a true 50/50 shell with document scrolling and a sticky summary', () => {
    const bodyRule = [...checkoutStyles.matchAll(
      /body\.page-checkout\s*\{([\s\S]*?)\}/g,
    )].map((match) => match[1]).find((rule) => rule.includes('overflow-y')) ?? '';
    const shellRule = checkoutStyles.match(
      /\.checkout-shell\s*\{([\s\S]*?)\}/,
    )?.[1] ?? '';
    const flowRule = checkoutStyles.match(
      /\.checkout-flow-pane\s*\{([\s\S]*?)\}/,
    )?.[1] ?? '';
    const summaryPaneRule = checkoutStyles.match(
      /\.checkout-summary-pane\s*\{([\s\S]*?)\}/,
    )?.[1] ?? '';
    const summaryInnerRule = checkoutStyles.match(
      /\.checkout-summary-inner\s*\{([\s\S]*?)\}/,
    )?.[1] ?? '';

    expect(checkoutStyles).toMatch(
      /\.checkout-shell\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\);/,
    );
    expect(bodyRule).toContain('overflow-y: auto');
    expect(shellRule).toContain('min-height: 100dvh');
    expect(shellRule).not.toMatch(/(^|\s)height:\s*100dvh/);
    expect(flowRule).not.toContain('overflow-y');
    expect(flowRule).toContain('border-right: 1px solid');
    expect(summaryPaneRule).not.toContain('overflow-y');
    expect(summaryInnerRule).toContain('position: sticky');
    expect(checkoutStyles).toContain('--checkout-black: #000;');
    expect(checkoutStyles).toContain('--checkout-panel: #0b0b0c;');
  });

  it('falls back to one normal mobile document flow without horizontal scrolling', () => {
    expect(checkoutStyles).toMatch(
      /@media \(max-width:\s*900px\)[\s\S]*?body\.page-checkout\s*\{[\s\S]*?overflow-x:\s*hidden;[\s\S]*?overflow-y:\s*auto;/,
    );
    expect(checkoutStyles).toMatch(
      /@media \(max-width:\s*900px\)[\s\S]*?\.checkout-shell\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*column;/,
    );
    expect(checkoutStyles).not.toMatch(/iframe\s+[.#[]/);
  });

  it('uses only real legal pages and ends with the requested literal footer', () => {
    for (const href of [
      'returns-exchanges.html',
      'shipping-policy.html',
      'privacy-policy.html',
      'terms-of-service.html',
      'aviso-legal.html',
      'cookie-policy.html',
    ]) {
      expect(checkoutHtml).toContain(`href="${href}"`);
    }
    const footerStart = checkoutHtml.indexOf(
      '<footer class="checkout-footer">',
    );
    const footerEnd = checkoutHtml.indexOf('</footer>', footerStart);
    const afterFooter = checkoutHtml.slice(
      footerEnd + '</footer>'.length,
      checkoutHtml.indexOf('</body>'),
    );
    expect(footerStart).toBeGreaterThan(-1);
    expect(checkoutHtml.slice(footerStart, footerEnd)).toContain(
      '© 2026 CRONOX',
    );
    expect(checkoutHtml.slice(footerStart, footerEnd).replace(/<[^>]+>/g, '').trim()).toBe(
      '© 2026 CRONOX',
    );
    expect(
      afterFooter
        .replace(/<script[\s\S]*?<\/script>/g, '')
        .replace(/<\/main>/g, '')
        .trim(),
    ).toBe('');
  });
});
