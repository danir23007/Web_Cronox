import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
  Header,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { serializableTransaction } from '../../prisma/serializable-transaction';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { allocate, cents } from '../finance/financial-calculations';
import {
  allocateLots,
  projectLotStock,
  returnLots,
  sourceCosts,
  takeCosts,
} from '../../inventory-lots/lot-ledger';
import { FrozenLotCost, frozenCost } from '../../inventory-lots/lot-costs';
import { pricePointParts } from '../points/point-lot-costs';
import { HistorialService } from '../../historial/historial.service';
import { reconcileCircle2 } from '../../membership/circle-policy';
import { labelPresentation } from '../labels/label-presentation';
import { PointDelta } from '../points/point-calculations';

class HistoryQuery {
  @Type(() => Number) @IsInt() @Min(1) userId!: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
}
class UnitSelection {
  @IsInt() @Min(1) itemId!: number;
  @IsInt() @Min(0) ordinal!: number;
  @IsInt() @Min(0) version!: number;
  @IsOptional() @Matches(/^CR[XL][0-9]{10}$/) incomingCode?: string;
  @IsOptional() @Matches(/^CR[XL][0-9]{10}$/) outgoingCode?: string;
}
export class AfterSalePreviewDto {
  @IsIn(['RETURN', 'EXCHANGE']) kind!: 'RETURN' | 'EXCHANGE';
  @IsInt() @Min(1) userId!: number;
  @IsInt() @Min(1) orderId!: number;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => UnitSelection)
  units!: UnitSelection[];
  @IsBoolean() restock = false;
  @IsOptional() @IsString() @MaxLength(500) reason = '';
  @IsOptional()
  @IsIn(['EXTERNAL_STRIPE', 'BIZUM', 'CASH'])
  paymentMethod?: string;
  @IsOptional() @IsString() @MaxLength(120) externalReference?: string;
}
class AfterSaleConfirmDto extends AfterSalePreviewDto {
  @Matches(/^[a-zA-Z0-9_-]{16,80}$/) key!: string;
  @Matches(/^[a-f0-9]{64}$/) revision!: string;
  @IsBoolean() externalDone = false;
}
class ScanDto {
  @IsInt() @Min(1) userId!: number;
  @IsInt() @Min(1) orderId!: number;
  @IsInt() @Min(1) itemId!: number;
  @IsInt() @Min(0) ordinal!: number;
  @IsInt() @Min(0) version!: number;
  @IsIn(['IN', 'OUT']) direction!: 'IN' | 'OUT';
  @Matches(/^CR[XL][0-9]{10}$/) code!: string;
}
const include = {
  items: {
    orderBy: { id: 'asc' },
    include: { financialSnapshot: true, variant: true, afterSaleUnits: true },
  },
  pointSale: true,
  registerSale: { select: { receipt: true } },
  afterSales: { orderBy: { occurredAt: 'desc' } },
} satisfies Prisma.OrderInclude;
type Sale = Prisma.OrderGetPayload<{ include: typeof include }>;
const json = (v: unknown) => v as Prisma.InputJsonValue;
const digest = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
const paid = ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'];
function unitsOf(order: Sale) {
  const gross = order.items.map((i) => cents(i.lineTotal));
  const discounts = allocate(order.discountCents, gross);
  const net = gross.map((amount, i) => amount - discounts[i]);
  const taxByLine = allocate(cents(order.taxAmount), [
    ...net,
    order.shippingCost,
  ]);
  const valid =
    order.currency === 'EUR' &&
    gross.reduce((n, v) => n + v, 0) -
      order.discountCents +
      order.shippingCost ===
      cents(order.total);
  return order.items.flatMap((item, index) =>
    Array.from({ length: item.quantity }, (_, ordinal) => {
      const value = gross[index] - discounts[index];
      const saved = item.afterSaleUnits.find((u) => u.ordinal === ordinal);
      const parts = item.financialSnapshot?.lotCosts as
        | FrozenLotCost[]
        | null
        | undefined;
      let costs: FrozenLotCost[] = [];
      if (parts?.reduce((n, p) => n + p.quantity, 0) === item.quantity)
        costs = takeCosts(parts, 1, ordinal);
      const lotId =
        costs.length && new Set(costs.map((p) => p.lotId)).size === 1
          ? costs[0].lotId
          : null;
      const name = item.financialSnapshot?.productName || item.title;
      const receipt = order.registerSale?.receipt as
        | {
            items?: {
              variantId: number;
              lotId: string | null;
              color: string | null;
              image?: string | null;
            }[];
          }
        | undefined;
      const purchased = receipt?.items?.filter(
        (line) => line.variantId === item.variantId && line.lotId === lotId,
      );
      const unitValues = Array.from(
        { length: item.quantity },
        (_, i) =>
          Math.floor(value / item.quantity) +
          (i < value % item.quantity ? 1 : 0),
      );
      return {
        id: item.id + ':' + ordinal,
        itemId: item.id,
        ordinal,
        version: saved?.version ?? 0,
        purchasedQuantity: item.quantity,
        taxCents: allocate(taxByLine[index], unitValues)[ordinal],
        originalVariantId: item.variantId,
        variantId: saved?.variantId ?? item.variantId,
        productId: item.productId,
        name: labelPresentation({ name }).modelName,
        color:
          purchased?.length === 1
            ? purchased[0].color
            : labelPresentation({ name }).color,
        image:
          item.financialSnapshot?.imageUrl ??
          (purchased?.length === 1 ? purchased[0].image : null) ??
          null,
        originalSize: item.variant?.size ?? null,
        lotId: saved?.lotId ?? lotId,
        valueCents:
          saved?.valueCents ??
          Math.floor(value / item.quantity) +
            (ordinal < value % item.quantity ? 1 : 0),
        costParts: (saved?.costParts as FrozenLotCost[] | undefined) ?? costs,
        sourceKey: saved?.sourceKey ?? 'order:' + order.id,
        state: saved?.state ?? 'HELD',
        eligible:
          valid &&
          value >= 0 &&
          paid.includes(order.status) &&
          !!(saved?.lotId ?? lotId) &&
          !!(saved?.variantId ?? item.variantId),
      };
    }),
  );
}
@Injectable()
export class AfterSalesService {
  constructor(
    private readonly db: PrismaService,
    private readonly history: HistorialService,
  ) {}
  private async order(
    tx: Prisma.TransactionClient,
    id: number,
    userId: number,
  ) {
    const order = await tx.order.findFirst({ where: { id, userId }, include });
    if (!order)
      throw new NotFoundException(
        'La compra no pertenece a la cuenta seleccionada.',
      );
    return order;
  }
  async historyFor(userId: number, page: number) {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('Cliente no encontrado.');
    // Online orders use createdAt, physical orders purchasedAt. Re-sort by that common effective date in SQL-backed pagination.
    const rows = await this.db.$queryRaw<
      Array<{ id: number }>
    >`SELECT id FROM "Order" WHERE "userId"=${userId} ORDER BY COALESCE("purchasedAt","createdAt") DESC,id DESC OFFSET ${(page - 1) * 20} LIMIT 21`;
    const items = await this.db.order.findMany({
      where: { id: { in: rows.slice(0, 20).map((r) => r.id) } },
      select: {
        id: true,
        purchasedAt: true,
        createdAt: true,
        source: true,
        status: true,
        total: true,
      },
    });
    return {
      items: rows.slice(0, 20).map((r) => items.find((i) => i.id === r.id)),
      more: rows.length > 20,
    };
  }
  async detail(id: number, userId: number) {
    const order = await this.order(this.db, id, userId);
    const units = unitsOf(order),
      variants = await this.db.productVariant.findMany({
        where: {
          id: { in: units.flatMap((u) => (u.variantId ? [u.variantId] : [])) },
        },
        select: { id: true, size: true },
      });
    const lots = await this.db.inventoryLot.findMany({
      where: { id: { in: units.flatMap((u) => (u.lotId ? [u.lotId] : [])) } },
      select: { id: true, name: true },
    });
    return {
      id: order.id,
      source: order.source,
      status: order.status,
      date: order.purchasedAt ?? order.createdAt,
      units: units.map((u) => ({
        ...u,
        lotName: lots.find((l) => l.id === u.lotId)?.name ?? 'sin evidencia',
        size: variants.find((v) => v.id === u.variantId)?.size ?? '—',
        limitation: u.eligible
          ? null
          : 'Pedido no pagado o evidencia histórica de importe, variante o lote insuficiente.',
      })),
      history: order.afterSales.map((op) => op.receipt),
      point: order.pointSale?.pointId ?? null,
    };
  }
  private async barcode(
    tx: Prisma.TransactionClient,
    code: string,
    expectedLot: string,
  ) {
    if (!/^CR[XL][0-9]{10}$/.test(code || ''))
      throw new BadRequestException('Escanea un código de prenda válido.');
    const lot = await tx.physicalLotBarcode.findUnique({
      where: { code },
      include: { variant: true },
    });
    if (lot) {
      if (lot.lotId !== expectedLot)
        throw new ConflictException('El lote de la etiqueta no coincide.');
      return lot.variant;
    }
    const legacy = await tx.physicalBarcode.findUnique({
      where: { code },
      include: { variant: true },
    });
    if (!legacy?.variant) throw new NotFoundException('Código desconocido.');
    const possible = await tx.inventoryLot.findMany({
      where: { productId: legacy.variant.productId },
      select: {
        id: true,
        profile: true,
        slices: { select: { variantId: true } },
      },
    });
    const known = possible.filter(
      (l) =>
        (l.profile as { variants?: { id: number }[] } | null)?.variants?.some(
          (v) => v.id === legacy.variantId,
        ) || l.slices.some((s) => s.variantId === legacy.variantId),
    );
    if (known.length !== 1 || known[0].id !== expectedLot)
      throw new ConflictException(
        'El código antiguo no permite verificar el lote de forma inequívoca. Utiliza una etiqueta con lote.',
      );
    return legacy.variant;
  }
  async scan(data: ScanDto) {
    return this.db.$transaction(async (tx) => {
      const order = await this.order(tx, data.orderId, data.userId),
        unit = unitsOf(order).find(
          (u) => u.itemId === data.itemId && u.ordinal === data.ordinal,
        );
      if (
        !unit ||
        !unit.eligible ||
        unit.state !== 'HELD' ||
        unit.version !== data.version
      )
        throw new ConflictException(
          'La unidad no está disponible. Actualiza la compra.',
        );
      const variant = await this.barcode(tx, data.code, unit.lotId!);
      if (data.direction === 'IN' && variant.id !== unit.variantId)
        throw new ConflictException(
          'La talla entregada no coincide con la compra.',
        );
      if (data.direction === 'OUT') {
        if (variant.productId !== unit.productId)
          throw new ConflictException('El modelo o color no coincide.');
        if (variant.id === unit.variantId)
          throw new ConflictException('La talla debe ser diferente.');
        const lot = await tx.inventoryLot.findUniqueOrThrow({
          where: { id: unit.lotId! },
        });
        const stock = await tx.inventoryLotSlice.aggregate({
          where: { lotId: unit.lotId!, variantId: variant.id },
          _sum: { available: true },
        });
        if (
          lot.archived ||
          !(lot.profile as any)?.variants?.some(
            (v: any) => v.id === variant.id && v.isActive !== false,
          ) ||
          (stock._sum.available ?? 0) < 1
        )
          throw new ConflictException(
            'No hay stock vendible de esa talla en el lote.',
          );
      }
      return { variantId: variant.id, size: variant.size, lotId: unit.lotId };
    });
  }
  private async prepare(
    tx: Prisma.TransactionClient,
    data: AfterSalePreviewDto,
  ) {
    const order = await this.order(tx, data.orderId, data.userId);
    if (!paid.includes(order.status))
      throw new ConflictException(
        'La compra no admite devoluciones ni cambios en su estado actual.',
      );
    if (order.disputeLostCents > 0)
      throw new ConflictException(
        'Pedido con disputa pendiente de conciliación.',
      );
    if (
      new Set(data.units.map((u) => u.itemId + ':' + u.ordinal)).size !==
      data.units.length
    )
      throw new BadRequestException('Hay unidades duplicadas.');
    const all = unitsOf(order),
      selected = data.units.map((ref) => {
        const unit = all.find(
          (u) => u.itemId === ref.itemId && u.ordinal === ref.ordinal,
        );
        if (
          !unit ||
          !unit.eligible ||
          unit.state !== 'HELD' ||
          unit.version !== ref.version
        )
          throw new ConflictException(
            'La unidad ya se devolvió, cambió o carece de evidencia histórica suficiente. Actualiza la compra.',
          );
        return unit;
      });
    const needed = new Map<
      string,
      { source: string; variantId: number; sliceId: string; quantity: number }
    >();
    for (const unit of selected)
      for (const part of unit.costParts) {
        const key = JSON.stringify([
          unit.sourceKey,
          unit.variantId,
          part.sliceId,
        ]);
        const prior = needed.get(key);
        needed.set(key, {
          source: unit.sourceKey,
          variantId: unit.variantId!,
          sliceId: part.sliceId,
          quantity: (prior?.quantity ?? 0) + part.quantity,
        });
      }
    for (const allocation of needed.values()) {
      const available = await sourceCosts(
        tx,
        allocation.source,
        allocation.variantId,
      );
      if (
        available
          .filter((a) => a.sliceId === allocation.sliceId)
          .reduce((n, a) => n + a.quantity, 0) < allocation.quantity
      )
        throw new ConflictException(
          'Falta una asignación histórica inequívoca del inventario. Concilia el pedido antes de procesar la operación.',
        );
    }
    // Refuse unrelated/pending monetary refunds. Never infer garment quantities from money.
    const events = order.providerRef
      ? await tx.stripeWebhookEvent.findMany({
          where: {
            paymentIntentId: order.providerRef,
            type: {
              in: ['charge.refunded', 'refund.created', 'refund.updated'],
            },
          },
        })
      : [];
    const references = new Set(
      order.afterSales.flatMap((op) =>
        op.externalReference ? [op.externalReference] : [],
      ),
    );
    if (data.externalReference) references.add(data.externalReference);
    const latestRefunds = new Map<
      string,
      { refund: any; status: string; inventoryReview: boolean }
    >();
    for (const event of [...events].sort(
      (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
    )) {
      const payload = event.payload as any,
        object = payload?.data?.object;
      const refunds = event.type.startsWith('refund.')
        ? object?.id
          ? [object]
          : null
        : object?.refunds?.data;
      if (!Array.isArray(refunds) || object?.refunds?.has_more)
        throw new ConflictException(
          'Existe un reembolso pendiente o sin conciliar. Revisa su referencia y sus unidades antes de continuar.',
        );
      for (const refund of refunds)
        latestRefunds.set(refund.id, {
          refund,
          status: event.status,
          inventoryReview:
            event.status === 'REVIEW' &&
            event.error?.includes(
              'AFTER_SALE_REFUND_RECONCILIATION_REQUIRED',
            ) === true,
        });
    }
    for (const { refund, status, inventoryReview } of latestRefunds.values()) {
      const registered = order.afterSales.find(
        (op) => op.externalReference === refund.id,
      );
      if (
        (status !== 'PROCESSED' && !inventoryReview) ||
        refund.status !== 'succeeded' ||
        !references.has(refund.id) ||
        (registered && registered.refundCents !== refund.amount)
      )
        throw new ConflictException(
          'Existe un reembolso pendiente o sin conciliar. Revisa su referencia e importe antes de continuar.',
        );
    }
    if (order.pointSale) {
      const entries = await tx.pointEntry.findMany({
        where: { saleId: order.pointSale.id, kind: { not: 'SALE' } },
      });
      if (entries.some((e) => !(e.after as any)?.afterSaleKey))
        throw new ConflictException(
          'La compra tiene ajustes previos de otro flujo. Es necesaria su conciliación antes de operar en CAJA.',
        );
    }
    const pairs: {
      unitId: string;
      fromVariantId: number;
      toVariantId: number;
      fromSize: string;
      toSize: string;
      lotId: string;
    }[] = [];
    if (data.kind === 'EXCHANGE') {
      for (let i = 0; i < selected.length; i++) {
        const unit = selected[i],
          ref = data.units[i];
        const incoming = await this.barcode(tx, ref.incomingCode!, unit.lotId!);
        if (incoming.id !== unit.variantId)
          throw new ConflictException(
            'La prenda entregada no coincide con la talla actualmente conservada.',
          );
        const outgoing = await this.barcode(tx, ref.outgoingCode!, unit.lotId!);
        if (outgoing.productId !== unit.productId)
          throw new ConflictException('El modelo o color no coincide.');
        if (outgoing.id === incoming.id || outgoing.size === incoming.size)
          throw new ConflictException('Selecciona una talla diferente.');
        const lot = await tx.inventoryLot.findUniqueOrThrow({
          where: { id: unit.lotId! },
          include: { slices: true, product: true },
        });
        if (
          lot.archived ||
          !(lot.profile as any)?.variants?.some(
            (v: any) => v.id === outgoing.id && v.isActive !== false,
          )
        )
          throw new ConflictException(
            'La talla no está disponible en ese lote.',
          );
        pairs.push({
          unitId: unit.id,
          fromVariantId: incoming.id,
          toVariantId: outgoing.id,
          fromSize: incoming.size,
          toSize: outgoing.size,
          lotId: unit.lotId!,
        });
      }
      const required = new Map<string, number>();
      for (const pair of pairs)
        required.set(
          pair.lotId + ':' + pair.toVariantId,
          (required.get(pair.lotId + ':' + pair.toVariantId) ?? 0) + 1,
        );
      for (const pair of pairs) {
        const balance = await tx.inventoryLotSlice.aggregate({
          where: { lotId: pair.lotId, variantId: pair.toVariantId },
          _sum: { available: true },
        });
        if (
          (balance._sum.available ?? 0) <
          required.get(pair.lotId + ':' + pair.toVariantId)!
        )
          throw new ConflictException(
            'No hay stock suficiente de la talla de destino.',
          );
      }
    }
    const refundCents =
      data.kind === 'RETURN'
        ? selected.reduce((n, u) => n + u.valueCents, 0)
        : 0;
    if (
      order.provider === 'stripe' &&
      data.kind === 'RETURN' &&
      data.paymentMethod === 'EXTERNAL_STRIPE' &&
      !/^re_[A-Za-z0-9]+$/.test(data.externalReference || '')
    )
      throw new ConflictException(
        'Introduce la referencia real del reembolso Stripe externo para reconciliarlo con sus webhooks.',
      );
    if (data.externalReference) {
      const existing = await tx.afterSaleOperation.findUnique({
        where: { externalReference: data.externalReference },
      });
      if (existing)
        throw new ConflictException(
          'Esta referencia de reintegro ya se registró.',
        );
      for (const event of events) {
        const object = (event.payload as any)?.data?.object;
        const match = (
          event.type.startsWith('refund.') ? [object] : object?.refunds?.data
        )?.find((r: any) => r.id === data.externalReference);
        if (match && match.amount !== refundCents)
          throw new ConflictException(
            'El importe de la referencia externa no coincide con las unidades seleccionadas.',
          );
      }
    }
    const revision = digest({
      orderId: order.id,
      userId: data.userId,
      kind: data.kind,
      units: selected.map((u) => [
        u.id,
        u.version,
        u.variantId,
        u.lotId,
        u.valueCents,
      ]),
      pairs,
      restock: data.restock,
      reason: data.reason,
      paymentMethod: data.paymentMethod,
      externalReference: data.externalReference ?? null,
    });
    const reviewEventIds = events
      .filter(
        (e) =>
          e.status === 'REVIEW' &&
          e.error?.includes('AFTER_SALE_REFUND_RECONCILIATION_REQUIRED'),
      )
      .map((e) => e.id);
    return { order, selected, pairs, refundCents, revision, reviewEventIds };
  }
  async preview(data: AfterSalePreviewDto) {
    return this.db.$transaction(
      async (tx) => {
        const p = await this.prepare(tx, data);
        return {
          revision: p.revision,
          refundCents: p.refundCents,
          units: p.selected,
          pairs: p.pairs,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async recover(key: string, actor: number) {
    const op = await this.db.afterSaleOperation.findFirst({
      where: { key, actorId: actor },
    });
    if (!op)
      throw new NotFoundException(
        'La operación aún no consta registrada. Reintenta con la misma clave.',
      );
    return op.receipt;
  }
  private async receive(
    tx: Prisma.TransactionClient,
    unit: ReturnType<typeof unitsOf>[number],
    restock: boolean,
    key: string,
    actor: number,
    orderId: number,
  ) {
    const parts = unit.costParts;
    if (!parts.length)
      throw new ConflictException(
        'Falta la asignación histórica de inventario.',
      );
    const allocated = await sourceCosts(tx, unit.sourceKey, unit.variantId!);
    if (
      !parts.every((p) =>
        allocated.some(
          (a) => a.sliceId === p.sliceId && a.quantity >= p.quantity,
        ),
      )
    )
      throw new ConflictException(
        'No hay una asignación original inequívoca; debe conciliarse el inventario.',
      );
    await returnLots(
      tx,
      unit.variantId!,
      1,
      unit.sourceKey,
      false,
      parts,
      restock,
    );
    const receiptIds: string[] = [];
    if (restock) {
      for (const part of parts) {
        // Transfer the returned unit to a receipt valued at its frozen historical cost.
        await tx.$executeRaw`UPDATE "InventoryLotSlice" SET available=available-${part.quantity},received=received-${part.quantity} WHERE id=${part.sliceId}`;
        const returnedReceipt = await tx.inventoryLotSlice.create({
          data: {
            id: randomUUID(),
            lotId: unit.lotId!,
            variantId: unit.variantId!,
            received: part.quantity,
            available: part.quantity,
            productionCents: part.legacyUnitCostCents ?? part.productionCents,
            freightCents:
              part.legacyUnitCostCents !== undefined ? 0 : part.freightCents,
            otherCents:
              part.legacyUnitCostCents !== undefined ? 0 : part.otherCents,
          },
        });
        receiptIds.push(returnedReceipt.id);
      }
      await projectLotStock(tx, unit.variantId!);
    }
    await tx.inventoryLotAudit.create({
      data: {
        id: randomUUID(),
        lotId: unit.lotId!,
        actorId: actor,
        reason: restock
          ? 'Recepción de devolución al coste histórico'
          : 'Recepción no vendible, sin reposición',
        before: json({ sourceKey: unit.sourceKey, parts: unit.costParts }),
        after: json({
          afterSaleKey: key,
          unitId: unit.id,
          restock,
          receiptIds,
        }),
      },
    });
    const movement = await tx.stockMovement.create({
      data: {
        variantId: unit.variantId!,
        delta: restock ? 1 : 0,
        reason: restock ? 'after_sale_restock' : 'after_sale_unsellable',
        orderId,
        note: key + ' · ' + unit.id + ' · ' + actor,
      },
    });
    return { movementId: movement.id, receiptIds };
  }
  confirm(data: AfterSaleConfirmDto, actor: number) {
    const hash = digest({ ...data, actor });
    return serializableTransaction(
      this.db,
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'after-sale:' + data.key},0))`;
        const previous = await tx.afterSaleOperation.findUnique({
          where: { key: data.key },
        });
        if (previous) {
          if (previous.requestHash !== hash)
            throw new ConflictException(
              'Clave reutilizada con datos distintos.',
            );
          return previous.receipt;
        }
        await tx.$queryRaw`SELECT id FROM "User" WHERE id=${data.userId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${data.orderId} FOR UPDATE`;
        const p = await this.prepare(tx, data);
        if (p.revision !== data.revision)
          throw new ConflictException(
            'La compra o la selección cambió. Revisa el resumen.',
          );
        if (data.kind === 'EXCHANGE' && !data.restock)
          throw new BadRequestException(
            'Confirma el buen estado y la etiqueta de todas las unidades.',
          );
        if (
          data.kind === 'EXCHANGE' &&
          (data.paymentMethod || data.externalReference || data.externalDone)
        )
          throw new BadRequestException(
            'Un cambio de talla no admite movimientos de dinero ni referencias de reintegro.',
          );
        if (!data.restock && !data.reason.trim())
          throw new BadRequestException(
            'Indica el motivo y disposición de las prendas no vendibles.',
          );
        if (
          data.kind === 'RETURN' &&
          (!data.externalDone || !data.paymentMethod)
        )
          throw new BadRequestException(
            'Confirma expresamente que el reintegro externo se ha realizado y selecciona su método.',
          );
        const ids = [
          ...new Set([
            ...p.selected.map((u) => u.variantId!),
            ...p.pairs.map((pair) => pair.toVariantId),
          ]),
        ].sort((a, b) => a - b);
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "ProductVariant" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`,
        );
        const lines: PointDelta[] = [],
          changes: (ReturnType<typeof unitsOf>[number] & {
            toVariantId: number;
            fromSize: string | null;
            toSize: string | null;
            inMovement: string;
            outMovement: string | null;
            oldCostCents: number | null;
            newCostCents: number | null;
            restockedReceiptIds: string[];
            newSourceKey: string | null;
            newCostParts: FrozenLotCost[] | null;
          })[] = [];
        for (let i = 0; i < p.selected.length; i++) {
          const unit = p.selected[i],
            oldCost = frozenCost(unit.costParts),
            received = await this.receive(
              tx,
              unit,
              data.restock,
              data.key,
              actor,
              p.order.id,
            );
          const fromVariant = await tx.productVariant.findUniqueOrThrow({
            where: { id: unit.variantId! },
            select: { size: true },
          });
          let newVariant = unit.variantId!,
            newParts = unit.costParts,
            source = unit.sourceKey,
            outMovement: string | null = null;
          if (data.kind === 'EXCHANGE') {
            const pair = p.pairs[i];
            newVariant = pair.toVariantId;
            source = 'after-sale:' + data.key + ':' + unit.id;
            await allocateLots(tx, newVariant, 1, source, 'SOLD', unit.lotId!);
            const lot = await tx.inventoryLot.findUniqueOrThrow({
              where: { id: unit.lotId! },
              include: { product: { include: { privateCost: true } } },
            });
            newParts = pricePointParts(
              await sourceCosts(tx, source, newVariant),
              lot.id === lot.product.activeLotId
                ? {
                    ...lot,
                    profile: {
                      ...(lot.profile as object),
                      unitCostCents:
                        lot.product.privateCost?.unitCostCents ?? null,
                    },
                  }
                : lot,
            );
            const movement = await tx.stockMovement.create({
              data: {
                variantId: newVariant,
                delta: -1,
                reason: 'after_sale_exchange',
                orderId: p.order.id,
                note: data.key + ' · ' + unit.id,
              },
            });
            outMovement = movement.id;
          }
          const newCost = frozenCost(newParts);
          const base = {
            lineId: unit.id,
            productId: unit.productId,
            variantId: unit.variantId!,
            name: unit.name,
            size: fromVariant.size,
            commissionCents: 0,
            unitsSold: 0,
            unitsReturned: data.kind === 'RETURN' ? 1 : 0,
          };
          lines.push({
            ...base,
            revenueCents: data.kind === 'RETURN' ? -unit.valueCents : 0,
            costCents: data.restock ? (oldCost === null ? null : -oldCost) : 0,
            ...(data.restock ? { lotCosts: unit.costParts, costSign: -1 } : {}),
          });
          if (data.kind === 'EXCHANGE')
            lines.push({
              ...base,
              variantId: newVariant,
              size: p.pairs[i].toSize,
              unitsReturned: 0,
              revenueCents: 0,
              costCents: newCost,
              lotCosts: newParts,
              costSign: 1,
            });
          await tx.afterSaleUnit.upsert({
            where: {
              itemId_ordinal: { itemId: unit.itemId, ordinal: unit.ordinal },
            },
            create: {
              id: unit.id,
              itemId: unit.itemId,
              ordinal: unit.ordinal,
              variantId: newVariant,
              lotId: unit.lotId!,
              valueCents: unit.valueCents,
              costParts: json(newParts),
              sourceKey: source,
              state: data.kind === 'RETURN' ? 'RETURNED' : 'HELD',
              version: 1,
            },
            update: {
              variantId: newVariant,
              costParts: json(newParts),
              sourceKey: source,
              state: data.kind === 'RETURN' ? 'RETURNED' : 'HELD',
              version: { increment: 1 },
            },
          });
          changes.push({
            ...unit,
            toVariantId: newVariant,
            fromSize: fromVariant.size,
            toSize: p.pairs[i]?.toSize ?? null,
            inMovement: received.movementId,
            outMovement,
            restockedReceiptIds: received.receiptIds,
            newSourceKey: data.kind === 'EXCHANGE' ? source : null,
            newCostParts: data.kind === 'EXCHANGE' ? newParts : null,
            oldCostCents: oldCost,
            newCostCents: data.kind === 'EXCHANGE' ? newCost : null,
          });
        }
        const taxCents =
          data.kind === 'RETURN'
            ? p.selected.reduce((n, u) => n + u.taxCents, 0)
            : 0;
        const now = new Date(),
          receipt = {
            key: data.key,
            kind: data.kind,
            orderId: p.order.id,
            userId: data.userId,
            source: p.order.source,
            pointId: p.order.pointSale?.pointId ?? null,
            occurredAt: now.toISOString(),
            refundCents: p.refundCents,
            taxCents,
            paymentMethod: data.paymentMethod ?? null,
            externalReference: data.externalReference ?? null,
            confirmationMode: 'MANUAL_EXTERNAL',
            restock: data.restock,
            reason: data.reason,
            units: changes,
          };
        await tx.afterSaleOperation.create({
          data: {
            key: data.key,
            requestHash: hash,
            kind: data.kind,
            orderId: data.orderId,
            userId: data.userId,
            actorId: actor,
            occurredAt: now,
            pointId: receipt.pointId,
            refundCents: p.refundCents,
            taxCents,
            paymentMethod: data.paymentMethod,
            externalReference: data.externalReference || null,
            restock: data.restock,
            reason: data.reason,
            lines: json(lines),
            receipt: json(receipt),
          },
        });
        if (p.reviewEventIds.length)
          await tx.stripeWebhookEvent.updateMany({
            where: {
              id: { in: p.reviewEventIds },
              status: 'REVIEW',
              error: { contains: 'AFTER_SALE_REFUND_RECONCILIATION_REQUIRED' },
            },
            data: { status: 'PENDING', error: null, nextAttemptAt: new Date() },
          });
        if (p.order.pointSale) {
          await tx.pointEntry.create({
            data: {
              pointId: p.order.pointSale.pointId,
              saleId: p.order.pointSale.id,
              requestKey: 'after-sale:' + data.key,
              requestHash: hash,
              kind: data.kind === 'EXCHANGE' ? 'CORRECTION' : 'RETURN',
              occurredAt: now,
              actorId: actor,
              description:
                data.kind === 'RETURN'
                  ? 'Devolución CAJA'
                  : 'Cambio de talla CAJA',
              after: json({ afterSaleKey: data.key }),
              lines: json(lines),
            },
          });
        }
        await this.history.syncFromOrders(data.userId, tx);
        await reconcileCircle2(tx, data.userId, now);
        await tx.auditLog.create({
          data: {
            actorId: actor,
            action: 'admin.register.after-sale',
            actionType: 'admin.register.after-sale',
            targetType: 'order',
            targetId: String(data.orderId),
            metadata: json({ key: data.key, kind: data.kind }),
          },
        });
        return receipt;
      },
      true,
    );
  }
}
@Controller('admin/register/after-sales')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AfterSalesController {
  constructor(private readonly service: AfterSalesService) {}
  @Get('orders') @Header('Cache-Control', 'no-store') orders(
    @Query() q: HistoryQuery,
  ) {
    return this.service.historyFor(q.userId, q.page);
  }
  @Get('orders/:id') @Header('Cache-Control', 'no-store') detail(
    @Param('id', ParseIntPipe) id: number,
    @Query() q: HistoryQuery,
  ) {
    return this.service.detail(id, q.userId);
  }
  @Post('preview') @Header('Cache-Control', 'no-store') preview(
    @Body() d: AfterSalePreviewDto,
  ) {
    return this.service.preview(d);
  }
  @Post('scan') @Header('Cache-Control', 'no-store') scan(@Body() d: ScanDto) {
    return this.service.scan(d);
  }
  @Post('confirm') @Header('Cache-Control', 'no-store') confirm(
    @Body() d: AfterSaleConfirmDto,
    @CurrentUser('id') actor: number,
  ) {
    return this.service.confirm(d, actor);
  }
  @Get('operations/:key') @Header('Cache-Control', 'no-store') recover(
    @Param('key') key: string,
    @CurrentUser('id') actor: number,
  ) {
    return this.service.recover(key, actor);
  }
}
