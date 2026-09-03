/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const frontendRoot = path.resolve(__dirname, '../../../cronox-front');
const readFrontend = (file: string) =>
  readFileSync(path.join(frontendRoot, file), 'utf8');

const galleryHtml = readFrontend('gallery.html');
const homepageHtml = readFrontend('index.html');
const galleryStyles = readFrontend('assets/gallery.css');
const galleryScript = readFrontend('assets/gallery.js');
const infoShellScript = readFrontend('assets/info-shell.js');
const appScript = readFrontend('assets/app.js');

const expectedDrawerPages = [
  'aviso-legal.html',
  'cart.html',
  'cookie-policy.html',
  'develop.html',
  'events.html',
  'faqs.html',
  'favorites.html',
  'gallery.html',
  'index.html',
  'privacy-policy.html',
  'producto.html',
  'profile.html',
  'returns-exchanges.html',
  'shipping-policy.html',
  'terms-of-service.html',
];

const getDrawerPages = () =>
  readdirSync(frontendRoot)
    .filter((file) => file.endsWith('.html'))
    .filter((file) => {
      const html = readFrontend(file);
      return (
        html.includes('id="filtersPanel"') ||
        html.includes('assets/info-shell.js')
      );
    })
    .sort();

const makeGalleryDom = () => {
  const dom = new JSDOM(galleryHtml, {
    runScripts: 'outside-only',
    url: 'http://localhost:3000/gallery.html',
  });
  dom.window.fetch = jest.fn(
    () => new Promise(() => undefined),
  ) as unknown as typeof fetch;
  dom.window.scrollTo = jest.fn();
  dom.window.eval(galleryScript);
  return dom;
};

const makeHomepageGalleryDom = (
  url = 'http://localhost:3000/index.html',
  fetchImplementation: typeof fetch = jest.fn(
    () => new Promise(() => undefined),
  ) as unknown as typeof fetch,
) => {
  const dom = new JSDOM(homepageHtml, {
    runScripts: 'outside-only',
    url,
  });
  dom.window.fetch = fetchImplementation;
  dom.window.scrollTo = jest.fn();
  dom.window.eval(galleryScript);
  return dom;
};

const galleryProduct = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  slug: 'grey-core-tee',
  name: 'GREY-CORE TEE',
  price: 3495,
  currency: 'EUR',
  imageUrl: 'https://storage.example.test/grey.png',
  available: true,
  ...overrides,
});

describe('CRONOX gallery page', () => {
  it('adds one direct gallery link through the shared drawer runtime', () => {
    const drawerPages = getDrawerPages();
    expect(drawerPages).toEqual(expectedDrawerPages);

    drawerPages.forEach((page) => {
      const html = readFrontend(page);
      const dom = new JSDOM(html, {
        runScripts: 'outside-only',
        url: `http://localhost:3000/${page}`,
      });

      if (html.includes('assets/info-shell.js')) {
        dom.window.eval(infoShellScript);
      }
      dom.window.eval(appScript);

      const document = dom.window.document;
      const links = Array.from(
        document.querySelectorAll<HTMLAnchorElement>(
          '#filtersPanel .black-menu__link',
        ),
      );
      const galleryLinks = links.filter(
        (link) => link.getAttribute('href') === 'gallery.html',
      );
      const galleryLink = galleryLinks[0];
      const lastCategoryIndex = links.reduce(
        (lastIndex, link, index) =>
          link.href.includes('categorySlug=') ? index : lastIndex,
        -1,
      );

      expect(galleryLinks).toHaveLength(1);
      expect(galleryLink.textContent).toBe('GALER\u00cdA');
      expect(galleryLink.href).toBe('http://localhost:3000/gallery.html');
      expect(galleryLink.href).not.toContain('categorySlug');
      expect(links.indexOf(galleryLink)).toBe(lastCategoryIndex + 1);
      expect(galleryLink.getAttribute('aria-current')).toBe(
        page === 'gallery.html' ? 'page' : null,
      );
      dom.window.close();
    });
  });

  it('renders the opaque production topbar and exactly thirteen placeholders', () => {
    const dom = new JSDOM(galleryHtml, {
      runScripts: 'outside-only',
      url: 'http://localhost:3000/gallery.html',
    });
    dom.window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    };
    dom.window.fetch = jest
      .fn()
      .mockRejectedValue(
        new Error('API unavailable'),
      ) as unknown as typeof fetch;
    const styleElement = dom.window.document.createElement('style');
    styleElement.textContent = galleryStyles;
    dom.window.document.head.appendChild(styleElement);
    dom.window.eval(infoShellScript);
    dom.window.eval(appScript);
    dom.window.eval(galleryScript);

    const document = dom.window.document;
    const topbar = document.getElementById('topbar');
    const grid = document.getElementById('galleryGrid');
    const tiles = Array.from(
      document.querySelectorAll<HTMLElement>('#galleryGrid .gallery__tile'),
    );
    const pattern = [
      'grey',
      'white',
      'red',
      'grey',
      'white',
      'grey',
      'white',
      'red',
      'grey',
      'red',
      'grey',
      'white',
      'red',
    ];

    expect(galleryHtml).toContain('<title>Galer&iacute;a | CRONOX</title>');
    expect(galleryHtml).toContain('href="assets/gallery.css?v=14"');
    expect(galleryHtml).toContain('src="assets/gallery.js?v=10"');
    expect(document.title).toBe('Galer\u00eda | CRONOX');
    expect(galleryHtml).toMatch(
      /<body class="page-info page-gallery">\s*<script src="assets\/info-shell\.js\?v=1"><\/script>/,
    );
    expect(document.querySelectorAll('#topbar')).toHaveLength(1);
    expect(topbar?.classList.contains('topbar--page')).toBe(true);
    expect(topbar?.classList.contains('topbar--transparent')).toBe(false);
    expect(document.querySelector('.hero-video-section')).toBeNull();
    expect(grid).not.toBeNull();
    expect(tiles).toHaveLength(13);
    expect(
      document.querySelectorAll('#galleryGrid .gallery__tile--featured'),
    ).toHaveLength(1);
    expect(tiles[0].classList.contains('gallery__tile--featured')).toBe(true);
    expect(tiles.slice(1)).toHaveLength(12);
    expect(grid?.querySelector('h1')).toBeNull();
    expect(document.querySelector('h1.gallery-visually-hidden')).not.toBeNull();

    pattern.forEach((color, index) => {
      expect(tiles[index].classList.contains(`gallery__tile--${color}`)).toBe(
        true,
      );
      expect(tiles[index].querySelector('.gallery__media')).toBeNull();
    });
    expect(document.querySelectorAll('#galleryGrid a')).toHaveLength(0);
    expect(galleryScript).not.toContain('href="#"');

    const gridStyle = dom.window.getComputedStyle(grid as HTMLElement);
    const featuredStyle = dom.window.getComputedStyle(tiles[0]);
    const regularStyle = dom.window.getComputedStyle(tiles[1]);
    expect(gridStyle.display).toBe('grid');
    expect(gridStyle.gridTemplateColumns).toBe('repeat(6, minmax(0, 1fr))');
    expect(gridStyle.gridTemplateRows).toBe('repeat(3, minmax(0, 1fr))');
    expect(gridStyle.gap).toBe('0');
    expect(featuredStyle.gridColumn).toBe('span 2');
    expect(featuredStyle.gridRow).toBe('span 3');
    expect(regularStyle.margin).toBe('0px');
    expect(regularStyle.padding).toBe('0px');
    expect(regularStyle.borderWidth).toBe('0px');
    expect(regularStyle.borderRadius).toBe('0');
    expect(regularStyle.boxShadow).toBe('none');
    expect(regularStyle.overflow).toBe('hidden');

    (document.getElementById('btnMenu') as HTMLButtonElement).click();
    expect(
      (document.getElementById('filtersPanel') as HTMLElement).hidden,
    ).toBe(false);
    expect(
      document.getElementById('filtersPanel')?.classList.contains('is-open'),
    ).toBe(true);

    (document.getElementById('btnSearch') as HTMLButtonElement).click();
    expect((document.getElementById('searchBar') as HTMLElement).hidden).toBe(
      false,
    );
    expect(
      document.getElementById('searchBar')?.classList.contains('is-open'),
    ).toBe(true);

    const ids = Array.from(document.querySelectorAll<HTMLElement>('[id]')).map(
      (element) => element.id,
    );
    expect(new Set(ids).size).toBe(ids.length);
    dom.window.close();
  });

  it('places one shared Gallery component after homepage products and before the footer', () => {
    const dom = new JSDOM(homepageHtml, {
      runScripts: 'outside-only',
      url: 'http://localhost:3000/index.html',
    });
    const document = dom.window.document;
    const store = document.getElementById('store')!;
    const productsGrid = document.getElementById('productsGrid')!;
    const homepageGallery = document.querySelector<HTMLElement>(
      '[data-gallery-root][data-gallery-homepage]',
    )!;
    const homepageGallerySection = document.querySelector<HTMLElement>(
      '[data-gallery-homepage-section]',
    )!;
    const galleryHeading =
      homepageGallerySection.querySelector<HTMLHeadingElement>(
        'h2.gallery-homepage__heading',
      )!;
    const productHeading = store.querySelector<HTMLHeadingElement>(
      ':scope > h2.store-heading',
    )!;
    const footer = document.querySelector('footer.site-footer')!;

    expect(
      document.querySelectorAll('[data-gallery-root][data-gallery-homepage]'),
    ).toHaveLength(1);
    expect(homepageGallery).not.toBeNull();
    expect(store.nextElementSibling).toBe(homepageGallerySection);
    expect(homepageGallerySection.children[0]).toBe(galleryHeading);
    expect(homepageGallerySection.children[1]).toBe(homepageGallery);
    expect(store.contains(productsGrid)).toBe(true);
    expect(store.contains(homepageGallery)).toBe(false);
    expect(productHeading.textContent).toBe('NOVEDADES');
    expect(productHeading.textContent).not.toBe('DÉJATE CORROMPER');
    expect(galleryHeading.textContent).toBe('GALERÍA');
    expect(
      Array.from(document.querySelectorAll('h2')).filter(
        (heading) => heading.textContent?.trim() === 'GALERÍA',
      ),
    ).toHaveLength(1);
    expect(galleryHeading.classList.contains('store-heading')).toBe(true);
    expect(productHeading.classList.contains('store-heading')).toBe(true);
    expect(homepageGallery.contains(galleryHeading)).toBe(false);
    expect(
      homepageGallerySection.compareDocumentPosition(footer) &
        dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(homepageHtml).toContain('href="assets/gallery.css?v=14"');
    expect(homepageHtml).toContain('src="assets/gallery.js?v=10"');
    expect(document.querySelectorAll('#galleryLightbox')).toHaveLength(1);
    expect(document.querySelectorAll<HTMLElement>('[id]').length).toBe(
      new Set(
        Array.from(document.querySelectorAll<HTMLElement>('[id]')).map(
          (element) => element.id,
        ),
      ).size,
    );
    expect(
      new JSDOM(galleryHtml).window.document.querySelectorAll(
        '[data-gallery-root]',
      ),
    ).toHaveLength(1);
    dom.window.close();
  });

  it('initializes the homepage Gallery once with thirteen stable placeholders and one API request', async () => {
    const slots = Array.from({ length: 13 }, (_, index) => ({
      key: index === 0 ? 'featured' : `slot-${String(index).padStart(2, '0')}`,
      placeholderColor: index % 2 ? 'white' : 'grey',
      imageSrc:
        index === 0
          ? 'https://storage.example.test/homepage-featured.jpg'
          : null,
      alt: index === 0 ? 'Galería integrada' : '',
      focalX: index === 0 ? 34 : 50,
      focalY: index === 0 ? 66 : 50,
      zoom: index === 0 ? 1.4 : 1,
      products: [],
      description: '',
    }));
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ slots }),
    }) as unknown as typeof fetch;
    const dom = makeHomepageGalleryDom(
      'http://localhost:3000/index.html',
      fetchMock,
    );
    const gallery = (dom.window as any).CRONOX_GALLERY;
    await gallery.load();
    await gallery.load();
    dom.window.eval(galleryScript);
    const root = dom.window.document.querySelector<HTMLElement>(
      '[data-gallery-root]',
    )!;
    const tiles = root.querySelectorAll<HTMLElement>('.gallery__tile');

    expect(root.dataset.galleryInitialized).toBe('true');
    expect(gallery.initialized).toBe(true);
    expect(tiles).toHaveLength(13);
    expect(tiles[0].classList.contains('gallery__tile--featured')).toBe(true);
    expect(tiles[0].tagName).toBe('BUTTON');
    expect(tiles[0].style.getPropertyValue('--focal-x')).toBe('34%');
    expect(tiles[0].style.getPropertyValue('--focal-y')).toBe('66%');
    expect(tiles[0].style.getPropertyValue('--zoom')).toBe('1.4');
    expect(tiles[1].tagName).toBe('DIV');
    expect(tiles[1].getAttribute('aria-hidden')).toBe('true');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/gallery',
      expect.objectContaining({ method: 'GET' }),
    );
    dom.window.close();
  });

  it('opens the production lightbox from the homepage and restores focus to its tile', () => {
    const dom = makeHomepageGalleryDom();
    const gallery = (dom.window as any).CRONOX_GALLERY;
    gallery.render([
      {
        key: 'home-a',
        imageSrc: 'https://storage.example.test/home-a.jpg',
        alt: 'Homepage A',
        description: 'Texto seguro',
        products: [galleryProduct()],
      },
      {
        key: 'home-b',
        imageSrc: 'https://storage.example.test/home-b.jpg',
        alt: 'Homepage B',
      },
      { key: 'home-empty', color: 'red' },
    ]);
    const document = dom.window.document;
    const root = document.querySelector<HTMLElement>('[data-gallery-root]')!;
    const opener = root.querySelector<HTMLButtonElement>(
      '[data-gallery-slot="home-a"]',
    )!;
    opener.focus();
    opener.click();

    const lightbox = document.getElementById('galleryLightbox') as HTMLElement;
    const image = document.getElementById(
      'galleryLightboxImage',
    ) as HTMLImageElement;
    expect(lightbox.hidden).toBe(false);
    expect(lightbox.classList.contains('has-info')).toBe(true);
    expect(image.src).toBe('https://storage.example.test/home-a.jpg');
    expect(
      document.querySelectorAll('.gallery-lightbox__product'),
    ).toHaveLength(1);
    expect(
      document.getElementById('galleryLightboxDescription')?.textContent,
    ).toBe('Texto seguro');
    (
      document.getElementById('galleryLightboxNext') as HTMLButtonElement
    ).click();
    expect(image.src).toBe('https://storage.example.test/home-b.jpg');
    expect(lightbox.classList.contains('has-info')).toBe(false);
    (
      document.getElementById('galleryLightboxNext') as HTMLButtonElement
    ).click();
    expect(image.src).toBe('https://storage.example.test/home-a.jpg');
    (
      document.getElementById('galleryLightboxClose') as HTMLButtonElement
    ).click();
    expect(lightbox.hidden).toBe(true);
    expect(document.activeElement).toBe(opener);
    dom.window.close();
  });

  it('hides the homepage Gallery for category and search views and restores it for the normal catalog', () => {
    ['categorySlug=camisetas', 'search=camiseta', 'q=camiseta'].forEach(
      (query) => {
        const fetchMock = jest.fn() as unknown as typeof fetch;
        const dom = makeHomepageGalleryDom(
          `http://localhost:3000/index.html?${query}#store`,
          fetchMock,
        );
        const root = dom.window.document.querySelector<HTMLElement>(
          '[data-gallery-root]',
        )!;
        const section = dom.window.document.querySelector<HTMLElement>(
          '[data-gallery-homepage-section]',
        )!;
        const heading = section.querySelector<HTMLElement>(
          '.gallery-homepage__heading',
        )!;
        expect(section.hidden).toBe(true);
        expect(section.contains(root)).toBe(true);
        expect(section.contains(heading)).toBe(true);
        expect(fetchMock).not.toHaveBeenCalled();
        dom.window.close();
      },
    );

    const dom = makeHomepageGalleryDom();
    const root = dom.window.document.querySelector<HTMLElement>(
      '[data-gallery-root]',
    )!;
    const section = dom.window.document.querySelector<HTMLElement>(
      '[data-gallery-homepage-section]',
    )!;
    const heading = section.querySelector<HTMLElement>(
      '.gallery-homepage__heading',
    )!;
    expect(section.hidden).toBe(false);
    expect(section.contains(root)).toBe(true);
    expect(section.contains(heading)).toBe(true);
    dom.window.history.pushState({}, '', '?search=tee#store');
    dom.window.dispatchEvent(
      new dom.window.CustomEvent('cronox:productsLoaded'),
    );
    expect(section.hidden).toBe(true);
    dom.window.history.pushState({}, '', 'index.html');
    dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
    expect(section.hidden).toBe(false);
    dom.window.close();
  });

  it('keeps homepage products, navigation, and footer usable when Gallery loading fails', async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValue(
        new Error('Gallery unavailable'),
      ) as unknown as typeof fetch;
    const dom = makeHomepageGalleryDom(
      'http://localhost:3000/index.html',
      fetchMock,
    );
    await Promise.resolve();
    await Promise.resolve();
    const document = dom.window.document;
    expect(document.getElementById('productsGrid')).not.toBeNull();
    expect(document.getElementById('btnMenu')).not.toBeNull();
    expect(document.getElementById('btnSearch')).not.toBeNull();
    expect(document.getElementById('profileBtn')).not.toBeNull();
    expect(document.querySelector('.topbar__fav')).not.toBeNull();
    expect(document.getElementById('cart-icon-btn')).not.toBeNull();
    expect(document.querySelector('footer.site-footer')).not.toBeNull();
    expect(
      document.querySelectorAll('[data-gallery-root] .gallery__tile'),
    ).toHaveLength(13);
    dom.window.close();
  });

  it('preserves the seamless six-column composition at every viewport width', () => {
    expect(galleryStyles).toMatch(
      /grid-template-columns:\s*repeat\(6, minmax\(0, 1fr\)\)/,
    );
    expect(galleryStyles).toMatch(
      /grid-template-rows:\s*repeat\(3, minmax\(0, 1fr\)\)/,
    );
    expect(galleryStyles).toContain('gap: 0');
    expect(galleryStyles).toContain(
      'height: calc(100svh - var(--topbar-h, 64px))',
    );
    expect(galleryStyles).toContain(
      'height: calc(100dvh - var(--topbar-h, 64px) - env(safe-area-inset-top))',
    );
    expect(galleryStyles).toContain('border-radius: 0');
    expect(galleryStyles).toContain('box-shadow: none');
    expect(galleryStyles).toContain('object-fit: cover');
    expect(galleryStyles).toContain(
      'object-position: var(--focal-x, 50%) var(--focal-y, 50%)',
    );
    expect(galleryStyles).toContain('transform: scale(var(--zoom, 1))');
    expect(galleryStyles).toContain('display: block');
    expect(galleryStyles).toMatch(
      /\.gallery__tile--featured\s*\{[^}]*grid-column:\s*span 2;[^}]*grid-row:\s*span 3;/,
    );
    expect(galleryStyles).toContain('aspect-ratio: 1 / 1');
    expect(galleryStyles).toContain('.gallery__tile--trigger:focus-visible');
    expect(galleryStyles).toMatch(
      /\.gallery__tile--trigger\s*\{[^}]*cursor:\s*pointer;/,
    );
    expect(galleryStyles).not.toMatch(/cursor:\s*zoom-(?:in|out)/);
    expect(galleryStyles).toContain('@media (max-width: 767px)');
    expect(galleryStyles).toMatch(
      /@media \(max-width: 767px\)[\s\S]*?\.gallery-grid\s*\{[^}]*grid-template-columns:\s*repeat\(6, minmax\(0, 1fr\)\);[^}]*grid-template-rows:\s*repeat\(3, minmax\(0, 1fr\)\);[^}]*aspect-ratio:\s*2 \/ 1;[^}]*overflow:\s*hidden;/,
    );
    expect(galleryStyles).toMatch(
      /@media \(max-width: 767px\)[\s\S]*?\.gallery__tile--featured\s*\{[^}]*grid-column:\s*span 2;[^}]*grid-row:\s*span 3;/,
    );
    expect(galleryStyles).toContain(
      '.gallery__tile:not(.gallery__tile--featured)',
    );
    expect(galleryStyles).toMatch(
      /\.gallery-grid\.gallery--homepage\s*\{[^}]*height:\s*auto;[^}]*aspect-ratio:\s*2 \/ 1;/s,
    );
    expect(galleryStyles).toMatch(
      /\.gallery-homepage\s*\{[^}]*padding-top:\s*20px;/s,
    );
    expect(galleryStyles).toMatch(
      /\.gallery-homepage__heading\s*\{[^}]*margin:\s*0 0 16px;[^}]*padding:\s*0 16px;[^}]*text-align:\s*left;/s,
    );
    expect(galleryStyles).toMatch(
      /\.gallery-homepage\[hidden\]\s*\{[^}]*display:\s*none;/s,
    );
    expect(galleryStyles).toMatch(
      /@media \(max-width: 767px\)[\s\S]*\.gallery-grid\.gallery--homepage\s*\{[^}]*aspect-ratio:\s*2 \/ 1;/,
    );
    expect(galleryStyles).toMatch(
      /@media \(max-width: 767px\)[\s\S]*\.gallery-homepage__heading\s*\{[^}]*padding-right:\s*14px;[^}]*padding-left:\s*14px;/,
    );
  });

  it('defines the restrained desktop-only media hover without replacing saved image framing', () => {
    expect(galleryStyles).toMatch(
      /\.gallery__media\s*\{[^}]*overflow:\s*hidden;[^}]*transform:\s*scale\(1\);[^}]*transform-origin:\s*center;[^}]*transition:\s*transform 500ms ease-out;/s,
    );
    expect(galleryStyles).toMatch(
      /\.gallery__media::after\s*\{[^}]*background:\s*rgba\(0, 0, 0, 0\.16\);[^}]*opacity:\s*0;[^}]*pointer-events:\s*none;[^}]*transition:\s*opacity 250ms ease-out;/s,
    );
    expect(galleryStyles).toMatch(
      /@media \(hover: hover\) and \(pointer: fine\)\s*\{[\s\S]*\.gallery__tile--image:hover \.gallery__media\s*\{[^}]*transform:\s*scale\(1\.025\);[^}]*transition-duration:\s*3s;[^}]*transition-timing-function:\s*ease-out;/,
    );
    expect(galleryStyles).toMatch(
      /@media \(hover: hover\) and \(pointer: fine\)[\s\S]*\.gallery__tile--image:hover \.gallery__media::after\s*\{[^}]*opacity:\s*1;/,
    );
    expect(galleryStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*\.gallery__tile--image:hover \.gallery__media\s*\{[^}]*transform:\s*scale\(1\);[^}]*transition:\s*none;/,
    );
    expect(galleryStyles).toContain('transform: scale(var(--zoom, 1))');
    expect(galleryStyles).toContain(
      'object-position: var(--focal-x, 50%) var(--focal-y, 50%)',
    );
    expect(galleryStyles).not.toMatch(
      /\.gallery__tile--image:hover\s+img\s*\{[^}]*transform:/,
    );
  });

  it('keeps Instagram off the tile and makes every occupied tile a lightbox trigger', () => {
    const dom = new JSDOM('<section id="fixture"></section>', {
      runScripts: 'outside-only',
      url: 'http://localhost:3000/gallery.html',
    });
    dom.window.eval(galleryScript);
    const fixture = dom.window.document.getElementById('fixture');
    const galleryApi = (dom.window as any).CRONOX_GALLERY;

    galleryApi.render(
      [
        {
          imageSrc: 'assets/gallery/customer-01.jpg',
          alt: 'Cliente con una camiseta CRONOX',
          instagramUrl: 'https://www.instagram.com/p/CRONOX123/',
          featured: true,
        },
      ],
      fixture,
    );

    const trigger = fixture?.querySelector<HTMLButtonElement>(
      'button.gallery__tile',
    );
    const media = trigger?.querySelector<HTMLElement>('.gallery__media');
    const image = trigger?.querySelector<HTMLImageElement>('img');
    expect(fixture?.querySelector('a')).toBeNull();
    expect(trigger?.type).toBe('button');
    expect(trigger?.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger?.getAttribute('draggable')).toBe('false');
    expect(trigger?.classList.contains('gallery__tile--featured')).toBe(true);
    expect(trigger?.getAttribute('aria-label')).toContain('Cliente');
    expect(media?.parentElement).toBe(trigger);
    expect(media?.children).toHaveLength(1);
    expect(image?.getAttribute('src')).toBe('assets/gallery/customer-01.jpg');
    expect(image?.alt).toBe('Cliente con una camiseta CRONOX');
    expect(image?.getAttribute('draggable')).toBe('false');

    galleryApi.render(
      [
        {
          imageSrc: 'assets/gallery/customer-02.jpg',
          alt: 'Otra imagen CRONOX',
          instagramUrl: 'javascript:alert(1)',
        },
      ],
      fixture,
    );
    expect(fixture?.querySelector('a')).toBeNull();
    expect(fixture?.querySelector('img')).not.toBeNull();

    galleryApi.render(
      [
        {
          imageSrc: 'assets/gallery/customer-03.jpg',
          alt: 'Host falso',
          instagramUrl: 'https://instagram.com.evil.test/p/CRONOX123/',
        },
      ],
      fixture,
    );
    expect(fixture?.querySelector('a')).toBeNull();
    dom.window.close();
  });

  it('loads assigned images and per-slot focal settings from the public API', async () => {
    const slots = Array.from({ length: 13 }, (_, index) => ({
      key: index === 0 ? 'featured' : `slot-${String(index).padStart(2, '0')}`,
      displayOrder: index,
      featured: index === 0,
      placeholderColor: index % 2 ? 'white' : 'grey',
      imageSrc:
        index === 0
          ? 'https://storage.example.test/gallery/featured.jpg'
          : null,
      alt: index === 0 ? 'Cliente CRONOX en Madrid' : '',
      instagramUrl:
        index === 0 ? 'https://www.instagram.com/p/CRONOX123/' : null,
      focalX: index === 0 ? 28 : 50,
      focalY: index === 0 ? 72 : 50,
      zoom: index === 0 ? 1.6 : 1,
    }));
    const dom = new JSDOM(galleryHtml, {
      runScripts: 'outside-only',
      url: 'http://localhost:3000/gallery.html',
    });
    dom.window.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ slots }),
    }) as unknown as typeof fetch;
    (dom.window as any).CRONOX_API = { API_BASE: 'http://localhost:3000' };

    dom.window.eval(galleryScript);
    await (dom.window as any).CRONOX_GALLERY.load();

    const tiles = dom.window.document.querySelectorAll(
      '#galleryGrid .gallery__tile',
    );
    const featured = tiles[0] as HTMLElement;
    expect(tiles).toHaveLength(13);
    expect(featured.tagName).toBe('BUTTON');
    expect(featured.dataset.gallerySlot).toBe('featured');
    expect(featured.style.getPropertyValue('--focal-x')).toBe('28%');
    expect(featured.style.getPropertyValue('--focal-y')).toBe('72%');
    expect(featured.style.getPropertyValue('--zoom')).toBe('1.6');
    expect(featured.querySelector('.gallery__media')).not.toBeNull();
    expect(featured.querySelector('img')?.alt).toBe('Cliente CRONOX en Madrid');
    expect(dom.window.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/gallery',
      expect.objectContaining({ method: 'GET' }),
    );
    dom.window.close();
  });

  it('opens occupied tiles, leaves placeholders inert, and shows the complete original', () => {
    const dom = makeGalleryDom();
    const gallery = (dom.window as any).CRONOX_GALLERY;
    gallery.render([
      {
        key: 'featured',
        featured: true,
        imageSrc: 'https://storage.example.test/original.jpg',
        alt: 'Editorial completa',
        focalX: 12,
        focalY: 88,
        zoom: 2.4,
      },
      { key: 'slot-01', color: 'red' },
    ]);
    const document = dom.window.document;
    const occupied = document.querySelector<HTMLButtonElement>(
      '[data-gallery-slot="featured"]',
    )!;
    const placeholder = document.querySelector<HTMLElement>(
      '[data-gallery-slot="slot-01"]',
    )!;

    expect(placeholder.tagName).toBe('DIV');
    placeholder.click();
    expect(
      (document.getElementById('galleryLightbox') as HTMLElement).hidden,
    ).toBe(true);
    occupied.click();

    const lightbox = document.getElementById('galleryLightbox') as HTMLElement;
    const image = document.getElementById(
      'galleryLightboxImage',
    ) as HTMLImageElement;
    expect(lightbox.hidden).toBe(false);
    expect(lightbox.getAttribute('role')).toBe('dialog');
    expect(lightbox.getAttribute('aria-modal')).toBe('true');
    expect(image.src).toBe('https://storage.example.test/original.jpg');
    expect(image.style.getPropertyValue('--zoom')).toBe('');
    expect(image.closest('.gallery__tile')).toBeNull();
    expect(galleryStyles).toMatch(
      /\.gallery-lightbox__image\s*\{[^}]*width:\s*auto;[^}]*height:\s*auto;[^}]*max-width:\s*100%;[^}]*max-height:\s*calc\(100vh - 112px\);[^}]*max-height:\s*calc\(100dvh - 112px\);[^}]*object-fit:\s*contain;[^}]*object-position:\s*center;/s,
    );
    expect(galleryStyles).toMatch(
      /\.gallery-lightbox__image\s*\{[^}]*transform:\s*none;[^}]*transform-origin:\s*center;/s,
    );
    (document.getElementById('galleryLightboxStage') as HTMLElement).click();
    expect(lightbox.hidden).toBe(true);
    dom.window.close();
  });

  it('bounds and centers every lightbox image independently of its aspect ratio', () => {
    expect(galleryStyles).toMatch(
      /\.gallery-lightbox__composition\s*\{[^}]*display:\s*inline-flex;[^}]*width:\s*max-content;[^}]*max-width:\s*calc\(100vw - 112px\);[^}]*max-height:\s*calc\(100vh - 112px\);[^}]*max-height:\s*calc\(100dvh - 112px\);[^}]*gap:\s*0;[^}]*overflow:\s*hidden;[^}]*background:\s*transparent;/s,
    );
    expect(galleryStyles).toMatch(
      /\.gallery-lightbox__stage\s*\{[^}]*display:\s*flex;[^}]*flex:\s*0 1 var\(--gallery-lightbox-image-width,[^;]+;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;[^}]*width:\s*var\(--gallery-lightbox-image-width, auto\);[^}]*overflow:\s*hidden;[^}]*background:\s*transparent;/s,
    );
    expect(galleryStyles).not.toMatch(
      /\.gallery-lightbox__stage\s*\{[^}]*flex:\s*1\s+1\s+auto;/s,
    );

    const dom = makeGalleryDom();
    Object.defineProperty(dom.window, 'innerWidth', {
      configurable: true,
      value: 1920,
    });
    Object.defineProperty(dom.window, 'innerHeight', {
      configurable: true,
      value: 1080,
    });
    const gallery = (dom.window as any).CRONOX_GALLERY;
    gallery.render([
      {
        key: 'portrait',
        imageSrc: 'https://storage.example.test/portrait.jpg',
        description: 'Con columna',
      },
      {
        key: 'landscape',
        imageSrc: 'https://storage.example.test/landscape.jpg',
      },
      {
        key: 'wide-with-info',
        imageSrc: 'https://storage.example.test/wide-with-info.jpg',
        description: 'Columna estrecha',
      },
    ]);
    const document = dom.window.document;
    document
      .querySelector<HTMLButtonElement>('[data-gallery-slot="portrait"]')!
      .click();
    const root = document.getElementById('galleryLightbox') as HTMLElement;
    const image = document.getElementById(
      'galleryLightboxImage',
    ) as HTMLImageElement;
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 1800 },
      naturalHeight: { configurable: true, value: 3000 },
    });
    image.onload?.(new dom.window.Event('load'));
    const portraitWidth = Number.parseFloat(
      root.style.getPropertyValue('--gallery-lightbox-image-width'),
    );
    const portraitHeight = Number.parseFloat(
      root.style.getPropertyValue('--gallery-lightbox-image-height'),
    );
    expect(portraitHeight).toBeLessThanOrEqual(968);
    expect(portraitWidth / portraitHeight).toBeCloseTo(1800 / 3000, 3);
    const simulatedImageRight = 100 + portraitWidth;
    const simulatedSidebarLeft = 100 + portraitWidth;
    expect(
      Math.abs(simulatedSidebarLeft - simulatedImageRight),
    ).toBeLessThanOrEqual(1);

    (
      document.getElementById('galleryLightboxNext') as HTMLButtonElement
    ).click();
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 3200 },
      naturalHeight: { configurable: true, value: 1800 },
    });
    image.onload?.(new dom.window.Event('load'));
    const landscapeWidth = Number.parseFloat(
      root.style.getPropertyValue('--gallery-lightbox-image-width'),
    );
    const landscapeHeight = Number.parseFloat(
      root.style.getPropertyValue('--gallery-lightbox-image-height'),
    );
    expect(landscapeWidth).toBeLessThanOrEqual(1808);
    expect(landscapeHeight).toBeLessThanOrEqual(968);
    expect(landscapeWidth / landscapeHeight).toBeCloseTo(3200 / 1800, 3);
    expect(root.classList.contains('has-info')).toBe(false);

    (
      document.getElementById('galleryLightboxNext') as HTMLButtonElement
    ).click();
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 4000 },
      naturalHeight: { configurable: true, value: 1000 },
    });
    image.onload?.(new dom.window.Event('load'));
    expect(
      Number.parseFloat(
        root.style.getPropertyValue('--gallery-lightbox-image-width'),
      ),
    ).toBeCloseTo(1488, 3);
    expect(root.classList.contains('has-info')).toBe(true);

    Object.defineProperty(dom.window, 'innerWidth', {
      configurable: true,
      value: 1366,
    });
    Object.defineProperty(dom.window, 'innerHeight', {
      configurable: true,
      value: 768,
    });
    dom.window.dispatchEvent(new dom.window.Event('resize'));
    expect(
      Number.parseFloat(
        root.style.getPropertyValue('--gallery-lightbox-image-width'),
      ),
    ).toBeCloseTo(964, 3);
    dom.window.close();
  });

  it('keeps the information column inside the composition and the loading state bounded', () => {
    expect(galleryStyles).toMatch(
      /\.gallery-lightbox__info\s*\{[^}]*box-sizing:\s*border-box;[^}]*flex:\s*0 0 clamp\(290px, 18vw, 320px\);[^}]*width:\s*clamp\(290px, 18vw, 320px\);[^}]*max-width:\s*330px;[^}]*height:\s*100%;[^}]*max-height:\s*100%;[^}]*min-height:\s*0;[^}]*padding:\s*clamp\(70px, 9vh, 108px\) 20px 36px;[^}]*overflow-y:\s*auto;/s,
    );
    expect(galleryScript).toContain(
      'Math.min(320, Math.max(290, viewportWidth * 0.18))',
    );
    expect(galleryStyles).toMatch(
      /\.gallery-lightbox__loading\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*display:\s*grid;[^}]*place-items:\s*center;/s,
    );
    expect(galleryStyles).not.toContain(
      '.gallery-lightbox.has-info .gallery-lightbox__arrow--next',
    );

    const dom = makeGalleryDom();
    const gallery = (dom.window as any).CRONOX_GALLERY;
    const document = dom.window.document;
    gallery.render([
      {
        key: 'with-info',
        imageSrc: 'https://storage.example.test/with-info.jpg',
        description: 'Informaci\u00f3n',
      },
      {
        key: 'without-info',
        imageSrc: 'https://storage.example.test/without-info.jpg',
      },
    ]);

    document
      .querySelector<HTMLButtonElement>('[data-gallery-slot="with-info"]')!
      .click();
    const lightbox = document.getElementById('galleryLightbox') as HTMLElement;
    expect(lightbox.classList.contains('has-info')).toBe(true);
    expect(
      (document.getElementById('galleryLightboxInfo') as HTMLElement).hidden,
    ).toBe(false);
    (
      document.getElementById('galleryLightboxNext') as HTMLButtonElement
    ).click();
    expect(lightbox.classList.contains('has-info')).toBe(false);
    expect(
      (document.getElementById('galleryLightboxInfo') as HTMLElement).hidden,
    ).toBe(true);
    expect(
      document
        .getElementById('galleryLightboxStage')
        ?.contains(document.getElementById('galleryLightboxImage')),
    ).toBe(true);
    dom.window.close();
  });

  it('uses a translucent backdrop without covering the underlying Gallery', () => {
    expect(galleryStyles).toMatch(
      /\.gallery-lightbox\s*\{[^}]*background:\s*rgba\(0, 0, 0, 0\.68\);[^}]*backdrop-filter:\s*blur\(2px\);/s,
    );
    expect(galleryStyles).toMatch(
      /\.gallery-lightbox__composition\s*\{[^}]*background:\s*transparent;/s,
    );
    expect(galleryStyles).toMatch(
      /\.gallery-lightbox__stage\s*\{[^}]*background:\s*transparent;/s,
    );
    expect(galleryStyles).not.toMatch(
      /gallery-lightbox-open[^}]*\.gallery-(?:page|grid)[^}]*display:\s*none/,
    );

    const dom = makeGalleryDom();
    const gallery = (dom.window as any).CRONOX_GALLERY;
    gallery.render([
      {
        key: 'visible-grid',
        imageSrc: 'https://storage.example.test/grid.jpg',
      },
    ]);
    const document = dom.window.document;
    document.querySelector<HTMLButtonElement>('[data-gallery-slot]')!.click();
    expect(document.getElementById('galleryGrid')).not.toBeNull();
    expect(document.querySelector('.gallery-page')?.isConnected).toBe(true);
    dom.window.close();
  });

  it('applies loading attributes and handlers before changing the lightbox source', () => {
    const loadingIndex = galleryScript.indexOf(
      'lightboxElements.image.loading = "eager"',
    );
    const decodingIndex = galleryScript.indexOf(
      'lightboxElements.image.decoding = "async"',
    );
    const onloadIndex = galleryScript.indexOf(
      'lightboxElements.image.onload = ready',
    );
    const sourceIndex = galleryScript.indexOf(
      'lightboxElements.image.src = item.imageSrc',
    );
    expect(loadingIndex).toBeGreaterThan(-1);
    expect(decodingIndex).toBeGreaterThan(loadingIndex);
    expect(onloadIndex).toBeGreaterThan(decodingIndex);
    expect(sourceIndex).toBeGreaterThan(onloadIndex);
    expect(galleryScript).not.toMatch(
      /galleryLightboxImage[^\n]*(?:width|height)\s*=/,
    );
  });

  it('zooms only lightbox product images on fine-pointer hover without darkening', () => {
    expect(galleryStyles).toMatch(
      /\.gallery-lightbox__product-media\s*\{[^}]*overflow:\s*hidden;[^}]*background:\s*#fff;/s,
    );
    expect(galleryStyles).toMatch(
      /\.gallery-lightbox__product-media img\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*object-fit:\s*contain;[^}]*transform:\s*scale\(1\);[^}]*transform-origin:\s*center;[^}]*transition:\s*transform 500ms ease-out;/s,
    );
    expect(galleryStyles).toMatch(
      /@media \(hover: hover\) and \(pointer: fine\)\s*\{[\s\S]*\.gallery-lightbox__product:hover \.gallery-lightbox__product-media img\s*\{[^}]*transform:\s*scale\(1\.025\);[^}]*transition-duration:\s*1\.5s;/,
    );
    expect(galleryStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*\.gallery-lightbox__product-media img,\s*\.gallery-lightbox__product:hover \.gallery-lightbox__product-media img\s*\{[^}]*transform:\s*scale\(1\);[^}]*transition:\s*none;/,
    );
    expect(galleryStyles).not.toMatch(
      /\.gallery-lightbox__product\s*\{[^}]*(?:transform|opacity|filter):/s,
    );
    expect(galleryStyles).not.toMatch(
      /\.gallery-lightbox__product-(?:content|name|price|action)\s*\{[^}]*transform:/s,
    );
    expect(galleryStyles).not.toMatch(
      /\.gallery-lightbox__product-media(?:::?before|::after)[^{]*\{/,
    );
    expect(galleryStyles).not.toMatch(
      /\.gallery-lightbox__product:hover \.gallery-lightbox__product-media img\s*\{[^}]*(?:opacity|filter|background|color):/s,
    );
  });

  it('renders products in order, plain text below them, and safe availability actions', () => {
    expect(galleryStyles).toMatch(
      /\.gallery-lightbox__product\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\);[^}]*width:\s*100%;/s,
    );
    expect(galleryStyles).toMatch(
      /\.gallery-lightbox__product-media\s*\{[^}]*width:\s*100%;[^}]*aspect-ratio:\s*1 \/ 1;[^}]*background:\s*#fff;/s,
    );
    expect(galleryStyles).toMatch(
      /\.gallery-lightbox__product-media img\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*object-fit:\s*contain;/s,
    );
    expect(galleryStyles).toMatch(
      /\.gallery-lightbox__product-action\s*\{[^}]*display:\s*flex;[^}]*width:\s*100%;/s,
    );
    const dom = makeGalleryDom();
    const gallery = (dom.window as any).CRONOX_GALLERY;
    gallery.render([
      {
        key: 'featured',
        imageSrc: 'https://storage.example.test/editorial.jpg',
        alt: 'Editorial CRONOX',
        products: [
          galleryProduct({ id: 2, name: 'SECOND TEE', slug: 'second-tee' }),
          galleryProduct({
            id: 3,
            name: 'ARCHIVE TEE',
            slug: 'archive-tee',
            available: false,
          }),
        ],
        description: '<img src=x onerror=alert(1)>\nSegunda l\u00ednea',
      },
    ]);
    const document = dom.window.document;
    document
      .querySelector<HTMLButtonElement>('[data-gallery-slot="featured"]')!
      .click();

    const info = document.getElementById('galleryLightboxInfo') as HTMLElement;
    const cards = Array.from(
      document.querySelectorAll<HTMLElement>('.gallery-lightbox__product'),
    );
    const description = document.getElementById(
      'galleryLightboxDescription',
    ) as HTMLElement;
    expect(info.hidden).toBe(false);
    expect(cards.map((card) => card.textContent)).toEqual([
      expect.stringContaining('SECOND TEE'),
      expect.stringContaining('ARCHIVE TEE'),
    ]);
    expect(cards[0].tagName).toBe('A');
    expect((cards[0] as HTMLAnchorElement).href).toBe(
      'http://localhost:3000/producto.html?slug=second-tee',
    );
    expect(cards[1].tagName).toBe('ARTICLE');
    expect(cards[1].textContent).toContain('NO DISPONIBLE');
    expect(
      cards[0].querySelector('.gallery-lightbox__product-media'),
    ).not.toBeNull();
    expect(
      cards[0].querySelector('.gallery-lightbox__product-content'),
    ).not.toBeNull();
    expect(description.previousElementSibling).toBe(
      document.getElementById('galleryLightboxProducts'),
    );
    expect(description.textContent).toBe(
      '<img src=x onerror=alert(1)>\nSegunda l\u00ednea',
    );
    expect(description.querySelector('img')).toBeNull();
    dom.window.close();
  });

  it('applies every information-column condition including Instagram-only overlay', () => {
    const dom = makeGalleryDom();
    const gallery = (dom.window as any).CRONOX_GALLERY;
    const document = dom.window.document;
    const cases = [
      {
        item: { products: [galleryProduct()], description: '' },
        hasInfo: true,
        productCount: 1,
      },
      {
        item: { products: [], description: 'Texto solamente' },
        hasInfo: true,
        productCount: 0,
      },
      {
        item: { products: [], description: '' },
        hasInfo: false,
        productCount: 0,
      },
      {
        item: {
          products: [],
          description: '   ',
          instagramUrl: 'https://www.instagram.com/p/CRONOX123/',
        },
        hasInfo: false,
        productCount: 0,
        instagramOverlay: true,
      },
    ];

    cases.forEach((testCase, index) => {
      gallery.render([
        {
          key: `case-${index}`,
          imageSrc: `https://storage.example.test/${index}.jpg`,
          alt: `Caso ${index}`,
          ...testCase.item,
        },
      ]);
      document.querySelector<HTMLButtonElement>('[data-gallery-slot]')!.click();
      expect(
        (document.getElementById('galleryLightboxInfo') as HTMLElement).hidden,
      ).toBe(!testCase.hasInfo);
      expect(
        document.querySelectorAll('.gallery-lightbox__product'),
      ).toHaveLength(testCase.productCount);
      expect(
        (
          document.getElementById(
            'galleryLightboxInstagramOverlay',
          ) as HTMLElement
        ).hidden,
      ).toBe(!testCase.instagramOverlay);
      (
        document.getElementById('galleryLightboxClose') as HTMLButtonElement
      ).click();
    });
    dom.window.close();
  });

  it('wraps occupied-only navigation and supports arrows, Escape, focus, and scroll restoration', () => {
    const dom = makeGalleryDom();
    Object.defineProperty(dom.window, 'scrollY', {
      configurable: true,
      value: 420,
    });
    const gallery = (dom.window as any).CRONOX_GALLERY;
    gallery.render([
      {
        key: 'slot-a',
        imageSrc: 'https://storage.example.test/a.jpg',
        alt: 'Foto A',
      },
      { key: 'empty', color: 'grey' },
      {
        key: 'slot-b',
        imageSrc: 'https://storage.example.test/b.jpg',
        alt: 'Foto B',
      },
    ]);
    const document = dom.window.document;
    const opener = document.querySelector<HTMLButtonElement>(
      '[data-gallery-slot="slot-a"]',
    )!;
    opener.focus();
    opener.click();
    const image = document.getElementById(
      'galleryLightboxImage',
    ) as HTMLImageElement;

    expect(document.activeElement?.id).toBe('galleryLightboxClose');
    expect(document.body.style.position).toBe('fixed');
    expect(document.body.style.top).toBe('-420px');
    document.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft' }),
    );
    expect(image.src).toBe('https://storage.example.test/b.jpg');
    document.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight' }),
    );
    expect(image.src).toBe('https://storage.example.test/a.jpg');
    (
      document.getElementById('galleryLightboxNext') as HTMLButtonElement
    ).click();
    expect(image.src).toBe('https://storage.example.test/b.jpg');
    document.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key: 'Escape' }),
    );
    expect(
      (document.getElementById('galleryLightbox') as HTMLElement).hidden,
    ).toBe(true);
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.position).toBe('');
    expect(dom.window.scrollTo).toHaveBeenCalledWith(0, 420);
    dom.window.close();
  });

  it('keeps full-screen mobile composition bounded and reduced-motion safe', () => {
    expect(galleryStyles).toMatch(
      /@media \(max-width: 767px\)[\s\S]*\.gallery-lightbox\s*\{[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/,
    );
    expect(galleryStyles).toMatch(
      /@media \(max-width: 767px\)[\s\S]*\.gallery-lightbox__composition\s*\{[^}]*flex-direction:\s*column;/,
    );
    expect(galleryStyles).toMatch(
      /@media \(max-width: 767px\)[\s\S]*\.gallery-lightbox__composition\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*max-height:\s*none;[^}]*overflow:\s*visible;/,
    );
    expect(galleryStyles).toMatch(
      /@media \(max-width: 767px\)[\s\S]*\.gallery-lightbox__stage\s*\{[^}]*width:\s*100%;[^}]*height:\s*var\(--gallery-lightbox-image-height, calc\(100vh - 96px\)\);[^}]*height:\s*var\(--gallery-lightbox-image-height, calc\(100dvh - 96px\)\);[^}]*padding:\s*0;/,
    );
    expect(galleryStyles).toMatch(
      /@media \(max-width: 767px\)[\s\S]*\.gallery-lightbox__image\s*\{[^}]*max-width:\s*min\([^}]*max-height:\s*calc\(100vh - 96px\);[^}]*max-height:\s*calc\(100dvh - 96px\);/,
    );
    expect(galleryStyles).toMatch(
      /@media \(max-width: 767px\)[\s\S]*\.gallery-lightbox__info\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%;/,
    );
    expect(galleryStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.gallery-lightbox__image\s*\{[^}]*transition:\s*none;/,
    );
    expect(galleryStyles).not.toContain('width: 100vw');
  });
});
