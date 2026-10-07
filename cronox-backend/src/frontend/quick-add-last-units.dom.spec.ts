/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { soldOutSizeCount } from '../common/stock-status';

const read = (file: string) => readFileSync(path.resolve(__dirname, '../../../cronox-front', file), 'utf8');
const setup = (url = 'http://localhost:3000/') => {
  const dom = new JSDOM('', { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const app = dom.window as any;
  app.Date.now = () => Date.parse('2026-10-09T12:00:00Z');
  app.scrollTo = () => {};
  app.matchMedia = () => ({ matches: false, addEventListener() {} });
  app.fetch = async () => ({ ok: true, json: async () => ({}) });
  app.eval(read('assets/api.js'));
  app.CRONOX_API.getProducts = async () => [];
  app.eval(read('assets/product-delivery.js'));
  app.eval(read('assets/products.js'));
  return { dom, app, document: dom.window.document };
};
const product = (zeroSizes: number, sizeCount = 5) => {
  const variants = ['XS', 'S', 'M', 'L', 'XL'].slice(0, sizeCount)
    .map((size, i) => ({ id: i + 1, size, stockQty: i < zeroSizes ? 0 : 1, isActive: true }));
  return { id: 1, slug: 'local-fixture', name: 'Fixture', price: 20, lastUnitsThreshold: 5,
    variants, variantMap: Object.fromEntries(variants.map(v => [v.size, v])), sizes: variants.map(v => v.size) };
};

describe('Quick Add size messages and shared delivery', () => {
  it('keeps scarce items in the cart, decorates recommendation prices and excludes exhausted recommendations', async () => {
    const dom = new JSDOM(read('index.html'), { url: 'http://localhost:3000/', runScripts: 'outside-only' });
    const app = dom.window as any;
    app.scrollTo = () => {};
    app.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    app.fetch = async () => ({ ok: true, json: async () => ({}), text: async () => '' });
    app.eval(read('assets/api.js'));
    const low = { ...product(4), id: 10, backendId: 10, slug: 'low' };
    const normal = { ...product(0), id: 11, backendId: 11, slug: 'normal', lastUnitsThreshold: 0 };
    const out = { ...product(2, 2), id: 12, backendId: 12, slug: 'out', lastUnitsThreshold: null };
    app.CRONOX_PRODUCTS = [out, low, normal];
    const cart = { items: [{ id: 1, variantId: 5, qty: 1, product: { id: 9, name: 'Cart low', lastUnitsThreshold: 5 }, priceCents: 2000 }], subtotalCents: 2000, itemsCount: 1 };
    app.CRONOX_API.getCart = async () => cart;
    app.CRONOX_API.getMe = async () => null;
    app.CRONOX_API.getFavorites = async () => [];
    app.fetch = async () => ({ ok: true, json: async () => [], text: async () => read('auth-modal.html') });
    app.eval(read('assets/app.js'));
    await app.CRONOX_CART.fetchCart();
    const document = dom.window.document;
    expect(document.querySelectorAll('.cart-line')).toHaveLength(1);
    expect(document.querySelector('.cart-line')!.textContent).not.toMatch(/Últimas unidades|Agotado/);
    expect(document.querySelectorAll('.cart-upsell__item')).toHaveLength(2);
    expect(document.querySelector('[data-upsell-product="out"]')).toBeNull();
    const warning = document.querySelector('.cart-upsell__last-units')!;
    expect(warning.textContent).toBe(' · Últimas unidades');
    expect(warning.parentElement!.className).toBe('cart-upsell__price');
    expect(document.querySelectorAll('.cart-upsell__media .product-last-units, .cart-upsell__last-units .product-last-units__dot')).toHaveLength(0);
    // A newly received exhausted snapshot invalidates the recommendation render.
    low.variants = product(5).variants;
    await app.CRONOX_CART.fetchCart();
    expect(document.querySelector('[data-upsell-product="low"]')).toBeNull();
    expect(document.querySelectorAll('.cart-line')).toHaveLength(1);
    dom.window.close();
  });
  it.each([0, 1, 2, 3, 4])('%s exhausted sizes uses the correct action and footer', exhausted => {
    const { dom, app, document } = setup();
    app.CRONOX_openQuickAdd(product(exhausted));
    expect(document.querySelector<HTMLElement>('#qaNotify')!.hidden).toBe(exhausted < 3);
    expect(document.querySelector('#qaLink')!.textContent).toBe(exhausted > 0 && exhausted < 3
      ? '¿Tu talla está agotada? Activa un aviso en el producto' : 'Ver detalles del producto');
    expect(document.querySelector<HTMLButtonElement>('#qaAdd')!.disabled).toBe(false);
    const delivery = document.querySelector<HTMLElement>('#qaDelivery')!;
    expect(delivery.hidden).toBe(false);
    expect(delivery.querySelector('strong')!.textContent).toBe(app.CRONOX_DELIVERY.estimateCart({ items: [{ qty: 1 }] }));
    expect(delivery.parentElement!.className).toBe(exhausted ? 'qa-footer' : 'qa-row qa-actions');
    expect(delivery.classList.contains('qa-delivery--corner')).toBe(exhausted > 0);
    expect(document.querySelector('#qaNotify')!.getAttribute('href')).toBe('/producto/local-fixture#productWaitlist');
    document.querySelector<HTMLButtonElement>('.qa-close')!.click();
    app.dispatchEvent(new app.Event('focus'));
    expect(delivery.hidden).toBe(true);
    dom.window.close();
  });
  it.each([1, 2, 5])('fully exhausted product with %s sizes offers alerts without a delivery promise', count => {
    const { dom, app, document } = setup();
    app.CRONOX_openQuickAdd(product(count, count));
    expect(document.querySelector<HTMLElement>('#qaNotify')!.hidden).toBe(false);
    expect(document.querySelector<HTMLButtonElement>('#qaAdd')!.disabled).toBe(true);
    expect(document.querySelector<HTMLElement>('#qaDelivery')!.hidden).toBe(true);
    expect(document.querySelector('#qaLink')!.textContent).toBe('Ver detalles del producto');
    app.CRONOX_openQuickAdd(product(0));
    expect(document.querySelector<HTMLElement>('#qaNotify')!.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>('#qaDelivery')!.hidden).toBe(false);
    dom.window.close();
  });
  it('counts duplicate sizes once, skips inactive/unknown sizes and selects a purchasable variant', () => {
    const variants = [{ id: 1, size: 'M', stockQty: 2 }, { id: 2, size: 'm', stockQty: 0 },
      { id: 3, size: 'S', stockQty: 0 }, { id: 4, size: 's', stockQty: 0 },
      { id: 5, size: 'XL', stockQty: 0, isActive: false }, { id: 6, size: 'L' }];
    expect(soldOutSizeCount(variants)).toBe(1);
    expect(soldOutSizeCount([{ size: 'US 6', stockQty: 0 }, { size: 'US_6', stockQty: 0 }])).toBe(1);
    const { dom, app, document } = setup();
    const data = product(0);
    data.variants = variants.slice(0, 4) as any;
    data.variantMap = { M: variants[1], S: variants[2] } as any;
    let added: number | null = null;
    app.addEventListener('cronox:addToCart', (e: any) => { added = e.detail.variantId; });
    app.CRONOX_openQuickAdd(data);
    expect(document.querySelectorAll('#qaSizes .qa-size-btn')).toHaveLength(2);
    document.querySelector<HTMLButtonElement>('#qaAdd')!.click();
    expect(added).toBe(1);
    dom.window.close();
  });
  it('opens the existing alert section without choosing a size or requesting a subscription', async () => {
    const { dom, app, document } = setup('http://localhost:3000/producto/local-fixture#productWaitlist');
    document.body.innerHTML += '<div id="anchor"></div>';
    app.HTMLElement.prototype.scrollIntoView = () => {};
    const requests: string[] = [];
    app.fetch = async (url: string) => { requests.push(url); return { ok: true, json: async () => ({ subscription: null }) }; };
    app.CRONOX_USER = { id: 7 };
    app.CRONOX_AUTH_READY = Promise.resolve();
    app.eval(read('assets/waitlist.js'));
    app.CRONOX_WAITLIST.mount(product(2), document.getElementById('anchor'));
    const select = document.querySelector<HTMLSelectElement>('#restockSize')!;
    expect(select.value).toBe('');
    expect(document.querySelector<HTMLButtonElement>('#productWaitlist button')!.disabled).toBe(true);
    expect(requests).toHaveLength(0);
    select.value = '1';
    select.dispatchEvent(new app.Event('change'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(requests).toEqual([expect.stringContaining('/api/waitlist/1')]);
    expect(document.querySelector('#productWaitlist .restock-status')!.textContent).toContain('Confirma tu aviso');
    // A restocked chosen size must not silently switch the request to another size.
    const latest = product(2);
    latest.variants[0].stockQty = 1;
    app.CRONOX_API.getProductBySlug = async () => latest;
    document.querySelector<HTMLButtonElement>('#productWaitlist button')!.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(select.value).toBe('');
    expect(document.querySelector<HTMLButtonElement>('#productWaitlist button')!.disabled).toBe(true);
    expect(new URL(app.location.href).searchParams.has('waitlist')).toBe(false);
    expect(requests).toHaveLength(1); // Only the initial GET, never an automatic POST.
    dom.window.close();
  });
});
