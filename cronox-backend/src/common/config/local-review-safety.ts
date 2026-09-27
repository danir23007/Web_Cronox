import type { Request, Response, NextFunction } from 'express';

// Historical snapshots are for review. Catalogue/cost editing and local cart/auth
// remain available, but no order lifecycle or external-operation entry point runs.
export function localReviewSafety(req: Request, res: Response, next: NextFunction) {
  if (process.env.CRONOX_LOCAL_DEV !== 'true' || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (/^\/api\/(?:checkout|payments|webhooks|orders|shipping|admin\/(?:orders|manual-purchases|shipping)|newsletter|waitlist)(?:\/|$)/i.test(req.path)
    || /^\/api\/admin\/users\/[^/]+\/in-person-purchases(?:\/|$)/i.test(req.path)) {
    return res.status(403).json({ statusCode: 403, message: 'Operación deshabilitada en la revisión local de datos históricos.' });
  }
  return next();
}
