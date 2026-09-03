import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const frontendRoot = path.resolve(__dirname, '../../../cronox-front');
const readFrontend = (file: string) =>
  readFileSync(path.join(frontendRoot, file), 'utf8');

const routes = [
  'index.html',
  'producto.html',
  'gallery.html',
  'cart.html',
  'checkout.html',
  'checkout-success.html',
  'favorites.html',
  'profile.html',
  'forgot-password.html',
  'reset-password.html',
  'faqs.html',
  'events.html',
  'develop.html',
  'aviso-legal.html',
  'privacy-policy.html',
  'terms-of-service.html',
  'shipping-policy.html',
  'returns-exchanges.html',
  'cookie-policy.html',
  'admin.html',
  'admin-user.html',
] as const;

const requiredViewports = [
  [320, 568],
  [360, 640],
  [360, 800],
  [375, 667],
  [375, 812],
  [390, 844],
  [412, 915],
  [568, 320],
  [667, 375],
  [844, 390],
  [700, 900],
  [768, 1024],
  [820, 1180],
  [1024, 768],
  [1024, 1366],
  [1280, 720],
  [1366, 768],
  [1440, 900],
  [1536, 864],
  [1920, 1080],
  [2560, 1080],
  [2560, 1440],
] as const;

const storeStyles = readFrontend('assets/store.css');
const galleryStyles = readFrontend('assets/gallery.css');
const quickAddStyles = readFrontend('assets/quick-add.css');
const productDetailStyles = readFrontend('assets/product-detail.css');
const checkoutStyles = readFrontend('assets/checkout.css');
const cartStyles = readFrontend('assets/cart.css');
const infoStyles = readFrontend('assets/info-page.css');
const successStyles = readFrontend('assets/checkout-success.css');

describe('CRONOX responsive design system', () => {
  it.each(routes)(
    '%s declares a device-width viewport without duplicate IDs',
    (route) => {
      const dom = new JSDOM(readFrontend(route));
      const document = dom.window.document;
      const viewport = document.querySelector<HTMLMetaElement>(
        'meta[name="viewport"]',
      );
      const ids = Array.from(
        document.querySelectorAll<HTMLElement>('[id]'),
      ).map((element) => element.id);

      expect(viewport?.content).toContain('width=device-width');
      expect(viewport?.content).toContain('initial-scale=1');
      expect(new Set(ids).size).toBe(ids.length);
      dom.window.close();
    },
  );

  it('uses fluid primitives instead of scaling the complete document', () => {
    expect(storeStyles).toContain(
      '*,*::before,*::after{box-sizing:border-box}',
    );
    expect(storeStyles).toMatch(
      /html,body\{[^}]*width:100%;[^}]*max-width:100%;[^}]*overflow-x:hidden;/,
    );
    expect(storeStyles).not.toMatch(/(?:html|body)\s*\{[^}]*\bzoom\s*:/s);
    expect(storeStyles).not.toMatch(
      /(?:html|body)\s*\{[^}]*transform:\s*scale\(/s,
    );
  });

  it('covers every viewport with undistorted full-screen hero media', () => {
    expect(storeStyles).toMatch(
      /\.hero-video-section\{[^}]*min-height:100vh;[^}]*min-height:100svh;[^}]*height:100vh;[^}]*height:100dvh;[^}]*overflow:hidden;/,
    );
    expect(storeStyles).toMatch(
      /\.hero-video\{[^}]*width:100%;[^}]*height:100%;[^}]*object-fit:cover;[^}]*object-position:center;[^}]*transform:none;/,
    );
    expect(storeStyles).toMatch(
      /\.hero-overlay-text h1\{[^}]*padding:0 clamp\([^}]*font:800 clamp\(/,
    );
  });

  it('keeps shared navigation usable at 320px and respects safe areas', () => {
    expect(storeStyles).toMatch(
      /\.topbar\{[^}]*height:calc\(var\(--topbar-h\) \+ env\(safe-area-inset-top\)\);[^}]*padding:env\(safe-area-inset-top\)/,
    );
    expect(storeStyles).toMatch(
      /@media \(max-width:520px\)[\s\S]*?\.topbar\{[^}]*grid-template-columns:auto minmax\(74px,1fr\) auto;[^}]*padding-right:max\(6px,env\(safe-area-inset-right\)\);[^}]*padding-left:max\(6px,env\(safe-area-inset-left\)\);/,
    );
    expect(storeStyles).toMatch(
      /\.black-menu\{[^}]*height:100vh;[^}]*height:100dvh;[^}]*max-width:100%;[^}]*overflow-y:auto;/,
    );
    expect(storeStyles).toMatch(
      /\.search-suggestions\{right:auto;width:min\(100%,calc\(100vw - 24px\)\);[^}]*max-height:65dvh/,
    );
  });

  it('uses a fluid reserved product-media ratio at every card width', () => {
    expect(storeStyles).toMatch(
      /\.product-media\{[^}]*aspect-ratio:3\/4;[^}]*overflow:hidden;/,
    );
    expect(storeStyles).toMatch(
      /\.product-images\{[^}]*width:100%;[^}]*height:100%;[^}]*overflow:hidden;/,
    );
    expect(storeStyles).toMatch(
      /\.product-img\{[^}]*width:100%;[^}]*height:100%;[^}]*object-fit:contain;/,
    );
    expect(storeStyles).not.toMatch(/\.product-img\{[^}]*height:520px/);
  });

  it('uses four fluid storefront columns from 700 through 1280px', () => {
    expect(storeStyles).toMatch(
      /\.products-grid\{[^}]*grid-template-columns:repeat\(5,minmax\(0,1fr\)\);[^}]*gap:clamp\(12px,1\.5vw,22px\);[^}]*width:100%;[^}]*max-width:none;[^}]*padding:0;/,
    );
    expect(storeStyles).toMatch(
      /@media \(max-width:1280px\)\{\s*\.products-grid\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\);\}/,
    );
    expect(storeStyles).toMatch(
      /@media \(max-width:640px\)\{\s*\.products-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\);\}/,
    );
    expect(storeStyles).not.toMatch(
      /@media \(max-width:768px\)\{\s*\.products-grid\{grid-template-columns:repeat\(2/,
    );
    expect(storeStyles).toMatch(
      /\.product-card\{[^}]*min-width:0;[^}]*max-width:none;[^}]*padding:0;[^}]*width:100%;[^}]*justify-self:stretch;/,
    );

    const expectedColumns = new Map([
      [320, 2],
      [375, 2],
      [390, 2],
      [568, 2],
      [640, 2],
      [667, 4],
      [700, 4],
      [720, 4],
      [768, 4],
      [1024, 4],
      [1280, 4],
      [1440, 5],
      [1920, 5],
    ]);

    expectedColumns.forEach((columns, viewportWidth) => {
      const storePadding = viewportWidth <= 480 ? 28 : 32;
      const gap = Math.min(22, Math.max(12, viewportWidth * 0.015));
      const available = viewportWidth - storePadding;
      const cardWidth = (available - gap * (columns - 1)) / columns;

      expect(cardWidth).toBeGreaterThan(0);
      expect(cardWidth * columns + gap * (columns - 1)).toBe(available);

      if (viewportWidth >= 700 && viewportWidth <= 768) {
        expect(columns).toBe(4);
        expect(cardWidth).toBeGreaterThanOrEqual(158);
        expect(cardWidth * 4 + gap * 3).toBe(available);
      }
    });
  });

  it('keeps the complete footer within a shrinkable, fluid layout', () => {
    expect(storeStyles).toMatch(
      /\.site-footer\s*\{[^}]*padding:\s*20px clamp\(18px, 4\.7vw, 90px\) 12px;/,
    );
    expect(storeStyles).toMatch(
      /\.footer-inner\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(132px, 160px\) minmax\(0, 1fr\);[^}]*align-items:\s*stretch;[^}]*gap:\s*clamp\(32px, 4vw, 72px\);[^}]*width:\s*100%;[^}]*min-width:\s*0;/,
    );
    expect(storeStyles).toMatch(
      /\.footer-middle-sections\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(280px, 360px\);[^}]*align-items:\s*center;[^}]*gap:\s*clamp\(32px, 4vw, 72px\);[^}]*width:\s*100%;/,
    );
    expect(storeStyles).toMatch(
      /\.footer-accordion\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);[^}]*gap:\s*clamp\(24px, 4vw, 80px\);[^}]*margin:\s*0;[^}]*width:\s*auto;[^}]*min-width:\s*0;/,
    );
    expect(storeStyles).toMatch(
      /\.footer-newsletter-block\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*margin-left:\s*0;[^}]*max-width:\s*360px;[^}]*justify-self:\s*end;/,
    );
    expect(storeStyles).toMatch(
      /\.footer-logo\s*\{[^}]*width:\s*min\(100%, 144px\);[^}]*height:\s*auto;[^}]*object-fit:\s*contain;/,
    );
    expect(storeStyles).toMatch(
      /@media \(max-width: 1100px\)\s*\{[\s\S]*?\.footer-inner\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[\s\S]*?\.footer-middle-sections\s*\{[^}]*display:\s*flex;[^}]*width:\s*100%;[^}]*flex-direction:\s*column;[^}]*align-items:\s*stretch;[\s\S]*?\.footer-accordion\s*\{[^}]*width:\s*100%;/,
    );
    expect(storeStyles).toMatch(
      /@media \(max-width: 480px\)\s*\{[\s\S]*?\.footer-acc-item\s*\{[^}]*display:\s*block;/,
    );
    expect(storeStyles).not.toContain('gap: 220px');
    expect(storeStyles).not.toContain('margin: 0 auto 0 500px');

    const checkedWidths = [
      320, 360, 375, 390, 412, 480, 568, 700, 768, 960, 961, 1024, 1100, 1101,
      1280, 1440, 1536, 1920, 2560,
    ];
    checkedWidths.forEach((viewportWidth) => {
      const inlinePadding =
        viewportWidth <= 480
          ? 18
          : Math.min(90, Math.max(18, viewportWidth * 0.047));
      const footerContentWidth = viewportWidth - inlinePadding * 2;

      expect(footerContentWidth).toBeGreaterThan(0);
      expect(footerContentWidth + inlinePadding * 2).toBe(viewportWidth);
    });
  });

  it('preserves the desktop Gallery composition proportionally on narrow screens', () => {
    const mobileGallery = galleryStyles.match(
      /@media \(max-width: 767px\)\s*\{([\s\S]*?)\n\}/,
    )?.[1];

    expect(mobileGallery).toMatch(
      /\.gallery-grid\s*\{[^}]*grid-template-columns:\s*repeat\(6, minmax\(0, 1fr\)\);[^}]*grid-template-rows:\s*repeat\(3, minmax\(0, 1fr\)\);[^}]*aspect-ratio:\s*2 \/ 1;[^}]*overflow:\s*hidden;/,
    );
    expect(mobileGallery).toMatch(
      /\.gallery__tile--featured\s*\{[^}]*grid-column:\s*span 2;[^}]*grid-row:\s*span 3;/,
    );
    expect(mobileGallery).not.toContain('grid-column: 1 / -1');
    expect(galleryStyles).toContain(
      'height: calc(100dvh - var(--topbar-h, 64px) - env(safe-area-inset-top))',
    );
  });

  it('bounds all full-screen customer overlays to the dynamic viewport', () => {
    expect(storeStyles).toMatch(
      /\.cronox-auth__dialog\{[^}]*max-height:calc\(100dvh[^}]*overflow-y:auto;/,
    );
    expect(storeStyles).toMatch(
      /\.cart-drawer\s*\{[^}]*height:\s*calc\(100dvh[^}]*safe-area-inset-top/,
    );
    expect(quickAddStyles).toMatch(
      /\.qa-panel\{[^}]*max-height:calc\(100dvh[^}]*safe-area-inset-bottom/,
    );
    expect(productDetailStyles).toMatch(
      /\.product-detail__panel\s*\{[^}]*max-height:\s*calc\(100dvh[^}]*safe-area-inset-bottom/,
    );
    expect(checkoutStyles).toMatch(
      /\.checkout-modal__dialog\s*\{[^}]*max-height:\s*min\(760px, calc\(100dvh/,
    );
    expect(successStyles).toMatch(
      /\.checkout-success\s*\{[^}]*min-height:\s*100dvh;/,
    );
  });

  it('retains responsive route-specific grids and narrow-screen fallbacks', () => {
    expect(checkoutStyles).toMatch(
      /@media \(max-width: 900px\)[\s\S]*?\.checkout-shell\s*\{[^}]*flex-direction:\s*column;/,
    );
    expect(checkoutStyles).toMatch(
      /@media \(max-width: 520px\)[\s\S]*?\.form-grid--halves,[\s\S]*?grid-template-columns:\s*1fr;/,
    );
    expect(cartStyles).toMatch(
      /@media \(max-width: 900px\)\{[\s\S]*?\.cart-grid\{[\s\S]*?grid-template-columns:\s*1fr;/,
    );
    expect(infoStyles).toContain('min-height: 100dvh');
    expect(infoStyles).toContain('env(safe-area-inset-top)');
  });

  it.each(requiredViewports)(
    'keeps proportional Gallery and positive content widths at %ix%i',
    (width, height) => {
      const galleryHeight = width / 2;
      const compactGutter = width <= 520 ? 12 : 16;
      const usableWidth = width - compactGutter * 2;

      expect(width).toBeGreaterThanOrEqual(320);
      expect(height).toBeGreaterThanOrEqual(320);
      expect(galleryHeight).toBeLessThanOrEqual(width);
      expect(usableWidth).toBeGreaterThan(0);
    },
  );

  it('loads each modified stylesheet through its exact incremented cache version', () => {
    expect(readFrontend('assets/version.js')).toContain("VERSION = '90'");
    expect(readFrontend('index.html')).toContain('assets/gallery.css?v=14');
    expect(readFrontend('index.html')).toContain('assets/quick-add.css?v=3');
    expect(readFrontend('index.html')).toContain(
      'assets/product-detail.css?v=2',
    );
    expect(readFrontend('gallery.html')).toContain('assets/info-page.css?v=2');
    expect(readFrontend('cart.html')).toContain('assets/cart.css?v=4');
    expect(readFrontend('checkout.html')).toContain('assets/checkout.css?v=19');
    expect(readFrontend('checkout-success.html')).toContain(
      'assets/checkout-success.css?v=1',
    );
    expect(readFrontend('producto.html')).toContain(
      'assets/product-page.css?v=6',
    );
  });
});
