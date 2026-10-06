import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const bulkScript = readFileSync(
  path.resolve(__dirname, '../../../cronox-front/assets/admin-bulk.js'),
  'utf8',
);
const makeTable = (kind: string, columns: number) => `
  <section id="section-${kind}">
    <input class="filter" type="search">
    <div class="admin-table-scroll">
      <table><thead><tr>${'<th>Campo</th>'.repeat(columns)}</tr></thead>
      <tbody id="${kind}Body"></tbody></table>
    </div>
  </section>`;
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('admin Bulk Edit mode', () => {
  const setup = () => {
    const dom = new JSDOM(makeTable('users', 9) + makeTable('products', 7), {
      runScripts: 'outside-only',
      url: 'https://example.test/admin.html',
    });
    const w = dom.window as any;
    w.AbortSignal = AbortSignal;
    w.CRONOX_API = {
      API_BASE: '',
      getCsrfHeaders: jest.fn().mockResolvedValue({}),
    };
    const fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ids: [1, 2, 3] }),
    });
    w.fetch = fetch;
    w.eval(bulkScript);
    const query = { page: 1, pageSize: 2, q: '' };
    const body = w.document.querySelector('#usersBody');
    const reload = jest.fn().mockResolvedValue(undefined);
    const render = (ids: number[]) => {
      body.innerHTML = ids
        .map(
          (id) =>
            '<tr>' +
            Array.from(
              { length: 9 },
              (_, i) => '<td>' + (i === 0 ? id : 'Valor') + '</td>',
            ).join('') +
            '</tr>',
        )
        .join('');
      w.CRONOX_BULK.page(
        'users',
        ids.map((id) => ({ id, email: id + '@example.test' })),
        3,
      );
    };
    w.CRONOX_BULK.mount({
      kind: 'users',
      body,
      query: () => ({ ...query }),
      reload,
      role: 'SUPERADMIN',
    });
    w.CRONOX_BULK.mount({
      kind: 'products',
      body: w.document.querySelector('#productsBody'),
      query: () => ({}),
      reload: jest.fn(),
      role: 'SUPERADMIN',
    });
    render([1, 2]);
    return { dom, w, fetch, query, render, body, reload };
  };

  it('starts clean, selects across pages, reflects partial/full/empty states and cancels cleanly', async () => {
    const { dom, w, fetch, query, render, body } = setup();
    try {
      const section = w.document.querySelector('#section-users');
      const table = section.querySelector('table');
      const toggle = section.querySelector('.bulk-mode-toggle');
      const bar = section.querySelector('.bulk-selection');
      expect(toggle.textContent).toBe('Bulk Edit');
      expect(bar.hidden).toBe(true);
      expect(table.tHead.rows[0].cells).toHaveLength(9);
      expect(body.rows[0].cells).toHaveLength(9);
      expect(body.querySelector('[data-bulk-id]')).toBeNull();

      toggle.click();
      expect(toggle.textContent).toBe('Cancelar Bulk Edit');
      expect(bar.hidden).toBe(false);
      expect(table.tHead.rows[0].cells).toHaveLength(10);
      expect(body.rows[0].cells).toHaveLength(10);
      const first = body.querySelector('[data-bulk-id="1"]');
      first.checked = true;
      first.dispatchEvent(new w.Event('change', { bubbles: true }));
      const all = bar.querySelector('.bulk-select-all input');
      expect(all.indeterminate).toBe(true);
      expect(bar.querySelector('strong').textContent).toBe('1 seleccionados');

      all.checked = true;
      all.dispatchEvent(new w.Event('change', { bubbles: true }));
      await flush();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0][0]).toContain('users/selection?');
      expect(fetch.mock.calls[0][0]).not.toContain('page=');
      expect(all.checked).toBe(true);
      expect(bar.querySelector('strong').textContent).toBe('3 seleccionados');
      query.page = 2;
      render([3]);
      expect(body.querySelector('[data-bulk-id="3"]').checked).toBe(true);
      all.checked = false;
      all.dispatchEvent(new w.Event('change', { bubbles: true }));
      expect(bar.querySelector('strong').textContent).toBe('0 seleccionados');
      expect(body.querySelector('[data-bulk-id="3"]').checked).toBe(false);

      body.querySelector('[data-bulk-id="3"]').checked = true;
      body
        .querySelector('[data-bulk-id="3"]')
        .dispatchEvent(new w.Event('change', { bubbles: true }));
      query.q = 'nuevo';
      section
        .querySelector('.filter')
        .dispatchEvent(new w.Event('input', { bubbles: true }));
      expect(bar.querySelector('strong').textContent).toBe('0 seleccionados');
      toggle.click();
      expect(toggle.textContent).toBe('Bulk Edit');
      expect(bar.hidden).toBe(true);
      expect(table.tHead.rows[0].cells).toHaveLength(9);
      expect(body.rows[0].cells).toHaveLength(9);
      expect(body.querySelector('[data-bulk-id]')).toBeNull();
      expect(w.CRONOX_BULK.isActive('users')).toBe(false);
    } finally {
      dom.window.close();
    }
  });

  it('clears the previous section and keeps product columns aligned', () => {
    const { dom, w } = setup();
    try {
      const users = w.document.querySelector('#section-users');
      const products = w.document.querySelector('#section-products');
      users.querySelector('.bulk-mode-toggle').click();
      const productBody = products.querySelector('tbody');
      productBody.innerHTML =
        '<tr>' + '<td>Producto largo</td>'.repeat(7) + '</tr>';
      w.CRONOX_BULK.page('products', [{ id: 10, name: 'Producto largo' }], 1);
      expect(productBody.rows[0].cells).toHaveLength(7);
      products.querySelector('.bulk-mode-toggle').click();
      expect(productBody.rows[0].cells).toHaveLength(8);
      expect(products.querySelector('thead tr').cells).toHaveLength(8);
      w.CRONOX_BULK.leave('section-products');
      expect(users.querySelector('thead tr').cells).toHaveLength(9);
      expect(w.CRONOX_BULK.isActive('users')).toBe(false);
      w.CRONOX_BULK.leave('section-users');
      expect(productBody.rows[0].cells).toHaveLength(7);
      expect(w.CRONOX_BULK.isActive('products')).toBe(false);
      productBody.innerHTML = '<tr><td colspan="7">Sin resultados</td></tr>';
      w.CRONOX_BULK.page('products', [], 0);
      products.querySelector('.bulk-mode-toggle').click();
      expect(productBody.rows[0].cells[0].colSpan).toBe(8);
      products.querySelector('.bulk-mode-toggle').click();
      expect(productBody.rows[0].cells[0].colSpan).toBe(7);
    } finally {
      dom.window.close();
    }
  });

  it('previews only the individually selected IDs without executing a bulk change', async () => {
    const { dom, w, fetch, body } = setup();
    try {
      w.HTMLDialogElement.prototype.showModal = jest.fn();
      w.HTMLDialogElement.prototype.close = jest.fn();
      const section = w.document.querySelector('#section-users');
      section.querySelector('.bulk-mode-toggle').click();
      const second = body.querySelector('[data-bulk-id="2"]');
      second.checked = true;
      second.dispatchEvent(new w.Event('change', { bubbles: true }));
      section.querySelector('.bulk-actions button').click();
      await flush();
      const preview = fetch.mock.calls.find(([url]: [string]) =>
        String(url).endsWith('/api/admin/bulk/preview'),
      );
      expect(preview).toBeDefined();
      expect(JSON.parse(preview[1].body)).toMatchObject({
        kind: 'users',
        ids: [2],
        changes: {},
      });
      expect(
        fetch.mock.calls.some(([url]: [string]) =>
          String(url).endsWith('/api/admin/bulk/execute'),
        ),
      ).toBe(false);
    } finally {
      dom.window.close();
    }
  });

  it('shows current and new states, sends a state-only change and reloads after saving', async () => {
    const { dom, w, fetch, body, reload } = setup();
    try {
      w.HTMLDialogElement.prototype.showModal = jest.fn();
      w.HTMLDialogElement.prototype.close = jest.fn();
      w.crypto.randomUUID = () => '00000000-0000-4000-8000-000000000002';
      fetch.mockImplementation(async (url: string, options: any) => {
        const payload = JSON.parse(options.body);
        if (url.endsWith('/execute'))
          return {
            ok: true,
            json: async () => ({
              counts: { changed: 1, unchanged: 0, excluded: 0 },
            }),
          };
        const next = payload.changes.accountState || 'PENDING_PASSWORD';
        return {
          ok: true,
          json: async () => ({
            rows: [
              {
                id: 2,
                name: 'Prueba',
                state: next === 'PENDING_PASSWORD' ? 'unchanged' : 'changed',
                before: {
                  role: 'USER',
                  circleLevel: 1,
                  accountState: 'PENDING_PASSWORD',
                },
                after: { role: 'USER', circleLevel: 1, accountState: next },
              },
            ],
            counts: {
              changed: next === 'PENDING_PASSWORD' ? 0 : 1,
              unchanged: next === 'PENDING_PASSWORD' ? 1 : 0,
              excluded: 0,
            },
            reviewToken: 'review',
          }),
        };
      });
      const section = w.document.querySelector('#section-users');
      section.querySelector('.bulk-mode-toggle').click();
      const selected = body.querySelector('[data-bulk-id="2"]');
      selected.checked = true;
      selected.dispatchEvent(new w.Event('change', { bubbles: true }));
      section.querySelector('.bulk-actions button').click();
      await flush();
      const dialog = w.document.querySelector('.admin-bulk-dialog');
      expect(dialog.textContent).toContain('Estado: Pendiente de contraseña');
      const state = dialog.querySelector('[data-bulk-field="accountState"]');
      expect(state.value).toBe('');
      state.value = 'PRE_REGISTERED';
      state.dispatchEvent(new w.Event('change', { bubbles: true }));
      [...dialog.querySelectorAll('button')]
        .find((button: any) => button.textContent === 'Revisar cambios')
        .click();
      await flush();
      expect(dialog.textContent).toContain(
        'Pendiente de contraseña → Prerregistrado',
      );
      const apply = [...dialog.querySelectorAll('button')].find((button: any) =>
        button.textContent.startsWith('Aplicar cambios'),
      );
      apply.click();
      await flush();
      expect(
        JSON.parse(
          fetch.mock.calls.find(([url]: [string]) =>
            url.endsWith('/execute'),
          )[1].body,
        ).changes,
      ).toEqual({ accountState: 'PRE_REGISTERED' });
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      dom.window.close();
    }
  });

  it.each([false, true])('preserves error details/selection, retries the same operation, and distinguishes failed refresh: %s', async (failedRefresh) => {
    const { dom, w, fetch, body, reload } = setup();
    try {
      w.HTMLDialogElement.prototype.showModal = jest.fn();
      w.HTMLDialogElement.prototype.close = jest.fn();
      w.crypto.randomUUID = () => '00000000-0000-4000-8000-000000000002';
      let failReview = true;
      let executeCalls = 0;
      const executions: any[] = [];
      fetch.mockImplementation(async (url: string, options: any) => {
        const payload = options?.body ? JSON.parse(options.body) : {};
        if (url.includes('/operations/')) return { ok: false, status: 404, json: async () => ({ message: 'Resultado aún no confirmado' }) };
        if (url.endsWith('/execute')) {
          executions.push(payload); executeCalls++;
          return executeCalls === 1
            ? { ok: false, status: 503, json: async () => ({ message: 'Base de datos temporalmente no disponible' }) }
            : { ok: true, json: async () => ({ counts: { changed: 1, unchanged: 0, excluded: 0 } }) };
        }
        if (payload.changes.accountState && failReview)
          return { ok: false, status: 409, json: async () => ({ message: 'El usuario ha cambiado. Revisa de nuevo.' }) };
        return { ok: true, json: async () => ({ reviewToken: 'review',
          counts: { changed: payload.changes.accountState ? 1 : 0, unchanged: payload.changes.accountState ? 0 : 1, excluded: 0 },
          rows: [{ id: 2, name: 'Prueba', state: payload.changes.accountState ? 'changed' : 'unchanged',
            before: { role: 'USER', circleLevel: 1, accountState: 'PRE_REGISTERED' },
            after: { role: 'USER', circleLevel: 1, accountState: payload.changes.accountState || 'PRE_REGISTERED' } }],
        }) };
      });
      if (failedRefresh) reload.mockRejectedValue(new Error('Table unavailable'));
      const section = w.document.querySelector('#section-users');
      section.querySelector('.bulk-mode-toggle').click();
      const selected = body.querySelector('[data-bulk-id="2"]');
      selected.checked = true; selected.dispatchEvent(new w.Event('change', { bubbles: true }));
      section.querySelector('.bulk-actions button').click(); await flush();
      const dialog = w.document.querySelector('.admin-bulk-dialog');
      expect(dialog.textContent).toContain('Activa admite cuentas con o sin contraseña');
      const state = dialog.querySelector('[data-bulk-field="accountState"]');
      state.value = 'ACTIVE'; state.dispatchEvent(new w.Event('change', { bubbles: true }));
      const find = (name: string) => [...dialog.querySelectorAll('button')].find((b: any) => b.textContent.startsWith(name));
      find('Revisar cambios').click(); await flush();
      expect(dialog.textContent).toContain('El usuario ha cambiado');
      expect(selected.checked).toBe(true); expect(state.value).toBe('ACTIVE');
      expect(executeCalls).toBe(0);
      failReview = false; find('Revisar cambios').click(); await flush();
      find('Aplicar cambios').click(); find('Aplicar cambios').click();
      expect(dialog.textContent).not.toContain('Completado:'); await flush();
      expect(executeCalls).toBe(1);
      expect(dialog.textContent).toContain('Base de datos temporalmente no disponible (HTTP 503)');
      expect(selected.checked).toBe(true); expect(state.value).toBe('ACTIVE');
      find('Consultar resultado').click(); await flush();
      find('Reintentar la misma operación').click(); await flush();
      expect(executions[1]).toEqual(executions[0]);
      expect(executions[1].changes).toEqual({ accountState: 'ACTIVE' });
      expect(dialog.textContent).toContain('Completado: 1 modificados');
      expect(dialog.textContent.includes('No se pudo actualizar el listado')).toBe(failedRefresh);
      expect(reload).toHaveBeenCalledTimes(1);
      expect(selected.checked).toBe(false);
    } finally { dom.window.close(); }
  });

  it('marks mixed current states in the modal', async () => {
    const { dom, w, fetch, body } = setup();
    try {
      w.HTMLDialogElement.prototype.showModal = jest.fn();
      fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          rows: [
            {
              before: { role: 'USER', circleLevel: 1, accountState: 'ACTIVE' },
            },
            {
              before: {
                role: 'USER',
                circleLevel: 1,
                accountState: 'PRE_REGISTERED',
              },
            },
          ],
          counts: { changed: 0, unchanged: 2, excluded: 0 },
        }),
      });
      const section = w.document.querySelector('#section-users');
      section.querySelector('.bulk-mode-toggle').click();
      body.querySelectorAll('[data-bulk-id]').forEach((input: any) => {
        input.checked = true;
        input.dispatchEvent(new w.Event('change', { bubbles: true }));
      });
      section.querySelector('.bulk-actions button').click();
      await flush();
      expect(
        w.document.querySelector('.admin-bulk-dialog fieldset').textContent,
      ).toContain('Estado: Valores distintos');
    } finally {
      dom.window.close();
    }
  });

  it('states the 100-record limit before a select-all request and never selects a partial set', async () => {
    const { dom, w, fetch, body } = setup();
    try {
      const section = w.document.querySelector('#section-users');
      section.querySelector('.bulk-mode-toggle').click();
      w.CRONOX_BULK.page('users', [{ id: 1 }, { id: 2 }], 101);
      const all = section.querySelector('.bulk-select-all input');
      all.checked = true;
      all.dispatchEvent(new w.Event('change', { bubbles: true }));
      expect(fetch).not.toHaveBeenCalled();
      expect(all.checked).toBe(false);
      expect(section.querySelector('.bulk-notice').textContent).toContain(
        '101 resultados',
      );
      expect(section.querySelector('.bulk-notice').textContent).toContain(
        'No se ha seleccionado ninguno',
      );
      expect(section.querySelector('.bulk-actions').hidden).toBe(true);
      expect(body.querySelectorAll('[data-bulk-id]:checked')).toHaveLength(0);
    } finally {
      dom.window.close();
    }
  });

  it('keeps selection empty if the backend detects more than 100 after the list loaded', async () => {
    const { dom, w, fetch } = setup();
    try {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          message:
            'Hay más de 100 resultados. Acota los filtros; no se ha seleccionado un subconjunto.',
        }),
      });
      const section = w.document.querySelector('#section-users');
      section.querySelector('.bulk-mode-toggle').click();
      w.CRONOX_BULK.page('users', [{ id: 1 }, { id: 2 }], 100);
      const all = section.querySelector('.bulk-select-all input');
      all.checked = true;
      all.dispatchEvent(new w.Event('change', { bubbles: true }));
      await flush();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(all.checked).toBe(false);
      expect(section.querySelector('strong').textContent).toBe(
        '0 seleccionados',
      );
      expect(section.querySelector('.bulk-notice').textContent).toContain(
        'más de 100 resultados',
      );
      expect(section.querySelector('.bulk-actions').hidden).toBe(true);
    } finally {
      dom.window.close();
    }
  });
});
