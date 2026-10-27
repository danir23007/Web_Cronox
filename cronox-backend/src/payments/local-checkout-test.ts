/** Only the guarded local launcher may opt into financial workers in test mode. */
export function localCheckoutTestEnabled(): boolean {
  if (process.env.CRONOX_LOCAL_DEV !== 'true' || process.env.NODE_ENV !== 'development' ||
      process.env.CRONOX_LOCAL_CHECKOUT_TEST !== 'true' ||
      !process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) return false;
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.DATABASE_URL || '').hostname);
  } catch { return false; }
}
