/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const script = readFileSync(
  path.resolve(__dirname, '../../../cronox-front/assets/products.js'),
  'utf8',
);
const productHtml = readFileSync(
  path.resolve(__dirname, '../../../cronox-front/producto.html'),
  'utf8',
);
const item = (name: string, id: number) => ({
  id,
  backendId: id,
  slug: `product-${id}`,
  name,
  price: 40,
  images: ['/product.jpg'],
  variants: [{ id, stock: 2, isActive: true }],
});
function open(getProducts?: jest.Mock) {
  const dom = new JSDOM(
    '<h2 class="store-heading">NOVEDADES</h2><div id="productsGrid"></div><div id="productsFallback" hidden></div>',
    {
      url: 'http://localhost:3000/',
      runScripts: 'outside-only',
    },
  );
  const app = dom.window as any;
  app.matchMedia = () => ({ matches: false });
  app.requestAnimationFrame = (callback: FrameRequestCallback) => callback(0);
  app.CRONOX_SECURITY = { productImageUrl: (value: string) => value };
  if (getProducts) app.CRONOX_API = { getProducts };
  app.eval(script);
  const names = () =>
    Array.from(dom.window.document.querySelectorAll('.product-name')).map(
      (node) => node.textContent,
    );
  return { app, dom, names };
}

describe('storefront catalog recovery', () => {
  jest.setTimeout(15000);
  let warning: jest.SpyInstance;
  beforeEach(() => {
    warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warning.mockRestore());

  it('does not seed the product page with local T-shirts', () => {
    expect(productHtml).not.toMatch(
      /Grey Core Tee|Black Core Tee|getFallbackProducts/,
    );
  });

  it('still loads shared catalog on cart pages while leaving PDP to its own loader', async () => {
    for (const [url, shouldLoad] of [
      ['http://localhost:3000/cart.html', true],
      ['http://localhost:3000/producto.html', false],
    ] as const) {
      const dom = new JSDOM('', { url, runScripts: 'outside-only' });
      const app = dom.window as any;
      const getProducts = jest.fn().mockResolvedValue([item('Shared', 1)]);
      app.CRONOX_API = { getProducts };
      app.eval(script);
      await app.CRONOX_catalogReady;
      expect(getProducts).toHaveBeenCalledTimes(shouldLoad ? 1 : 0);
      if (shouldLoad) expect(app.CRONOX_PRODUCTS).toHaveLength(1);
      dom.window.close();
    }
  });

  it('renders the full authoritative sequence', async () => {
    const { app, dom, names } = open(
      jest
        .fn()
        .mockResolvedValue([
          item('First', 1),
          item('Second', 2),
          item('Third', 3),
        ]),
    );
    await app.CRONOX_catalogReady;
    expect(names()).toEqual(['First', 'Second', 'Third']);
    dom.window.close();
  });

  it.each([
    ['network rejection', () => Promise.reject(new Error('offline'))],
    [
      '5xx',
      () =>
        Promise.reject(Object.assign(new Error('temporary'), { status: 503 })),
    ],
    ['malformed', () => Promise.resolve({ invalid: true })],
    ['empty', () => Promise.resolve([])],
  ])(
    'does not show local products or AGOTADO after %s',
    async (_label, response) => {
      const { app, dom, names } = open(jest.fn().mockImplementation(response));
      await app.CRONOX_catalogReady;
      expect(names()).toEqual([]);
      expect(app.CRONOX_PRODUCTS).toEqual([]);
      expect(dom.window.document.body.textContent).not.toMatch(
        /Grey Core Tee|Black Core Tee|AGOTADO/,
      );
      dom.window.close();
    },
  );

  it('retries a transient error and replaces loading with real products', async () => {
    const getProducts = jest
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('temporary'), { status: 503 }),
      )
      .mockResolvedValueOnce([item('Recovered', 1)]);
    const { app, dom, names } = open(getProducts);
    await app.CRONOX_catalogReady;
    expect(getProducts).toHaveBeenCalledTimes(2);
    expect(names()).toEqual(['Recovered']);
    expect(warning).toHaveBeenCalledWith(
      '[CRONOX] catalog_load_failed kind=server attempt=1',
    );
    dom.window.close();
  });

  it('shows a neutral error and lets the customer retry only the catalog', async () => {
    const getProducts = jest
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([item('Available', 1)]);
    const { app, dom, names } = open(getProducts);
    await app.CRONOX_catalogReady;
    expect(
      dom.window.document.getElementById('productsFallback')?.textContent,
    ).toContain('No hemos podido cargar los productos.');
    const retry = dom.window.document.querySelector<HTMLButtonElement>(
      '#productsFallback button',
    )!;
    retry.click();
    await app.CRONOX_reloadCatalog();
    expect(names()).toEqual(['Available']);
    expect(getProducts).toHaveBeenCalledTimes(4);
    dom.window.close();
  });

  it('keeps a valid catalog after a failed refresh', async () => {
    const getProducts = jest
      .fn()
      .mockResolvedValueOnce([item('Valid', 1)])
      .mockResolvedValueOnce({ invalid: true });
    const { app, dom, names } = open(getProducts);
    await app.CRONOX_catalogReady;
    await app.CRONOX_reloadCatalog();
    expect(names()).toEqual(['Valid']);
    dom.window.close();
  });

  it('ignores a slower home response after a newer search result', async () => {
    let resolveHome!: (value: unknown[]) => void;
    const home = new Promise<unknown[]>((resolve) => {
      resolveHome = resolve;
    });
    const { app, dom, names } = open(jest.fn().mockReturnValue(home));
    app.CRONOX_API.getProductsPage = jest.fn().mockResolvedValue({
      products: [item('Newer', 2)],
      meta: { pageCount: 1 },
    });
    await app.CRONOX_handleStoreSearch('newer');
    resolveHome([item('Older', 1)]);
    await app.CRONOX_catalogReady;
    expect(names()).toEqual(['Newer']);
    dom.window.close();
  });

  it('recovers when the API client becomes available later', async () => {
    const { app, dom, names } = open();
    await app.CRONOX_catalogReady;
    app.CRONOX_API = {
      getProducts: jest.fn().mockResolvedValue([item('Live', 1)]),
    };
    await app.CRONOX_reloadCatalog();
    expect(names()).toEqual(['Live']);
    dom.window.close();
  });

  it('bounds a stalled request with a timeout', async () => {
    const { app, dom, names } = open(
      jest.fn(() => new Promise(() => undefined)),
    );
    const original = app.setTimeout.bind(app);
    app.setTimeout = (callback: TimerHandler, delay?: number) =>
      Number(original(callback, delay === 8000 ? 1 : delay));
    await app.CRONOX_catalogReady;
    expect(names()).toEqual([]);
    expect(warning).toHaveBeenCalledWith(
      '[CRONOX] catalog_load_failed kind=timeout attempt=3',
    );
    dom.window.close();
  });
});
