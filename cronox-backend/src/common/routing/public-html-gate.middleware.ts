import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { join } from 'path';
import type { AuthService } from '../../auth/auth.service';
import type { KeyScreenService } from '../../key-screen/key-screen.service';
import {
  normalizePublicPath,
  publicGateDecision,
  UNGATED_PUBLIC_PATHS,
  PUBLIC_SITE_URL,
} from './public-pages';

const PROTECTED_ADMIN_PATHS = new Set(['/admin.html', '/admin-user.html']);
const UNGATED_ADMIN_PATHS = new Set(['/admin', '/admin-login.html']);

type PublicHtmlGateDependencies = {
  authService: Pick<AuthService, 'hasValidAdminSession'>;
  keyScreen: Pick<KeyScreenService, 'shouldGatePublicHtml'>;
  frontendRoot: string;
};

const isExcludedPath = (pathname: string): boolean =>
  pathname.startsWith('/api') ||
  pathname.startsWith('/docs') ||
  pathname.startsWith('/assets') ||
  pathname.startsWith('/public') ||
  UNGATED_ADMIN_PATHS.has(pathname) ||
  (!pathname.endsWith('.html') && pathname.includes('.'));

const hasAdminPreviewSession = async (
  req: Request,
  authService: PublicHtmlGateDependencies['authService'],
  res: Response,
): Promise<boolean> => {
  const cookies = (req as unknown as { cookies?: Record<string, unknown> })
    .cookies;
  const accessToken =
    typeof cookies?.jwt === 'string' ? cookies.jwt : undefined;
  const refreshToken =
    typeof cookies?.refresh_token === 'string'
      ? cookies.refresh_token
      : undefined;
  try {
    return await authService.hasValidAdminSession(
      accessToken,
      refreshToken,
      res,
    );
  } catch {
    return false;
  }
};

export const createPublicHtmlGateMiddleware =
  ({
    authService,
    keyScreen,
    frontendRoot,
  }: PublicHtmlGateDependencies): RequestHandler =>
  async (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    const pathname = normalizePublicPath(req.path);
    if (PROTECTED_ADMIN_PATHS.has(pathname)) {
      res.setHeader('Cache-Control', 'private, no-store');
      res.vary('Cookie');
      if (await hasAdminPreviewSession(req, authService, res)) return next();
      return res.redirect(
        307,
        `/admin-login.html?returnTo=${encodeURIComponent(req.originalUrl)}`,
      );
    }
    if (isExcludedPath(pathname)) return next();

    const acceptsHtml = req.accepts(['html', 'json']) === 'html';
    if (!acceptsHtml) return next();

    const keyScreenEnabled = await keyScreen.shouldGatePublicHtml();
    if (UNGATED_PUBLIC_PATHS.has(pathname)) {
      if (keyScreenEnabled) {
        res.setHeader('X-Robots-Tag', 'noindex, follow');
      }
      return next();
    }

    const adminPreviewAllowed =
      keyScreenEnabled && (await hasAdminPreviewSession(req, authService, res));
    if (adminPreviewAllowed) {
      res.setHeader('Cache-Control', 'private, no-store');
      res.vary('Cookie');
    }

    const gate = publicGateDecision(
      keyScreenEnabled && !adminPreviewAllowed,
      pathname,
      req.originalUrl,
    );
    if (gate.kind === 'continue') return next();

    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Link', `<${PUBLIC_SITE_URL}>; rel="canonical"`);
    if (gate.kind === 'render-key-screen') {
      return res.sendFile(join(frontendRoot, 'key-screen.html'));
    }
    res.setHeader('X-Robots-Tag', 'noindex, follow');
    return res.redirect(307, gate.location);
  };
