/** Canonical account-email representation shared by auth and checkout. */
export const normalizeEmail = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';
