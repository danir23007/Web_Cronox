// Read-only fixture viewer. No credentials, database or business writes.
'use strict';
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '../../cronox-front');
const fixture = path.resolve(__dirname, '../../output/playwright/user-identity/fixture.json');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' };
http.createServer((req, res) => {
  if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/__fixture') { res.setHeader('Content-Type', 'application/json'); res.end(fs.readFileSync(fixture)); return; }
  if (url.pathname === '/__qr') { res.setHeader('Content-Type', 'image/png'); res.end(fs.readFileSync(path.join(path.dirname(fixture), 'qr-fixture.png'))); return; }
  if (url.pathname.startsWith('/api/')) { res.writeHead(501); res.end(); return; }
  const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (error, bytes) => {
    if (error) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream'); res.setHeader('Cache-Control', 'no-store'); res.end(bytes);
  });
}).listen(43130, '127.0.0.1', () => console.log('Read-only user review: http://127.0.0.1:43130'));
