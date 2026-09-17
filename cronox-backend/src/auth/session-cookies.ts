import { UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { isProductionEnvironment } from '../common/config/environment';

export function clearFailedSession(
  res: Response,
  error: unknown,
  refresh = false,
) {
  const body =
    error instanceof UnauthorizedException ? error.getResponse() : null;
  const code =
    typeof body === 'object' && body && 'code' in body ? body.code : '';
  // An expired access JWT needs refresh, not cookie removal. Terminal session
  // errors and rejected refresh credentials, however, must clear both cookies.
  if (!refresh && !String(code).startsWith('SESSION_')) return;
  for (const name of ['jwt', 'refresh_token']) {
    res.clearCookie(name, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: isProductionEnvironment(),
    });
  }
}
