import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
const read = (file: string) => readFileSync(resolve(__dirname, '../../../cronox-front', file), 'utf8');
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
function setup() {
  const dom = new JSDOM(read('admin.html'), { runScripts: 'outside-only', url: 'http://127.0.0.1/admin' });
  const win = dom.window as any;
  const orders = [{ id: 42, userId: 900, status: 'PAID' }, { id: 43, userId: 901, status: 'PAID' }];
  win.CRONOX_API = { getCsrfHeaders: async () => ({ 'x-csrf-token': 'fixture' }) };
  win.fetch = jest.fn(async (url: string, options: any = {}) => {
    let payload: any = { data: url.includes('page=2') ? [{ id: 44, userId: 902, status: 'PAID' }] : orders, meta: { pageCount: 2 } };
    if (url.endsWith('/tracking-bulk/assign')) {
      const body = JSON.parse(options.body);
      payload = { results: body.rows.map((row: any, index: number) => ({ ...row, index, revision: 0,
        status: row.orderId === 42 ? (body.preview ? 'valid' : 'updated') : 'error', error: row.orderId === 42 ? undefined : '<img id=unsafe> ID inválido' })) };
    }
    if (url.endsWith('/tracking-bulk/sync')) payload = { results: JSON.parse(options.body).orderIds.map((orderId: number) => ({ orderId, status: 'unchanged' })) };
    return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
  });
  win.eval(read('assets/user-identity.js')); win.eval(read('assets/admin-orders.js'));
  return { dom, win, doc: win.document };
}
describe('order bulk selection, preview and double click protection', () => {
  it('selects only visible order IDs and clears selection on pagination', async () => {
    const { dom, win, doc } = setup();
    try {
      await win.fetchOrders(); doc.querySelector('#ordersSelectPage').click();
      expect(doc.querySelector('#ordersSelectedCount').textContent).toContain('2 seleccionados');
      doc.querySelector('#ordersBulkSyncBtn').click(); doc.querySelector('#ordersBulkSyncBtn').click();
      await flush(); await flush(); await flush();
      const calls = win.fetch.mock.calls.filter(([url]: string[]) => url.endsWith('/tracking-bulk/sync'));
      expect(calls.map(([, options]: any[]) => JSON.parse(options.body).orderIds)).toEqual([[42], [43]]);
      expect(calls.every(([, options]: any[]) => options.headers['x-csrf-token'] === 'fixture')).toBe(true);
      doc.querySelector('#ordersNextBtn').click(); await flush();
      expect(doc.querySelector('#ordersSelectedCount').textContent).toContain('0 seleccionados');
      expect(doc.querySelectorAll('[data-select-order]').length).toBe(1);
      expect(doc.querySelector('[data-select-order]').dataset.selectOrder).toBe('44');
    } finally { dom.window.close(); }
  });
  it('validates every pasted ID/code, keeps errors literal, and saves only previewed valid rows once', async () => {
    const { dom, win, doc } = setup();
    try {
      doc.querySelector('#ordersBulkAssignBtn').click();
      doc.querySelector('#ordersBulkPaste').value = '42;PQ123456789ES\n900;INVALID';
      doc.querySelector('#ordersBulkParseBtn').click();
      expect(doc.querySelector('#ordersBulkSaveBtn').disabled).toBe(true);
      doc.querySelector('#ordersBulkPreviewBtn').click(); await flush(); await flush();
      expect(doc.querySelectorAll('#ordersBulkRows tr')[1].textContent).toContain('<img id=unsafe>');
      expect(doc.querySelector('#unsafe')).toBeNull();
      expect(doc.querySelector('#ordersBulkSaveBtn').disabled).toBe(false);
      doc.querySelector('#ordersBulkSaveBtn').click(); doc.querySelector('#ordersBulkSaveBtn').click();
      await flush(); await flush();
      const writes = win.fetch.mock.calls.filter(([url, options]: any[]) => url.endsWith('/tracking-bulk/assign') && !JSON.parse(options.body).preview);
      expect(writes).toHaveLength(1);
      expect(JSON.parse(writes[0][1].body).rows).toEqual([{ orderId: 42, trackingNumber: 'PQ123456789ES', revision: 0 }]);
    } finally { dom.window.close(); }
  });
  it('invalidates the reviewed snapshot when editing a row', async () => {
    const { dom, win, doc } = setup();
    try {
      doc.querySelector('#ordersBulkPaste').value = '42,PQ123456789ES'; doc.querySelector('#ordersBulkParseBtn').click();
      doc.querySelector('#ordersBulkPreviewBtn').click(); await flush(); await flush();
      const input = doc.querySelector('[data-bulk-field="id"]'); input.value = '43'; input.dispatchEvent(new win.Event('input'));
      expect(doc.querySelector('#ordersBulkSaveBtn').disabled).toBe(true);
    } finally { dom.window.close(); }
  });
});
