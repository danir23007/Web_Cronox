/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/require-await */
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
      /\.newsletter-modal-close:hover,[\s\S]*\.newsletter-modal-close:focus-visible\s*\{[^}]*outline:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/,
    );
    expect(css).toContain('appearance: none');
    expect(css).toContain('-webkit-appearance: none');
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
    (dom.window as any).requestAnimationFrame = (callback: () => void) =>
      callback();
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

  it('measures logical layout dimensions inside a scaled preview', () => {
    const dom = new JSDOM('<div id="frame"><img id="media"></div>', {
      runScripts: 'outside-only',
    });
    dom.window.eval(read('assets/media-framing-geometry.js'));
    const frame = dom.window.document.getElementById('frame') as HTMLElement;
    const media = dom.window.document.getElementById(
      'media',
    ) as HTMLImageElement;
    Object.defineProperties(frame, {
      clientWidth: { value: 480 },
      clientHeight: { value: 360 },
    });
    frame.getBoundingClientRect = () =>
      ({ width: 240, height: 180 }) as DOMRect;
    Object.defineProperties(media, {
      naturalWidth: { value: 1200 },
      naturalHeight: { value: 800 },
    });
    const result = (dom.window as any).CRONOX_MEDIA_GEOMETRY.apply(
      media,
      frame,
      { focalX: 50, focalY: 18, zoom: 1.5, fit: 'COVER' },
    );
    expect(result.frameWidth).toBe(480);
    expect(result.frameHeight).toBe(360);
    expect(result.renderedWidth).toBeGreaterThanOrEqual(480);
    expect(result.renderedHeight).toBeGreaterThan(360);
    const y18 = result.translateY;
    const y100 = (dom.window as any).CRONOX_MEDIA_GEOMETRY.apply(media, frame, {
      focalX: 50,
      focalY: 100,
      zoom: 1.5,
      fit: 'COVER',
    }).translateY;
    expect(y100).not.toBe(y18);
    expect(media.style.height).toBe(`${result.renderedHeight}px`);
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
    expect(read('assets/admin-newsletter.css')).toContain(
      '.bw-theme .newsletter-device-tabs .btn.is-active',
    );
    expect(read('assets/admin-newsletter.css')).toContain(
      'width:min(416px,100%)',
    );
  });

  it('fits the 390 by 844 mobile design exactly once and independently of layer zoom', () => {
    const dom = new JSDOM('', { runScripts: 'outside-only' });
    dom.window.eval(read('assets/newsletter-renderer.js'));
    const renderer = (dom.window as any).CRONOX_NEWSLETTER_RENDERER;
    const full = renderer.previewFit(390, 390, 844);
    expect(full).toEqual({
      availableWidth: 390,
      designWidth: 390,
      designHeight: 844,
      scale: 1,
      renderedWidth: 390,
      renderedHeight: 844,
    });
    const constrained = renderer.previewFit(300, 390, 844);
    expect(constrained.scale).toBeCloseTo(300 / 390);
    expect(constrained.renderedWidth).toBeCloseTo(300);
    expect(constrained.renderedHeight).toBeCloseTo(844 * (300 / 390));
    expect(renderer.previewFit(390, 390, 844).scale).toBe(1);
    dom.window.close();
  });

  it('renders a complete proportional mobile composition in the Admin viewport', async () => {
    const dom = new JSDOM(read('admin.html'), {
      runScripts: 'outside-only',
      url: 'http://localhost/admin.html',
    });
    const window = dom.window as any;
    window.requestAnimationFrame = (callback: () => void) => callback();
    window.ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
    window.CRONOX_API = { API_BASE: '', getCsrfHeaders: jest.fn() };
    window.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ assets: [] }),
      });
    const viewport = window.document.querySelector(
      '.newsletter-preview__viewport',
    );
    Object.defineProperty(viewport, 'clientWidth', { value: 390 });
    window.eval(read('assets/media-framing-geometry.js'));
    window.eval(read('assets/newsletter-renderer.js'));
    window.eval(read('assets/admin-newsletter.js'));
    try {
      await window.CRONOX_NEWSLETTER_ADMIN.load();
      window.document
        .querySelector('[data-newsletter-edit-device="mobile"]')
        .click();
      const surface = window.document.getElementById(
        'newsletterPreviewSurface',
      );
      const preview = window.document.getElementById('newsletterPreviewRoot');
      expect(surface.style.width).toBe('390px');
      expect(surface.style.height).toBe('844px');
      expect(surface.style.transform).toBe('scale(1)');
      expect(surface.dataset.newsletterPreviewAvailableWidth).toBe('390');
      expect(surface.dataset.newsletterPreviewScale).toBe('1');
      expect(surface.dataset.newsletterPreviewRenderedWidth).toBe('390');
      expect(surface.dataset.newsletterPreviewRenderedHeight).toBe('844');
      expect(viewport.style.width).toBe('390px');
      expect(viewport.style.height).toBe('844px');
      expect(preview.dataset.newsletterDevice).toBe('mobile');
      expect(
        (preview.querySelector('.popup-image') as HTMLImageElement).src,
      ).toBe(window.CRONOX_NEWSLETTER_RENDERER.FALLBACK_SOURCE);
      for (const selector of [
        '.popup-image',
        '.ascii-overlay pre',
        '.newsletter-modal-kicker',
        '.newsletter-modal-title',
        '.newsletter-modal-subtitle',
        '.newsletter-modal-input',
        '.newsletter-modal-button',
        '.newsletter-login-link',
        '.newsletter-modal-close',
      ]) {
        expect(preview.querySelector(selector)).not.toBeNull();
      }
    } finally {
      dom.window.close();
    }
  });

  it('adapts missing or invalid mobile framing from desktop and preserves explicit mobile framing', () => {
    const dom = new JSDOM('', { runScripts: 'outside-only' });
    dom.window.eval(read('assets/newsletter-renderer.js'));
    const renderer = (dom.window as any).CRONOX_NEWSLETTER_RENDERER;
    const legacy = renderer.normalize({
      desktop: { focalX: 23, focalY: 67, zoom: 1.6, fit: 'COVER' },
      mobile: { focalX: Number.NaN, focalY: 50, zoom: 1 },
      desktopAscii: { x: 34, y: 72, scale: 1.25 },
      mobileAscii: { x: 2, y: 50, scale: 1 },
    });
    expect(legacy.mobile).toEqual(legacy.desktop);
    expect(legacy.mobileAscii).toEqual(legacy.desktopAscii);

    const configured = renderer.normalize({
      desktop: { focalX: 20, focalY: 30, zoom: 1.4, fit: 'COVER' },
      mobile: { focalX: 71, focalY: 63, zoom: 1.8, fit: 'CONTAIN' },
      desktopAscii: { x: 20, y: 30, scale: 1.4 },
      mobileAscii: { x: 80, y: 70, scale: 0.7 },
    });
    expect(configured.mobile).toEqual({
      focalX: 71,
      focalY: 63,
      zoom: 1.8,
      fit: 'CONTAIN',
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
    const controller = (dom.window as any).CRONOX_NEWSLETTER_RENDERER.mount(
      root,
      {
        mediaOpacity: 0.37,
      },
    );
    expect(controller.getConfig().mediaOpacity).toBe(0.37);
    expect(
      (root.querySelector('.popup-image') as HTMLElement).style.opacity,
    ).toBe('0.37');
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
      normalize: (value: unknown) => value,
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
    const controller = (dom.window as any).CRONOX_NEWSLETTER_RENDERER.mount.mock
      .results[0].value;
    const originalBackground = { ...state.draft.desktop };
    const desktopButton = dom.window.document.querySelector(
      '[data-newsletter-edit-device="desktop"]',
    ) as HTMLButtonElement;
    const backgroundButton = dom.window.document.querySelector(
      '[data-newsletter-edit-layer="background"]',
    ) as HTMLButtonElement;
    expect(desktopButton.classList).toContain('is-active');
    expect(desktopButton.getAttribute('aria-pressed')).toBe('true');
    expect(backgroundButton.classList).toContain('is-active');
    expect(backgroundButton.getAttribute('aria-pressed')).toBe('true');

    const y = dom.window.document.getElementById(
      'newsletterFocalY',
    ) as HTMLInputElement;
    y.value = '18';
    y.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    expect(state.draft.desktop.focalY).toBe(18);
    expect(controller.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        desktop: expect.objectContaining({ focalY: 18 }),
      }),
    );
    (
      dom.window.document.querySelector(
        '[data-newsletter-edit-layer="ascii"]',
      ) as HTMLButtonElement
    ).click();
    expect(backgroundButton.classList).not.toContain('is-active');
    expect(backgroundButton.getAttribute('aria-pressed')).toBe('false');
    expect(
      dom.window.document
        .querySelector('[data-newsletter-edit-layer="ascii"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('true');
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

    expect(state.draft.desktop).toEqual({ ...originalBackground, focalY: 18 });
    expect(state.draft.desktopAscii).toEqual({ x: 70, y: 80, scale: 1 });
    expect(state.draft.mobileAscii).toEqual(ascii);

    (
      dom.window.document.querySelector(
        '[data-newsletter-edit-device="mobile"]',
      ) as HTMLButtonElement
    ).click();
    const mobileButton = dom.window.document.querySelector(
      '[data-newsletter-edit-device="mobile"]',
    ) as HTMLButtonElement;
    expect(mobileButton.classList).toContain('is-active');
    expect(mobileButton.getAttribute('aria-pressed')).toBe('true');
    expect(
      dom.window.document.querySelector('[data-newsletter-edit-layer="ascii"]')
        ?.classList,
    ).toContain('is-active');
    expect(state.draft.desktop.focalY).toBe(18);
    y.value = '100';
    y.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    expect(state.draft.mobileAscii.y).toBe(95);
    expect(state.draft.desktopAscii.y).toBe(80);
    backgroundButton.click();
    y.value = '100';
    y.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    expect(state.draft.mobile.focalY).toBe(100);
    expect(state.draft.desktop.focalY).toBe(18);
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
    desktopButton.click();
    expect(state.draft.desktop.focalY).toBe(18);
    expect(state.draft.desktopAscii).toEqual({ x: 70, y: 80, scale: 1 });
    expect(state.draft.mobile.focalY).toBe(100);
    expect(state.draft.mobileAscii.y).toBe(95);
    expect(
      dom.window.document
        .getElementById('newsletterPreviewRoot')
        ?.getAttribute('data-newsletter-device'),
    ).toBe('desktop');
  });
});
