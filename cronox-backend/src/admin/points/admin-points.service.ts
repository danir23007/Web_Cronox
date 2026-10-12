import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { configuredManualCost } from '../finance/historical-cost';
import {
  madridMidnight,
  nextDate,
  validateRange,
} from '../finance/financial-calculations';
import { ExpenseDto, PointDto, ReturnDto, SaleDto, SaleDateDto } from './point.dto';
import {
  calculatePoints,
  commission,
  lineDelta,
  PointDelta,
  pointDate,
  PointLine,
  PointState,
} from './point-calculations';
type Tx = Prisma.TransactionClient;
const json = (value: unknown) => value as Prisma.InputJsonValue;

@Injectable()
export class AdminPointsService {
  constructor(private readonly prisma: PrismaService) {}
  private async operation(
    actor: number,
    key: string,
    payload: unknown,
    run: (tx: Tx, hash: string) => Promise<unknown>,
  ) {
    if (!/^[a-zA-Z0-9_-]{16,100}$/.test(key || ''))
      throw new BadRequestException('Falta una clave de operación válida.');
    const hash = createHash('sha256')
      .update(JSON.stringify({ actor, payload }))
      .digest('hex');
    // Advisory request lock serializes concurrent retries before inspecting stock.
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
        const previous = await tx.pointEntry.findUnique({
          where: { requestKey: key },
        });
        if (previous) {
          if (previous.requestHash !== hash)
            throw new ConflictException(
              'Clave reutilizada con datos distintos.',
            );
          return previous;
        }
        return run(tx, hash);
      },
      { timeout: 30000 },
    );
  }
  private async point(tx: Tx, id: string, allowArchived = false) {
    await tx.$queryRaw`SELECT id FROM "SalePoint" WHERE id = ${id} FOR UPDATE`;
    const point = await tx.salePoint.findUnique({ where: { id } });
    if (!point) throw new NotFoundException('Punto no encontrado.');
    if (point.archived && !allowArchived)
      throw new ConflictException(
        'Punto archivado. Reactívalo para registrar ventas o gastos.',
      );
    return point;
  }
  private async audit(
    tx: Tx,
    actorId: number,
    targetId: string,
    actionType: string,
    metadata: unknown,
  ) {
    await tx.auditLog.create({
      data: {
        actorId,
        targetId,
        targetType: 'SALE_POINT',
        actionType,
        metadata: json(metadata),
      },
    });
  }
  async options() {
    const variants = await this.prisma.productVariant.findMany({
      where: { isActive: true, product: { isActive: true } },
      include: { product: { include: { privateCost: true } } },
      orderBy: [{ productId: 'asc' }, { size: 'asc' }],
    });
    return variants.map((v) => ({
      id: v.id,
      productId: v.productId,
      name: v.product.name,
      size: v.size,
      stock: v.stockQty,
      unitCostCents: configuredManualCost(v.product.privateCost),
      currency: v.product.currency,
    }));
  }
  async list(search = '') {
    const points = await this.prisma.salePoint.findMany({
      where: search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { city: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {},
      orderBy: [{ archived: 'asc' }, { createdAt: 'desc' }],
    });
    const entries = await this.prisma.pointEntry.findMany({
      where: { pointId: { in: points.map((p) => p.id) } },
      select: {
        pointId: true,
        kind: true,
        occurredAt: true,
        lines: true,
        expenseCents: true,
        after: true,
      },
    });
    return points.map((point) => ({
      ...point,
      totals: calculatePoints(
        entries.filter((e) => e.pointId === point.id),
        '2000-01-01',
        '2100-12-31',
        'months',
      ).totals,
    }));
  }
  async savePoint(actor: number, key: string, dto: PointDto, id?: string) {
    if (!dto.name.trim())
      throw new BadRequestException('El nombre es obligatorio.');
    if (dto.startsOn) validateRange(dto.startsOn, dto.startsOn);
    if (dto.endsOn) validateRange(dto.endsOn, dto.endsOn);
    if (dto.startsOn && dto.endsOn) validateRange(dto.startsOn, dto.endsOn);
    return this.operation(actor, key, { id, dto }, async (tx, hash) => {
      const before = id ? await this.point(tx, id, true) : null;
      if (before && before.revision !== dto.revision)
        throw new ConflictException(
          'El punto ha cambiado. Recarga antes de editar.',
        );
      const data = {
        name: dto.name.trim(),
        type: dto.type,
        city: dto.city,
        venue: dto.venue,
        notes: dto.notes,
        startsOn: dto.startsOn || null,
        endsOn: dto.endsOn || null,
        commissionBp: dto.commissionBp,
        archived: dto.archived,
      };
      const point = id
        ? await tx.salePoint.update({
            where: { id },
            data: { ...data, revision: { increment: 1 } },
          })
        : await tx.salePoint.create({ data });
      const amount = !id ? (dto.participationCents ?? 0) : 0;
      if (!id && dto.participationCents !== undefined && !dto.expenseDate)
        throw new BadRequestException(
          'Indica la fecha del gasto de participación.',
        );
      const entry = await tx.pointEntry.create({
        data: {
          pointId: point.id,
          requestKey: key,
          requestHash: hash,
          kind: id ? 'POINT_EDIT' : 'POINT_CREATE',
          actorId: actor,
          occurredAt:
            !id && dto.expenseDate ? pointDate(dto.expenseDate) : new Date(),
          description: id ? 'Editar punto' : 'Participación inicial',
          expenseCents: amount,
          before: before ? json(before) : Prisma.JsonNull,
          after: json(point),
          lines: [],
        },
      });
      await this.audit(tx, actor, point.id, entry.kind, { entryId: entry.id });
      return entry;
    });
  }
  private async snapshot(tx: Tx, dto: SaleDto, old: PointLine[] = []) {
    if (
      new Set(dto.lines.filter((l) => l.id).map((l) => l.id)).size !==
      dto.lines.filter((l) => l.id).length
    )
      throw new BadRequestException('Líneas repetidas.');
    const result: PointLine[] = [];
    for (const input of dto.lines) {
      const previous = input.id
        ? old.find((l) => l.id === input.id)
        : undefined;
      if (input.id && (!previous || previous.variantId !== input.variantId))
        throw new BadRequestException('Identificador de línea inválido.');
      const variant = await tx.productVariant.findUnique({
        where: { id: input.variantId },
        include: { product: { include: { privateCost: true } } },
      });
      if (
        !variant ||
        (!previous && (!variant.isActive || !variant.product.isActive))
      )
        throw new BadRequestException(
          `Variante #${input.variantId} no disponible.`,
        );
      if (variant.product.currency !== 'EUR')
        throw new BadRequestException('Los puntos de venta trabajan en EUR.');
      const cost = previous
        ? previous.unitCostCents
        : configuredManualCost(variant.product.privateCost);
      if (cost === null)
        throw new BadRequestException(
          `Falta el coste de ${variant.product.name} (#${variant.productId}). Configúralo antes de registrar la venta.`,
        );
      // A correction reprices the remaining units only. Commission retained (or
      // recovered above the proportional amount) on earlier returns is preserved.
      const returnedCommission = previous
        ? previous.commissionCents -
          commission(
            previous.unitPriceCents * previous.quantity,
            previous.commissionBp,
          )
        : 0;
      const fee =
        commission(input.unitPriceCents * input.quantity, input.commissionBp) +
        returnedCommission;
      if (fee < 0)
        throw new BadRequestException(
          'La corrección dejaría una comisión negativa tras las recuperaciones anteriores. Revisa los importes.',
        );
      result.push({
        id: previous?.id ?? randomUUID(),
        variantId: variant.id,
        productId: variant.productId,
        name: previous?.name ?? variant.product.name,
        size: variant.size,
        quantity: input.quantity,
        unitPriceCents: input.unitPriceCents,
        unitCostCents: cost,
        commissionBp: input.commissionBp,
        commissionCents: fee,
        returned: previous?.returned ?? 0,
      });
    }
    if (old.some((l) => l.returned && !result.some((n) => n.id === l.id)))
      throw new ConflictException(
        'Conserva las líneas con devoluciones en la corrección.',
      );
    if (
      result.some((l) => l.unitCostCents * l.quantity > 1000000000) ||
      result.reduce((s, l) => s + l.quantity * l.unitPriceCents, 0) > 1000000000
    )
      throw new BadRequestException('La venta supera el importe máximo.');
    return result;
  }
  private async stock(
    tx: Tx,
    changes: Map<number, number>,
    actor: number,
    entryId: string,
  ) {
    for (const [variantId, delta] of [...changes].sort(([a], [b]) => a - b)) {
      if (!delta) continue;
      const changed = await tx.productVariant.updateMany({
        where: {
          id: variantId,
          ...(delta < 0 ? { stockQty: { gte: -delta } } : {}),
        },
        data: { stockQty: { increment: delta } },
      });
      if (!changed.count)
        throw new ConflictException(
          `Stock insuficiente en variante #${variantId}.`,
        );
      await tx.stockMovement.create({
        data: {
          variantId,
          delta,
          userId: actor,
          reason: 'point_sale',
          note: `PointEntry:${entryId}`,
        },
      });
    }
  }
  async sale(
    pointId: string,
    actor: number,
    key: string,
    dto: SaleDto,
    saleId?: string,
  ) {
    const occurredAt = pointDate(dto.occurredAt);
    if (dto.stockHandling !== undefined && !['DEDUCT_NOW', 'ALREADY_ADJUSTED'].includes(dto.stockHandling))
      throw new BadRequestException('Selecciona cómo gestionar el stock.');
    const stockHandling = dto.stockHandling ?? 'DEDUCT_NOW';
    return this.operation(
      actor,
      key,
      { pointId, saleId, dto },
      async (tx, hash) => {
        await this.point(tx, pointId, !!saleId);
        const previous = saleId
          ? await tx.pointSale.findUnique({ where: { id: saleId } })
          : null;
        if (saleId && (!previous || previous.pointId !== pointId))
          throw new NotFoundException('Venta no encontrada.');
        if (
          previous &&
          (previous.revision !== dto.revision || !dto.reason?.trim())
        )
          throw new ConflictException(
            'Indica el motivo y utiliza la revisión actual de la venta.',
          );
        if (previous && occurredAt < previous.soldAt)
          throw new BadRequestException(
            'La corrección no puede preceder a la venta.',
          );
        if (previous) {
          const last = await this.lastSaleAdjustment(tx, saleId!);
          if (last && occurredAt < last.occurredAt)
            throw new BadRequestException(
              'La corrección no puede preceder al último movimiento.',
            );
        }
        const before = previous?.state as unknown as PointState | undefined;
        const lines = await this.snapshot(tx, dto, before?.lines);
        if (
          !previous &&
          (!lines.some((l) => l.quantity > 0) || lines.some((l) => !l.quantity))
        )
          throw new BadRequestException('La cantidad debe ser mayor que cero.');
        const state: PointState = {
          stockHandling,
          lines,
          note: dto.note,
          paymentMethod: dto.paymentMethod,
        };
        const sale = previous
          ? await tx.pointSale.update({
              where: { id: saleId },
              data: { state: json(state), revision: { increment: 1 } },
            })
          : await tx.pointSale.create({
              data: { pointId, soldAt: occurredAt, state: json(state) },
            });
        const deltas = [
          ...(before?.lines ?? []).map((l) => lineDelta(l, -1)),
          ...lines.map((l) => lineDelta(l)),
        ];
        const entry = await tx.pointEntry.create({
          data: {
            pointId,
            saleId: sale.id,
            requestKey: key,
            requestHash: hash,
            actorId: actor,
            kind: previous ? 'CORRECTION' : 'SALE',
            occurredAt,
            description: dto.reason?.trim() || dto.note || 'Venta',
            before: before ? json(before) : Prisma.JsonNull,
            after: json(state),
            lines: json(deltas),
          },
        });
        const changes = new Map<number, number>();
        for (const d of deltas)
          changes.set(
            d.variantId,
            (changes.get(d.variantId) ?? 0) - d.unitsSold,
          );
        if (stockHandling === 'DEDUCT_NOW') await this.stock(tx, changes, actor, entry.id);
        await this.audit(tx, actor, pointId, entry.kind, {
          entryId: entry.id,
          saleId: sale.id,
          stockHandling,
        });
        return entry;
      },
    );
  }
  private async lastSaleAdjustment(tx: Tx, saleId: string) {
    const entries = await tx.pointEntry.findMany({
      where: { saleId, kind: { in: ['CORRECTION', 'RETURN'] } }, orderBy: { occurredAt: 'desc' },
    });
    return entries.find(entry => !(entry.after as { dateTransfer?: boolean } | null)?.dateTransfer);
  }
  async changeSaleDate(pointId: string, saleId: string, actor: number, key: string, dto: SaleDateDto) {
    const soldAt = pointDate(dto.occurredAt);
    return this.operation(actor, key, { action: 'sale-date', pointId, saleId, dto }, async (tx, hash) => {
      await this.point(tx, pointId, true);
      const sale = await tx.pointSale.findUnique({ where: { id: saleId } });
      if (!sale || sale.pointId !== pointId) throw new NotFoundException('Venta no encontrada.');
      if (sale.revision !== dto.revision || !dto.reason?.trim())
        throw new ConflictException('Indica el motivo y utiliza la revisión actual de la venta.');
      const entries = await tx.pointEntry.findMany({ where: { saleId }, orderBy: { occurredAt: 'asc' } });
      const original = entries.find(entry => entry.kind === 'SALE');
      if (!original) throw new ConflictException('No se encuentra el registro original de la venta.');
      const movement = entries.find(entry => entry.kind !== 'SALE' && !(entry.after as { dateTransfer?: boolean } | null)?.dateTransfer && Array.isArray(entry.lines) && entry.lines.length > 0);
      if (movement && soldAt > movement.occurredAt)
        throw new BadRequestException('La fecha de venta no puede ser posterior a una corrección o devolución existente.');
      const before = { soldAt: sale.soldAt.toISOString() }, after = { soldAt: soldAt.toISOString() };
      await tx.pointSale.update({ where: { id: saleId }, data: { soldAt, revision: { increment: 1 } } });
      // The ledger is append-only. Transfer the original sale through two
      // compensating entries, including its count, without changing stock.
      const lines = original.lines as unknown as PointDelta[];
      const entry = await tx.pointEntry.create({ data: {
        pointId, saleId, actorId: actor, requestKey: key, requestHash: hash,
        kind: 'CORRECTION', occurredAt: soldAt, description: `Cambio de fecha: ${dto.reason.trim()}`,
        before, after: { ...after, dateTransfer: true, salesCountDelta: 1 }, lines: json(lines),
      } });
      await tx.pointEntry.create({ data: {
        pointId, saleId, actorId: actor, requestKey: randomUUID(), requestHash: hash,
        kind: 'CORRECTION', occurredAt: sale.soldAt, description: `Traslado de la fecha anterior: ${dto.reason.trim()}`,
        before, after: { ...after, dateTransfer: true, salesCountDelta: -1 },
        lines: json(lines.map(line => ({ ...line, revenueCents: -line.revenueCents,
          costCents: -line.costCents, commissionCents: -line.commissionCents,
          unitsSold: -line.unitsSold, unitsReturned: -line.unitsReturned }))),
      } });
      await this.audit(tx, actor, pointId, 'SALE_DATE_CHANGE', { saleId, entryId: entry.id, before, after });
      return entry;
    });
  }
  async refund(
    pointId: string,
    saleId: string,
    actor: number,
    key: string,
    dto: ReturnDto,
  ) {
    const occurredAt = pointDate(dto.occurredAt);
    if (
      !dto.reason.trim() ||
      new Set(dto.lines.map((l) => l.id)).size !== dto.lines.length
    )
      throw new BadRequestException(
        'Indica el motivo y una sola devolución por línea.',
      );
    return this.operation(
      actor,
      key,
      { pointId, saleId, dto },
      async (tx, hash) => {
        await this.point(tx, pointId, true);
        const sale = await tx.pointSale.findUnique({ where: { id: saleId } });
        if (!sale || sale.pointId !== pointId)
          throw new NotFoundException('Venta no encontrada.');
        if (sale.revision !== dto.revision)
          throw new ConflictException(
            'La venta ha cambiado. Recarga antes de devolver.',
          );
        const last = await this.lastSaleAdjustment(tx, saleId);
        if (occurredAt < sale.soldAt || (last && occurredAt < last.occurredAt))
          throw new BadRequestException(
            'La devolución no puede preceder al último movimiento.',
          );
        const before = sale.state as unknown as PointState,
          after: PointState = structuredClone(before);
        const deltas: PointDelta[] = [],
          changes = new Map<number, number>();
        for (const input of dto.lines) {
          const line = after.lines.find((l) => l.id === input.id);
          if (
            !line ||
            input.quantity > line.quantity ||
            input.recoveredCommissionCents > line.commissionCents
          )
            throw new BadRequestException(
              'Cantidad o comisión recuperada superior al saldo de la línea.',
            );
          deltas.push({
            ...lineDelta(line),
            revenueCents: -input.quantity * line.unitPriceCents,
            costCents: input.restock ? -input.quantity * line.unitCostCents : 0,
            commissionCents: -input.recoveredCommissionCents,
            unitsSold: 0,
            unitsReturned: input.quantity,
          });
          line.quantity -= input.quantity;
          line.returned += input.quantity;
          line.commissionCents -= input.recoveredCommissionCents;
          if (input.restock)
            changes.set(
              line.variantId,
              (changes.get(line.variantId) ?? 0) + input.quantity,
            );
        }
        await tx.pointSale.update({
          where: { id: saleId },
          data: { state: json(after), revision: { increment: 1 } },
        });
        const entry = await tx.pointEntry.create({
          data: {
            pointId,
            saleId,
            actorId: actor,
            requestKey: key,
            requestHash: hash,
            kind: 'RETURN',
            occurredAt,
            description: dto.reason,
            before: json(before),
            after: json(after),
            lines: json(deltas),
          },
        });
        await this.stock(tx, changes, actor, entry.id);
        await this.audit(tx, actor, pointId, entry.kind, { entryId: entry.id });
        return entry;
      },
    );
  }
  async expense(pointId: string, actor: number, key: string, dto: ExpenseDto) {
    if (!dto.description.trim())
      throw new BadRequestException('La descripción es obligatoria.');
    const occurredAt = pointDate(dto.occurredAt);
    return this.operation(actor, key, { pointId, dto }, async (tx, hash) => {
      await this.point(tx, pointId, !!dto.reversesId);
      let amount = dto.amountCents;
      if (dto.reversesId) {
        const original = await tx.pointEntry.findUnique({
          where: { id: dto.reversesId },
        });
        if (
          !original ||
          original.pointId !== pointId ||
          original.expenseCents < 0 ||
          !['EXPENSE', 'POINT_CREATE'].includes(original.kind) ||
          occurredAt < original.occurredAt
        )
          throw new BadRequestException('Gasto original inválido.');
        if (
          await tx.pointEntry.findUnique({
            where: { reversesId: dto.reversesId },
          })
        )
          throw new ConflictException('El gasto ya está anulado.');
        amount = -original.expenseCents;
      }
      const entry = await tx.pointEntry.create({
        data: {
          pointId,
          actorId: actor,
          requestKey: key,
          requestHash: hash,
          kind: dto.reversesId ? 'EXPENSE_REVERSAL' : 'EXPENSE',
          occurredAt,
          description: dto.description,
          expenseCents: amount,
          reversesId: dto.reversesId,
          lines: [],
        },
      });
      await this.audit(tx, actor, pointId, entry.kind, { entryId: entry.id });
      return entry;
    });
  }
  async detail(id: string, from: string, to: string, search = '', productId?: number) {
    validateRange(from, to);
    if (productId !== undefined && (!Number.isSafeInteger(productId) || productId < 1)) throw new BadRequestException('Producto inválido.');
    return this.prisma.$transaction(
      async (tx) => {
        const point = await tx.salePoint.findUnique({ where: { id } });
        if (!point) throw new NotFoundException('Punto no encontrado.');
        const entries = await tx.pointEntry.findMany({
          where: {
            pointId: id,
            occurredAt: {
              gte: madridMidnight(from),
              lt: madridMidnight(nextDate(to)),
            },
          },
          orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
        });
        const sales = await tx.pointSale.findMany({
          where: {
            pointId: id,
            OR: [
              {
                soldAt: {
                  gte: madridMidnight(from),
                  lt: madridMidnight(nextDate(to)),
                },
              },
              {
                id: {
                  in: entries.flatMap((e) => (e.saleId ? [e.saleId] : [])),
                },
              },
            ],
          },
          orderBy: { soldAt: 'desc' },
        });
        const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
        const matches = (lines: { productId: number; name: string }[]) => lines.some(line => productId !== undefined
          ? line.productId === productId
          : normalize(line.name).includes(normalize(search.trim())) || String(line.productId) === search.trim());
        return {
          point,
          report: calculatePoints(entries, from, to),
          sales: sales.filter(
            (s) => (!search && productId === undefined) || matches((s.state as unknown as PointState).lines),
          ),
          entries: entries.filter(
            (e) => (!search && productId === undefined) || matches(e.lines as unknown as { productId: number; name: string }[]) || sales.some(s => s.id === e.saleId && matches((s.state as unknown as PointState).lines)),
          ),
          range: { from, to, timeZone: 'Europe/Madrid' },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
