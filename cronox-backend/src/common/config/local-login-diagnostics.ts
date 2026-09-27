import { Logger } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

const logger = new Logger('LocalLogin');
export function localLoginDiagnostics(req: Request, res: Response, next: NextFunction) {
  if (process.env.CRONOX_LOCAL_DEV === 'true' && req.method === 'POST' && req.path === '/api/auth/login') {
    // Never log request bodies, email, password, headers, cookie values or tokens.
    res.once('finish', () => {
      const category = res.statusCode === 401 ? 'credentials_or_account_state'
        : res.statusCode === 403 ? 'request_validation'
          : res.statusCode === 429 ? 'rate_limit'
            : res.statusCode >= 500 ? 'server_error' : res.statusCode < 400 ? 'success' : 'invalid_request';
      const message = `POST /api/auth/login status=${res.statusCode} category=${category} pid=${process.pid}`;
      if (res.statusCode >= 400) logger.warn(message); else logger.log(message);
    });
  }
  next();
}
