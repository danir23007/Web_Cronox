// Browser compatibility of the real checkout UI, with all payment/network
// boundaries simulated. No Stripe account, charge, email or customer DB used.
async page => {
  const origin = 'http://127.0.0.1:4173', results = [];
  const check = (ok, message) => { if (!ok) throw Error(message); };
  for (const width of [390, 1366]) for (const signedIn of [false, true]) {
    const context = await page.context().browser().newContext({ viewport: { width, height: 900 } });
    const writes = [];
    const product = { id: 1, name: 'Camiseta de prueba', slug: 'fixture-shirt', price: 3500, imageUrl: '/assets/logo_banner.png' };
    const cart = { id: 1, itemsCount: 1, subtotal: 3500, items: [{ id: 1, variantId: 1, qty: 1, priceAtAdd: 3500, variant: { id: 1, size: 'M', stockQty: 10, product } }] };
    const shipping = { code: 'STANDARD', label: 'Envío estándar', amountCents: 490, priceCents: 490 };
    const totals = { subtotalCents: 3500, shippingCents: 490, discountCents: 0, totalCents: 3990 };
    await context.addInitScript(() => {
      window.__CRONOX_API_BASE__ = location.origin;
      sessionStorage.setItem('cronoxNewsletterShown', 'true');
      window.__fixtureConfirmations = 0;
      window.Stripe = () => ({
        elements: () => {
          const handlers = {};
          return {
            on: (name, fn) => { handlers[name] = fn; },
            update: () => setTimeout(() => handlers['update-end']?.(), 0),
            submit: async () => ({}),
            create: type => {
              const events = {};
              return {
                on: (name, fn) => { events[name] = fn; },
                off: () => {}, destroy: () => {}, unmount: () => {},
                mount: container => {
                  if (type === 'payment') container.textContent = 'Formulario de pago simulado';
                  setTimeout(() => { events.ready?.({ availablePaymentMethods: null }); if (type === 'payment') events.change?.({ complete: true }); }, 0);
                },
              };
            },
          };
        },
        confirmPayment: async () => {
          window.__fixtureConfirmations++;
          await new Promise(resolve => setTimeout(resolve, 250));
          return { error: { type: 'card_error', message: 'Tarjeta de prueba rechazada; puedes reintentar.' } };
        },
      });
    });
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/assets/runtime-config.js') return route.fulfill({ contentType: 'text/javascript', body: "window.CRONOX_STRIPE_PUBLISHABLE_KEY='pk_test_browser_fixture';" });
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (request.method() === 'POST') writes.push(url.pathname);
      let data = {};
      if (url.pathname === '/api/auth/csrf') data = { csrfToken: 'fixture' };
      else if (url.pathname === '/api/me') data = signedIn ? { id: 1, firstName: 'Persona', email: 'checkout@example.test', role: 'USER' } : null;
      else if (url.pathname.includes('/addresses')) data = null;
      else if (url.pathname === '/api/cart') data = cart;
      else if (url.pathname === '/api/checkout/summary') data = { cart, totals, shippingMethods: [shipping], selectedShippingMethod: shipping };
      else if (url.pathname === '/api/payments/create-payment-intent') data = { clientSecret: 'pi_fixture_secret_local', paymentIntentId: 'pi_fixture', shippingMethod: shipping, totals };
      else if (url.pathname === '/api/products') data = { items: [], meta: { total: 0 } };
      else if (url.pathname === '/api/favorites') data = [];
      return route.fulfill({ json: data });
    });
    const tab = await context.newPage();
    try {
      await tab.goto(origin + '/checkout');
      const reject = tab.getByRole('button', { name: 'RECHAZAR', exact: true });
      if (await reject.isVisible()) await reject.click();
      await tab.locator('#summary-total').filter({ hasText: '39,90' }).waitFor();
      check(await tab.locator('#pay-button').isDisabled(), 'Incomplete checkout permits payment');
      if (!signedIn) await tab.locator('#checkout-guest-email').fill('checkout@example.test');
      if (!(await tab.locator('#address-details').evaluate(el => el.open))) await tab.locator('#address-details > summary').click();
      const form = tab.locator('#address-details form');
      for (const [name, value] of Object.entries({ firstName: 'Persona', lastName: 'Ficticia', address: 'Calle Prueba 1', zip: '28001', city: 'Madrid', state: 'Madrid', phone: '600000000' })) {
        await form.locator(`[name="${name}"]`).fill(value);
      }
      await form.locator('[name="phone"]').blur();
      await tab.waitForFunction(() => !document.querySelector('#pay-button').disabled);
      await tab.locator('#pay-button').evaluate(button => { button.click(); button.click(); });
      await tab.locator('#payment-error').filter({ hasText: 'Tarjeta de prueba rechazada' }).waitFor();
      check(await tab.evaluate(() => window.__fixtureConfirmations) === 1, 'Double click confirmed twice');
      check(await form.locator('[name="firstName"]').inputValue() === 'Persona', 'Payment error lost contact data');
      await tab.locator('#pay-button').click();
      await tab.waitForFunction(() => window.__fixtureConfirmations === 2 && !document.querySelector('#pay-button').disabled);
      check(!writes.some(p => /auth\/(register|login)|newsletter/.test(p)), 'Checkout required account/newsletter');
      check(!(await tab.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'Checkout horizontal overflow');
      await tab.screenshot({ path: `output/playwright/checkout-compatibility-${width}-${signedIn ? 'account' : 'guest'}.png`, fullPage: true });
      results.push({ width, signedIn, incompleteDisabled: true, paymentMounted: true, doubleClickGuard: true, errorAndRetry: true, accountNotRequired: true });
    } finally { await context.close(); }
  }
  return { results, paymentProvider: 'simulated', externalRequests: false };
}
