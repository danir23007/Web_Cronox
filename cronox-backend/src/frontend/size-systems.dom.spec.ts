import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const frontendRoot = path.resolve(__dirname, '../../../cronox-front');
const read = (file: string) =>
  readFileSync(path.join(frontendRoot, file), 'utf8');

describe('storefront and admin size systems', () => {
  it('shares exact values and semantic labels with every browser surface', () => {
    const dom = new JSDOM('', { runScripts: 'outside-only' });
    dom.window.eval(read('assets/size-systems.js'));
    const sizes = (dom.window as any).CRONOX_SIZES;

    expect(sizes.values('APPAREL')).toEqual(['XS', 'S', 'M', 'L', 'XL', 'XXL']);
    expect(sizes.values('US_RING')).toEqual([
      'US_6',
      'US_7',
      'US_8',
      'US_9',
      'US_10',
      'US_11',
      'US_12',
    ]);
    expect(sizes.label('US_8')).toBe('US 8');
    expect(sizes.values('US_RING')).not.toContain('US_6.5');
  });

  it('loads the helper before API and uses dynamic inventory controls', () => {
    for (const file of [
      'index.html',
      'producto.html',
      'cart.html',
      'checkout.html',
      'favorites.html',
      'profile.html',
      'admin.html',
    ]) {
      const html = read(file);
      expect(html.indexOf('assets/size-systems.js')).toBeGreaterThan(-1);
      expect(html.indexOf('assets/size-systems.js')).toBeLessThan(
        html.indexOf('assets/api.js'),
      );
    }

    const admin = read('admin.html');
    expect(admin).toContain('id="productSizeSystem"');
    expect(admin).toContain('value="US_RING"');
    expect(admin).toContain('id="productVariantStockFields"');
  });
});
