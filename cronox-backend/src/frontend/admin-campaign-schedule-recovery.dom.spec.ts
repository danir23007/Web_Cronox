import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('campaign scheduling response recovery', () => {
  async function fixture(mode: 'lost' | 'refresh' | 'rollback') {
    const dom = new JSDOM('<section class="admin-section"><div id="mailboxWorkspace"></div></section>', {
      url: 'http://localhost/admin.html', runScripts: 'outside-only', pretendToBeVisual: true,
    });
    const win = dom.window as any, calls: any[] = [];
    win.setInterval = () => 1;
    win.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    win.HTMLDialogElement.prototype.close = function () { this.open = false; };
    win.CRONOX_API = { API_BASE: '', getCsrfHeaders: async () => ({}) };
    const draft = { id: 'campaign-draft:INFO:BLACK_FRIDAY_NUMBERS_2026', mailboxId: 'info', revision: 7, mode: 'campaign', status: 'DRAFT', familyId: 'family', campaignName: 'Guardado', circles: [1,2,3,4,5], files: [], campaigns: [] };
    const campaign = { id: 'scheduled', draftId: draft.id, status: 'SCHEDULED', familyName: 'Black Friday', count: 100, scheduledAt: '2099-11-26T20:00:00Z', previews: [] };
    let submitted = false;
    const response = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => body });
    win.fetch = jest.fn(async (url: string, options: any = {}) => {
      const path = new URL(url, 'http://localhost').pathname, body = options.body ? JSON.parse(options.body) : null;
      calls.push({ path, body, method: options.method });
      if (path.endsWith('/overview')) return response({ sendEnabled: true, workerEnabled: true, boxes: [{ id: 'info', address: 'info@cronox.es', name: 'Info', active: true, canSend: true, folders: [] }] });
      if (path.endsWith('/messages')) return response({ messages: [], pagination: { total: 0, pages: 1 } });
      if (path.endsWith('/drafts')) return response([draft]);
      if (path.includes('/drafts/')) {
        if (submitted && mode === 'refresh') throw Error('Draft refresh unavailable');
        return response(submitted && mode !== 'rollback' ? { ...draft, status: 'SCHEDULED', campaigns: [campaign] } : draft);
      }
      if (path.endsWith('/campaign-options')) return response({ families: [{ id: 'family', name: 'Black Friday' }], variants: [] });
      if (path.endsWith('/campaign-audience')) return response({ count: 100, totalUsers: 100, excluded: [], blocked: [], previews: [], previewHash: 'a'.repeat(64), family: { id: 'family', name: 'Black Friday' }, policy: { ready: true, reasons: [] } });
      if (path.endsWith('/schedule-preview')) return response({ scheduledAt: campaign.scheduledAt });
      if (path.endsWith('/campaign') && options.method === 'POST') {
        submitted = true;
        if (mode === 'lost') throw Error('Response lost');
        return mode === 'rollback' ? response({ message: 'MAILBOX_DATABASE_UNAVAILABLE', reference: 'safe-reference' }, false) : response(campaign);
      }
      if (path.includes('/campaign-requests/')) return response({ campaign: mode === 'rollback' ? null : campaign });
      if (path.endsWith('/campaigns/scheduled')) {
        if (mode === 'refresh') throw Error('Progress refresh unavailable');
        return response(campaign);
      }
      throw Error('Unexpected simulated request: ' + path);
    });
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    const until = async (predicate: () => any) => { for (let i = 0; i < 40 && !predicate(); i++) await tick(); expect(predicate()).toBeTruthy(); };
    win.document.documentElement.dataset.adminAuthState = 'authorized';
    win.eval(readFileSync(join(__dirname, '../../../cronox-front/assets/admin-inbox.js'), 'utf8'));
    await win.CRONOX_INBOX.load();
    win.document.querySelector('[data-drafts]').click(); await until(() => win.document.querySelector('[data-draft]'));
    win.document.querySelector('[data-draft]').click(); await until(() => win.document.querySelector('[data-schedule]'));
    const date = win.document.querySelector('[data-schedule]'); date.value = '2099-11-26T21:00'; date.dispatchEvent(new win.Event('input', { bubbles: true }));
    await until(() => !win.document.querySelector('[data-schedule-send]').disabled);
    return { dom, win, calls, until, tick };
  }

  it.each(['lost', 'refresh'] as const)('shows the persisted schedule after a %s failure with one POST', async mode => {
    const f = await fixture(mode);
    try {
      f.win.document.querySelector('[data-schedule-send]').click();
      await f.until(() => f.win.document.querySelector('dialog [data-confirm]'));
      f.win.document.querySelector('dialog [data-confirm]').click();
      await f.until(() => f.win.document.querySelector('[data-feedback]').textContent.includes('Campaña confirmada'));
      expect(f.win.document.querySelector('[data-audience-count]').textContent).toContain('100 destinatarios');
      expect(f.win.document.querySelector('[data-schedule-send]')).toBeNull();
      expect(f.calls.filter(c => c.method === 'POST' && c.path.endsWith('/campaign'))).toHaveLength(1);
      expect(f.calls.some(c => c.path.includes('/campaign-requests/'))).toBe(mode === 'lost');
    } finally { f.dom.window.close(); }
  });

  it('keeps form values and the same request key when rollback is confirmed', async () => {
    const f = await fixture('rollback');
    try {
      const name = f.win.document.querySelector('[name=campaignName]'); name.value = 'Mi cambio reciente'; name.dispatchEvent(new f.win.Event('input', { bubbles: true }));
      for (let i = 0; i < 2; i++) {
        f.win.document.querySelector('[data-schedule-send]').click(); await f.until(() => f.win.document.querySelector('dialog [data-confirm]'));
        f.win.document.querySelector('dialog [data-confirm]').click();
        await f.until(() => f.calls.filter(c => c.path.includes('/campaign-requests/')).length === i + 1);
        await f.until(() => !f.win.document.querySelector('[data-schedule-send]').disabled);
      }
      expect(name.value).toBe('Mi cambio reciente');
      expect(f.win.document.querySelector('[data-schedule]').value).toBe('2099-11-26T21:00');
      const posts = f.calls.filter(c => c.method === 'POST' && c.path.endsWith('/campaign'));
      expect(posts).toHaveLength(2); expect(posts[0].body.requestKey).toBe(posts[1].body.requestKey);
      expect(f.win.document.querySelector('[data-feedback]').textContent).toContain('safe-reference');
    } finally { f.dom.window.close(); }
  });
});
