/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const read = (file: string) => readFileSync(path.resolve(__dirname, '../../../cronox-front', file), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function setup(customerSurface = true) {
  const dom = new JSDOM(read('faqs.html'), { runScripts: 'outside-only', url: 'http://localhost:3000/faqs' });
  if (!customerSurface) dom.window.document.body.removeAttribute('data-cronox-surface');
  const app = dom.window as any;
  app.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  app.scrollTo = () => {};
  app.requestAnimationFrame = (callback: () => void) => { callback(); return 1; };
  app.cancelAnimationFrame = () => {};
  app.fetch = async () => ({ ok: true, text: async () => read('auth-modal.html') });
  app.CRONOX_API = { getMe: async () => null, getFavorites: async () => [], getAllCategories: async () => [],
    getCart: async () => ({ items: [], itemsCount: 0, subtotalCents: 0 }) };
  app.CRONOX_STOCK = { productStockStatus: (variants: any[]) => variants[0].stock > 0 ? 'in_stock' : 'out_of_stock', hasLastUnits: () => false };
  app.eval(read('assets/info-shell.js'));
  app.eval(read('assets/app.js'));
  return { dom, app, document: dom.window.document };
}
const catalog = [{ id: '1', slug: 'available', name: 'Available', variants: [{ stock: 10 }] },
  { id: '2', slug: 'sold-out', name: 'Sold out', variants: [{ stock: 0 }] }];

describe('cart recommendation dependencies', () => {
  it.each([true, false])('uses the correct missing-image caption before lazy helpers load (customer surface: %s)', async customerSurface => {
    const { app, dom, document } = setup(customerSurface);
    await tick();
    app.CRONOX_API.getCart = async () => ({
      items: [{ id: 1, qty: 1, priceCents: 2000, product: { name: 'Product without image' } }],
      itemsCount: 1, subtotalCents: 2000,
    });
    await app.CRONOX_CART.fetchCart();
    const expected = customerSurface
      ? '/assets/customer-product-image-unavailable.svg'
      : 'assets/product-image-unavailable.svg';
    expect(document.querySelector('.cart-line img')?.getAttribute('src')).toBe(expected);
    expect(app.CRONOX_IMAGES).toBeUndefined();
    await app.CRONOX_CART.openCartDrawer();
    expect(document.querySelector('.cart-line img')?.getAttribute('src')).toBe(expected);
    expect(app.CRONOX_IMAGES).toBeUndefined();
    dom.window.close();
  });

  it('loads the existing catalogue and quick-add once, then redraws after catalogue readiness', async () => {
    const { app, dom, document } = setup();
    await tick();
    await app.CRONOX_CART.openCartDrawer();
    await app.CRONOX_CART.openCartDrawer();
    expect(document.querySelectorAll('script[src*="responsive-images.js"]')).toHaveLength(1);
    app.CRONOX_IMAGES = { resolveProduct: () => null, applyProduct: () => {} };
    document.querySelector('script[src*="responsive-images.js"]')!.dispatchEvent(new app.Event('load'));
    await tick();
    expect(document.querySelectorAll('script[src*="products.js"]')).toHaveLength(1);
    expect(document.querySelectorAll('link[href*="quick-add.css"]')).toHaveLength(1);
    let ready!: (products: typeof catalog) => void;
    app.CRONOX_API.getProducts = jest.fn(() => new Promise(resolve => { ready = resolve; }));
    app.CRONOX_openQuickAdd = jest.fn();
    document.querySelector('script[src*="products.js"]')!.dispatchEvent(new app.Event('load'));
    await tick();
    expect(document.querySelectorAll('.cart-upsell__item')).toHaveLength(0);
    app.CRONOX_PRODUCTS = [];
    ready(catalog);
    await tick();
    expect(document.querySelectorAll('.cart-upsell__item')).toHaveLength(1);
    document.querySelector<HTMLButtonElement>('.cart-upsell__add')!.click();
    expect(app.CRONOX_openQuickAdd).toHaveBeenCalledWith(catalog[0]);
    app.CRONOX_CART.closeCartDrawer();
    await app.CRONOX_CART.openCartDrawer();
    expect(document.querySelectorAll('script[src*="products.js"]')).toHaveLength(1);
    expect(app.CRONOX_API.getProducts).toHaveBeenCalledTimes(1);
    dom.window.close();
  });

  it('retries a failed asset load on reopen without blocking cart controls', async () => {
    const { app, dom, document } = setup();
    await tick();
    await app.CRONOX_CART.openCartDrawer();
    document.querySelector('script[src*="responsive-images.js"]')!.dispatchEvent(new app.Event('error'));
    await tick();
    app.CRONOX_CART.closeCartDrawer();
    expect(document.getElementById('cart-drawer')!.classList.contains('is-visible')).toBe(false);
    await app.CRONOX_CART.openCartDrawer();
    expect(document.querySelectorAll('script[src*="responsive-images.js"]')).toHaveLength(1);
    dom.window.close();
  });

  it('deduplicates the full paginated catalogue and ignores changed or empty store results', async () => {
    const { app, dom, document } = setup();
    await tick();
    app.CRONOX_openQuickAdd = jest.fn();
    app.CRONOX_API.getProductsPage = jest.fn(async ({ page }: { page: number }) => ({
      products: [catalog[page - 1]], meta: { pageCount: 2 },
    }));
    const first = app.CRONOX_FULL_CATALOG.load();
    expect(app.CRONOX_FULL_CATALOG.load()).toBe(first);
    await first;
    await app.CRONOX_CART.openCartDrawer();
    expect(document.querySelectorAll('.cart-upsell__item')).toHaveLength(1);
    for (const results of [[catalog[1]], []]) {
      app.CRONOX_PRODUCTS = results;
      app.CRONOX_CART.renderCartDrawer(app.CRONOX_CART.state.data);
      await app.CRONOX_CART.openCartDrawer();
      expect(document.querySelector('.cart-upsell__item')?.getAttribute('data-upsell-product')).toBe('available');
    }
    expect(app.CRONOX_API.getProductsPage.mock.calls).toEqual([[{ page: 1, limit: 48 }], [{ page: 2, limit: 48 }]]);
    dom.window.close();
  });

  it('retries a failed full catalogue request on the next load', async () => {
    const { app, dom } = setup();
    await tick();
    app.CRONOX_API.getProducts = jest.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue(catalog);
    await expect(app.CRONOX_FULL_CATALOG.load()).rejects.toThrow('network');
    await expect(app.CRONOX_FULL_CATALOG.load()).resolves.toEqual(catalog);
    expect(app.CRONOX_API.getProducts).toHaveBeenCalledTimes(2);
    dom.window.close();
  });
});
