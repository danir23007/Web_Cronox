/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const frontendRoot = path.resolve(__dirname, '../../../cronox-front');
const read = (file: string) =>
  readFileSync(path.join(frontendRoot, file), 'utf8');
const productsScript = read('assets/products.js');
const storeStyles = read('assets/store.css');
const relatedStyles = read('assets/product-page.css');

const pointer = (window: any, type: string, pointerType: string) => {
  const event = new window.Event(type, { bubbles: false, cancelable: true });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  return event;
};

const product = (id: number, urls: string[]) => ({
  id,
  backendId: id,
  slug: `product-${id}`,
  name: `PRODUCT ${id}`,
  price: 35,
  images: urls.map((url, sortOrder) => ({
    url,
    sortOrder,
    variants: { card: { url: `${url}?card`, width: 800, height: 1000 } },
  })),
  sizes: ['S'],
  variants: [{ id, size: 'S', stock: 2, isActive: true, isAvailable: true }],
});

const createHarness = async (hover = true) => {
  const dom = new JSDOM('<!doctype html><div id="productsGrid"></div>', {
    runScripts: 'outside-only',
    url: 'http://localhost:3000/',
  });
  const app = dom.window as any;
  app.matchMedia = jest.fn().mockReturnValue({ matches: hover });
  app.CRONOX_API = { getFallbackProducts: () => [] };
  app.CRONOX_SECURITY = {
    productImageUrl: (value: unknown, fallback: string) =>
      typeof value === 'string' && value ? value : fallback,
  };
  app.CRONOX_IMAGES = {
    productRecords: (subject: any) => subject.images,
    originalUrl: (record: any) => record.url,
    applyProduct: (image: HTMLImageElement, subject: any) => {
      const record = subject.images[0];
      image.src = record.variants.card.url;
      return { src: image.src };
    },
    apply: (image: HTMLImageElement, record: any) => {
      image.src = record.variants.card.url;
      return { src: record.variants.card.url };
    },
  };
  app.eval(productsScript);
  await app.CRONOX_catalogReady;
  return { dom, app };
};

const activeIndex = (card: Element) =>
  Number(
    card.querySelector('.product-images')?.getAttribute('data-active-index'),
  );

describe('premium product-card hover gallery', () => {
  it('uses one index for enter, relative arrows, leave reset and re-entry', async () => {
    const { dom, app } = await createHarness();
    const card = app.CRONOX_createProductCard(
      product(1, ['/one.webp', '/two.webp', '/three.webp', '/four.webp']),
    );
    app.document.body.appendChild(card);

    expect(activeIndex(card)).toBe(0);
    card.dispatchEvent(pointer(dom.window, 'pointerenter', 'mouse'));
    expect(activeIndex(card)).toBe(1);
    card.querySelector<HTMLButtonElement>('.product-arrow.next')!.click();
    expect(activeIndex(card)).toBe(2);
    card.querySelector<HTMLButtonElement>('.product-arrow.next')!.click();
    expect(activeIndex(card)).toBe(3);
    card.querySelector<HTMLButtonElement>('.product-arrow.prev')!.click();
    expect(activeIndex(card)).toBe(2);
    card.dispatchEvent(pointer(dom.window, 'pointerleave', 'mouse'));
    expect(activeIndex(card)).toBe(0);
    card.dispatchEvent(pointer(dom.window, 'pointerenter', 'mouse'));
    expect(activeIndex(card)).toBe(1);
    card.querySelector<HTMLButtonElement>('.product-arrow.prev')!.click();
    expect(activeIndex(card)).toBe(0);
    dom.window.close();
  });

  it('ignores touch hover events and keeps independent state for dynamic cards', async () => {
    const { dom, app } = await createHarness();
    const cardA = app.CRONOX_createProductCard(
      product(1, ['/a1.webp', '/a2.webp', '/a3.webp']),
    );
    app.document.body.appendChild(cardA);
    cardA.dispatchEvent(pointer(dom.window, 'pointerenter', 'touch'));
    expect(activeIndex(cardA)).toBe(0);

    const cardB = app.CRONOX_createProductCard(
      product(2, ['/b1.webp', '/b2.webp', '/b3.webp']),
    );
    app.document.body.appendChild(cardB);
    cardA.dispatchEvent(pointer(dom.window, 'pointerenter', 'mouse'));
    cardB.dispatchEvent(pointer(dom.window, 'pointerenter', 'mouse'));
    cardB.querySelector<HTMLButtonElement>('.product-arrow.next')!.click();
    expect(activeIndex(cardA)).toBe(1);
    expect(activeIndex(cardB)).toBe(2);
    cardA.dispatchEvent(pointer(dom.window, 'pointerleave', 'mouse'));
    expect(activeIndex(cardA)).toBe(0);
    expect(activeIndex(cardB)).toBe(2);
    dom.window.close();
  });

  it('does nothing for one image and keeps arrow clicks inside the card', async () => {
    const { dom, app } = await createHarness();
    const single = app.CRONOX_createProductCard(product(1, ['/only.webp']));
    app.document.body.appendChild(single);
    single.dispatchEvent(pointer(dom.window, 'pointerenter', 'mouse'));
    single.dispatchEvent(pointer(dom.window, 'pointerleave', 'mouse'));
    expect(activeIndex(single)).toBe(0);
    expect(single.querySelectorAll('.product-arrow')).toHaveLength(0);

    const multi = app.CRONOX_createProductCard(
      product(2, ['/one.webp', '/two.webp', '/three.webp']),
    );
    app.document.body.appendChild(multi);
    const outerClick = jest.fn();
    app.document.addEventListener('click', outerClick);
    multi.querySelector<HTMLButtonElement>('.product-arrow.next')!.click();
    expect(activeIndex(multi)).toBe(1);
    expect(outerClick).not.toHaveBeenCalled();
    dom.window.close();
  });

  it('tries the secondary optimized and original candidates, then disables broken hover', async () => {
    const { dom, app } = await createHarness();
    const card = app.CRONOX_createProductCard(
      product(1, ['/first.webp', '/broken.webp', '/third.webp']),
    );
    app.document.body.appendChild(card);
    const images = card.querySelectorAll<HTMLImageElement>('.product-img');
    expect(images[1].src).toContain('/broken.webp?card');

    card.dispatchEvent(pointer(dom.window, 'pointerenter', 'mouse'));
    expect(activeIndex(card)).toBe(1);
    images[1].dispatchEvent(new dom.window.Event('error'));
    expect(images[1].src).toBe('http://localhost:3000/broken.webp');
    expect(activeIndex(card)).toBe(1);
    images[1].dispatchEvent(new dom.window.Event('error'));
    expect(images[1].dataset.galleryUnavailable).toBe('true');
    expect(activeIndex(card)).toBe(0);

    card.dispatchEvent(pointer(dom.window, 'pointerenter', 'mouse'));
    expect(activeIndex(card)).toBe(0);
    card.querySelector<HTMLButtonElement>('.product-arrow.next')!.click();
    expect(activeIndex(card)).toBe(2);
    dom.window.close();
  });

  it('keeps one binding path and stable opacity-stacked geometry with reduced motion', () => {
    expect(
      productsScript.match(/addEventListener\("pointerenter"/g),
    ).toHaveLength(1);
    expect(
      productsScript.match(/addEventListener\("pointerleave"/g),
    ).toHaveLength(1);
    expect(productsScript).toContain('a.dataset.cardGalleryBound = "true"');
    expect(storeStyles).toMatch(
      /\.product-img\{position:absolute;inset:0;[^}]*opacity:0;transition:opacity \.28s ease;/,
    );
    expect(storeStyles).toContain(
      '.product-img:not(.active){pointer-events:none;}',
    );
    expect(storeStyles).toMatch(
      /\.page-favorites #favorites-grid \.product-img\{[^}]*position:absolute;[^}]*opacity:0;[^}]*transition:opacity \.28s ease;/,
    );
    expect(relatedStyles).toMatch(
      /\.pdp-related \.product-img\{[^}]*position:absolute;[^}]*opacity:0;[^}]*transition:opacity \.28s ease;/,
    );
    expect(storeStyles).toMatch(
      /@media \(prefers-reduced-motion:reduce\)\{\s*\.product-img\{transition:none!important;/,
    );
  });
});
