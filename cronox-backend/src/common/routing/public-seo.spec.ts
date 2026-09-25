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
  type SeoCatalog,
  type SeoProduct,
} from './public-seo';
import { legacyRedirectTarget } from './public-pages';
import { createContentSecurityPolicy } from '../config/content-security-policy';

const root = join(__dirname, '../../../../cronox-front');
const product: SeoProduct = {
  id: 10,
  slug: 'camiseta-prueba',
  name: 'Camiseta de prueba',
  description: 'Algodón. Corte amplio.',
  price: 4000,
  currency: 'EUR',
  isActive: true,
  imageUrl: null,
  images: [{ url: 'https://cronox.es/photo.png', alt: 'Camiseta' }],
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
      expect.objectContaining({ name: 'Cronox', url: 'https://cronox.es/' }),
    ]);
    expect(
      document.querySelector('#productsGrid a')?.getAttribute('href'),
    ).toBe('/producto/camiseta-prueba');
    expect(result.text).not.toContain('Próximamente');
    expect(result.headers.link).toBe('<https://cronox.es/>; rel="canonical"');
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
    expect(document.title).toBe('Camiseta de prueba | Cronox');
    expect(document.querySelector('#pName')?.textContent).toBe(product.name);
    expect(document.querySelector('#pPrice')?.textContent).toContain('45,00');
    expect(document.querySelector('#pDesc')?.textContent).toBe(
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
});
