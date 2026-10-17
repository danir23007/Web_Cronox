import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const frontendRoot = path.resolve(__dirname, '../../../cronox-front');
const readFrontend = (file: string) =>
  readFileSync(path.join(frontendRoot, file), 'utf8');

describe('profile accreditation image and mobile layout', () => {
  const html = readFrontend('profile.html');
  const css = readFrontend('assets/store.css');
  const script = readFrontend('assets/profile.js');

  it('loads the selected book as a real eager image that participates in readiness, without an inactive download', async () => {
    const dom = new JSDOM(html, { url: 'http://localhost/profile.html', runScripts: 'outside-only' });
    const document = dom.window.document;
    const art = document.querySelector<HTMLImageElement>(
      '.accreditation-book-art',
    );

    expect(art?.hasAttribute('src')).toBe(false);
    expect(document.querySelector('link[rel="preload"][href*="Libro-antiguo"]')).toBeNull();
    dom.window.eval(readFrontend('assets/accreditation-designs.js'));
    const api = (dom.window as any).CRONOX_ACCREDITATION_DESIGNS;
    await api.apply(document.querySelector('[data-profile-section="accreditation"]'), {
      id: 'original', renderer: 'original-v1', config: { version: 1, artworkUrl: '/assets/configured-book.png' },
    });
    expect(art?.getAttribute('src')).toBe('/assets/configured-book.png');
    expect(art?.getAttribute('loading')).not.toBe('lazy');
    expect(art?.getAttribute('fetchpriority')).toBe('high');
    expect(script).toContain('ensureAccreditationBook()');
    expect(script).toContain('accreditationQrLoaded = loaded');
    expect(script).toContain('resolve(img.naturalWidth > 0)');
    expect(script).toContain("retryUrl.searchParams.set('crx_retry'");
    expect(css).not.toMatch(/\.accreditation-book::before\s*\{/);
    dom.window.close();
  });

  it('uses a fixed design plane with proportionally scaled artwork, text and hit areas', () => {
    const document = new JSDOM(html).window.document;
    expect(document.querySelector('[data-acc-stat="products"]')).not.toBeNull();
    expect(script).toContain('stats.productosDiferentes');
    expect(css).toMatch(
      /\.accreditation-pages\s*\{[^}]*left:\s*50%;[^}]*width:\s*100%;/s,
    );
    expect(
      document.querySelector('.accreditation-book-frame > .accreditation-book'),
    ).not.toBeNull();
    const bookRules = css.slice(
      css.indexOf('.account-section--accreditation {'),
      css.indexOf('/* ===== Newsletter Modal ===== */'),
    );
    expect(bookRules).toContain('--accreditation-design-width: 1100;');
    expect(bookRules).toContain(
      'transform: scale(var(--accreditation-scale, 1));',
    );
    expect(bookRules).toContain('width: 170px;');
    expect(bookRules).not.toMatch(
      /(?:font-size|gap|padding|width):\s*(?:clamp\(|max\(66px|[^;]*cqw)/,
    );
    expect(bookRules).not.toContain('overflow: hidden;');
    expect(css).not.toContain('clamp(170px, 34vw, 105px)');
    expect(css).not.toContain('clamp(15px, 3vw, 10px)');
  });

  it('reserves the scaled dimensions and refits after resize, visibility, fonts and images without cancelling pinch zoom', () => {
    const layout = readFrontend('assets/accreditation-layout.js');
    const dom = new JSDOM(
      '<div class="topbar"></div><div class="accreditation-stage"><div class="accreditation-book-frame"><div class="accreditation-book" style="--accreditation-design-width:1100;--accreditation-design-ratio:1.36"><img></div></div></div>',
      { runScripts: 'outside-only' },
    );
    try {
      const win = dom.window;
      const stage = win.document.querySelector<HTMLElement>(
        '.accreditation-stage',
      )!;
      const frame = win.document.querySelector<HTMLElement>(
        '.accreditation-book-frame',
      )!;
      const book = win.document.querySelector<HTMLElement>(
        '.accreditation-book',
      )!;
      stage.style.padding = '28px 0';
      let available = 550;
      Object.defineProperty(stage, 'clientWidth', { get: () => available });
      Object.defineProperty(win, 'innerHeight', {
        writable: true,
        value: 2000,
      });
      const jobs: FrameRequestCallback[] = [];
      win.requestAnimationFrame = (callback) => {
        jobs.push(callback);
        return jobs.length;
      };
      let observeResize: ResizeObserverCallback | undefined;
      Object.assign(win, {
        ResizeObserver: class {
          constructor(callback: ResizeObserverCallback) {
            observeResize = callback;
          }
          observe() {}
        },
      });
      win.eval(layout);
      jobs.shift()!(0);
      expect(Number(book.style.getPropertyValue('--accreditation-scale'))).toBe(
        0.5,
      );
      expect(parseFloat(frame.style.width)).toBeCloseTo(550);
      expect(parseFloat(frame.style.height)).toBeCloseTo(550 / 1.36);
      available = 0;
      observeResize!([], {} as ResizeObserver);
      jobs.shift()!(0);
      expect(parseFloat(frame.style.width)).toBe(550);
      available = 1100;
      Object.defineProperty(win, 'innerHeight', { value: 400 });
      win.dispatchEvent(new win.Event('resize'));
      win.document.querySelector('img')!.dispatchEvent(new win.Event('load'));
      expect(jobs).toHaveLength(1); // all resize/load signals coalesce
      jobs.shift()!(0);
      expect(parseFloat(frame.style.height)).toBeCloseTo(320);
      expect(
        parseFloat(frame.style.width) / parseFloat(frame.style.height),
      ).toBeCloseTo(1.36);
      expect(jobs).toHaveLength(0);
      expect(layout).not.toContain('visualViewport.');
    } finally {
      dom.window.close();
    }
  });
});
