import { ArgumentsHost, BadRequestException, Catch, Logger } from '@nestjs/common';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { CustomerValidationException } from './customer-validation';

const logger = new Logger('CustomerRequest');
const routes = new Set(['/api/auth/register', '/api/auth/login', '/api/newsletter/subscribe', '/api/newsletter/start-registration', '/api/newsletter/complete-registration', '/api/newsletter/request-access']);
const included = (req: Request) => req.method === 'POST' && routes.has(req.path);

export function customerRequestDiagnostics(req: Request, res: Response, next: NextFunction) {
  if (!included(req)) return next();
  // Generated here, never copied from an untrusted incoming header.
  const requestId = randomUUID();
  res.locals.customerRequestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  res.once('finish', () => {
    if (res.statusCode < 400) return;
    const reason = res.locals.customerFailure?.reason || ({ 400: 'invalid_request', 401: 'credentials_or_session', 403: 'request_protection_or_ownership', 409: 'account_conflict', 429: 'rate_limit' } as Record<number, string>)[res.statusCode] || 'server_error';
    logger.warn(JSON.stringify({ event: 'customer_request_rejected', requestId, route: req.path, status: res.statusCode,
      reason, ...(res.locals.customerFailure?.issues ? { issues: res.locals.customerFailure.issues } : {}) }));
  });
  next();
}

export function customerBodyParserError(error: any, req: Request, res: Response, next: NextFunction) {
  if (!included(req) || error?.type !== 'entity.parse.failed') return next(error);
  res.locals.customerFailure = { reason: 'invalid_json' };
  // Node's JSON parser error can contain a fragment of the submitted password.
  res.status(400).json({ statusCode: 400, code: 'FORM_FORMAT_INVALID',
    message: 'No se pudo leer el formulario. Recarga la página y vuelve a intentarlo.', requestId: res.locals.customerRequestId });
}

@Catch(BadRequestException)
export class CustomerBadRequestFilter extends BaseExceptionFilter {
  constructor(private readonly adapterHost: HttpAdapterHost) { super(adapterHost.httpAdapter); }
  catch(error: BadRequestException, host: ArgumentsHost) {
    const http = host.switchToHttp(), req = http.getRequest<Request>(), res = http.getResponse<Response>();
    if (!included(req)) return super.catch(error, host);
    if (error instanceof CustomerValidationException) {
      res.locals.customerFailure = { reason: 'form_validation', issues: error.issues };
      this.adapterHost.httpAdapter.reply(res, { ...(error.getResponse() as object), requestId: res.locals.customerRequestId }, 400);
      return;
    }
    return super.catch(error, host);
  }
}
