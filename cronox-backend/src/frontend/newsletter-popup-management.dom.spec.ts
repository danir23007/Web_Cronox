import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const root = path.resolve(__dirname, '../../../cronox-front');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

describe('Newsletter popup and Admin management', () => {
  it('keeps one accessible close button and the login transition below JOIN', () => {
    const dom = new JSDOM(read('index.html'), { runScripts: 'outside-only' });
    dom.window.eval(read('assets/newsletter-renderer.js'));
    const document = dom.window.document;
    (dom.window as any).CRONOX_NEWSLETTER_RENDERER.renderStructure(
      document.querySelector('.newsletter-modal'),
    );
    expect(document.querySelectorAll('.newsletter-modal-close')).toHaveLength(
      1,
    );
    expect(
      document
        .querySelector('.newsletter-modal-close')
        ?.getAttribute('aria-label'),
    ).toBe('Cerrar newsletter');
    const prompt = document.querySelector('.newsletter-login-prompt');
    expect(prompt?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'O si ya tienes cuenta, inicia sesión',
    );
    expect(prompt?.querySelector('button')?.textContent).toBe('inicia sesión');
    expect(read('index.html')).not.toContain('newsletter-login-prompt');
    const script = read('assets/app.js');
    expect(script.indexOf('closeNewsletterModal({ dismiss: true')).toBeLessThan(
      script.indexOf("window.CRONOX_openAuthModal?.('login')"),
    );
  });

  it('uses stable monospace ASCII geometry and no hardcoded duplicate media URL', () => {
    const css = read('assets/newsletter-popup.css');
    const legacyCss = read('assets/store.css');
    const html = read('index.html');
    expect(css).toContain('white-space: pre');
    expect(css).toContain('font-variant-ligatures: none');
    expect(css).toContain('letter-spacing: 0');
    expect(css).toContain(
      'transform: translate(-50%, -50%) scale(var(--newsletter-ascii-scale, 1))',
    );
    expect(css).not.toContain('2.6vw');
    expect(css).toContain('color: #fff');
    expect(css).toContain('z-index: 12');
    expect(css).toContain('width: 44px');
    expect(css).toContain('right: max(12px');
    expect(css).toMatch(
      /\.newsletter-modal-close\s*\{[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*background:\s*transparent;/,
    );
    expect(css).toMatch(
      /\.newsletter-modal-close:hover\s*\{[^}]*background:\s*transparent;[^}]*opacity:\s*1;/,
    );
    expect(legacyCss).not.toContain('chains-newsletter.jpg');
    expect(html).not.toContain('chains-newsletter.jpg');
  });

  it.each([320, 360, 375, 390, 430, 1280])(
    'uniformly fits the ASCII at %ipx without scaleX/scaleY distortion',
    (width) => {
      const dom = new JSDOM('<div id="overlay"><pre></pre></div>', {
        runScripts: 'outside-only',
      });
      dom.window.eval(read('assets/newsletter-renderer.js'));
      const overlay = dom.window.document.getElementById('overlay')!;
      const pre = overlay.querySelector('pre')!;
      Object.defineProperties(overlay, {
        clientWidth: { value: width },
        clientHeight: { value: width < 500 ? 180 : 360 },
      });
      Object.defineProperties(pre, {
        scrollWidth: { value: 520 },
        scrollHeight: { value: 220 },
      });
      const scale = (dom.window as any).CRONOX_NEWSLETTER_RENDERER.scaleAscii(
        overlay,
        pre,
      );
      expect(scale).toBeGreaterThan(0);
      expect(pre.style.transform).toBe(`translate(-50%, -50%) scale(${scale})`);
      expect(pre.style.transform).not.toMatch(/scale[XY]/);
      expect(520 * scale).toBeLessThanOrEqual(width - 24 + 0.001);
    },
  );

  it('reflows through ResizeObserver and applies device-specific shared geometry', () => {
    const dom = new JSDOM(
      '<div class="newsletter-modal" data-newsletter-device="mobile"><div class="newsletter-modal-image"><div class="popup-image-wrapper"><img class="popup-image"><div class="ascii-overlay"><pre></pre></div></div></div></div>',
      { runScripts: 'outside-only' },
    );
    let resizeCallback: (() => void) | undefined;
    (dom.window as any).ResizeObserver = class {
      constructor(callback: () => void) {
        resizeCallback = callback;
      }
      observe() {}
      disconnect() {}
    };
    (dom.window as any).requestAnimationFrame = (callback: () => void) => callback();
    const apply = jest.fn();
    (dom.window as any).CRONOX_MEDIA_GEOMETRY = { apply };
    dom.window.eval(read('assets/newsletter-renderer.js'));
    const root = dom.window.document.querySelector('.newsletter-modal')!;
    const mobile = { focalX: 25, focalY: 75, zoom: 1.4, fit: 'COVER' };
    (dom.window as any).CRONOX_NEWSLETTER_RENDERER.mount(root, {
      desktop: { focalX: 50, focalY: 50, zoom: 1, fit: 'COVER' },
      mobile,
    });
    expect(apply).toHaveBeenCalledWith(
      root.querySelector('img'),
      root.querySelector('.popup-image-wrapper'),
      mobile,
    );
    const calls = apply.mock.calls.length;
    resizeCallback?.();
    expect(apply.mock.calls.length).toBeGreaterThan(calls);
  });

  it('provides the complete first-class Admin editor', () => {
    const document = new JSDOM(read('admin.html')).window.document;
    expect(
      document.querySelector('[data-nav-target="section-newsletter"]'),
    ).not.toBeNull();
    expect(document.getElementById('newsletterAssetUpload')).not.toBeNull();
    expect(
      document.querySelector('[data-newsletter-device="desktop"]'),
    ).not.toBeNull();
    expect(document.querySelectorAll('[data-newsletter-preview]')).toHaveLength(
      1,
    );
    expect(
      document.querySelector('[data-newsletter-edit-device="mobile"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-newsletter-edit-layer="background"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-newsletter-edit-layer="ascii"]'),
    ).not.toBeNull();
    expect(document.getElementById('newsletterAsciiEnabled')).not.toBeNull();
    expect(document.getElementById('newsletterMediaOpacity')).not.toBeNull();
    expect(document.getElementById('newsletterAsciiOpacity')).not.toBeNull();
    expect(document.getElementById('newsletterAdminSave')).not.toBeNull();
    const script = read('assets/admin-newsletter.js');
    expect(script).toContain('pointerdown');
    expect(script).toContain('focalFromDrag');
    expect(script).toContain('expectedRevision');
    expect(script).toContain('mediaOpacity: state.draft.mediaOpacity');
    expect(script).toContain('desktopAscii: state.draft.desktopAscii');
    expect(script).toContain('mobileAscii: state.draft.mobileAscii');
    expect(script).toContain('state.drag.layer === "ascii"');
    expect(script).toContain('resizePreviewSurfaces');
    expect(read('assets/admin-newsletter.css')).not.toContain(
      '.newsletter-preview--mobile .newsletter-modal-grid',
    );
  });

  it('normalizes independent desktop/mobile ASCII framing with safe defaults', () => {
    const dom = new JSDOM('', { runScripts: 'outside-only' });
    dom.window.eval(read('assets/newsletter-renderer.js'));
    const renderer = (dom.window as any).CRONOX_NEWSLETTER_RENDERER;
    const legacy = renderer.normalize({ desktop: {}, mobile: {} });
    expect(legacy.desktopAscii).toEqual({ x: 50, y: 50, scale: 1 });
    expect(legacy.mobileAscii).toEqual({ x: 50, y: 50, scale: 1 });

    const configured = renderer.normalize({
      desktopAscii: { x: 20, y: 30, scale: 1.4 },
      mobileAscii: { x: 80, y: 70, scale: 0.7 },
    });
    expect(configured.desktopAscii).toEqual({ x: 20, y: 30, scale: 1.4 });
    expect(configured.mobileAscii).toEqual({ x: 80, y: 70, scale: 0.7 });
  });

  it('normalizes and applies independent media opacity in the shared renderer', () => {
    const dom = new JSDOM('<div class="newsletter-modal"></div>', {
      runScripts: 'outside-only',
    });
    (dom.window as any).requestAnimationFrame = (callback: () => void) =>
      callback();
    dom.window.eval(read('assets/newsletter-renderer.js'));
    const root = dom.window.document.querySelector('.newsletter-modal')!;
    const controller = (dom.window as any).CRONOX_NEWSLETTER_RENDERER.mount(root, {
      mediaOpacity: 0.37,
    });
    expect(controller.getConfig().mediaOpacity).toBe(0.37);
    expect((root.querySelector('.popup-image') as HTMLElement).style.opacity).toBe('0.37');
    controller.update({ mediaOpacity: 9 });
    expect(controller.getConfig().mediaOpacity).toBe(1);
  });

  it('switches viewport and dragging mutates only the selected ASCII layer', async () => {
    const dom = new JSDOM(read('admin.html'), {
      runScripts: 'outside-only',
      url: 'http://localhost/admin.html',
    });
    const frame = { focalX: 50, focalY: 50, zoom: 1, fit: 'COVER' };
    const ascii = { x: 50, y: 50, scale: 1 };
    dom.window.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          desktop: frame,
          mobile: frame,
          desktopAscii: ascii,
          mobileAscii: ascii,
          mediaOpacity: 1,
          asciiEnabled: true,
          asciiOpacity: 1,
          revision: 0,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ assets: [] }),
      }) as any;
    (dom.window as any).CRONOX_API = {
      API_BASE: '',
      getCsrfHeaders: jest.fn(),
    };
    (dom.window as any).CRONOX_MEDIA_GEOMETRY = {
      apply: jest.fn(() => ({ valid: true })),
      focalFromDrag: jest.fn(() => ({ focalX: 20, focalY: 30 })),
    };
    (dom.window as any).CRONOX_NEWSLETTER_RENDERER = {
      FALLBACK_SOURCE: '/fallback.jpg',
      renderStructure: (root: HTMLElement) => {
        root.innerHTML =
          '<div class="popup-image-wrapper"><img class="popup-image"><div class="ascii-overlay"><pre></pre></div></div>';
      },
      mount: jest.fn(() => ({ update: jest.fn(), reflow: jest.fn() })),
    };
    (dom.window as any).requestAnimationFrame = (callback: () => void) =>
      callback();
    dom.window.eval(read('assets/admin-newsletter.js'));
    await (dom.window as any).CRONOX_NEWSLETTER_ADMIN.load();
    const state = (dom.window as any).CRONOX_NEWSLETTER_ADMIN.state;
    const originalBackground = { ...state.draft.desktop };
    (
      dom.window.document.querySelector(
        '[data-newsletter-edit-layer="ascii"]',
      ) as HTMLButtonElement
    ).click();
    const wrapper = dom.window.document.querySelector(
      '.popup-image-wrapper',
    ) as HTMLElement;
    wrapper.getBoundingClientRect = () =>
      ({ width: 100, height: 100 }) as DOMRect;
    const pointer = (type: string, x: number, y: number) => {
      const event = new dom.window.Event(type, { bubbles: true });
      Object.defineProperties(event, {
        pointerId: { value: 1 },
        clientX: { value: x },
        clientY: { value: y },
      });
      return event;
    };
    wrapper.dispatchEvent(pointer('pointerdown', 10, 10));
    wrapper.dispatchEvent(pointer('pointermove', 30, 40));

    expect(state.draft.desktop).toEqual(originalBackground);
    expect(state.draft.desktopAscii).toEqual({ x: 70, y: 80, scale: 1 });
    expect(state.draft.mobileAscii).toEqual(ascii);

    (
      dom.window.document.querySelector(
        '[data-newsletter-edit-device="mobile"]',
      ) as HTMLButtonElement
    ).click();
    expect(
      dom.window.document
        .getElementById('newsletterPreviewRoot')
        ?.getAttribute('data-newsletter-device'),
    ).toBe('mobile');
    expect(
      dom.window.document
        .getElementById('newsletterPreviewSurface')
        ?.getAttribute('data-newsletter-logical-width'),
    ).toBe('390');
  });
});
