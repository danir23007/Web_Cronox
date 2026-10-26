import http from 'node:http';
import express from 'express';
import { requestNetwork } from './app-throttler.guard';

describe('published Nginx loopback contract over real HTTP', () => {
  it('published req.ip groups clients, pending tracker separates them and ignores forged headers', async () => {
    const app = express(); app.set('trust proxy', 0);
    app.post('/', (req, res) => res.json({ published: req.ip, pending: requestNetwork(req) }));
    const backend = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => backend.once('listening', resolve));
    const backendPort = (backend.address() as any).port;
    const proxy = http.createServer((req, res) => {
      const upstream = http.request({ hostname: '127.0.0.1', port: backendPort, path: '/', method: req.method,
        headers: { ...req.headers, 'x-real-ip': req.socket.remoteAddress!, 'x-forwarded-for': [req.headers['x-forwarded-for'], req.socket.remoteAddress].filter(Boolean).join(', ') } }, response => {
          res.writeHead(response.statusCode!, response.headers); response.pipe(res);
        });
      req.pipe(upstream);
    }).listen(0, '127.0.0.1');
    await new Promise<void>(resolve => proxy.once('listening', resolve));
    const call = (address: string) => new Promise<any>((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: (proxy.address() as any).port, localAddress: address, path: '/', method: 'POST', headers: { 'x-real-ip': '203.0.113.99', 'x-forwarded-for': '203.0.113.88' } }, response => {
        let body = ''; response.on('data', chunk => { body += chunk; }); response.on('end', () => resolve(JSON.parse(body)));
      }); req.on('error',reject); req.end();
    });
    try {
      const [first, second] = await Promise.all([call('127.0.0.2'), call('127.0.0.3')]);
      expect(first.published).toBe(second.published);
      expect(first.pending).toBe('127.0.0.2'); expect(second.pending).toBe('127.0.0.3');
    } finally {
      await Promise.all([backend,proxy].map(server => new Promise<void>(resolve => server.close(() => resolve()))));
    }
  });
});
