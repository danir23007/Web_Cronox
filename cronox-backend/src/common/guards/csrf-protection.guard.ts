import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { getCorsOrigins } from '../config/environment';

export const CSRF_COOKIE_NAME = 'cronox_csrf_token';
export const CSRF_HEADER_NAME = 'x-csrf-token';

export type CsrfTokenRequest = Request & { csrfToken?: string };

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const WEBHOOK_PATHS = new Set([
  '/api/webhooks/stripe',
  '/api/payments/webhook',
]);

const getPath = (request: Request): string =>
  (request.originalUrl ?? request.url ?? '')
    .split('?')[0]
    .replace(/\/+$/, '') || '/';

const getRefererOrigin = (referer: string | undefined): string | null => {
  if (!referer) {
    return null;
  }

  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
};

const tokensMatch = (expected: string, received: string): boolean => {
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);

  return (
    expectedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(expectedBuffer, receivedBuffer)
  );
};

/**
 * Cookie authentication needs an explicit CSRF control. Unsafe browser API
 * requests must come from an allowlisted origin and echo the readable
 * double-submit cookie in X-CSRF-Token. Stripe's signed raw webhook is the
 * sole exception because it is authenticated by Stripe's signature instead.
 */
@Injectable()
export class CsrfProtectionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    if (!UNSAFE_METHODS.has(request.method.toUpperCase())) {
      return true;
    }

    const path = getPath(request);
    if (!path.startsWith('/api/') || WEBHOOK_PATHS.has(path)) {
      return true;
    }

    const origin =
      request.get('origin') ?? getRefererOrigin(request.get('referer'));
    if (!origin || !getCorsOrigins().includes(origin)) {
      throw new ForbiddenException('Origen de solicitud no permitido');
    }

    const cookieToken = request.cookies?.[CSRF_COOKIE_NAME];
    const headerToken = request.get(CSRF_HEADER_NAME);

    if (
      typeof cookieToken !== 'string' ||
      typeof headerToken !== 'string' ||
      !tokensMatch(cookieToken, headerToken)
    ) {
      throw new ForbiddenException('Validacion CSRF requerida');
    }

    return true;
  }
}
