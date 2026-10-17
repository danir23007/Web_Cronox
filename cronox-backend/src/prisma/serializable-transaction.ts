import type { Prisma, PrismaClient } from '@prisma/client';

export function isRetryableTransactionConflict(error: unknown): boolean {
  const failure = error as { code?: string; meta?: { code?: string } } | null;
  // Prisma maps raw SELECT ... FOR UPDATE conflicts to P2010 with SQLSTATE,
  // while model operations use P2034 for the same PostgreSQL conflict.
  return failure?.code === 'P2034' ||
    (failure?.code === 'P2010' && ['40001', '40P01'].includes(failure.meta?.code || ''));
}

// Retry the complete read/modify/write operation when PostgreSQL detects a
// concurrent change. Callbacks must contain database work only, no side effects.
export async function serializableTransaction<T>(
  prisma: Pick<PrismaClient, '$transaction'>,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  retryUniqueCreation = false,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: 'Serializable',
      });
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (attempt >= 3 || (!isRetryableTransactionConflict(error) && !(retryUniqueCreation && code === 'P2002'))) throw error;
    }
  }
}
