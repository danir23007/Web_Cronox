import { MAX_MANUAL_CENTS, parseManualPrice } from '../../../cronox-front/src/admin/manual-purchase-money';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const frontendRoot = path.resolve(__dirname, '../../../cronox-front');

describe('admin in-person purchase workflow', () => {
  const html = readFileSync(path.join(frontendRoot, 'admin-user.html'), 'utf8');
  const source = readFileSync(path.join(frontendRoot, 'src/admin/admin-user.ts'), 'utf8');

  it('requires an explicit stock decision and a review before confirmation', () => {
    const document = new JSDOM(html).window.document;
    const stock = document.querySelector<HTMLSelectElement>('#manualStockHandling');

    expect(stock?.required).toBe(true);
    expect([...stock!.options].map((option) => option.value)).toEqual([
      'DEDUCT_NOW',
      'ALREADY_ADJUSTED',
    ]);
    expect(document.querySelector('#manualPurchaseReview')?.hasAttribute('hidden')).toBe(true);
    expect(document.querySelector('#manualPurchaseConfirmActions')?.hasAttribute('hidden')).toBe(true);
    expect(source).toContain('manualPurchaseIdempotencyKey = crypto.randomUUID()');
    expect(source).toContain("currentUser.role === 'SUPERADMIN'");
  });

  it('offers correction by voiding instead of editing counters or order lines', () => {
    expect(source).toContain("order.source === 'IN_PERSON_ADMIN' && order.status === 'PAID'");
    expect(source).toContain('voidInPersonPurchase(orderId, reason.trim())');
    expect(source).not.toContain('articulosAdquiridos:');
    expect(source).not.toContain('productosDiferentes:');
  });
});

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
async function setupPurchase() {
  const dom = new JSDOM(readFileSync(path.join(frontendRoot, 'admin-user.html'), 'utf8'), { runScripts: 'outside-only', url: 'https://local.test/admin-user.html?id=7&uid=test-user' });
  const w = dom.window as any;
  w.CRONOX_ADMIN_AUTH = { isAdmin: () => true };
  const create = jest.fn().mockRejectedValue(new Error('Connection lost'));
  w.CRONOX_API = { formatPrice: (value: number) => value.toFixed(2).replace('.', ',') + ' EUR', getMe: async () => ({ id: 99, role: 'SUPERADMIN' }), admin: {
    getInPersonPurchaseOptions: async () => ({ products: [{ name: 'Camiseta', price: 2500, variants: [{ id: 5, size: 'M', price: null }, { id: 6, size: 'L', price: 3000 }] }] }), createInPersonPurchase: create,
  } };
  w.eval(readFileSync(path.join(frontendRoot, 'assets/admin-user.js'), 'utf8'));
  await flush();
  const d = w.document;
  d.querySelector('#toggleManualPurchase').click(); await flush();
  const change = (selector: string, value: string, event = 'input') => {
    const field = d.querySelector(selector); field.value = value; field.dispatchEvent(new w.Event(event, { bubbles: true }));
  };
  change('[data-manual-variant]', '5', 'change');
  const review = () => d.querySelector('#reviewManualPurchase').click();
  const submit = () => d.querySelector('#manualPurchaseForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  return { dom, w, d, create, change, review, submit };
}
describe('paid unit price interactions', () => {
  it('defaults on article changes and preserves edits on quantity changes', async () => {
    const { d, change, review } = await setupPurchase();
    expect(d.querySelector('[data-manual-price]').value).toBe('25.00');
    change('[data-manual-price]', '25,50'); change('[data-manual-quantity]', '2');
    expect(d.querySelector('[data-manual-price]').value).toBe('25,50'); review();
    expect(d.querySelector('#manualPurchaseReview').textContent).toContain('25,50');
    expect(d.querySelector('#manualPurchaseReview').textContent).toContain('51,00');
    change('[data-manual-variant]', '6', 'change');
    expect(d.querySelector('[data-manual-price]').value).toBe('30.00');
    expect(d.querySelector('#manualPurchaseConfirmActions').hidden).toBe(true);
  });
  it.each(['0', '10,50', '50.25'])('sends edited price %s in cents', async (price) => {
    const { create, change, review, submit } = await setupPurchase();
    change('[data-manual-price]', price); change('[data-manual-quantity]', '2'); review(); submit(); await flush();
    expect(create.mock.calls[0][1].items[0]).toEqual({ variantId: 5, quantity: 2, unitPriceCents: price === '0' ? 0 : price === '10,50' ? 1050 : 5025 });
  });
  it.each(['', '-1', 'NaN', 'Infinity', '1.234', '1,2.3', '1e2', '99999999999999', ' 0 ', '.50'])('blocks invalid price %s', async (price) => {
    const { d, create, change, review, submit } = await setupPurchase();
    change('[data-manual-price]', price); review(); submit(); await flush();
    expect(d.querySelector('#manualPurchaseConfirmActions').hidden).toBe(true); expect(create).not.toHaveBeenCalled();
  });
  it('preserves duplicate variants with separate prices', async () => {
    const { d, create, change, review, submit, w } = await setupPurchase();
    change('[data-manual-price]', '10.50'); d.querySelector('#addManualPurchaseItem').click();
    const second = d.querySelectorAll('.manual-purchase-item')[1];
    second.querySelector('[data-manual-variant]').value = '5';
    second.querySelector('[data-manual-variant]').dispatchEvent(new w.Event('change', { bubbles: true }));
    second.querySelector('[data-manual-price]').value = '0'; review(); submit(); await flush();
    expect(create.mock.calls[0][1].items.map((item: any) => item.unitPriceCents)).toEqual([1050, 0]);
  });
  it('blocks double submit, retains failed retry keys and invalidates edits', async () => {
    const { d, create, change, review, submit } = await setupPurchase();
    review(); submit(); submit(); expect(create).toHaveBeenCalledTimes(1);
    await flush(); review(); submit(); await flush(); expect(create.mock.calls[1][2]).toBe(create.mock.calls[0][2]);
    change('[data-manual-price]', '1'); submit(); expect(create).toHaveBeenCalledTimes(2);
    expect(d.querySelector('#manualPurchaseReview').hidden).toBe(true);
    review(); submit(); await flush(); expect(create.mock.calls[2][2]).not.toBe(create.mock.calls[0][2]);
  });
  it('detects changes without input events at submission', async () => {
    const { d, create, review, submit } = await setupPurchase();
    review(); d.querySelector('[data-manual-price]').value = '1'; submit(); await flush();
    expect(create).not.toHaveBeenCalled(); expect(d.querySelector('#manualPurchaseConfirmActions').hidden).toBe(true);
  });
});

describe('integer cents parsing', () => {
  it.each(['25,50', '25.50', '25,5'])('parses %s without fractional arithmetic', value => {
    expect(parseManualPrice(value)).toBe(2550);
  });
  it('accepts the exact Decimal limit and rejects overflows', () => {
    expect(parseManualPrice('9999999999.99')).toBe(MAX_MANUAL_CENTS);
    expect(() => parseManualPrice('10000000000')).toThrow();
    expect(() => parseManualPrice('9'.repeat(400))).toThrow();
  });
  it.each(['0\n', '0\r', '0 ', ' 0', '1,234', '-0', 'Infinity', 'NaN', ''])('rejects the entire invalid string %s', value => {
    expect(() => parseManualPrice(value)).toThrow();
  });
});
