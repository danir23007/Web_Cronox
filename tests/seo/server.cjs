// Isolated HTTP application: real SEO middleware/templates, synthetic catalogue,
// no Nest bootstrap, .env loading, Prisma connection, payments or outgoing writes.
const express = require('../../cronox-backend/node_modules/express');
const path = require('node:path');
const { createSeoPages, createSeoDiscovery, seoRequestSignals } = require('../../cronox-backend/dist/common/routing/public-seo');
const { legacyRedirectTarget } = require('../../cronox-backend/dist/common/routing/public-pages');
const { createContentSecurityPolicy } = require('../../cronox-backend/dist/common/config/content-security-policy');
const root = path.resolve(__dirname, '../../cronox-front');
const product = {
  id: 901, slug: 'seo-test-shirt', name: 'Camiseta de prueba SEO', description: 'Camiseta de algodón.\nPrueba local, no disponible para venta.',
  price: 4000, currency: 'EUR', isActive: true, imageUrl: '/assets/product-image-unavailable.svg',
  images: [{ url: '/assets/product-image-unavailable.svg', alt: 'Prueba', isActive: true, isPrimary: true }],
  variants: [
    { id: 9001, size: 'S', sku: 'SEO-S', price: null, effectivePrice: 4000, stockQty: 2, isActive: true },
    { id: 9002, size: 'M', sku: 'SEO-M', price: 4500, effectivePrice: 4500, stockQty: 0, isActive: true },
  ],
};
const catalog = { product: async key => key.slug === product.slug || key.id === product.id ? product : null, links: async () => [product] };
const app = express();
app.use((_req, res, next) => { res.setHeader('Content-Security-Policy', createContentSecurityPolicy(root)); next(); });
app.use(seoRequestSignals);
app.use(createSeoDiscovery(catalog, async () => false));
app.use((req, res, next) => {
  const target = legacyRedirectTarget(req.path, req.originalUrl);
  return target ? res.redirect(308, target) : next();
});
app.use(createSeoPages(root, catalog));
app.get('/api/products', (_req, res) => res.json({ items: [product], meta: { total: 1, pageCount: 1 } }));
app.get('/api/products/:slug', (req, res) => res.json(req.params.slug === product.slug ? product : null));
app.get('/api/key-screen', (_req, res) => res.json({ enabled: false }));
app.get('/api/cart', (_req, res) => res.json({ items: [], itemsCount: 0, subtotal: 0 }));
app.use('/api', (_req, res) => res.status(401).json({}));
app.use(express.static(path.join(root, 'public')));
app.use(express.static(root));
app.listen(4177, '127.0.0.1');
