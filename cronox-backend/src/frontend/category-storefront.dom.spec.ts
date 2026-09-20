import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const frontendRoot = path.resolve(__dirname, '../../../cronox-front');
const read = (file: string) =>
  readFileSync(path.join(frontendRoot, file), 'utf8');

describe('category storefront chrome', () => {
  const categorySource = read('assets/category-page.js');

  it.each([
    'novedades',
    'camisetas',
    'chaquetas',
    'pantalones',
    'complementos',
  ])('marks %s as an opaque category page before paint', (slug) => {
    const dom = new JSDOM('<!doctype html><html></html>', {
      url: `https://cronox.test/tienda?categorySlug=${slug}#store`,
      runScripts: 'outside-only',
    });
    dom.window.eval(categorySource);
    expect(dom.window.document.documentElement.classList).toContain(
      'category-page',
    );
  });

  it('keeps the existing topbar and locks it in page state', () => {
    const html = read('index.html');
    const app = read('assets/app.js');
    const css = read('assets/store.css');
    const document = new JSDOM(html).window.document;

    expect(document.querySelectorAll('#topbar')).toHaveLength(1);
    expect(html).toContain('assets/category-page.js');
    expect(app).toMatch(
      /classList\.contains\('category-page'\)[\s\S]*?return 'topbar--page'/,
    );
    expect(css).toContain('html.category-page #hero{display:none!important;}');
    expect(css).toContain(
      'html.category-page .store{padding-top:calc(var(--topbar-h) + 24px);}',
    );
  });
});
