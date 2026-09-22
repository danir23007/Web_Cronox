import { Role } from '@prisma/client';

// Access JWTs are deliberately short lived. Only the server-side refresh
// session is persistent, and its expiry is derived from refreshIssuedAt.
export const ACCESS_TOKEN_SECONDS = 15 * 60;
export const PERSISTENT_SESSION_DAYS = 500;
export const PERSISTENT_SESSION_SECONDS =
  PERSISTENT_SESSION_DAYS * 24 * 60 * 60;
export const ADMIN_REFRESH_DAYS = 7;
export const ADMIN_REFRESH_SECONDS = ADMIN_REFRESH_DAYS * 24 * 60 * 60;
export const ADMIN_IDLE_MINUTES = 90;
export const ADMIN_IDLE_MS = ADMIN_IDLE_MINUTES * 60_000;

export const refreshLifetimeSeconds = (role: Role): number =>
  role === Role.ADMIN ? ADMIN_REFRESH_SECONDS : PERSISTENT_SESSION_SECONDS;

export const refreshExpiresAt = (issuedAtSeconds: number, role: Role): Date =>
  new Date((issuedAtSeconds + refreshLifetimeSeconds(role)) * 1000);
