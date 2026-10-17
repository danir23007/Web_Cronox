import { AsyncLocalStorage } from 'node:async_hooks';
import { Prisma } from '@prisma/client';

export interface WebhookLease { id: string; token: string }
export const stripeWebhookLease = new AsyncLocalStorage<WebhookLease>();

// Lock the lease before any business row. The transaction cannot commit after
// a replacement worker has acquired this event. No lock crosses an HTTP call.
export async function assertStripeWebhookFence(tx: Prisma.TransactionClient): Promise<void> {
  const lease = stripeWebhookLease.getStore();
  if (!lease) return;
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "StripeWebhookEvent"
    WHERE "id" = ${lease.id} AND "leaseToken" = ${lease.token}
      AND "status" = 'PROCESSING' AND "leaseUntil" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
    FOR UPDATE`;
  if (!rows.length) throw new Error('STRIPE_WEBHOOK_LEASE_LOST');
}
