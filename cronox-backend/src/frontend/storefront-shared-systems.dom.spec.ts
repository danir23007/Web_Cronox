import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../../cronox-front');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

describe('shared storefront systems', () => {
  it('routes cart outfit suggestions through the shared Quick Add', () => {
    const app = read('assets/app.js');
    const products = read('assets/products.js');
    expect(products).toContain(
      'window.CRONOX_openQuickAdd = function(product)',
    );
    expect(app).toContain('window.CRONOX_openQuickAdd(product)');
    expect(app).not.toContain('openUpsellSelector');
    expect(app).not.toContain('addUpsellSize');
    expect(app).not.toContain('fetchFreshUpsellProduct');
    expect(app).toContain('class="cart-upsell__add"');
    expect(app).toContain('<span>Añadir</span>');
    expect(app).toContain('class="cart-upsell__add-icon"');
  });

  it.each([
    'index.html',
    'producto.html',
    'favorites.html',
    'profile.html',
    'cart.html',
  ])('%s loads the complete shared Quick Add surface', (page) => {
    const html = read(page);
    expect(html).toContain('assets/quick-add.css?v=6');
    expect(html).toContain('assets/products.js?v=59');
    expect(html).toContain(
      `assets/app.js?v=${page === 'index.html' ? 71 : 70}`,
    );
  });

  it('places each cart price below its product name and before size and quantity', () => {
    const app = read('assets/app.js');
    const cartItem = app.slice(
      app.indexOf("article.className = 'cart-line'"),
      app.indexOf(
        'window.CRONOX_IMAGES?.applyProduct',
        app.indexOf("article.className = 'cart-line'"),
      ),
    );
    expect(cartItem.indexOf('cart-line__name')).toBeGreaterThan(-1);
    expect(cartItem.indexOf('cart-line__price')).toBeGreaterThan(
      cartItem.indexOf('cart-line__name'),
    );
    expect(cartItem.indexOf('cart-line__meta')).toBeGreaterThan(
      cartItem.indexOf('cart-line__price'),
    );
    expect(cartItem.indexOf('cart-qty')).toBeGreaterThan(
      cartItem.indexOf('cart-line__meta'),
    );
  });

  it('keeps one authoritative favorites mutation manager and shared cards', () => {
    const bridge = read('assets/favorites-toggle.js');
    const favorites = read('assets/favorites.js');
    const profile = read('assets/profile.js');
    expect(bridge).not.toContain('fetch(');
    expect(bridge).toContain('CRONOX_FAVORITES?.toggleFromButton?.(button)');
    expect(bridge).toContain("button.dataset.favBound === '1'");
    expect(favorites).toContain(
      'const cardBuilder = window.CRONOX_createProductCard',
    );
    expect(profile).toContain(
      'const cardBuilder = window.CRONOX_createProductCard',
    );
    expect(profile).toContain(
      'window.CRONOX_FAVORITES.setIdsFromServer(mapped)',
    );
    expect(read('assets/store.css')).not.toContain(
      '.page-favorites #favorites-grid .product-media',
    );
  });
});
