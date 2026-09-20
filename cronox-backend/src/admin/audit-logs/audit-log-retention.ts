import type { Prisma } from '@prisma/client';

export const AUDIT_LOG_RETENTION_DAYS = 30;
export const AUDIT_LOG_RETENTION_MS =
  AUDIT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export const auditLogRetentionCutoff = (now = new Date()): Date =>
  new Date(now.getTime() - AUDIT_LOG_RETENTION_MS);

export const retainedAuditLogDateFilter = (
  existing: Prisma.DateTimeFilter = {},
  now = new Date(),
): Prisma.DateTimeFilter => {
  const cutoff = auditLogRetentionCutoff(now);
  const requested = existing.gte instanceof Date ? existing.gte : null;
  return {
    ...existing,
    gte: requested && requested > cutoff ? requested : cutoff,
  };
};
