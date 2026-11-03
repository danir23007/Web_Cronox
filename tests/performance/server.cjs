// Isolated production-template preview. Public GET snapshots only; no accounts,
// database, payments, analytics writes or environment secrets are used.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const express = require('../../cronox-backend/node_modules/express');
const out = path.resolve(__dirname, '../../output/performance-20261103');
const label = process.env.PERF_VERSION || 'before';
const root = label === 'before' ? path.join(out, 'before/cronox-front') : path.resolve(__dirname, '../../cronox-front');
const { createSeoPages, seoRequestSignals } = require('../../cronox-backend/dist/common/routing/public-seo');
const app = express();
fs.mkdirSync(path.join(out, 'cache'), { recursive: true });
const cached = async url => {
  const key = crypto.createHash('sha256').update(url).digest('hex');
  const base = path.join(out, 'cache', key);
  if (!fs.existsSync(base + '.json')) {
    const response = await fetch(url);
    const bytes = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(base, bytes);
    fs.writeFileSync(base + '.json', JSON.stringify({ url, status: response.status, headers: Object.fromEntries(response.headers) }));
  }
  return { ...JSON.parse(fs.readFileSync(base + '.json')), bytes: fs.readFileSync(base) };
};
const rewrite = value => typeof value === 'string' ? value.replace(/https:\/\/[a-z0-9.-]+\.supabase\.co\/storage\/v1\/object\/public\/[^\s"<>]+/g, url => '/__media/' + Buffer.from(url).toString('base64url')) : value;
app.use((req, res, next) => {
  // Session boundaries are local simulations, never forwarded to the store.
  if (req.method === 'POST' && req.path === '/api/auth/refresh') return res.status(401).json({ message: 'No active session' });
  if (req.method === 'POST' && req.path === '/api/auth/logout') return res.json({ ok: true });
  if (!['GET', 'HEAD'].includes(req.method)) return res.status(405).end();
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const send = res.send.bind(res);
  res.send = body => {
    if (typeof body === 'string') {
      body = rewrite(body).replace('<html lang="es">', '<html lang="es" data-cronox-api-base="http://127.0.0.1:4186">');
      if (req.query['perf-priority'] === 'high') body = body.replace('class="preloader__logo"', 'class="preloader__logo" fetchpriority="high"');
    }
    if (process.env.PERF_GZIP === '1' && (typeof body === 'string' || Buffer.isBuffer(body)) && /gzip/.test(req.headers['accept-encoding'] || '') && !res.getHeader('Content-Encoding')) {
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Vary', 'Accept-Encoding');
      body = zlib.gzipSync(body);
    }
    return send(body);
  };
  next();
});
app.get('/__media/:key', async (req, res) => {
  try {
    const url = Buffer.from(req.params.key, 'base64url').toString();
    if (!/^https:\/\/[a-z0-9.-]+\.supabase\.co\/storage\/v1\/object\/public\//.test(url)) return res.status(400).end();
    const data = await cached(url);
    res.status(data.status).type(data.headers['content-type'] || 'application/octet-stream');
    res.setHeader('Cache-Control', data.headers['cache-control'] || 'public, max-age=0');
    res.end(data.bytes);
  } catch (e) { res.status(502).send(e.message); }
});
app.use('/api', async (req, res) => {
  const endpoint = '/api' + req.path;
  if (endpoint === '/api/auth/csrf') return res.json({ csrfToken: 'isolated-performance-token' });
  if (endpoint === '/api/favorites') return res.json([]);
  if (endpoint === '/api/cart') return res.json({ items: [], itemsCount: 0, subtotalCents: 0 });
  if (!/^\/api\/(products|categories|gallery|footer|media-framing|key-screen|newsletter\/(settings|config)|shipping)(\/|$)/.test(endpoint)) return res.status(401).json({});
  try {
    const data = await cached('https://cronox.es' + endpoint + (['/api/products', '/api/categories'].includes(endpoint) ? '?limit=100' : ''));
    res.status(data.status).type('json').send(data.bytes.toString());
  } catch (e) { res.status(502).json({ error: e.message }); }
});
const catalog = {
  product: async ({ slug, id }) => {
    const data = await cached('https://cronox.es/api/products?limit=100');
    return JSON.parse(data.bytes).items.find(p => p.slug === slug || p.id === id) || null;
  },
  links: async () => JSON.parse((await cached('https://cronox.es/api/products?limit=100')).bytes).items,
};
app.use(seoRequestSignals);
app.use(createSeoPages(root, catalog));
app.use((req, res, next) => {
  const target = path.resolve(root, '.' + req.path);
  if (!target.startsWith(root + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) return next();
  res.type(path.extname(target));
  res.setHeader('Cache-Control', /\.woff2$/.test(target) ? 'public, max-age=31536000, immutable' : 'public, max-age=0');
  res.send(fs.readFileSync(target));
});
app.listen(4186, '127.0.0.1', () => console.log(`Performance ${label}: http://127.0.0.1:4186`));
