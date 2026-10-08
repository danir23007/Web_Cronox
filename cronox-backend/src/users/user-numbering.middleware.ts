import type { Request, RequestHandler } from 'express';
import { Pool } from 'pg';
import { CallHandler, ExecutionContext, Injectable, NestInterceptor, ServiceUnavailableException } from '@nestjs/common';
import { finalize } from 'rxjs';

export const USER_NUMBERING_LOCK = [824031, 1] as const;

// Separate pool: holding the request gate must not consume the connections
// that controllers need to finish the request. No account snapshot is cached.
type NumberedRequest = Request & { numberingHandler?: boolean; numberingReleased?: boolean; releaseNumbering?: () => void };

export function userNumberingMiddleware(locks: Pool): RequestHandler {
  return (req, res, next) => {
    if ((!req.path.startsWith('/api/') && !req.path.startsWith('/webhooks')) || ['/api/health', '/api/ready'].includes(req.path)) {
      next(); return;
    }
    const request = req as NumberedRequest;
    void (async () => {
      const client = await locks.connect();
      try { await client.query('SELECT pg_advisory_lock_shared(824031,1)'); }
      catch (error) { client.release(true); throw error; }
      const done = () => {
        if (request.numberingReleased) return;
        request.numberingReleased = true;
        res.off('finish', done); res.off('close', closed);
        void client.query('SELECT pg_advisory_unlock_shared(824031,1)').then(() => client.release()).catch(() => client.release(true));
      };
      const closed = () => { if (!request.numberingHandler) done(); };
      request.releaseNumbering = done;
      res.once('finish', done); res.once('close', closed);
      if (res.destroyed) done(); else next();
    })().catch(() => {
      if (!res.headersSent && !res.destroyed) res.status(503).json({ code:'USER_NUMBERING_BUSY', message:'Servicio temporalmente ocupado. Reintenta.' });
      else if (!res.writableEnded) res.destroy();
    });
  };
}

@Injectable()
export class UserNumberingCompletion implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest<NumberedRequest>();
    // A disconnected request must never start an action after releasing its gate.
    if (req.numberingReleased) throw new ServiceUnavailableException('Request disconnected');
    req.numberingHandler = true;
    return next.handle().pipe(finalize(() => req.releaseNumbering?.()));
  }
}
