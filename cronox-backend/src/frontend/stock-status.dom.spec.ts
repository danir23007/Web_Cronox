import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../../../cronox-front');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('stock status presentation', () => {
  it('uses the shared decoration in standard and both fallback renderers', () => {
    expect(read('assets/products.js')).toContain(
      'CRONOX_STOCK?.decorateCard(a, price, p)',
    );
    expect(read('assets/favorites.js')).toContain(
      'CRONOX_STOCK?.decorateCard(a, price, product)',
    );
    expect(read('assets/profile.js')).toContain(
      'CRONOX_STOCK?.decorateCard(link, priceEl, product)',
    );
  });
  it('centers the vertical information block and keeps distinct, safely wrapping warnings', () => {
    const css = read('assets/store.css');
    expect(css).toMatch(
      /\.product-card--out-of-stock \.product-price\s*\{[^}]*text-decoration:line-through;[^}]*opacity:\.55/,
    );
    expect(css).toMatch(
      /\.product-card__stock-label\s*\{[^}]*text-decoration:none/,
    );
    expect(css).toMatch(
      /\.product-card__price-row\s*\{[^}]*display:flex;[^}]*flex-direction:column;[^}]*align-items:center;[^}]*text-align:center;[^}]*gap:4px/,
    );
    expect(css).toMatch(/--stock-low-warning:#D9A21B/);
    expect(css).toMatch(
      /\.product-card--low-stock \.product-card__stock-label\s*\{[^}]*color:var\(--stock-low-warning\)/,
    );
    expect(css).toMatch(
      /\.product-card__stock-label\s*\{[^}]*max-width:100%;[^}]*overflow-wrap:anywhere;[^}]*color:#ff6464/,
    );
  });
  const setup = () => {
    const dom = new JSDOM(read('admin.html'), {
      url: 'http://localhost',
      runScripts: 'outside-only',
    });
    dom.window.eval(read('assets/api.js'));
    return dom;
  };
  it.each([0, 1, 14, 15, 20])(
    'renders the price and warning for %i units without changing the link',
    (stock) => {
      const dom = setup();
      const { document } = dom.window;
      const card = document.createElement('a');
      card.href = '/producto.html?slug=core';
      const price = document.createElement('p');
      price.className = 'product-price';
      price.textContent = '34,95 €';
      card.append(price);
      (
        dom.window as unknown as {
          CRONOX_STOCK: {
            decorateCard: (a: Element, p: Element, data: unknown) => void;
          };
        }
      ).CRONOX_STOCK.decorateCard(card, price, {
        variants: [{ stockQty: stock, isActive: true }],
      });
      expect(
        card.querySelector('.product-card__stock-label')?.textContent ?? '',
      ).toBe(stock === 0 ? 'AGOTADO' : stock < 15 ? 'ÚLTIMAS TALLAS' : '');
      expect(card.textContent).not.toContain('SIN STOCK');
      expect(price.parentElement?.children.length).toBe(stock < 15 ? 2 : 1);
      expect(price.textContent).toBe('34,95 €');
      expect(card.classList.contains('product-card--out-of-stock')).toBe(
        stock === 0,
      );
      expect(card.getAttribute('href')).toContain('producto.html');
      expect(price.parentElement?.className).toBe('product-card__price-row');
      dom.window.close();
    },
  );
  it('refreshes confirmed admin colour after success and keeps it after failure', async () => {
    const dom = setup();
    const win = dom.window;
    const product = (stock: number) => ({
      id: 1,
      name: 'Core',
      totalStock: stock,
      stockStatus:
        stock === 0 ? 'out_of_stock' : stock < 15 ? 'low' : 'in_stock',
      variantCount: 1,
      variants: [{ id: 10, size: 'M', stockQty: stock, isActive: true }],
    });
    let confirmed = product(15);
    let fail = false;
    Object.assign(
      (win as unknown as { CRONOX_API: { admin: object } }).CRONOX_API.admin,
      {
        listInventory: () => Promise.resolve({ items: [confirmed], meta: {} }),
        getInventorySummary: () => Promise.resolve({}),
        updateInventory: (
          _id: number,
          body: { updates: { stock: number }[] },
        ) => {
          if (fail) return Promise.reject(new Error('Error de prueba'));
          confirmed = product(body.updates[0].stock);
          return Promise.resolve(confirmed);
        },
      },
    );
    win.HTMLElement.prototype.scrollIntoView = () => {};
    (win.console as { error: () => void }).error = () => {};
    win.eval(read('assets/admin-inventory.js'));
    await (
      win as unknown as { CRONOX_INVENTORY: { load: () => Promise<void> } }
    ).CRONOX_INVENTORY.load();
    const card = () => win.document.querySelector('[data-inventory-product]')!;
    expect(card().className).toContain('inventory-product--in-stock');
    (
      win.document.querySelector('[data-toggle-inventory]') as HTMLElement
    ).click();
    for (const [stock, status] of [
      [14, 'low-stock'],
      [0, 'out-of-stock'],
      [15, 'in-stock'],
    ] as const) {
      const input = win.document.querySelector(
        'input[data-inventory-stock]',
      ) as HTMLInputElement;
      input.value = String(stock);
      input.dispatchEvent(new win.Event('input', { bubbles: true }));
      (
        win.document.querySelector('[data-save-inventory]') as HTMLElement
      ).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(card().className).toContain(`inventory-product--${status}`);
    }
    fail = true;
    const input = win.document.querySelector(
      'input[data-inventory-stock]',
    ) as HTMLInputElement;
    input.value = '0';
    input.dispatchEvent(new win.Event('input', { bubbles: true }));
    (
      win.document.querySelector('[data-save-inventory]') as HTMLElement
    ).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(card().className).toContain('inventory-product--in-stock');
    expect(
      (
        win.document.querySelector(
          'input[data-inventory-stock]',
        ) as HTMLInputElement
      ).value,
    ).toBe('0');
    win.close();
  });
});
