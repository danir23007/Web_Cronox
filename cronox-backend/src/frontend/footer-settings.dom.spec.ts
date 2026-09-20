/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const root = path.resolve(__dirname, '../../../cronox-front');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const indexHtml = read('index.html');
const adminHtml = read('admin.html');
const publicScript = read('assets/footer-config.js');
const adminScript = read('assets/admin-footer.js');

const settings = {
  supportTitle: 'AYUDA',
  supportFaqLabel: 'Preguntas',
  supportShippingLabel: 'Envíos',
  supportReturnsLabel: 'Cambios',
  collabTitle: 'COMUNIDAD',
  collabDevelopLabel: 'Desarrolla',
  collabEventsLabel: 'Agenda',
  legalTitle: 'CONDICIONES',
  legalPrivacyLabel: 'Privacidad',
  legalCookiesLabel: 'Cookies',
  legalTermsLabel: 'Términos',
  legalNoticeLabel: 'Aviso',
  instagramUrl: 'https://instagram.com/cronox.test/',
  tiktokUrl: 'https://tiktok.com/@cronox.test',
  youtubeUrl: 'https://youtube.com/@cronox.test',
  revision: 4,
};

describe('Footer settings public and Admin UI', () => {
  it('keeps safe static defaults, immutable routes, icons and external-link security', () => {
    const document = new JSDOM(indexHtml).window.document;
    const instagram = document.querySelector<HTMLAnchorElement>(
      '[data-footer-social="instagramUrl"]',
    )!;
    expect(instagram.href).toBe('https://www.instagram.com/cronox.es/');
    expect(instagram.target).toBe('_blank');
    expect(instagram.rel.split(/\s+/)).toEqual(
      expect.arrayContaining(['noopener', 'noreferrer']),
    );
    expect(
      instagram.querySelector('img[src="assets/icons/instagram.svg"]'),
    ).not.toBeNull();
    expect(
      Array.from(document.querySelectorAll('.footer-list a')).map((node) =>
        node.getAttribute('href'),
      ),
    ).toEqual([
      '/faqs',
      '/envios',
      '/devoluciones',
      '/desarrolla',
      '/eventos',
      '/privacidad',
      '/cookies',
      '/terminos',
      '/aviso-legal',
    ]);
    expect(document.querySelector('.footer-newsletter-form')).not.toBeNull();
    expect(document.querySelectorAll('.footer-acc-trigger')).toHaveLength(3);
  });

  it('progressively applies configured text and URLs without allowing HTML injection', async () => {
    const dom = new JSDOM(indexHtml, {
      runScripts: 'outside-only',
      url: 'http://localhost/',
    });
    dom.window.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ...settings,
        supportFaqLabel: '<img src=x onerror=alert(1)>',
      }),
    }) as any;
    dom.window.eval(publicScript);
    await (dom.window as any).CRONOX_FOOTER.load();
    const faq = dom.window.document.querySelector(
      '[data-footer-label="supportFaqLabel"]',
    )!;
    expect(faq.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(faq.querySelector('img')).toBeNull();
    expect(
      dom.window.document.querySelector<HTMLAnchorElement>(
        '[data-footer-social="instagramUrl"]',
      )?.href,
    ).toBe('https://instagram.com/cronox.test/');
  });

  it('preserves all defaults when the public API fails', async () => {
    const dom = new JSDOM(indexHtml, {
      runScripts: 'outside-only',
      url: 'http://localhost/',
    });
    dom.window.fetch = jest.fn().mockRejectedValue(new Error('offline')) as any;
    dom.window.eval(publicScript);
    await (dom.window as any).CRONOX_FOOTER.load();
    expect(
      dom.window.document.querySelector<HTMLAnchorElement>(
        '[data-footer-social="instagramUrl"]',
      )?.href,
    ).toBe('https://www.instagram.com/cronox.es/');
    expect(
      dom.window.document.querySelector('[data-footer-label="supportTitle"]')
        ?.textContent,
    ).toBe('SOPORTE');
  });

  it('exposes all four Admin groups, loads values and saves one validated payload', async () => {
    const dom = new JSDOM(adminHtml, {
      runScripts: 'outside-only',
      url: 'http://localhost/admin.html',
    });
    const fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => settings })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...settings, revision: 5 }),
      });
    dom.window.fetch = fetch as any;
    (dom.window as any).CRONOX_API = {
      API_BASE: '',
      getCsrfHeaders: jest.fn().mockResolvedValue({ 'X-CSRF-Token': 'token' }),
    };
    dom.window.eval(adminScript);
    await (dom.window as any).CRONOX_ADMIN_FOOTER.load(true);
    expect(
      dom.window.document.querySelector('[data-nav-target="section-footer"]'),
    ).not.toBeNull();
    expect(
      Array.from(
        dom.window.document.querySelectorAll('#footerSettingsForm legend'),
      ).map((node) => node.textContent),
    ).toEqual(['SOPORTE', 'COLABORA', 'LEGAL', 'REDES SOCIALES']);
    expect(
      (
        dom.window.document.querySelector(
          '[name="supportTitle"]',
        ) as HTMLInputElement
      ).value,
    ).toBe('AYUDA');

    await (dom.window as any).CRONOX_ADMIN_FOOTER.save();
    const request = fetch.mock.calls[1][1];
    expect(request.method).toBe('PATCH');
    expect(JSON.parse(request.body)).toEqual({
      expectedRevision: 4,
      ...Object.fromEntries(
        Object.entries(settings).filter(([key]) => key !== 'revision'),
      ),
    });
    expect(request.headers['X-CSRF-Token']).toBe('token');
    expect(
      dom.window.document.getElementById('footerSettingsStatus')?.dataset.state,
    ).toBe('success');
  });

  it('rejects empty and unsafe Admin fields before issuing a save request', async () => {
    const dom = new JSDOM(adminHtml, {
      runScripts: 'outside-only',
      url: 'http://localhost/admin.html',
    });
    const fetch = jest.fn();
    dom.window.fetch = fetch as any;
    (dom.window as any).CRONOX_API = { getCsrfHeaders: jest.fn() };
    dom.window.eval(adminScript);
    const fields = Array.from(
      dom.window.document.querySelectorAll<HTMLInputElement>(
        '#footerSettingsForm input',
      ),
    );
    fields.forEach((field) => {
      field.value = field.type === 'url' ? 'https://example.com/' : 'Texto';
    });
    fields[0].value = '   ';
    await (dom.window as any).CRONOX_ADMIN_FOOTER.save();
    expect(fetch).not.toHaveBeenCalled();
    expect(
      dom.window.document.getElementById('footerSettingsStatus')?.textContent,
    ).toContain('obligatorios');

    fields[0].value = 'Texto';
    const instagram = dom.window.document.querySelector<HTMLInputElement>(
      '[name="instagramUrl"]',
    )!;
    instagram.value = 'javascript:alert(1)';
    await (dom.window as any).CRONOX_ADMIN_FOOTER.save();
    expect(fetch).not.toHaveBeenCalled();
    expect(
      dom.window.document.getElementById('footerSettingsStatus')?.dataset.state,
    ).toBe('error');
  });
});
