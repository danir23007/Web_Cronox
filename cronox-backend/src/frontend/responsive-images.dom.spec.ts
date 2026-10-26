import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const frontendRoot = path.resolve(__dirname, '../../../cronox-front');

describe('responsive storefront image delivery', () => {
  const read = (file: string) =>
    readFileSync(path.join(frontendRoot, file), 'utf8');

  it.each([false, true])('selects the customer caption by surface, even for an administrator account: %s', customer => {
    const dom = new JSDOM(`<body${customer ? ' data-cronox-surface="customer"' : ''}><img></body>`, {
      url: 'https://cronox.test/', runScripts: 'outside-only',
    });
    const win = dom.window as any;
    win.CRONOX_USER = { role: 'SUPERADMIN' };
    win.CRONOX_SECURITY = { productImageUrl: (value: string) => value };
    try {
      win.eval(read('assets/responsive-images.js'));
      win.CRONOX_IMAGES.applyProduct(win.document.querySelector('img'), {}, 'card');
      expect(win.document.querySelector('img').getAttribute('src')).toBe(customer
        ? '/assets/customer-product-image-unavailable.svg' : 'assets/product-image-unavailable.svg');
    } finally { win.close(); }
  });

  it('centralizes context roles, responsive sizes and original fallback', () => {
    const source = read('assets/responsive-images.js');
    expect(source).toContain('card: { roles: ["card"]');
    expect(source).toContain('quick: { roles: ["quick"]');
    expect(source).toContain('pdp: { roles: ["card", "quick", "pdp"]');
    expect(source).toContain('pdpZoom: { roles: ["pdp"]');
    expect(source).toContain('small: { roles: ["small"]');
    expect(source).toContain('galleryGrid: { roles: ["grid"]');
    expect(source).toContain('galleryLarge: { roles: ["large"]');
    expect(source).toContain('roles: ["mobile", "tablet", "desktop"]');
    expect(source).toContain('preferred?.url || fallback');
    expect(source).toContain('element.srcset = resolved.srcset');
  });

  it('does not rewrite responsive source attributes when framing is reapplied', () => {
    const dom = new JSDOM('<img>', {
      url: 'https://cronox.test/',
      runScripts: 'outside-only',
    });
    Object.assign(dom.window, {
      CRONOX_SECURITY: { productImageUrl: (value: string) => value },
    });
    dom.window.eval(read('assets/responsive-images.js'));
    const image = dom.window.document.querySelector('img')!;
    const record = {
      url: 'https://storage.test/original.png',
      variants: {
        mobile: { url: 'https://storage.test/mobile.webp', width: 1600 },
        tablet: { url: 'https://storage.test/tablet.webp', width: 2200 },
        desktop: { url: 'https://storage.test/desktop.webp', width: 3000 },
      },
    };
    const api = (
      dom.window as unknown as {
        CRONOX_IMAGES: {
          apply: (
            image: HTMLImageElement,
            imageRecord: typeof record,
            context: string,
          ) => unknown;
        };
      }
    ).CRONOX_IMAGES;
    api.apply(image, record, 'hero');
    const observer = new dom.window.MutationObserver(() => undefined);
    observer.observe(image, {
      attributes: true,
      attributeFilter: ['src', 'srcset', 'sizes'],
    });

    api.apply(image, record, 'hero');

    expect(observer.takeRecords()).toEqual([]);
    observer.disconnect();
    dom.window.close();
  });

  it('keeps gallery slides lazy until selected and preserves zoom while its detailed image loads', async () => {
    const dom = new JSDOM(`
      <div id="pMedia"><div id="pMediaViewport"></div>
        <button id="pMediaPrev"></button><button id="pMediaNext"></button></div>
      <div id="pThumbs"></div>`, {
      url: 'https://cronox.test/producto/core', runScripts: 'outside-only', pretendToBeVisual: true,
    });
    const record = (name: string) => ({
      url: `https://storage.test/${name}.png`,
      variants: Object.fromEntries([
        ['card', 975, 1300], ['quick', 1350, 1800], ['pdp', 2550, 3400],
      ].map(([role, width, height]) => [role, { url: `https://storage.test/${name}-${role}.webp`, width, height }])),
    });
    Object.assign(dom.window, {
      scrollTo: () => {},
      matchMedia: (query: string) => ({ matches: query === '(pointer: fine)', addEventListener() {} }),
      CRONOX_SECURITY: { productImageUrl: (value: string) => value },
      CRONOX_PRODUCTS: [{ id: 'core', backendId: 1, slug: 'core', name: 'Core', images: [record('front'), record('back')] }],
    });
    dom.window.eval(read('assets/responsive-images.js'));
    dom.window.eval(read('assets/product-page.js'));
    await new Promise(resolve => setTimeout(resolve, 0));
    const document = dom.window.document;
    const images = [...document.querySelectorAll<HTMLImageElement>('.pdp__media-img')];
    expect(images).toHaveLength(2);
    expect(images.map(image => image.loading)).toEqual(['eager', 'lazy']);
    expect(images[0].srcset).toContain('front-card.webp 975w');
    expect(images[0].srcset).toContain('front-quick.webp 1350w');
    expect(images[0].srcset).toContain('front-pdp.webp 2550w');
    document.getElementById('pMediaNext')!.click();
    expect(images[1].loading).toBe('eager');
    expect(images[1].hidden).toBe(false);
    expect(images[0].hidden).toBe(true);
    document.getElementById('pMedia')!.click();
    expect(images[1].srcset).toBe('https://storage.test/back-pdp.webp 2550w');
    expect(images[1].style.transform).toBe('scale(2)');
    const origin = images[1].style.transformOrigin;
    images[1].dispatchEvent(new dom.window.Event('load'));
    expect(images[1].style.transform).toBe('scale(2)');
    expect(images[1].style.transformOrigin).toBe(origin);
    document.getElementById('pMedia')!.click();
    expect(images[1].style.transform).toBe('scale(4)');
    document.getElementById('pMedia')!.dispatchEvent(new dom.window.MouseEvent('mouseleave'));
    expect(images[1].style.transform).toBe('scale(1)');
    expect(images[1].srcset).toBe('https://storage.test/back-pdp.webp 2550w');
    images[1].dispatchEvent(new dom.window.Event('error'));
    expect(images[1].src).toBe('https://storage.test/back.png');
    document.getElementById('pMedia')!.click();
    expect(images[1].srcset).toBe('https://storage.test/back-pdp.webp 2550w');
    images[1].dispatchEvent(new dom.window.Event('error'));
    expect(images[1].src).toBe('https://storage.test/back.png');
    expect(images[1].srcset).toBe('');
    images[1].dispatchEvent(new dom.window.Event('error'));
    expect(images[1].src).toContain('product-image-unavailable.svg');
    const placeholder = images[1].src;
    images[1].dispatchEvent(new dom.window.Event('error'));
    expect(images[1].src).toBe(placeholder);
    expect(images[1].srcset).toBe('');
    dom.window.close();
  });

  it('emits one candidate per width when small originals produce equal-sized derivatives', () => {
    const dom = new JSDOM('<img>', { url: 'https://cronox.test/', runScripts: 'outside-only' });
    Object.assign(dom.window, { CRONOX_SECURITY: { productImageUrl: (value: string) => value } });
    dom.window.eval(read('assets/responsive-images.js'));
    dom.window.eval(`CRONOX_IMAGES.apply(document.querySelector('img'), {
      url: '/original.png', galleryZoom: 2, variants: {
        card: { url: '/card.webp', width: 600, height: 800 },
        quick: { url: '/quick.webp', width: 600, height: 800 },
        pdp: { url: '/pdp.webp', width: 600, height: 800 }
      }
    }, 'pdp')`);
    expect(dom.window.document.querySelector('img')!.srcset).toBe('/pdp.webp 600w');
    expect(dom.window.document.querySelector('img')!.sizes).toBe('(max-width: 900px) 200vw, 124vw');
    dom.window.close();
  });

  it('does not initialize hidden catalogue hero media, observers or requests', () => {
    const dom = new JSDOM('<html class="category-page"><body><section id="hero"><img data-media-placement="home.hero.video"></section></body></html>', {
      url: 'https://cronox.test/tienda', runScripts: 'outside-only',
    });
    const fetch = jest.fn();
    const ResizeObserver = jest.fn();
    Object.assign(dom.window, { fetch, ResizeObserver });
    dom.window.eval(read('assets/media-framing.js'));
    expect(fetch).not.toHaveBeenCalled();
    expect(ResizeObserver).not.toHaveBeenCalled();
    expect(dom.window.document.querySelector('#hero img')!.hasAttribute('src')).toBe(false);
    dom.window.close();
  });

  it('uses the correct derivative at each storefront call site', () => {
    expect(read('assets/products.js')).toContain(
      'CRONOX_IMAGES.apply(im, record, "card")',
    );
    expect(read('assets/products.js')).toContain('"quick", { loading: \'eager\' }');
    expect(read('assets/product-page.js')).toContain('resolve(item, "pdp")');
    expect(read('assets/product-page.js')).toContain('resolve(item, "small")');
    expect(read('assets/app.js')).toContain('applyProduct(');
    expect(read('assets/app.js')).toContain('"cart"');
    expect(read('assets/checkout.js')).toContain("'checkout'");
    expect(read('assets/gallery.js')).toContain('"galleryGrid"');
    expect(read('assets/gallery.js')).toContain('"galleryLarge"');
  });

  it('prioritizes the image hero and lazy-loads off-screen gallery media', () => {
    const media = read('assets/media-framing.js');
    const gallery = read('assets/gallery.js');
    expect(media).toContain('fetchPriority: "high"');
    expect(media).toContain('loading: "eager"');
    expect(gallery).toContain('image.loading = "lazy"');
  });

  it('does not add white image canvases or padding in shopping contexts', () => {
    const store = read('assets/store.css');
    const checkout = read('assets/checkout.css');
    const quick = read('assets/quick-add.css');
    expect(store).toMatch(
      /\.cart-line__image-frame[\s\S]*?background: transparent;[\s\S]*?padding: 0;/,
    );
    expect(store).toMatch(
      /\.cart-upsell__image-frame[\s\S]*?background: transparent;[\s\S]*?padding: 0;/,
    );
    expect(checkout).toMatch(
      /\.checkout-item__media[\s\S]*?padding: 0;[\s\S]*?background: transparent;/,
    );
    expect(checkout).toMatch(
      /\.checkout-recommendation__image[\s\S]*?padding: 0;[\s\S]*?background: transparent;/,
    );
    expect(quick).toMatch(/\.qa-media img[\s\S]*?background:transparent;/);
  });
});
