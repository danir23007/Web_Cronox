import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const frontendRoot = path.resolve(__dirname, '../../../cronox-front');
const source = readFileSync(
  path.join(frontendRoot, 'assets/responsive-images.js'),
  'utf8',
);

const createRuntime = () => {
  const dom = new JSDOM('<!doctype html><img id="product">', {
    url: 'https://cronox.test/tienda',
    runScripts: 'outside-only',
  });
  (dom.window as any).CRONOX_SECURITY = {
    productImageUrl: (value: unknown, fallback = '') =>
      typeof value === 'string' && /^(?:https?:\/\/|assets\/)/.test(value)
        ? value
        : fallback,
  };
  dom.window.eval(source);
  return dom;
};

describe('canonical product image resolver', () => {
  it('uses variant metadata, then the original, then later real images', () => {
    const dom = createRuntime();
    const images = (dom.window as any).CRONOX_IMAGES;
    const product = {
      imageUrl: 'assets/logo_browser.png',
      imageRecords: [],
      images: [
        {
          url: 'https://cdn.test/original-a.jpg',
          isPrimary: true,
          variants: {
            card: { url: 'https://cdn.test/card-a.webp', width: 640 },
          },
        },
        { url: 'https://cdn.test/original-b.jpg' },
      ],
    };

    expect(images.resolveProduct(product, 'card').candidates).toEqual([
      'https://cdn.test/card-a.webp',
      'https://cdn.test/original-a.jpg',
      'https://cdn.test/original-b.jpg',
      'assets/logo_browser.png',
    ]);
  });

  it('understands nested cart shapes and ignores object coercion', () => {
    const dom = createRuntime();
    const images = (dom.window as any).CRONOX_IMAGES;
    const item = {
      image: { unexpected: true },
      variant: {
        product: {
          images: [{ url: 'https://cdn.test/cart.jpg' }],
        },
      },
    };

    expect(images.resolveProduct(item, 'cart').src).toBe(
      'https://cdn.test/cart.jpg',
    );
    expect(images.originalUrl({ unexpected: true })).toBe('');
  });

  it('rotates through every real candidate before the logo on load errors', () => {
    const dom = createRuntime();
    const images = (dom.window as any).CRONOX_IMAGES;
    const element = dom.window.document.querySelector(
      'img',
    ) as HTMLImageElement;
    images.applyProduct(
      element,
      {
        images: [
          {
            url: 'https://cdn.test/original.jpg',
            variants: { small: { url: 'https://cdn.test/small.webp' } },
          },
          { url: 'https://cdn.test/secondary.jpg' },
        ],
      },
      'cart',
    );

    expect(element.src).toBe('https://cdn.test/small.webp');
    element.onerror?.(new dom.window.Event('error') as any);
    expect(element.src).toBe('https://cdn.test/original.jpg');
    element.onerror?.(new dom.window.Event('error') as any);
    expect(element.src).toBe('https://cdn.test/secondary.jpg');
    element.onerror?.(new dom.window.Event('error') as any);
    expect(element.src).toBe('https://cronox.test/assets/logo_browser.png');
    expect(element.onerror).toBeNull();
  });
});
