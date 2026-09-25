import type { RequestHandler } from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import type { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { variantSizeLabel } from '../../products/product-size-system';
import {
  canonicalPathForRequest,
  cleanPageForPath,
  legacyRedirectTarget,
  normalizePublicPath,
  PUBLIC_SITE_URL,
  robotsText,
  prelaunchSitemapXml,
} from './public-pages';

export const HOME_TITLE = 'Cronox — Ropa y tienda oficial';
export const HOME_DESCRIPTION =
  'Descubre la ropa de Cronox en su tienda oficial. Explora las prendas de la colección, consulta las tallas disponibles y compra online.';
// A single inventory controls metadata and sitemap eligibility. Utility pages
// deliberately remain crawlable so crawlers can read their noindex response.
export const PUBLIC_METADATA: Record<string, [string, string]> = {
  '/': [HOME_TITLE, HOME_DESCRIPTION],
  '/galeria': [
    'Galería de la comunidad | Cronox',
    'Explora la galería visual de Cronox: prendas, imágenes y comunidad.',
  ],
  '/privacidad': [
    'Política de privacidad | Cronox',
    'Consulta cómo Cronox trata tus datos personales y cómo ejercer tus derechos de privacidad.',
  ],
  '/aviso-legal': [
    'Aviso legal | Cronox',
    'Información legal y condiciones de uso de la tienda online de Cronox.',
  ],
  '/cookies': [
    'Política de cookies | Cronox',
    'Información sobre las cookies utilizadas en la web de Cronox y tus opciones de consentimiento.',
  ],
  '/terminos': [
    'Condiciones de compra | Cronox',
    'Consulta las condiciones de compra de la tienda online de Cronox.',
  ],
  '/envios': [
    'Envíos | Cronox',
    'Consulta las condiciones y la información sobre los envíos de tus compras en Cronox.',
  ],
  '/devoluciones': [
    'Cambios y devoluciones | Cronox',
    'Consulta las condiciones y los pasos para gestionar cambios y devoluciones de tus compras en Cronox.',
  ],
  '/faqs': [
    'Preguntas frecuentes | Cronox',
    'Resuelve tus dudas sobre compras, tallas, envíos y devoluciones en la tienda de Cronox.',
  ],
  '/desarrolla': [
    'Colabora con Cronox',
    'Contacta con Cronox para proponer colaboraciones, proyectos y nuevas ideas.',
  ],
};

const productSelect = {
  id: true,
  slug: true,
  name: true,
  description: true,
  price: true,
  currency: true,
  imageUrl: true,
  isActive: true,
  images: {
    where: { isActive: true },
    orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }],
    select: { url: true, alt: true },
  },
  variants: {
    where: { isActive: true },
    orderBy: { id: 'asc' },
    select: { id: true, size: true, sku: true, price: true, stockQty: true },
  },
} satisfies Prisma.ProductSelect;
export type SeoProduct = Prisma.ProductGetPayload<{
  select: typeof productSelect;
}>;
export type CatalogLink = { id: number; slug: string; name: string };
export interface SeoCatalog {
  product(key: { slug: string } | { id: number }): Promise<SeoProduct | null>;
  links(): Promise<CatalogLink[]>;
}
export function createSeoCatalog(prisma: PrismaService): SeoCatalog {
  return {
    product: (key) =>
      prisma.product.findUnique({
        where: { ...key, isActive: true },
        select: productSelect,
      }),
    async links() {
      const links: CatalogLink[] = [];
      let cursor = 0;
      for (;;) {
        const batch = await prisma.product.findMany({
          where: { isActive: true, id: { gt: cursor } },
          orderBy: { id: 'asc' },
          take: 500,
          select: { id: true, slug: true, name: true },
        });
        links.push(...batch);
        // Do not silently truncate a sitemap if the catalogue outgrows one file.
        if (links.length > 49000)
          throw new Error('Sitemap requires partitioning');
        if (batch.length < 500) return links;
        cursor = batch[batch.length - 1].id;
      }
    },
  };
}

export const escapeHtml = (value: unknown): string =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
const json = (value: unknown): string =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
const absolute = (path: string): string => new URL(path, PUBLIC_SITE_URL).href;
const productPath = (slug: string): string =>
  `/producto/${encodeURIComponent(slug)}`;
const plain = (value: string): string =>
  value
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const imageUrl = (value: string | null): string | undefined => {
  if (!value) return undefined;
  try {
    const url = new URL(value, PUBLIC_SITE_URL);
    return url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
};
export function productSchema(product: SeoProduct) {
  const url = absolute(productPath(product.slug));
  const images = [
    ...new Set(product.images.map((i) => imageUrl(i.url)).filter(Boolean)),
  ];
  if (!images.length && imageUrl(product.imageUrl))
    images.push(imageUrl(product.imageUrl));
  const common = {
    name: product.name,
    description: plain(product.description || product.name),
    image: images,
    brand: { '@type': 'Brand', name: 'Cronox' },
  };
  // No ratings, review counts, sale prices or business details are invented.
  // Without a real image or active variant, omit rich-result markup entirely.
  if (!images.length || !product.variants.length) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'ProductGroup',
    '@id': `${url}#product`,
    url,
    ...common,
    productGroupID: String(product.id),
    variesBy: ['https://schema.org/size'],
    hasVariant: product.variants.map((variant) => {
      const variantUrl = `${url}?size=${encodeURIComponent(variant.size)}`;
      return {
        '@type': 'Product',
        ...common,
        name: `${product.name} — ${variantSizeLabel(variant.size)}`,
        sku: variant.sku,
        size: variantSizeLabel(variant.size),
        url: variantUrl,
        offers: {
          '@type': 'Offer',
          url: variantUrl,
          priceCurrency: product.currency,
          price: ((variant.price ?? product.price) / 100).toFixed(2),
          availability: `https://schema.org/${variant.stockQty > 0 ? 'InStock' : 'OutOfStock'}`,
        },
      };
    }),
  };
}

export function sitemapXml(links: CatalogLink[]): string {
  const urls = [
    ...Object.keys(PUBLIC_METADATA),
    ...links.map((p) => productPath(p.slug)),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...new Set(urls)].map((path) => `<url><loc>${escapeHtml(absolute(path))}</loc></url>`).join('\n')}\n</urlset>\n`;
}

const isUtility = (path: string): boolean =>
  /^(?:\/admin(?:[/.\-]|$)|\/docs(?:\/|$)|\/api(?:\/|$))/.test(path) ||
  [
    '/cuenta',
    '/favoritos',
    '/cesta',
    '/checkout',
    '/checkout/exito',
    '/recuperar-contrasena',
    '/restablecer-contrasena',
    '/auth-modal.html',
    '/launch.html',
    '/eventos',
  ].includes(path);

export const seoRequestSignals: RequestHandler = (req, res, next) => {
  if (!['GET', 'HEAD'].includes(req.method)) return next();
  const path = normalizePublicPath(req.path);
  const legacy = legacyRedirectTarget(path, req.originalUrl);
  const effective = legacy?.split('?')[0] || path;
  if (isUtility(effective)) res.setHeader('X-Robots-Tag', 'noindex, follow');
  // Do not move API requests, admin sessions or checkout across cookie origins.
  const canonicalSurface =
    !isUtility(effective) &&
    (Boolean(cleanPageForPath(effective)) ||
      ['/robots.txt', '/sitemap.xml'].includes(path));
  // HTTP->HTTPS already belongs to the production edge (verified 301). Do not
  // infer TLS from req.protocol here: an untrusted TLS-terminating proxy would loop.
  if (canonicalSurface && req.hostname === 'www.cronox.es') {
    return res.redirect(
      308,
      `${PUBLIC_SITE_URL.slice(0, -1)}${req.originalUrl}`,
    );
  }
  next();
};

export function createSeoDiscovery(
  catalog: SeoCatalog,
  gated: () => Promise<boolean>,
): RequestHandler {
  return async (req, res, next) => {
    const path = normalizePublicPath(req.path);
    if (
      !['GET', 'HEAD'].includes(req.method) ||
      !['/robots.txt', '/sitemap.xml'].includes(path)
    )
      return next();
    if (path !== req.path) return res.redirect(308, path);
    res.setHeader('Cache-Control', 'no-store');
    try {
      const enabled = await gated();
      if (req.path === '/robots.txt')
        return res.type('text/plain').send(robotsText(enabled));
      return res
        .type('application/xml')
        .send(
          enabled ? prelaunchSitemapXml() : sitemapXml(await catalog.links()),
        );
    } catch {
      // An unavailable catalogue is not an empty shop or a permanent 404.
      return res
        .status(503)
        .set('Retry-After', '60')
        .send('Temporalmente no disponible');
    }
  };
}

type Metadata = {
  title: string;
  description: string;
  canonical: string;
  noindex?: boolean;
  schema?: unknown;
  image?: string;
};
export function renderSeoHead(
  html: string,
  metadata: Metadata,
): { html: string; schemaText?: string } {
  // Own all SEO tags in one place; do not accumulate conflicting client/server nodes.
  html = html
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, '')
    .replace(
      /<meta\b[^>]*(?:name\s*=\s*["'](?:description|robots|twitter:[^"']+)["']|property\s*=\s*["']og:[^"']+["'])[^>]*>/gi,
      '',
    )
    .replace(/<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*>/gi, '')
    .replace(
      /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi,
      '',
    );
  const e = escapeHtml;
  const schemaText = metadata.schema ? json(metadata.schema) : undefined;
  const head = `<title>${e(metadata.title)}</title>
<meta name="description" content="${e(metadata.description)}">
<meta name="robots" content="${metadata.noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large'}">
<link rel="canonical" href="${e(metadata.canonical)}">
<meta property="og:site_name" content="Cronox">
<meta property="og:locale" content="es_ES">
<meta property="og:type" content="website">
<meta property="og:title" content="${e(metadata.title)}">
<meta property="og:description" content="${e(metadata.description)}">
<meta property="og:url" content="${e(metadata.canonical)}">
${metadata.image ? `<meta property="og:image" content="${e(metadata.image)}">` : ''}
<meta name="twitter:card" content="${metadata.image ? 'summary_large_image' : 'summary'}">
${schemaText ? `<script id="cronox-seo" type="application/ld+json">${schemaText}</script>` : ''}
<meta name="cronox-seo" content="server">
`;
  return { html: html.replace('</head>', `${head}</head>`), schemaText };
}

export function createSeoPages(
  frontendRoot: string,
  catalog: SeoCatalog,
): RequestHandler {
  const templates = new Map<string, string>();
  const template = (file: string) => {
    if (!templates.has(file))
      templates.set(file, readFileSync(join(frontendRoot, file), 'utf8'));
    return templates.get(file)!;
  };
  return async (req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method)) return next();
    const path = normalizePublicPath(req.path);
    const file = cleanPageForPath(path);
    if (!file) return next();
    const query = new URL(req.originalUrl, PUBLIC_SITE_URL).searchParams;
    if (req.path !== path)
      return res.redirect(308, `${path}${query.size ? `?${query}` : ''}`);
    try {
      let html = template(file);
      let status = 200;
      const canonical = absolute(canonicalPathForRequest(path));
      const details = PUBLIC_METADATA[canonicalPathForRequest(path)];
      const filtered =
        (path === '/' || path === '/tienda') &&
        [
          'search',
          'q',
          'categorySlug',
          'size',
          'minPrice',
          'maxPrice',
          'sortBy',
          'order',
          'page',
          'login',
        ].some((key) => query.has(key));
      const metadata: Metadata = {
        title: details?.[0] || 'Cronox',
        description: details?.[1] || 'Tienda oficial de Cronox.',
        canonical,
        noindex:
          !details ||
          filtered ||
          String(res.getHeader('X-Robots-Tag') || '').includes('noindex'),
      };
      if (!details) {
        metadata.title =
          html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || 'Cronox';
        metadata.description =
          'Página de servicio de la tienda oficial de Cronox.';
      }
      if (path === '/' || path === '/tienda') {
        metadata.schema = {
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'WebSite',
              '@id': `${PUBLIC_SITE_URL}#website`,
              name: 'Cronox',
              url: PUBLIC_SITE_URL,
              inLanguage: 'es',
            },
            {
              '@type': 'Organization',
              '@id': `${PUBLIC_SITE_URL}#organization`,
              name: 'Cronox',
              url: PUBLIC_SITE_URL,
            },
          ],
        };
        // Real links in initial HTML, progressively replaced by the existing card renderer.
        if (!filtered) {
          const links = await catalog.links();
          html = html.replace(
            '<div id="productsGrid" class="products-grid"></div>',
            `<div id="productsGrid" class="products-grid">${links.map((p) => `<a href="${escapeHtml(productPath(p.slug))}">${escapeHtml(p.name)}</a>`).join('\n')}</div>`,
          );
        }
      }
      if (file === 'producto.html') {
        let key: { slug: string } | { id: number } | undefined;
        if (path.startsWith('/producto/')) {
          try {
            key = { slug: decodeURIComponent(path.slice('/producto/'.length)) };
          } catch {
            /* malformed slug => real 404 */
          }
        } else if (query.get('slug')) key = { slug: query.get('slug')! };
        else if (
          /^[1-9]\d*$/.test(query.get('id') || '') &&
          Number.isSafeInteger(Number(query.get('id'))) &&
          Number(query.get('id')) <= 2147483647
        )
          key = { id: Number(query.get('id')) };
        const product = key ? await catalog.product(key) : null;
        if (!product || !product.isActive) {
          status = 404;
          metadata.noindex = true;
          metadata.title = 'Producto no disponible | Cronox';
          metadata.description = 'Este producto no está disponible en Cronox.';
          html = html.replace(
            '<h1 id="pName" class="pdp__name"></h1>',
            '<h1 id="pName" class="pdp__name">Producto no disponible</h1>',
          );
        } else {
          const target = productPath(product.slug);
          if (path !== target) {
            query.delete('id');
            query.delete('slug');
            return res.redirect(
              308,
              `${target}${query.size ? `?${query}` : ''}`,
            );
          }
          metadata.canonical = absolute(target);
          metadata.noindex = false;
          metadata.title = `${product.name} | Cronox`;
          metadata.description =
            `${product.name}. ${plain(product.description || 'Consulta esta prenda, sus tallas y disponibilidad en la tienda oficial de Cronox.')}`.slice(
              0,
              165,
            );
          metadata.schema = productSchema(product);
          metadata.image = imageUrl(product.images[0]?.url || product.imageUrl);
          const selected = product.variants.find(
            (v) => v.size === query.get('size')?.toUpperCase(),
          );
          const price = (
            (selected?.price ?? product.price) / 100
          ).toLocaleString('es-ES', {
            style: 'currency',
            currency: product.currency,
          });
          html = html
            .replace(
              '<h1 id="pName" class="pdp__name"></h1>',
              `<h1 id="pName" class="pdp__name">${escapeHtml(product.name)}</h1>`,
            )
            .replace(
              '<p id="pPrice" class="pdp__price"></p>',
              `<p id="pPrice" class="pdp__price">${escapeHtml(price)}</p>`,
            )
            .replace(
              '<p id="pDesc" class="pdp__desc"></p>',
              `<p id="pDesc" class="pdp__desc">${escapeHtml(product.description)}</p>`,
            );
          if (metadata.image)
            html = html
              .replace(
                'id="pImage"',
                `id="pImage" src="${escapeHtml(metadata.image)}"`,
              )
              .replace(
                'class="pdp__media-img is-active" alt=""',
                `class="pdp__media-img is-active" alt="${escapeHtml(product.images[0]?.alt || product.name)}"`,
              );
        }
      }
      const rendered = renderSeoHead(html, metadata);
      // Hash only this inert JSON-LD block, keeping the executable-script policy unchanged.
      const csp = res.getHeader('Content-Security-Policy');
      if (rendered.schemaText && typeof csp === 'string') {
        const hash = createHash('sha256')
          .update(rendered.schemaText)
          .digest('base64');
        res.setHeader(
          'Content-Security-Policy',
          csp.replace(
            "script-src 'self'",
            `script-src 'self' 'sha256-${hash}'`,
          ),
        );
      }
      res.setHeader('Link', `<${metadata.canonical}>; rel="canonical"`);
      if (metadata.noindex) res.setHeader('X-Robots-Tag', 'noindex, follow');
      // Preserve the gate's private admin-preview headers. Never cache a price snapshot at the CDN.
      if (!res.hasHeader('Cache-Control'))
        res.setHeader('Cache-Control', 'no-store');
      return res.status(status).type('html').send(rendered.html);
    } catch {
      return res
        .status(503)
        .set('Retry-After', '60')
        .set('Cache-Control', 'no-store')
        .send('Temporalmente no disponible');
    }
  };
}
