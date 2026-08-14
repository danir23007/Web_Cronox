/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/require-await */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const frontendRoot = path.resolve(__dirname, '../../../cronox-front');
const readFrontend = (file: string) =>
  readFileSync(path.join(frontendRoot, file), 'utf8');

const indexHtml = readFrontend('index.html');
const infoShellScript = readFrontend('assets/info-shell.js');
const infoPageStyles = readFrontend('assets/info-page.css');
const storeStyles = readFrontend('assets/store.css');
const appScript = readFrontend('assets/app.js');

const waitFor = async (assertion: () => void, attempts = 50) => {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  throw lastError;
};

const expectedRoutes = [
  'faqs.html',
  'shipping-policy.html',
  'returns-exchanges.html',
  'develop.html',
  'events.html',
  'privacy-policy.html',
  'cookie-policy.html',
  'terms-of-service.html',
  'aviso-legal.html',
];

describe('informational footer destinations use the shared CRONOX topbar', () => {
  it('enumerates all nine real footer routes without placeholders', () => {
    const dom = new JSDOM(indexHtml);
    const links = Array.from(
      dom.window.document.querySelectorAll(
        '#footer-panel-soporte a, #footer-panel-colabora a, #footer-panel-legal a',
      ),
    ).map((link) => link.getAttribute('href'));

    expect(links).toEqual(expectedRoutes);
    expect(links).not.toContain('#');
    dom.window.close();
  });

  it.each(expectedRoutes)(
    '%s mounts one opaque production header immediately',
    (route) => {
      const html = readFrontend(route);
      expect(html).toContain('<body class="page-info">');
      expect(html).toMatch(
        /<body class="page-info">\s*<script src="assets\/info-shell\.js\?v=1"><\/script>/,
      );
      expect(html).toContain('href="assets/store.css?v=86"');
      expect(html).toContain('href="assets/info-page.css?v=1"');
      expect(html.match(/assets\/info-shell\.js\?v=1/g)).toHaveLength(1);
      expect(html.match(/assets\/app\.js\?v=60/g)).toHaveLength(1);
      expect(html.match(/assets\/api\.js\?v=4/g)).toHaveLength(1);
      expect(html.match(/assets\/cart-badge\.js\?v=43/g)).toHaveLength(1);

      const dom = new JSDOM(html, {
        runScripts: 'outside-only',
        url: `http://localhost:3000/${route}`,
      });
      dom.window.eval(infoShellScript);
      const document = dom.window.document;
      const topbar = document.getElementById('topbar');

      expect(document.querySelectorAll('#topbar')).toHaveLength(1);
      expect(topbar?.classList.contains('topbar--page')).toBe(true);
      expect(topbar?.classList.contains('topbar--transparent')).toBe(false);
      expect(
        document
          .querySelector<HTMLAnchorElement>('.topbar__logo')
          ?.getAttribute('href'),
      ).toBe('index.html');
      expect(
        document.querySelector('.topbar__logo-img')?.getAttribute('src'),
      ).toBe('assets/logo_banner.png');
      expect(document.getElementById('btnMenu')).not.toBeNull();
      expect(document.getElementById('btnSearch')).not.toBeNull();
      expect(document.getElementById('searchBar')).not.toBeNull();
      expect(
        document.querySelectorAll('#filtersPanel .black-menu__link'),
      ).toHaveLength(5);
      expect(document.getElementById('profileBtn')).not.toBeNull();
      expect(document.querySelector('.favorites-count')).not.toBeNull();
      expect(document.querySelector('.cart-count')).not.toBeNull();
      expect(document.querySelector('.cart-drawer__title')?.textContent).toBe(
        'Cesta',
      );

      const ids = Array.from(
        document.querySelectorAll<HTMLElement>('[id]'),
      ).map((element) => element.id);
      expect(new Set(ids).size).toBe(ids.length);
      dom.window.close();
    },
  );

  it('uses the existing fixed responsive header behavior without hero transparency', () => {
    expect(infoShellScript).toContain(
      '<header class="topbar topbar--page" id="topbar" role="banner">',
    );
    expect(infoShellScript).not.toContain('topbar--transparent');
    expect(infoPageStyles).toContain('body.page-info');
    expect(infoPageStyles).toContain('padding-top: var(--topbar-h, 64px)');
    expect(infoPageStyles).toContain('overflow-x: hidden');
    expect(infoPageStyles).toContain('background: #000');
    expect(storeStyles).toMatch(/\.topbar\{[\s\S]*position:fixed/);
    expect(storeStyles).toContain('.topbar--page{background:#000');
    expect(appScript).toContain("btnSearch?.addEventListener('click'");
    expect(appScript).toContain("menuBtn?.addEventListener('click'");
    expect(appScript).toContain('window.initFavoritesFromBackend');
    expect(appScript).toContain('window.initCartFromBackend');
  });

  it('runs the production menu, search, account and cart bindings on an informational page', async () => {
    const dom = new JSDOM(readFrontend('faqs.html'), {
      runScripts: 'outside-only',
      url: 'http://localhost:3000/faqs.html',
    });
    const browserWindow = dom.window as any;
    const document = browserWindow.document as Document;
    const emptyCart = {
      items: [],
      itemsCount: 0,
      subtotalCents: 0,
      subtotalLabel: '0,00 €',
    };

    browserWindow.requestAnimationFrame = (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    };
    browserWindow.cancelAnimationFrame = jest.fn();
    browserWindow.scrollTo = jest.fn();
    browserWindow.matchMedia = jest.fn(() => ({
      matches: false,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }));
    browserWindow.CRONOX_SECURITY = {
      escapeHtml: (value: string | number | boolean | null | undefined) =>
        String(value ?? ''),
      productImageUrl: (value: unknown, fallback = '') =>
        typeof value === 'string' ? value : fallback,
    };
    browserWindow.CRONOX_API = {
      API_BASE: 'http://localhost:3000',
      getMe: async () => null,
      getFavorites: async () => [],
      getCart: async () => emptyCart,
      getProducts: async () => [],
      getProductSuggestions: async () => [],
      getFallbackProducts: () => [],
    };
    browserWindow.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [],
      text: async () => readFrontend('auth-modal.html'),
    }));

    browserWindow.eval(infoShellScript);
    browserWindow.eval(appScript);
    document.dispatchEvent(new browserWindow.Event('DOMContentLoaded'));

    (document.getElementById('btnSearch') as HTMLButtonElement).click();
    expect((document.getElementById('searchBar') as HTMLElement).hidden).toBe(
      false,
    );
    expect(
      document.getElementById('searchBar')?.classList.contains('is-open'),
    ).toBe(true);

    (document.querySelector('.searchbar__close') as HTMLButtonElement).click();
    expect(
      document.getElementById('searchBar')?.getAttribute('aria-hidden'),
    ).toBe('true');

    (document.getElementById('btnMenu') as HTMLButtonElement).click();
    expect(
      (document.getElementById('filtersPanel') as HTMLElement).hidden,
    ).toBe(false);
    expect(
      document.getElementById('filtersPanel')?.classList.contains('is-open'),
    ).toBe(true);

    (document.getElementById('profileBtn') as HTMLAnchorElement).click();
    await waitFor(() => {
      expect(document.querySelectorAll('#authOverlay')).toHaveLength(1);
    });

    (document.getElementById('cart-icon-btn') as HTMLAnchorElement).click();
    await waitFor(() => {
      expect(
        (document.getElementById('cart-drawer') as HTMLElement).hidden,
      ).toBe(false);
      expect(
        document
          .getElementById('cart-drawer')
          ?.classList.contains('is-visible'),
      ).toBe(true);
      expect(document.querySelector('.cart-empty__message')).not.toBeNull();
    });

    expect(document.querySelectorAll('#topbar')).toHaveLength(1);
    expect(document.querySelectorAll('#searchBar')).toHaveLength(1);
    expect(document.querySelectorAll('#filtersPanel')).toHaveLength(1);
    expect(document.querySelectorAll('#cart-drawer')).toHaveLength(1);
    dom.window.close();
  });

  it('leaves the homepage and product topbar states untouched', () => {
    expect(indexHtml).toContain(
      '<header class="topbar topbar--transparent" id="topbar" role="banner">',
    );
    expect(indexHtml).not.toContain('assets/info-shell.js');

    const productHtml = readFrontend('producto.html');
    expect(productHtml).toContain(
      '<header class="topbar topbar--page" id="topbar" role="banner">',
    );
    expect(productHtml).not.toContain('assets/info-shell.js');
  });
});
