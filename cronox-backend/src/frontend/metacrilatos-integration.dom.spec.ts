import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const root = path.resolve(__dirname, '../../../cronox-front');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const design = { id: 'metacrilatos', name: 'METACRILATOS', renderer: 'metacrilatos-v1', config: { version: 1 } };
const person = { circleLevel: 3, name: 'Daniel Rivas', createdAt: '2020-01-01T23:30:00Z', registrationNumber: 42, visibleId: 'stable-a', qrDataUrl: 'data:image/png;base64,AA==' };

describe('METACRILATOS integration and privacy boundaries', () => {
  function setup() {
    const dom = new JSDOM(read('profile.html'), { url: 'http://localhost/profile.html', runScripts: 'outside-only' });
    const win = dom.window as any;
    const destroy = jest.fn();
    const mount = jest.fn((host, data) => {
      host.textContent = data.name;
      return { destroy, ready: Promise.resolve() };
    });
    win.CRONOX_METACRILATOS = { mount };
    win.eval(read('assets/accreditation-designs.js'));
    return { dom, win, mount, destroy, api: win.CRONOX_ACCREDITATION_DESIGNS,
      section: win.document.querySelector('[data-profile-section="accreditation"]') };
  }

  it('fetches personal data from the authorized endpoint and restores the original artwork and controls', async () => {
    const { dom, win, mount, destroy, api, section } = setup();
    try {
      const image = section.querySelector('.accreditation-book-art');
      const originalSrc = image.getAttribute('src');
      const promotion = section.querySelector('.accreditation-upgrade');
      const parent = promotion.parentNode;
      win.CRONOX_USER = { id: 999, registrationNumber: 999, circleLevel: 5, name: 'Untrusted browser', publicMemberToken: 'fake' };
      win.fetch = jest.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith('/active') ? design : person }));
      await api.loadActive(section);
      expect(win.fetch.mock.calls.map(([url]) => url)).toEqual(['/api/accreditations/active', '/api/membership/me/accreditation']);
      expect(mount.mock.calls[0][1]).toEqual(person);
      expect(section.querySelector('.accreditation-stage').hidden).toBe(true);
      expect(promotion.parentNode).not.toBe(parent);
      expect(image.getAttribute('src')).toBe(originalSrc);
      await api.apply(section, { id: 'original', renderer: 'original-v1', config: { version: 1, artworkUrl: originalSrc } });
      expect(destroy).toHaveBeenCalledTimes(1);
      expect(section.querySelector('.metacrilatos-host')).toBeNull();
      expect(section.querySelector('.accreditation-stage').hidden).toBe(false);
      expect(promotion.parentNode).toBe(parent);
      expect(image.getAttribute('src')).toBe(originalSrc);
    } finally { dom.window.close(); }
  });

  it('reloads the authorized display number without deriving it from cached profile state or changing the QR', async () => {
    const { dom, win, mount, api, section } = setup();
    try {
      let personal = { ...person };
      win.CRONOX_USER = { id: 999, registrationNumber: 999, identityUid: 'cached-identity' };
      win.fetch = jest.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith('/active') ? design : personal }));
      await api.loadActive(section);
      expect(mount.mock.calls.at(-1)![1]).toEqual(person);
      personal = { ...person, registrationNumber: 41 };
      await api.loadActive(section);
      const updated = mount.mock.calls.at(-1)![1];
      expect(updated.registrationNumber).toBe(41);
      expect(updated.visibleId).toBe(person.visibleId);
      expect(updated.qrDataUrl).toBe(person.qrDataUrl);
      expect(win.fetch.mock.calls.filter(([url]) => url.endsWith('/me/accreditation'))).toHaveLength(2);
    } finally { dom.window.close(); }
  });

  it('discards a late identity response after leaving the view or switching users', async () => {
    const { dom, win, mount, api, section } = setup();
    try {
      let reply: (value: any) => void = () => {};
      win.fetch = jest.fn(async (url: string) => url.endsWith('/active')
        ? { ok: true, json: async () => design }
        : new Promise(resolve => { reply = resolve; }));
      const pending = api.loadActive(section);
      await tick();
      api.destroy(section);
      reply({ ok: true, json: async () => person });
      expect(await pending).toBeNull();
      expect(mount).not.toHaveBeenCalled();
      expect(section.querySelector('.metacrilatos-host')).toBeNull();
    } finally { dom.window.close(); }
  });

  it('destroys a failed preview instance and restores promotion controls on resource failure', async () => {
    const { dom, win, destroy, api, section } = setup();
    try {
      const promotion = section.querySelector('.accreditation-upgrade');
      const parent = promotion.parentNode;
      win.CRONOX_METACRILATOS.mount = () => ({ destroy, ready: Promise.reject(new Error('Asset missing')) });
      await expect(api.apply(section, design, person)).rejects.toThrow('Asset missing');
      expect(destroy).toHaveBeenCalledTimes(1);
      expect(section.querySelector('.metacrilatos-host')).toBeNull();
      expect(promotion.parentNode).toBe(parent);
    } finally { dom.window.close(); }
  });

  it('clears loading and ignores late stats when the profile identity changes', async () => {
    const { dom, win, api, section } = setup();
    try {
      let finishStats: (value: any) => void = () => {};
      const getStats = jest.fn(() => new Promise(resolve => { finishStats = resolve; }));
      win.CRONOX_USER = { id: 1, identityUid: 'one', circleLevel: 3 };
      win.CRONOX_API = { getAccreditationStats: getStats };
      win.CRONOX_USER_IDENTITY = { format: () => '' };
      win.CRONOX_ACCREDITATION_DESIGNS = { loadActive: async () => design, destroy: jest.fn() };
      win.eval(read('assets/profile.js'));
      await tick(); // JSDOM fires DOMContentLoaded after evaluation.
      win.document.querySelector('[data-profile-tab="accreditation"]').click();
      await tick();
      expect(getStats).toHaveBeenCalledTimes(1);
      expect(section.classList.contains('is-loading')).toBe(false);
      win.CRONOX_USER = { id: 2, identityUid: 'two', circleLevel: 4 };
      win.dispatchEvent(new win.CustomEvent('cronox:userChanged', { detail: win.CRONOX_USER }));
      finishStats({ circleLevel: 1, createdAt: '2000-01-01T00:00:00Z' });
      await tick();
      expect(section.classList.contains('is-loading')).toBe(false);
      expect(win.CRONOX_USER.circleLevel).toBe(4);
      expect(win.CRONOX_ACCREDITATION_STATS).toBeNull();
      expect(section.querySelector('#cronox-member-qr').getAttribute('src')).toBeNull();
    } finally { dom.window.close(); }
  });

  it('does not substitute a circle or cached profile identity on missing data or authorization failure', async () => {
    const { dom, win, mount, api, section } = setup();
    try {
      win.fetch = async (url: string) => ({ ok: url.endsWith('/active'), json: async () => design });
      await expect(api.loadActive(section)).rejects.toThrow('Comprueba tu sesión');
      for (const circleLevel of [null, undefined, 0, 6, '3']) {
        expect(() => api.apply(section, design, { ...person, circleLevel })).toThrow('círculo');
      }
      expect(mount).not.toHaveBeenCalled();
    } finally { dom.window.close(); }
  });

  it('registers one family card; review, close and reopen perform GET only and preserve original configuration', async () => {
    const dom = new JSDOM(read('admin.html'), { url: 'http://localhost/admin.html', runScripts: 'outside-only' });
    const win = dom.window as any;
    const original = { id: 'original', name: 'Original', renderer: 'original-v1', active: true, ready: true, config: { version: 1, artworkUrl: '/assets/logo_banner.png' } };
    const state = { revision: 9, designs: [original, { ...design, active: false, ready: true, revision: 0 }] };
    win.fetch = jest.fn(async () => ({ ok: true, json: async () => state }));
    try {
      win.eval(read('assets/admin-accreditations.js'));
      await win.CRONOX_ADMIN_ACCREDITATIONS.load();
      const section = win.document.getElementById('section-accreditations');
      expect(section.querySelectorAll('[data-design-select="metacrilatos"]')).toHaveLength(1);
      for (let i = 0; i < 2; i++) {
        section.querySelector('[data-design-select="metacrilatos"]').click(); await tick();
        expect(section.querySelector('input[name="name"]').value).toBe('METACRILATOS');
        expect(section.querySelector('input[name="name"]').readOnly).toBe(true);
        expect(section.querySelector('[type="submit"]').disabled).toBe(true);
        section.querySelector('[data-design-preview]').click();
        expect(section.querySelector('iframe').src).toContain('/metacrilatos/preview?');
        section.querySelector('[data-design-close]').click();
      }
      expect(win.fetch.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
      expect(original.active).toBe(true);
      expect(original.config.artworkUrl).toBe('/assets/logo_banner.png');
    } finally { win.close(); }
  });
});
