/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const frontendRoot = path.resolve(__dirname, '../../../cronox-front');
const galleryHtml = readFileSync(
  path.join(frontendRoot, 'gallery.html'),
  'utf8',
);
const homepageHtml = readFileSync(
  path.join(frontendRoot, 'index.html'),
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
  html = galleryHtml,
): TestDom => {
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    url:
      html === homepageHtml
        ? 'http://localhost:3000/index.html'
        : 'http://localhost:3000/gallery.html',
  });
  const frames: FrameRequestCallback[] = [];
  const pendingFrames = new Map<number, FrameRequestCallback>();
  let nextFrameId = 1;
  const imageContexts: string[] = [];
  dom.window.scrollTo = jest.fn();
  dom.window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    const id = nextFrameId++;
    const scheduled = (timestamp: number) => {
      pendingFrames.delete(id);
      callback(timestamp);
    };
    pendingFrames.set(id, scheduled);
    frames.push(scheduled);
    return id;
  }) as typeof requestAnimationFrame;
  dom.window.cancelAnimationFrame = jest.fn((id: number) => {
    const scheduled = pendingFrames.get(id);
    if (!scheduled) return;
    const index = frames.indexOf(scheduled);
    if (index >= 0) frames.splice(index, 1);
    pendingFrames.delete(id);
  });
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
        json: () => Promise.resolve(payload),
      })
    : jest.fn(() => new Promise(() => undefined))) as unknown as typeof fetch;
  dom.window.eval(galleryScript);
  return { dom, frames, imageContexts };
};

const pointerEvent = (
  dom: JSDOM,
  type: string,
  options: { x: number; y: number; id?: number; pointerType?: string },
) => {
  const event = new dom.window.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: options.x,
    clientY: options.y,
    button: 0,
  });
  Object.defineProperty(event, 'pointerId', { value: options.id ?? 1 });
  Object.defineProperty(event, 'pointerType', {
    value: options.pointerType ?? 'touch',
  });
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
    expect(document.querySelector('.gallery-carousel__pause')).toBeNull();
    expect(
      root.querySelector('.gallery-carousel__viewport')?.parentElement,
    ).toBe(root);
    expect(
      document.querySelector('.gallery-page h1')?.hasAttribute('hidden'),
    ).toBe(true);
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
    expect(slides[0].dataset.galleryItemKey).toBe('carousel-1');
    expect(slides[3].dataset.galleryItemKey).toBe('carousel-1');
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
    const items = [1, 2, 3].map(carouselItem);
    items[0].key = 'stable-gallery-photo-a';
    const { dom, imageContexts } = makeDom({
      mode: 'CAROUSEL',
      slots: mosaicSlots,
      carouselItems: items,
    });
    await (dom.window as any).CRONOX_GALLERY.load();
    const document = dom.window.document;
    const slides = document.querySelectorAll<HTMLButtonElement>(
      '.gallery-carousel__slide',
    );
    expect(slides[0].dataset.galleryItemKey).toBe('stable-gallery-photo-a');
    expect(slides[3].dataset.galleryItemKey).toBe('stable-gallery-photo-a');

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
    expect(document.activeElement).toBe(slides[3]);
    dom.window.close();
  });

  it('uses delta-time transform math with equivalent invisible wrap positions', () => {
    const { dom } = makeDom();
    const math = (dom.window as any).CRONOX_GALLERY.carouselMath;

    expect(math.speed).toBe(27);
    expect(math.advanceOffset(-100, 500, 900)).toBe(-113.5);
    expect(math.advanceOffset(-100, 1000, 900)).toBe(-127);
    expect(math.normalizeOffset(-950, 900)).toBe(-50);
    expect(math.normalizeOffset(-50, 900)).toBe(-50);
    dom.window.close();
  });

  it('keeps autoplay continuous across pointer hover and keyboard focus, pausing only for the lightbox', () => {
    const { dom, frames } = makeDom();
    const document = dom.window.document;
    const root = document.getElementById('galleryGrid')!;
    (dom.window as any).CRONOX_GALLERY.renderCarousel(
      [1, 2, 3].map(carouselItem),
      root,
    );
    const group = root.querySelector<HTMLElement>('.gallery-carousel__group')!;
    group.getBoundingClientRect = () => ({ width: 900 }) as DOMRect;
    frames.shift()?.(0);
    frames.shift()?.(100);
    frames.shift()?.(116);
    const track = root.querySelector<HTMLElement>('.gallery-carousel__track')!;
    const beforeHover = track.style.transform;
    const viewport = root.querySelector<HTMLElement>(
      '.gallery-carousel__viewport',
    )!;
    viewport.dispatchEvent(new dom.window.Event('pointerenter'));
    root.querySelector<HTMLButtonElement>('.gallery-carousel__slide')!.focus();
    frames.shift()?.(132);
    expect(track.style.transform).not.toBe(beforeHover);
    expect(frames).toHaveLength(1);

    const positionAtOpen = track.style.transform;
    root.querySelector<HTMLButtonElement>('.gallery-carousel__slide')!.click();
    expect(document.getElementById('galleryLightbox')?.hidden).toBe(false);
    expect(frames).toHaveLength(0);
    expect(track.style.transform).toBe(positionAtOpen);
    expect(document.body.style.position).toBe('fixed');
    expect(document.activeElement?.id).toBe('galleryLightboxClose');
    document.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key: 'Escape' }),
    );
    expect(document.getElementById('galleryLightbox')?.hidden).toBe(true);
    expect(document.activeElement).toBe(
      root.querySelector('.gallery-carousel__slide'),
    );
    expect(document.body.style.position).toBe('');
    expect(track.style.transform).toBe(positionAtOpen);
    expect(frames).toHaveLength(1);
    frames.shift()?.(200);
    frames.shift()?.(216);
    expect(track.style.transform).not.toBe(positionAtOpen);
    expect(frames).toHaveLength(1);
    dom.window.close();
  });

  it('transfers enlargement under a stationary mouse across moving slides and clears gaps, exit and touch', () => {
    const { dom, frames } = makeDom();
    const root = dom.window.document.getElementById('galleryGrid')!;
    (dom.window as any).CRONOX_GALLERY.renderCarousel(
      [1, 2, 3].map(carouselItem),
      root,
    );
    const group = root.querySelector<HTMLElement>('.gallery-carousel__group')!;
    group.getBoundingClientRect = () => ({ width: 300 }) as DOMRect;
    frames.shift()?.(0);
    const track = root.querySelector<HTMLElement>('.gallery-carousel__track')!;
    const viewport = root.querySelector<HTMLElement>(
      '.gallery-carousel__viewport',
    )!;
    const slides = Array.from(
      root.querySelectorAll<HTMLElement>('.gallery-carousel__slide'),
    );
    slides.forEach((slide, index) => {
      slide.getBoundingClientRect = () => {
        const offset = Number(
          track.style.transform.match(/translate3d\((-?\d+(?:\.\d+)?)/)?.[1] ||
            0,
        );
        const left = index * 100 + offset;
        return { left, right: left + 80, top: 0, bottom: 100 } as DOMRect;
      };
    });
    Object.defineProperty(dom.window.document, 'elementsFromPoint', {
      configurable: true,
      value: (x: number, y: number) =>
        slides.filter((slide) => {
          const rect = slide.getBoundingClientRect();
          return (
            x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom
          );
        }),
    });
    const enter = pointerEvent(dom, 'pointerenter', {
      x: 50,
      y: 50,
      pointerType: 'mouse',
    });
    viewport.dispatchEvent(enter);
    expect(slides[0].classList.contains('is-pointer-underneath')).toBe(true);
    for (let i = 1; i <= 25; i += 1) frames.shift()?.(i * 64);
    expect(track.style.transform).toContain('-41.472px');
    expect(root.querySelectorAll('.is-pointer-underneath')).toHaveLength(0);
    for (let i = 26; i <= 65; i += 1) frames.shift()?.(i * 64);
    expect(slides[1].classList.contains('is-pointer-underneath')).toBe(true);
    expect(slides[0].classList.contains('is-pointer-underneath')).toBe(false);
    viewport.dispatchEvent(new dom.window.Event('pointerleave'));
    expect(root.querySelectorAll('.is-pointer-underneath')).toHaveLength(0);
    viewport.dispatchEvent(pointerEvent(dom, 'pointerenter', { x: 50, y: 50 }));
    expect(root.querySelectorAll('.is-pointer-underneath')).toHaveLength(0);
    dom.window.close();
  });

  it('switches the homepage heading and spacing only in carousel mode', async () => {
    const { dom } = makeDom(
      {
        mode: 'CAROUSEL',
        slots: mosaicSlots,
        carouselItems: [1, 2, 3].map(carouselItem),
      },
      false,
      homepageHtml,
    );
    await (dom.window as any).CRONOX_GALLERY.load();
    const document = dom.window.document;
    const root = document.querySelector<HTMLElement>(
      '[data-gallery-homepage]',
    )!;
    const section = root.closest<HTMLElement>(
      '[data-gallery-homepage-section]',
    )!;
    const heading = section.querySelector<HTMLElement>(
      '.gallery-homepage__heading',
    )!;
    expect(root.dataset.galleryMode).toBe('CAROUSEL');
    expect(heading.hidden).toBe(true);
    expect(section.classList.contains('gallery-homepage--carousel')).toBe(true);
    expect(galleryStyles).toMatch(
      /\.gallery-homepage--carousel\s*\{[^}]*padding-top:\s*0;/,
    );
    (dom.window as any).CRONOX_GALLERY.render(mosaicSlots, root);
    expect(heading.hidden).toBe(false);
    expect(section.classList.contains('gallery-homepage--carousel')).toBe(
      false,
    );
    expect(root.dataset.galleryMode).toBe('MOSAIC');
    dom.window.close();
  });

  it('omits empty carousel metadata and opens a short mobile tap without requiring a pause control', () => {
    const { dom } = makeDom();
    const items = [1, 2, 3].map(carouselItem);
    items[1].description = '  ';
    items[1].products = [];
    const root = dom.window.document.getElementById('galleryGrid')!;
    (dom.window as any).CRONOX_GALLERY.renderCarousel(items, root);
    const viewport = root.querySelector<HTMLElement>(
      '.gallery-carousel__viewport',
    )!;
    const slide = root.querySelectorAll<HTMLButtonElement>(
      '.gallery-carousel__slide',
    )[1];
    viewport.dispatchEvent(pointerEvent(dom, 'pointerdown', { x: 100, y: 50 }));
    viewport.dispatchEvent(pointerEvent(dom, 'pointerup', { x: 102, y: 51 }));
    slide.click();
    const document = dom.window.document;
    expect(document.getElementById('galleryLightbox')?.hidden).toBe(false);
    expect(document.getElementById('galleryLightboxDescription')?.hidden).toBe(
      true,
    );
    expect(document.getElementById('galleryLightboxProducts')?.hidden).toBe(
      true,
    );
    expect(document.getElementById('galleryLightboxInfo')?.hidden).toBe(true);
    document.getElementById('galleryLightboxClose')?.click();
    expect(document.activeElement).toBe(slide);
    dom.window.close();
  });

  it('activates the canonical slide on pointer up even if autoplay moves its DOM target', async () => {
    const { dom, frames } = makeDom();
    const root = dom.window.document.getElementById('galleryGrid')!;
    const items = [1, 2, 3].map(carouselItem);
    items[0].key = 'carousel-independent-a';
    (dom.window as any).CRONOX_GALLERY.renderCarousel(items, root);
    const group = root.querySelector<HTMLElement>('.gallery-carousel__group')!;
    group.getBoundingClientRect = () => ({ width: 900 }) as DOMRect;
    frames.shift()?.(0);
    const track = root.querySelector<HTMLElement>('.gallery-carousel__track')!;
    const viewport = root.querySelector<HTMLElement>(
      '.gallery-carousel__viewport',
    )!;
    const slides = root.querySelectorAll<HTMLButtonElement>(
      '.gallery-carousel__slide',
    );
    slides[0].dispatchEvent(
      pointerEvent(dom, 'pointerdown', { x: 100, y: 50 }),
    );
    frames.shift()?.(100);
    frames.shift()?.(116);
    expect(track.style.transform).not.toContain('(0.000px');
    viewport.dispatchEvent(pointerEvent(dom, 'pointerup', { x: 100, y: 50 }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    const document = dom.window.document;
    expect(document.getElementById('galleryLightbox')?.hidden).toBe(false);
    expect(
      document.getElementById('galleryLightboxDescription')?.textContent,
    ).toBe(items[0].description);
    document.getElementById('galleryLightboxClose')?.click();
    expect(document.activeElement).toBe(slides[0]);
    slides[3].dispatchEvent(
      pointerEvent(dom, 'pointerdown', { x: 100, y: 50, id: 2 }),
    );
    viewport.dispatchEvent(
      pointerEvent(dom, 'pointerup', { x: 100, y: 50, id: 2 }),
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(
      document.getElementById('galleryLightboxDescription')?.textContent,
    ).toBe(items[0].description);
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
    expect(galleryStyles).not.toContain('.gallery-carousel__pause');
    expect(galleryScript).not.toContain('Pausar movimiento');
    expect(galleryScript).toContain('state.hoveredSlide');
    expect(galleryScript).not.toContain('state.focusWithin');
    expect(galleryStyles).toMatch(
      /\.gallery-carousel__slide\s*\{[^}]*overflow:\s*visible;/s,
    );
    expect(galleryStyles).toMatch(
      /\.gallery-carousel__media\s*\{[^}]*transform:\s*scale\(1\);[^}]*transition:\s*transform 420ms/s,
    );
    expect(galleryStyles).toMatch(
      /\.gallery-carousel__slide\.is-pointer-underneath \.gallery-carousel__media\s*\{[^}]*transform:\s*scale\(1\.025\)/s,
    );
    expect(galleryStyles).toMatch(
      /\.gallery-carousel__slide:focus-visible \.gallery-carousel__media\s*\{[^}]*transform:\s*scale\(1\.025\)/s,
    );
    expect(galleryStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.gallery-carousel__media,/s,
    );
  });
});
