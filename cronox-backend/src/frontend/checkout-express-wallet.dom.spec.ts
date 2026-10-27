/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
const root = path.resolve(__dirname, '../../../cronox-front');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); await new Promise(done => setTimeout(done, 0)); };

async function setup() {
  const dom = new JSDOM(read('checkout.html'), { runScripts: 'outside-only', url: 'https://example.test/checkout' });
  const w = dom.window as any;
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };
  w.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
  const cart = { id: 1, items: [{ id: 1, variantId: 1, qty: 1, priceCents: 1000, product: { id: 1, name: 'Ficticio' } }] };
  const methods = [{ code: 'STANDARD', label: 'Estándar', amountCents: 295 }, { code: 'EXPRESS', label: 'Exprés', amountCents: 495 }];
  const summary = (rate = 'STANDARD') => ({ cart, shippingMethods: methods, selectedShippingMethod: methods.find(m => m.code === rate),
    totals: { subtotalCents: 1000, shippingCents: rate === 'EXPRESS' ? 495 : 295, discountCents: 0, totalCents: rate === 'EXPRESS' ? 1495 : 1295 } });
  w.CRONOX_CHECKOUT_LOADING = { finish: jest.fn() };
  w.CRONOX_STRIPE_PUBLISHABLE_KEY = 'pk_test_wallet';
  w.CRONOX_STRIPE_READY = Promise.resolve(true);
  w.CRONOX_API = { getMe: jest.fn().mockResolvedValue(null), getCheckoutSummary: jest.fn().mockResolvedValue(summary()),
    getProducts: jest.fn(() => new Promise(() => {})) };
  const handlers: Record<string, (event?: any) => void> = {};
  let updateDone: (() => void) | undefined;
  const payment = { on: (name: string, fn: () => void) => { if (name === 'ready') queueMicrotask(fn); }, mount: jest.fn(), unmount: jest.fn() };
  const express = { on: (name: string, fn: (event?: any) => void) => { handlers[name] = fn; }, mount: jest.fn(() => queueMicrotask(() => handlers.ready({ availablePaymentMethods: { paypal: true } }))), unmount: jest.fn() };
  const elements = { create: jest.fn((type: string, _options?: unknown) => type === 'payment' ? payment : express),
    submit: jest.fn().mockResolvedValue({}), update: jest.fn((_options: { amount: number }) => queueMicrotask(() => updateDone?.())),
    on: (name: string, fn: () => void) => { if (name === 'update-end') updateDone = fn; }, off: jest.fn() };
  const stripe = { elements: jest.fn(() => elements), confirmPayment: jest.fn().mockResolvedValue({ error: { type: 'card_error', message: 'Declined' } }),
    retrievePaymentIntent: jest.fn().mockResolvedValue({ paymentIntent: { id: 'pi_test', amount: 1295, currency: 'eur', status: 'requires_payment_method', payment_method_types: ['card','paypal'] } }),
    confirmPayPalPayment: jest.fn().mockResolvedValue({ error: { type: 'invalid_request_error', message: 'Autorización cancelada' } }) };
  w.Stripe = () => stripe;
  w.fetch = jest.fn(async (url: string, options?: any) => {
    if (url.includes('/checkout/reservation') || url.includes('/checkout/payment-start')) return { ok: true, json: async () => ({
      checkoutSnapshotId: 'snap_test', expiresAt: new Date(Date.now() + 360000).toISOString(),
      reservationPhase: url.includes('payment-start') ? 'PROTECTED' : 'PRESENCE',
      paymentStartedAt: url.includes('payment-start') ? new Date().toISOString() : null,
    }) };
    const rate = options?.body ? JSON.parse(options.body).shippingMethod : new URL(url, 'https://example.test').searchParams.get('shippingMethod');
    const quoted = summary(rate || 'STANDARD');
    return { ok: true, json: async () => url.includes('express-quote') ? quoted : {
      metadata: { checkoutSnapshotId: 'snap_test' }, reservation: { phase: 'PRESENCE', expiresAt: new Date(Date.now() + 90000).toISOString(), paymentStartedAt: null },
      clientSecret: 'pi_test_secret', paymentIntentId: 'pi_test', shippingMethod: { code: rate }, totals: quoted.totals,
    } };
  });
  w.eval(read('assets/country.js')); w.eval(read('assets/checkout-lifecycle.js')); w.eval(read('assets/checkout-presence.js')); w.eval(read('assets/checkout.js'));
  await flush();
  // Individual wallet assertions count preparation/confirmation requests;
  // initial presence is exercised separately by reservation tests.
  w.fetch.mockClear();
  return { dom, w, stripe, elements, handlers, payment, express, finishUpdate: () => updateDone?.() };
}
const address = { country: 'ES', postal_code: '28001', city: 'Madrid', state: 'Madrid', line1: 'Calle ficticia 1', line2: '' };
const details = (name = 'Prueba Sandbox') => ({ billingDetails: { email: 'wallet@example.test' }, shippingAddress: { name, address }, shippingRate: { id: 'STANDARD' }, paymentFailed: jest.fn() });

async function fillForm(w: any) {
  const fields = { firstName:'Prueba', lastName:'Sandbox', address:'Calle ficticia 1', city:'Madrid', state:'Madrid', zip:'28001', country:'España' };
  for (const [name,value] of Object.entries(fields)) w.document.querySelector(`#shipping-form [name="${name}"]`).value=value;
  const email=w.document.querySelector('#checkout-guest-email');
  email.value='form@example.test'; email.dispatchEvent(new w.Event('change',{bubbles:true}));
  await flush(); await flush();
}

describe('PayPal form channel', () => {
  it('blocks the lower form while express confirmation is pending and restores controls after failure', async () => {
    const {dom,w,stripe,handlers}=await setup();
    try {
      let complete!: (result:any)=>void;
      stripe.confirmPayment.mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;}));
      handlers.click({resolve:jest.fn()}); handlers.confirm(details()); await flush();
      expect(stripe.confirmPayment).toHaveBeenCalledTimes(1);
      const radio=w.document.querySelector('input[value="paypal"][name="payment-channel"]');
      expect(radio.disabled).toBe(true);
      radio.checked=true; radio.dispatchEvent(new w.Event('change',{bubbles:true}));
      expect(radio.checked).toBe(false);
      w.document.querySelector('#pay-button').dispatchEvent(new w.Event('click'));
      expect(stripe.confirmPayPalPayment).not.toHaveBeenCalled();
      complete({error:{type:'card_error',message:'Cancelled'}}); await flush();
      expect(radio.disabled).toBe(false);
    } finally {dom.window.close();}
  });

  it('removes the external PayPal choice when Stripe withdraws availability, preserving the mounted card form', async () => {
    const {dom,w,handlers,payment}=await setup();
    try {
      w.document.querySelector('input[value="paypal"][name="payment-channel"]').click();
      handlers.availablepaymentmethodschange({paymentMethods:{googlePay:true,paypal:false}});
      expect(w.document.querySelector('#payment-paypal-choice').hidden).toBe(true);
      expect(w.document.querySelector('#payment-element').hidden).toBe(false);
      expect(payment.mount).toHaveBeenCalledTimes(1);
    } finally {dom.window.close();}
  });

  it('selects PayPal without validating card fields, retries cancellation on the same intent, and shares the express lock', async () => {
    const {dom,w,stripe,elements,handlers,express,payment}=await setup();
    try {
      const radio=w.document.querySelector('input[value="paypal"][name="payment-channel"]');
      radio.click();
      expect(w.document.querySelector('#pay-button').disabled).toBe(true);
      expect(w.fetch).not.toHaveBeenCalled();
      await fillForm(w);
      expect(w.document.querySelector('#pay-button').disabled).toBe(false);
      let complete!: (result:any)=>void;
      stripe.confirmPayPalPayment.mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;}));
      w.document.querySelector('#pay-button').click(); await flush();
      expect(stripe.confirmPayPalPayment).toHaveBeenCalledTimes(1);
      expect(stripe.confirmPayPalPayment).toHaveBeenLastCalledWith('pi_test_secret',expect.objectContaining({payment_method:{billing_details:{name:'Prueba Sandbox',email:'form@example.test'}}}));
      expect(elements.submit).not.toHaveBeenCalled(); expect(stripe.confirmPayment).not.toHaveBeenCalled();
      w.document.querySelector('#pay-button').dispatchEvent(new w.Event('click'));
      const resolve=jest.fn(),reject=jest.fn(); handlers.click({resolve,reject});
      expect(reject).toHaveBeenCalled(); expect(resolve).not.toHaveBeenCalled();
      expect(w.document.querySelector('#checkout-guest-email').disabled).toBe(true);
      complete({error:{message:'Autorización cancelada'}}); await flush();
      expect(w.document.querySelector('#checkout-guest-email').disabled).toBe(false);
      expect(w.document.querySelector('#pay-button').disabled).toBe(false);
      w.document.querySelector('#pay-button').click(); await flush();
      expect(stripe.confirmPayPalPayment).toHaveBeenCalledTimes(2);
      expect(stripe.confirmPayPalPayment.mock.calls.every(call=>call[0]==='pi_test_secret')).toBe(true);
      w.document.querySelector('input[value="elements"][name="payment-channel"]').click();
      expect(w.document.querySelector('#payment-element').hidden).toBe(false);
      expect(payment.mount).toHaveBeenCalledTimes(1); expect(express.mount).toHaveBeenCalledTimes(1);
    } finally {dom.window.close();}
  });

  it.each(['amount','method','processing','stock','stale'])('does not confirm a %s mismatch', async reason => {
    const {dom,w,stripe}=await setup();
    try {
      w.document.querySelector('input[value="paypal"][name="payment-channel"]').click();
      await fillForm(w);
      if(reason==='stock') w.fetch.mockResolvedValue({ok:false,status:409,json:async()=>({message:'INSUFFICIENT_STOCK'})});
      else stripe.retrievePaymentIntent.mockImplementation(async()=>{
        if(reason==='stale') {
          const email=w.document.querySelector('#checkout-guest-email'); email.value='changed@example.test'; email.dispatchEvent(new w.Event('input',{bubbles:true}));
        }
        return {paymentIntent:{id:'pi_test',amount:reason==='amount'?1495:1295,currency:'eur',status:reason==='processing'?'processing':'requires_payment_method',payment_method_types:reason==='method'?['card']:['card','paypal']}};
      });
      w.document.querySelector('#pay-button').click(); await flush();
      expect(stripe.confirmPayPalPayment).not.toHaveBeenCalled();
      expect(w.document.querySelector('#payment-error').textContent).not.toBe('');
    } finally {dom.window.close();}
  });
});

describe('Express wallets with an initially empty form', () => {
  it.each([
    { applePay: false, googlePay: true, paypal: true },
    { applePay: true, googlePay: true, paypal: true },
  ])('keeps one mounted element when availability changes: %j', async availablePaymentMethods => {
    const { dom, w, elements, handlers, express } = await setup();
    try {
      const region = w.document.querySelector('#express-checkout-region');
      handlers.ready({ availablePaymentMethods });
      expect(region.hidden).toBe(false);
      expect(JSON.parse(region.dataset.availablePaymentMethods)).toEqual(availablePaymentMethods);
      expect(elements.create.mock.calls.filter(([type]) => type === 'expressCheckout')).toHaveLength(1);
      expect(express.mount).toHaveBeenCalledTimes(1);
      expect(elements.create.mock.calls.find(([type]) => type === 'expressCheckout')?.[1]).toEqual(expect.objectContaining({
        paymentMethodOrder: ['apple_pay', 'google_pay', 'paypal'],
        buttonType: { applePay: 'plain', googlePay: 'plain', paypal: 'paypal' },
        layout: { maxColumns: 2, maxRows: 0, overflow: 'never' },
      }));
      handlers.availablepaymentmethodschange({ paymentMethods: {} });
      expect(region.hidden).toBe(true);
      handlers.availablepaymentmethodschange({ paymentMethods: availablePaymentMethods });
      expect(region.hidden).toBe(false);
      expect(express.mount).toHaveBeenCalledTimes(1);
    } finally { dom.window.close(); }
  });

  it.each(['paypal', 'google_pay'])('opens %s, cancels and retries without creating an intent; collects complete wallet details before server preparation', async method => {
    const { dom, w, stripe, elements, handlers, express, payment } = await setup();
    try {
      expect(elements.create.mock.calls.find(([type]) => type === 'expressCheckout')?.[1]).toEqual(expect.objectContaining({
        emailRequired: true, shippingAddressRequired: true, allowedShippingCountries: ['ES'],
        paymentMethods: expect.objectContaining({ link: 'never', amazonPay: 'never', paypal: 'auto', googlePay: 'always' }),
      }));
      const resolve = jest.fn(), reject = jest.fn();
      handlers.click({ expressPaymentType: method, resolve, reject });
      expect(resolve).toHaveBeenCalled(); expect(reject).not.toHaveBeenCalled();
      handlers.cancel();
      handlers.click({ expressPaymentType: method, resolve, reject });
      expect(w.fetch).not.toHaveBeenCalled();
      const event = details();
      handlers.confirm(event); await flush();
      const request = JSON.parse(w.fetch.mock.calls.find(([url]: [string]) => url.includes('create-payment-intent'))[1].body);
      expect(request).toEqual(expect.objectContaining({ guestEmail: 'wallet@example.test', shippingAddress: expect.objectContaining({ firstName: 'Prueba', lastName: 'Sandbox', postalCode: '28001', line1: 'Calle ficticia 1' }) }));
      expect(elements.submit.mock.invocationCallOrder[0]).toBeLessThan(w.fetch.mock.invocationCallOrder[0]);
      expect(stripe.confirmPayment).toHaveBeenCalledTimes(1);
      expect(express.mount).toHaveBeenCalledTimes(1); expect(payment.mount).toHaveBeenCalledTimes(1);
    } finally { dom.window.close(); }
  });

  it('quotes shipping on the server and updates Elements before resolving the shipping event', async () => {
    const { dom, w, elements, handlers, stripe } = await setup();
    try {
      handlers.click({ resolve: jest.fn() });
      const changed = { address, resolve: jest.fn(), reject: jest.fn() };
      handlers.shippingaddresschange(changed); await flush();
      expect(changed.resolve).toHaveBeenCalled();
      const rate = { shippingRate: { id: 'EXPRESS' }, resolve: jest.fn(), reject: jest.fn() };
      handlers.shippingratechange(rate); await flush();
      expect(elements.update).toHaveBeenCalledWith({ amount: 1495 });
      expect(rate.resolve).toHaveBeenCalledWith({});
      expect(w.document.querySelector('#summary-total').textContent).toContain('14,95');
      const standard = { shippingRate: { id: 'STANDARD' }, resolve: jest.fn(), reject: jest.fn() };
      handlers.shippingratechange(standard); await flush();
      expect(elements.update).toHaveBeenLastCalledWith({ amount: 1295 });
      expect(standard.resolve).toHaveBeenCalled();
      expect(w.document.querySelector('#summary-total').textContent).toContain('12,95');
      expect(w.fetch.mock.calls.every(([url]: [string]) => url.includes('express-quote'))).toBe(true);
      expect(stripe.confirmPayment).not.toHaveBeenCalled();
    } finally { dom.window.close(); }
  });

  it('asks only for a missing surname, preserving collected contact/address, and never confirms incomplete data', async () => {
    const { dom, w, handlers, stripe } = await setup();
    try {
      handlers.click({ resolve: jest.fn() });
      handlers.confirm(details('Prueba')); await flush();
      const dialog = w.document.querySelector('#express-missing-details');
      expect(dialog.open).toBe(true);
      expect([...dialog.querySelectorAll('input,select')].map((input: any) => input.name)).toEqual(['lastName']);
      expect(w.document.querySelector('#checkout-guest-email').value).toBe('wallet@example.test');
      expect(w.document.querySelector('[name="address"]').value).toBe('Calle ficticia 1');
      expect(w.fetch).not.toHaveBeenCalled(); expect(stripe.confirmPayment).not.toHaveBeenCalled();
      dialog.querySelector('input[name="lastName"]').value = 'Sandbox';
      dialog.querySelector('form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
      await flush();
      handlers.click({ resolve: jest.fn() });
      handlers.confirm(details('Prueba')); await flush();
      expect(w.document.querySelector('#express-missing-details')).toBeNull();
      expect(stripe.confirmPayment).toHaveBeenCalledTimes(1);
      expect(w.document.querySelector('[name="lastName"]').value).toBe('Sandbox');
    } finally { dom.window.close(); }
  });

  it('does not confirm or create a second request when the server rejects final stock', async () => {
    const { dom, w, handlers, stripe } = await setup();
    try {
      w.fetch.mockResolvedValue({ ok: false, status: 409, json: async () => ({ message: 'INSUFFICIENT_STOCK' }) });
      handlers.click({ resolve: jest.fn() });
      handlers.confirm(details()); handlers.confirm(details()); await flush();
      expect(w.fetch).toHaveBeenCalledTimes(1); expect(stripe.confirmPayment).not.toHaveBeenCalled();
    } finally { dom.window.close(); }
  });

  it('rejects a late shipping response after cancellation without updating the displayed amount', async () => {
    const { dom, w, handlers, elements } = await setup();
    try {
      let reply!: (value: any) => void;
      w.fetch.mockImplementation(() => new Promise(resolve => { reply = resolve; }));
      handlers.click({ resolve: jest.fn() });
      const event = { address, resolve: jest.fn(), reject: jest.fn() };
      handlers.shippingaddresschange(event); handlers.cancel();
      reply({ ok: true, json: async () => ({ selectedShippingMethod: { code: 'STANDARD' } }) }); await flush();
      expect(event.resolve).not.toHaveBeenCalled(); expect(event.reject).toHaveBeenCalled();
      expect(elements.update).not.toHaveBeenCalled();
    } finally { dom.window.close(); }
  });

  it.each(['US', 'BR'])('invalidates an accepted Spanish address when the wallet selects %s; no rate or confirm can reuse it', async country => {
    const { dom, w, handlers, stripe } = await setup();
    try {
      handlers.click({ resolve: jest.fn() });
      handlers.shippingaddresschange({ address, resolve: jest.fn(), reject: jest.fn() }); await flush();
      const invalid = { address: { ...address, country }, resolve: jest.fn(), reject: jest.fn() };
      handlers.shippingaddresschange(invalid); await flush();
      const rate = { shippingRate: { id: 'EXPRESS' }, resolve: jest.fn(), reject: jest.fn() };
      handlers.shippingratechange(rate); await flush();
      expect(w.fetch).toHaveBeenCalledTimes(1);
      expect(invalid.reject).toHaveBeenCalledTimes(1); expect(rate.reject).toHaveBeenCalledTimes(1);
      expect(w.document.querySelector('#summary-total').textContent).toContain('12,95');
      expect(w.document.querySelector('#express-shipping-error').textContent).toContain('Solo enviamos a España');
      handlers.confirm(details()); await flush();
      expect(stripe.confirmPayment).not.toHaveBeenCalled(); expect(w.fetch).toHaveBeenCalledTimes(1);
      handlers.shippingaddresschange({ address, resolve: jest.fn(), reject: jest.fn() }); await flush();
      handlers.shippingratechange({ shippingRate: { id: 'EXPRESS' }, resolve: jest.fn(), reject: jest.fn() }); await flush();
      expect(w.document.querySelector('#summary-total').textContent).toContain('14,95');
      expect(w.document.querySelector('#express-shipping-error').hidden).toBe(true);
    } finally { dom.window.close(); }
  });

  it('serializes a rapid EXPRESS → STANDARD reversal while Elements is still updating', async () => {
    const { dom, w, handlers, elements, finishUpdate, stripe } = await setup();
    try {
      handlers.click({ resolve: jest.fn() });
      handlers.shippingaddresschange({ address, resolve: jest.fn(), reject: jest.fn() }); await flush();
      elements.update.mockImplementationOnce(() => {});
      const expressRate = { shippingRate: { id: 'EXPRESS' }, resolve: jest.fn(), reject: jest.fn() };
      handlers.shippingratechange(expressRate); await flush();
      const standard = { shippingRate: { id: 'STANDARD' }, resolve: jest.fn(), reject: jest.fn() };
      handlers.shippingratechange(standard); await flush();
      expect(standard.resolve).not.toHaveBeenCalled();
      expect(stripe.confirmPayment).not.toHaveBeenCalled();
      finishUpdate(); await flush();
      expect(elements.update.mock.calls.map(([value]) => value.amount)).toEqual([1295, 1495, 1295]);
      expect(expressRate.resolve).toHaveBeenCalledTimes(1); expect(expressRate.reject).not.toHaveBeenCalled();
      expect(standard.resolve).toHaveBeenCalledTimes(1);
      expect(w.document.querySelector('#summary-total').textContent).toContain('12,95');
    } finally { dom.window.close(); }
  });

  it('rejects an unknown shipping ID and prevents confirmation with the old accepted ID', async () => {
    const { dom, w, handlers, stripe } = await setup();
    try {
      handlers.click({ resolve: jest.fn() });
      handlers.shippingaddresschange({ address, resolve: jest.fn(), reject: jest.fn() }); await flush();
      const invalid = { shippingRate: { id: 'UNKNOWN' }, resolve: jest.fn(), reject: jest.fn() };
      handlers.shippingratechange(invalid); await flush();
      handlers.confirm(details()); await flush();
      expect(invalid.reject).toHaveBeenCalled(); expect(stripe.confirmPayment).not.toHaveBeenCalled();
      expect(w.fetch).toHaveBeenCalledTimes(1);
      expect(w.document.querySelector('#summary-total').textContent).toContain('12,95');
    } finally { dom.window.close(); }
  });

  it('restores the accepted amount when an unsupported address arrives during an Elements update', async () => {
    const { dom, w, handlers, elements, finishUpdate, stripe } = await setup();
    try {
      handlers.click({ resolve: jest.fn() });
      handlers.shippingaddresschange({ address, resolve: jest.fn(), reject: jest.fn() }); await flush();
      elements.update.mockImplementationOnce(() => {});
      const rate = { shippingRate: { id: 'EXPRESS' }, resolve: jest.fn(), reject: jest.fn() };
      handlers.shippingratechange(rate); await flush();
      const invalid = { address: { ...address, country: 'US' }, resolve: jest.fn(), reject: jest.fn() };
      handlers.shippingaddresschange(invalid); await flush();
      finishUpdate(); await flush();
      handlers.confirm(details()); await flush();
      expect(elements.update.mock.calls.map(([value]) => value.amount)).toEqual([1295, 1495, 1295]);
      expect(rate.resolve).toHaveBeenCalledTimes(1); expect(rate.reject).not.toHaveBeenCalled();
      expect(invalid.resolve).not.toHaveBeenCalled(); expect(invalid.reject).toHaveBeenCalledTimes(1);
      expect(w.document.querySelector('#summary-total').textContent).toContain('12,95');
      expect(stripe.confirmPayment).not.toHaveBeenCalled();
      expect(w.fetch.mock.calls.every(([url]: [string]) => url.includes('express-quote'))).toBe(true);
    } finally { dom.window.close(); }
  });

  it('resolves the wallet event before waiting for the SDK acknowledgement, and waits for it before confirmation', async () => {
    const { dom, handlers, elements, finishUpdate, stripe, w } = await setup();
    try {
      handlers.click({ resolve: jest.fn() });
      elements.update.mockImplementationOnce(() => {});
      const changed = { address, resolve: jest.fn(), reject: jest.fn() };
      handlers.shippingaddresschange(changed); await flush();
      expect(changed.resolve).toHaveBeenCalledTimes(1);
      expect(elements.update.mock.invocationCallOrder[0]).toBeLessThan(changed.resolve.mock.invocationCallOrder[0]);
      handlers.confirm(details()); await flush();
      expect(stripe.confirmPayment).not.toHaveBeenCalled();
      expect(w.fetch.mock.calls.every(([url]: [string]) => url.includes('express-quote'))).toBe(true);
      finishUpdate(); await flush();
      expect(stripe.confirmPayment).toHaveBeenCalledTimes(1);
    } finally { dom.window.close(); }
  });
});
