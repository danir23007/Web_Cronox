import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function workspace(options: { blocked?: boolean; fail?: boolean; total?: number; htmlEmail?: boolean } = {}) {
  const dom = new JSDOM('<section id="section-mails"><p id="mailFeedback"></p><div id="mailWorkspace"></div></section>', { url: 'http://localhost/admin.html', runScripts: 'outside-only' });
  const win = dom.window as any;
  const rows: any[] = Array.from({ length: options.total || 3 }, (_, index) => ({
    id: 't' + index, name: index ? 'Variante ' + index : '<Plantilla original>', folderId: 'f1',
    subject: 'Asunto', purpose: null, preheader: '', revision: 1, signatureMode: 'none',
    visualClassification: [null, 'FOR_ALL', 'DIFFERENT'][index % 3], document: { blocks: [] }, updatedAt: new Date().toISOString(),
  }));
  if (options.htmlEmail) rows[0].document = { schemaVersion: 3, format: 'html-email', page: { width: 600, background: '#aaa9a6' }, blocks: [{ type: 'html', html: '<p>{{message}}</p>' }] };
  let fail = options.fail, writes = 0;
  const api = jest.fn(async (path: string, method = 'GET', body?: any): Promise<any> => {
    if (!path) return [{ key: 'INFO', email: 'info@cronox.local', counts: { folders: 1, templates: rows.length } }];
    if (path.endsWith('/initialize')) return {};
    if (path.endsWith('/folders')) return [{ id: 'f1', name: 'Círculo I', _count: { templates: rows.length } }];
    if (path.endsWith('/signatures') || path === '/catalog') return [];
    if (path.endsWith('/preview')) return { html: '<!doctype html><html><head></head><body><p>Vista segura</p></body></html>', text: 'Vista segura', subject: 'Asunto' };
    if (path.includes('/templates?')) {
      const page = Number(new URLSearchParams(path.split('?')[1]).get('page'));
      return { items: rows.slice((page - 1) * 30, page * 30), total: rows.length };
    }
    if (path.endsWith('/draft-targets')) return { targets: [] };
    const id = path.split('/')[3];
    const row = rows.find(item => item.id === id);
    if (path.endsWith('/deletion')) return { ...row, folderName: 'Círculo I', publications: options.blocked ? ['AUTOMATIC'] : [], published: Boolean(options.blocked), pendingCampaigns: options.blocked ? 1 : 0, versionCount: 2, canDelete: !options.blocked, blockers: options.blocked ? ['Despublica esta plantilla y revisa las campañas pendientes.'] : [] };
    if (path.endsWith('/actions')) {
      writes++;
      await tick();
      if (body.action === 'archive') {
        if (fail) { fail = false; throw new Error('Conflicto: recarga la revisión.'); }
        rows.splice(rows.indexOf(row), 1); return { ...row, archivedAt: new Date() };
      }
      if (body.action === 'duplicate') { const copy = { ...row, id: 'copy', revision: 1 }; rows.push(copy); return copy; }
    }
    if (method === 'PATCH') { writes++; Object.assign(row, body, { revision: row.revision + 1 }); return { ...row }; }
    if (method === 'POST') { writes++; const created = { ...body, id: 'created', revision: 1 }; rows.push(created); return created; }
    return { ...row };
  });
  Object.assign(win, { CRONOX_API: { admin: { mailRequest: api } }, confirm: () => true });
  for (const file of ['admin-mail-document.js', 'admin-mails.js']) win.eval(readFileSync(join(__dirname, '../../../cronox-front/assets', file), 'utf8'));
  const click = async (selector: string) => {
    const element = win.document.querySelector(selector);
    expect(element).not.toBeNull(); element.click(); await tick(); await tick();
  };
  await win.CRONOX_MAILS.load(); await click('[data-mail-action="account"]'); await click('[data-mail-action="circle"]');
  return { dom, win, rows, api, click, writes: () => writes };
}

describe('manual template classification and safe card deletion', () => {
  it('opens explicit HTML emails as a sandboxed preview/source editor and preserves their document on save/reopen', async () => {
    const t = await workspace({ htmlEmail: true });
    await t.click('[data-mail-action="edit"][data-id="t0"]'); await tick();
    const frame = t.win.document.querySelector('.mail-html-email-preview');
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.srcdoc).toContain('Content-Security-Policy');
    expect(frame.srcdoc).toContain('Vista segura');
    expect(t.win.document.querySelector('[data-mail-action="add"]')).toBeNull();
    const html = t.win.document.querySelector('[data-mail-html]');
    html.value = '<p>Texto editado {{message}}</p>'; html.dispatchEvent(new t.win.Event('input', { bubbles: true }));
    await t.click('[data-mail-action="save"]'); await t.click('[data-mail-action="templates"]');
    await t.click('[data-mail-action="edit"][data-id="t0"]');
    expect(t.win.document.querySelector('[data-mail-html]').value).toContain('Texto editado {{message}}');
    expect(t.rows[0].document.format).toBe('html-email');
    t.dom.window.close();
  });
  it('shows tags only for assigned cards, accessible visible trash, and escapes names', async () => {
    const t = await workspace();
    expect(t.win.document.querySelectorAll('.mail-template-card[data-classification]')).toHaveLength(2);
    expect(t.win.document.querySelectorAll('[aria-label="Eliminar plantilla"][title="Eliminar plantilla"]')).toHaveLength(3);
    expect(t.win.document.body.textContent).toContain('<Plantilla original>');
    expect(t.win.document.querySelector('plantilla')).toBeNull();
    t.dom.window.close();
  });
  it('persists one selected classification through reopen, duplication and a new workspace load', async () => {
    const t = await workspace();
    await t.click('[data-mail-action="edit"][data-id="t0"]');
    expect(t.win.document.querySelectorAll('[name="mailVisualClassification"]')).toHaveLength(3);
    expect(t.win.document.querySelector('[name="mailVisualClassification"]:checked')).toBeNull();
    await t.click('[value="UNIQUE"]'); await t.click('[data-mail-action="save"]');
    expect(t.rows[0].visualClassification).toBe('UNIQUE');
    expect(t.rows[1].visualClassification).toBe('FOR_ALL');
    await t.click('[data-mail-action="duplicate-template"]');
    expect(t.rows.find(item => item.id === 'copy').visualClassification).toBe('UNIQUE');
    await t.click('[value="DIFFERENT"]'); await t.click('[data-mail-action="save"]');
    expect(t.rows[0].visualClassification).toBe('UNIQUE');
    await t.win.CRONOX_MAILS.load(); await t.click('[data-mail-action="account"]'); await t.click('[data-mail-action="circle"]');
    await t.click('[data-mail-action="edit"][data-id="t0"]');
    expect(t.win.document.querySelector('[name="mailVisualClassification"]:checked').value).toBe('UNIQUE');
    t.dom.window.close();
  });
  it('creates with one of three choices and preserves an unclassified legacy draft on unrelated edits', async () => {
    const t = await workspace();
    await t.click('[data-mail-action="edit"][data-id="t0"]');
    const subject = t.win.document.querySelector('[data-field="subject"]');
    subject.value = 'Otro asunto'; subject.dispatchEvent(new t.win.Event('input', { bubbles: true }));
    await t.click('[data-mail-action="save"]'); expect(t.rows[0].visualClassification).toBeNull();
    await t.click('[data-mail-action="templates"]'); await t.click('[data-mail-action="new"]');
    await t.click('[data-mail-action="save"]');
    expect(t.win.document.querySelector('#mailFeedback').textContent).toContain('Elige una clasificación');
    await t.click('[value="FOR_ALL"]'); await t.click('[data-mail-action="save"]');
    expect(t.rows.find(item => item.id === 'created').visualClassification).toBe('FOR_ALL');
    t.dom.window.close();
  });
  it('cancels without writes, restores focus and never opens the editor from trash', async () => {
    const t = await workspace();
    await t.click('[data-mail-action="delete-template"]');
    expect(t.win.document.querySelector('.mail-editor-shell')).toBeNull();
    expect(t.win.document.querySelector('.mail-delete-dialog').textContent).toContain('info@cronox.local');
    expect(t.win.document.querySelector('.mail-delete-dialog').textContent).toContain('Círculo I');
    await t.click('[data-mail-action="delete-cancel"]');
    expect(t.writes()).toBe(0); expect(t.rows).toHaveLength(3);
    expect(t.win.document.activeElement.getAttribute('aria-label')).toBe('Eliminar plantilla');
    t.dom.window.close();
  });
  it('keeps failed cards for retry, serializes double clicks and deletes only the selected id', async () => {
    const t = await workspace({ fail: true });
    await t.click('[data-mail-action="delete-template"]');
    const confirm = t.win.document.querySelector('[data-mail-action="delete-confirm"]');
    confirm.click(); confirm.click(); await tick(); await tick(); await tick();
    expect(t.writes()).toBe(1); expect(t.rows).toHaveLength(3);
    expect(t.win.document.querySelector('.mail-delete-error').textContent).toContain('Conflicto');
    await t.click('[data-mail-action="delete-confirm"]');
    expect(t.rows.map(row => row.id)).toEqual(['t1', 't2']);
    expect(t.win.document.querySelectorAll('.mail-template-card')).toHaveLength(2);
    t.dom.window.close();
  });
  it('blocks published/pending templates and provides explicit resolution routes', async () => {
    const t = await workspace({ blocked: true });
    await t.click('[data-mail-action="delete-template"]');
    expect(t.win.document.querySelector('[data-mail-action="delete-confirm"]').disabled).toBe(true);
    expect(t.win.document.querySelector('[data-mail-action="delete-open-editor"]')).not.toBeNull();
    expect(t.win.document.querySelector('a[href="#section-inbox"]')).not.toBeNull();
    await t.click('[data-mail-action="delete-confirm"]'); expect(t.writes()).toBe(0);
    t.dom.window.close();
  });
  it('returns to the previous valid page after deleting the final item on page two', async () => {
    const t = await workspace({ total: 31 });
    await t.click('[data-mail-action="next"]'); await t.click('[data-mail-action="delete-template"]');
    await t.click('[data-mail-action="delete-confirm"]'); await tick();
    expect(t.win.document.querySelectorAll('.mail-template-card')).toHaveLength(30);
    expect(t.win.document.body.textContent).toContain('Página 1');
    t.dom.window.close();
  });
});
