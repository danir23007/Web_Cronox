import type { Request } from 'express';

export const ANALYTICS_CONSENT_VERSION = '2';
export const ANALYTICS_SESSION_COOKIE = 'cronox_analytics_session';
const CONSENT_COOKIE = 'cronox_cookie_consent';

export function hasAnalyticsConsent(req: Request): boolean {
  const raw = (req as Request & { cookies?: Record<string, string> }).cookies?.[
    CONSENT_COOKIE
  ];
  if (!raw || raw.length > 2048) return false;

  try {
    const parsed = JSON.parse(raw) as {
      version?: unknown;
      consentVersion?: unknown;
      analytics?: unknown;
      categories?: { analytics?: unknown };
    };
    return (
      (parsed.version === ANALYTICS_CONSENT_VERSION ||
        parsed.consentVersion === ANALYTICS_CONSENT_VERSION) &&
      (parsed.analytics === true || parsed.categories?.analytics === true)
    );
  } catch {
    return false;
  }
}

export function getAnalyticsSessionId(req: Request): string | undefined {
  return (req as Request & { cookies?: Record<string, string> }).cookies?.[
    ANALYTICS_SESSION_COOKIE
  ];
}
