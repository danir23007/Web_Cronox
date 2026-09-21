import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const frontendRoot = path.resolve(__dirname, '../../../cronox-front');
const readFrontend = (file: string) =>
  readFileSync(path.join(frontendRoot, file), 'utf8');

const productHtml = readFrontend('producto.html');
const productStyles = readFrontend('assets/product-page.css');
const storeStyles = readFrontend('assets/store.css');
const productsScript = readFrontend('assets/products.js');

type ProductTestWindow = {
  CRONOX_API: { getFallbackProducts: () => unknown[] };
  CRONOX_SECURITY: {
    productImageUrl: (value: string, fallback: string) => string;
  };
  CRONOX_catalogReady: Promise<unknown>;
  CRONOX_createProductCard: (
    product: Record<string, unknown>,
  ) => HTMLAnchorElement;
  eval: (source: string) => void;
};

const cssRule = (source: string, selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] || '';
};

describe('PDP recommended-product cards', () => {
  it('inherits the normal shared product-card enclosure and focus treatment', () => {
    expect(productStyles).not.toMatch(/^\.product-card\s*\{/m);
    expect(productStyles).not.toContain('.pdp-related .product-card');
    expect(storeStyles).toMatch(
      /\.product-card\{[^}]*border:1px solid #000;[^}]*box-shadow:0 6px 18px/s,
    );
  });

  it('keeps a neutral contained image panel and responsive recommendation grid', () => {
    expect(productStyles).not.toContain('.pdp-related .product-img');
    expect(productHtml).not.toMatch(/\.pdp-related \.products-grid\s*\{/);
    expect(productStyles).not.toMatch(/(^|\n)\.products-grid\s*\{/);
    expect(storeStyles).toMatch(
      /\.products-grid\{[^}]*grid-template-columns:repeat\(5,minmax\(0,1fr\)\);[^}]*width:100%;[^}]*max-width:none;/,
    );
    expect(storeStyles).toMatch(
      /@media \(max-width:1280px\)\{\s*\.products-grid\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\);\}/,
    );
    expect(storeStyles).toMatch(
      /@media \(max-width:640px\)\{\s*\.products-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\);\}/,
    );
  });

  it('keeps product details beneath the image, links functional, and carousel arrows working', async () => {
    const dom = new JSDOM(
      '<!doctype html><section class="pdp-related"><div id="relatedGrid"></div></section>',
      {
        runScripts: 'outside-only',
        url: 'http://localhost:3000/producto.html?slug=current-product',
      },
    );
    const productWindow = dom.window as unknown as ProductTestWindow;
    productWindow.CRONOX_API = { getFallbackProducts: () => [] };
    productWindow.CRONOX_SECURITY = {
      productImageUrl: (value: string, fallback: string) => value || fallback,
    };
    productWindow.eval(productsScript);
    await productWindow.CRONOX_catalogReady;

    const card = productWindow.CRONOX_createProductCard({
      id: 2,
      slug: 'recommended-tee',
      name: 'RECOMMENDED TEE',
      price: 34.95,
      priceLabel: '34,95 €',
      images: ['/first.jpg', '/second.jpg'],
    });
    dom.window.document.getElementById('relatedGrid')?.appendChild(card);

    const media = card.querySelector('.product-media')!;
    const info = card.querySelector('.product-card__info')!;
    const name = card.querySelector('.product-name')!;
    const price = card.querySelector('.product-price')!;
    const images = card.querySelectorAll('.product-img');
    const next = card.querySelector<HTMLButtonElement>('.product-arrow.next')!;
    const quickAdd = card.querySelector<HTMLButtonElement>('.fav-add');
    const favorite = card.querySelector<HTMLButtonElement>('.favorite-toggle');

    expect(card.href).toBe('http://localhost:3000/producto/recommended-tee');
    expect(media.nextElementSibling).toBe(info);
    expect(info.firstElementChild).toBe(name);
    expect(name.nextElementSibling).toBe(price);
    expect(name.textContent).toBe('RECOMMENDED TEE');
    expect(price.textContent).toBe('34,95 €');
    expect(images).toHaveLength(2);
    expect(quickAdd?.textContent).toBe('+');
    expect(favorite).not.toBeNull();
    expect(images[0].classList.contains('active')).toBe(true);
    next.click();
    expect(images[0].classList.contains('active')).toBe(false);
    expect(images[1].classList.contains('active')).toBe(true);
    dom.window.close();
  });

  it('loads exactly the incremented PDP stylesheet cache version', () => {
    expect(productHtml).toContain('href="assets/product-page.css?v=8"');
    expect(productHtml).not.toContain('href="assets/product-page.css?v=7"');
  });
});
