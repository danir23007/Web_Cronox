// Isolated public UI fixture server. No production API, credentials or writes.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const QRCode = require('../../cronox-backend/node_modules/qrcode');
const root = path.resolve(__dirname, '../../cronox-front');
const product = { id: 1, slug: 'compat-shirt', name: 'CRONOX COMPAT', price: 3500, description: 'Prenda de prueba local.', category: { id: 1, slug: 'camisetas', name: 'Camisetas' }, imageUrl: '/assets/products/camiseta_washed_negra.png', images: [{ url: '/assets/products/camiseta_washed_negra.png', isPrimary: true }], variants: [{ id: 1, size: 'M', stock: 10, stockQty: 10, isActive: true }] };
const cart = { id: 1, itemsCount: 1, subtotal: 3500, items: [{ id: 1, variantId: 1, qty: 1, priceAtAdd: 3500, variant: { ...product.variants[0], product } }] };
const shipping = { code: 'STANDARD', label: 'Envío estándar', amountCents: 490, priceCents: 490 };
const totals = { subtotalCents: 3500, shippingCents: 490, discountCents: 0, totalCents: 3990 };
const token = 'CRX:1:local-compatibility-fixture-not-a-credential';
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const routes = { '/': 'index.html', '/tienda': 'index.html', '/producto/compat-shirt': 'producto.html', '/cesta': 'cart.html', '/checkout': 'checkout.html', '/cuenta': 'profile.html', '/sobre-cronox': 'sobre-cronox.html', '/favoritos': 'favorites.html', '/privacidad': 'privacy-policy.html' };
QRCode.toDataURL(token, { width: 592, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#49212c', light: '#e9d8c4' } }).then(qrDataUrl => {
 http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost'), p = url.pathname;
  const json = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  const signedIn = /compat-auth=1/.test(req.headers.cookie || '');
  if (p.startsWith('/api/')) {
   if (p === '/api/me') return json(signedIn ? { id: 7, firstName: 'Persona', lastName: 'Prueba', email: 'compat@example.test', role: 'USER', memberCode: 'CRX-000050', circleLevel: 3, createdAt: '2020-01-01T12:00:00Z' } : {}, signedIn ? 200 : 401);
   if (p.includes('/auth/refresh')) return json({}, 401);
   if (p === '/api/auth/csrf') return json({ csrfToken: 'local-fixture' });
   if (p === '/api/products') return json({ items: [product], meta: { total: 1 } });
   if (p.startsWith('/api/products/')) return json(product);
   if (p === '/api/categories') return json({ items: [product.category] });
   if (p === '/api/cart') return json(cart);
   if (p === '/api/checkout/summary') return json({ cart, totals, shippingMethods: [shipping], selectedShippingMethod: shipping });
   if (p === '/api/accreditations/active') return json({ id: 'metacrilatos', renderer: 'metacrilatos-v1', config: { version: 1 } });
   if (p === '/api/membership/me/accreditation') return json({ circleLevel: 3, name: 'Persona Prueba', createdAt: '2020-01-01T12:00:00Z', memberCode: 'CRX-000050', qrDataUrl });
   if (p === '/api/membership/me/qr') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(Buffer.from(qrDataUrl.split(',')[1], 'base64')); }
   if (p === '/api/membership/me/stats') return json({ circleLevel: 3, createdAt: '2020-01-01T12:00:00Z' });
   if (p.includes('circle-upgrade')) return json({ circleLevel: 3, hasPending: false, canRequest: false });
   if (p === '/api/me/address' || p.includes('/addresses')) return json(null);
   if (p === '/api/me/orders' || p === '/api/favorites') return json([]);
   if (req.method !== 'GET' && !p.includes('/presence')) return json({ error: 'Fixture server does not perform writes' }, 405);
   return json({});
  }
  if (p === '/compat-accreditation') {
   res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
   return res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/customer-typography.css?v=4"><style>body{margin:0;background:#080809;color:#fff}#root{max-width:460px;margin:auto}</style></head><body data-cronox-surface="customer"><div id="root"></div><script src="/assets/user-identity.js"></script><script src="/assets/metacrilatos.js"></script><script>window.fixtureData=${JSON.stringify({ circleLevel: 3, name: 'Persona Prueba', createdAt: '2020-01-01', memberCode: 'CRX-000050', qrDataUrl })};window.renderer=CRONOX_METACRILATOS.mount(document.getElementById('root'),fixtureData);</script></body></html>`);
  }
  if (p === '/assets/runtime-config.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end('window.__CRONOX_API_BASE__=location.origin;'); }
  const file = path.resolve(root, routes[p] || '.' + p);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (error, data) => {
   if (error) { res.writeHead(404); return res.end(); }
   res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': p.startsWith('/assets/') ? 'public, max-age=3600' : 'no-store' });
   res.end(data);
  });
 }).listen(Number(process.env.COMPAT_PORT || 4185), '127.0.0.1');
});
