import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Mailbox system folder labels', () => {
  it('keeps an available body when a later status check finds the provider message gone', async () => {
    const dom = new JSDOM('<div id="mailboxWorkspace"></div>', {url:'http://localhost/admin.html',runScripts:'outside-only',pretendToBeVisual:true});
    const win=dom.window as any;
    let poll:()=>void=()=>{};
    win.setInterval=(fn:()=>void)=>{poll=fn;return 1;};
    win.clearInterval=()=>{};
    win.CRONOX_API={API_BASE:'',getCsrfHeaders:async()=>({})};
    const box={id:'box',name:'Fixture',address:'support@example.test',active:true,canSend:true,folders:[{id:'inbox',path:'INBOX',specialUse:'\\Inbox'}]};
    win.fetch=jest.fn(async(url:string)=>({ok:!url.endsWith('/status'),status:url.endsWith('/status')?404:200,json:async()=>
      url.endsWith('/overview')?{boxes:[box]}:url.endsWith('/status')?{message:'MAILBOX_MESSAGE_UNAVAILABLE'}:
      url.includes('/messages?')?{messages:[{id:'a',mailboxId:'box',subject:'Cached',seen:true}],pagination:{pages:1,total:1}}:
      {id:'a',mailboxId:'box',subject:'Cached',seen:true,envelope:{},files:[],body:{text:'Available cached body',html:''}}}));
    try {
      win.document.documentElement.dataset.adminAuthState='authorized';
      win.eval(readFileSync(join(__dirname,'../../../cronox-front/assets/admin-inbox.js'),'utf8'));
      await win.CRONOX_INBOX.load();
      win.document.querySelector('[data-message="a"]').click();
      await new Promise(resolve=>setTimeout(resolve,0));
      poll(); await new Promise(resolve=>setTimeout(resolve,0));
      expect(win.document.querySelector('.mail-reader iframe').srcdoc).toContain('Available cached body');
      expect(win.document.querySelector('[data-feedback]').textContent).toContain('ya no está disponible');
      expect(win.document.querySelector('#mailboxWorkspace').dataset.view).toBe('read');
    } finally {dom.window.close();}
  });
  it.each([false, true])(
    'ignores a late reader response even when cancellation is ignored (error=%s)',
    async (failure) => {
      const dom = new JSDOM('<div id="mailboxWorkspace"></div>', {
        url: 'http://localhost/admin.html',
        runScripts: 'outside-only',
      });
      const win = dom.window as any;
      const box = {
        id: 'box',
        name: 'Fixture',
        address: 'support@example.test',
        active: true,
        canSend: true,
        folders: [{ id: 'inbox', path: 'INBOX', specialUse: '\\Inbox' }],
      };
      const resolvers: Record<string, (value: any) => void> = {};
      const response = (body: any, ok = true) => ({
        ok,
        status: ok ? 200 : 503,
        json: async () => body,
      });
      win.CRONOX_API = { API_BASE: '', getCsrfHeaders: async () => ({}) };
      win.fetch = jest.fn((url: string) => {
        if (url.endsWith('/overview'))
          return Promise.resolve(response({ boxes: [box] }));
        if (url.includes('/messages?'))
          return Promise.resolve(
            response({
              messages: ['a', 'b'].map((id) => ({
                id,
                subject: id,
                mailboxId: 'box',
                seen: true,
              })),
              pagination: { pages: 1, total: 2 },
            }),
          );
        const id = url.split('/').at(-1)!;
        return new Promise((resolve) => {
          resolvers[id] = resolve;
        }); // Intentionally ignore AbortSignal.
      });
      const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
      try {
        win.eval(
          readFileSync(
            join(__dirname, '../../../cronox-front/assets/admin-inbox.js'),
            'utf8',
          ),
        );
        await win.CRONOX_INBOX.load();
        win.document.querySelector('[data-message="a"]').click();
        await tick();
        win.document.querySelector('[data-message="b"]').click();
        await tick();
        resolvers.b(
          response({
            id: 'b',
            mailboxId: 'box',
            subject: 'Current message',
            seen: true,
            envelope: {},
            files: [],
            body: { text: 'Current body', html: '' },
          }),
        );
        await tick();
        resolvers.a(
          response(
            failure
              ? { message: 'MAILBOX_BUSY' }
              : {
                  id: 'a',
                  mailboxId: 'box',
                  subject: 'Old message',
                  seen: true,
                  envelope: {},
                  files: [],
                  body: { text: 'Old body', html: '' },
                },
            !failure,
          ),
        );
        await tick();
        expect(win.document.querySelector('.mail-reader h3').textContent).toBe(
          'Current message',
        );
        expect(
          win.document.querySelector('.mail-reader iframe').srcdoc,
        ).toContain('Current body');
        expect(win.document.querySelector('[data-feedback]').textContent).toBe(
          '',
        );
        expect(win.document.querySelector('[data-retry-body]')).toBeNull();
      } finally {
        dom.window.close();
      }
    },
  );
  it('uses special-use first, recognises equivalent paths, preserves custom names and checkbox IDs', async () => {
    const examples = [
      ['INBOX', null, 'Bandeja de entrada'],
      ['INBOX.Sent', null, 'Enviados'],
      ['Sent', null, 'Enviados'],
      ['INBOX.Drafts', null, 'Borradores'],
      ['Drafts', null, 'Borradores'],
      ['INBOX.Trash', null, 'Papelera'],
      ['Trash', null, 'Papelera'],
      ['INBOX.Junk', null, 'Correo no deseado'],
      ['Junk', null, 'Correo no deseado'],
      ['Spam', null, 'Correo no deseado'],
      ['INBOX/Spam', null, 'Correo no deseado'],
      ['Sent Items', null, 'Enviados'],
      ['Deleted Messages', null, 'Papelera'],
      ['Proveedor personalizado', '\\Inbox', 'Bandeja de entrada'],
      ['Proveedor personalizado', '\\Sent', 'Enviados'],
      ['Proveedor personalizado', '\\Drafts', 'Borradores'],
      ['Proveedor personalizado', '\\Trash', 'Papelera'],
      ['Proveedor personalizado', '\\Junk', 'Correo no deseado'],
      ['Sent', '\\Archive', 'Sent'],
      ['INBOX.Sent.Project', null, 'INBOX.Sent.Project'],
      ['Proyectos 2026', null, 'Proyectos 2026'],
    ];
    const folders = examples.map(([path, specialUse], i) => ({
      id: 'folder-' + i,
      path,
      specialUse,
    }));
    const snapshot = JSON.stringify(folders);
    const dom = new JSDOM('<div id="mailboxWorkspace"></div>', {
      url: 'http://localhost/admin.html',
      runScripts: 'outside-only',
    });
    const win = dom.window as any;
    win.CRONOX_API = { API_BASE: '', getCsrfHeaders: async () => ({}) };
    win.fetch = jest.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url.endsWith('/overview')
          ? {
              boxes: [
                {
                  id: 'box',
                  name: 'Info',
                  address: 'info@cronox.es',
                  unread: 0,
                  canSend: true,
                  active: true,
                  folders,
                },
              ],
            }
          : { messages: [], pagination: { total: 0, pages: 1 } },
    }));
    try {
      win.eval(
        readFileSync(
          join(__dirname, '../../../cronox-front/assets/admin-inbox.js'),
          'utf8',
        ),
      );
      await win.CRONOX_INBOX.load();
      const labels = [
        ...win.document.querySelectorAll('[data-folders] label'),
      ] as HTMLElement[];
      examples.forEach(([, , label], i) => {
        expect(labels[i].textContent).toContain('Información · ' + label);
        expect(labels[i].querySelector('input')!.dataset.folderId).toBe(
          'folder-' + i,
        );
        expect(labels[i].querySelector('input')!.type).toBe('checkbox');
      });
      win.document.querySelector('[data-box="box"]').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const single = [
        ...win.document.querySelectorAll('[data-folders] label'),
      ] as HTMLElement[];
      examples.forEach(([, , label], i) =>
        expect(single[i].textContent!.trim()).toBe(label),
      );
      expect(JSON.stringify(folders)).toBe(snapshot);
    } finally {
      dom.window.close();
    }
  });
});
