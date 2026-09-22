// Offline request orchestration audit. No HTTP, database or Stripe calls.
const { readFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '../..');
const read = (file, before = false) => before
  ? execFileSync('git', ['show', `HEAD:cronox-front/${file}`], { cwd: root, encoding: 'utf8' })
  : readFileSync(path.join(root, 'cronox-front', file), 'utf8');
const flush = () => new Promise((done) => setTimeout(done, 0));

async function measure(page, before) {
  const dom = new JSDOM(read(page), { runScripts: 'outside-only', url: `https://example.test/${page}` });
  const w = dom.window;
  const counts = { session: 0, cart: 0, summary: 0, recommendations: 0 };
  let revealed = false;
  const pending = new Promise(() => {});
  const cart = { items: [{ id: 1, variantId: 10, qty: 1, priceCents: 3495,
    product: { id: 2, slug: 'test', name: 'Test' } }], subtotalCents: 3495, itemsCount: 1 };
  w.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
  w.fetch = async (url) => {
    if (String(url).endsWith('/api/me')) {
      counts.session++;
      return { ok: false, status: 401 };
    }
    return { ok: true, text: async () => read('auth-modal.html'), json: async () => [] };
  };
  w.CRONOX_CHECKOUT_LOADING = { finish() { revealed = true; } };
  w.CRONOX_STRIPE_PUBLISHABLE_KEY = 'pk_test_offline';
  w.Stripe = () => ({});
  w.CRONOX_API = {
    getMe: async () => { counts.session++; return null; },
    getCart: async () => { counts.cart++; return cart; },
    getCheckoutSummary: async () => {
      counts.summary++;
      return { cart, shippingMethods: [{ code: 'STANDARD', amountCents: 295 }],
        selectedShippingMethod: { code: 'STANDARD', amountCents: 295 },
        totals: { subtotalCents: 3495, shippingCents: 295, discountCents: 0, totalCents: 3790 } };
    },
    getProducts: () => { counts.recommendations++; return pending; },
  };
  try {
    w.eval(read('assets/country.js'));
    w.eval(read('assets/checkout-lifecycle.js'));
    w.eval(read('assets/app.js', before));
    w.eval(read(page === 'cart.html' ? 'assets/cart.js' : 'assets/checkout.js', before));
    for (let i = 0; i < 10; i++) await flush();
    return { requests: counts, ...(page === 'checkout.html'
      ? { revealedWhileRecommendationsPending: revealed }
      : {}) };
  } finally { w.close(); }
}

(async () => {
  const results = { environment: 'JSDOM, mocked immediate core API/modal; recommendations never resolve; no real network',
    baseline: 'HEAD request orchestration; working-tree HTML and unchanged lifecycle/country helpers', routes: {} };
  for (const page of ['cart.html', 'checkout.html']) {
    results.routes[page] = { before: await measure(page, true), after: await measure(page, false) };
  }
  process.stdout.write(JSON.stringify(results, null, 2) + '\n');
})().catch((error) => { console.error(error); process.exitCode = 1; });
