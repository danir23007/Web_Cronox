/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const front = path.resolve(__dirname, '../../../cronox-front');
const read = (file: string) => readFileSync(path.join(front, file), 'utf8');
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 0)); };
const pending = () => { let resolve!: (value: any) => void; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const shipping = { code: 'STANDARD', amountCents: 295 };
const totals = { subtotalCents: 3495, shippingCents: 295, discountCents: 0, totalCents: 3790 };
const success = { ok: true, json: async () => ({ clientSecret: 'pi_retry_secret_fixture', paymentIntentId: 'pi_retry', shippingMethod: shipping, totals }) };
const failed = (code = 'DEPENDENCY_UNAVAILABLE') => ({ ok: false, status: 503, json: async () => ({ code, message: code }) });

async function setup(signedIn = true, code = 'DEPENDENCY_UNAVAILABLE') {
  const dom = new JSDOM(read('checkout.html'), { runScripts: 'outside-only', url: 'https://fixture.test/checkout' });
  const w = dom.window as any;
  require('../../test/checkout-presence-fixture.cjs').install(w);
  w.console.error = jest.fn(); w.console.warn = jest.fn();
  w.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
  w.CRONOX_CHECKOUT_LOADING = { finish: jest.fn() };
  const user = { id: 1, email: 'fixture@example.test', firstName: 'Persona', lastName: 'Ficticia', address: { line1: 'Calle Prueba 1', zip: '28001', city: 'Madrid', country: 'España' } };
  const cart = { items: [{ id: 1, variantId: 1, qty: 1, priceCents: 3495, size: 'M', product: { id: 1, slug: 'fixture', name: 'Fixture' } }], subtotalCents: 3495, itemsCount: 1 };
  w.CRONOX_USER = signedIn ? user : null;
  w.CRONOX_API = {
    getMe: jest.fn().mockResolvedValue(w.CRONOX_USER), getDefaultAddress: jest.fn().mockResolvedValue(null),
    getCart: jest.fn().mockResolvedValue(cart), getProducts: jest.fn().mockResolvedValue([]),
    getCheckoutSummary: jest.fn().mockResolvedValue({ cart, totals, shippingMethods: [shipping], selectedShippingMethod: shipping }),
    getCsrfHeaders: jest.fn().mockResolvedValue({ 'X-CSRF-Token': 'fixture' }),
    classifyApiError: jest.fn().mockReturnValue({ kind: 'server', isRetryable: true }),
  };
  w.CRONOX_STRIPE_PUBLISHABLE_KEY = 'pk_test_fixture'; w.CRONOX_STRIPE_READY = Promise.resolve(true);
  const submit = jest.fn().mockResolvedValue({}), confirm = jest.fn();
  w.Stripe = () => ({ confirmPayment: confirm, elements: () => ({
    submit, create: (type: string) => { const handlers: Record<string, (value?: any) => void> = {}; return {
      on: (event: string, handler: (value?: any) => void) => { handlers[event] = handler; }, unmount() {}, destroy() {},
      mount: () => queueMicrotask(() => { handlers.ready?.({ availablePaymentMethods: null }); if (type === 'payment') handlers.change?.({ complete: true }); }),
    }; },
  }) });
  w.fetch = jest.fn().mockResolvedValue(failed(code));
  w.eval(read('assets/country.js')); w.eval(read('assets/checkout-lifecycle.js'));
  w.CRONOX_CHECKOUT_LIFECYCLE = { ...w.CRONOX_CHECKOUT_LIFECYCLE, pollUntilProcessed: jest.fn(() => pending().promise) };
  w.eval(read('assets/checkout.js')); await flush();
  if (!signedIn) {
    const values = { firstName: 'Persona', lastName: 'Ficticia', address: 'Calle Prueba 1', zip: '28001', city: 'Madrid' };
    for (const [name, value] of Object.entries(values)) { const input = w.document.querySelector(`#shipping-form [name="${name}"]`); input.value = value; input.dispatchEvent(new w.Event('change', { bubbles: true })); }
    const email = w.document.getElementById('checkout-guest-email'); email.value = 'fixture@example.test'; email.dispatchEvent(new w.Event('change', { bubbles: true }));
    await flush();
  }
  return { dom, w, submit, confirm, pay: w.document.getElementById('pay-button'), error: w.document.getElementById('payment-error'), retry: () => w.document.getElementById('payment-prepare-retry') };
}

describe('explicit recovery after checkout preparation fails', () => {
  it.each([false, true])('revalidates the same reservation and retries once without confirming or restarting (authenticated: %s)', async signedIn => {
    const t = await setup(signedIn);
    try {
      expect(t.w.fetch).toHaveBeenCalledTimes(1);
      expect(t.error.textContent).toContain('No hemos podido preparar el pago');
      expect(t.pay.disabled).toBe(true);
      expect(t.retry()).not.toBeNull();
      expect(t.retry().hidden).toBe(false);
      const identity = JSON.parse(t.w.fetch.mock.calls[0][1].body);
      const reservation = t.w.CRONOX_CHECKOUT_RESERVATION;
      const heartbeat = jest.spyOn(reservation, 'heartbeat');
      const enter = jest.spyOn(reservation, 'enter');
      const protect = jest.spyOn(reservation, 'protect');
      const response = pending(); t.w.fetch.mockReturnValueOnce(response.promise);
      t.retry().click(); t.retry().click(); await flush();
      expect(t.retry().disabled).toBe(true);
      expect(t.pay.disabled).toBe(true);
      expect(t.w.fetch).toHaveBeenCalledTimes(2);
      expect(JSON.parse(t.w.fetch.mock.calls[1][1].body)).toEqual(identity);
      expect(heartbeat).toHaveBeenCalledTimes(1); expect(enter).not.toHaveBeenCalled(); expect(protect).not.toHaveBeenCalled();
      expect(t.submit).not.toHaveBeenCalled(); expect(t.confirm).not.toHaveBeenCalled();
      response.resolve(success); await flush();
      expect(t.pay.disabled).toBe(false); expect(t.retry().hidden).toBe(true);
      expect(t.w.document.querySelector('#shipping-form [name="firstName"]').value).toBe('Persona');
    } finally { t.dom.window.close(); }
  });

  it('keeps retry available after another failure, without automatically issuing a new request', async () => {
    const t = await setup();
    try {
      expect(t.retry()).not.toBeNull();
      t.retry().click(); await flush();
      expect(t.w.fetch).toHaveBeenCalledTimes(2); expect(t.retry().hidden).toBe(false); expect(t.retry().disabled).toBe(false); expect(t.pay.disabled).toBe(true);
      await flush(); expect(t.w.fetch).toHaveBeenCalledTimes(2);
      t.w.fetch.mockResolvedValueOnce(success); t.retry().click(); await flush();
      expect(t.w.fetch).toHaveBeenCalledTimes(3); expect(t.pay.disabled).toBe(false); expect(t.confirm).not.toHaveBeenCalled();
    } finally { t.dom.window.close(); }
  });

  it.each(['CHECKOUT_PAYMENT_CONFIRMATION_PENDING', 'CHECKOUT_PAYMENT_INTENT_RECOVERY_BLOCKED', 'CHECKOUT_PAYMENT_INTENT_IN_PROGRESS', 'STRIPE_PAYMENT_INTENT_NOT_CANCELLABLE', 'STRIPE_PAYMENT_INTENT_NOT_REUSABLE'])('does not offer a new preparation for unresolved state %s', async code => {
    const t = await setup(true, code);
    try { expect(t.retry()).not.toBeNull(); expect(t.retry().hidden).toBe(true); expect(t.pay.disabled).toBe(true); expect(t.w.fetch).toHaveBeenCalledTimes(1); }
    finally { t.dom.window.close(); }
  });

  it('does not prepare or restart when the reservation cannot be revalidated', async () => {
    const t = await setup();
    try {
      expect(t.retry()).not.toBeNull();
      const reservation = t.w.CRONOX_CHECKOUT_RESERVATION;
      jest.spyOn(reservation, 'heartbeat').mockImplementation(async () => { jest.spyOn(reservation, 'ready').mockReturnValue(false); });
      const enter = jest.spyOn(reservation, 'enter');
      t.retry().click(); await flush();
      expect(t.w.fetch).toHaveBeenCalledTimes(1); expect(t.pay.disabled).toBe(true); expect(enter).not.toHaveBeenCalled(); expect(t.confirm).not.toHaveBeenCalled();
    } finally { t.dom.window.close(); }
  });

  it('keeps an existing protected payment deadline while checking and preparing again', async () => {
    const t = await setup();
    try {
      const reservation = t.w.CRONOX_CHECKOUT_RESERVATION;
      const protectedState = { ...reservation.current(), paymentStartedAt: new Date().toISOString(), reservationPhase: 'PROTECTED', expiresAt: new Date(Date.now() + 360000).toISOString() };
      reservation.adopt(protectedState);
      const enter = jest.spyOn(reservation, 'enter'), protect = jest.spyOn(reservation, 'protect');
      t.w.fetch.mockResolvedValueOnce(success); t.retry().click(); await flush();
      expect(t.pay.disabled).toBe(false);
      expect(reservation.current().paymentStartedAt).toBe(protectedState.paymentStartedAt);
      expect(reservation.current().expiresAt).toBe(protectedState.expiresAt);
      expect(enter).not.toHaveBeenCalled(); expect(protect).not.toHaveBeenCalled(); expect(t.confirm).not.toHaveBeenCalled();
    } finally { t.dom.window.close(); }
  });
});
