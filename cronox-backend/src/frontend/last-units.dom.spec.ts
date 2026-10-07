import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hasLastUnits, productStockStatus } from '../common/stock-status';

const root = join(__dirname, '../../../cronox-front');
describe('product last units', () => {
  it.each([[6, false], [5, true], [1, true], [0, false]])('threshold 5, stock %s', (stock, expected) => {
    expect(hasLastUnits([{ stockQty: stock }], 5)).toBe(expected);
  });
  it.each([null, undefined, 0, -1, 1.5, '5', NaN])('disables invalid/empty threshold %s', threshold => {
    expect(hasLastUnits([{ stockQty: 1 }], threshold)).toBe(false);
  });
  it('sums sellable sizes, excluding inactive/unavailable variants', () => {
    const variants = [{ stockQty: 2 }, { stock: 3 }, { stockQty: 50, isActive: false }, { stockQty: 50, isAvailable: false }];
    expect(hasLastUnits(variants, 5)).toBe(true);
    expect(hasLastUnits([...variants, { stockQty: 1 }], 5)).toBe(false);
    expect(hasLastUnits([{ stockQty: 1 }, {}], 5)).toBe(false);
  });
  it.each([null, 0, 5])('confirmed zero is exhausted even with threshold %s', threshold => {
    expect(productStockStatus([{ stockQty: 0 }, { stockQty: 0 }], threshold)).toBe('out_of_stock');
    expect(productStockStatus([{ stockQty: 1 }, { stockQty: 0 }], threshold)).not.toBe('out_of_stock');
  });
  it('does not infer exhaustion from missing data or count inactive stock', () => {
    expect(productStockStatus(undefined, 5)).toBe('unknown');
    expect(productStockStatus([{ stockQty: 1 }, {}], 5)).toBe('unknown');
    expect(productStockStatus([{ stockQty: 0 }, { stockQty: 50, isActive: false }], 5)).toBe('out_of_stock');
  });
  it('refreshes the shared decoration without duplicate badges or price rows', () => {
    const dom = new JSDOM('<a href="/producto/qa"><div class="product-media"></div><p class="product-price">10 €</p></a>', { runScripts: 'outside-only', url: 'http://localhost' });
    dom.window.eval(readFileSync(join(root, 'assets/api.js'), 'utf8'));
    const card = dom.window.document.querySelector('a')!;
    const price = card.querySelector<HTMLElement>('.product-price')!;
    const stock = (dom.window as unknown as { CRONOX_STOCK: { decorateCard: (card: Element, price: Element, product: unknown) => void } }).CRONOX_STOCK;
    for (const [qty, threshold, visible] of [[5, 5, true], [6, 5, false], [1, 5, true], [1, 0, false], [0, 5, true], [5, 5, true], [5, null, false]]) {
      stock.decorateCard(card, price, { lastUnitsThreshold: threshold, variants: [{ stockQty: qty }] });
      expect(card.querySelectorAll('.product-last-units')).toHaveLength(visible ? 1 : 0);
      expect(card.querySelectorAll('.product-card__price-row')).toHaveLength(1);
      expect(price.parentElement?.children).toHaveLength(1);
      expect(card.getAttribute('href')).toBe('/producto/qa');
      if (visible) {
        expect(card.querySelector('.product-last-units')?.textContent).toBe(qty === 0 ? 'AGOTADO' : 'ÚLTIMAS UNIDADES');
        expect(card.querySelectorAll('.product-last-units__dot')).toHaveLength(qty === 0 ? 0 : 1);
        if (qty !== 0) expect(card.querySelector('.product-last-units__dot')?.getAttribute('aria-hidden')).toBe('true');
      }
    }
    dom.window.close();
  });
  it.each([
    [6, 5, ''], [5, 5, 'Últimas unidades'], [1, 5, 'Últimas unidades'],
    [0, 5, 'Agotado'], [1, null, ''], [1, 0, ''], [0, null, 'Agotado'], [0, 0, 'Agotado'],
  ])('purchase warning for stock %s and threshold %s stays inline', (qty, threshold, text) => {
    const dom = new JSDOM('<div><p id="price">10 €</p><button>Añadir al carrito</button></div>', { runScripts: 'outside-only', url: 'http://localhost' });
    dom.window.eval(readFileSync(join(root, 'assets/api.js'), 'utf8'));
    const price = dom.window.document.getElementById('price')!;
    const button = dom.window.document.querySelector('button')!;
    const stock = (dom.window as unknown as { CRONOX_STOCK: { decoratePurchase: (price: Element, button: Element, product: unknown) => void } }).CRONOX_STOCK;
    stock.decoratePurchase(price, button, { lastUnitsThreshold: threshold, variants: [{ stockQty: qty }, { stockQty: 0 }] });
    const label = price.parentElement?.querySelector('.stock-status');
    expect(label?.textContent ?? '').toBe(text);
    expect(label?.querySelectorAll('.product-last-units__dot').length ?? 0).toBe(text && qty > 0 ? 1 : 0);
    expect(button.disabled).toBe(qty === 0);
    expect(price.parentElement?.className).toBe('stock-price-row');
    dom.window.close();
  });
});
