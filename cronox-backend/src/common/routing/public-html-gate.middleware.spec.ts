import cookieParser from 'cookie-parser';
import express from 'express';
import { join } from 'path';
import request from 'supertest';
import { createPublicHtmlGateMiddleware } from './public-html-gate.middleware';

describe('public HTML Key Screen gate', () => {
  const frontendRoot = join(__dirname, '..', '..', '..', '..', 'cronox-front');

  const createApp = (
    gateEnabled: boolean,
    validateToken: (
      accessToken?: string,
      refreshToken?: string,
    ) => boolean | Promise<boolean> = () => false,
  ) => {
    const app = express();
    app.use(cookieParser());
    app.use(
      createPublicHtmlGateMiddleware({
        frontendRoot,
        keyScreen: {
          shouldGatePublicHtml: jest.fn().mockResolvedValue(gateEnabled),
        },
        authService: {
          hasValidAdminSession: jest.fn(validateToken),
        },
      }),
    );
    app.use((req, res) => res.status(200).send(`PUBLIC:${req.path}`));
    return app;
  };

  it('renders the Key Screen at / for an anonymous visitor while enabled', async () => {
    const response = await request(createApp(true)).get('/');

    expect(response.status).toBe(200);
    expect(response.text).toContain('<!doctype html>');
    expect(response.text).not.toBe('PUBLIC:/');
  });

  it('keeps an authenticated normal user behind the Key Screen', async () => {
    const response = await request(createApp(true))
      .get('/')
      .set('Cookie', 'jwt=normal-user-token');

    expect(response.text).not.toBe('PUBLIC:/');
  });

  it('serves the real storefront to a valid administrator', async () => {
    const response = await request(
      createApp(true, (token) => token === 'valid-admin-token'),
    )
      .get('/')
      .set('Cookie', 'jwt=valid-admin-token');

    expect(response.status).toBe(200);
    expect(response.text).toBe('PUBLIC:/');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers.vary).toContain('Cookie');
  });

  it('passes both HttpOnly session cookies and permits a refresh-only preview', async () => {
    const validateSession = jest.fn(
      (_accessToken?: string, refreshToken?: string) =>
        refreshToken === 'valid-refresh-token',
    );
    const response = await request(createApp(true, validateSession))
      .get('/')
      .set(
        'Cookie',
        'jwt=expired-access-token; refresh_token=valid-refresh-token',
      );

    expect(response.status).toBe(200);
    expect(response.text).toBe('PUBLIC:/');
    expect(validateSession).toHaveBeenCalledWith(
      'expired-access-token',
      'valid-refresh-token',
      expect.anything(),
    );
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers.vary).toContain('Cookie');
  });

  it.each([
    '/',
    '/tienda',
    '/producto/camiseta-core',
    '/galeria',
    '/favoritos',
    '/cesta',
    '/checkout',
    '/checkout/exito',
    '/cuenta',
    '/envios',
    '/devoluciones',
    '/faqs',
    '/desarrolla',
    '/eventos',
  ])('allows a valid administrator to open %s directly', async (path) => {
    const response = await request(
      createApp(true, (token) => token === 'valid-admin-token'),
    )
      .get(path)
      .set('Cookie', 'jwt=valid-admin-token');

    expect(response.status).toBe(200);
    expect(response.text).toBe(`PUBLIC:${path}`);
  });

  it('fails closed when access-token validation raises an error', async () => {
    const response = await request(
      createApp(true, () => Promise.reject(new Error('invalid token'))),
    )
      .get('/tienda')
      .set('Cookie', 'jwt=invalid-token');

    expect(response.status).toBe(307);
    expect(response.headers.location).toBe('/');
  });

  it('restores the Key Screen on the next request after logout', async () => {
    let sessionValid = true;
    const app = express();
    app.use(cookieParser());
    app.use(
      createPublicHtmlGateMiddleware({
        frontendRoot,
        keyScreen: {
          shouldGatePublicHtml: () => Promise.resolve(true),
        },
        authService: {
          hasValidAdminSession: (accessToken, refreshToken) =>
            Promise.resolve(
              sessionValid &&
                (accessToken === 'valid-admin-token' ||
                  refreshToken === 'valid-refresh-token'),
            ),
        },
      }),
    );
    app.post('/api/auth/logout', (_req, res) => {
      sessionValid = false;
      res.clearCookie('jwt', { path: '/' });
      res.clearCookie('refresh_token', { path: '/' });
      res.status(204).send();
    });
    app.use((req, res) => res.status(200).send(`PUBLIC:${req.path}`));
    const agent = request.agent(app);

    await agent
      .get('/')
      .set('Cookie', 'jwt=valid-admin-token; refresh_token=valid-refresh-token')
      .expect(200, 'PUBLIC:/');
    await agent
      .post('/api/auth/logout')
      .set('Cookie', 'jwt=valid-admin-token; refresh_token=valid-refresh-token')
      .expect(204);
    const response = await agent.get('/');
    expect(response.text).not.toBe('PUBLIC:/');
  });

  it('leaves the storefront public for everyone while the gate is disabled', async () => {
    const response = await request(createApp(false)).get('/galeria');

    expect(response.status).toBe(200);
    expect(response.text).toBe('PUBLIC:/galeria');
  });

  it.each([
    '/admin',
    '/admin.html',
    '/api/products',
    '/assets/app.js',
    '/privacidad',
    '/aviso-legal',
    '/cookies',
    '/terminos',
  ])('preserves the existing ungated behavior for %s', async (path) => {
    const response = await request(createApp(true)).get(path);

    expect(response.status).toBe(200);
    expect(response.text).toBe(`PUBLIC:${path}`);
  });
});
