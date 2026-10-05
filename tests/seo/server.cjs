// Isolated HTTP application: real SEO middleware/templates, synthetic catalogue,
// no Nest bootstrap, .env loading, Prisma connection, payments or outgoing writes.
const express = require('../../cronox-backend/node_modules/express');
const path = require('node:path');
const { createSeoPages, createSeoDiscovery, seoRequestSignals } = require('../../cronox-backend/dist/common/routing/public-seo');
const { legacyRedirectTarget } = require('../../cronox-backend/dist/common/routing/public-pages');
const { createContentSecurityPolicy } = require('../../cronox-backend/dist/common/config/content-security-policy');
const { createPublicHtmlGateMiddleware } = require('../../cronox-backend/dist/common/routing/public-html-gate.middleware');
const productionSeo = process.argv.includes('--production-seo');
const gated = process.argv.includes('--gated');
// Test production directives only on loopback, never boot Nest or load .env.
process.env.NODE_ENV = productionSeo ? 'production' : 'test';
const port = Number(process.env.SEO_PREVIEW_PORT || 4177);
const root = path.resolve(__dirname, '../../cronox-front');
const syntheticProduct = {
  id: 901, slug: 'seo-test-shirt', name: 'Camiseta de prueba SEO', description: 'Camiseta de algodón.\nPrueba local, no disponible para venta.',
  price: 4000, currency: 'EUR', isActive: true, imageUrl: '/assets/product-image-unavailable.svg',
  images: [{ url: '/assets/product-image-unavailable.svg', alt: 'Prueba', isActive: true, isPrimary: true }],
  variants: [
    { id: 9001, size: 'S', sku: 'SEO-S', price: null, effectivePrice: 4000, stockQty: 2, isActive: true },
    { id: 9002, size: 'M', sku: 'SEO-M', price: 4500, effectivePrice: 4500, stockQty: 0, isActive: true },
  ],
};
// Optional read-only public snapshot for visual inspection, never a live API/DB.
const product = process.env.SEO_PRODUCT_FIXTURE
  ? JSON.parse(require('node:fs').readFileSync(process.env.SEO_PRODUCT_FIXTURE, 'utf8'))
  : syntheticProduct;
const catalog = { product: async key => key.slug === product.slug || key.id === product.id ? product : null, links: async () => [product] };
const app = express();
app.use((req, res, next) => {
  if (!['GET', 'HEAD'].includes(req.method)) return res.status(405).json({ message: 'Read-only isolated SEO preview' });
  if (!productionSeo) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (req.path === '/robots.txt') return res.type('text').send('User-agent: *\nDisallow: /\n');
  }
  res.setHeader('Content-Security-Policy', createContentSecurityPolicy(root));
  // The API client supports this explicit base; manual preview needs no console setup.
  const send = res.send.bind(res);
  res.send = body => send(typeof body === 'string' ? body.replace('<html lang="es">', `<html lang="es" data-cronox-api-base="http://127.0.0.1:${port}">`) : body);
  next();
});
app.use(seoRequestSignals);
app.use(createSeoDiscovery(catalog, async () => gated));
app.use(createPublicHtmlGateMiddleware({ frontendRoot: root, keyScreen: { shouldGatePublicHtml: async () => gated }, authService: { hasValidAdminSession: async () => false } }));
app.use((req, res, next) => {
  const target = legacyRedirectTarget(req.path, req.originalUrl);
  return target ? res.redirect(308, target) : next();
});
app.use(createSeoPages(root, catalog));
app.get('/api/products', (_req, res) => res.json({ items: [product], meta: { total: 1, pageCount: 1 } }));
app.get('/api/products/:slug', (req, res) => res.status(req.params.slug === product.slug ? 200 : 404).json(req.params.slug === product.slug ? product : null));
app.get('/api/key-screen', (_req, res) => res.json({ enabled: false }));
app.get('/api/cart', (_req, res) => res.json({ items: [], itemsCount: 0, subtotal: 0 }));
app.get('/api/categories', (_req, res) => res.json({ items: [
  { id: 1, name: 'Camisetas', slug: 'camisetas', group: 'GARMENT', isActive: true, showInStoreFilters: true },
  { id: 2, name: 'Interna de prueba', slug: 'interna-prueba', group: 'UNCLASSIFIED', isActive: true, showInStoreFilters: false },
], meta: { page: 1, limit: 100, total: 2, pageCount: 1 } }));
app.get('/api/footer', (_req, res) => res.json({ instagramUrl: 'https://www.instagram.com/cronox.es/' }));
app.get('/api/gallery', (_req, res) => res.json({ items: [] }));
app.get('/api/media-framing', (_req, res) => res.json({ items: [] }));
app.use('/api', (_req, res) => res.status(401).json({}));
app.use(express.static(path.join(root, 'public')));
app.use(express.static(root));
app.listen(port, '127.0.0.1', () => console.log(`Isolated SEO preview: http://127.0.0.1:${port} (${productionSeo ? 'production SEO' : 'noindex'})`));
