/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const root = path.resolve(__dirname, '../../../cronox-front');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const pending = () => {
  let resolve!: (value: any) => void;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((done) => setTimeout(done, 0));
};
const cart = {
  items: [
    {
      id: 1,
      variantId: 10,
      qty: 1,
      priceCents: 3495,
      size: 'M',
      product: { id: 2, slug: 'test-shirt', name: 'Test shirt' },
    },
  ],
  subtotalCents: 3495,
  itemsCount: 1,
};
const summary = {
  cart,
  shippingMethods: [{ code: 'STANDARD', amountCents: 295 }],
  selectedShippingMethod: { code: 'STANDARD', amountCents: 295 },
  totals: {
    subtotalCents: 3495,
    shippingCents: 295,
    discountCents: 0,
    totalCents: 3790,
  },
};
const setup = (page = 'checkout.html', initialUser: any = null) => {
  const dom = new JSDOM(read(page), {
    runScripts: 'outside-only',
    url: 'https://example.test/' + page,
  });
  const w = dom.window as any;
  w.CRONOX_USER = initialUser;
  w.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    addListener() {},
  });
  w.fetch = jest.fn(() => pending().promise); // Login modal stays pending.
  w.CRONOX_CHECKOUT_LOADING = { finish: jest.fn() };
  w.CRONOX_STRIPE_PUBLISHABLE_KEY = 'pk_test_startup';
  w.CRONOX_STRIPE_READY = pending().promise;
  w.CRONOX_API = {
    getMe: jest.fn().mockResolvedValue(initialUser),
    getCart: jest.fn().mockResolvedValue(cart),
    getCheckoutSummary: jest.fn().mockResolvedValue(summary),
    getDefaultAddress: jest.fn().mockResolvedValue(null),
    getProducts: jest.fn(() => pending().promise),
  };
  w.eval(read('assets/country.js'));
  w.eval(read('assets/checkout-lifecycle.js'));
  return { dom, w };
};

describe('checkout and cart startup performance', () => {
  it('shares the initial session, skips the initial auth reload, and does not wait for the modal, Stripe or recommendations', async () => {
    const { dom, w } = setup();
    try {
      w.eval(read('assets/app.js'));
      w.eval(read('assets/checkout.js'));
      await flush();
      // The fixture counts both callers; the real API coalesces their request.
      expect(w.CRONOX_API.getMe).toHaveBeenCalledTimes(2);
      expect(w.CRONOX_API.getCart).toHaveBeenCalledTimes(1);
      expect(w.CRONOX_API.getCheckoutSummary).toHaveBeenCalledTimes(1);
      expect(w.CRONOX_API.getProducts).toHaveBeenCalledTimes(1);
      expect(w.CRONOX_CHECKOUT_LOADING.finish).toHaveBeenCalled();
      expect(
        w.document.querySelector('#checkout-cart-items').textContent,
      ).toContain('Test shirt');
      expect(w.document.querySelector('#pay-button').disabled).toBe(true);
      // A real session change still refreshes the authoritative cart/summary.
      w.dispatchEvent(
        new w.CustomEvent('cronox:userChanged', { detail: null }),
      );
      await flush();
      expect(w.CRONOX_API.getCheckoutSummary).toHaveBeenCalledTimes(2);
      expect(w.CRONOX_API.getCart).toHaveBeenCalledTimes(2);
    } finally {
      dom.window.close();
    }
  });

  it('renders the authenticated summary while saved addresses are still loading', async () => {
    const { dom, w } = setup();
    const address = pending();
    w.CRONOX_USER = { id: 1, email: 'test@example.test' };
    w.CRONOX_API.getDefaultAddress.mockReturnValue(address.promise);
    try {
      w.eval(read('assets/checkout.js'));
      await flush();
      expect(w.CRONOX_API.getDefaultAddress).toHaveBeenCalledTimes(1);
      expect(w.CRONOX_API.getCheckoutSummary).toHaveBeenCalledTimes(1);
      expect(w.CRONOX_CHECKOUT_LOADING.finish).toHaveBeenCalled();
      expect(w.document.querySelector('#summary-total').textContent).toContain(
        '37,90',
      );
      expect(w.document.querySelector('#pay-button').disabled).toBe(true);
      address.resolve(null);
      await flush();
      expect(w.CRONOX_API.getCheckoutSummary).toHaveBeenCalledTimes(1);
    } finally {
      dom.window.close();
    }
  });

  it('reveals a summary failure even with Stripe still pending', async () => {
    const { dom, w } = setup();
    w.console.error = jest.fn();
    w.CRONOX_API.getCheckoutSummary.mockRejectedValue(new Error('offline'));
    try {
      w.eval(read('assets/checkout.js'));
      await flush();
      expect(w.CRONOX_CHECKOUT_LOADING.finish).toHaveBeenCalled();
      expect(w.document.querySelector('[data-empty]').textContent).toContain(
        'Reintentar',
      );
      expect(w.document.querySelector('#pay-button').disabled).toBe(true);
    } finally {
      dom.window.close();
    }
  });

  it.each([false, true])(
    'prepares one payment only after Stripe and address readiness (shipping change while pending: %s)',
    async (changeShipping) => {
      const user = {
        id: 1,
        email: 'test@example.test',
        firstName: 'Test',
        lastName: 'User',
        address: {
          line1: 'Test street',
          zip: '28001',
          city: 'Madrid',
          country: 'ES',
        },
      };
      const { dom, w } = setup('checkout.html', user);
      user.address.country = w.CRONOX_COUNTRY.SPAIN;
      const countryOption = w.document.querySelector(
        '#shipping-form [name="country"] option',
      );
      countryOption.value = w.CRONOX_COUNTRY.SPAIN;
      countryOption.textContent = w.CRONOX_COUNTRY.SPAIN;
      const stripeReady = pending();
      const addressReady = pending();
      if (changeShipping)
        w.CRONOX_API.getDefaultAddress.mockReturnValue(addressReady.promise);
      const handlers: Record<string, () => void> = {};
      const element = {
        on: jest.fn((name: string, handler: () => void) => {
          handlers[name] = handler;
        }),
        mount: jest.fn(),
        unmount: jest.fn(),
      };
      const stripe = { elements: jest.fn(() => ({ create: () => element })) };
      w.CRONOX_STRIPE_READY = stripeReady.promise;
      w.fetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            clientSecret: 'pi_test_secret',
            paymentIntentId: 'pi_test',
            shippingMethod: summary.selectedShippingMethod,
            totals: summary.totals,
          }),
      });
      try {
        w.eval(read('assets/checkout.js'));
        await flush();
        expect(w.CRONOX_CHECKOUT_LOADING.finish).toHaveBeenCalled();
        expect(w.fetch).not.toHaveBeenCalled();
        if (changeShipping) {
          w.document
            .querySelector('input[name="shippingMethod"]')
            .dispatchEvent(new w.Event('change', { bubbles: true }));
          await flush();
        }
        w.Stripe = () => stripe;
        stripeReady.resolve(true);
        if (changeShipping) {
          await flush();
          expect(w.fetch).not.toHaveBeenCalled();
          addressReady.resolve(null);
        }
        await flush();
        expect(element.mount).toHaveBeenCalled();
        expect(w.document.querySelector('#pay-button').disabled).toBe(true);
        handlers.ready();
        handlers.change({ complete: true });
        await flush();
        expect(w.fetch).toHaveBeenCalledTimes(1);
        expect(w.fetch.mock.calls[0][0]).toContain(
          '/api/payments/create-payment-intent',
        );
        expect(w.document.querySelector('#pay-button').disabled).toBe(false);
        expect(w.CRONOX_API.getCheckoutSummary).toHaveBeenCalledTimes(
          changeShipping ? 2 : 1,
        );
      } finally {
        dom.window.close();
      }
    },
  );

  it('keeps one real Stripe Elements instance while guest details and shipping change', async () => {
    const { dom, w } = setup();
    const paymentHandlers: Record<string, () => void> = {};
    const paymentElement = {
      on: jest.fn((event: string, handler: () => void) => { paymentHandlers[event] = handler; }),
      mount: jest.fn((container: HTMLElement) => {
        container.dataset.stripeMounted = 'true';
        queueMicrotask(() => paymentHandlers.ready?.());
      }),
      unmount: jest.fn(),
    };
    const expressElement = {
      on: jest.fn(), mount: jest.fn(), unmount: jest.fn(),
    };
    const elements = {
      create: jest.fn((type: string) => type === 'payment' ? paymentElement : expressElement),
      update: jest.fn().mockResolvedValue(undefined),
      submit: jest.fn().mockResolvedValue({}),
    };
    const stripe = { elements: jest.fn(() => elements), confirmPayment: jest.fn() };
    w.Stripe = () => stripe;
    w.CRONOX_STRIPE_READY = Promise.resolve(true);
    w.CRONOX_API.getCheckoutSummary.mockImplementation(({ shippingMethod }: { shippingMethod: string }) => {
      const express = shippingMethod === 'EXPRESS';
      const amountCents = express ? 3990 : 3790;
      return Promise.resolve({
        ...summary,
        shippingMethods: [
          { code: 'STANDARD', label: 'Estándar', amountCents: 295 },
          { code: 'EXPRESS', label: 'Express', amountCents: 495 },
        ],
        selectedShippingMethod: { code: shippingMethod, amountCents: express ? 495 : 295 },
        totals: { ...summary.totals, shippingCents: express ? 495 : 295, totalCents: amountCents },
      });
    });
    w.fetch.mockImplementation((_url: string, options: { body: string }) => {
      const request = JSON.parse(options.body);
      const express = request.shippingMethod === 'EXPRESS';
      return Promise.resolve({ ok: true, json: () => Promise.resolve({
        clientSecret: express ? 'pi_express_secret' : 'pi_standard_secret',
        paymentIntentId: express ? 'pi_express' : 'pi_standard',
        shippingMethod: { code: request.shippingMethod },
        totals: { ...summary.totals, shippingCents: express ? 495 : 295, totalCents: express ? 3990 : 3790 },
      }) });
    });
    const change = (selector: string, value: string) => {
      const input = w.document.querySelector(selector);
      input.value = value;
      input.dispatchEvent(new w.Event('change', { bubbles: true }));
    };
    try {
      w.eval(read('assets/checkout.js'));
      await flush();
      expect(stripe.elements).toHaveBeenCalledWith(expect.objectContaining({
        mode: 'payment', currency: 'eur', amount: 3790,
      }));
      expect(paymentElement.mount).toHaveBeenCalledTimes(1);
      expect(w.document.querySelector('#payment-element').dataset.stripeMounted).toBe('true');
      expect(w.document.querySelector('#pay-button').textContent).toBe('Completa tus datos');
      expect(w.document.querySelector('#pay-button').disabled).toBe(true);
      expect(w.fetch).not.toHaveBeenCalled();

      // Card details are entered before any recipient details, and stay in
      // the same Stripe Element throughout address and shipping edits.
      paymentHandlers.change({ complete: true });
      expect(w.document.querySelector('#pay-button').disabled).toBe(true);

      change('#shipping-form [name="firstName"]', 'Ada');
      change('#shipping-form [name="lastName"]', 'Lovelace');
      change('#shipping-form [name="address"]', 'Calle Mayor 1');
      change('#shipping-form [name="zip"]', '28001');
      change('#shipping-form [name="city"]', 'Madrid');
      await flush();
      expect(w.fetch).not.toHaveBeenCalled();
      expect(paymentElement.mount).toHaveBeenCalledTimes(1);

      change('#checkout-guest-email', 'ada@example.test');
      await flush();
      expect(w.fetch).toHaveBeenCalledTimes(1);
      expect(w.document.querySelector('#pay-button').textContent).toBe('Pagar ahora');
      expect(w.document.querySelector('#pay-button').disabled).toBe(false);

      w.document.querySelector('#shipping-form [name="city"]')
        .dispatchEvent(new w.Event('change', { bubbles: true }));
      await flush();
      expect(w.fetch).toHaveBeenCalledTimes(1);
      expect(w.document.querySelector('#pay-button').disabled).toBe(false);

      paymentHandlers.change({ complete: false });
      expect(w.document.querySelector('#pay-button').textContent).toBe('Pagar ahora');
      expect(w.document.querySelector('#pay-button').disabled).toBe(true);
      paymentHandlers.change({ complete: true });
      expect(w.document.querySelector('#pay-button').disabled).toBe(false);

      change('#shipping-form [name="zip"]', '28');
      await flush();
      expect(w.document.querySelector('#pay-button').textContent).toBe('Completa tus datos');
      expect(w.document.querySelector('#pay-button').disabled).toBe(true);
      expect(w.fetch).toHaveBeenCalledTimes(1);
      expect(paymentElement.unmount).not.toHaveBeenCalled();

      change('#shipping-form [name="zip"]', '28001');
      await flush();
      expect(w.fetch).toHaveBeenCalledTimes(2);
      expect(w.document.querySelector('#pay-button').textContent).toBe('Pagar ahora');
      expect(w.document.querySelector('#pay-button').disabled).toBe(false);

      const expressInput = w.document.querySelector('input[name="shippingMethod"][value="EXPRESS"]');
      expressInput.checked = true;
      expressInput.dispatchEvent(new w.Event('change', { bubbles: true }));
      await flush();
      expect(elements.update).toHaveBeenCalledWith({ amount: 3990 });
      expect(w.fetch).toHaveBeenCalledTimes(3);
      expect(paymentElement.mount).toHaveBeenCalledTimes(1);
      expect(paymentElement.unmount).not.toHaveBeenCalled();
      expect(w.document.querySelector('#pay-button').disabled).toBe(false);
      expect(stripe.confirmPayment).not.toHaveBeenCalled();
    } finally {
      dom.window.close();
    }
  });

  it('uses one initial cart read for both the shared cart and cart page', async () => {
    const { dom, w } = setup('cart.html');
    try {
      w.eval(read('assets/app.js'));
      w.eval(read('assets/cart.js'));
      await flush();
      expect(w.CRONOX_API.getCart).toHaveBeenCalledTimes(1);
      expect(w.document.querySelector('#cartItems').textContent).toContain(
        'Test shirt',
      );
    } finally {
      dom.window.close();
    }
  });

  it.each(['load', 'error'])(
    'loads official Stripe asynchronously and settles on %s',
    async (event) => {
      const { dom, w } = setup();
      try {
        w.eval(read('assets/checkout-stripe.js'));
        const script = w.document.querySelector(
          'script[src="https://js.stripe.com/v3/"]',
        );
        expect(script.async).toBe(true);
        if (event === 'load') w.Stripe = jest.fn();
        script.dispatchEvent(new w.Event(event));
        await expect(w.CRONOX_STRIPE_READY).resolves.toBe(event === 'load');
        expect(read('checkout.html')).not.toContain(
          '<script src="https://js.stripe.com/v3/"></script>',
        );
      } finally {
        dom.window.close();
      }
    },
  );
});
