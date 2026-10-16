import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const root = path.resolve(__dirname, '../../../cronox-front');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('accreditation design selection', () => {
  it.each(['already-visible', 'revealed-later', 'current-navigation'])('loads the original without depending on navigation script order: %s', async mode => {
    const dom = new JSDOM(read('admin.html'), { url: 'http://localhost/admin.html#section-accreditations', runScripts: 'outside-only' });
    const win = dom.window;
    const section = win.document.getElementById('section-accreditations')!;
    const fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ revision: 1, designs: [
      { id: 'original', name: 'Acreditación original', renderer: 'original-v1', active: true, ready: true, revision: 1,
        config: { version: 1, artworkUrl: '/assets/logo_banner.png' } },
    ] }) });
    Object.assign(win, { fetch });
    try {
      if (mode === 'already-visible') section.hidden = false;
      win.eval(read('assets/admin-accreditations.js'));
      if (mode !== 'already-visible') {
        expect(fetch).not.toHaveBeenCalled();
        section.hidden = false;
        if (mode === 'current-navigation') {
          void (win as unknown as { CRONOX_ADMIN_ACCREDITATIONS: { load(): Promise<void> } }).CRONOX_ADMIN_ACCREDITATIONS.load();
        }
      }
      await tick();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(section.querySelectorAll('[data-design-cards] article')).toHaveLength(1);
      expect(section.querySelector('[data-design-cards]')?.textContent).toContain('Acreditación original');
      expect(section.querySelector<HTMLElement>('[data-design-panel]')?.hidden).toBe(true);
      section.querySelector<HTMLButtonElement>('[data-design-select]')!.click();
      await tick();
      expect(section.querySelector('[data-design-selected]')?.textContent).toContain('Activa');
      expect(section.querySelector('form')?.hidden).toBe(false);
      const save = section.querySelector<HTMLButtonElement>('button[type="submit"]')!;
      expect(save.disabled).toBe(true);
      section.querySelector('form')!.dispatchEvent(new win.Event('submit', { cancelable: true }));
      expect(fetch).toHaveBeenCalledTimes(2);
      const name = section.querySelector<HTMLInputElement>('input[name="name"]')!;
      name.value = 'Cambio sin guardar';
      name.dispatchEvent(new win.Event('input', { bubbles: true }));
      expect(save.disabled).toBe(false);
      expect(fetch).toHaveBeenCalledTimes(2);
      section.querySelector<HTMLButtonElement>('[data-design-preview]')!.click();
      expect(section.querySelector('iframe')?.getAttribute('src')).toContain('/api/admin/accreditations/original/preview?');
      section.querySelector<HTMLButtonElement>('[data-design-close]')!.click();
      expect(section.querySelector<HTMLElement>('[data-design-panel]')?.hidden).toBe(true);
      expect(section.querySelector('iframe')?.getAttribute('src')).toBeNull();
      section.querySelector<HTMLButtonElement>('[data-design-select]')!.click();
      await tick();
      expect(section.querySelector<HTMLElement>('[data-design-panel]')?.hidden).toBe(false);
      expect(name.value).toBe('Acreditación original');
      expect(save.disabled).toBe(true);
      expect(fetch.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
    } finally { win.close(); }
  });

  it('shows a recoverable error instead of a silent empty panel when the initial record is absent', async () => {
    const dom = new JSDOM(read('admin.html'), { url: 'http://localhost/admin.html', runScripts: 'outside-only' });
    const section = dom.window.document.getElementById('section-accreditations')!;
    Object.assign(dom.window, { fetch: async () => ({ ok: true, json: async () => ({ revision: 0, designs: [] }) }) });
    try {
      section.hidden = false;
      dom.window.eval(read('assets/admin-accreditations.js'));
      await tick();
      expect(section.querySelector('[role="status"]')?.textContent).toContain('Revisa el registro inicial');
      expect(section.querySelector<HTMLButtonElement>('[data-design-reload]')?.disabled).toBe(false);
    } finally { dom.window.close(); }
  });

  it('sends a configuration write only after fields change and Save is submitted', async () => {
    const dom = new JSDOM(read('admin.html'), { url: 'http://localhost/admin.html', runScripts: 'outside-only' });
    const win = dom.window;
    const design = { id: 'original', name: 'Acreditación original', renderer: 'original-v1', ready: true, active: true, revision: 1,
      config: { version: 1, artworkUrl: '/assets/logo_banner.png' } };
    const fetch = jest.fn().mockImplementation(async (_url: string, options: { method: string; body?: string }) => {
      if (options.method === 'PATCH') {
        const body = JSON.parse(options.body!);
        expect(body.expectedRevision).toBe(1);
        design.name = body.name; design.revision++;
      }
      return { ok: true, json: async () => ({ revision: 1, designs: [design] }) };
    });
    Object.assign(win, { fetch, CRONOX_API: { getCsrfHeaders: async () => ({ 'X-CSRF-Token': 'test' }) } });
    try {
      const section = win.document.getElementById('section-accreditations')!;
      section.hidden = false;
      win.eval(read('assets/admin-accreditations.js'));
      await tick();
      section.querySelector<HTMLButtonElement>('[data-design-select]')!.click();
      await tick();
      const name = section.querySelector<HTMLInputElement>('input[name="name"]')!;
      name.value = 'Nombre cambiado expresamente';
      name.dispatchEvent(new win.Event('input', { bubbles: true }));
      expect(fetch.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
      section.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
      await tick();
      expect(fetch.mock.calls.filter(([, options]) => options.method === 'PATCH')).toHaveLength(1);
      expect(design.name).toBe('Nombre cambiado expresamente');
      expect(section.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    } finally { win.close(); }
  });

  it('reviews and previews an inactive design without activation; activation uses the server revision', async () => {
    const dom = new JSDOM(read('admin.html'), { url: 'http://localhost/admin.html', runScripts: 'outside-only' });
    const win = dom.window;
    let revision = 4;
    const designs = [
      { id: 'original', name: 'Acreditación original', renderer: 'original-v1', ready: true, active: true, revision: 0, config: { version: 1, artworkUrl: '/assets/logo_banner.png' } },
      { id: 'test-only', name: 'Solo pruebas', renderer: 'original-v1', ready: true, active: false, revision: 0, config: { version: 1, artworkUrl: '/assets/logo_banner.png' } },
    ];
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    Object.assign(win, {
      CRONOX_API: { getCsrfHeaders: async () => ({ 'X-CSRF-Token': 'test' }) },
      fetch: async (url: string, options: { method: string; body?: string }) => {
        calls.push({ url, ...options });
        if (options.method === 'POST') {
          expect(JSON.parse(options.body!)).toEqual({ expectedRevision: 4 });
          designs.forEach(design => { design.active = design.id === 'test-only'; }); revision++;
        }
        return { ok: true, json: async () => ({ revision, designs }) };
      },
    });
    try {
      win.eval(read('assets/admin-accreditations.js'));
      await (win as unknown as { CRONOX_ADMIN_ACCREDITATIONS: { load(): Promise<void> } }).CRONOX_ADMIN_ACCREDITATIONS.load();
      const doc = win.document;
      (doc.querySelector('[data-design-select="test-only"]') as HTMLButtonElement).click();
      await tick();
      expect(doc.querySelector('[data-design-selected]')?.textContent).toContain('Inactiva');
      (doc.querySelector('[data-design-preview]') as HTMLButtonElement).click();
      expect(doc.querySelector('#section-accreditations iframe')?.getAttribute('src')).toContain('/api/admin/accreditations/test-only/preview?');
      expect(calls.map(call => call.method)).toEqual(['GET', 'GET']);
      const card = doc.querySelector('[data-design-select="test-only"]')!.parentElement!;
      (card.querySelector('.primary') as HTMLButtonElement).click();
      await tick();
      expect(calls[2].url).toBe('/api/admin/accreditations/test-only/activate');
      expect(doc.querySelector('[data-design-selected]')?.textContent).toContain('Activa');
      expect(doc.querySelector('[data-design-select="original"]')?.parentElement?.textContent).toContain('Inactiva');
    } finally { win.close(); }
  });

  it('loads the active design from the server on every visit, preserves data nodes and fails closed', async () => {
    const dom = new JSDOM(read('profile.html'), { url: 'http://localhost/profile.html', runScripts: 'outside-only' });
    const win = dom.window;
    const section = win.document.querySelector('[data-profile-section="accreditation"]')!;
    const identity = section.querySelector('.accreditation-id')!;
    identity.textContent = 'ID: EXISTING';
    const fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'original', renderer: 'original-v1', config: { version: 1, artworkUrl: '/assets/logo_banner.png' } }) });
    Object.assign(win, { fetch });
    try {
      win.eval(read('assets/accreditation-designs.js'));
      const api = (win as unknown as { CRONOX_ACCREDITATION_DESIGNS: { loadActive(root: Element): Promise<void> } }).CRONOX_ACCREDITATION_DESIGNS;
      await api.loadActive(section); await api.loadActive(section);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(fetch).toHaveBeenCalledWith('/api/accreditations/active', { cache: 'no-store', signal: expect.anything() });
      expect(section.querySelector('.accreditation-id')).toBe(identity);
      expect(identity.textContent).toBe('ID: EXISTING');
      fetch.mockResolvedValue({ ok: true, json: async () => ({ renderer: 'missing' }) });
      await expect(api.loadActive(section)).rejects.toThrow('Diseño no disponible');
    } finally { win.close(); }
  });
});
