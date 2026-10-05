/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const read = (file: string) => readFileSync(path.resolve(__dirname, '../../../cronox-front', file), 'utf8');
const create = (html = '') => {
  const dom = new JSDOM(html, { url: 'http://localhost:3000/tienda', runScripts: 'outside-only' });
  const app = dom.window as any;
  app.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  app.scrollTo = () => {};
  app.fetch = async () => ({ ok: true, json: async () => ({}) });
  app.requestAnimationFrame = (callback: FrameRequestCallback) => callback(0);
  app.CRONOX_SECURITY = { productImageUrl: (url: string, fallback: string) => url || fallback };
  app.CRONOX_API = { getProducts: async () => [], adaptProducts: (rows: unknown[]) => rows };
  return { dom, app, document: dom.window.document };
};
const product = (id: number) => ({
  id, name: `Product ${id}`, price: id * 10, sizes: ['M'],
  images: [`/product-${id}.webp`, `/product-${id}-back.webp`],
  variants: [{ id: id * 100, size: 'M', stockQty: 2 }],
  variantMap: { M: { id: id * 100, size: 'M', stockQty: 2 } },
});
const complete = (app: any, image: HTMLImageElement) => {
  Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 300 });
  image.dispatchEvent(new app.Event('load'));
};

describe('Quick Add opening isolation', () => {
  it('removes old pixels/attributes immediately and ignores late image loads after switch and close', () => {
    const { dom, app, document } = create();
    app.eval(read('assets/responsive-images.js'));
    app.eval(read('assets/products.js'));
    app.CRONOX_openQuickAdd(product(1));
    const old = document.querySelector<HTMLImageElement>('#qaImg1')!;
    complete(app, old);
    expect(old.classList.contains('qa-image-loading')).toBe(false);
    app.CRONOX_openQuickAdd(product(2));
    const next = document.querySelector<HTMLImageElement>('#qaImg1')!;
    expect(old.isConnected).toBe(false);
    expect(next.src).toContain('/product-2.webp');
    expect(next.classList.contains('qa-image-loading')).toBe(true);
    let addedVariant: number | undefined;
    app.addEventListener('cronox:addToCart', (event: any) => { addedVariant = event.detail.variantId; });
    document.querySelector<HTMLButtonElement>('#qaAdd')!.click();
    expect(addedVariant).toBe(200);
    expect(document.querySelector('#qaName')!.textContent).toBe('Product 2');
    expect(document.querySelector('#qaPrice')!.textContent).toContain('20');
    expect(document.querySelector('.qa-media')!.getAttribute('aria-busy')).toBe('true');
    complete(app, old);
    expect(next.classList.contains('qa-image-loading')).toBe(true);
    document.querySelector<HTMLButtonElement>('.qa-close')!.click();
    complete(app, next);
    expect(document.querySelector('.qa-media')!.children).toHaveLength(0);
    app.CRONOX_openQuickAdd(product(3));
    complete(app, next);
    const current = document.querySelector<HTMLImageElement>('#qaImg1')!;
    expect(current.src).toContain('/product-3.webp');
    expect(current.classList.contains('qa-image-loading')).toBe(true);
    complete(app, current);
    complete(app, document.querySelector<HTMLImageElement>('#qaImg2')!);
    expect(document.querySelector('.qa-media')!.getAttribute('aria-busy')).toBe('false');
    app.CRONOX_openQuickAdd({ ...product(4), variantMap: { M: { id: 400, stockQty: 0 } } });
    expect(document.querySelector<HTMLButtonElement>('#qaAdd')!.disabled).toBe(true);
    dom.window.close();
  });

  it('cannot apply an old fallback or cart completion to a later opening of the same product', () => {
    const { dom, app, document } = create();
    app.eval(read('assets/responsive-images.js'));
    app.eval(read('assets/products.js'));
    const selected = product(1);
    let callback: (success: boolean) => void = () => {};
    app.addEventListener('cronox:addToCart', (event: any) => { callback = event.detail.onComplete; });
    app.CRONOX_openQuickAdd(selected);
    const old = document.querySelector<HTMLImageElement>('#qaImg1')!;
    document.querySelector<HTMLButtonElement>('#qaAdd')!.click();
    document.querySelector<HTMLButtonElement>('.qa-close')!.click();
    app.CRONOX_openQuickAdd(selected);
    old.dispatchEvent(new app.Event('error'));
    callback(true);
    expect(document.querySelector('#qaAdd')!.textContent).toBe('Añadir al carrito');
    expect(document.querySelector('#qaCartStatus')!.textContent).toBe('');
    expect(document.querySelector<HTMLImageElement>('#qaImg1')!.src).toContain('/product-1.webp');
    app.CRONOX_openQuickAdd({ ...selected, images: [], image: '' });
    expect(document.querySelector<HTMLImageElement>('#qaImg1')!.src).toContain('product-image-unavailable.svg');
    dom.window.close();
  });
});

describe('dynamic category group ordering', () => {
  it('uses reserved NEW and Spanish alphabet, preserves selection, and never promotes hidden categories', async () => {
    const { dom, app, document } = create(read('index.html'));
    let categories = [
      { name: 'zapatos', slug: 'zapatos', group: 'GARMENT' },
      { name: 'D sin clasificar', slug: 'unknown', group: 'UNCLASSIFIED' },
      { name: 'Colección verano', slug: 'summer', group: 'DROP' },
      { name: 'Álbum', slug: 'album', group: 'DROP' },
      { name: 'camisetas', slug: 'camisetas', group: 'GARMENT' },
      { name: 'Estrenos renombrados', slug: 'novedades', group: 'NEW' },
      { name: 'Oculta', slug: 'hidden', group: 'DROP', showInStoreFilters: false },
      { name: 'Inactiva', slug: 'inactive', group: 'DROP', isActive: false },
    ];
    app.CRONOX_API = { getAllCategories: async () => categories };
    app.eval(read('assets/app.js'));
    await app.CRONOX_STORE_CATEGORIES.ready;
    const names = () => [...document.querySelectorAll('#storeCategoryFilters .black-menu__link')].map(node => node.textContent);
    expect(names()).toEqual(['Estrenos renombrados', 'Álbum', 'Colección verano', 'camisetas', 'zapatos', 'D sin clasificar']);
    const selected = document.querySelector<HTMLInputElement>('[value="camisetas"]')!;
    selected.checked = true;
    categories = categories.map(c => c.group === 'NEW' ? { ...c, showInStoreFilters: false } : c)
      .concat({ name: 'abrigo', slug: 'abrigo', group: 'GARMENT' });
    await app.CRONOX_STORE_CATEGORIES.refresh();
    expect(names()).toEqual(['Álbum', 'Colección verano', 'abrigo', 'camisetas', 'zapatos', 'D sin clasificar']);
    expect(document.querySelector<HTMLInputElement>('[value="camisetas"]')!.checked).toBe(true);
    expect(document.querySelector('[value="camisetas"]')!.parentElement!.tagName).toBe('LABEL');
    dom.window.close();
  });
});
