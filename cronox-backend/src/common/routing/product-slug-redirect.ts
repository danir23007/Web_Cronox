import type { RequestHandler } from 'express';
import { ARMORED_COAL } from '../../products/product-slugs';
import { normalizePublicPath, PUBLIC_SITE_URL } from './public-pages';
import { CART_COOKIE_NAME } from '../cookies/cart-cookie';

// This runs on the public HTML server, before hostname normalization, gate,
// filename redirects and static files. GET and HEAD share the same one-hop 301.
export const productSlugRedirect: RequestHandler = (req, res, next) => {
  if (!['GET', 'HEAD'].includes(req.method)) return next();
  const path = normalizePublicPath(req.path);
  const url = new URL(req.originalUrl, PUBLIC_SITE_URL);
  let slug: string | undefined;
  try {
    if (path.startsWith('/producto/')) slug = decodeURIComponent(path.slice('/producto/'.length));
  } catch { return next(); }
  const queryEntry = /^\/(?:(?:forgot-password|reset-password)\/)?producto(?:\.html)?$/.test(path);
  if (queryEntry) slug = url.searchParams.get('slug')?.trim();
  if (slug !== ARMORED_COAL.oldSlug) return next();
  url.searchParams.delete('slug');
  url.searchParams.delete('id');
  const target = `/producto/${ARMORED_COAL.slug}${url.search}`;
  // New www visits converge in this same hop; retain old host-only carts and
  // sessions, as seoRequestSignals does for the rest of the storefront.
  const legacyBrowser = req.cookies?.jwt || req.cookies?.refresh_token || req.cookies?.[CART_COOKIE_NAME];
  res.setHeader('Cache-Control', 'no-store');
  res.vary('Cookie');
  return res.redirect(301, req.hostname === 'www.cronox.es' && !legacyBrowser
    ? `${PUBLIC_SITE_URL.slice(0, -1)}${target}` : target);
};
