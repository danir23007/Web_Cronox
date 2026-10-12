import type { Request, Response, NextFunction } from 'express';

// Imported order lifecycles and external-operation entry points remain blocked.
// New manual records and analytic flags can be reviewed against the isolated
// local database; the local loader disables emails/jobs and verifies loopback.
export function localReviewSafety(req: Request, res: Response, next: NextFunction) {
  if (process.env.CRONOX_LOCAL_DEV !== 'true' || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (/^\/api\/admin\/orders\/\d+\/statistics-exclusion$/.test(req.path)) return next();
  if (req.method === 'POST' && /^\/api\/admin\/users\/\d+\/in-person-purchases$/.test(req.path)) return next();
  if (/^\/api\/(?:checkout|payments|webhooks|orders|shipping|admin\/(?:orders|manual-purchases|shipping)|newsletter|waitlist)(?:\/|$)/i.test(req.path)
    || /^\/api\/admin\/users\/[^/]+\/in-person-purchases(?:\/|$)/i.test(req.path)) {
    return res.status(403).json({ statusCode: 403, message: 'Operación deshabilitada en la revisión local de datos históricos.' });
  }
  return next();
}
