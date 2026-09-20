import { readFileSync } from 'node:fs';
import path from 'node:path';

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
