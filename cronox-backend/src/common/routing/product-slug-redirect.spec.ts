import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { productSlugRedirect } from './product-slug-redirect';

const app = express();
app.use(cookieParser());
app.use(productSlugRedirect);
app.use((_req, res) => res.sendStatus(204));

describe('permanent public product URL', () => {
  it.each(['get', 'head'] as const)('redirects %s without JavaScript, a chain or losing the size', async method => {
    for (const path of ['/producto/shielded-coal', '/producto/shielded-coal/', '/producto/%73hielded-coal', '/producto.html?slug=shielded-coal', '/producto?slug=shielded-coal', '/reset-password/producto.html?slug=shielded-coal']) {
      const url = `${path}${path.includes('?') ? '&' : '?'}size=M&utm_source=test`;
      const response = await request(app)[method](url);
      expect(response.status).toBe(301);
      expect(response.headers.location).toBe('/producto/armored-coal?size=M&utm_source=test');
      expect((await request(app)[method](response.headers.location)).status).toBe(204);
    }
  });
  it('canonicalizes www in the same hop while preserving existing host-only sessions', async () => {
    const response = await request(app).get('/producto/shielded-coal').set('Host', 'www.cronox.es');
    expect(response.status).toBe(301);
    expect(response.headers.location).toBe('https://cronox.es/producto/armored-coal');
    const cart = await request(app).get('/producto/shielded-coal').set('Host', 'www.cronox.es').set('Cookie', 'cartId=historical');
    expect(cart.headers.location).toBe('/producto/armored-coal');
    expect(cart.headers.vary).toContain('Cookie');
  });
  it.each(['/producto/armored-coal', '/producto/another', '/api/products/shielded-coal', '/producto/shielded-coal/extra', '/producto/%E0%A4%A'])('leaves other surfaces alone: %s', async path => {
    expect((await request(app).get(path)).status).toBe(204);
  });
  it('does not redirect mutations', async () => {
    expect((await request(app).post('/producto/shielded-coal')).status).toBe(204);
  });
});
