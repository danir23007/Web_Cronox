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
const pageContentScript = read('assets/page-content.js');

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
  it.each([
    ['faqs.html', 'faqs'],
    ['shipping-policy.html', 'shipping-policy'],
    ['returns-exchanges.html', 'returns-exchanges'],
    ['develop.html', 'develop'],
    ['events.html', 'events'],
    ['privacy-policy.html', 'privacy-policy'],
    ['cookie-policy.html', 'cookie-policy'],
    ['terms-of-service.html', 'terms-of-service'],
    ['aviso-legal.html', 'legal-notice'],
  ])('%s exposes its stable editable content slug and loader', (file, slug) => {
    const document = new JSDOM(read(file)).window.document;
    expect(
      document
        .querySelector('[data-footer-content]')
        ?.getAttribute('data-footer-page-slug'),
    ).toBe(slug);
    expect(read(file)).toContain('assets/page-content.js?v=1');
  });

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

  it('keeps labels fixed while progressively applying validated social URLs', async () => {
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
    expect(faq.textContent).toBe('FAQS');
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

  it('exposes fixed page navigation and saves only social destinations', async () => {
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
        dom.window.document.querySelectorAll('#footerPageList legend'),
      ).map((node) => node.textContent),
    ).toEqual(['SOPORTE', 'COLABORA', 'LEGAL']);
    expect(
      dom.window.document.querySelectorAll('[data-footer-page]'),
    ).toHaveLength(9);
    expect(
      dom.window.document.querySelector('[name="supportTitle"]'),
    ).toBeNull();
    expect(
      (
        dom.window.document.querySelector(
          '[name="instagramUrl"]',
        ) as HTMLInputElement
      ).value,
    ).toBe('https://instagram.com/cronox.test/');

    await (dom.window as any).CRONOX_ADMIN_FOOTER.save();
    const request = fetch.mock.calls[1][1];
    expect(request.method).toBe('PATCH');
    expect(JSON.parse(request.body)).toEqual({
      expectedRevision: 4,
      instagramUrl: settings.instagramUrl,
      tiktokUrl: settings.tiktokUrl,
      youtubeUrl: settings.youtubeUrl,
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
    fields.forEach((field) => (field.value = 'https://example.com/'));
    fields[0].value = '   ';
    await (dom.window as any).CRONOX_ADMIN_FOOTER.save();
    expect(fetch).not.toHaveBeenCalled();
    expect(
      dom.window.document.getElementById('footerSettingsStatus')?.textContent,
    ).toContain('obligatorios');

    fields[0].value = 'https://example.com/';
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

  it('opens the selected destination editor with its current static fallback', async () => {
    const dom = new JSDOM(adminHtml, {
      runScripts: 'outside-only',
      url: 'http://localhost/admin.html',
    });
    const fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ slug: 'faqs', html: null, revision: 0 }),
      })
      .mockResolvedValueOnce({ ok: true, text: async () => read('faqs.html') });
    dom.window.fetch = fetch as any;
    (dom.window as any).CRONOX_API = {
      API_BASE: '',
      getCsrfHeaders: jest.fn(),
    };
    dom.window.eval(adminScript);
    const button = dom.window.document.querySelector(
      '[data-footer-page="faqs"]',
    ) as HTMLButtonElement;
    await (dom.window as any).CRONOX_ADMIN_FOOTER.openPage(button);
    expect(dom.window.document.getElementById('footerPageList')?.hidden).toBe(
      true,
    );
    expect(dom.window.document.getElementById('footerPageEditor')?.hidden).toBe(
      false,
    );
    expect(
      dom.window.document.querySelector('#footerPageContent h1')?.textContent,
    ).toBe('Preguntas frecuentes y ayuda');
    expect(fetch.mock.calls[0][0]).toBe('/api/admin/footer/pages/faqs');
  });

  it('renders stored page content and retains the static fallback on failure', async () => {
    const html = read('shipping-policy.html');
    const configured = new JSDOM(html, {
      runScripts: 'outside-only',
      url: 'http://localhost/envios',
    });
    (configured.window as any).CRONOX_API = { API_BASE: '' };
    configured.window.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        slug: 'shipping-policy',
        html: '<h1>ENVÍOS ACTUALIZADOS</h1><p>Contenido seguro.</p>',
      }),
    }) as any;
    configured.window.eval(pageContentScript);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      configured.window.document.querySelector('[data-footer-content] h1')
        ?.textContent,
    ).toBe('ENVÍOS ACTUALIZADOS');

    const fallback = new JSDOM(html, {
      runScripts: 'outside-only',
      url: 'http://localhost/envios',
    });
    (fallback.window as any).CRONOX_API = { API_BASE: '' };
    fallback.window.fetch = jest
      .fn()
      .mockRejectedValue(new Error('offline')) as any;
    const original = fallback.window.document.querySelector(
      '[data-footer-content] h1',
    )?.textContent;
    fallback.window.eval(pageContentScript);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      fallback.window.document.querySelector('[data-footer-content] h1')
        ?.textContent,
    ).toBe(original);
  });
});
