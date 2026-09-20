import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const frontendRoot = path.resolve(__dirname, '../../../cronox-front');
const read = (file: string) =>
  readFileSync(path.join(frontendRoot, file), 'utf8');

describe('fixed Admin pagination', () => {
  const createRuntime = () => {
    const dom = new JSDOM(
      '<div class="page-controls"><button id="prev">Anterior</button><button id="next">Siguiente</button></div><p id="info"></p>',
      { runScripts: 'outside-only' },
    );
    dom.window.eval(read('assets/admin-pagination.js'));
    return dom;
  };

  it('defines the exact fixed page sizes and removes affected selectors', () => {
    const dom = createRuntime();
    expect((dom.window as any).CRONOX_ADMIN_PAGINATION.PAGE_SIZES).toEqual({
      inventory: 50,
      products: 50,
      promoCodes: 50,
      activity: 100,
      users: 100,
    });
    const document = new JSDOM(read('admin.html')).window.document;
    for (const id of [
      'inventoryPageSize',
      'productsPageSize',
      'activityPageSize',
    ]) {
      expect(document.getElementById(id)).toBeNull();
    }
  });

  it.each([
    [50, [0, 1, 49, 50, 51, 100, 101], [1, 1, 1, 1, 2, 2, 3]],
    [100, [0, 1, 99, 100, 101, 200, 201], [1, 1, 1, 1, 2, 2, 3]],
  ])(
    'calculates boundary pages for page size %i',
    (pageSize, totals, pages) => {
      const dom = createRuntime();
      const helper = (dom.window as any).CRONOX_ADMIN_PAGINATION;
      expect(totals.map((total) => helper.pageCount(total, pageSize))).toEqual(
        pages,
      );
    },
  );

  it('hides one-page controls and applies first, middle and last states', () => {
    const dom = createRuntime();
    const document = dom.window.document;
    const helper = (dom.window as any).CRONOX_ADMIN_PAGINATION;
    const elements = {
      info: document.getElementById('info'),
      prev: document.getElementById('prev') as HTMLButtonElement,
      next: document.getElementById('next') as HTMLButtonElement,
    };
    const controls = elements.prev.closest('.page-controls') as HTMLElement;

    helper.apply({ ...elements, page: 1, pageSize: 50, totalItems: 50 });
    expect(controls.hidden).toBe(true);
    expect(elements.info?.textContent).toBe('Página 1 de 1 · 50 resultados');

    helper.apply({ ...elements, page: 1, pageSize: 50, totalItems: 101 });
    expect(controls.hidden).toBe(false);
    expect(elements.prev.disabled).toBe(true);
    expect(elements.next.disabled).toBe(false);

    helper.apply({ ...elements, page: 2, pageSize: 50, totalItems: 101 });
    expect(elements.prev.disabled).toBe(false);
    expect(elements.next.disabled).toBe(false);

    helper.apply({ ...elements, page: 3, pageSize: 50, totalItems: 101 });
    expect(elements.prev.disabled).toBe(false);
    expect(elements.next.disabled).toBe(true);
  });

  it('keeps Target as a table cell, wraps inner content and normalizes reason placeholders', () => {
    const html = read('admin.html');
    const script = read('assets/admin.js');
    expect(html).not.toContain('.activity-target { display: flex');
    expect(html).toContain('.activity-target__content { display: flex');
    expect(html).toContain('overflow-wrap: anywhere');
    expect(html).toContain('word-break: break-word');
    expect(script).toContain(
      '<td class="activity-target"><div class="activity-target__content">${targetCell}</div></td>',
    );
    expect(script).toContain('normalizeActivityReason(entry.reason)');
    expect(script).toContain('<td>${reason}</td>');
    expect(script).toContain("const safeText = (value, fallback = '\\u2014')");
    expect(script).toContain("? '\\u2014' : text");
    expect(script).not.toContain("fallback = 'â€”'");
    expect(script).not.toContain("entry.reason || 'Ã¢â‚¬â€'");
  });
});
