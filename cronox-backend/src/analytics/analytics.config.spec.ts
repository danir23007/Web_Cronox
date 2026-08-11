import {
  ANALYTICS_DEFAULT_CONFIG,
  getAnalyticsConfiguration,
} from './analytics.config';

describe('analytics configuration', () => {
  it('uses the confirmed CRONOX business and technical defaults', () => {
    expect(getAnalyticsConfiguration({})).toEqual({
      sessionTimeoutMinutes: 30,
      checkoutAbandonmentMinutes: 60,
      analyticsRetentionDays: 180,
      loginHistoryRetentionDays: 365,
    });
    expect(ANALYTICS_DEFAULT_CONFIG).toEqual(getAnalyticsConfiguration({}));
  });

  it('keeps every value configurable through its environment variable', () => {
    expect(
      getAnalyticsConfiguration({
        ANALYTICS_SESSION_TIMEOUT_MINUTES: '45',
        CHECKOUT_ABANDONMENT_MINUTES: '90',
        ANALYTICS_RETENTION_DAYS: '120',
        LOGIN_HISTORY_RETENTION_DAYS: '240',
      }),
    ).toEqual({
      sessionTimeoutMinutes: 45,
      checkoutAbandonmentMinutes: 90,
      analyticsRetentionDays: 120,
      loginHistoryRetentionDays: 240,
    });
  });
});
