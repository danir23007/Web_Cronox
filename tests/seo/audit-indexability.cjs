// Public, read-only inspection. No environment/credentials or customer APIs.
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('../../cronox-backend/node_modules/jsdom');
const origin = process.env.SEO_AUDIT_ORIGIN || 'https://cronox.es';
async function main() {
  const findings = [];
  const paths = ['/', '/devoluciones', '/envios', '/galeria', '/sobre-cronox', '/producto/shielded-coal', '/producto/armored-coal', '/api/products/armored-coal', '/api/products/shielded-coal', '/api/gallery', '/robots.txt', '/sitemap.xml'];
  for (const pathname of paths) {
    const response = await fetch(origin + pathname, { redirect: 'manual', signal: AbortSignal.timeout(25000) });
    const body = await response.text();
    const record = { pathname, status: response.status, location: response.headers.get('location'), robotsHeader: response.headers.get('x-robots-tag') };
    if (response.headers.get('content-type')?.includes('text/html')) {
      const document = new JSDOM(body).window.document;
      Object.assign(record, {
        title: document.title, description: document.querySelector('meta[name=description]')?.content,
        canonical: document.querySelector('link[rel=canonical]')?.href, robots: document.querySelector('meta[name=robots]')?.content,
        headings: [...document.querySelectorAll('h1')].map(n => n.textContent),
        contentLength: (document.querySelector('main, [data-footer-content]')?.textContent || '').trim().length,
        links: [...document.querySelectorAll('a[href]')].map(n => n.getAttribute('href')),
        images: [...document.images].map(n => ({ src: n.getAttribute('src'), alt: n.alt })),
      });
    } else if (pathname.startsWith('/api/products/')) {
      const p = body ? JSON.parse(body) : null;
      record.product = p && { id: p.id, slug: p.slug, name: p.name, price: p.price, createdAt: p.createdAt, variants: p.variants?.map(v => ({ id: v.id, size: v.size, stockQty: v.stockQty })) };
    } else if (pathname === '/api/gallery') {
      record.gallery = JSON.parse(body);
    } else record.body = body;
    findings.push(record);
  }
  const directory = path.resolve('test-results/indexability');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, origin.startsWith('https:') ? 'live-http.json' : 'local-http.json'), JSON.stringify({ at: new Date().toISOString(), origin, findings }, null, 2));
  console.log(JSON.stringify(findings.map(({ links, images, gallery, body, ...r }) => ({ ...r, links: links?.length, images: images?.length, gallery: gallery && JSON.stringify(gallery).length, body: body?.slice(0, 100) })), null, 2));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
