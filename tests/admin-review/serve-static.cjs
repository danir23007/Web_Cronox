// CRONOX browser fixtures intercept every API request; this serves public assets only.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../cronox-front');
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = path.resolve(root, '.' + pathname);
  if (!['GET', 'HEAD'].includes(req.method) || pathname.startsWith('/api/') || !file.startsWith(root + path.sep) || !types[path.extname(file)]) {
    res.writeHead(404); return res.end();
  }
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', types[path.extname(file)]);
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}).listen(4173, '127.0.0.1', () => console.log('CRONOX static browser review: http://127.0.0.1:4173/admin.html'));
