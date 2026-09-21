import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const frontendRoot = path.resolve(__dirname, '../../../cronox-front');
const read = (file: string) =>
  readFileSync(path.join(frontendRoot, file), 'utf8');
const storeStyles = read('assets/store.css');
const quickAddStyles = read('assets/quick-add.css');
const productsScript = read('assets/products.js');

const pointer = (window: any, type: string, x: number, y: number) => {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: 7 },
    pointerType: { value: 'touch' },
    button: { value: 0 },
    clientX: { value: x },
    clientY: { value: y },
  });
  return event;
};

const hoverPointer = (window: any, type: string, pointerType = 'mouse') => {
  const event = new window.Event(type, { bubbles: false, cancelable: true });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  return event;
};

const createHarness = async () => {
  const dom = new JSDOM('<!doctype html><div id="productsGrid"></div>', {
    runScripts: 'outside-only',
    url: 'http://localhost:3000/',
  });
  const app = dom.window as any;
  app.matchMedia = jest.fn(() => ({ matches: false }));
  app.CRONOX_API = { getFallbackProducts: () => [] };
  app.CRONOX_SECURITY = {
    productImageUrl: (value: unknown, fallback: string) =>
      typeof value === 'string' && value ? value : fallback,
  };
  app.CRONOX_IMAGES = {
    productRecords: (product: any) => product.images,
    applyProduct: (image: HTMLImageElement, product: any) => {
      image.src = product.images[0].url;
    },
    apply: (image: HTMLImageElement, record: any) => {
      image.src = record.url;
    },
  };
  app.eval(productsScript);
  await app.CRONOX_catalogReady;
  return { dom, app };
};

const product = (images = ['/one.webp', '/two.webp', '/three.webp']) => {
  const sizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
  const variants = sizes.map((size, index) => ({
    id: index + 1,
    size,
    stock: 2,
    isActive: true,
    isAvailable: true,
  }));
  return {
    id: 1,
    slug: 'mobile-tee',
    name: 'MOBILE TEE',
    price: 35,
    sizeSystem: 'APPAREL',
    images: images.map((url) => ({ url, variants: { card: `${url}?card` } })),
    sizes,
    variants,
    variantMap: Object.fromEntries(
      variants.map((variant) => [variant.size, variant]),
    ),
  };
};

describe('mobile storefront refinement', () => {
  it('keeps only the mobile homepage hero on a stable small viewport', () => {
    expect(storeStyles).toMatch(
      /@media \(max-width:480px\)\{\s*\.hero-video-section\{[^}]*height:100vh;[^}]*height:100svh;[^}]*min-height:100vh;[^}]*min-height:100svh;[^}]*overflow:hidden;/,
    );
    expect(storeStyles).not.toMatch(
      /@media \(max-width:480px\)\{\s*\.hero-video-section\{[^}]*100dvh/,
    );
    expect(storeStyles).toMatch(
      /\.hero-video\{[^}]*width:100%;[^}]*height:100%;[^}]*object-fit:cover;/,
    );
    expect(storeStyles).toContain(
      'html:not(.category-page) .hero-video-section{ margin-bottom:8px; }',
    );
    expect(storeStyles).toContain(
      'html.category-page .store{padding-top:calc(var(--topbar-h) + 18px);}',
    );
    expect(storeStyles).toContain('height:100dvh');
  });

  it('anchors a growing cart badge to the icon and balances the mobile topbar', () => {
    expect(storeStyles).toContain(
      'grid-template-columns:minmax(0,1fr) auto minmax(0,1fr)',
    );
    expect(storeStyles).toMatch(
      /\.topbar__cart\{[^}]*position:relative;[^}]*justify-content:center;[^}]*width:36px;[^}]*height:36px;/,
    );
    expect(storeStyles).toMatch(
      /\.topbar__cart \.cart-count\{[^}]*top:3px;[^}]*left:calc\(50% \+ 5px\);[^}]*right:auto;[^}]*min-width:16px;[^}]*white-space:nowrap;/,
    );
    expect(storeStyles).not.toMatch(
      /\.topbar__cart \.cart-count\{[^}]*right:-/,
    );
    expect(storeStyles).toMatch(
      /@media \(max-width:520px\)[\s\S]*?grid-template-columns:minmax\(0,1fr\) auto minmax\(0,1fr\);[\s\S]*?\.topbar__right\{gap:4px;/,
    );
    expect(storeStyles).toContain(
      'padding-left:max(12px,env(safe-area-inset-left))',
    );
    expect(storeStyles).toContain(
      '.topbar__right{justify-self:end;display:flex;gap:16px;align-items:center}',
    );
    expect(storeStyles).toContain(
      '.topbar__fav + .topbar__cart{margin-left:-6px;}',
    );
    expect(storeStyles).toMatch(
      /@media \(max-width:520px\)[\s\S]*?\.topbar__fav \+ \.topbar__cart\{margin-left:0;\}/,
    );

    for (const route of [
      'index.html',
      'producto.html',
      'favorites.html',
      'profile.html',
      'cart.html',
    ]) {
      const dom = new JSDOM(read(route));
      const cart = dom.window.document.querySelector('.topbar__cart');
      expect(cart?.querySelector('.icon-bag')).not.toBeNull();
      expect(cart?.querySelector('.cart-count')).not.toBeNull();
      dom.window.close();
    }
  });

  it('uses independent mobile row and column gaps and visible proportional arrows', () => {
    expect(storeStyles).toMatch(
      /@media \(max-width:480px\)[\s\S]*?\.products-grid\{\s*column-gap:12px;\s*row-gap:8px;/,
    );
    expect(storeStyles).toMatch(
      /@media \(max-width:480px\)[\s\S]*?\.product-images\{[^}]*touch-action:pan-y;/,
    );
    expect(storeStyles).toMatch(
      /@media \(max-width:480px\)[\s\S]*?\.product-arrow\{[^}]*display:block!important;[^}]*width:26px!important;[^}]*height:36px!important;/,
    );
    expect(storeStyles).toContain(
      '.products-grid{position:relative;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:clamp(12px,1.5vw,22px)',
    );
  });

  it('fits APPAREL sizes in one mobile row while leaving other systems wrappable', () => {
    expect(quickAddStyles).toMatch(
      /\.qa-sizes\[data-size-system="APPAREL"\]\{[^}]*display:grid;[^}]*grid-template-columns:repeat\(6,minmax\(0,1fr\)\);[^}]*gap:4px;[^}]*width:100%;/,
    );
    expect(quickAddStyles).toMatch(
      /\.qa-sizes\[data-size-system="APPAREL"\] \.qa-size-btn\{[^}]*min-width:0;[^}]*min-height:44px;[^}]*padding:9px 2px;/,
    );
    expect(quickAddStyles).toMatch(
      /@media \(max-width:640px\)[\s\S]*?\.qa-info\{[^}]*margin-top:32px !important;/,
    );
    expect(quickAddStyles).toMatch(
      /\.qa-sizes\{\s*display:flex;\s*flex-wrap:wrap;/,
    );

    for (const width of [320, 360, 375, 390, 414, 430]) {
      const contentWidth = width - 8 - 28;
      const buttonWidth = (contentWidth - 5 * 4) / 6;
      expect(buttonWidth).toBeGreaterThanOrEqual(44);
    }
  });

  it('shares one index for arrows, desktop hover, and discriminated swipe', async () => {
    const { dom, app } = await createHarness();
    const card = app.CRONOX_createProductCard(product());
    app.document.getElementById('productsGrid').appendChild(card);
    const gallery = card.querySelector('.product-images')!;
    const activeIndex = () => Number(gallery.getAttribute('data-active-index'));

    expect(card.querySelectorAll('.product-arrow')).toHaveLength(2);
    expect(activeIndex()).toBe(0);

    gallery.dispatchEvent(pointer(dom.window, 'pointerdown', 220, 100));
    gallery.dispatchEvent(pointer(dom.window, 'pointerup', 150, 104));
    expect(activeIndex()).toBe(1);
    expect(
      card.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }),
      ),
    ).toBe(false);

    gallery.dispatchEvent(pointer(dom.window, 'pointerdown', 100, 100));
    gallery.dispatchEvent(pointer(dom.window, 'pointerup', 112, 102));
    expect(activeIndex()).toBe(1);

    gallery.dispatchEvent(pointer(dom.window, 'pointerdown', 100, 100));
    gallery.dispatchEvent(pointer(dom.window, 'pointerup', 130, 175));
    expect(activeIndex()).toBe(1);

    gallery.dispatchEvent(pointer(dom.window, 'pointerdown', 100, 100));
    gallery.dispatchEvent(pointer(dom.window, 'pointerup', 165, 103));
    expect(activeIndex()).toBe(0);

    app.matchMedia = jest.fn(() => ({ matches: true }));
    card.dispatchEvent(hoverPointer(dom.window, 'pointerenter'));
    expect(activeIndex()).toBe(1);
    card.querySelector<HTMLButtonElement>('.product-arrow.next')!.click();
    expect(activeIndex()).toBe(2);
    card.dispatchEvent(hoverPointer(dom.window, 'pointerleave'));
    expect(activeIndex()).toBe(0);

    const single = app.CRONOX_createProductCard(product(['/only.webp']));
    expect(single.querySelectorAll('.product-arrow')).toHaveLength(0);
    dom.window.close();
  });

  it('marks Quick Add from product size-system metadata', async () => {
    const { dom, app } = await createHarness();
    const apparelCard = app.CRONOX_createProductCard(product());
    app.document.body.appendChild(apparelCard);
    apparelCard.querySelector<HTMLButtonElement>('.fav-add')!.click();
    const sizes = app.document.querySelector('.qa-sizes');
    expect(sizes.dataset.sizeSystem).toBe('APPAREL');
    expect(sizes.querySelectorAll('.qa-size-btn')).toHaveLength(6);
    sizes.querySelectorAll<HTMLButtonElement>('.qa-size-btn')[1].click();
    expect(sizes.querySelectorAll('[aria-checked="true"]')).toHaveLength(1);

    const ring = product();
    ring.sizeSystem = 'US_RING';
    ring.sizes = ['US_6', 'US_7', 'US_8', 'US_9', 'US_10', 'US_11', 'US_12'];
    ring.variants = ring.sizes.map((size, index) => ({
      id: index + 10,
      size,
      stock: index === 0 ? 0 : 2,
      isActive: true,
      isAvailable: index !== 0,
    }));
    ring.variantMap = Object.fromEntries(
      ring.variants.map((variant) => [variant.size, variant]),
    );
    const ringCard = app.CRONOX_createProductCard(ring);
    app.document.body.appendChild(ringCard);
    ringCard.querySelector<HTMLButtonElement>('.fav-add')!.click();
    expect(sizes.dataset.sizeSystem).toBe('US_RING');
    expect(sizes.querySelectorAll('.qa-size-btn')).toHaveLength(7);
    expect(sizes.querySelector('.qa-size-btn.is-unavailable')).not.toBeNull();
    dom.window.close();
  });
});
