export function trackingInteger(name: string, fallback: number, min: number, max: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw Error(`INVALID_${name}`);
  return number;
}

export function correosConfig() {
  return {
    enabled: process.env.CORREOS_TRACKING_ENABLED === 'true',
    identityClientId: process.env.CORREOS_IDENTITY_CLIENT_ID?.trim() || '',
    identityClientSecret: process.env.CORREOS_IDENTITY_CLIENT_SECRET?.trim() || '',
    developersClientId: process.env.CORREOS_DEVELOPERS_CLIENT_ID?.trim() || '',
    developersClientSecret: process.env.CORREOS_DEVELOPERS_CLIENT_SECRET?.trim() || '',
    timeoutMs: trackingInteger('CORREOS_TIMEOUT_MS', 10000, 100, 30000),
    intervalMs: trackingInteger('CORREOS_SYNC_INTERVAL_SECONDS', 1800, 60, 86400) * 1000,
    manualCooldownMs: trackingInteger('CORREOS_MANUAL_COOLDOWN_SECONDS', 60, 10, 3600) * 1000,
    concurrency: trackingInteger('CORREOS_SYNC_CONCURRENCY', 2, 1, 5),
    // A local operational choice, not a Correos-published request limit.
    requestSpacingMs: trackingInteger('CORREOS_REQUEST_SPACING_MS', 1000, 100, 60000),
  };
}
