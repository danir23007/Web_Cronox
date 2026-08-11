type AnalyticsEnvironment = {
  [key: string]: string | undefined;
  ANALYTICS_SESSION_TIMEOUT_MINUTES?: string;
  CHECKOUT_ABANDONMENT_MINUTES?: string;
  ANALYTICS_RETENTION_DAYS?: string;
  LOGIN_HISTORY_RETENTION_DAYS?: string;
};

export const ANALYTICS_DEFAULT_CONFIG = Object.freeze({
  sessionTimeoutMinutes: 30,
  checkoutAbandonmentMinutes: 60,
  analyticsRetentionDays: 180,
  loginHistoryRetentionDays: 365,
});

const positiveInteger = (
  value: string | undefined,
  fallback: number,
  minimum = 1,
): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum ? parsed : fallback;
};

export const getAnalyticsConfiguration = (
  environment: AnalyticsEnvironment = process.env,
) => ({
  sessionTimeoutMinutes: positiveInteger(
    environment.ANALYTICS_SESSION_TIMEOUT_MINUTES,
    ANALYTICS_DEFAULT_CONFIG.sessionTimeoutMinutes,
    5,
  ),
  checkoutAbandonmentMinutes: positiveInteger(
    environment.CHECKOUT_ABANDONMENT_MINUTES,
    ANALYTICS_DEFAULT_CONFIG.checkoutAbandonmentMinutes,
  ),
  analyticsRetentionDays: positiveInteger(
    environment.ANALYTICS_RETENTION_DAYS,
    ANALYTICS_DEFAULT_CONFIG.analyticsRetentionDays,
  ),
  loginHistoryRetentionDays: positiveInteger(
    environment.LOGIN_HISTORY_RETENTION_DAYS,
    ANALYTICS_DEFAULT_CONFIG.loginHistoryRetentionDays,
  ),
});
