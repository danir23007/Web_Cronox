import {
  canonicalPathForRequest,
  cleanPageForPath,
  legacyRedirectTarget,
  normalizePublicPath,
  prelaunchSitemapXml,
  PUBLIC_SITE_URL,
  publicGateDecision,
  robotsText,
} from './public-pages';

describe('public clean routes', () => {
  it.each([
    ['/', 'index.html'],
    ['/tienda', 'index.html'],
    ['/galeria', 'gallery.html'],
    ['/favoritos', 'favorites.html'],
    ['/cesta', 'cart.html'],
    ['/checkout', 'checkout.html'],
    ['/checkout/exito', 'checkout-success.html'],
    ['/privacidad', 'privacy-policy.html'],
    ['/aviso-legal', 'aviso-legal.html'],
    ['/cookies', 'cookie-policy.html'],
    ['/terminos', 'terms-of-service.html'],
    ['/envios', 'shipping-policy.html'],
    ['/devoluciones', 'returns-exchanges.html'],
    ['/faqs', 'faqs.html'],
    ['/desarrolla', 'develop.html'],
    ['/eventos', 'events.html'],
    ['/cuenta', 'profile.html'],
    ['/recuperar-contrasena', 'forgot-password.html'],
    ['/restablecer-contrasena', 'reset-password.html'],
    ['/producto/camiseta-washed-negra', 'producto.html'],
    ['/producto', 'producto.html'],
  ])('maps %s to the existing %s entry point', (route, file) => {
    expect(cleanPageForPath(route)).toBe(file);
  });

  it('normalizes trailing slashes without altering the route meaning', () => {
    expect(normalizePublicPath('/galeria///')).toBe('/galeria');
    expect(cleanPageForPath('/producto/core/')).toBe('producto.html');
  });

  it('does not treat assets, APIs, Admin or unknown routes as public pages', () => {
    for (const route of [
      '/api/products',
      '/assets/app.js',
      '/admin',
      '/no-existe',
    ]) {
      expect(cleanPageForPath(route)).toBeNull();
    }
  });

  it.each([
    ['/index.html?campaign=summer', '/index.html', '/?campaign=summer'],
    ['/gallery.html?view=grid', '/gallery.html', '/galeria?view=grid'],
    [
      '/privacy-policy.html?source=footer',
      '/privacy-policy.html',
      '/privacidad?source=footer',
    ],
    ['/forgot-password', '/forgot-password', '/recuperar-contrasena'],
    [
      '/forgot-password/key-screen.html',
      '/forgot-password/key-screen.html',
      '/',
    ],
    ['/reset-password/key-screen.html', '/reset-password/key-screen.html', '/'],
    ['/forgot-password/index.html', '/forgot-password/index.html', '/'],
    [
      '/reset-password/reset-password.html?token=test',
      '/reset-password/reset-password.html',
      '/restablecer-contrasena?token=test',
    ],
  ])('preserves legacy query parameters for %s', (original, path, target) => {
    expect(legacyRedirectTarget(path, original)).toBe(target);
  });

  it('moves a legacy product slug into the path and preserves other filters', () => {
    expect(
      legacyRedirectTarget(
        '/producto.html',
        '/producto.html?slug=camiseta-washed-negra&ref=email',
      ),
    ).toBe('/producto/camiseta-washed-negra?ref=email');
  });

  it('keeps the legacy product id lookup when no slug exists', () => {
    expect(
      legacyRedirectTarget('/producto.html', '/producto.html?id=42&ref=old'),
    ).toBe('/producto?id=42&ref=old');
  });

  it('uses the homepage as the canonical for the storefront alias', () => {
    expect(canonicalPathForRequest('/tienda')).toBe('/');
    expect(canonicalPathForRequest('/producto/core')).toBe('/producto/core');
  });

  it('internally renders the Key Screen at the root without changing the URL', () => {
    expect(publicGateDecision(true, '/', '/')).toEqual({
      kind: 'render-key-screen',
    });
  });

  it('blocks another storefront route at the root while preserving its query', () => {
    expect(
      publicGateDecision(true, '/galeria', '/galeria?campaign=summer'),
    ).toEqual({ kind: 'redirect', location: '/?campaign=summer' });
  });

  it('lets every clean route continue normally when the Key Screen is off', () => {
    for (const route of ['/', '/tienda', '/galeria', '/producto/core']) {
      expect(publicGateDecision(false, route, route)).toEqual({
        kind: 'continue',
      });
    }
  });

  it('keeps the prelaunch root crawlable while excluding API and Admin', () => {
    const robots = robotsText(true);
    expect(robots).toContain('Allow: /');
    expect(robots).toContain('Allow: /api/key-screen$');
    expect(robots).toContain('Disallow: /api/');
    expect(robots).not.toContain('Disallow: /admin');
    expect(robots).not.toContain('Disallow: /\n');
    expect(robots).toContain(`Sitemap: ${PUBLIC_SITE_URL}sitemap.xml`);
  });

  it('restores public crawling while keeping API and Admin excluded after launch', () => {
    const robots = robotsText(false);
    expect(robots).toContain('Allow: /');
    expect(robots).toContain('Disallow: /api/');
    expect(robots).not.toContain('Disallow: /admin');
    expect(robots).toContain('Allow: /api/products');
    expect(robots).not.toContain('Disallow: /\n');
  });

  it('publishes a prelaunch sitemap containing only the canonical root', () => {
    const sitemap = prelaunchSitemapXml();
    expect(sitemap).toContain(`<loc>${PUBLIC_SITE_URL}</loc>`);
    expect(sitemap.match(/<url>/g)).toHaveLength(1);
    expect(sitemap).not.toContain('/tienda');
    expect(sitemap).not.toContain('/producto');
  });
});
