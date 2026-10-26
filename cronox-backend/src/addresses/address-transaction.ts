import type { Prisma, PrismaClient } from '@prisma/client';

// Every customer address writer uses the same account lock. ReadCommitted
// avoids SSI conflicts between unrelated accounts on sparsely populated pages.
export function addressTransaction<T>(
  prisma: Pick<PrismaClient, '$transaction'>,
  userId: number,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'address:user:' + userId}, 0))`;
    return operation(tx);
  }, { isolationLevel: 'ReadCommitted', maxWait: 10_000, timeout: 10_000 });
}
