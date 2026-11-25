import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { renderEventRegistration } from '../common/routing/event-registration';
import { cleanPageForPath, UNGATED_PUBLIC_PATHS, legacyRedirectTarget } from '../common/routing/public-pages';

const read = (file: string) => readFileSync(path.resolve(__dirname, '../../../cronox-front', file), 'utf8');
const html = () => renderEventRegistration(read('event-register.html'), read('auth-modal.html'), read('index.html'));
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 0)); };
describe('direct event registration', () => {
  it('serves the existing form directly on a stable public route, including when the shop is closed', () => {
    expect(cleanPageForPath('/registro-evento')).toBe('event-register.html');
    expect(UNGATED_PUBLIC_PATHS.has('/registro-evento')).toBe(true);
    expect(legacyRedirectTarget('/event-register.html', '/event-register.html')).toBe('/registro-evento');
    const doc = new JSDOM(html()).window.document;
    expect(doc.querySelectorAll('#authOverlay')).toHaveLength(1);
    expect(doc.querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('true');
    expect(doc.querySelector('#eventRegistrationBackground')?.hasAttribute('inert')).toBe(true);
    expect(doc.querySelector('#hero .hero-video')?.getAttribute('src')).toBe(new JSDOM(read('index.html')).window.document.querySelector('#hero .hero-video')?.getAttribute('src'));
    expect(doc.querySelector('#authRegisterForm')?.classList.contains('is-active')).toBe(true);
    expect(doc.querySelector('#authRegisterLastName')?.hasAttribute('required')).toBe(true);
    expect(doc.querySelector('#authOverlay')?.getAttribute('aria-hidden')).toBe('false');
    expect(doc.querySelector('.newsletter-modal-overlay')).toBeNull();
    expect(doc.querySelector('input[type=checkbox]:checked')).toBeNull();
  });
  it('uses the shared handlers without fetching a second form, recording newsletter consent or scheduling its popup', async () => {
    const dom = new JSDOM(html(), { url: 'https://cronox.es/registro-evento', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
    const win = dom.window as any;
    win.TextEncoder = TextEncoder; win.scrollTo = () => {};
    win.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
    win.ResizeObserver = class { observe() {} disconnect() {} };
    const schedule = jest.fn(); win.CRONOX_NEWSLETTER_VISIT = { create: () => ({ schedule, eligible: () => true, cancel() {}, hasPending: () => false }) };
    const register = jest.fn().mockRejectedValue(Object.assign(Error('Existing email'), { status: 409 }));
    win.CRONOX_API = { register, getMe: async () => null, getCart: async () => ({ items: [] }), getProducts: async () => [] };
    win.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [] });
    try {
      win.eval(read('assets/event-registration.js')); win.eval(read('assets/app.js')); await flush();
      for (const [field, value] of Object.entries({ FirstName: 'Usuario', LastName: 'Prueba', Email: 'fixture@example.test', Password: 'SecurePassword1!' }))
        win.document.getElementById('authRegister' + field).value = value;
      win.document.getElementById('authRegisterForm').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true })); await flush();
      expect(register).toHaveBeenCalledWith(expect.objectContaining({ registrationSource: 'event', lastName: 'Prueba' }));
      expect(register.mock.calls[0][0]).not.toHaveProperty('newsletterSubscribed');
      expect(schedule).not.toHaveBeenCalled();
      expect(win.fetch.mock.calls.some(([url]: any[]) => String(url).includes('auth-modal.html'))).toBe(false);
      expect(win.document.getElementById('authMessage').textContent).toContain('Existing email');
      win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape' }));
      expect(win.document.getElementById('authOverlay').getAttribute('aria-hidden')).toBe('false');
      win.dispatchEvent(new win.CustomEvent('cronox:authResolved', { detail: { user: { id: 7 } } }));
      expect(win.document.getElementById('eventRegistrationBackground').hasAttribute('inert')).toBe(true);
    } finally { dom.window.close(); }
  });
});
