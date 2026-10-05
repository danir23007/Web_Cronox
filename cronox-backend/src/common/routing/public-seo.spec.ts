import express from 'express';
import request from 'supertest';
import { join } from 'path';
import { JSDOM } from 'jsdom';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import {
  createSeoCatalog,
  createSeoPages,
  createSeoDiscovery,
  seoRequestSignals,
  productSchema,
  renderSeoHead,
  HOME_TITLE,
  HOME_DESCRIPTION,
  productDescription,
  type SeoCatalog,
  type SeoProduct,
} from './public-seo';
import { legacyRedirectTarget, robotsText } from './public-pages';
import { createContentSecurityPolicy } from '../config/content-security-policy';

const root = join(__dirname, '../../../../cronox-front');

it('coalesces concurrent discovery reads without retaining stale links or failed reads', async () => {
  let resolve!: (value: unknown) => void;
  const prisma = { product: { findMany: jest.fn().mockImplementationOnce(() => new Promise(r => { resolve = r; })) } };
  const source = createSeoCatalog(prisma as never);
  const reads = Array.from({ length: 12 }, () => source.links());
  expect(prisma.product.findMany).toHaveBeenCalledTimes(1);
  resolve([{ id: 1, slug: 'one', name: 'One' }]);
  expect((await Promise.all(reads)).every(links => links[0].slug === 'one')).toBe(true);
  prisma.product.findMany.mockRejectedValueOnce(new Error('unavailable'));
  await expect(source.links()).rejects.toThrow('unavailable');
  prisma.product.findMany.mockResolvedValueOnce([{ id: 2, slug: 'two', name: 'Two' }]);
  expect(await source.links()).toEqual([{ id: 2, slug: 'two', name: 'Two' }]);
  expect(prisma.product.findMany).toHaveBeenCalledTimes(3);
});
const product: SeoProduct = {
  id: 10,
  slug: 'camiseta-prueba',
  name: 'Camiseta de prueba',
  description: 'Algodón. Corte amplio.',
  price: 4000,
  currency: 'EUR',
  isActive: true,
  imageUrl: null,
  images: [{ url: 'https://cronox.es/photo.png', alt: 'Camiseta', variants: null, width: null, height: null }],
  variants: [
    { id: 1, size: 'S', sku: 'TEST-S', price: null, stockQty: 2 },
    { id: 2, size: 'M', sku: 'TEST-M', price: 4500, stockQty: 0 },
  ],
};
const catalog: SeoCatalog = {
  product: async (key) =>
    ('slug' in key ? key.slug === product.slug : key.id === product.id)
      ? product
      : null,
  links: async () => [product],
};
function app(source = catalog, gated = false) {
  const app = express();
  app.set('trust proxy', 1);
  app.use((_req, res, next) => {
    res.setHeader('Content-Security-Policy', createContentSecurityPolicy(root));
    next();
  });
  app.use(seoRequestSignals);
  app.use(createSeoDiscovery(source, async () => gated));
  app.use((req, res, next) => {
    const target = legacyRedirectTarget(req.path, req.originalUrl);
    return target ? res.redirect(308, target) : next();
  });
  app.use(createSeoPages(root, source));
  app.use((_req, res) => res.status(404).send('Not found'));
  return app;
}
const doc = (html: string) => new JSDOM(html).window.document;
describe('public SEO server HTML (no database connection)', () => {
  it('serves the complete brand article and its metadata without JavaScript', async () => {
    const response = await request(app()).get('/sobre-cronox');
    expect(response.status).toBe(200);
    const document = doc(response.text);
    expect(document.title).toBe('Sobre CRONOX | La cara B del ser humano');
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    expect(document.querySelectorAll('main h2')).toHaveLength(8);
    expect(document.querySelectorAll('main section p')).toHaveLength(13);
    expect(document.querySelector('link[rel=canonical]')?.getAttribute('href')).toBe('https://cronox.es/sobre-cronox');
    expect(document.querySelector('meta[name=robots]')?.getAttribute('content')).not.toContain('noindex');
    expect(document.querySelector('meta[property="og:image"]')?.getAttribute('content')).toBe('https://cronox.es/assets/logo_banner.png');
    expect(document.querySelector('main')?.textContent).toContain('Daniel Rivas');
    expect(document.querySelector('main')?.innerHTML).toBe(doc(readFileSync(join(root, 'sobre-cronox.html'), 'utf8')).querySelector('main')?.innerHTML);
    const graph = JSON.parse(document.querySelector('#cronox-seo')!.textContent!)['@graph'];
    expect(graph.find(n => n['@type'] === 'AboutPage')).toMatchObject({
      '@id': 'https://cronox.es/sobre-cronox#webpage',
      mainEntity: { '@id': 'https://cronox.es/#organization' },
      isPartOf: { '@id': 'https://cronox.es/#website' },
    });
    expect((await request(app()).get('/sobre-cronox.html')).headers.location).toBe('/sobre-cronox');
    expect((await request(app()).get('/sitemap.xml')).text).toContain('<loc>https://cronox.es/sobre-cronox</loc>');
  });
  it('has one homepage WebSite, consistent identity and crawlable product links without JavaScript', async () => {
    const result = await request(app()).get('/');
    const document = doc(result.text);
    expect(result.status).toBe(200);
    expect(document.title).toBe(HOME_TITLE);
    expect(
      document.querySelector('meta[name=description]')?.getAttribute('content'),
    ).toBe(HOME_DESCRIPTION);
    expect(document.querySelectorAll('link[rel=canonical]')).toHaveLength(1);
    expect(
      document.querySelector('link[rel=canonical]')?.getAttribute('href'),
    ).toBe('https://cronox.es/');
    const data = JSON.parse(
      document.querySelector('#cronox-seo')!.textContent!,
    );
    expect(data['@graph'].filter((n) => n['@type'] === 'WebSite')).toEqual([
      expect.objectContaining({ name: 'CRONOX', url: 'https://cronox.es/' }),
    ]);
    expect(
      document.querySelector('#productsGrid a')?.getAttribute('href'),
    ).toBe('/producto/camiseta-prueba');
    expect(result.text).not.toContain('Próximamente');
    expect(result.headers.link).toBe('<https://cronox.es/>; rel="canonical"');
    expect(data['@graph'].filter(n => n['@type'] === 'Organization')).toEqual([
      expect.objectContaining({ '@id': 'https://cronox.es/#organization', name: 'CRONOX',
        logo: 'https://cronox.es/assets/logo_banner.png', sameAs: ['https://www.instagram.com/cronox.es/'] }),
    ]);
    expect(new Set(data['@graph'].map(n => n['@id'])).size).toBe(data['@graph'].length);
    expect(JSON.stringify(data)).not.toMatch(/alternateName|foundingDate|streetAddress|telephone|tu_cuenta|Sports/);
    for (const selector of ['title','meta[name=description]','meta[name=robots]','meta[property="og:site_name"]','script[type="application/ld+json"]'])
      expect(document.querySelectorAll(selector)).toHaveLength(1);
  });
  it('does not re-expose the entire frontend through password-recovery static mounts', () => {
    const module = readFileSync(join(__dirname, '../../app.module.ts'), 'utf8');
    expect(module).not.toMatch(
      /serveRoot:\s*['"]\/(?:forgot-password|reset-password)['"]/,
    );
  });
  it.each([
    '/cuenta',
    '/favoritos',
    '/cesta',
    '/checkout',
    '/checkout/exito',
    '/recuperar-contrasena',
    '/restablecer-contrasena',
    '/eventos',
  ])('excludes %s with a crawlable noindex response', async (path) => {
    const result = await request(app()).get(path);
    expect(result.status).toBe(200);
    expect(result.headers['x-robots-tag']).toBe('noindex, follow');
    expect(
      doc(result.text)
        .querySelector('meta[name=robots]')
        ?.getAttribute('content'),
    ).toContain('noindex');
  });
  it('consolidates public hosts and HTTPS without moving checkout/API sessions', async () => {
    const result = await request(app())
      .get('/producto/camiseta-prueba?size=S')
      .set('Host', 'www.cronox.es')
      .set('X-Forwarded-Proto', 'https');
    expect(result.status).toBe(308);
    expect(result.headers.location).toBe(
      'https://cronox.es/producto/camiseta-prueba?size=S',
    );
    expect(
      (
        await request(app())
          .get('/')
          .set('Host', 'cronox.es')
          .set('X-Forwarded-Proto', 'https')
      ).status,
    ).toBe(200);
    // TLS enforcement remains at the edge; HTTP between proxy and app must not loop.
    expect(
      (await request(app()).get('/').set('Host', 'cronox.es')).status,
    ).toBe(200);
    expect(
      (await request(app()).get('/checkout').set('Host', 'www.cronox.es'))
        .status,
    ).toBe(200);
    expect(
      (await request(app()).post('/api/payments').set('Host', 'www.cronox.es'))
        .status,
    ).toBe(404);
  });
  it.each([
    ['/key-screen', '/'],
    ['/key-screen.html', '/'],
    ['/forgot-password/key-screen.html', '/'],
    ['/reset-password/key-screen.html', '/'],
    ['/index.html', '/'],
    ['/producto.html?slug=camiseta-prueba', '/producto/camiseta-prueba'],
    ['/producto?id=10&size=S', '/producto/camiseta-prueba?size=S'],
    ['/producto/camiseta-prueba/', '/producto/camiseta-prueba'],
  ])('redirects %s to %s', async (path, target) => {
    const result = await request(app()).get(path);
    expect(result.status).toBe(308);
    expect(result.headers.location).toBe(target);
  });
  it('canonicalizes tracking/shop duplicates and excludes search/filter pages', async () => {
    for (const path of ['/tienda', '/?utm_source=test']) {
      const result = await request(app()).get(path);
      expect(result.headers.link).toBe('<https://cronox.es/>; rel="canonical"');
      expect(result.headers['x-robots-tag']).toBeUndefined();
    }
    for (const path of ['/tienda?categorySlug=camisetas', '/?search=test']) {
      expect(
        (await request(app()).get(path)).headers['x-robots-tag'],
      ).toContain('noindex');
    }
  });
  it('renders real product data, prices and variant offers before JS', async () => {
    const response = await request(app()).get(
      '/producto/camiseta-prueba?size=M',
    );
    const document = doc(response.text);
    expect(document.title).toBe('Camiseta de prueba | CRONOX');
    expect(document.querySelector('#pName')?.textContent).toBe(product.name);
    expect(document.querySelector('#pPrice')?.textContent).toContain('45,00');
    expect(document.querySelector('#pDetails')?.textContent).toBe(
      product.description,
    );
    const data = JSON.parse(
      document.querySelector('#cronox-seo')!.textContent!,
    );
    expect(data['@type']).toBe('ProductGroup');
    expect(data.hasVariant.map((v) => v.offers.price)).toEqual([
      '40.00',
      '45.00',
    ]);
    expect(data.hasVariant[1].offers.availability).toBe(
      'https://schema.org/OutOfStock',
    );
    expect(data.hasVariant[1].offers.url).toBe(
      'https://cronox.es/producto/camiseta-prueba?size=M',
    );
    expect(data.hasVariant[0].offers.priceCurrency).toBe('EUR');
    expect(data.aggregateRating).toBeUndefined();
    expect(data.brand).toEqual({ '@type': 'Brand', '@id': 'https://cronox.es/#brand', name: 'CRONOX' });
    expect(document.querySelector('#pDesc')?.hasAttribute('hidden')).toBe(true);
    expect(document.querySelector('#pImage')?.getAttribute('loading')).toBe('eager');
    expect(document.querySelector('.size-btn.is-active')?.getAttribute('data-size')).toBe('M');
    const scriptPolicy = response.headers['content-security-policy']
      .split(';')
      .find((part) => part.trim().startsWith('script-src'));
    expect(scriptPolicy).not.toContain('unsafe-inline');
    const hash = createHash('sha256')
      .update(document.querySelector('#cronox-seo')!.textContent!)
      .digest('base64');
    expect(scriptPolicy).toContain(`'sha256-${hash}'`);
  });
  it('uses real 404s for missing/inactive products; does not emit fake offers', async () => {
    for (const path of [
      '/producto',
      '/producto/no-existe',
      '/producto?id=999',
      '/producto/%ZZ',
      '/producto?id=999999999999999999',
    ]) {
      const result = await request(app()).get(path);
      expect(result.status).toBe(404);
      expect(result.headers['x-robots-tag']).toContain('noindex');
      expect(doc(result.text).querySelector('#cronox-seo')).toBeNull();
    }
    expect(
      (
        await request(
          app({
            ...catalog,
            product: async () => ({ ...product, isActive: false }),
          }),
        ).get('/producto/camiseta-prueba')
      ).status,
    ).toBe(404);
    expect(productSchema({ ...product, variants: [] })).toBeNull();
  });
  it('publishes only canonical live pages/products and no fabricated lastmod; handles closed gate', async () => {
    const response = await request(app()).get('/sitemap.xml');
    const xml = new JSDOM(response.text, { contentType: 'application/xml' })
      .window.document;
    const urls = [...xml.querySelectorAll('loc')].map((n) => n.textContent!);
    expect(urls).toContain('https://cronox.es/producto/camiseta-prueba');
    expect(urls).not.toContain('https://cronox.es/tienda');
    expect(urls.some((url) => /cuenta|checkout|eventos|\?/.test(url))).toBe(
      false,
    );
    expect(xml.querySelector('lastmod')).toBeNull();
    for (const url of urls)
      expect((await request(app()).get(new URL(url).pathname)).status).toBe(
        200,
      );
    const closed = await request(app(catalog, true)).get('/sitemap.xml');
    expect(closed.text.match(/<loc>/g)).toHaveLength(1);
    const robots = await request(app()).get('/robots.txt');
    expect(robots.text).not.toContain('Disallow: /admin');
    expect(robots.text).toContain('Allow: /api/products');
  });
  it('returns retryable 503 on catalogue failure rather than a soft 404/empty sitemap', async () => {
    const broken = {
      product: async () => {
        throw Error();
      },
      links: async () => {
        throw Error();
      },
    };
    for (const path of ['/', '/sitemap.xml', '/producto/camiseta-prueba']) {
      const result = await request(app(broken)).get(path);
      expect(result.status).toBe(503);
      expect(result.headers['retry-after']).toBe('60');
    }
  });
  it('escapes catalogue values in HTML/JSON-LD without weakening script security', () => {
    const evil =
      '</script><script>alert(1)</script><img src=x onerror=alert(2)>';
    const rendered = renderSeoHead('<head><title>old</title></head>', {
      title: evil,
      description: evil,
      canonical: 'https://cronox.es/',
      schema: { name: evil },
    });
    const document = doc(rendered.html);
    expect(document.scripts).toHaveLength(1);
    expect(document.querySelector('img')).toBeNull();
    expect(JSON.parse(document.scripts[0].textContent!).name).toBe(evil);
  });
  it('reads active-only, narrowly selected products with cursor pagination', async () => {
    const findMany = jest.fn().mockResolvedValue([]),
      findUnique = jest.fn().mockResolvedValue(null);
    const source = createSeoCatalog({
      product: { findMany, findUnique },
    } as any);
    await source.product({ slug: 'a' });
    await source.links();
    expect(findUnique.mock.calls[0][0].where).toEqual({
      slug: 'a',
      isActive: true,
    });
    expect(findUnique.mock.calls[0][0].select.variants.where).toEqual({
      isActive: true,
    });
    expect(findMany.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        take: 500,
        where: { isActive: true, id: { gt: 0 } },
      }),
    );
  });

  it('uses the first purchasable size in size order for the default HTML price', async () => {
    const changed = { ...product, variants: [
      { ...product.variants[0], size: 'XL' as const, price: 5200 },
      { ...product.variants[1], price: 4600, stockQty: 2 },
    ] };
    const source = { ...catalog, product: async () => changed };
    for (const suffix of ['', '?size=INVALID']) {
      const document = doc((await request(app(source)).get('/producto/camiseta-prueba' + suffix)).text);
      expect(document.querySelector('#pPrice')?.textContent).toContain('46,00');
      expect(document.querySelector('.size-btn.is-active')?.getAttribute('data-size')).toBe('M');
    }
  });

  it('keeps sold-out products, ring size URLs and current catalogue lifecycle', async () => {
    let current: SeoProduct | null = { ...product, variants: [{ ...product.variants[0], size: 'US_8', stockQty: 0 }] };
    const source: SeoCatalog = { product: async () => current, links: async () => current ? [current] : [] };
    const server = app(source);
    const response = await request(server).get('/producto/camiseta-prueba?size=US_8');
    const document = doc(response.text);
    expect(response.status).toBe(200);
    expect(document.querySelector('.size-btn.is-active')?.textContent).toBe('US 8');
    const variant = JSON.parse(document.querySelector('#cronox-seo')!.textContent!).hasVariant[0];
    expect(variant.offers.url).toContain('?size=US_8');
    expect(variant.offers.availability).toBe('https://schema.org/OutOfStock');
    expect((await request(server).get('/sitemap.xml')).text).toContain('camiseta-prueba');
    current = null;
    expect((await request(server).get('/sitemap.xml')).text).not.toContain('camiseta-prueba');
    expect((await request(server).get('/producto/camiseta-prueba')).status).toBe(404);
    current = { ...product, slug: 'nuevo-producto' };
    expect((await request(server).get('/sitemap.xml')).text).toContain('nuevo-producto');
  });

  it('does not replace a preview noindex instruction with product indexability', async () => {
    const server = express();
    server.use((_req, res, next) => { res.setHeader('X-Robots-Tag', 'noindex'); next(); });
    server.use(createSeoPages(root, catalog));
    const response = await request(server).get('/producto/camiseta-prueba');
    expect(doc(response.text).querySelector('meta[name=robots]')?.getAttribute('content')).toContain('noindex');
  });

  it('keeps search and training bots under the existing complete wildcard rules', () => {
    const robots = robotsText(false);
    // No specific group can override the wildcard exclusions for any named bot.
    expect(robots.match(/User-agent:/g)).toHaveLength(1);
    expect(robots).toContain('User-agent: *');
    expect(robots).toContain('Disallow: /api/');
    expect(robots).toContain('Allow: /api/products');
    expect(robots).not.toMatch(/Disallow: \/(?:assets|producto|sobre-cronox|cuenta|checkout)/);
  });

  it('summarizes real descriptions at sentence/word boundaries without duplicating the name', () => {
    const description = 'Camiseta de corte cropped y silueta cuadrada. Ajuste amplio y holgado. Composición: 100 % algodón orgánico. Cuello redondo de canalé ajustado. Hombros caídos y mangas anchas.';
    expect(productDescription('SCARRED TEE - black', description)).toBe(description.slice(0, description.indexOf(' Hombros')));
    expect(productDescription('TEST', null)).toContain('TEST');
    expect(productDescription('TEST', 'palabra '.repeat(60))).toMatch(/palabra…$/);
    expect(productDescription('TEST', 'X'.repeat(180))).toBe('X'.repeat(180));
  });

  it('escapes editable product content in actual HTML, attributes and structured data', async () => {
    const hostile = '</script><img src=x onerror="alert(1)"> & "test"';
    const source = { ...catalog, product: async () => ({ ...product, name: hostile, description: hostile,
      images: [{ url: 'javascript:alert(1)', alt: hostile, variants: null, width: null, height: null }, { url: '/safe.png', alt: hostile, variants: null, width: null, height: null }] }) };
    const response = await request(app(source)).get('/producto/camiseta-prueba');
    const document = doc(response.text);
    expect(document.querySelectorAll('img[onerror],script:not([src]):not([type])').length).toBe(doc(readFileSync(join(root, 'producto.html'), 'utf8')).querySelectorAll('script:not([src]):not([type])').length);
    expect(document.querySelector('#pName')?.textContent).toBe(hostile);
    const schema = JSON.parse(document.querySelector('#cronox-seo')!.textContent!);
    expect(schema.name).toBe(hostile);
    expect(schema.image).toEqual(['https://cronox.es/safe.png']);
    expect(JSON.stringify(schema)).not.toMatch(/searchKeywords|searchText|costPrice|customer|password/);
  });

  it('starts with the existing optimized PDP image and real dimensions, with a safe fallback', async () => {
    const primary = { ...product.images[0], width: 3916, height: 5221,
      variants: { pdp: { url: '/pdp.webp', width: 2550, height: 3400 } } };
    const source = { ...catalog, product: async () => ({ ...product, images: [primary] }) };
    const document = doc((await request(app(source)).get('/producto/camiseta-prueba')).text);
    expect(document.querySelector('#pImage')?.getAttribute('src')).toBe('https://cronox.es/pdp.webp');
    expect(document.querySelector('#pImage')?.getAttribute('srcset')).toBe('https://cronox.es/pdp.webp 2550w');
    expect(document.querySelector('#pImage')?.getAttribute('width')).toBe('2550');
    expect(document.querySelector('#pImage')?.getAttribute('height')).toBe('3400');
    primary.variants.pdp.url = 'javascript:alert(1)';
    const fallback = doc((await request(app(source)).get('/producto/camiseta-prueba')).text);
    expect(fallback.querySelector('#pImage')?.getAttribute('src')).toBe('https://cronox.es/photo.png');
    expect(fallback.querySelector('#pImage')?.getAttribute('srcset')).toBeNull();
  });
});
