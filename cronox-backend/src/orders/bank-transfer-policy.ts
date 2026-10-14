import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { Prisma } from '@prisma/client';

type AdmissionSnapshot = {
  customerEmail: string; shippingAddr: Prisma.JsonValue;
  items: {variantId: number; quantity: number}[];
};
export async function admitBankReservation(tx: Prisma.TransactionClient, snapshot: AdmissionSnapshot, network: string) {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret || secret.length < 32) throw new ServiceUnavailableException('BANK_TRANSFER_PROTECTION_UNAVAILABLE');
  const hash = (scope: string, value: string) => createHmac('sha256', secret).update(`bank-admission:${scope}:${value}`).digest('hex');
  const address = (snapshot.shippingAddr || {}) as Record<string, unknown>;
  const normalize = (value: unknown) => String(value || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
  const bankNetworkHash = hash('network', network.replace(/^::ffff:/,''));
  const bankAddressHash = hash('address', ['country','postalCode','city','line1','line2'].map(key=>normalize(address[key])).join('|'));
  const email = snapshot.customerEmail.trim().toLowerCase();
  const now = new Date();
  // Cross-process serialization protects limits across different guest carts.
  // No Stripe network request is performed while holding this transaction.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(817260031)`;
  const pending = {status:'BANK_TRANSFER_PENDING'};
  const checks: [Prisma.CheckoutSnapshotWhereInput, number][] = [
    [{...pending,customerEmail:email},1],
    [{...pending,bankAddressHash},1],
    [{...pending,bankNetworkHash},2],
    [{bankNetworkHash,bankRequestedAt:{gte:new Date(now.getTime()-3600000)}},3],
    [{customerEmail:email,bankRequestedAt:{gte:new Date(now.getTime()-86400000)}},2],
    [{bankAddressHash,bankRequestedAt:{gte:new Date(now.getTime()-86400000)}},2],
  ];
  for (const [where,limit] of checks) {
    if (await tx.checkoutSnapshot.count({where}) >= limit) throw new ConflictException('BANK_TRANSFER_RESERVATION_LIMIT');
  }
  const ids = [...new Set(snapshot.items.map(item=>item.variantId))].sort((a,b)=>a-b);
  if (ids.length) await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ProductVariant" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`);
  for (const item of snapshot.items) {
    const variant = await tx.productVariant.findUniqueOrThrow({where:{id:item.variantId}});
    const all = await tx.checkoutStockReservation.aggregate({where:{variantId:item.variantId,status:'RESERVED'},_sum:{quantity:true}});
    const bank = await tx.checkoutStockReservation.aggregate({where:{variantId:item.variantId,status:'RESERVED',checkoutSnapshot:pending},_sum:{quantity:true}});
    // At most half the unsold inventory may be held for 72h, minimum one unit.
    // The two-unit order cap also bounds changing IP/email/address identities.
    const limit = Math.max(1, Math.floor((variant.stockQty + (all._sum.quantity || 0))/2));
    if (item.quantity > 2 || (bank._sum.quantity || 0) + item.quantity > limit) throw new ConflictException('BANK_TRANSFER_STOCK_RESERVATION_LIMIT');
  }
  return {bankNetworkHash, bankAddressHash, bankRequestedAt:now};
}
