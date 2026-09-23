/* eslint-disable @typescript-eslint/no-base-to-string, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const root = path.resolve(__dirname, '../../../cronox-front');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const storeCss = read('assets/store.css');
const quickAddCss = read('assets/quick-add.css');

const waitFor = async (assertion: () => void) => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 50; attempt += 1) {
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

describe('mobile cart and Quick Add layers', () => {
  it('keeps the footer brand in semantic order and centers its mobile logo', () => {
    const document = new JSDOM(html).window.document;
    const brand = document.querySelector('.footer-brand-block')!;
    expect(Array.from(brand.children, (node) => node.className)).toEqual([
      'footer-brand-name',
      'footer-social',
      'footer-copy',
    ]);
    expect(storeCss).toMatch(
      /@media \(max-width: 480px\)[\s\S]*?\.footer-brand-name\s*\{[^}]*display: flex;[^}]*width: 100%;[^}]*justify-content: center;/,
    );
    expect(storeCss).toMatch(
      /\.footer-logo\s*\{[^}]*width: min\(100%, 144px\);[^}]*height: auto;[^}]*object-fit: contain;/,
    );
  });

  it('gives cart rows a scrollable panel and keeps Quick Add above the drawer', () => {
    const document = new JSDOM(html).window.document;
    const panel = document.querySelector('.cart-drawer__panel')!;
    expect(Array.from(panel.children, (node) => node.className)).toEqual([
      'cart-drawer__header',
      'cart-free-shipping',
      'cart-drawer__items',
      'cart-upsell',
      'cart-drawer__footer',
    ]);
    expect(storeCss).toMatch(
      /\.cart-drawer__panel\s*\{[^}]*overflow-y: auto;[^}]*overscroll-behavior: contain;/,
    );
    expect(storeCss).toMatch(
      /\.cart-drawer__items\s*\{[^}]*overflow: visible;/,
    );
    expect(storeCss).toMatch(
      /\.cart-drawer__footer\s*\{[^}]*bottom: 0;/,
    );
    expect(
      Number(storeCss.match(/\.cart-drawer\s*\{[^}]*z-index: (\d+);/)?.[1]),
    ).toBeLessThan(
      Number(quickAddCss.match(/\.qa-overlay\s*\{[^}]*z-index:(\d+);/)?.[1]),
    );
    expect(quickAddCss).toMatch(
      /\.qa-info\s*\{[^}]*margin:40px 0 0 !important;/,
    );
    expect(quickAddCss).toMatch(
      /@media \(max-width:640px\)[\s\S]*?\.qa-info\s*\{[^}]*margin-top:32px !important;/,
    );
  });

  it('shows cart rows, layers Quick Add, restores focus and updates the open cart', async () => {
    const dom = new JSDOM(html, {
      runScripts: 'outside-only',
      url: 'http://localhost:3000/',
    });
    const app = dom.window as any;
    const document = app.document as Document;
    document.querySelector('.newsletter-modal-overlay')?.remove();
    const recommendation = {
      id: 3,
      backendId: 3,
      slug: 'third-tee',
      name: 'THIRD TEE',
      price: 30,
      priceCents: 3000,
      image: '/third.webp',
      images: ['/third.webp', '/third-back.webp'],
      sizes: ['M'],
      variants: [
        { id: 303, size: 'M', stock: 3, isActive: true, isAvailable: true },
      ],
      variantMap: { M: { id: 303, size: 'M', stock: 3, priceCents: 3000 } },
    };
    let cart = {
      items: [
        {
          id: 1,
          variantId: 101,
          qty: 1,
          priceCents: 2000,
          size: 'M',
          product: { id: 1, name: 'FIRST TEE' },
          imageUrl: '/first.webp',
        },
        {
          id: 2,
          variantId: 202,
          qty: 1,
          priceCents: 2500,
          size: 'L',
          product: { id: 2, name: 'SECOND TEE' },
          imageUrl: '/second.webp',
        },
      ],
      itemsCount: 2,
      subtotalCents: 4500,
      currency: 'EUR',
    };
    const addCartItem = jest.fn(async () => {
      cart = {
        ...cart,
        items: [
          ...cart.items,
          {
            id: 4,
            variantId: 303,
            qty: 1,
            priceCents: 3000,
            size: 'M',
            product: { id: 3, name: 'THIRD TEE' },
            imageUrl: '/third.webp',
          },
        ],
        itemsCount: 3,
        subtotalCents: 7500,
      };
      return cart;
    });
    const updateCartItem = jest.fn(async (id: number, qty: number) => {
      const items = cart.items.map((item) =>
        item.id === id ? { ...item, qty } : item,
      );
      cart = {
        ...cart,
        items,
        itemsCount: items.reduce((sum, item) => sum + item.qty, 0),
        subtotalCents: items.reduce(
          (sum, item) => sum + item.priceCents * item.qty,
          0,
        ),
      };
      return cart;
    });
    const removeCartItem = jest.fn(async (id: number) => {
      const items = cart.items.filter((item) => item.id !== id);
      cart = {
        ...cart,
        items,
        itemsCount: items.reduce((sum, item) => sum + item.qty, 0),
        subtotalCents: items.reduce(
          (sum, item) => sum + item.priceCents * item.qty,
          0,
        ),
      };
      return cart;
    });
    app.requestAnimationFrame = (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    };
    app.cancelAnimationFrame = jest.fn();
    app.scrollTo = jest.fn();
    app.matchMedia = jest.fn(() => ({
      matches: false,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }));
    app.HTMLElement.prototype.getClientRects = () => ({ length: 1 });
    app.CRONOX_SECURITY = {
      escapeHtml: (value: unknown) => String(value ?? ''),
      productImageUrl: (value: unknown, fallback: string) =>
        String(value || fallback),
    };
    app.CRONOX_IMAGES = {
      resolveProduct: () => null,
      applyProduct: (image: HTMLImageElement, product: any) => {
        image.src = product.image || product.imageUrl || '/image.webp';
      },
      productRecords: (product: any) =>
        product.images.map((url: string) => ({ url })),
      apply: (image: HTMLImageElement, record: any) => {
        image.src = record.url;
      },
    };
    app.CRONOX_API = {
      API_BASE: 'http://localhost:3000',
      getMe: async () => null,
      getFavorites: async () => [],
      getCart: async () => cart,
      getProducts: async () => [recommendation],
      getFallbackProducts: () => [],
      addCartItem,
      updateCartItem,
      removeCartItem,
    };
    app.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [],
      text: async () => read('auth-modal.html'),
    }));
    app.eval(read('assets/app.js'));
    app.eval(read('assets/products.js'));
    await app.CRONOX_catalogReady;
    await waitFor(() => expect(app.CRONOX_CART.state.data).not.toBeNull());
    await app.CRONOX_CART.openCartDrawer();

    const panel = document.querySelector('.cart-drawer__panel') as HTMLElement;
    expect(
      document.querySelectorAll('#cart-items-container .cart-line'),
    ).toHaveLength(2);
    expect(
      document.querySelector('#cart-items-container')?.textContent,
    ).toContain('FIRST TEE');
    expect(
      document.querySelector('#cart-items-container')?.textContent,
    ).toContain('SECOND TEE');
    expect(document.querySelector('.cart-upsell__add')).not.toBeNull();

    panel.scrollTop = 80;
    (document.querySelector('.cart-upsell__add') as HTMLButtonElement).focus();
    (document.querySelector('.cart-upsell__add') as HTMLButtonElement).click();
    const overlay = document.getElementById('quickAdd') as HTMLElement;
    expect(overlay.parentElement).toBe(document.body);
    expect(overlay.getAttribute('aria-hidden')).toBe('false');
    expect(overlay.inert).toBe(false);
    expect(document.activeElement?.classList.contains('qa-close')).toBe(true);
    expect(
      document.getElementById('cart-drawer')?.getAttribute('aria-hidden'),
    ).toBe('true');
    expect((document.getElementById('cart-drawer') as HTMLElement).inert).toBe(
      true,
    );
    expect(document.body.classList.contains('no-scroll')).toBe(true);

    document.dispatchEvent(
      new app.KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
      }),
    );
    expect(document.activeElement?.id).toBe('qaLink');
    document.dispatchEvent(
      new app.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }),
    );
    expect(document.activeElement?.classList.contains('qa-close')).toBe(true);

    document.dispatchEvent(
      new app.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(overlay.getAttribute('aria-hidden')).toBe('true');
    expect(
      document.getElementById('cart-drawer')?.getAttribute('aria-hidden'),
    ).toBe('false');
    expect(panel.scrollTop).toBe(80);
    expect(document.body.classList.contains('no-scroll')).toBe(true);
    expect(
      document.getElementById('cart-drawer')?.contains(document.activeElement),
    ).toBe(true);

    (document.querySelector('.cart-upsell__add') as HTMLButtonElement).click();
    (
      document.querySelector('#qaSizes .qa-size-btn') as HTMLButtonElement
    ).click();
    (document.getElementById('qaAdd') as HTMLButtonElement).click();
    await waitFor(() =>
      expect(
        document.querySelectorAll('#cart-items-container .cart-line'),
      ).toHaveLength(3),
    );
    expect(addCartItem).toHaveBeenCalledWith({ variantId: 303, qty: 1 });
    expect(
      document.querySelector('#cart-items-container')?.textContent,
    ).toContain('THIRD TEE');
    expect(document.querySelector('#cart-checkout-btn')?.textContent).toContain(
      '75,00',
    );
    expect(
      document.querySelector('.topbar__cart .cart-count')?.textContent,
    ).toBe('3');
    expect(
      (document.getElementById('cart-upsell-section') as HTMLElement).hidden,
    ).toBe(true);
    expect(
      document.getElementById('cart-drawer')?.getAttribute('aria-hidden'),
    ).toBe('true');
    (document.querySelector('.qa-close') as HTMLButtonElement).click();
    expect(document.activeElement?.id).toBe('cart-close-btn');
    expect(
      document.getElementById('cart-drawer')?.getAttribute('aria-hidden'),
    ).toBe('false');
    (
      document.querySelector(
        '[data-cart-line="1"] [data-action="inc"]',
      ) as HTMLButtonElement
    ).click();
    await waitFor(() => expect(updateCartItem).toHaveBeenCalledWith(1, 2));
    await waitFor(() =>
      expect(
        document.querySelector('#cart-checkout-btn')?.textContent,
      ).toContain('95,00'),
    );
    (
      document.querySelector(
        '[data-cart-line="2"] [data-remove]',
      ) as HTMLButtonElement
    ).click();
    await waitFor(() => expect(removeCartItem).toHaveBeenCalledWith(2));
    await waitFor(() =>
      expect(
        document.querySelectorAll('#cart-items-container .cart-line'),
      ).toHaveLength(2),
    );
    expect(document.querySelector('#cart-checkout-btn')?.textContent).toContain(
      '70,00',
    );
    dom.window.close();
  });
});
