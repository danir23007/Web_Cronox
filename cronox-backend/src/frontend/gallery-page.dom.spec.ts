/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const frontendRoot = path.resolve(__dirname, '../../../cronox-front');
const readFrontend = (file: string) =>
  readFileSync(path.join(frontendRoot, file), 'utf8');

const galleryHtml = readFrontend('gallery.html');
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
    expect(galleryHtml).toContain('href="assets/gallery.css?v=3"');
    expect(galleryHtml).toContain('src="assets/gallery.js?v=3"');
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

  it('defines the seamless six-column desktop and four-column mobile compositions', () => {
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
    expect(galleryStyles).toContain('.gallery__tile--link:focus-visible');
    expect(galleryStyles).toContain('@media (max-width: 767px)');
    expect(galleryStyles).toMatch(
      /@media[\s\S]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/,
    );
    expect(galleryStyles).toMatch(
      /@media[\s\S]*\.gallery__tile--featured\s*\{[^}]*grid-column:\s*1 \/ -1;[^}]*grid-row:\s*auto;[^}]*aspect-ratio:\s*16 \/ 9;/,
    );
    expect(galleryStyles).toContain(
      '.gallery__tile:not(.gallery__tile--featured)',
    );
  });

  it('renders a real Instagram fixture as a safe full-tile external link', () => {
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

    const link = fixture?.querySelector<HTMLAnchorElement>('a.gallery__tile');
    const image = link?.querySelector<HTMLImageElement>('img');
    expect(link?.href).toBe('https://www.instagram.com/p/CRONOX123/');
    expect(link?.target).toBe('_blank');
    expect(link?.rel).toBe('noopener noreferrer');
    expect(link?.classList.contains('gallery__tile--featured')).toBe(true);
    expect(link?.getAttribute('aria-label')).toContain('Cliente');
    expect(image?.getAttribute('src')).toBe('assets/gallery/customer-01.jpg');
    expect(image?.alt).toBe('Cliente con una camiseta CRONOX');

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
    expect(featured.tagName).toBe('A');
    expect(featured.dataset.gallerySlot).toBe('featured');
    expect(featured.style.getPropertyValue('--focal-x')).toBe('28%');
    expect(featured.style.getPropertyValue('--focal-y')).toBe('72%');
    expect(featured.style.getPropertyValue('--zoom')).toBe('1.6');
    expect(featured.querySelector('img')?.alt).toBe('Cliente CRONOX en Madrid');
    expect(dom.window.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/gallery',
      expect.objectContaining({ method: 'GET' }),
    );
    dom.window.close();
  });
});
