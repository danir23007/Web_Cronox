import { Prisma } from '@prisma/client';

// Only customer purchases recorded manually can be excluded. Missing flags in
// older archives mean inclusion; a web order can never acquire this exception.
export function countsInStatistics(order: { source?: string; excludedFromStatistics?: boolean }) {
  return !(order.source === 'IN_PERSON_ADMIN' && order.excludedFromStatistics === true);
}

export const statisticsOrderWhere: Prisma.OrderWhereInput = {
  NOT: { source: 'IN_PERSON_ADMIN', excludedFromStatistics: true },
};
