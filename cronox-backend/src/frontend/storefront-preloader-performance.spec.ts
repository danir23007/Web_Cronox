import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

type Timing = {
  scrollUnlockedAtMs: number | null;
  overlayRemovedAtMs: number | null;
  readyEvents: number;
};
type Audit = { preloader: Record<string, Timing> };
const root = path.resolve(__dirname, '../../..');
const audit = JSON.parse(
  execFileSync(
    process.execPath,
    [
      path.join(
        root,
        'cronox-backend/scripts/measure-storefront-performance.cjs',
      ),
    ],
    { encoding: 'utf8' },
  ),
) as Audit;

describe('storefront preloader performance', () => {
  it.each(['app', 'failsafe'])(
    '%s releases only loader images after the existing fade',
    (implementation) => {
      const dom = new JSDOM(
        '<body class="is-loading"><div id="preloader"><img src="loader.gif" srcset="loader-2x.gif 2x"></div><img id="product" src="product.jpg"><video src="hero.mp4"></video></body>',
        { runScripts: 'outside-only', url: 'http://localhost/' },
      );
      const callbacks: Array<() => void> = [];
      dom.window.setTimeout = (callback: TimerHandler) => {
        callbacks.push(callback as () => void);
        return callbacks.length;
      };
      dom.window.requestAnimationFrame = (callback) => {
        callback(0);
        return 1;
      };
      const document = dom.window.document;
      const loaderImage = document.querySelector('#preloader img')!;
      if (implementation === 'app') {
        const script = readFileSync(
          path.join(root, 'cronox-front/assets/app.js'),
          'utf8',
        );
        dom.window.eval(
          script.slice(
            script.indexOf('  // ===== Preloader ====='),
            script.indexOf('  // ===== Topbar ====='),
          ),
        );
      } else {
        const html = new JSDOM(
          readFileSync(path.join(root, 'cronox-front/index.html'), 'utf8'),
        );
        const script = Array.from(html.window.document.scripts).find((s) =>
          s.textContent?.includes('var tried=false'),
        )!;
        dom.window.eval(script.textContent);
        html.window.close();
      }
      document.dispatchEvent(
        new dom.window.Event('DOMContentLoaded', { bubbles: true }),
      );
      if (implementation === 'failsafe') callbacks.shift()!();
      expect(loaderImage.hasAttribute('src')).toBe(true);
      expect(document.body.classList.contains('is-loaded')).toBe(true);
      callbacks.shift()!();
      expect(loaderImage.hasAttribute('src')).toBe(false);
      expect(loaderImage.hasAttribute('srcset')).toBe(false);
      expect(document.getElementById('preloader')).toBeNull();
      expect(document.querySelector('#product')?.getAttribute('src')).toBe(
        'product.jpg',
      );
      expect(document.querySelector('video')?.getAttribute('src')).toBe(
        'hero.mp4',
      );
      dom.window.close();
    },
  );

  it.each(['slowResources', 'missingLoad'])(
    'reveals the DOM without waiting for %s',
    (scenario) => {
      expect(audit.preloader[scenario]).toMatchObject({
        scrollUnlockedAtMs: 532,
        overlayRemovedAtMs: 1132,
        imageReleasedAtMs: 1132,
        readyEvents: 1,
      });
    },
  );

  it('keeps the fade duration and dispatches readiness once on a fast load', () => {
    expect(audit.preloader.fast).toMatchObject({
      scrollUnlockedAtMs: 132,
      overlayRemovedAtMs: 732,
      readyEvents: 1,
    });
  });

  it('unlocks scrolling even if app.js and window.load are unavailable', () => {
    expect(audit.preloader.appFailure).toMatchObject({
      scrollUnlockedAtMs: 4000,
      overlayRemovedAtMs: 4600,
      imageReleasedAtMs: 4600,
      readyEvents: 1,
    });
  });

  it('leaves the persistent checkout loader to its existing controller', () => {
    expect(audit.preloader.persistentCheckout).toMatchObject({
      scrollUnlockedAtMs: null,
      overlayRemovedAtMs: null,
      imageReleasedAtMs: null,
      readyEvents: 0,
    });
  });

  it('preserves the hero video, poster, playback attributes and preloader image', () => {
    const dom = new JSDOM(
      readFileSync(path.join(root, 'cronox-front/index.html'), 'utf8'),
    );
    const video = dom.window.document.querySelector('video.hero-video')!;
    expect(video.getAttribute('src')).toBe('assets/VIDEO_LOGO_CRONOX.mp4');
    expect(video.getAttribute('poster')).toBe('assets/logo_banner.png');
    for (const attribute of ['autoplay', 'muted', 'loop', 'playsinline']) {
      expect(video.hasAttribute(attribute)).toBe(true);
    }
    expect(
      dom.window.document.querySelector('#preloader img')?.getAttribute('src'),
    ).toBe('assets/CRONOX-preloader.webp');
    dom.window.close();
  });
});
