import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const root = path.resolve(__dirname, '../../../cronox-front');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

describe('Newsletter popup and Admin management', () => {
  it('keeps one accessible close button and the login transition below JOIN', () => {
    const document = new JSDOM(read('index.html')).window.document;
    expect(document.querySelectorAll('.newsletter-modal-close')).toHaveLength(
      1,
    );
    const prompt = document.querySelector('.newsletter-login-prompt');
    expect(prompt?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'O si ya tienes cuenta, inicia sesión',
    );
    expect(prompt?.querySelector('button')?.textContent).toBe('inicia sesión');
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
    expect(css).toContain('transform: scale(var(--newsletter-ascii-scale, 1))');
    expect(css).not.toContain('2.6vw');
    expect(css).toContain('color: #fff');
    expect(css).toContain('z-index: 12');
    expect(css).toContain('width: 44px');
    expect(css).toContain('right: max(12px');
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
      expect(pre.style.transform).toBe(`scale(${scale})`);
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

  it('provides the complete first-class Admin editor', () => {
    const document = new JSDOM(read('admin.html')).window.document;
    expect(
      document.querySelector('[data-nav-target="section-newsletter"]'),
    ).not.toBeNull();
    expect(document.getElementById('newsletterAssetUpload')).not.toBeNull();
    expect(
      document.querySelector('[data-newsletter-device="desktop"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-newsletter-device="mobile"]'),
    ).not.toBeNull();
    expect(document.getElementById('newsletterAsciiEnabled')).not.toBeNull();
    expect(document.getElementById('newsletterAsciiOpacity')).not.toBeNull();
    expect(document.getElementById('newsletterAdminSave')).not.toBeNull();
    const script = read('assets/admin-newsletter.js');
    expect(script).toContain('pointerdown');
    expect(script).toContain('focalFromDrag');
    expect(script).toContain('expectedRevision');
  });
});
