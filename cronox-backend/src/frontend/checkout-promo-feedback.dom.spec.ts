import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const read = (file: string) => readFileSync(path.resolve(__dirname, '../../../cronox-front', file), 'utf8');
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setTimeout(resolve, 0)); };

function setup() {
  const dom = new JSDOM(read('checkout.html'), { runScripts: 'outside-only', url: 'https://fixture.test/checkout' });
  const w = dom.window as any;
  require('../../test/checkout-presence-fixture.cjs').install(w);
  const method = { code: 'STANDARD', label: 'Envío estándar', priceCents: 490, amountCents: 490 };
  const cart = { items: [{ id: 1, qty: 1, priceCents: 5000, product: { name: 'Fixture' } }], subtotalCents: 5000, itemsCount: 1 };
  let promo: any = null;
  let blocked = false;
  const blockMessage = 'Los códigos de descuento no son acumulables con las ofertas de Black Friday.';
  const totals = (requested = Boolean(promo)) => ({ subtotalCents: 5000, discountCents: requested && promo && !blocked ? 500 : 0, shippingCents: 490, totalCents: requested && promo && !blocked ? 4990 : 5490 });
  w.scrollTo = () => {};
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.fetch = async () => ({ ok: true, json: async () => ({}) });
  w.CRONOX_STRIPE_PUBLISHABLE_KEY = 'pk_test_inert';
  w.Stripe = () => ({});
  w.CRONOX_CHECKOUT_LOADING = { finish: jest.fn() };
  w.CRONOX_API = {
    getMe: async () => null, getProducts: async () => [], getCsrfHeaders: async () => ({}),
    getCheckoutSummary: async ({ promoCode }: any) => ({ cart, shippingMethods: [method], selectedShippingMethod: method, totals: totals(Boolean(promoCode)),
      appliedPromo: promoCode ? blocked ? { valid: false, code: promoCode, discountCents: 0, message: blockMessage } : promo : null,
      promoPolicy: blocked ? { blocked: true, message: blockMessage, startsAt: '2026-11-26T20:00:00Z', endsAt: '2026-11-27T23:00:00Z', serverNow: '2026-11-26T21:00:00Z' } : { blocked: false } }),
    applyPromoCode: jest.fn(async ({ code }: any) => {
      promo = { valid: true, code, discountCents: 500 };
      return { ...promo, discountAmount: 500, totals: totals(), shippingMethod: method };
    }),
  };
  w.eval(read('assets/checkout-lifecycle.js'));
  w.eval(read('assets/checkout.js'));
  return { dom, w, block: (value: boolean) => { blocked = value; }, submit: async (code: string) => {
    const input = w.document.getElementById('promo-code-input');
    input.value = code;
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
    w.document.getElementById('apply-promo-button').click();
    await settle();
  } };
}

describe('checkout promo feedback', () => {
  it('removes a same-code rejection at Black Friday, clears session recovery and never reapplies it after the end', async () => {
    const { dom, w, submit, block } = setup();
    try {
      await settle(); await submit('SAVE');
      expect(w.document.getElementById('summary-total').textContent).toContain('49,90');
      expect(w.sessionStorage.getItem('cronox_checkout_promo')).not.toBeNull();
      block(true);
      Object.defineProperty(w.document, 'visibilityState', { configurable: true, value: 'visible' });
      w.document.dispatchEvent(new w.Event('visibilitychange')); await settle();
      expect(w.document.getElementById('promo-message').textContent).toBe('Los códigos de descuento no son acumulables con las ofertas de Black Friday.');
      expect(w.document.getElementById('summary-total').textContent).toContain('54,90');
      expect(w.sessionStorage.getItem('cronox_checkout_promo')).toBeNull();
      block(false); w.document.dispatchEvent(new w.Event('visibilitychange')); await settle();
      expect(w.document.getElementById('summary-total').textContent).toContain('54,90');
      expect(w.document.getElementById('promo-message').textContent).toBe('');
    } finally { dom.window.close(); }
  });
  it.each([
    'Este código de descuento no existe', 'El código ha caducado',
    'Ya has utilizado este código de descuento.', 'Este código pertenece a otra cuenta',
  ])('retains server rejection after summary refresh: %s', async message => {
    const { dom, w, submit } = setup();
    const log = jest.spyOn(w.console, 'error').mockImplementation(() => {});
    try {
      await settle();
      w.CRONOX_API.applyPromoCode.mockRejectedValueOnce({ status: 400, payload: { message } });
      await submit('INVALID');
      const feedback = w.document.getElementById('promo-message');
      expect(feedback.textContent).toBe(message);
      expect(feedback.classList.contains('is-error')).toBe(true);
      expect(feedback.getAttribute('aria-live')).toBe('polite');
      expect(w.document.getElementById('summary-total').textContent).toContain('54,90');
    } finally { log.mockRestore(); dom.window.close(); }
  });

  it('clears a stale failure on editing, shows success and clears it on removal', async () => {
    const { dom, w, submit } = setup();
    const log = jest.spyOn(w.console, 'error').mockImplementation(() => {});
    try {
      await settle();
      w.CRONOX_API.applyPromoCode.mockRejectedValueOnce(new Error('Offline'));
      await submit('FAILED');
      expect(w.document.getElementById('promo-message').textContent).toContain('Inténtalo de nuevo');
      const input = w.document.getElementById('promo-code-input');
      input.value = 'VALID'; input.dispatchEvent(new w.Event('input', { bubbles: true }));
      expect(w.document.getElementById('promo-message').textContent).toBe('');
      await submit('VALID');
      expect(w.document.getElementById('promo-applied-label').textContent).toContain('VALID');
      expect(w.document.getElementById('promo-message').classList.contains('is-error')).toBe(false);
      w.document.getElementById('remove-promo-button').click(); await settle();
      expect(w.document.getElementById('promo-message').textContent).toBe('');
    } finally { log.mockRestore(); dom.window.close(); }
  });
});
