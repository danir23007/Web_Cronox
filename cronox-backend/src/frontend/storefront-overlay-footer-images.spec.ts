import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const root = path.resolve(__dirname, '../../../cronox-front');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const storeCss = read('assets/store.css');
const checkoutCss = read('assets/checkout.css');
const app = read('assets/app.js');
const index = read('index.html');

const rule = (css: string, selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  expect(match).not.toBeNull();
  return match?.[1] || '';
};

describe('storefront image, cart and footer corrections', () => {
  it('uses borderless contained Checkout images for order lines and recommendations', () => {
    for (const selector of [
      '.checkout-item__media',
      '.checkout-recommendation__image',
    ]) {
      const css = rule(checkoutCss, selector);
      expect(css).toMatch(/border:\s*0;/);
      expect(css).toMatch(/background:\s*transparent;/);
      expect(css).toMatch(/padding:\s*0;/);
      expect(css).toMatch(/box-shadow:\s*none;/);
      expect(css).toMatch(/outline:\s*none;/);
    }
    expect(rule(checkoutCss, '.checkout-item__media img')).toMatch(
      /object-fit:\s*contain;/,
    );
    expect(rule(checkoutCss, '.checkout-recommendation__image')).toMatch(
      /object-fit:\s*contain;/,
    );
    expect(read('assets/checkout.js')).toContain('checkout-item__qty');
    expect(read('assets/checkout.js')).toContain(
      'checkout-recommendation__action',
    );
    expect(read('assets/checkout.js')).toContain('CRONOX_IMAGES?.applyProduct');
  });

  it('layers the full-viewport cart above topbar, search and filters without changing topbar state', () => {
    expect(rule(storeCss, '.cart-overlay')).toMatch(
      /position:\s*fixed;[\s\S]*inset:\s*0;/,
    );
    expect(rule(storeCss, '.cart-overlay')).toMatch(/z-index:\s*1900;/);
    expect(rule(storeCss, '.cart-drawer')).toMatch(
      /top:\s*0;[\s\S]*height:\s*100dvh;/,
    );
    expect(rule(storeCss, '.cart-drawer')).toMatch(/z-index:\s*1901;/);
    expect(storeCss).not.toContain('.topbar--cart-open');
    expect(storeCss).not.toContain('.cart-open .topbar');
    expect(storeCss).toContain(
      '.topbar--hero .topbar__logo-img,.topbar--page .topbar__logo-img{filter:none;}',
    );
    expect(app).not.toContain("topbar.classList.toggle('topbar--cart-open'");
    expect(app).toContain('setCartBackgroundInert(true)');
    expect(app).toContain('setCartBackgroundInert(false)');
    expect(app).toContain("ev.key === 'Escape'");
    expect(app).toContain("ev.key !== 'Tab'");
    expect(app).toContain('cartReturnFocus');
    expect(app).toContain('cancelAnimationFrame(cartAnimationFrame)');
  });

  it('keeps one natural footer geometry across normal and category/search results', () => {
    const normal = new JSDOM(index, { url: 'http://localhost/tienda' }).window
      .document;
    const category = new JSDOM(index, {
      url: 'http://localhost/tienda?categorySlug=camisetas',
    }).window.document;
    const search = new JSDOM(index, {
      url: 'http://localhost/tienda?search=none',
    }).window.document;
    const markup = (document: Document) =>
      document.querySelector('.site-footer')?.outerHTML;
    expect(markup(normal)).toBe(markup(category));
    expect(markup(normal)).toBe(markup(search));
    expect(storeCss).toContain('html{scrollbar-gutter:stable}');
    expect(rule(storeCss, '.site-footer')).not.toMatch(/(?:min-)?height\s*:/);
    expect(storeCss).not.toMatch(/category-page[^\n{]*\.site-footer/);
  });

  it('underlines only the three section titles on desktop and mobile', () => {
    const document = new JSDOM(index).window.document;
    expect(
      Array.from(document.querySelectorAll('.footer-title')).map(
        (node) => node.textContent,
      ),
    ).toEqual(['SOPORTE', 'COLABORA', 'LEGAL']);
    expect(
      Array.from(document.querySelectorAll('.footer-acc-title')).map(
        (node) => node.textContent,
      ),
    ).toEqual(['SOPORTE', 'COLABORA', 'LEGAL']);
    expect(rule(storeCss, '.footer-title')).toContain(
      'text-decoration: underline',
    );
    expect(rule(storeCss, '.footer-acc-title')).toContain(
      'text-decoration: underline',
    );
    expect(rule(storeCss, '.footer-link')).not.toContain(
      'text-decoration: underline',
    );
    expect(rule(storeCss, '.footer-newsletter-title')).not.toContain(
      'text-decoration: underline',
    );
  });
});
