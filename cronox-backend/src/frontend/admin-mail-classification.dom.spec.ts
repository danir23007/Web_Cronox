import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

async function workspace(options: { fail?: boolean; malformed?: boolean; explicit?: boolean; family?: boolean } = {}) {
  const dom = new JSDOM('<p id="mailFeedback"></p><div id="mailWorkspace"></div>', { url: 'http://localhost/admin.html', runScripts: 'outside-only' });
  const win = dom.window as any;
  const folders = [1, 2, 3, 4, 5].map(n => ({ id: 'f' + n, name: 'Círculo ' + n, _count: { templates: 1 } }));
  const rows = folders.map((f, i) => ({ id: 't' + (i + 1), folderId: f.id, name: 'Diseño ' + (i + 1),
    subject: 'Asunto propio ' + (i + 1), preheader: '', purpose: 'ORDER_CONFIRMATION',
    visualClassification: 'DIFFERENT', revision: 1, updatedAt: new Date().toISOString(),
    document: { blocks: [{ type: 'text', text: 'Contenido propio ' + i }] },
    familyId: options.family ? 'family' : null, textOverride: null, text: 'Texto propio ' + i, signatureMode: 'none' }));
  let fail = options.fail;
  const api = jest.fn(async (path: string, method = 'GET', body?: any): Promise<any> => {
    if (!path) return [{ key: 'ORDERS', email: 'orders@example.invalid', counts: { folders: 5, templates: 5 } }];
    if (path.endsWith('/initialize')) return {};
    if (path.endsWith('/folders')) return folders;
    if (path.endsWith('/signatures') || path === '/catalog') return [];
    if (path.includes('/templates?')) return { items: rows.filter(r => r.folderId === new URLSearchParams(path.split('?')[1]).get('folderId')), total: 1 };
    if (path.endsWith('/draft-targets')) return { purpose: 'ORDER_CONFIRMATION', requiresExplicitSelection: Boolean(options.explicit), targets: rows.map((r, i) => ({ ...r, folderName: folders[i].name, current: r.id === 't3' })) };
    const current = rows.find(r => path.includes('/templates/' + r.id));
    if (path.endsWith('/drafts') && method === 'PATCH') {
      if (fail) { fail = false; throw new Error('Conflicto controlado'); }
      if (options.malformed) return { template: current, updated: [] };
      const selected = rows.filter(r => body.targets.some((t: any) => t.id === r.id));
      for (const r of selected) { r.visualClassification = body.visualClassification; r.revision++; }
      return { template: { ...current }, mode: body.saveMode, updated: selected.map(r => ({ id: r.id, revision: r.revision, visualClassification: r.visualClassification, folderName: folders.find(f => f.id === r.folderId)!.name })) };
    }
    return { ...current };
  });
  win.CRONOX_API = { admin: { mailRequest: api } }; win.confirm = () => true;
  for (const file of ['admin-mail-document.js', 'admin-mails.js']) win.eval(readFileSync(join(__dirname, '../../../cronox-front/assets', file), 'utf8'));
  const settle = async () => { await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0)); };
  const click = async (selector: string) => { const e = win.document.querySelector(selector); expect(e).not.toBeNull(); e.click(); await settle(); };
  await win.CRONOX_MAILS.load(); await click('[data-mail-action=account]'); await click('[data-mail-action=circle][data-id=f3]'); await click('[data-mail-action=edit]');
  return { dom, win, api, rows, click };
}
describe('classification-only circle selection', () => {
  it('retains the color and exact selection after failure, confirms persisted response, and reopens correctly', async () => {
    const t = await workspace({ fail: true });
    const content = t.rows.map(r => ({ subject: r.subject, document: r.document, text: r.text }));
    await t.click('[value=FOR_ALL]'); await t.click('[data-mail-action=save]');
    expect(t.win.document.querySelector('.mail-save-modal').textContent).toContain('solo la clasificación');
    await t.click('[data-draft-target=t1]'); await t.click('[data-draft-target=t5]');
    await t.click('[data-mail-action=save-selected]');
    expect(t.win.document.querySelector('.mail-save-error').textContent).toContain('Conflicto controlado');
    expect([...t.win.document.querySelectorAll('[data-draft-target]:checked')].map((e: any) => e.dataset.draftTarget)).toEqual(['t1', 't3', 't5']);
    expect(t.rows.every(r => r.visualClassification === 'DIFFERENT')).toBe(true);
    await t.click('[data-mail-action=save-selected]');
    expect(t.rows.map(r => r.visualClassification)).toEqual(['FOR_ALL', 'DIFFERENT', 'FOR_ALL', 'DIFFERENT', 'FOR_ALL']);
    expect(t.rows.map(r => ({ subject: r.subject, document: r.document, text: r.text }))).toEqual(content);
    expect(t.win.document.querySelector('#mailFeedback').textContent).toBe('Clasificación visual aplicada en Círculo 1, Círculo 3 y Círculo 5.');
    await t.click('[data-mail-action=templates]'); await t.click('[data-mail-action=edit]');
    expect(t.win.document.querySelector('[name=mailVisualClassification]:checked').value).toBe('FOR_ALL');
    const writes = t.api.mock.calls.filter(([, method]) => method === 'PATCH');
    expect(writes[0][2]).toMatchObject({ saveMode: 'classification', targets: [{ id: 't1', revision: 1 }, { id: 't3', revision: 1 }, { id: 't5', revision: 1 }] });
    t.dom.window.close();
  });
  it('keeps the editor and selection when the response does not confirm all targets', async () => {
    const t = await workspace({ malformed: true });
    await t.click('[value=UNIQUE]'); await t.click('[data-mail-action=save]'); await t.click('[data-draft-target=t1]'); await t.click('[data-mail-action=save-selected]');
    expect(t.win.document.querySelector('.mail-save-modal')).not.toBeNull();
    expect(t.win.document.querySelector('.mail-save-error').textContent).toContain('no ha confirmado');
    expect(t.win.document.querySelector('#mailFeedback').dataset.kind).toBe('error');
    expect(t.rows.every(r => r.visualClassification === 'DIFFERENT')).toBe(true);
    t.dom.window.close();
  });
  it('cancels without writes and requires explicit candidate selection for unlinked designs', async () => {
    const t = await workspace({ explicit: true });
    await t.click('[value=UNIQUE]'); await t.click('[data-mail-action=save]');
    expect(t.win.document.querySelector('.mail-save-modal').textContent).toContain('No hay una relación guardada');
    expect(t.win.document.querySelectorAll('[data-draft-target]:checked')).toHaveLength(1);
    await t.click('[data-draft-target=t5]'); await t.click('.mail-save-modal [data-mail-action=close-modal]');
    expect(t.api.mock.calls.some(([, method]) => method === 'PATCH')).toBe(false);
    expect(t.rows.every(r => r.visualClassification === 'DIFFERENT')).toBe(true);
    await t.click('[data-mail-action=save]'); await t.click('[data-mail-action=save-selected]');
    expect(t.api.mock.calls.find(([, method]) => method === 'PATCH')![2]).toMatchObject({ explicitSelection: true, targets: [{ id: 't3', revision: 1 }] });
    t.dom.window.close();
  });
  it('offers family circles for a color change without materializing a plaintext override', async () => {
    const t = await workspace({ family: true });
    await t.click('[value=FOR_ALL]'); await t.click('[data-mail-action=save]'); await t.click('[data-draft-target=t1]'); await t.click('[data-mail-action=save-selected]');
    const body = t.api.mock.calls.find(([, method]) => method === 'PATCH')![2];
    expect(body.saveMode).toBe('classification'); expect(body).not.toHaveProperty('textOverride');
    t.dom.window.close();
  });
});
