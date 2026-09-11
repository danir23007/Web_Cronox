import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (file: string) =>
  readFileSync(join(__dirname, '../../../cronox-front', file), 'utf8');
type SurfaceWindow = {
  CRONOX_API: Record<string, unknown>;
  CRONOX_PRODUCTS: unknown[];
  CRONOX_createProductCard: (product: unknown) => HTMLElement;
};

describe('PDP and quick-add stock presentation', () => {
  it.each(['pdp', 'quick-add'])(
    '%s uses shared state and guards exhausted activation',
    async (surface) => {
      const dom = new JSDOM(
        '<p id="pPrice"></p><div id="pSizeGroup"></div><button id="pAdd">Añadir al carrito</button>',
        {
          url: 'http://localhost/producto.html?slug=core',
          runScripts: 'outside-only',
          pretendToBeVisual: true,
        },
      );
      const win = dom.window;
      win.scrollTo = () => {};
      win.eval(read('assets/api.js'));
      const app = win as unknown as SurfaceWindow;
      const product = (stock: number) => {
        const variant = { id: 10, size: 'M', stockQty: stock, isActive: true };
        return {
          id: 'core',
          slug: 'core',
          name: 'Core',
          price: 34.95,
          sizes: ['M'],
          variants: [variant],
          variantMap: { M: variant },
        };
      };
      app.CRONOX_API.getProducts = () => Promise.resolve([]);
      app.CRONOX_API.getFallbackProducts = () => [];
      let additions = 0;
      win.addEventListener('cronox:addToCart', () => additions++);
      if (surface === 'quick-add') win.eval(read('assets/products.js'));
      for (const stock of [14, 0, 15]) {
        const data = product(stock);
        if (surface === 'quick-add') {
          const card = app.CRONOX_createProductCard(data);
          win.document.body.appendChild(card);
          (card.querySelector('.fav-add') as HTMLElement).click();
        } else {
          app.CRONOX_PRODUCTS = [data];
          app.CRONOX_API.getProducts = () => Promise.resolve([data]);
          // Re-load the page script against freshly loaded product data and a fresh CTA.
          const previous = win.document.getElementById('pAdd')!;
          previous.replaceWith(previous.cloneNode(true));
          win.eval(read('assets/product-page.js'));
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        const price = win.document.getElementById(
          surface === 'pdp' ? 'pPrice' : 'qaPrice',
        )!;
        const button = win.document.getElementById(
          surface === 'pdp' ? 'pAdd' : 'qaAdd',
        ) as HTMLButtonElement;
        const label = price.parentElement!.querySelector('.stock-status');
        expect(price.parentElement!.className).toBe('stock-price-row');
        expect(label?.textContent ?? '').toBe(
          stock === 0 ? 'AGOTADO' : stock < 15 ? 'ÚLTIMAS TALLAS' : '',
        );
        expect(label?.className ?? '').toBe(
          stock === 0
            ? 'stock-status stock-status--out'
            : stock < 15
              ? 'stock-status stock-status--low'
              : '',
        );
        expect(price.classList.contains('price--out-of-stock')).toBe(
          stock === 0,
        );
        expect(button.disabled).toBe(stock === 0);
        expect(button.getAttribute('aria-disabled')).toBe(String(stock === 0));
        if (stock === 0) {
          expect(button.textContent).toBe('AGOTADO');
          const before = additions;
          button.click();
          button.dispatchEvent(
            new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
          );
          button.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
          expect(additions).toBe(before);
          expect(button.textContent).toBe('AGOTADO');
        } else {
          const before = additions;
          button.click();
          expect(additions).toBe(before + 1);
        }
      }
      win.close();
    },
  );
  it('shares amber and wrapping inline styles without changing vertical cards', () => {
    const css = read('assets/store.css');
    expect(css).toMatch(
      /\.stock-price-row\s*\{[^}]*display:flex;[^}]*align-items:center;[^}]*flex-wrap:wrap;[^}]*gap:4px 12px/,
    );
    expect(css).toContain(
      '.stock-status--low { color:var(--stock-low-warning); }',
    );
    expect(css).toContain('.stock-status--out { color:#ff6464; }');
    expect(css).toContain(
      '.price--out-of-stock { text-decoration:line-through; opacity:.55; }',
    );
    expect(read('src/admin/api.ts')).not.toMatch(/pocas unidades|sin stock/i);
  });
});
