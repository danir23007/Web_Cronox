import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { receiptSlices } from '../../inventory-lots/lot-costs';
import { lotReport } from './lot-report';
import { ActivateLotsDto, CreateLotDto, EditLotDto, CorrectLotCostsDto, ReconcileHistoricalLotDto, ReconcilePointLotDto } from './lot.dto';
import { FinanceOrder } from '../finance/financial-calculations';
import { PointDelta, PointState } from '../points/point-calculations';
import { applyPointCostRevisions } from '../points/point-cost-revisions';
import { frozenCost, FrozenLotCost, retainPhysicalIdentity } from '../../inventory-lots/lot-costs';
import { takeCosts, claimAdjustedLots } from '../../inventory-lots/lot-ledger';
type Tx = Prisma.TransactionClient;
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

@Injectable()
export class AdminLotsService {
  constructor(private readonly db: PrismaService) {}
  report(productId: number, from: string, to: string) { return this.db.$transaction(tx => lotReport(tx, productId, from, to), { timeout: 30000, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }); }
  async historical(productId: number, page = 1) {
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new BadRequestException('Página inválida.');
    const rows = await this.db.$queryRaw<Array<{ orderId: number; revision: number; snapshot: Prisma.JsonValue }>>`SELECT "orderId",revision,snapshot FROM "FinanceArchive" WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(snapshot->'items') i WHERE (i->>'productId')::int=${productId}) ORDER BY "orderId" DESC LIMIT 200 OFFSET ${(page-1)*200}`;
    return rows.flatMap(row => (row.snapshot as unknown as FinanceOrder).items.filter(i => i.productId === productId).map(i => ({ orderId: row.orderId, revision: row.revision, itemId: i.id, quantity: i.quantity, title: i.title, financialSnapshot: i.financialSnapshot })));
  }
  async pointHistory(productId: number, page = 1) {
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new BadRequestException('Página inválida.');
    const entries = await this.db.$queryRaw<Array<{ id: string; saleId: string | null; pointId: string; description: string; lines: Prisma.JsonValue }>>`SELECT id,"saleId","pointId",description,lines FROM "PointEntry" WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(lines) l WHERE (l->>'productId')::int=${productId}) ORDER BY "occurredAt" DESC,"createdAt" DESC,id DESC LIMIT 200 OFFSET ${(page-1)*200}`;
    const effective = await applyPointCostRevisions(this.db, entries);
    const result: Array<Record<string, unknown>> = [];
    for (const entry of effective) for (const [lineIndex,line] of (entry.lines as unknown as PointDelta[]).entries()) {
      const quantity = Math.abs(line.unitsSold) || line.unitsReturned;
      if (line.productId !== productId || !quantity) continue;
      const revision = await this.db.inventoryPointCostRevision.findFirst({ where: { entryId: entry.id, lineIndex }, orderBy: { revision: 'desc' } });
      result.push({ entryId: entry.id, saleId: entry.saleId, description: entry.description, lineIndex, quantity, line, revision: revision?.revision ?? 0 });
    }
    return result;
  }
  async reconcilePoint(productId: number, dto: ReconcilePointLotDto, actor: number) {
    return this.db.$transaction(async tx => {
      const entry = await tx.pointEntry.findUnique({ where: { id: dto.entryId } });
      if (!entry) throw new NotFoundException('Movimiento no encontrado.');
      await tx.$queryRaw`SELECT id FROM "SalePoint" WHERE id=${entry.pointId} FOR UPDATE`;
      const previous = await tx.inventoryPointCostRevision.findFirst({ where: { entryId: entry.id, lineIndex: dto.lineIndex }, orderBy: { revision: 'desc' } });
      if ((previous?.revision ?? 0) !== dto.revision) throw new ConflictException('La conciliación ha cambiado. Recarga.');
      const original = (entry.lines as unknown as PointDelta[])[dto.lineIndex];
      const before = (previous?.after as unknown as PointDelta | undefined) ?? original;
      const quantity = Math.abs(original?.unitsSold ?? 0) || original?.unitsReturned;
      if (!original || original.productId !== productId || !quantity || dto.parts.reduce((s,p) => s+p.quantity,0) !== quantity || !dto.reason.trim()) throw new BadRequestException('Indica cantidades y evidencia correspondientes al movimiento.');
      const ids = [...new Set(dto.parts.map(p => p.lotId))];
      if (await tx.inventoryLot.count({ where: { id: { in: ids }, productId } }) !== ids.length) throw new BadRequestException('Lote ajeno al producto.');
      const parts: FrozenLotCost[] = [];
      for (const p of dto.parts) {
        if (p.adjustmentSourceKey) {
          if (entry.kind !== 'SALE' || !entry.saleId || before.lotCosts?.some(c => c.lotId !== 'unreconciled')) throw new BadRequestException('Vincula una salida solo a una venta original pendiente de lote.');
          const sale = await tx.pointSale.findUniqueOrThrow({ where: { id: entry.saleId } });
          const claimed = await claimAdjustedLots(tx, original.variantId, p.lotId, p.quantity, p.adjustmentSourceKey, sale.orderId ? 'order:' + sale.orderId : 'point:' + sale.id);
          parts.push(...claimed.map(c => ({ ...p, sliceId: c.sliceId, quantity: c.quantity })));
        } else parts.push({ ...p, sliceId: 'historical:' + entry.id + ':' + dto.lineIndex });
      }
      const preserved = retainPhysicalIdentity(before.lotCosts, parts);
      parts.splice(0, parts.length, ...preserved);
      const total = frozenCost(parts);
      const noRestock = original.unitsReturned > 0 && !await tx.stockMovement.findFirst({ where: { note: 'PointEntry:' + entry.id, variantId: original.variantId, delta: { gt: 0 } } });
      const sign = original.unitsSold < 0 || original.unitsReturned > 0 ? -1 : 1;
      const after: PointDelta = { ...before, lotCosts: parts, costCents: noRestock ? 0 : total === null ? null : sign*total };
      await tx.inventoryPointCostRevision.create({ data: { id: randomUUID(), entryId: entry.id, lineIndex: dto.lineIndex, revision: dto.revision+1, actorId: actor, reason: dto.reason, before: before as unknown as Prisma.InputJsonValue, after: after as unknown as Prisma.InputJsonValue } });
      if (entry.saleId && entry.kind === 'SALE') {
        const sale = await tx.pointSale.findUniqueOrThrow({ where: { id: entry.saleId } });
        const state = sale.state as unknown as PointState;
        const originalState = entry.after as unknown as PointState | null;
        const originalLineId = originalState?.lines?.[dto.lineIndex]?.id;
        const matching = state.lines.filter(l => l.variantId === original.variantId && (!originalLineId || l.id === originalLineId));
        if (matching.length === 1 && matching[0].quantity <= quantity) {
          matching[0].lotCosts = takeCosts(parts, matching[0].quantity, quantity-matching[0].quantity);
          await tx.pointSale.update({ where: { id: sale.id }, data: { state: state as unknown as Prisma.InputJsonValue, revision: { increment: 1 } } });
        }
      }
      for (const id of ids) await this.audit(tx, id, actor, dto.reason, { entryId: entry.id, lineIndex: dto.lineIndex, financial: before }, { entryId: entry.id, lineIndex: dto.lineIndex, financial: after, stockChanged: false });
      return { updated: true, revision: dto.revision+1 };
    });
  }
  async reconcileHistorical(productId: number, dto: ReconcileHistoricalLotDto, actor: number) {
    if (!dto.reason.trim()) throw new BadRequestException('Indica la evidencia y el motivo de conciliación.');
    return this.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(73421, ${dto.orderId}::int)`;
      const archive = await tx.financeArchive.findUnique({ where: { orderId: dto.orderId } });
      if (!archive || archive.revision !== dto.revision) throw new ConflictException('La venta ha cambiado. Recarga antes de conciliar.');
      if (await tx.pointSale.findUnique({ where: { orderId: dto.orderId } })) throw new ConflictException('La venta está vinculada a un punto; debe conciliarse desde su libro para evitar una doble imputación.');
      const snapshot = structuredClone(archive.snapshot) as unknown as FinanceOrder;
      const item = snapshot.items.find(i => i.id === dto.itemId && i.productId === productId);
      if (!item || dto.parts.reduce((s,p) => s+p.quantity,0) !== item.quantity) throw new BadRequestException('Las cantidades deben coincidir con la línea histórica.');
      const ids = [...new Set(dto.parts.map(p => p.lotId))];
      const lots = await tx.inventoryLot.findMany({ where: { id: { in: ids }, productId } });
      if (lots.length !== ids.length) throw new BadRequestException('Los lotes deben pertenecer al producto.');
      const before = structuredClone(item.financialSnapshot ?? null);
      const parts: FrozenLotCost[] = [];
      for (const p of dto.parts) {
        if (p.adjustmentSourceKey) {
          if (!item.variantId || before?.lotCosts?.some(c => c.lotId !== 'unreconciled')) throw new BadRequestException('Vincula salidas solo a líneas pendientes de lote.');
          const claimed = await claimAdjustedLots(tx, item.variantId, p.lotId, p.quantity, p.adjustmentSourceKey, 'order:' + dto.orderId);
          parts.push(...claimed.map(c => ({ ...p, sliceId: c.sliceId, quantity: c.quantity })));
        } else parts.push({ ...p, sliceId: 'historical:' + dto.itemId });
      }
      item.financialSnapshot = { productName: before?.productName ?? item.title, imageUrl: before?.imageUrl ?? null, unitCostCents: null, lotCosts: retainPhysicalIdentity(before?.lotCosts, parts) };
      const doc = snapshot as unknown as Prisma.InputJsonValue;
      await tx.financeArchive.update({ where: { orderId: dto.orderId }, data: { snapshot: doc, revision: { increment: 1 } } });
      await tx.financeArchiveRevision.create({ data: { orderId: dto.orderId, revision: archive.revision + 1, snapshot: doc } });
      await tx.orderItemFinancial.updateMany({ where: { itemId: dto.itemId }, data: { unitCostCents: null, lotCosts: item.financialSnapshot.lotCosts as unknown as Prisma.InputJsonValue } });
      for (const id of ids) await this.audit(tx, id, actor, dto.reason, { orderId: dto.orderId, itemId: dto.itemId, financialSnapshot: before }, { orderId: dto.orderId, itemId: dto.itemId, financialSnapshot: item.financialSnapshot, stockChanged: false });
      return { updated: true, revision: archive.revision + 1 };
    });
  }
  private async lock(tx: Tx, productId: number) {
    const rows = await tx.$queryRaw<Array<{ id: number; lotManaged: boolean; activeLotId?:string }>>`SELECT id,"lotManaged","activeLotId" FROM "Product" WHERE id=${productId} FOR UPDATE`;
    if (!rows.length) throw new NotFoundException('Producto no encontrado.');
    await tx.$queryRaw`SELECT id FROM "ProductVariant" WHERE "productId"=${productId} ORDER BY id FOR UPDATE`;
    return rows[0];
  }
  private async previewIn(tx: Tx, productId: number) {
    const variants = await tx.productVariant.findMany({ where: { productId }, select: { id: true, size: true, stockQty: true }, orderBy: { id: 'asc' } });
    const reserved = await tx.checkoutStockReservation.count({ where: { variantId: { in: variants.map(v => v.id) }, status: 'RESERVED' } });
    const historical = await tx.orderItem.findMany({ where: { productId }, select: { id: true, quantity: true, financialSnapshot: true }, orderBy: { id: 'asc' } });
    const proposal = { productId, variants, reserved, historical: historical.map(i => ({ itemId: i.id, quantity: i.quantity, cost: i.financialSnapshot?.unitCostCents ?? null, lot: null })) };
    return { ...proposal, previewHash: hash(proposal), warnings: ['El saldo disponible no acredita cantidades fabricadas ni fecha de recepción.', 'Las ventas previas conservan sus costes originales y quedan pendientes de identificación del lote.', ...(reserved ? ['Hay reservas activas: no se puede activar hasta que se liberen o consuman.'] : [])] };
  }
  async preview(productId: number) { return this.db.$transaction(async tx => { await this.lock(tx, productId); return this.previewIn(tx, productId); }); }
  async activate(productId: number, dto: ActivateLotsDto, actor: number) {
    return this.db.$transaction(async tx => {
      const product = await this.lock(tx, productId);
      if (product.lotManaged) return { activated: true };
      const preview = await this.previewIn(tx, productId);
      if (preview.previewHash !== dto.previewHash || preview.reserved) throw new ConflictException('El stock o las reservas han cambiado. Revisa la previsualización.');
      if (preview.variants.some(v => !Number.isSafeInteger(v.stockQty) || v.stockQty < 0)) throw new ConflictException('Concilia los saldos de stock inválidos antes de activar lotes.');
      const lotId = randomUUID();
      await tx.$executeRaw`INSERT INTO "InventoryLot" (id,"productId",name,"costQuality","openingBalance","requestKey","requestHash") VALUES (${lotId},${productId},'Saldo inicial pendiente de conciliación','UNKNOWN',true,${'opening:' + productId},${dto.previewHash})`;
      for (const v of preview.variants) if (v.stockQty > 0) await tx.$executeRaw`INSERT INTO "InventoryLotSlice" (id,"lotId","variantId",received,available) VALUES (${randomUUID()},${lotId},${v.id},${v.stockQty},${v.stockQty})`;
      await tx.product.update({ where: { id: productId }, data: { lotManaged: true } });
      await this.audit(tx, lotId, actor, 'Conciliación inicial: saldo verificable, costes y recepción desconocidos', null, preview);
      return { activated: true };
    });
  }
  async list(productId: number) {
    const product = await this.db.product.findUnique({ where: { id: productId }, select: { id: true, lotManaged: true, price: true, variants: { select: { id: true, size: true, stockQty: true } } } });
    if (!product) throw new NotFoundException('Producto no encontrado.');
    const lots = await this.db.$queryRaw<Array<Record<string, unknown>>>`SELECT l.*, COALESCE((SELECT jsonb_agg(s ORDER BY s."variantId",s.id) FROM "InventoryLotSlice" s WHERE s."lotId"=l.id),'[]') AS slices, COALESCE((SELECT jsonb_agg(a ORDER BY a."createdAt",a.id) FROM "InventoryLotAllocation" a JOIN "InventoryLotSlice" s ON s.id=a."sliceId" WHERE s."lotId"=l.id),'[]') AS allocations, COALESCE((SELECT jsonb_agg(h ORDER BY h."createdAt",h.id) FROM "InventoryLotAudit" h WHERE h."lotId"=l.id),'[]') AS history FROM "InventoryLot" l WHERE l."productId"=${productId} ORDER BY l."receivedAt" NULLS FIRST,l."createdAt",l.id`;
    return { product, lots };
  }
  async create(productId: number, key: string, dto: CreateLotDto, actor: number) {
    if (!key || key.length < 16 || key.length > 100) throw new BadRequestException('Clave de operación inválida.');
    const date = new Date(dto.receivedAt);
    if (!dto.name.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(dto.receivedAt) || !Number.isFinite(+date) || date.toISOString().slice(0, 10) !== dto.receivedAt) throw new BadRequestException('Indica nombre y fecha de recepción válidos.');
    const slices = receiptSlices(dto.lines, dto.freightTotalCents, dto.otherTotalCents);
    if (dto.costQuality === 'CONFIRMED' && slices.some(s => [s.productionCents, s.freightCents, s.otherCents].includes(null))) throw new BadRequestException('Completa todos los costes para confirmarlos.');
    const requestHash = hash({ productId, dto });
    return this.db.$transaction(async tx => {
      const product = await this.lock(tx, productId);
      if (product.activeLotId) throw new ConflictException('Crea las tiradas desde + en el editor del producto.');
      if (!product.lotManaged) throw new ConflictException('Revisa y acepta primero el saldo inicial.');
      const replay = await tx.$queryRaw<Array<{ id: string; requestHash: string }>>`SELECT id,"requestHash" FROM "InventoryLot" WHERE "requestKey"=${key}`;
      if (replay.length) {
        if (replay[0].requestHash !== requestHash) throw new ConflictException('Clave reutilizada con datos diferentes.');
        return { id: replay[0].id };
      }
      const variants = await tx.productVariant.findMany({ where: { productId }, select: { id: true } });
      if (dto.lines.some(l => !variants.some(v => v.id === l.variantId))) throw new BadRequestException('La variante no pertenece al producto.');
      const id = randomUUID();
      await tx.$executeRaw`INSERT INTO "InventoryLot" (id,"productId",name,"receivedAt",notes,"referencePriceCents","freightTotalCents","otherTotalCents","costQuality","requestKey","requestHash") VALUES (${id},${productId},${dto.name.trim()},${date},${dto.notes},${dto.referencePriceCents},${dto.freightTotalCents},${dto.otherTotalCents},${dto.costQuality},${key},${requestHash})`;
      for (const s of slices) await tx.$executeRaw`INSERT INTO "InventoryLotSlice" (id,"lotId","variantId",received,available,"productionCents","freightCents","otherCents") VALUES (${randomUUID()},${id},${s.variantId},${s.quantity},${s.quantity},${s.productionCents},${s.freightCents},${s.otherCents})`;
      for (const l of [...dto.lines].sort((a,b) => a.variantId-b.variantId)) {
        await tx.productVariant.update({ where: { id: l.variantId }, data: { stockQty: { increment: l.quantity } } });
        await tx.stockMovement.create({ data: { variantId: l.variantId, delta: l.quantity, reason: 'lot_receipt', note: 'Lote: ' + id, userId: actor } });
      }
      await this.audit(tx, id, actor, 'Recepción de lote', null, dto);
      return { id };
    });
  }
  async edit(productId: number, lotId: string, dto: EditLotDto, actor: number) {
    return this.db.$transaction(async tx => {
      await this.lock(tx, productId);
      const rows = await tx.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM "InventoryLot" WHERE id=${lotId} AND "productId"=${productId} FOR UPDATE`;
      if (!rows.length) throw new NotFoundException('Lote no encontrado.');
      if (rows[0].revision !== dto.revision) throw new ConflictException('Recarga el lote antes de guardar.');
      if (!dto.name.trim() || !dto.reason.trim()) throw new BadRequestException('Nombre y motivo obligatorios.');
      if (dto.receivedAt != null && (!/^\d{4}-\d{2}-\d{2}$/.test(dto.receivedAt) || !Number.isFinite(Date.parse(dto.receivedAt)) || new Date(dto.receivedAt).toISOString().slice(0,10) !== dto.receivedAt)) throw new BadRequestException('Fecha de recepción inválida.');
      await tx.$executeRaw`UPDATE "InventoryLot" SET name=${dto.name.trim()},notes=${dto.notes},archived=${dto.archived},revision=revision+1 WHERE id=${lotId}`;
      if (dto.receivedAt !== undefined) await tx.inventoryLot.update({ where: { id: lotId }, data: { receivedAt: dto.receivedAt ? new Date(dto.receivedAt) : null } });
      if (dto.referencePriceCents !== undefined) await tx.inventoryLot.update({ where: { id: lotId }, data: { referencePriceCents: dto.referencePriceCents } });
      await this.audit(tx, lotId, actor, dto.reason, rows[0], dto);
      return { updated: true };
    });
  }
  private async audit(tx: Tx, lotId: string, actor: number, reason: string, before: unknown, after: unknown) {
    await tx.$executeRaw`INSERT INTO "InventoryLotAudit" (id,"lotId","actorId",reason,before,after) VALUES (${randomUUID()},${lotId},${actor},${reason},${JSON.stringify(before)}::jsonb,${JSON.stringify(after)}::jsonb)`;
  }
  async correctCosts(productId: number, lotId: string, dto: CorrectLotCostsDto, actor: number) {
    const slices = receiptSlices(dto.lines, dto.freightTotalCents, dto.otherTotalCents);
    if (dto.costQuality === 'CONFIRMED' && slices.some(s => [s.productionCents, s.freightCents, s.otherCents].includes(null))) throw new BadRequestException('Completa los costes para confirmarlos.');
    if (!dto.reason.trim()) throw new BadRequestException('Indica el motivo de la corrección.');
    return this.db.$transaction(async tx => {
      await this.lock(tx, productId);
      const lot = await tx.inventoryLot.findFirst({ where: { id: lotId, productId }, include: { slices: { include: { allocations: true } } } });
      if (!lot) throw new NotFoundException('Lote no encontrado.');
      if (lot.revision !== dto.revision) throw new ConflictException('Recarga el lote.');
      if (lot.slices.some(s => s.allocations.length)) throw new ConflictException('Este lote tiene movimientos. Sus costes históricos deben conciliarse de forma explícita por venta; no se pueden reemplazar.');
      const quantities = new Map<number, number>();
      for (const s of lot.slices) quantities.set(s.variantId, (quantities.get(s.variantId) ?? 0) + s.received);
      if (quantities.size !== dto.lines.length || dto.lines.some(l => quantities.get(l.variantId) !== l.quantity)) throw new BadRequestException('La corrección de costes debe conservar las cantidades originales.');
      await tx.inventoryLotSlice.deleteMany({ where: { lotId } });
      for (const s of slices) await tx.inventoryLotSlice.create({ data: { id: randomUUID(), lotId, variantId: s.variantId, received: s.quantity, available: s.quantity, productionCents: s.productionCents, freightCents: s.freightCents, otherCents: s.otherCents } });
      await tx.inventoryLot.update({ where: { id: lotId }, data: { freightTotalCents: dto.freightTotalCents, otherTotalCents: dto.otherTotalCents, costQuality: dto.costQuality, revision: { increment: 1 } } });
      await this.audit(tx, lotId, actor, dto.reason, lot, dto);
      return { updated: true };
    });
  }
}
