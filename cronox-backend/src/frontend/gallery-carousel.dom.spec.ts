/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const frontendRoot = path.resolve(__dirname, '../../../cronox-front');
const galleryHtml = readFileSync(
  path.join(frontendRoot, 'gallery.html'),
  'utf8',
);
const galleryScript = readFileSync(
  path.join(frontendRoot, 'assets/gallery.js'),
  'utf8',
);
const galleryStyles = readFileSync(
  path.join(frontendRoot, 'assets/gallery.css'),
  'utf8',
);

const mosaicSlots = [
  'featured',
  ...Array.from(
    { length: 12 },
    (_, index) => `slot-${String(index + 1).padStart(2, '0')}`,
  ),
].map((key, index) => ({
  key,
  featured: index === 0,
  placeholderColor: 'grey',
  imageSrc: null,
}));

const carouselItem = (position: number) => ({
  key: `carousel-${position}`,
  position,
  imageSrc: `https://cdn.example.test/${position}-original.jpg`,
  variants: {
    grid: { url: `https://cdn.example.test/${position}-grid.webp`, width: 700 },
    large: {
      url: `https://cdn.example.test/${position}-large.webp`,
      width: 1800,
    },
  },
  alt: `Imagen ${position}`,
  description: `Descripción ${position}`,
  instagramUrl: `https://www.instagram.com/p/cronox_${position}/`,
  focalX: 42,
  focalY: 58,
  zoom: 1.2,
  fit: 'COVER',
  tablet: { focalX: 44, focalY: 56, zoom: 1.1, fit: 'COVER' },
  mobile: { focalX: 46, focalY: 54, zoom: 1, fit: 'CONTAIN' },
  products: [
    {
      id: position,
      slug: `producto-${position}`,
      name: `Producto ${position}`,
      price: 3500,
      currency: 'EUR',
      imageUrl: `https://cdn.example.test/product-${position}.jpg`,
      available: true,
    },
  ],
});

type TestDom = {
  dom: JSDOM;
  frames: FrameRequestCallback[];
  imageContexts: string[];
};

const makeDom = (
  payload: Record<string, unknown> | null = null,
  reducedMotion = false,
): TestDom => {
  const dom = new JSDOM(galleryHtml, {
    runScripts: 'outside-only',
    url: 'http://localhost:3000/gallery.html',
  });
  const frames: FrameRequestCallback[] = [];
  const imageContexts: string[] = [];
  dom.window.scrollTo = jest.fn();
  dom.window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  }) as typeof requestAnimationFrame;
  dom.window.cancelAnimationFrame = jest.fn();
  dom.window.matchMedia = jest.fn().mockReturnValue({
    matches: reducedMotion,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  });
  Object.defineProperty(dom.window, 'IntersectionObserver', {
    configurable: true,
    value: undefined,
  });
  Object.defineProperty(dom.window, 'ResizeObserver', {
    configurable: true,
    value: undefined,
  });
  (dom.window as any).CRONOX_IMAGES = {
    apply: (image: HTMLImageElement, source: any, context: string) => {
      imageContexts.push(context);
      const role = context === 'galleryLarge' ? 'large' : 'grid';
      image.src = source.variants?.[role]?.url || source.url;
    },
  };
  dom.window.fetch = (payload
    ? jest.fn().mockResolvedValue({
        ok: true,
        json: async () => payload,
      })
    : jest.fn(() => new Promise(() => undefined))) as unknown as typeof fetch;
  dom.window.eval(galleryScript);
  return { dom, frames, imageContexts };
};

const pointerEvent = (
  dom: JSDOM,
  type: string,
  options: { x: number; y: number; id?: number },
) => {
  const event = new dom.window.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: options.x,
    clientY: options.y,
    button: 0,
  });
  Object.defineProperty(event, 'pointerId', { value: options.id ?? 1 });
  Object.defineProperty(event, 'pointerType', { value: 'touch' });
  return event;
};

describe('Gallery continuous carousel', () => {
  it('loads 3 unique items, renders one hidden clone group, and reuses optimized variants', async () => {
    const { dom, imageContexts } = makeDom({
      mode: 'CAROUSEL',
      slots: mosaicSlots,
      carouselItems: [1, 2, 3].map(carouselItem),
    });

    await (dom.window as any).CRONOX_GALLERY.load();
    const document = dom.window.document;
    const root = document.getElementById('galleryGrid')!;
    const groups = root.querySelectorAll('.gallery-carousel__group');
    const slides = root.querySelectorAll<HTMLButtonElement>(
      '.gallery-carousel__slide',
    );

    expect(root.dataset.galleryMode).toBe('CAROUSEL');
    expect(groups).toHaveLength(2);
    expect(groups[1].getAttribute('aria-hidden')).toBe('true');
    expect(slides).toHaveLength(6);
    expect(
      Array.from(slides)
        .slice(0, 3)
        .every((slide) => slide.tabIndex === 0),
    ).toBe(true);
    expect(
      Array.from(slides)
        .slice(3)
        .every((slide) => slide.tabIndex === -1),
    ).toBe(true);
    expect(
      Array.from(slides)
        .slice(3)
        .every((slide) => slide.getAttribute('aria-hidden') === 'true'),
    ).toBe(true);
    expect((dom.window as any).CRONOX_GALLERY.items).toHaveLength(3);
    expect(slides[0].querySelector('img')?.src).toContain('1-grid.webp');
    const optimizedImage = slides[0].querySelector('img')!;
    optimizedImage.dispatchEvent(new dom.window.Event('error'));
    expect(optimizedImage.src).toBe('https://cdn.example.test/1-original.jpg');
    expect(
      imageContexts.filter((context) => context === 'galleryGrid'),
    ).toHaveLength(6);
    dom.window.close();
  });

  it('uses the shared lightbox with large variants, metadata, unique navigation, and clone mapping', async () => {
    const { dom, imageContexts } = makeDom({
      mode: 'CAROUSEL',
      slots: mosaicSlots,
      carouselItems: [1, 2, 3].map(carouselItem),
    });
    await (dom.window as any).CRONOX_GALLERY.load();
    const document = dom.window.document;
    const slides = document.querySelectorAll<HTMLButtonElement>(
      '.gallery-carousel__slide',
    );

    slides[3].click();

    expect(document.querySelectorAll('#galleryLightbox')).toHaveLength(1);
    expect(document.getElementById('galleryLightbox')?.hidden).toBe(false);
    expect(
      document.getElementById('galleryLightboxImage')?.getAttribute('src'),
    ).toContain('1-large.webp');
    expect(
      document.getElementById('galleryLightboxDescription')?.textContent,
    ).toBe('Descripción 1');
    expect(
      document.querySelectorAll('#galleryLightboxProducts > *'),
    ).toHaveLength(1);
    expect(
      document
        .getElementById('galleryLightboxInstagramInfo')
        ?.getAttribute('href'),
    ).toContain('/p/cronox_1/');
    expect(imageContexts).toContain('galleryLarge');

    document.getElementById('galleryLightboxNext')?.click();
    expect(
      document.getElementById('galleryLightboxDescription')?.textContent,
    ).toBe('Descripción 2');
    document.getElementById('galleryLightboxNext')?.click();
    document.getElementById('galleryLightboxNext')?.click();
    expect(
      document.getElementById('galleryLightboxDescription')?.textContent,
    ).toBe('Descripción 1');
    document.getElementById('galleryLightboxClose')?.click();
    expect(document.activeElement).toBe(slides[0]);
    dom.window.close();
  });

  it('uses delta-time transform math with equivalent invisible wrap positions', () => {
    const { dom } = makeDom();
    const math = (dom.window as any).CRONOX_GALLERY.carouselMath;

    expect(math.speed).toBe(24);
    expect(math.advanceOffset(-100, 500, 900)).toBe(-112);
    expect(math.advanceOffset(-100, 1000, 900)).toBe(-124);
    expect(math.normalizeOffset(-950, 900)).toBe(-50);
    expect(math.normalizeOffset(-50, 900)).toBe(-50);
    dom.window.close();
  });

  it('follows horizontal drags both ways, suppresses drag-click, and leaves vertical intent unclaimed', () => {
    const { dom, frames } = makeDom();
    const root = dom.window.document.getElementById('galleryGrid')!;
    const items = [1, 2, 3].map(carouselItem);
    (dom.window as any).CRONOX_GALLERY.renderCarousel(items, root);
    const group = root.querySelector<HTMLElement>('.gallery-carousel__group')!;
    group.getBoundingClientRect = () =>
      ({ width: 900, height: 400 }) as DOMRect;
    frames.shift()?.(0);
    const viewport = root.querySelector<HTMLElement>(
      '.gallery-carousel__viewport',
    )!;
    const track = root.querySelector<HTMLElement>('.gallery-carousel__track')!;
    const slide = root.querySelector<HTMLButtonElement>(
      '.gallery-carousel__slide',
    )!;
    (viewport as any).setPointerCapture = jest.fn();
    (viewport as any).releasePointerCapture = jest.fn();

    viewport.dispatchEvent(pointerEvent(dom, 'pointerdown', { x: 200, y: 50 }));
    const dragLeft = pointerEvent(dom, 'pointermove', { x: 140, y: 52 });
    viewport.dispatchEvent(dragLeft);
    const leftTransform = track.style.transform;
    expect(dragLeft.defaultPrevented).toBe(true);
    expect(leftTransform).toContain('-60.000px');
    viewport.dispatchEvent(pointerEvent(dom, 'pointerup', { x: 140, y: 52 }));
    slide.click();
    expect(dom.window.document.getElementById('galleryLightbox')?.hidden).toBe(
      true,
    );

    viewport.dispatchEvent(
      pointerEvent(dom, 'pointerdown', { x: 140, y: 50, id: 2 }),
    );
    viewport.dispatchEvent(
      pointerEvent(dom, 'pointermove', { x: 200, y: 52, id: 2 }),
    );
    expect(track.style.transform).not.toBe(leftTransform);
    viewport.dispatchEvent(
      pointerEvent(dom, 'pointerup', { x: 200, y: 52, id: 2 }),
    );

    const beforeVertical = track.style.transform;
    viewport.dispatchEvent(
      pointerEvent(dom, 'pointerdown', { x: 200, y: 50, id: 3 }),
    );
    const vertical = pointerEvent(dom, 'pointermove', {
      x: 203,
      y: 110,
      id: 3,
    });
    viewport.dispatchEvent(vertical);
    expect(vertical.defaultPrevented).toBe(false);
    expect(track.style.transform).toBe(beforeVertical);
    dom.window.close();
  });

  it('disables continuous autoplay for reduced motion while keeping tap and drag interactive', () => {
    const { dom, frames } = makeDom(null, true);
    const root = dom.window.document.getElementById('galleryGrid')!;
    (dom.window as any).CRONOX_GALLERY.renderCarousel(
      [1, 2, 3].map(carouselItem),
      root,
    );
    const group = root.querySelector<HTMLElement>('.gallery-carousel__group')!;
    group.getBoundingClientRect = () => ({ width: 900 }) as DOMRect;
    frames.shift()?.(0);

    expect(frames).toHaveLength(0);
    root.querySelector<HTMLButtonElement>('.gallery-carousel__slide')?.click();
    expect(dom.window.document.getElementById('galleryLightbox')?.hidden).toBe(
      false,
    );
    dom.window.close();
  });

  it('falls back to the 13-slot Mosaic for absent or invalid Carousel mode data', async () => {
    for (const payload of [
      { slots: mosaicSlots, carouselItems: [1, 2, 3].map(carouselItem) },
      {
        mode: 'CAROUSEL',
        slots: mosaicSlots,
        carouselItems: [1, 2].map(carouselItem),
      },
    ]) {
      const { dom } = makeDom(payload);
      await (dom.window as any).CRONOX_GALLERY.load();
      expect(
        dom.window.document.querySelectorAll('#galleryGrid .gallery__tile'),
      ).toHaveLength(13);
      expect(
        dom.window.document.getElementById('galleryGrid')?.dataset.galleryMode,
      ).toBe('MOSAIC');
      dom.window.close();
    }
  });

  it('defines stable responsive frames without horizontal page overflow or touch blocking', () => {
    expect(galleryStyles).toMatch(
      /\.gallery-carousel__slide\s*\{[^}]*aspect-ratio:\s*4\s*\/\s*5/s,
    );
    expect(galleryStyles).toMatch(
      /\.gallery-carousel__viewport\s*\{[^}]*overflow:\s*hidden/s,
    );
    expect(galleryStyles).toMatch(
      /\.gallery-carousel__viewport\s*\{[^}]*touch-action:\s*pan-y/s,
    );
    expect(galleryStyles).toContain('width: clamp(280px, 28vw, 520px)');
    expect(galleryStyles).toContain('width: 42vw');
    expect(galleryStyles).toContain('width: 72vw');
    expect(galleryStyles).not.toContain('touch-action: none');
  });
});
