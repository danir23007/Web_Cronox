import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Admin inventory UI', () => {
  const frontendRoot = join(__dirname, '..', '..', '..', 'cronox-front');
  const html = readFileSync(join(frontendRoot, 'admin.html'), 'utf8');
  const script = readFileSync(
    join(frontendRoot, 'assets', 'admin-inventory.js'),
    'utf8',
  );
  const css = readFileSync(
    join(frontendRoot, 'assets', 'admin-inventory.css'),
    'utf8',
  );

  it('exposes the Spanish inventory navigation and accessible controls', () => {
    const dom = new JSDOM(html);
    const document = dom.window.document;

    expect(
      document.querySelector('[data-nav-target="section-inventory"]')
        ?.textContent,
    ).toContain('Inventario');
    expect(
      document.querySelector('#inventorySearch')?.getAttribute('type'),
    ).toBe('search');
    expect(
      document.querySelector('label[for="inventorySearch"]')?.textContent,
    ).toContain('Buscar productos');
    expect(
      document.querySelector('#inventoryMessage')?.getAttribute('aria-live'),
    ).toBe('polite');
    expect(
      document.querySelector(
        '#inventoryStockFilter option[value="out_of_stock"]',
      )?.textContent,
    ).toContain('Agotados');
  });

  it('implements authoritative save, retry-preserving errors, filters, pagination, and history', () => {
    expect(script).toContain('expectedStock');
    expect(script).toContain('updateInventory');
    expect(script).toContain('No se ha podido actualizar el inventario');
    expect(script).toContain('getInventoryHistory');
    expect(script).toContain("activeFilter?.addEventListener('change'");
    expect(script).toContain("previous?.addEventListener('click'");
    expect(script).not.toContain(
      'state.edits.delete(productId);\n      setMessage(error',
    );
  });

  it('keeps tables inside their own responsive scroller', () => {
    expect(css).toContain(
      '.inventory-table-wrap { max-width: 100%; overflow-x: auto; }',
    );
    expect(css).toContain('@media (max-width: 680px)');
    expect(css).toContain(
      '.inventory-section { min-width: 0; overflow: hidden; }',
    );
  });
});
