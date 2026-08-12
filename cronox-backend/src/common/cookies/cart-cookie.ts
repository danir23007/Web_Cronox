import type { CookieOptions } from 'express';
import { isProductionEnvironment } from '../config/environment';

export const CART_COOKIE_NAME = 'cartId';
export const CART_COOKIE_PATH = '/api';
export const ANONYMOUS_CART_TTL_MS = 60 * 60 * 1000;
export const LEGACY_CART_COOKIE_PATHS = [
  CART_COOKIE_PATH,
  '/api/cart',
  '/api/cart/items',
  '/',
] as const;

export const getCartCookieOptions = (): CookieOptions => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: isProductionEnvironment(),
  // Use one stable API-wide scope. Previously Path was omitted, so its scope
  // varied according to the cart endpoint that last wrote the cookie.
  path: CART_COOKIE_PATH,
  maxAge: ANONYMOUS_CART_TTL_MS,
});
