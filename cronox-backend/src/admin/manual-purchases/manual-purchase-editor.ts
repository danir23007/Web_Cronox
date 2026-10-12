import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ManualStockHandling, OrderPaymentMethod, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';
import { HistorialService } from '../../historial/historial.service';
import { configuredManualCost } from '../finance/historical-cost';
import { madridDate } from '../finance/financial-calculations';
import { EditManualPurchaseDto } from './dto/edit-manual-purchase.dto';

const include = {
  items: { include: { financialSnapshot: true, variant: { include: { product: true } } }, orderBy: { id: 'asc' as const } },
  stockMovements: { select: { reason: true } }, checkoutSnapshot: { select: { id: true } },
} satisfies Prisma.OrderInclude;
type EditableOrder = Prisma.OrderGetPayload<{ include: typeof include }>;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const cents = (value: Decimal) => value.mul(100).toNumber();
const money = (value: number) => new Decimal(value).div(100);
const jsonObject = (value: Prisma.JsonValue | undefined): Prisma.JsonObject | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
const business = (order: EditableOrder) => ({
  userId: order.userId, paymentMethod: order.paymentMethod,
  purchasedAt: (order.purchasedAt ?? order.createdAt).toISOString(),
  note: order.internalNote ?? '', excludedFromStatistics: order.excludedFromStatistics,
  items: order.items.map(item => ({ itemId: item.id, variantId: item.variantId, quantity: item.quantity, unitPriceCents: cents(item.unitPrice) })),
});
const version = (order: EditableOrder, archive: { revision: number } | null) => digest({
  ...business(order), updatedAt: order.updatedAt.toISOString(), revision: archive?.revision,
  stockHandling: order.manualStockHandling, status: order.status,
  costs: order.items.map(item => item.financialSnapshot),
});

function limitation(order: EditableOrder, archive: { revision: number } | null): string | null {
  if (order.source !== 'IN_PERSON_ADMIN') return 'Solo se pueden editar compras presenciales registradas por el administrador.';
  if (order.status !== 'PAID' || order.voidedAt) return 'No se pueden editar compras anuladas, devueltas o que no estén pagadas.';
  if (order.providerRef || (order.provider && order.provider !== 'manual') || order.paymentMethod === 'STRIPE' || order.checkoutSnapshot)
    return 'Esta compra está vinculada a un pago integrado. No se puede editar ni realizar cobros o reembolsos desde este formulario.';
  if (order.stockMovements.some(row => ['refund', 'manual_sale_void'].includes(row.reason ?? '')) || order.disputeLostCents)
    return 'Esta compra tiene devoluciones o disputas registradas y no se puede editar.';
  if (!Object.values(ManualStockHandling).includes(order.manualStockHandling!)) return 'Falta el tratamiento de stock original; no es seguro editar esta compra.';
  if (!archive) return 'Falta el archivo financiero de esta compra; no es seguro editarla.';
  if (order.discountCents || order.shippingCost || order.promoCodeId) return 'Las compras con envíos o descuentos externos requieren una revisión específica y no se pueden editar aquí.';
  if (order.items.some(item => !item.variantId || !item.variant)) return 'Alguna talla original ya no existe; esta compra requiere una revisión específica.';
  return null;
}

export class ManualPurchaseEditor {
  constructor(private readonly db: PrismaService, private readonly history: HistorialService) {}

  async read(userId: number, orderId: number) {
    return this.db.$transaction(async tx => {
      const order = await tx.order.findUnique({ where: { id: orderId }, include });
      if (!order || order.userId !== userId) throw new NotFoundException('Compra no encontrada para este usuario');
      const archive = await tx.financeArchive.findUnique({ where: { orderId } });
      const reason = limitation(order, archive);
      return { order: { id: order.id, ...business(order), stockHandling: order.manualStockHandling,
        items: order.items.map(item => ({ itemId: item.id, variantId: item.variantId, quantity: item.quantity, unitPriceCents: cents(item.unitPrice),
          productId: item.productId, productName: item.variant?.product.name ?? item.title, size: item.variant?.size ?? '', sku: item.variant?.sku ?? '' })) },
        expectedVersion: version(order, archive), editable: !reason, limitation: reason };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async edit(userId: number, orderId: number, adminId: number, key: string | undefined, dto: EditManualPurchaseDto) {
    if (!key || !/^[A-Za-z0-9._:-]{16,100}$/.test(key)) throw new BadRequestException('Falta una clave válida para evitar guardados duplicados.');
    if (!/^[a-f0-9]{64}$/.test(dto.expectedVersion) || !Array.isArray(dto.items) || !dto.items.length || dto.items.length > 50 ||
      typeof dto.excludedFromStatistics !== 'boolean' || !['CASH', 'EXTERNAL_CARD', 'BANK_TRANSFER', 'OTHER'].includes(dto.paymentMethod) ||
      !dto.purchasedAt || !Number.isFinite(new Date(dto.purchasedAt).getTime()) || (dto.note !== undefined && (typeof dto.note !== 'string' || dto.note.length > 500)))
      throw new BadRequestException('Revisa los datos de la compra.');
    const itemIds = dto.items.flatMap(item => item.itemId === undefined ? [] : [item.itemId]);
    if (new Set(itemIds).size !== itemIds.length || dto.items.some(item =>
      !Number.isInteger(item.variantId) || item.variantId < 1 || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 100 ||
      !Number.isSafeInteger(item.unitPriceCents) || item.unitPriceCents < 0 || item.unitPriceCents > 999_999_999_999 ||
      (item.itemId !== undefined && (!Number.isInteger(item.itemId) || item.itemId < 1))))
      throw new BadRequestException('Los artículos, cantidades o precios no son válidos.');
    const normalized = { items: dto.items.map(item => ({ itemId: item.itemId, variantId: item.variantId, quantity: item.quantity, unitPriceCents: item.unitPriceCents })),
      paymentMethod: dto.paymentMethod, purchasedAt: new Date(dto.purchasedAt).toISOString(), note: dto.note?.trim() ?? '', excludedFromStatistics: dto.excludedFromStatistics };
    const requestHash = digest({ userId, orderId, expectedVersion: dto.expectedVersion, ...normalized });
    try {
      return await this.db.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
        await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
        const order = await tx.order.findUnique({ where: { id: orderId }, include });
        if (!order || order.userId !== userId) throw new NotFoundException('Compra no encontrada para este usuario');
        const replay = await tx.auditLog.findUnique({ where: { requestKey: key } });
        if (replay) {
          const metadata = replay.metadata as { requestHash?: string } | null;
          if (replay.actorId !== adminId || replay.targetId !== String(orderId) || replay.actionType !== 'admin.manual_purchase.edit' || metadata?.requestHash !== requestHash)
            throw new ConflictException('La clave de guardado ya se ha utilizado con otros datos.');
          return { changed: false, replayed: true, orderId };
        }
        // The capture trigger uses this same lock, including edits/cancellations.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(73421, ${orderId}::int)`;
        const archive = await tx.financeArchive.findUnique({ where: { orderId } });
        const reason = limitation(order, archive);
        if (reason) throw new ConflictException(reason);
        if (version(order, archive) !== dto.expectedVersion) throw new ConflictException('La compra ha cambiado desde que la abriste. Cancela y vuelve a abrirla para revisar los datos actuales.');
        if (itemIds.some(id => !order.items.some(item => item.id === id))) throw new BadRequestException('Una línea no pertenece a esta compra.');
        const before = business(order);
        if (digest(before.items) === digest(normalized.items) && before.paymentMethod === normalized.paymentMethod &&
          before.purchasedAt === normalized.purchasedAt && before.note === normalized.note && before.excludedFromStatistics === normalized.excludedFromStatistics) {
          await tx.auditLog.create({ data: { requestKey: key, actorId: adminId, action: 'admin.manual_purchase.edit', actionType: 'admin.manual_purchase.edit',
            targetType: 'order', targetId: String(orderId), metadata: { requestHash, changed: false, before, after: before } } });
          return { changed: false, replayed: false, orderId };
        }
        const oldQuantities = new Map<number, number>(), newQuantities = new Map<number, number>();
        for (const item of order.items) oldQuantities.set(item.variantId!, (oldQuantities.get(item.variantId!) ?? 0) + item.quantity);
        for (const item of dto.items) newQuantities.set(item.variantId, (newQuantities.get(item.variantId) ?? 0) + item.quantity);
        const ids = [...new Set([...oldQuantities.keys(), ...newQuantities.keys()])].sort((a, b) => a - b);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "ProductVariant" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`);
        const variants = await tx.productVariant.findMany({ where: { id: { in: ids } }, include: { product: { include: { privateCost: true } } } });
        let totalCents = 0;
        for (const item of dto.items) {
          const variant = variants.find(row => row.id === item.variantId);
          const previous = order.items.find(row => row.id === item.itemId);
          if (!variant || variant.product.currency !== order.currency ||
            ((!variant.isActive || !variant.product.isActive) && (!previous || previous.variantId !== variant.id || item.quantity > previous.quantity)))
            throw new ConflictException('Algún artículo o talla no está disponible, o tiene otra moneda.');
          totalCents += item.quantity * item.unitPriceCents;
          if (!Number.isSafeInteger(totalCents) || totalCents > 999_999_999_999) throw new BadRequestException('El total de la compra es demasiado alto.');
        }
        const stockChanges: Array<{ variantId: number; delta: number }> = [];
        if (order.manualStockHandling === ManualStockHandling.DEDUCT_NOW) {
          for (const id of ids) {
            const delta = (oldQuantities.get(id) ?? 0) - (newQuantities.get(id) ?? 0);
            if (!delta) continue;
            const result = await tx.productVariant.updateMany({ where: { id, ...(delta < 0 ? { stockQty: { gte: -delta } } : {}) }, data: { stockQty: { increment: delta } } });
            if (result.count !== 1) throw new ConflictException('No hay stock suficiente para la nueva cantidad. No se ha guardado ningún cambio.');
            stockChanges.push({ variantId: id, delta });
          }
        }
        for (const item of dto.items) {
          const variant = variants.find(row => row.id === item.variantId)!;
          const previous = order.items.find(row => row.id === item.itemId);
          const sameVariant = previous?.variantId === item.variantId;
          const financial = { unitCostCents: configuredManualCost(variant.product.privateCost), productName: variant.product.name, imageUrl: variant.product.imageUrl };
          const line = { productId: variant.productId, variantId: variant.id, title: sameVariant ? previous!.title : `${variant.product.name} (${variant.size})`,
            quantity: item.quantity, unitPrice: money(item.unitPriceCents), lineTotal: money(item.quantity * item.unitPriceCents) };
          if (previous) {
            await tx.orderItem.update({ where: { id: previous.id }, data: { ...line,
              ...(!sameVariant ? { financialSnapshot: { upsert: { create: financial, update: financial } } } : {}) } });
          } else {
            await tx.orderItem.create({ data: { ...line, orderId, financialSnapshot: { create: financial } } });
          }
        }
        await tx.orderItem.deleteMany({ where: { orderId, id: { in: order.items.filter(item => !itemIds.includes(item.id)).map(item => item.id) } } });
        const subtotal = money(totalCents);
        const saved = await tx.order.update({ where: { id: orderId }, data: { subtotal, total: subtotal,
          taxAmount: subtotal.minus(subtotal.div(order.taxRate.add(1)).toDecimalPlaces(2)).toDecimalPlaces(2),
          paymentMethod: dto.paymentMethod, purchasedAt: new Date(dto.purchasedAt), internalNote: normalized.note || null,
          excludedFromStatistics: dto.excludedFromStatistics }, include });
        if (stockChanges.length) await tx.stockMovement.createMany({ data: stockChanges.map(change => ({ ...change, reason: 'manual_sale_edit', orderId, userId, note: `Edición por administrador #${adminId}` })) });
        // Replace only the current archive. Original and subsequent revisions are
        // retained; deferred capture sees this new current snapshot and preserves it.
        const previousSnapshot = archive!.snapshot as Prisma.JsonObject;
        const previousLines = Array.isArray(previousSnapshot.items) ? previousSnapshot.items : [];
        const snapshot = { ...previousSnapshot, total: saved.total.toString(), purchasedAt: saved.purchasedAt!.toISOString(),
          excludedFromStatistics: saved.excludedFromStatistics, items: saved.items.map(item => {
            const previousLine = jsonObject(previousLines.find(line => jsonObject(line)?.id === item.id));
            const sameVariant = previousLine?.variantId === item.variantId;
            const financial = item.financialSnapshot ? { unitCostCents: item.financialSnapshot.unitCostCents,
              productName: item.financialSnapshot.productName, imageUrl: item.financialSnapshot.imageUrl } : null;
            return { ...(sameVariant ? previousLine : {}), id: item.id, productId: item.productId,
              variantId: item.variantId, title: item.title, quantity: item.quantity, lineTotal: item.lineTotal.toString(),
              // Preserve the archived cost and its evidence, including unknown
              // costs, rather than refresh them from a possibly changed source row.
              financialSnapshot: sameVariant && previousLine?.financialSnapshot !== undefined ? previousLine.financialSnapshot : financial };
          }) };
        const paidDate = new Date(madridDate(saved.purchasedAt!));
        await tx.financeArchive.update({ where: { orderId }, data: { snapshot, revision: { increment: 1 }, paidDate, lastDate: paidDate, uncertain: false } });
        await tx.financeArchiveRevision.create({ data: { orderId, revision: archive!.revision + 1, snapshot } });
        await this.history.syncFromOrders(userId, tx);
        await tx.auditLog.create({ data: { requestKey: key, actorId: adminId, action: 'admin.manual_purchase.edit', actionType: 'admin.manual_purchase.edit',
          targetType: 'order', targetId: String(orderId), metadata: { requestHash, changed: true, before, after: business(saved), stockHandling: order.manualStockHandling,
            stockChanges, previousArchiveRevision: archive!.revision, archiveRevision: archive!.revision + 1,
            costsBefore: order.items.map(item => ({ ...item.financialSnapshot, itemId: item.id })), costsAfter: saved.items.map(item => ({ ...item.financialSnapshot, itemId: item.id })) } } });
        return { changed: true, replayed: false, orderId };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && (['P2034', 'P2002'].includes(error.code) ||
        (error.code === 'P2010' && ['40001', '40P01'].includes(String(error.meta?.code))))) {
        // A simultaneous identical retry may start with the pre-commit snapshot.
        // After rollback, return its committed receipt rather than write again.
        const receipt = await this.db.auditLog.findUnique({ where: { requestKey: key } });
        const metadata = receipt?.metadata as { requestHash?: string } | null;
        if (receipt?.actorId === adminId && receipt.targetId === String(orderId) && receipt.actionType === 'admin.manual_purchase.edit' && metadata?.requestHash === requestHash)
          return { changed: false, replayed: true, orderId };
        throw new ConflictException('La compra o el stock han cambiado durante el guardado. Recarga la compra y revisa los datos.');
      }
      throw error;
    }
  }
}
