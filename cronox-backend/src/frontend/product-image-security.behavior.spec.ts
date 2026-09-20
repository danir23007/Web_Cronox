import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const frontendRoot = path.resolve(__dirname, '../../../cronox-front');
const apiBundle = readFileSync(
  path.join(frontendRoot, 'assets/api.js'),
  'utf8',
);

describe('product image URL security', () => {
  it('accepts public Supabase originals and derivative paths without widening trust', () => {
    const dom = new JSDOM('<!doctype html>', {
      url: 'https://shop.cronox.test/tienda',
      runScripts: 'outside-only',
    });
    (dom.window as any).fetch = jest.fn();
    dom.window.eval(apiBundle);
    const productImageUrl = (dom.window as any).CRONOX_SECURITY.productImageUrl;
    const original =
      'https://tenant.supabase.co/storage/v1/object/public/products/catalog/item.jpg?width=900';
    const derivative =
      'https://tenant.supabase.co/storage/v1/object/public/products/products/variants/0123456789abcdef/card.webp?v=1';

    expect(productImageUrl(original)).toBe(original);
    expect(productImageUrl(derivative)).toBe(derivative);
    expect(
      productImageUrl(
        'http://tenant.supabase.co/storage/v1/object/public/products/item.jpg',
      ),
    ).toBe('');
    expect(
      productImageUrl(
        'https://tenant.supabase.co.evil.test/storage/v1/object/public/products/item.jpg',
      ),
    ).toBe('');
    expect(productImageUrl('https://user:secret@tenant.supabase.co/file')).toBe(
      '',
    );
  });
});
