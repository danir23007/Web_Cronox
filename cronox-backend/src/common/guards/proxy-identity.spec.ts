import express from 'express';
import request from 'supertest';

describe('IP trust boundary used by the existing throttler', () => {
  const app = (hops: number) => {
    const server = express();
    server.set('trust proxy', hops);
    server.get('/', (req, res) => res.json({ ip: req.ip }));
    return server;
  };
  it('ignores forwarded headers when the peer is not trusted', async () => {
    const normal = await request(app(0)).get('/');
    const forged = await request(app(0)).get('/').set('X-Forwarded-For', '203.0.113.99');
    expect(forged.body.ip).toBe(normal.body.ip);
  });
  it('uses the last forwarded peer behind exactly one trusted proxy', async () => {
    const response = await request(app(1)).get('/').set('X-Forwarded-For', '203.0.113.99, 198.51.100.7');
    expect(response.body.ip).toBe('198.51.100.7');
  });
  it('demonstrates why hop trust requires an inaccessible origin and sanitized headers', async () => {
    const response = await request(app(1)).get('/').set('X-Forwarded-For', '203.0.113.99');
    expect(response.body.ip).toBe('203.0.113.99');
  });
});
