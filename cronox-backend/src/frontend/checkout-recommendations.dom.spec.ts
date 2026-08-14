/* eslint-disable @typescript-eslint/no-base-to-string, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const frontendRoot = path.resolve(__dirname, '../../../cronox-front');
const checkoutHtml = readFileSync(
  path.join(frontendRoot, 'checkout.html'),
  'utf8',
);
const checkoutLifecycle = readFileSync(
  path.join(frontendRoot, 'assets/checkout-lifecycle.js'),
  'utf8',
);
const checkoutScript = readFileSync(
  path.join(frontendRoot, 'assets/checkout.js'),
  'utf8',
);

const waitFor = async (assertion: () => void, attempts = 50) => {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  throw lastError;
};

describe('checkout recommendation production DOM path', () => {
  it('keeps the exact delegated two-step add flow alive across rerenders', async () => {
    const dom = new JSDOM(checkoutHtml, {
      runScripts: 'outside-only',
      url: 'http://localhost:3000/checkout.html',
    });
    const browserWindow = dom.window as any;
    const document = browserWindow.document as Document;

    const blackTee = {
      id: 'black-core-tee',
      backendId: 10001,
      slug: 'black-core-tee',
      name: 'BLACK-CORE TEE',
      price: 34.95,
      priceLabel: '34,95 €',
      image: 'assets/products/camiseta_washed_negra.png',
      variants: [
        { id: 101, size: 'S', stock: 0, isActive: true, isAvailable: false },
        { id: 102, size: 'M', stock: 4, isActive: true, isAvailable: true },
      ],
    };
    const whiteTee = {
      id: 'white-core-tee',
      backendId: 10003,
      slug: 'white-core-tee',
      name: 'WHITE-CORE TEE',
      price: 34.95,
      priceLabel: '34,95 €',
      image: 'assets/logo_banner.png',
      variants: [
        { id: 201, size: 'S', stock: 0, isActive: true, isAvailable: false },
        { id: 202, size: 'M', stock: 2, isActive: true, isAvailable: true },
      ],
    };
    const catalog = [blackTee, whiteTee];
    let currentCart: any = {
      items: [
        {
          id: 1,
          variantId: 301,
          qty: 1,
          priceCents: 3495,
          size: 'M',
          product: { id: 10002, slug: 'grey-core-tee', name: 'GREY-CORE TEE' },
        },
      ],
      itemsCount: 1,
      subtotalCents: 3495,
      currency: 'EUR',
    };

    const apiAddCartItem = jest.fn(async ({ variantId, qty }) => {
      const product = catalog.find((candidate) =>
        candidate.variants.some((variant) => variant.id === variantId),
      );
      const variant = product?.variants.find(
        (candidate) => candidate.id === variantId,
      );
      currentCart = {
        ...currentCart,
        items: [
          ...currentCart.items,
          {
            id: 2,
            variantId,
            qty,
            priceCents: 3495,
            size: variant?.size,
            product: {
              id: product?.backendId,
              slug: product?.slug,
              name: product?.name,
            },
          },
        ],
        itemsCount: currentCart.itemsCount + qty,
        subtotalCents: currentCart.subtotalCents + 3495 * qty,
      };
      return currentCart;
    });

    browserWindow.CRONOX_COUNTRY = {
      SPAIN: 'España',
      normalizeCountry: (value: unknown) => String(value || 'España'),
    };
    browserWindow.CRONOX_SECURITY = {
      escapeHtml: (value: unknown) => String(value ?? ''),
      productImageUrl: (value: unknown, fallback: string) =>
        String(value || fallback),
    };
    browserWindow.CRONOX_STRIPE_PUBLISHABLE_KEY = 'pk_test_dom_path';
    browserWindow.Stripe = jest.fn(() => ({}));
    browserWindow.CRONOX_CHECKOUT_LOADING = { finish: jest.fn() };
    browserWindow.CRONOX_API = {
      API_BASE: 'http://localhost:3000',
      getCsrfHeaders: async () => ({}),
      getMe: async () => null,
      getCheckoutSummary: async () => ({
        cart: currentCart,
        shippingMethods: [
          { code: 'STANDARD', label: 'Envío estándar', amountCents: 295 },
        ],
        selectedShippingMethod: {
          code: 'STANDARD',
          label: 'Envío estándar',
          amountCents: 295,
        },
        totals: {
          subtotalCents: currentCart.subtotalCents,
          shippingCents: 295,
          discountCents: 0,
          totalCents: currentCart.subtotalCents + 295,
        },
      }),
      getProducts: async () => catalog,
      getProductBySlug: async (slug: string) =>
        catalog.find((product) => product.slug === slug) || null,
      addCartItem: apiAddCartItem,
    };
    browserWindow.CRONOX_CART = {
      addCartItem: async (payload: { variantId: number; qty: number }) => {
        const cart = await apiAddCartItem(payload);
        browserWindow.dispatchEvent(
          new browserWindow.CustomEvent('cart:updated', { detail: cart }),
        );
        return cart;
      },
    };

    browserWindow.eval(checkoutLifecycle);
    browserWindow.eval(checkoutScript);

    await waitFor(() => {
      expect(browserWindow.CRONOX_CHECKOUT_LOADING.finish).toHaveBeenCalled();
      expect(
        document.querySelectorAll('.checkout-recommendation__action'),
      ).toHaveLength(2);
    });

    const recommendationsSection = document.getElementById(
      'checkout-recommendations',
    ) as HTMLElement;
    const surroundingForm = document.createElement('form');
    const submit = jest.fn((event: Event) => event.preventDefault());
    surroundingForm.addEventListener('submit', submit);
    recommendationsSection.before(surroundingForm);
    surroundingForm.appendChild(recommendationsSection);

    const firstCard = document.querySelector(
      '[data-recommendation-product="black-core-tee"]',
    ) as HTMLElement;
    const firstAdd = firstCard.querySelector(
      '.checkout-recommendation__action',
    ) as HTMLButtonElement;
    const initialSelector = firstCard.querySelector(
      '.checkout-recommendation__sizes',
    ) as HTMLElement;

    expect(firstAdd).not.toBeNull();
    expect(firstAdd.type).toBe('button');
    expect(initialSelector.hidden).toBe(true);
    expect(document.getElementById('checkoutMain')?.contains(firstAdd)).toBe(
      true,
    );

    firstAdd.dispatchEvent(
      new browserWindow.MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(initialSelector.hidden).toBe(false);
    expect(apiAddCartItem).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();

    browserWindow.dispatchEvent(
      new browserWindow.CustomEvent('cart:updated', { detail: currentCart }),
    );

    await waitFor(() => {
      const selector = document.querySelector(
        '[data-recommendation-product="black-core-tee"] .checkout-recommendation__sizes',
      ) as HTMLElement;
      expect(selector.hidden).toBe(false);
      expect(
        selector.querySelectorAll('[data-recommendation-variant]'),
      ).toHaveLength(2);
    });

    const availableSize = document.querySelector(
      '[data-recommendation-product="black-core-tee"] [data-recommendation-variant="102"]',
    ) as HTMLButtonElement;
    availableSize.dispatchEvent(
      new browserWindow.MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      }),
    );

    browserWindow.dispatchEvent(
      new browserWindow.CustomEvent('cart:updated', { detail: currentCart }),
    );

    const rerenderedBlackCard = document.querySelector(
      '[data-recommendation-product="black-core-tee"]',
    ) as HTMLElement;
    expect(rerenderedBlackCard.dataset.recommendationVariant).toBe('102');
    expect(
      rerenderedBlackCard
        .querySelector('[data-recommendation-variant="102"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      (
        rerenderedBlackCard.querySelector(
          '.checkout-recommendation__sizes',
        ) as HTMLElement
      ).hidden,
    ).toBe(false);

    const secondAdd = rerenderedBlackCard.querySelector(
      '.checkout-recommendation__action',
    ) as HTMLButtonElement;
    secondAdd.dispatchEvent(
      new browserWindow.MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      }),
    );
    secondAdd.dispatchEvent(
      new browserWindow.MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(secondAdd.textContent).toBe('A\u00f1adiendo\u2026');
    expect(secondAdd.disabled).toBe(true);
    expect(rerenderedBlackCard.classList.contains('is-adding')).toBe(true);

    await waitFor(() => {
      expect(apiAddCartItem).toHaveBeenCalledTimes(1);
      expect(apiAddCartItem).toHaveBeenCalledWith({ variantId: 102, qty: 1 });
    });
    expect(submit).not.toHaveBeenCalled();

    await waitFor(() => {
      const addedCard = document.querySelector(
        '[data-recommendation-product="black-core-tee"]',
      ) as HTMLElement;
      const addedButton = addedCard.querySelector(
        '.checkout-recommendation__action',
      ) as HTMLButtonElement;
      expect(addedCard.classList.contains('is-added')).toBe(true);
      expect(addedButton.textContent).toBe('A\u00f1adido \u2713');
      expect(addedButton.disabled).toBe(true);
    });

    await waitFor(() => {
      expect(
        document.getElementById('checkout-cart-items')?.textContent,
      ).toContain('BLACK-CORE TEE');
      expect(document.getElementById('summary-subtotal')?.textContent).toBe(
        '69,90 \u20ac',
      );
      expect(
        document.getElementById('summary-shipping')?.textContent,
      ).toContain('2,95 \u20ac');
      expect(document.getElementById('summary-total')?.textContent).toBe(
        '72,85 \u20ac',
      );
    });

    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(
      document.querySelector('[data-recommendation-product="black-core-tee"]'),
    ).toBeNull();

    await waitFor(() => {
      expect(
        document.querySelector(
          '[data-recommendation-product="white-core-tee"]',
        ),
      ).not.toBeNull();
    });
    const secondCard = document.querySelector(
      '[data-recommendation-product="white-core-tee"]',
    ) as HTMLElement;
    expect(secondCard.dataset.recommendationVariant).toBe('');
    expect(
      (
        secondCard.querySelector(
          '.checkout-recommendation__sizes',
        ) as HTMLElement
      ).hidden,
    ).toBe(true);

    const whiteAdd = secondCard.querySelector(
      '.checkout-recommendation__action',
    ) as HTMLButtonElement;
    whiteAdd.dispatchEvent(
      new browserWindow.MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitFor(() => {
      expect(
        (
          document.querySelector(
            '[data-recommendation-product="white-core-tee"] .checkout-recommendation__sizes',
          ) as HTMLElement
        ).hidden,
      ).toBe(false);
    });

    const unavailableSize = document.querySelector(
      '[data-recommendation-product="white-core-tee"] [data-recommendation-variant="201"]',
    ) as HTMLButtonElement;
    expect(unavailableSize.disabled).toBe(true);
    unavailableSize.dispatchEvent(
      new browserWindow.MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      }),
    );
    (
      document.querySelector(
        '[data-recommendation-product="white-core-tee"] .checkout-recommendation__action',
      ) as HTMLButtonElement
    ).dispatchEvent(
      new browserWindow.MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(apiAddCartItem).toHaveBeenCalledTimes(1);
    expect(submit).not.toHaveBeenCalled();

    const availableWhiteSize = document.querySelector(
      '[data-recommendation-product="white-core-tee"] [data-recommendation-variant="202"]',
    ) as HTMLButtonElement;
    availableWhiteSize.dispatchEvent(
      new browserWindow.MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      }),
    );
    const warning = jest
      .spyOn(browserWindow.console, 'warn')
      .mockImplementation(() => undefined);
    apiAddCartItem.mockRejectedValueOnce(new Error('add unavailable'));
    const failingAdd = document.querySelector(
      '[data-recommendation-product="white-core-tee"] .checkout-recommendation__action',
    ) as HTMLButtonElement;
    failingAdd.dispatchEvent(
      new browserWindow.MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(failingAdd.textContent).toBe('A\u00f1adiendo\u2026');
    await waitFor(() => {
      expect(failingAdd.textContent).toBe('A\u00f1adir');
      expect(failingAdd.disabled).toBe(false);
      expect(
        (
          failingAdd.closest('.checkout-recommendation') as HTMLElement
        ).classList.contains('is-selecting-size'),
      ).toBe(true);
    });
    warning.mockRestore();

    dom.window.close();
  });
});
