/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
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
    ).toContain('Stock');
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

  const setup = async () => {
    const dom = new JSDOM(html, {
      runScripts: 'outside-only',
      url: 'https://example.test/admin.html',
    });
    const w = dom.window as any;
    let product: any = {
      id: 1,
      name: 'Chaqueta',
      slug: 'chaqueta',
      isActive: true,
      totalStock: 3,
      stockStatus: 'low',
      variantCount: 2,
      variants: [
        { id: 10, size: 'S', sku: 'CHA-S', stockQty: 1, isActive: true },
        { id: 11, size: 'M', sku: 'CHA-M', stockQty: 2, isActive: true },
      ],
    };
    let note: string | null = null;
    const updateInventory = jest.fn((_id, payload) => {
      note = payload.note ?? null;
      product = {
        ...product,
        variants: product.variants.map((variant: any) => ({
          ...variant,
          stockQty:
            payload.updates.find(
              (change: any) => change.variantId === variant.id,
            )?.stock ?? variant.stockQty,
        })),
      };
      return Promise.resolve(product);
    });
    const getInventoryHistory = jest.fn(() =>
      Promise.resolve({
        items: [
          {
            id: 1,
            createdAt: new Date().toISOString(),
            admin: { name: 'Admin' },
            size: 'S',
            delta: 2,
            previousStock: 1,
            newStock: 3,
            reason: 'inventory_manual',
            note,
          },
          {
            id: 2,
            createdAt: new Date().toISOString(),
            admin: { name: 'Admin' },
            size: 'M',
            delta: 0,
            previousStock: 2,
            newStock: 2,
            reason: 'inventory_manual',
            note: null,
          },
        ],
      }),
    );
    w.CRONOX_API = {
      admin: {
        listInventory: jest.fn(() =>
          Promise.resolve({
            items: [product],
            meta: { page: 1, totalPages: 1, totalItems: 1 },
          }),
        ),
        getInventorySummary: jest.fn(() => Promise.resolve({})),
        updateInventory,
        getInventoryHistory,
      },
    };
    w.eval(script);
    await w.CRONOX_INVENTORY.load();
    w.document.querySelector('[data-toggle-inventory="1"]').click();
    return { dom, w, updateInventory, getInventoryHistory };
  };
  const flush = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const edit = (w: any, id: number, value: string) => {
    const input = w.document.querySelector(`[data-inventory-stock="${id}"]`);
    input.value = value;
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
  };

  it('does not open a modal without changes; cancellation keeps edited quantities', async () => {
    const { dom, w, updateInventory } = await setup();
    try {
      w.document.querySelector('[data-save-inventory="1"]').click();
      expect(w.document.querySelector('.inventory-note-dialog')).toBeNull();
      edit(w, 10, '3');
      w.document.querySelector('[data-save-inventory="1"]').click();
      const dialog = w.document.querySelector('.inventory-note-dialog');
      expect(dialog.textContent).toContain('S: 1 → 3');
      expect(updateInventory).not.toHaveBeenCalled();
      [...dialog.querySelectorAll('button')]
        .find((button: any) => button.textContent === 'Cancelar')
        .click();
      expect(w.document.querySelector('.inventory-note-dialog')).toBeNull();
      expect(
        w.document.querySelector('[data-inventory-stock="10"]').value,
      ).toBe('3');
    } finally {
      dom.window.close();
    }
  });

  it('saves multiple sizes with one note and shows it as text after reloading history', async () => {
    const { dom, w, updateInventory } = await setup();
    try {
      edit(w, 10, '3');
      edit(w, 11, '4');
      w.document.querySelector('[data-save-inventory="1"]').click();
      const dialog = w.document.querySelector('.inventory-note-dialog');
      expect(
        dialog.querySelectorAll('.inventory-note-summary li'),
      ).toHaveLength(2);
      dialog.querySelector('textarea').value = '  <Restock de chaquetas>  ';
      [...dialog.querySelectorAll('button')]
        .find((button: any) => button.textContent === 'Guardar cambios')
        .click();
      await flush();
      expect(updateInventory).toHaveBeenCalledWith(1, {
        updates: [
          { variantId: 10, stock: 3, expectedStock: 1 },
          { variantId: 11, stock: 4, expectedStock: 2 },
        ],
        note: '<Restock de chaquetas>',
      });
      expect(w.document.querySelector('.inventory-note-dialog')).toBeNull();
      await w.CRONOX_INVENTORY.load();
      if (!w.document.querySelector('[data-toggle-inventory-history="1"]'))
        w.document.querySelector('[data-toggle-inventory="1"]').click();
      w.document.querySelector('[data-toggle-inventory-history="1"]').click();
      await flush();
      const notes = [...w.document.querySelectorAll('.inventory-history-note')];
      expect(notes.map((item: any) => item.textContent)).toEqual([
        '<Restock de chaquetas>',
        'Sin nota',
      ]);
      expect(notes[0].querySelector('restock')).toBeNull();
    } finally {
      dom.window.close();
    }
  });

  it('keeps the note and quantities after a failed save, then retries without double submission', async () => {
    const { dom, w, updateInventory } = await setup();
    try {
      w.console.error = jest.fn();
      updateInventory.mockRejectedValueOnce(new Error('Fallo de prueba'));
      edit(w, 10, '3');
      w.document.querySelector('[data-save-inventory="1"]').click();
      const dialog = w.document.querySelector('.inventory-note-dialog');
      dialog.querySelector('textarea').value = 'Recuento';
      const confirm = [...dialog.querySelectorAll('button')].find(
        (button: any) => button.textContent === 'Guardar cambios',
      );
      confirm.click();
      confirm.click();
      await flush();
      expect(updateInventory).toHaveBeenCalledTimes(1);
      expect(dialog.querySelector('textarea').value).toBe('Recuento');
      expect(
        w.document.querySelector('[data-inventory-stock="10"]').value,
      ).toBe('3');
      confirm.click();
      await flush();
      expect(updateInventory).toHaveBeenCalledTimes(2);
    } finally {
      dom.window.close();
    }
  });

  it('allows saving without a note and stops an overlong note before the API call', async () => {
    const { dom, w, updateInventory } = await setup();
    try {
      edit(w, 10, '3');
      w.document.querySelector('[data-save-inventory="1"]').click();
      const dialog = w.document.querySelector('.inventory-note-dialog');
      const confirm = [...dialog.querySelectorAll('button')].find(
        (button: any) => button.textContent === 'Guardar cambios',
      );
      dialog.querySelector('textarea').value = 'x'.repeat(501);
      confirm.click();
      expect(updateInventory).not.toHaveBeenCalled();
      expect(dialog.textContent).toContain('500 caracteres');
      dialog.querySelector('textarea').value = '   ';
      confirm.click();
      await flush();
      expect(updateInventory).toHaveBeenCalledWith(1, {
        updates: [{ variantId: 10, stock: 3, expectedStock: 1 }],
      });
    } finally {
      dom.window.close();
    }
  });
});
