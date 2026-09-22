import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
const read = (file: string) =>
  readFileSync(join(__dirname, '../../../cronox-front', file), 'utf8');
describe('authoritative product details', () => {
  it('keeps admin description load/save connected and labels its line format', () => {
    const html = read('admin.html'),
      script = read('assets/admin.js');
    expect(html).toContain(
      '<label for="productDescription">Detalles del producto</label>',
    );
    expect(html).toContain('Cada línea no vacía');
    expect(script).toContain("descInput.value = product.description || ''");
    expect(script).toContain("description: formData.get('description') || ''");
    expect(read('producto.html')).toContain('id="pDetails"');
    expect(read('producto.html')).not.toContain('COMPOSICIÓN: 100%');
  });
  it.each(['desc', 'description'])(
    'renders legacy/current %s safely as individual lines',
    async (field) => {
      const dom = new JSDOM('<ul id="pDetails"></ul><p id="pDesc"></p>', {
        url: 'http://localhost/producto.html?slug=core',
        runScripts: 'outside-only',
        pretendToBeVisual: true,
      });
      dom.window.scrollTo = () => {};
      Object.assign(dom.window, {
        CRONOX_PRODUCTS: [
          {
            id: 'core',
            backendId: 1,
            slug: 'core',
            name: 'Core',
            [field]:
              '  COMPOSICIÓN: Algodón, 240 gsm\r\n\r\nCorte: Boxy fit\n<img src=x onerror=alert(1)>',
          },
        ],
      });
      dom.window.eval(read('assets/product-page.js'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      const items = dom.window.document.querySelectorAll('#pDetails li');
      expect(items).toHaveLength(3);
      expect(items[0].textContent).toBe('COMPOSICIÓN: Algodón, 240 gsm');
      expect(items[2].textContent).toBe('<img src=x onerror=alert(1)>');
      expect(dom.window.document.querySelector('#pDetails img')).toBeNull();
      dom.window.close();
    },
  );
});
