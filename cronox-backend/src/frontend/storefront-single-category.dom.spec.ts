/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const script = readFileSync(path.resolve(__dirname, '../../../cronox-front/assets/products.js'), 'utf8');
const categories = ['pantalones', 'chaquetas', 'camisetas', 'drop-1', 'empty'];
const products = [
  { id: 3, name: 'Drop jacket', categories: ['chaquetas', 'drop-1'] },
  { id: 1, name: 'Trousers', categories: ['pantalones'] },
  { id: 2, name: 'Tee', categories: ['camisetas'] },
].map(product => ({ ...product, price: 40, images: ['/product.jpg'], variants: [] }));

async function open(query = '') {
  const dom = new JSDOM(`<h2 class="store-heading"></h2><aside id="filtersPanel">
    <form id="storeCategoryFilters">${['', ...categories].map(slug =>
      `<input type="radio" name="store-category" data-store-category value="${slug}">`).join('')}</form>
    </aside><div id="productsGrid"></div><div id="productsFallback" hidden></div>`,
  { url: `http://localhost:3000/tienda${query}`, runScripts: 'outside-only' });
  const app = dom.window as any;
  app.matchMedia = () => ({ matches: false });
  app.requestAnimationFrame = (callback: FrameRequestCallback) => callback(0);
  app.CRONOX_API = {
    getProducts: jest.fn().mockResolvedValue(products),
    getCategoryProducts: jest.fn().mockImplementation(async (slug: string) => ({
      category: { slug, name: slug },
      products: products.filter(product => product.categories.includes(slug)),
      meta: { pageCount: 1 },
    })),
    getProductsPage: jest.fn().mockResolvedValue({ products: [products[2]], meta: { pageCount: 1 } }),
  };
  app.eval(script);
  app.dispatchEvent(new app.CustomEvent('cronox:store-categories'));
  await app.CRONOX_catalogReady;
  const names = () => [...dom.window.document.querySelectorAll('.product-name')].map(node => node.textContent);
  const input = (slug: string) => dom.window.document.querySelector<HTMLInputElement>(`input[value="${slug}"]`)!;
  const select = async (slug: string) => { input(slug).click(); await app.CRONOX_catalogReady; };
  const selected = () => [...dom.window.document.querySelectorAll<HTMLInputElement>('[data-store-category]:checked')].map(node => node.value);
  return { app, dom, names, input, select, selected };
}

describe('single category navigation', () => {
  it('does not overwrite headings outside the store grid', async () => {
    const dom = new JSDOM('<h1 class="store-heading">Mi cuenta</h1>', { url: 'http://localhost:3000/cuenta', runScripts: 'outside-only' });
    const app = dom.window as any;
    app.CRONOX_API = { getProducts: async () => products };
    app.eval(script);
    await app.CRONOX_catalogReady;
    expect(dom.window.document.querySelector('h1')?.textContent).toBe('Mi cuenta');
    dom.window.close();
  });
  it('replaces garments with garments or drops, retains repeated selection, and resets to all in API order', async () => {
    const { app, dom, names, select, selected } = await open();
    for (const slug of ['pantalones', 'chaquetas', 'camisetas', 'drop-1']) {
      await select(slug);
      expect(names()).toEqual(products.filter(product => product.categories.includes(slug)).map(product => product.name));
      expect(selected()).toEqual([slug]);
      expect(new URL(app.location.href).searchParams.getAll('categorySlug')).toEqual([slug]);
    }
    const calls = app.CRONOX_API.getCategoryProducts.mock.calls.length;
    await select('drop-1');
    expect(selected()).toEqual(['drop-1']);
    expect(names()).toEqual(['Drop jacket']);
    expect(app.CRONOX_API.getCategoryProducts).toHaveBeenCalledTimes(calls);
    await select('');
    expect(names()).toEqual(products.map(product => product.name));
    expect(selected()).toEqual(['']);
    expect(new URL(app.location.href).searchParams.has('categorySlug')).toBe(false);
    await select('empty');
    expect(names()).toEqual([]);
    expect(dom.window.document.getElementById('productsFallback')?.textContent).toBe('No hay productos disponibles en esta categoría.');
    dom.window.close();
  });

  it('normalizes repeated URL selections and allows leaving a URL-scoped catalog', async () => {
    const { app, dom, names, select, selected } = await open('?categorySlug=camisetas&categorySlug=drop-1&search=Tee');
    expect(selected()).toEqual(['camisetas']);
    expect(names()).toEqual(['Tee']);
    expect(new URL(app.location.href).searchParams.getAll('categorySlug')).toEqual(['camisetas']);
    expect(new URL(app.location.href).searchParams.has('search')).toBe(false);
    await select('pantalones');
    expect(names()).toEqual(['Trousers']);
    await select('');
    expect(names()).toHaveLength(3);
    dom.window.close();
  });

  it('ignores a late category response after a newer choice', async () => {
    const { app, dom, input, names, select, selected } = await open();
    let finish!: (value: unknown) => void;
    app.CRONOX_API.getCategoryProducts.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    input('pantalones').click();
    const oldRequest = app.CRONOX_catalogReady;
    await select('chaquetas');
    finish({ category: { slug: 'pantalones' }, products: [products[1]], meta: { pageCount: 1 } });
    await oldRequest;
    expect(names()).toEqual(['Drop jacket']);
    expect(selected()).toEqual(['chaquetas']);
    dom.window.close();
  });

  it('preserves search and lets Todos exit it even when already checked', async () => {
    const { app, dom, select, names, selected } = await open();
    await select('chaquetas');
    await app.CRONOX_handleStoreSearch('Tee');
    expect(names()).toEqual(['Tee']);
    expect(selected()).toEqual(['']);
    await select('');
    expect(names()).toEqual(products.map(product => product.name));
    expect(new URL(app.location.href).searchParams.has('search')).toBe(false);
    dom.window.close();
  });
});
