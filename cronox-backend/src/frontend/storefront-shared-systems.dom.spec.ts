import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../../cronox-front');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

describe('shared storefront systems', () => {
  it('routes cart outfit suggestions through the shared Quick Add', () => {
    const app = read('assets/app.js');
    const products = read('assets/products.js');
    expect(products).toContain('window.CRONOX_openQuickAdd = function(product)');
    expect(app).toContain("window.CRONOX_openQuickAdd(product)");
    expect(app).not.toContain('openUpsellSelector');
    expect(app).not.toContain('addUpsellSize');
    expect(app).not.toContain('fetchFreshUpsellProduct');
    expect(app).toContain('class="cart-upsell__add"');
  });

  it('keeps one authoritative favorites mutation manager and shared cards', () => {
    const bridge = read('assets/favorites-toggle.js');
    const favorites = read('assets/favorites.js');
    const profile = read('assets/profile.js');
    expect(bridge).not.toContain('fetch(');
    expect(bridge).toContain('CRONOX_FAVORITES?.toggleFromButton?.(button)');
    expect(bridge).toContain("button.dataset.favBound === '1'");
    expect(favorites).toContain('const cardBuilder = window.CRONOX_createProductCard');
    expect(profile).toContain('const cardBuilder = window.CRONOX_createProductCard');
    expect(profile).toContain('window.CRONOX_FAVORITES.setIdsFromServer(mapped)');
    expect(read('assets/store.css')).not.toContain(
      '.page-favorites #favorites-grid .product-media',
    );
  });
});
