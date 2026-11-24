import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';

export const ABANDONMENT_DELAY_MS = 23 * 60 * 60 * 1000;
export function abandonmentStart(): Date | null {
  const value = process.env.CART_ABANDONMENT_START_AT;
  if (!value || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** Caller holds Cart's row lock. Never invoked by totals reads or fulfillment. */
export async function recordCartActivity(tx: Prisma.TransactionClient, cartId: number) {
  const start = abandonmentStart();
  if (!start) return;
  await tx.$executeRaw`UPDATE "CartAbandonment" SET status='CANCELLED', "errorCode"='NEW_ACTIVITY'
    WHERE "cartId"=${cartId} AND status IN ('QUEUED','PROCESSING')`;
  await tx.$executeRaw`WITH activity AS (SELECT clock_timestamp() AS at)
    INSERT INTO "CartAbandonment" (id, "cartId", "userId", "activityAt", "dueAt", "readyAt")
    SELECT ${randomUUID()}, c.id, c."userId", activity.at, activity.at+interval '23 hours', activity.at+interval '23 hours'
    FROM "Cart" c JOIN "User" u ON u.id=c."userId" CROSS JOIN activity
    WHERE c.id=${cartId} AND u."accountState"='ACTIVE' AND u.role IN ('USER','FRIEND')
      AND clock_timestamp()>=${start} AND EXISTS (SELECT 1 FROM "CartItem" i WHERE i."cartId"=c.id AND i.qty>0)`;
}
