/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const frontendRoot = path.resolve(__dirname, '../../../cronox-front');
const readFrontend = (file: string) =>
  readFileSync(path.join(frontendRoot, file), 'utf8');
const productsScript = readFrontend('assets/products.js');

const savedOrder = [
  'SCARRED TEE - black',
  'SCARRED TEE - red',
  'ASHEN SHELL',
  'SHIELDED COAL',
  'MOLTEN SCRIPT',
  'CORE TEE - black',
  'CORE TEE - grey',
];

const fixtures = savedOrder.map((name, index) => ({
  id: [41, 37, 29, 11, 53, 5, 3][index],
  backendId: [41, 37, 29, 11, 53, 5, 3][index],
  slug: `fixture-${index + 1}`,
  name,
  price: 40,
  priceLabel: '40,00 €',
  image: `/fixture-${index + 1}.jpg`,
  images: [`/fixture-${index + 1}.jpg`],
  categories: index % 2 === 0 ? ['featured'] : ['other'],
  sizes: ['m'],
  color: index % 2 === 0 ? 'black' : 'red',
  variants: [],
}));

const loadStorefront = async (url = 'http://localhost:3000/') => {
  const dom = new JSDOM(
    `<!doctype html>
      <h2 class="store-heading"></h2>
      <form id="filtersForm">
        <input name="cat" value="featured" type="checkbox">
      </form>
      <button id="btnClearFilters" type="button"></button>
      <div id="productsFallback" hidden></div>
      <div id="productsGrid"></div>`,
    { runScripts: 'outside-only', url },
  );
  const app = dom.window as any;
  app.matchMedia = () => ({ matches: false });
  app.requestAnimationFrame = (callback: FrameRequestCallback) => callback(0);
  app.CRONOX_SECURITY = {
    productImageUrl: (value: string, fallback: string) => value || fallback,
  };
  app.CRONOX_API = {
    getFallbackProducts: () => [],
    adaptProducts: (products: unknown[]) => products,
    getProducts: jest.fn().mockResolvedValue(fixtures),
    getCategoryProducts: jest.fn().mockResolvedValue({
      category: { name: 'Novedades', slug: 'novedades' },
      products: fixtures,
      meta: { pageCount: 1 },
    }),
  };
  app.eval(productsScript);
  await app.CRONOX_catalogReady;
  return { app, dom };
};

const renderedNames = (dom: JSDOM) =>
  Array.from(dom.window.document.querySelectorAll('.product-name')).map(
    (node) => node.textContent,
  );

describe('public storefront product ordering', () => {
  it('omits an explicit sort and renders the API sequence exactly', async () => {
    const { app, dom } = await loadStorefront();

    expect(app.CRONOX_API.getProducts).toHaveBeenCalledWith({ limit: 48 });
    expect(renderedNames(dom)).toEqual(savedOrder);
    dom.window.close();
  });

  it('keeps backend order for category pages and stable client-side filters', async () => {
    const { app, dom } = await loadStorefront(
      'http://localhost:3000/tienda?categorySlug=novedades',
    );

    expect(app.CRONOX_API.getCategoryProducts).toHaveBeenCalledWith(
      'novedades',
      { page: 1, limit: 100 },
    );
    expect(renderedNames(dom)).toEqual(savedOrder);

    const categoryFilter =
      dom.window.document.querySelector<HTMLInputElement>('input[name="cat"]')!;
    categoryFilter.checked = true;
    dom.window.document
      .getElementById('filtersForm')!
      .dispatchEvent(new dom.window.Event('submit', { bubbles: true }));

    expect(renderedNames(dom)).toEqual(
      fixtures
        .filter((product) => product.categories.includes('featured'))
        .map((product) => product.name),
    );
    dom.window.close();
  });

  it('contains no browser-side product reversal or legacy creation-date sort', () => {
    const checkoutScript = readFrontend('assets/checkout.js');
    expect(productsScript).not.toContain('.reverse(');
    expect(productsScript).not.toMatch(/PRODUCTS\s*\.\s*sort\s*\(/);
    expect(productsScript).not.toMatch(/sortBy:\s*["']createdAt["']/);
    expect(productsScript).not.toMatch(/order:\s*["']desc["']/);
    expect(checkoutScript).not.toMatch(/sortBy:\s*["']createdAt["']/);
    expect(checkoutScript).toMatch(/API\.getProducts\(\{\s*limit: 12,?\s*\}\)/);
  });

  it('cache-busts products.js consistently on every page that loads it', () => {
    for (const page of [
      'index.html',
      'favorites.html',
      'profile.html',
      'producto.html',
    ]) {
      const html = readFrontend(page);
      expect(html).toContain('assets/products.js?v=59');
      expect(html).not.toMatch(/assets\/products\.js\?v=(?!59\b)/);
    }
    expect(readFrontend('checkout.html')).toContain('assets/checkout.js?v=19');
  });
});
