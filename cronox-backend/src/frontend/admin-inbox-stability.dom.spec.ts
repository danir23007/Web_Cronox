import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('CRONOX mailbox background reconciliation', () => {
  async function fixture() {
    const dom = new JSDOM('<section class="admin-section"><div id="mailboxWorkspace"></div></section>', { url: 'http://localhost/admin.html', runScripts: 'outside-only', pretendToBeVisual: true });
    const win = dom.window as any;
    const messages: any[] = [{ id: 'a', mailboxId: 'box', subject: 'Coincide', seen: false, date: '2026-10-04T10:00:00Z' }];
    let pulse: () => void, intervals = 0, fail = false, hold: ((body: any) => void) | null = null, delay = false;
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    const response = (body: any, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => body });
    win.setInterval = (fn: () => void) => { pulse = fn; intervals++; return 1; };
    win.scrollBy = jest.fn();
    win.CRONOX_API = { API_BASE: '', getCsrfHeaders: async () => ({}) };
    win.fetch = jest.fn((url: string) => {
      if (url.endsWith('/overview')) return Promise.resolve(response({ boxes: [{ id: 'box', name: 'Soporte', address: 'support@example.test', canSend: true, unread: messages.length, folders: [{ id: 'inbox', path: 'INBOX', specialUse: '\\Inbox' }] }] }));
      if (url.includes('/notices?')) return Promise.resolve(response({ cursor: 'now', notices: [] }));
      if (url.includes('/messages?')) {
        const q = new URL(url, 'http://localhost').searchParams;
        const rows = messages.filter(m => !q.get('search') || m.subject.includes(q.get('search')));
        if (delay) { delay = false; return new Promise(resolve => { hold = body => resolve(response(body)); }); }
        return Promise.resolve(response(fail ? { message: 'CONNECTION_FAILED' } : { messages: rows, pagination: { total: rows.length, pages: 1 } }, !fail));
      }
      throw Error('Unexpected fixture request: ' + url);
    });
    win.document.documentElement.dataset.adminAuthState = 'authorized';
    win.eval(readFileSync(join(__dirname, '../../../cronox-front/assets/admin-inbox.js'), 'utf8'));
    await win.CRONOX_INBOX.load(); await tick();
    return { dom, win, messages, tick, intervals: () => intervals, poll: async () => { pulse!(); await tick(); await tick(); }, fail: () => { fail = true; }, delay: () => { delay = true; }, release: (body: any) => hold!(body) };
  }

  it('does not mutate lists, filters or counters on unchanged cycles; adds only affected rows', async () => {
    const f = await fixture();
    try {
      const doc = f.win.document, row = doc.querySelector('[data-message=a]'), filter = doc.querySelector('[data-folder-id]'), search = doc.querySelector('[data-search]'), box = doc.querySelector('[data-box=box]');
      search.focus();
      const mutations: any[] = [];
      const observer = new f.win.MutationObserver((rs: any[]) => mutations.push(...rs));
      observer.observe(doc.querySelector('.mail-layout'), { subtree: true, childList: true, attributes: true, characterData: true });
      for (let n = 0; n < 4; n++) await f.poll();
      expect(mutations).toHaveLength(0);
      f.messages.unshift({ ...f.messages[0], id: 'new', subject: 'Nueva llegada' });
      await f.poll(); await f.poll();
      expect(doc.querySelectorAll('[data-message=new]')).toHaveLength(1);
      expect(doc.querySelector('[data-message=a]')).toBe(row);
      expect(doc.querySelector('[data-folder-id]')).toBe(filter);
      expect(doc.querySelector('[data-box=box]')).toBe(box);
      expect(doc.activeElement).toBe(search);
      expect(f.win.fetch.mock.calls.every(([url]: any[]) => !url.includes('/action'))).toBe(true);
      search.value = 'Coincide'; search.dispatchEvent(new f.win.Event('input', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 275));
      f.messages.unshift({ ...f.messages[0], id: 'excluded', subject: 'Fuera del filtro' }); await f.poll();
      expect(doc.querySelector('[data-message=excluded]')).toBeNull();
      expect(box.textContent).toContain('3 no leídos');
      await f.win.CRONOX_INBOX.load(); await f.win.CRONOX_INBOX.load();
      expect(f.intervals()).toBe(1);
    } finally { f.dom.window.close(); }
  });

  it('discards late metadata, prevents overlapping pulses and shows errors without replacing rows', async () => {
    const f = await fixture();
    try {
      const doc = f.win.document;
      f.delay(); await f.poll();
      const calls = f.win.fetch.mock.calls.length;
      await f.poll(); expect(f.win.fetch.mock.calls.length).toBe(calls);
      const search = doc.querySelector('[data-search]'); search.value = 'Coincide'; search.dispatchEvent(new f.win.Event('input', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 275));
      f.release({ messages: [{ id: 'stale', subject: 'Old', mailboxId: 'box' }], pagination: { total: 1, pages: 1 } }); await f.tick(); await f.tick();
      expect(doc.querySelector('[data-message=stale]')).toBeNull();
      const row = doc.querySelector('[data-message=a]'); f.fail(); await f.poll();
      expect(doc.querySelector('[data-message=a]')).toBe(row);
      expect(doc.querySelector('[data-feedback]').textContent).toContain('proveedor');
      doc.querySelector('section').hidden = true; await f.tick();
      const before = f.win.fetch.mock.calls.filter(([url]: any[]) => url.includes('/messages?')).length;
      await f.poll();
      expect(f.win.fetch.mock.calls.filter(([url]: any[]) => url.includes('/messages?'))).toHaveLength(before);
    } finally { f.dom.window.close(); }
  });
});
