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
    expect(stock?.value).toBe('');
    expect([...stock!.options].map((option) => option.value)).toEqual([
      '',
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
async function setupPurchase(extraApi: Record<string, unknown> = {}) {
  const dom = new JSDOM(readFileSync(path.join(frontendRoot, 'admin-user.html'), 'utf8'), { runScripts: 'outside-only', url: 'https://local.test/admin-user.html?id=7&uid=test-user' });
  const w = dom.window as any;
  w.CRONOX_USER_IDENTITY = { format: (user: any) => String(user.id) };
  w.CRONOX_ADMIN_AUTH = { isAdmin: () => true };
  const create = jest.fn().mockRejectedValue(new Error('Connection lost'));
  w.CRONOX_API = { formatPrice: (value: number) => value.toFixed(2).replace('.', ',') + ' EUR', getMe: async () => ({ id: 99, role: 'SUPERADMIN' }), admin: {
    getInPersonPurchaseOptions: async () => ({ products: [{ name: 'Camiseta', price: 2500, variants: [{ id: 5, size: 'M', price: null }, { id: 6, size: 'L', price: 3000 }] }] }), createInPersonPurchase: create,
    ...extraApi,
  } };
  w.eval(readFileSync(path.join(frontendRoot, 'assets/admin-user.js'), 'utf8'));
  await flush();
  const d = w.document;
  d.querySelector('#toggleManualPurchase').click(); await flush();
  const change = (selector: string, value: string, event = 'input') => {
    const field = d.querySelector(selector); field.value = value; field.dispatchEvent(new w.Event(event, { bubbles: true }));
  };
  change('[data-manual-variant]', '5', 'change');
  change('#manualStockHandling', 'DEDUCT_NOW', 'change');
  const review = () => d.querySelector('#reviewManualPurchase').click();
  const submit = () => d.querySelector('#manualPurchaseForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  return { dom, w, d, create, change, review, submit };
}
describe('required stock handling', () => {
  it('blocks review and direct submission with an inline error and clears it after selection', async () => {
    const { d, change, review, submit, create } = await setupPurchase();
    change('#manualStockHandling', '', 'change');
    review(); submit(); await flush();
    expect(d.querySelector('#manualStockHandlingError').hidden).toBe(false);
    expect(d.querySelector('#manualStockHandlingError').textContent).toBe('Selecciona cómo se debe tratar el stock');
    expect(d.querySelector('#manualPurchaseReview').hidden).toBe(true);
    expect(d.querySelector('#manualPurchaseConfirmActions').hidden).toBe(true);
    expect(create).not.toHaveBeenCalled();
    change('#manualStockHandling', 'ALREADY_ADJUSTED', 'change'); review();
    expect(d.querySelector('#manualStockHandlingError').hidden).toBe(true);
    expect(d.querySelector('#manualPurchaseReview').hidden).toBe(false);
  });
  it.each(['DEDUCT_NOW', 'ALREADY_ADJUSTED'])('preserves %s on returning from review and clears it for a new purchase', async choice => {
    const { d, change, review, submit, create } = await setupPurchase();
    change('#manualStockHandling', choice, 'change'); review();
    d.querySelector('#editManualPurchase').click();
    expect(d.querySelector('#manualStockHandling').value).toBe(choice);
    review(); submit(); await flush();
    expect(create.mock.calls[0][1].stockHandling).toBe(choice);
    d.querySelector('#toggleManualPurchase').click();
    d.querySelector('#toggleManualPurchase').click(); await flush();
    expect(d.querySelector('#manualStockHandling').value).toBe('');
    expect(d.querySelector('#manualPurchaseReview').hidden).toBe(true);
    submit(); expect(create).toHaveBeenCalledTimes(1);
  });
  it('starts without a choice after a successful purchase and reopening', async () => {
    const { d, create, review, submit } = await setupPurchase();
    create.mockResolvedValueOnce({ created: true });
    review(); submit(); await flush();
    d.querySelector('#toggleManualPurchase').click(); await flush();
    expect(d.querySelector('#manualStockHandling').value).toBe('');
    expect(d.querySelector('#manualPurchaseConfirmActions').hidden).toBe(true);
  });
  it('detects a missing decision at confirmation even without a change event', async () => {
    const { d, review, submit, create } = await setupPurchase();
    review(); d.querySelector('#manualStockHandling').value = ''; submit(); await flush();
    expect(create).not.toHaveBeenCalled();
    expect(d.querySelector('#manualStockHandlingError').hidden).toBe(false);
    expect(d.querySelector('#manualPurchaseConfirmActions').hidden).toBe(true);
  });
});

const editablePurchase = (stockHandling = 'DEDUCT_NOW') => ({ editable: true, limitation: null, expectedVersion: 'a'.repeat(64), order: {
  id: 11, paymentMethod: 'BANK_TRANSFER', purchasedAt: '2026-10-01T12:00:33.123Z', note: 'Original note', excludedFromStatistics: true, stockHandling,
  items: [{ itemId: 101, variantId: 5, productId: 1, productName: 'Camiseta', size: 'M', sku: 'TEST-M', quantity: 2, unitPriceCents: 2550 }],
} });
async function setupEdit(stockHandling = 'DEDUCT_NOW', override: Record<string, unknown> = {}) {
  const edit = jest.fn().mockResolvedValue({ changed: true, orderId: 11 });
  const getEditor = jest.fn().mockResolvedValue(editablePurchase(stockHandling));
  const result = await setupPurchase({
    listAdminOrders: async () => ({ items: [{ id: 11, source: 'IN_PERSON_ADMIN', status: 'PAID', total: 51, excludedFromStatistics: true, provider: 'manual' }] }),
    getInPersonPurchaseForEdit: getEditor, editInPersonPurchase: edit, ...override,
  });
  result.d.querySelector('[data-edit-manual-order="11"]').click(); await flush();
  return { ...result, edit, getEditor };
}
describe('editing existing purchases', () => {
  it.each(['DEDUCT_NOW', 'ALREADY_ADJUSTED'])('preloads all business fields and locks original stock treatment %s; cancellation does not write', async stockHandling => {
    const { d, edit, create } = await setupEdit(stockHandling);
    expect(d.querySelector('[data-void-manual-order="11"]').textContent).toBe('Anular');
    expect(d.querySelector('#manualPurchaseTitle').textContent).toBe('Editar compra #11');
    expect(d.querySelector('[data-manual-variant]').value).toBe('5');
    expect(d.querySelector('[data-manual-price]').value).toBe('25.50');
    expect(d.querySelector('[data-manual-quantity]').value).toBe('2');
    expect(d.querySelector('#manualPaymentMethod').value).toBe('BANK_TRANSFER');
    expect(d.querySelector('#manualPurchaseNote').value).toBe('Original note');
    expect(d.querySelector('#manualExcludeStatistics').checked).toBe(true);
    expect(d.querySelector('#manualStockHandling').value).toBe(stockHandling);
    expect(d.querySelector('#manualStockHandling').disabled).toBe(true);
    expect(d.querySelector('#saveManualPurchaseEdit').hidden).toBe(false);
    expect(d.querySelector('#manualPurchaseConfirmActions').hidden).toBe(true);
    d.querySelector('#manualPurchaseNote').value = 'Uncommitted draft';
    d.querySelector('#cancelManualPurchaseEdit').click();
    expect(edit).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
    expect(d.querySelector('#manualPurchaseForm').hidden).toBe(true);
    d.querySelector('#toggleManualPurchase').click(); await flush();
    expect(d.querySelector('#manualStockHandling').disabled).toBe(false);
    expect(d.querySelector('#manualStockHandling').value).toBe('');
  });
  it('updates the same purchase, preserves the original seconds and submits line IDs/version without stock changes in the payload', async () => {
    const { d, change, submit, edit, create } = await setupEdit();
    change('[data-manual-price]', '30,25'); change('[data-manual-quantity]', '3');
    change('#manualPurchaseNote', '');
    d.querySelector('#manualExcludeStatistics').checked = false;
    submit(); submit(); await flush();
    expect(edit).toHaveBeenCalledTimes(1);
    expect(edit.mock.calls[0].slice(0, 2)).toEqual(['7', '11']);
    expect(edit.mock.calls[0][2]).toEqual({ expectedVersion: 'a'.repeat(64), items: [{ itemId: 101, variantId: 5, quantity: 3, unitPriceCents: 3025 }],
      paymentMethod: 'BANK_TRANSFER', purchasedAt: '2026-10-01T12:00:33.123Z', note: '', excludedFromStatistics: false });
    expect(create).not.toHaveBeenCalled();
    expect(d.querySelector('#manualPurchaseForm').hidden).toBe(true);
    expect(d.querySelector('#manualStockHandling').disabled).toBe(false);
  });
  it('keeps failed edits and retry keys; changed drafts use a new key and conflicts remain visible', async () => {
    const { d, submit, edit, change } = await setupEdit();
    edit.mockRejectedValue(new Error('La compra ha cambiado desde que la abriste.'));
    submit(); await flush();
    expect(d.querySelector('#manualPurchaseEditError').textContent).toContain('ha cambiado');
    expect(d.querySelector('#manualPurchaseForm').hidden).toBe(false);
    expect(d.querySelector('#manualStockHandling').disabled).toBe(true);
    submit(); await flush();
    expect(edit.mock.calls[0][3]).toBe(edit.mock.calls[1][3]);
    change('#manualPurchaseNote', 'Changed draft'); submit(); await flush();
    expect(edit.mock.calls[2][3]).not.toBe(edit.mock.calls[1][3]);
    d.querySelector('#cancelManualPurchaseEdit').click();
  });
  it('allows keeping retired variants, removes deleted rows and sends new rows without an old item ID', async () => {
    const original = editablePurchase();
    original.order.items[0].variantId = 99; original.order.items[0].sku = 'RETIRED-M';
    const { d, submit, edit, change } = await setupEdit('DEDUCT_NOW', { getInPersonPurchaseForEdit: async () => original });
    expect(d.querySelector('[data-manual-variant]').value).toBe('99');
    d.querySelector('[data-remove-manual-item]').click();
    d.querySelector('#addManualPurchaseItem').click();
    change('[data-manual-variant]', '6', 'change');
    submit(); await flush();
    expect(edit.mock.calls[0][2].items).toEqual([{ variantId: 6, quantity: 1, unitPriceCents: 3000 }]);
  });
  it('explains restrictions for cancelled, refunded and externally linked purchases', async () => {
    const { d } = await setupPurchase({ listAdminOrders: async () => ({ items: [
      { id: 21, source: 'IN_PERSON_ADMIN', status: 'CANCELLED' }, { id: 22, source: 'IN_PERSON_ADMIN', status: 'REFUNDED' },
      { id: 23, source: 'IN_PERSON_ADMIN', status: 'PAID', provider: 'stripe', providerRef: 'pi_external' },
    ] }) });
    expect(d.querySelectorAll('[data-edit-manual-order]')).toHaveLength(0);
    expect(d.querySelector('#ordersBody').textContent).toContain('Edición no disponible');
    expect(d.querySelector('#ordersBody').textContent).toContain('pago integrado');
  });
});

describe('paid unit price interactions', () => {
  it('uses server KPIs while retaining excluded purchases in the operational history', async () => {
    const { d } = await setupPurchase({
      getUserDetail: async () => ({ user: { id: 7, email: 'test@example.test' }, stats: { ordersCount: 2, totalSpent: 102 } }),
      listAdminOrders: async () => ({ items: [
        { id: 1, source: 'IN_PERSON_ADMIN', status: 'PAID', total: 51, excludedFromStatistics: false },
        { id: 2, source: 'IN_PERSON_ADMIN', status: 'PAID', total: 51, excludedFromStatistics: true },
      ] }),
    });
    expect(d.querySelector('#summaryOrdersCount').textContent).toBe('2');
    expect(d.querySelector('#summaryTotalSpent').textContent).toContain('102,00');
    expect(d.querySelector('#ordersBody').textContent).toContain('Excluida de estadísticas');
    expect(d.querySelectorAll('#ordersBody tr')).toHaveLength(2);
  });
  it('defaults to inclusion, reviews the choice and invalidates confirmation when it changes', async () => {
    const { d, create, review, submit, w } = await setupPurchase();
    const choice = d.querySelector('#manualExcludeStatistics');
    expect(choice.checked).toBe(false);
    review();
    expect(d.querySelector('#manualPurchaseReview').textContent).toContain('Incluida en las estadísticas generales');
    choice.checked = true; choice.dispatchEvent(new w.Event('change', { bubbles: true }));
    expect(d.querySelector('#manualPurchaseReview').hidden).toBe(true);
    review();
    expect(d.querySelector('#manualPurchaseReview').textContent).toContain('Excluida de estadísticas');
    submit(); await flush();
    expect(create.mock.calls[0][1].excludedFromStatistics).toBe(true);
  });
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
