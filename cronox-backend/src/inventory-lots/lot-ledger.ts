import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FrozenLotCost } from './lot-costs';

type Tx = Prisma.TransactionClient;
type Slice = { id: string; lotId: string; available: number; productionCents: number | null; freightCents: number | null; otherCents: number | null; costQuality: string };
export async function managedVariant(tx: Tx, variantId: number): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ managed: boolean }>>`SELECT p."lotManaged" AS managed FROM "ProductVariant" v JOIN "Product" p ON p.id=v."productId" WHERE v.id=${variantId} FOR UPDATE OF v`;
  return rows[0]?.managed === true;
}

/** Called inside the same transaction as the existing guarded stock update.
 * The variant lock is shared by all inventory writers; FIFO never SKIP LOCKED. */
export async function allocateLots(tx: Tx, variantId: number, quantity: number, sourceKey: string, state: 'RESERVED' | 'SOLD' | 'ADJUSTED', requestedLot?: string) {
  if (!await managedVariant(tx, variantId)) return false;
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new ConflictException('LOT_INVALID_QUANTITY');
  const slices = await tx.$queryRaw<Slice[]>`SELECT s.*, l."costQuality" FROM "InventoryLotSlice" s JOIN "InventoryLot" l ON l.id=s."lotId" WHERE s."variantId"=${variantId} AND s.available>0 AND (s."lotId"=COALESCE(${requestedLot ?? null},(SELECT p."activeLotId" FROM "Product" p JOIN "ProductVariant" v ON v."productId"=p.id WHERE v.id=${variantId})) OR (SELECT p."activeLotId" FROM "Product" p JOIN "ProductVariant" v ON v."productId"=p.id WHERE v.id=${variantId}) IS NULL) ORDER BY l."receivedAt" ASC NULLS FIRST,l."createdAt",l.id,s.id FOR UPDATE OF s`;
  let remaining = quantity;
  for (const s of slices) {
    if (!remaining) break;
    const take = Math.min(remaining, s.available);
    await tx.$executeRaw`UPDATE "InventoryLotSlice" SET available=available-${take} WHERE id=${s.id}`;
    await tx.$executeRaw`INSERT INTO "InventoryLotAllocation" (id,"sliceId","sourceKey",quantity,state,"productionCents","freightCents","otherCents","costQuality") VALUES (${randomUUID()},${s.id},${sourceKey},${take},${state},${s.productionCents},${s.freightCents},${s.otherCents},${s.costQuality})`;
    remaining -= take;
  }
  if (remaining) throw new ConflictException('LOT_INSUFFICIENT_STOCK');
  await projectLotStock(tx,variantId);
  return true;
}

export async function returnLots(tx: Tx, variantId: number, quantity: number, sourceKey: string, release = false, specific?: FrozenLotCost[], restock = true) {
  if (!await managedVariant(tx, variantId)) return false;
  const legacy = specific?.filter(p => p.lotId === 'unreconciled' || p.sliceId.startsWith('historical:') || p.sliceId.startsWith('point-historical:')) ?? [];
  const legacyQuantity = legacy.reduce((s,p) => s+p.quantity,0);
  if (legacyQuantity) {
    if (legacyQuantity > quantity) throw new ConflictException('LOT_RETURN_QUANTITY_MISMATCH');
    for (const part of legacy) {
      const known = part.lotId !== 'unreconciled' && await tx.inventoryLot.findFirst({ where:{id:part.lotId,product:{variants:{some:{id:variantId}}}} });
      if (known) {
        if (restock) {
          const sliceId=randomUUID();
          await tx.inventoryLotSlice.create({data:{id:sliceId,lotId:part.lotId,variantId,received:part.quantity,available:part.quantity}});
          await tx.inventoryLotAllocation.create({data:{id:randomUUID(),sliceId,sourceKey,quantity:part.quantity,returned:part.quantity,state:'SOLD',costQuality:'UNKNOWN'}});
          await tx.inventoryLotAudit.create({data:{id:randomUUID(),lotId:part.lotId,reason:'Devolución de venta ya descontada: tirada identificada, coste pendiente',after:{sourceKey,variantId,quantity:part.quantity}}});
        }
      } else await returnLots(tx, variantId, part.quantity, sourceKey + ':legacy-return:' + randomUUID(), false, undefined, restock);
    }
    await projectLotStock(tx,variantId);
    quantity -= legacyQuantity;
    if (!quantity) return true;
    specific = specific!.filter(p => !legacy.includes(p));
  }
  const rows = await tx.$queryRaw<Array<{ id: string; sliceId: string; quantity: number; returned: number; retired: number }>>`SELECT a.* FROM "InventoryLotAllocation" a JOIN "InventoryLotSlice" s ON s.id=a."sliceId" WHERE a."sourceKey"=${sourceKey} AND s."variantId"=${variantId} AND a.state IN ('RESERVED','SOLD','ADJUSTED') ORDER BY a."createdAt",a.id FOR UPDATE OF a`;
  // Pre-migration sales have no recoverable receipt identity. The enclosing
  // return flow validates the original sale and claims the return once. Keep
  // this documented return separate and unknown rather than select today's FIFO.
  if (!rows.length && !release) {
    if (!restock) return true;
    const variant = await tx.productVariant.findUniqueOrThrow({ where: { id: variantId } });
    const lotId = randomUUID(), sliceId = randomUUID();
    await tx.$executeRaw`INSERT INTO "InventoryLot" (id,"productId",name,notes,"costQuality","openingBalance","requestKey","requestHash") VALUES (${lotId},${variant.productId},'Devolución histórica pendiente de conciliación',${sourceKey},'UNKNOWN',true,${lotId},${sourceKey})`;
    await tx.$executeRaw`INSERT INTO "InventoryLotSlice" (id,"lotId","variantId",received,available) VALUES (${sliceId},${lotId},${variantId},${quantity},${quantity})`;
    await tx.$executeRaw`INSERT INTO "InventoryLotAllocation" (id,"sliceId","sourceKey",quantity,returned,state,"costQuality") VALUES (${randomUUID()},${sliceId},${sourceKey},${quantity},${quantity},'SOLD','UNKNOWN')`;
    await projectLotStock(tx,variantId);
    return true;
  }
  const desired = specific?.length ? new Map<string, number>() : null;
  for (const p of specific ?? []) desired?.set(p.sliceId, (desired.get(p.sliceId) ?? 0) + p.quantity);
  let remaining = quantity;
  for (const a of rows) {
    const take = Math.min(remaining, a.quantity - a.returned - a.retired, desired ? desired.get(a.sliceId) ?? 0 : remaining);
    if (!take) continue;
    if (restock) {
      await tx.$executeRaw`UPDATE "InventoryLotSlice" SET available=available+${take} WHERE id=${a.sliceId}`;
      await tx.$executeRaw`UPDATE "InventoryLotAllocation" SET returned=returned+${take},state=CASE WHEN ${release} AND returned+${take}=quantity THEN 'RELEASED' ELSE state END WHERE id=${a.id}`;
    } else await tx.$executeRaw`UPDATE "InventoryLotAllocation" SET retired=retired+${take} WHERE id=${a.id}`;
    if (desired) desired.set(a.sliceId, desired.get(a.sliceId)! - take);
    remaining -= take;
  }
  if (remaining) throw new ConflictException('LOT_ORIGINAL_ALLOCATION_REQUIRED');
  await projectLotStock(tx,variantId);
  return true;
}

export async function consumeLots(tx: Tx, checkoutId: string, orderId: number) {
  await tx.$executeRaw`UPDATE "InventoryLotAllocation" SET state='SOLD',"sourceKey"=${'order:' + orderId} WHERE "sourceKey"=${'checkout:' + checkoutId} AND state='RESERVED'`;
}

export async function sourceCosts(tx: Tx, sourceKey: string, variantId: number): Promise<FrozenLotCost[]> {
  return tx.$queryRaw<FrozenLotCost[]>`SELECT s."lotId",s.id AS "sliceId",a.quantity-a.returned-a.retired AS quantity,a."productionCents",a."freightCents",a."otherCents",a."costQuality" AS quality FROM "InventoryLotAllocation" a JOIN "InventoryLotSlice" s ON s.id=a."sliceId" JOIN "InventoryLot" l ON l.id=s."lotId" WHERE a."sourceKey"=${sourceKey} AND s."variantId"=${variantId} AND a.state IN ('RESERVED','SOLD','ADJUSTED') AND a.quantity>a.returned+a.retired ORDER BY l."receivedAt" ASC NULLS FIRST,l."createdAt",l.id,s.id,a."createdAt",a.id`;
}

/** Supports multiple separately priced lines of the same variant. */
export function takeCosts(parts: FrozenLotCost[], quantity: number, offset = 0): FrozenLotCost[] {
  const result: FrozenLotCost[] = [];
  for (const part of parts) {
    const skip = Math.min(offset, part.quantity); offset -= skip;
    const take = Math.min(quantity, part.quantity - skip);
    if (take) { result.push({ ...part, quantity: take }); quantity -= take; }
  }
  if (quantity) throw new ConflictException('LOT_FINANCIAL_ALLOCATION_MISSING');
  return result;
}

export function removeCostParts(pool: FrozenLotCost[], parts: FrozenLotCost[]): void {
  for (const part of parts) {
    let remaining = part.quantity;
    for (const candidate of pool.filter(p => p.sliceId === part.sliceId)) {
      const take = Math.min(candidate.quantity, remaining); candidate.quantity -= take; remaining -= take;
    }
    if (remaining) throw new ConflictException('LOT_LINE_ALLOCATION_CHANGED');
  }
}

/** Explicitly link a previously recorded stock withdrawal to an already-paid
 * sale. Moving its provenance does not change availability a second time. */
export async function claimAdjustedLots(tx: Tx, variantId: number, lotId: string, quantity: number, adjustmentSource: string, saleSource: string): Promise<FrozenLotCost[]> {
  if (!await managedVariant(tx, variantId)) throw new ConflictException('LOT_MANAGEMENT_REQUIRED');
  const rows = await tx.$queryRaw<Array<Slice & { allocationId: string; remaining: number }>>`SELECT s.*,a.id AS "allocationId",a.quantity-a.returned-a.retired AS remaining,a."costQuality",a."productionCents",a."freightCents",a."otherCents" FROM "InventoryLotAllocation" a JOIN "InventoryLotSlice" s ON s.id=a."sliceId" WHERE a."sourceKey"=${adjustmentSource} AND a.state='ADJUSTED' AND s."variantId"=${variantId} AND s."lotId"=${lotId} ORDER BY a."createdAt",a.id FOR UPDATE OF a`;
  const result: FrozenLotCost[] = []; let missing = quantity;
  for (const row of rows) {
    const take = Math.min(missing,row.remaining); if (!take) continue;
    await tx.$executeRaw`UPDATE "InventoryLotAllocation" SET retired=retired+${take} WHERE id=${row.allocationId}`;
    await tx.$executeRaw`INSERT INTO "InventoryLotAllocation" (id,"sliceId","sourceKey",quantity,state,"productionCents","freightCents","otherCents","costQuality") VALUES (${randomUUID()},${row.id},${saleSource},${take},'SOLD',${row.productionCents},${row.freightCents},${row.otherCents},${row.costQuality})`;
    result.push({ lotId, sliceId: row.id, quantity: take, productionCents: row.productionCents, freightCents: row.freightCents, otherCents: row.otherCents, quality: row.costQuality }); missing -= take;
  }
  if (missing) throw new ConflictException('La salida ya se ha vinculado o no tiene unidades suficientes.');
  return result;
}

/** Manual counts are evidence of a balance, not a manufacturing receipt. */
export async function reconcileLotCounts(tx: Tx, productId: number, actorId?: number, reason = 'Corrección manual de inventario') {
  const product = await tx.product.findUnique({ where: { id: productId }, select: { lotManaged: true, activeLotId: true } });
  if (!product?.lotManaged) return;
  const variants = await tx.$queryRaw<Array<{ id: number; stock: number; balance: number }>>`SELECT v.id,v.stock,COALESCE((SELECT sum(s.available)::int FROM "InventoryLotSlice" s WHERE s."variantId"=v.id AND (${product.activeLotId ?? null}::text IS NULL OR s."lotId"=${product.activeLotId ?? null})),0) AS balance FROM "ProductVariant" v WHERE v."productId"=${productId} ORDER BY v.id FOR UPDATE OF v`;
  for (const v of variants) {
    const delta = v.stock - v.balance;
    if (!delta) continue;
    const id = randomUUID();
    if (delta < 0) await allocateLots(tx, v.id, -delta, 'adjustment:' + id, 'ADJUSTED');
    else {
      if (product.activeLotId) {
        await tx.inventoryLotSlice.create({ data: { id, lotId:product.activeLotId, variantId:v.id, received:delta, available:delta } });
        await tx.inventoryLotAudit.create({ data: { id:randomUUID(),lotId:product.activeLotId,actorId:actorId ?? null,reason,after:{variantId:v.id,delta,unknownCost:true} } });
        continue;
      }
      await tx.$executeRaw`INSERT INTO "InventoryLot" (id,"productId",name,notes,"costQuality","openingBalance","requestKey","requestHash") VALUES (${id},${productId},'Ajuste de saldo pendiente de conciliación',${reason},'UNKNOWN',true,${id},${id})`;
      await tx.$executeRaw`INSERT INTO "InventoryLotSlice" (id,"lotId","variantId",received,available) VALUES (${randomUUID()},${id},${v.id},${delta},${delta})`;
      await tx.$executeRaw`INSERT INTO "InventoryLotAudit" (id,"lotId","actorId",reason,after) VALUES (${randomUUID()},${id},${actorId ?? null},${reason},${JSON.stringify({ variantId: v.id, delta, unknownCost: true })}::jsonb)`;
    }
  }
}

/** Public counter projects only the active edition; reservations/returns may belong to an inactive one. */
export async function projectLotStock(tx: Tx, variantId: number) {
  await tx.$executeRaw`UPDATE "ProductVariant" v SET stock=(SELECT COALESCE(sum(s.available),0) FROM "InventoryLotSlice" s WHERE s."variantId"=v.id AND s."lotId"=p."activeLotId") FROM "Product" p WHERE v.id=${variantId} AND p.id=v."productId" AND p."activeLotId" IS NOT NULL`;
}
