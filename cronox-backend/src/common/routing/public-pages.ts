export const CLEAN_PUBLIC_PAGES = new Map<string, string>([
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
]);

export const LEGACY_PUBLIC_REDIRECTS = new Map<string, string>([
  ['/index.html', '/'],
  ['/key-screen', '/'],
  ['/key-screen.html', '/'],
  ['/gallery.html', '/galeria'],
  ['/favorites.html', '/favoritos'],
  ['/cart.html', '/cesta'],
  ['/checkout.html', '/checkout'],
  ['/checkout-success.html', '/checkout/exito'],
  ['/privacy-policy.html', '/privacidad'],
  ['/aviso-legal.html', '/aviso-legal'],
  ['/cookie-policy.html', '/cookies'],
  ['/terms-of-service.html', '/terminos'],
  ['/shipping-policy.html', '/envios'],
  ['/returns-exchanges.html', '/devoluciones'],
  ['/faqs.html', '/faqs'],
  ['/develop.html', '/desarrolla'],
  ['/events.html', '/eventos'],
  ['/profile.html', '/cuenta'],
  ['/forgot-password.html', '/recuperar-contrasena'],
  ['/forgot-password', '/recuperar-contrasena'],
  ['/reset-password.html', '/restablecer-contrasena'],
  ['/reset-password', '/restablecer-contrasena'],
]);

export const UNGATED_PUBLIC_PATHS = new Set([
  '/privacidad',
  '/aviso-legal',
  '/cookies',
  '/terminos',
  '/privacy-policy.html',
  '/aviso-legal.html',
  '/cookie-policy.html',
  '/terms-of-service.html',
  '/key-screen',
  '/key-screen.html',
]);

export const normalizePublicPath = (pathname: string): string =>
  pathname.replace(/\/+$/, '') || '/';

export const cleanPageForPath = (pathname: string): string | null => {
  const normalized = normalizePublicPath(pathname);
  const direct = CLEAN_PUBLIC_PAGES.get(normalized);
  if (direct) return direct;
  return /^\/producto\/[^/]+$/.test(normalized) || normalized === '/producto'
    ? 'producto.html'
    : null;
};

const querySuffix = (originalUrl: string): string => {
  const queryIndex = originalUrl.indexOf('?');
  return queryIndex >= 0 ? originalUrl.slice(queryIndex) : '';
};

export const legacyRedirectTarget = (
  pathname: string,
  originalUrl: string,
): string | null => {
  // Former password-recovery static mounts exposed every frontend HTML file
  // below these prefixes, including obsolete launch pages. Keep known bookmarks
  // as redirects, never serve a second copy of the storefront or admin shell.
  const normalized = normalizePublicPath(pathname).replace(
    /^\/(?:forgot-password|reset-password)\/([^/]+\.html)$/,
    '/$1',
  );
  if (normalized === '/producto.html') {
    const url = new URL(originalUrl, 'http://cronox.local');
    const slug = url.searchParams.get('slug')?.trim();
    if (slug) {
      url.searchParams.delete('slug');
      const query = url.searchParams.toString();
      return `/producto/${encodeURIComponent(slug)}${query ? `?${query}` : ''}`;
    }
    return `/producto${url.search}`;
  }
  const target = LEGACY_PUBLIC_REDIRECTS.get(normalized);
  return target ? `${target}${querySuffix(originalUrl)}` : null;
};

export const canonicalPathForRequest = (pathname: string): string => {
  const normalized = normalizePublicPath(pathname);
  return normalized === '/tienda' ? '/' : normalized;
};

export type PublicGateDecision =
  | { kind: 'continue' }
  | { kind: 'render-key-screen' }
  | { kind: 'redirect'; location: string };

export const publicGateDecision = (
  enabled: boolean,
  pathname: string,
  originalUrl: string,
): PublicGateDecision => {
  if (!enabled) return { kind: 'continue' };
  if (normalizePublicPath(pathname) === '/') {
    return { kind: 'render-key-screen' };
  }
  return { kind: 'redirect', location: `/${querySuffix(originalUrl)}` };
};

export const PUBLIC_SITE_URL = 'https://cronox.es/';

export const robotsText = (keyScreenEnabled: boolean): string => {
  const directives = keyScreenEnabled
    ? [
        'User-agent: *',
        'Allow: /',
        'Allow: /api/key-screen$',
        'Disallow: /api/',
      ]
    : [
        'User-agent: *',
        'Allow: /',
        // Rendering uses these read-only public endpoints. Other APIs stay out of crawl.
        'Allow: /api/products',
        'Allow: /api/categories',
        'Allow: /api/gallery',
        'Allow: /api/footer',
        'Allow: /api/key-screen$',
        'Allow: /api/media-framing',
        'Disallow: /api/',
      ];

  return [...directives, `Sitemap: ${PUBLIC_SITE_URL}sitemap.xml`, ''].join(
    '\n',
  );
};

export const prelaunchSitemapXml = (): string =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    '  <url>',
    `    <loc>${PUBLIC_SITE_URL}</loc>`,
    '  </url>',
    '</urlset>',
    '',
  ].join('\n');
