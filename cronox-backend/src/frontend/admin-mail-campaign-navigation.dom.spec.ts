import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('CRONOX independent campaign entry', () => {
  function fixture(canSend = true, deferredOptions = false) {
    const dom = new JSDOM('<button data-nav-target="section-mail-campaign"></button><section class="admin-section"><div id="mailboxWorkspace"></div></section>', {
      url: 'http://localhost/admin.html#section-mail-campaign', runScripts: 'outside-only', pretendToBeVisual: true,
    });
    const win = dom.window as any;
    const requests: { path: string; method: string }[] = [];
    let intervals = 0, resolveOptions: (() => void) | undefined;
    const response = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    win.setInterval = () => { intervals++; return 1; };
    win.CRONOX_API = { API_BASE: '', getCsrfHeaders: async () => ({}) };
    win.fetch = async (url: string, options: any = {}) => {
      const path = new URL(url, 'http://localhost').pathname;
      requests.push({ path, method: options.method || 'GET' });
      if (path.endsWith('/overview')) return response({ boxes: [
        { id: 'info', address: 'info@cronox.es', name: 'Info', canSend, folders: [{ id: 'inbox', path: 'INBOX', specialUse: '\\Inbox' }] },
        { id: 'support', address: 'support@cronox.es', name: 'Support', canSend: true, folders: [] },
      ] });
      if (path.endsWith('/campaign-options')) {
        if (deferredOptions) await new Promise<void>(resolve => { resolveOptions = resolve; });
        return response({ families: [], variants: [] });
      }
      if (path.endsWith('/messages')) return response({ messages: [], pagination: { total: 0, pages: 1 } });
      throw Error('Unexpected simulated API: ' + path);
    };
    win.document.documentElement.dataset.adminAuthState = 'authorized';
    win.eval(readFileSync(join(__dirname, '../../../cronox-front/assets/admin-inbox.js'), 'utf8'));
    return { dom, win, requests, intervals: () => intervals, release: () => resolveOptions!() };
  }

  it('opens the existing composer directly without fetching messages or saving a draft', async () => {
    const f = fixture();
    try {
      await f.win.CRONOX_INBOX.load();
      expect(f.win.document.querySelector('#mailCampaignForm')).not.toBeNull();
      expect(f.win.document.querySelector('.mail-toolbar h2').textContent).toBe('Nueva campaña');
      expect(f.win.document.querySelector('[data-compose]')).toBeNull();
      expect(f.requests.some(r => r.path.endsWith('/messages'))).toBe(false);
      expect(f.requests.filter(r => r.path.endsWith('/campaign-options')).map(r => r.path)).toEqual(['/api/admin/mailbox/boxes/info/campaign-options']);
      expect(f.requests.every(r => r.method === 'GET')).toBe(true);
      expect(f.intervals()).toBe(1);
    } finally { f.dom.window.close(); }
  });

  it('fences a delayed composer when navigation requests the mailbox list', async () => {
    const f = fixture(true, true);
    try {
      const campaign = f.win.CRONOX_INBOX.load('campaign');
      while (!f.requests.some(r => r.path.endsWith('/campaign-options'))) await new Promise(resolve => setTimeout(resolve, 0));
      f.win.history.replaceState(null, '', '#section-inbox');
      const mailbox = f.win.CRONOX_INBOX.load('list');
      f.release();
      await Promise.all([campaign, mailbox]);
      expect(f.win.document.querySelector('#mailboxWorkspace').dataset.view).toBe('list');
      expect(f.win.document.querySelector('#mailCampaignForm')).toBeNull();
      expect(f.win.document.querySelector('.mail-toolbar h2').textContent).toBe('Buzones');
      expect(f.intervals()).toBe(1);
    } finally { f.dom.window.close(); }
  });

  it('keeps Info send permissions even when another mailbox permits sending', async () => {
    const f = fixture(false);
    try {
      await f.win.CRONOX_INBOX.load();
      expect(f.win.document.querySelector('[data-nav-target=section-mail-campaign]').disabled).toBe(true);
      expect(f.win.document.querySelector('#mailCampaignForm')).toBeNull();
      expect(f.requests.some(r => r.path.endsWith('/campaign-options'))).toBe(false);
      expect(f.win.document.querySelector('[data-feedback]').textContent).not.toBe('');
    } finally { f.dom.window.close(); }
  });
});
