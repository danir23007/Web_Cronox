import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const frontendRoot = path.resolve(__dirname, '../../../cronox-front');

describe('responsive storefront image delivery', () => {
  const read = (file: string) =>
    readFileSync(path.join(frontendRoot, file), 'utf8');

  it('centralizes context roles, responsive sizes and original fallback', () => {
    const source = read('assets/responsive-images.js');
    expect(source).toContain('card: { roles: ["card"]');
    expect(source).toContain('quick: { roles: ["quick"]');
    expect(source).toContain('pdp: { roles: ["pdp"]');
    expect(source).toContain('small: { roles: ["small"]');
    expect(source).toContain('galleryGrid: { roles: ["grid"]');
    expect(source).toContain('galleryLarge: { roles: ["large"]');
    expect(source).toContain('roles: ["mobile", "tablet", "desktop"]');
    expect(source).toContain('preferred?.url || fallback');
    expect(source).toContain('element.srcset = resolved.srcset');
  });

  it('does not rewrite responsive source attributes when framing is reapplied', () => {
    const dom = new JSDOM('<img>', {
      url: 'https://cronox.test/',
      runScripts: 'outside-only',
    });
    Object.assign(dom.window, {
      CRONOX_SECURITY: { productImageUrl: (value: string) => value },
    });
    dom.window.eval(read('assets/responsive-images.js'));
    const image = dom.window.document.querySelector('img')!;
    const record = {
      url: 'https://storage.test/original.png',
      variants: {
        mobile: { url: 'https://storage.test/mobile.webp', width: 1600 },
        tablet: { url: 'https://storage.test/tablet.webp', width: 2200 },
        desktop: { url: 'https://storage.test/desktop.webp', width: 3000 },
      },
    };
    const api = (
      dom.window as unknown as {
        CRONOX_IMAGES: {
          apply: (
            image: HTMLImageElement,
            record: typeof record,
            context: string,
          ) => unknown;
        };
      }
    ).CRONOX_IMAGES;
    api.apply(image, record, 'hero');
    const observer = new dom.window.MutationObserver(() => undefined);
    observer.observe(image, {
      attributes: true,
      attributeFilter: ['src', 'srcset', 'sizes'],
    });

    api.apply(image, record, 'hero');

    expect(observer.takeRecords()).toEqual([]);
    observer.disconnect();
    dom.window.close();
  });

  it('uses the correct derivative at each storefront call site', () => {
    expect(read('assets/products.js')).toContain(
      'CRONOX_IMAGES.apply(im, record, "card")',
    );
    expect(read('assets/products.js')).toContain('"quick")');
    expect(read('assets/product-page.js')).toContain('resolve(item, "pdp")');
    expect(read('assets/product-page.js')).toContain('resolve(item, "small")');
    expect(read('assets/app.js')).toContain('applyProduct(');
    expect(read('assets/app.js')).toContain('"cart"');
    expect(read('assets/checkout.js')).toContain("'checkout'");
    expect(read('assets/gallery.js')).toContain('"galleryGrid"');
    expect(read('assets/gallery.js')).toContain('"galleryLarge"');
  });

  it('prioritizes the image hero and lazy-loads off-screen gallery media', () => {
    const media = read('assets/media-framing.js');
    const gallery = read('assets/gallery.js');
    expect(media).toContain('fetchPriority: "high"');
    expect(media).toContain('loading: "eager"');
    expect(gallery).toContain('image.loading = "lazy"');
  });

  it('does not add white image canvases or padding in shopping contexts', () => {
    const store = read('assets/store.css');
    const checkout = read('assets/checkout.css');
    const quick = read('assets/quick-add.css');
    expect(store).toMatch(
      /\.cart-line__image-frame[\s\S]*?background: transparent;[\s\S]*?padding: 0;/,
    );
    expect(store).toMatch(
      /\.cart-upsell__image-frame[\s\S]*?background: transparent;[\s\S]*?padding: 0;/,
    );
    expect(checkout).toMatch(
      /\.checkout-item__media[\s\S]*?padding: 0;[\s\S]*?background: transparent;/,
    );
    expect(checkout).toMatch(
      /\.checkout-recommendation__image[\s\S]*?padding: 0;[\s\S]*?background: transparent;/,
    );
    expect(quick).toMatch(/\.qa-media img[\s\S]*?background:transparent;/);
  });
});
