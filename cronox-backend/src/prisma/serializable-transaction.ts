import type { Prisma, PrismaClient } from '@prisma/client';

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
      if (attempt >= 3 || (code !== 'P2034' && !(retryUniqueCreation && code === 'P2002'))) throw error;
    }
  }
}
