import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
const source = readFileSync(resolve(__dirname, '../../../cronox-front/assets/admin.js'), 'utf8');
function setup() {
  const dom = new JSDOM('<p id="message" class="message show error"></p><table><tbody id="rows"></tbody></table><div id="modal" class="show"><form id="form"><input name="name" value="Producto"><input name="price" value="22"><p id="productFormMessage" hidden></p><button id="save"></button></form></div>', { runScripts: 'outside-only', url: 'https://fixture.test/admin.html' });
  const w = dom.window as any;
  Object.assign(w, { productsBody: w.document.getElementById('rows'), productsMessage: w.document.getElementById('message'), statusArea: null,
    productForm: w.document.getElementById('form'), productModal: w.document.getElementById('modal'), productSubmitBtn: w.document.getElementById('save'),
    productSubmitInFlight: false, editingProductId: 1, productImagesInput: null, cachedProductImages: [], productCreateIdempotencyKey: null,
    creationCategories: { selected: new Set() }, productCardFramingState: {}, selectedSizeSystem: () => 'CLOTHING', collectVariantPayload: () => [], validateProductImages: () => '',
    productsState: { page: 1 }, productsLoadVersion: 0, ADMIN_PAGE_SIZES: { products: 50 },
    canAccess: () => true, setUiLoading: null, buildProductQuery: () => ({}), normalizePaginated: (data: any) => data,
    getProductsColumnCount: () => 7, renderProducts: jest.fn(), updatePagination: jest.fn(), showEmptyTable: jest.fn(),
    productsPageInfo: null, productsPrev: null, productsNext: null,
    toggleModal: (element: any, show: boolean) => element.classList.toggle('show', show),
  });
  w.console.error = jest.fn();
  const list = jest.fn().mockResolvedValue({ items: [{ id: 1 }], page: 1, totalPages: 1, totalItems: 1 });
  const save = jest.fn().mockResolvedValue({ id: 1 });
  w.CRONOX_API = { admin: { listAdminProducts: list, updateAdminProduct: save, createAdminProduct: save } };
  w.showModuleError = ({ title }: any) => w.hooks.setScopedMessage(w.productsMessage, title, 'error');
  const message = source.match(/const setScopedMessage = [\s\S]*?\n  };/)![0];
  const fetch = source.slice(source.indexOf('const fetchProducts ='), source.indexOf('  const assignedCategoryIds ='));
  const submit = source.slice(source.indexOf('const submitProduct ='), source.indexOf('  const setProductRowBusy ='));
  w.eval(message + '\n' + fetch + '\n' + submit + '\nwindow.hooks={fetchProducts,submitProduct,setScopedMessage};');
  return { dom, w, list, save, message: w.productsMessage, hooks: w.hooks };
}
describe('product alert lifecycle', () => {
  it.each(['error', 'success'])('clears both empty HTML and stale %s styling on refresh', async type => {
    const t = setup(); try {
      t.message.className = 'message show ' + type;
      await t.hooks.fetchProducts();
      expect(t.message.textContent).toBe(''); expect(t.message.className).toBe('message');
    } finally { t.dom.window.close(); }
  });
  it('shows confirmed success after the list refresh instead of clearing its text', async () => {
    const t = setup(); try {
      await t.hooks.submitProduct();
      expect(t.save).toHaveBeenCalledTimes(1);
      expect(t.message.textContent).toBe('Producto actualizado correctamente.');
      expect(t.message.className).toBe('message show success');
    } finally { t.dom.window.close(); }
  });
  it('distinguishes successful save followed by failed refresh from a failed write', async () => {
    const t = setup(); try {
      t.list.mockRejectedValueOnce(Error('Offline'));
      await t.hooks.submitProduct();
      expect(t.message.textContent).toContain('Producto actualizado correctamente. No se pudo actualizar la lista');
      expect(t.message.textContent).not.toContain('No se pudo guardar');
      expect(t.w.document.getElementById('productFormMessage').hidden).toBe(true);
    } finally { t.dom.window.close(); }
  });
  it('preserves a useful real save error inside the still-open form', async () => {
    const t = setup(); try {
      t.save.mockRejectedValueOnce({ payload: { message: 'El nombre ya existe.' } });
      await t.hooks.submitProduct();
      expect(t.message.textContent).toBe('El nombre ya existe.');
      expect(t.message.className).toBe('message show error');
      expect(t.w.document.getElementById('productFormMessage').hidden).toBe(false);
      expect(t.list).not.toHaveBeenCalled();
    } finally { t.dom.window.close(); }
  });
  it('does not misreport a saved edition when its later reread fails', async () => {
    const t = setup(); try {
      t.w.CRONOX_PRODUCT_GALLERY = { serialize: () => [] };
      t.w.CRONOX_EDITIONS = { selected: () => true, setSaving: jest.fn(), save: jest.fn().mockRejectedValue({ productSaved: true, message: 'Read failed' }) };
      await t.hooks.submitProduct();
      expect(t.message.textContent).toContain('El producto se ha guardado');
      expect(t.w.document.getElementById('productFormMessage').hidden).toBe(true);
    } finally { t.dom.window.close(); }
  });
});
