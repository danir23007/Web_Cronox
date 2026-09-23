// Static storefront only. No backend, environment files or database connection.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../cronox-front');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  // API requests must be intercepted by the tests. Never forward them.
  if (pathname.startsWith('/api/')) { res.writeHead(501); res.end(); return; }
  let file = pathname === '/' || pathname === '/tienda' ? '/index.html' : pathname;
  if (pathname.startsWith('/producto/') || pathname === '/producto') file = '/producto.html';
  if (pathname === '/cart') file = '/cart.html';
  if (pathname.includes('/assets/')) file = pathname.slice(pathname.indexOf('/assets/'));
  const target = path.resolve(root, '.' + file);
  if (!target.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(target, (error, data) => {
    if (error) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(4173, '127.0.0.1');
