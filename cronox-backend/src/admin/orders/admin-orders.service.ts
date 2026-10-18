import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminOrdersQueryDto } from './dto/admin-order-query.dto';
import { HistorialService } from '../../historial/historial.service';
import { UpdateOrderFulfillmentDto } from './dto/update-order-fulfillment.dto';
import { EmailService } from '../../email/email.service';
import { StripeService } from '../../payments/stripe.service';
import { OrdersService } from '../../orders/orders.service';
import { toCountryDisplayName } from '../../common/country';
import { buildCorreosTrackingUrl, normalizeCorreosTrackingNumber, trackingBatchError } from '../../shipping-tracking/tracking-links';
import { eligibleTrackingOrder } from '../../shipping-tracking/tracking.service';
import { eligibleFulfillmentOrder, recordManualFulfillment } from '../../shipping-tracking/fulfillment-events';

const DEFAULT_PAGE_SIZE = 20;
const MAX_EXPORT_ROWS = 5000;

type OrderWithCount = Prisma.OrderGetPayload<{
  include: {
    user: {
      select: {
        email: true;
        memberCode: true;
      };
    };
    _count: { select: { items: true } };
  };
}>;

type OrderWithItems = Prisma.OrderGetPayload<{
  include: {
    user: {
      select: {
        email: true;
        memberCode: true;
      };
    };
    items: {
      include: {
        product: {
          select: {
            id: true;
            name: true;
          };
        };
      };
    };
    checkoutSnapshot: {
      select: {
        shippingMethodCode: true;
        shippingMethodLabel: true;
      };
    };
  };
}>;

@Injectable()
export class AdminOrdersService {
  private readonly logger = new Logger(AdminOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly historialService: HistorialService,
    private readonly emailService: EmailService,
    private readonly stripeService: StripeService,
    private readonly checkoutOrdersService: OrdersService,
  ) {}

  async listOrders(query: AdminOrdersQueryDto) {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? DEFAULT_PAGE_SIZE, 100);
    const skip = (page - 1) * pageSize;

    const where = this.buildWhere(query);
    const orderBy = this.buildOrderBy(query.sort, query.order);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        include: {
          user: { select: { email: true, memberCode: true } },
          _count: { select: { items: true } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      data: items.map((order) => this.mapOrderSummary(order)),
      meta: {
        page,
        pageSize,
        total,
        pageCount: Math.ceil(total / pageSize) || 1,
        sort: query.sort ?? 'createdAt',
        order: query.order ?? 'desc',
      },
    };
  }

  async getOrderById(id: number) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        user: { select: { email: true, memberCode: true } },
        checkoutSnapshot: {
          select: {
            shippingMethodCode: true,
            shippingMethodLabel: true,
          },
        },
        items: {
          include: {
            product: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return this.serializeOrderWithItems(order);
  }

  async updateOrderStatus(id: number, status: OrderStatus, actorId?: number) {
    return this.updateOrderFulfillment(id, { status }, actorId);
  }

  async assignTrackingBulk(rows: unknown[], preview: boolean, actorId: number) {
    if (!Array.isArray(rows) || !rows.length || rows.length > 100) throw new BadRequestException('Indica entre 1 y 100 filas');
    const normalized = rows.map((input, index) => {
      try {
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Fila inválida');
        const row = input as Record<string, unknown>;
        if (!Number.isSafeInteger(row.orderId) || Number(row.orderId) < 1) throw Error('ID de pedido CRONOX inválido; no uses el ID del usuario');
        const orderId = Number(row.orderId);
        if (typeof row.trackingNumber !== 'string') throw Error('Falta el código de Correos');
        const trackingNumber = normalizeCorreosTrackingNumber(row.trackingNumber);
        if (!trackingNumber) throw Error('Falta el código de Correos');
        return { index, orderId, trackingNumber, revision: row.revision, replaceTracking: row.replaceTracking === true };
      } catch (error) { return { index, error: (error as Error).message }; }
    });
    const results: Record<string, unknown>[] = [];
    for (const row of normalized) {
      if ('error' in row) { results.push({ ...row, status: 'error' }); continue; }
      try {
        if (normalized.filter(other => !('error' in other) && other.orderId === row.orderId).length > 1) throw new BadRequestException('ID de pedido repetido en el lote; corrige todas sus filas');
        if (normalized.filter(other => !('error' in other) && other.trackingNumber === row.trackingNumber).length > 1) throw new BadRequestException('Código de Correos repetido en el lote; corrige todas sus filas');
        const order = await this.prisma.order.findUnique({ where: { id: row.orderId } });
        if (!order) throw new BadRequestException('Pedido CRONOX no encontrado');
        if (!eligibleTrackingOrder({ ...order, trackingNumber: row.trackingNumber, shippingCarrier: 'Correos' })) throw new BadRequestException('Pedido no apto para envío: revisa estado, compra presencial o recogida');
        const duplicate = await this.prisma.order.findFirst({ where: { id: { not: row.orderId }, shippingCarrier: { equals: 'Correos', mode: 'insensitive' }, trackingNumber: { equals: row.trackingNumber, mode: 'insensitive' } }, select: { id: true } });
        if (duplicate) throw new ConflictException(`Código ya asociado al pedido CRONOX #${duplicate.id}`);
        const changed = order.trackingNumber !== row.trackingNumber || order.shippingCarrier?.toLowerCase() !== 'correos';
        if (changed && order.trackingNumber) throw new ConflictException('Conservado el seguimiento existente. Para sustituirlo usa Gestionar pedido');
        if (!preview && row.revision !== order.trackingRevision) throw new ConflictException('El pedido cambió desde la vista previa. Valida otra vez');
        if (!preview && changed) await this.updateOrderFulfillment(row.orderId, { trackingNumber: row.trackingNumber,
          shippingCarrier: 'Correos', trackingRevision: order.trackingRevision }, actorId);
        results.push({ index: row.index, orderId: row.orderId, trackingNumber: row.trackingNumber,
          revision: order.trackingRevision, status: changed ? (preview ? 'valid' : 'updated') : 'unchanged' });
      } catch (error) {
        results.push({ index: row.index, orderId: row.orderId, status: 'error', error: (error as { code?: string }).code === 'P2002' ? 'Código asociado por otra operación; vuelve a validar' : trackingBatchError(error) });
      }
    }
    return { preview, results };
  }

  async markShippedBulk(rows: unknown[], preview: boolean, actorId: number) {
    if (!Array.isArray(rows) || !rows.length || rows.length > 100 || typeof preview !== 'boolean')
      throw new BadRequestException('Introduce entre 1 y 100 pedidos y especifica vista previa');
    const results: Record<string, unknown>[] = [];
    const ids = rows.map(row => (row as { orderId?: unknown } | null)?.orderId);
    for (const [index, raw] of rows.entries()) {
      const row = raw as { orderId?: unknown; expectedStatus?: unknown; revision?: unknown } | null;
      const id = row?.orderId;
      try {
        if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) throw new BadRequestException('ID de pedido CRONOX inválido');
        if (ids.filter(other => other === id).length > 1) throw new BadRequestException('ID de pedido repetido; corrige el lote');
        const order = await this.prisma.order.findUnique({ where: { id } });
        if (!order) throw new NotFoundException('Pedido CRONOX no encontrado');
        if (!eligibleFulfillmentOrder(order)) {
          results.push({ index, orderId: id, status: 'skipped', error: 'No elegible: revisa pago, disputa, cancelación, compra presencial o recogida' }); continue;
        }
        if (order.status === 'SHIPPED') {
          results.push({ index, orderId: id, status: 'already_shipped' }); continue;
        }
        if (!['PAID', 'PROCESSING'].includes(order.status)) {
          results.push({ index, orderId: id, status: 'skipped', error: 'Ya entregado; no se retrocede a Enviado' }); continue;
        }
        if (!preview) {
          if (!['PAID', 'PROCESSING'].includes(String(row?.expectedStatus)) || !Number.isSafeInteger(row?.revision))
            throw new BadRequestException('Valida la vista previa antes de marcar como Enviado');
          await this.updateOrderFulfillment(id, { status: OrderStatus.SHIPPED }, actorId,
            { status: row!.expectedStatus as OrderStatus, revision: row!.revision as number });
        }
        results.push({ index, orderId: id, status: preview ? 'valid' : 'updated', expectedStatus: order.status, revision: order.trackingRevision });
      } catch (error) {
        // A simultaneous manual/carrier transition may have already fulfilled it.
        const current = typeof id === 'number' && Number.isSafeInteger(id) && id > 0 && error instanceof ConflictException
          ? await this.prisma.order.findUnique({ where: { id } }) : null;
        results.push({ index, orderId: typeof id === 'number' ? id : null,
          status: current?.status === 'SHIPPED' ? 'already_shipped' : 'error',
          ...(current?.status === 'SHIPPED' ? {} : { error: trackingBatchError(error) }) });
      }
    }
    return { preview, results };
  }

  async updateOrderFulfillment(id: number, dto: UpdateOrderFulfillmentDto, actorId?: number,
    expected?: { status: OrderStatus; revision: number }) {
    const include = {
      user: { select: { email: true, memberCode: true } },
      checkoutSnapshot: {
        select: {
          shippingMethodCode: true,
          shippingMethodLabel: true,
        },
      },
      items: {
        include: {
          product: { select: { id: true, name: true } },
        },
      },
    } as const;

    const hadExplicitStatus = typeof dto.status !== 'undefined';

    const { updated, previous } = await this.prisma.$transaction(async (tx) => {
      const trackingEdit = dto.trackingNumber !== undefined || dto.shippingCarrier !== undefined;
      if (trackingEdit || hadExplicitStatus) {
        // Serialize corrections with synchronizers and label uploads on this Order.
        await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${id} FOR UPDATE`;
      }
      const existing = await tx.order.findUnique({ where: { id }, include });
      if (!existing) {
        throw new NotFoundException('Order not found');
      }
      if (expected && (existing.status !== expected.status || existing.trackingRevision !== expected.revision))
        throw new ConflictException('El pedido cambió desde la vista previa; vuelve a validar');

      if (
        !hadExplicitStatus &&
        dto.trackingNumber === undefined &&
        dto.trackingUrl === undefined &&
        dto.shippingCarrier === undefined &&
        dto.internalNote === undefined
      ) {
        throw new BadRequestException('No hay cambios para actualizar');
      }

      const targetStatus = dto.status ?? existing.status;
      if (
        hadExplicitStatus &&
        (targetStatus === OrderStatus.REFUNDED ||
          targetStatus === OrderStatus.DISPUTED)
      ) {
        throw new BadRequestException(
          'Los estados de reembolso y disputa solo se actualizan desde Stripe',
        );
      }
      if (
        hadExplicitStatus &&
        targetStatus === OrderStatus.CANCELLED &&
        this.isCapturedStripeOrder(existing)
      ) {
        throw new BadRequestException(
          'Un pedido Stripe cobrado debe reembolsarse desde el flujo de reembolso',
        );
      }
      this.validateStatusTransition(existing.status, targetStatus);

      const data: Prisma.OrderUpdateInput = {};
      if (hadExplicitStatus) {
        data.status = targetStatus;
      }
      if (trackingEdit) {
        if (dto.trackingRevision !== undefined && dto.trackingRevision !== existing.trackingRevision) {
          throw new ConflictException('El seguimiento ha cambiado. Recarga el pedido antes de guardarlo');
        }
        const carrier = dto.shippingCarrier?.trim() ?? existing.shippingCarrier?.trim() ?? 'Correos';
        const isCorreos = !carrier || carrier.trim().toLowerCase() === 'correos';
        const rawNumber = dto.trackingNumber === undefined ? existing.trackingNumber : dto.trackingNumber;
        const nextNumber = isCorreos ? normalizeCorreosTrackingNumber(rawNumber) : rawNumber?.trim() || null;
        const carrierChanged = (carrier.toLowerCase() || 'correos') !== ((existing.shippingCarrier ?? 'Correos').trim().toLowerCase() || 'correos');
        const numberChanged = nextNumber !== existing.trackingNumber;
        if (nextNumber && (numberChanged || carrierChanged) && !eligibleTrackingOrder({ ...existing, trackingNumber: nextNumber, shippingCarrier: 'Correos' })) {
          throw new BadRequestException('Este pedido no admite asociación de envíos: revisa estado, compra presencial o recogida');
        }
        if ((numberChanged || carrierChanged) && existing.trackingNumber &&
            (dto.replaceTracking !== true || dto.trackingRevision !== existing.trackingRevision)) {
          throw new ConflictException('Para sustituir o quitar un seguimiento confirma la sustitución y su revisión actual');
        }
        if (isCorreos && nextNumber) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(824033, hashtext(${nextNumber}))`;
          const duplicate = await tx.order.findFirst({ where: { id: { not: id },
            shippingCarrier: { equals: 'Correos', mode: 'insensitive' }, trackingNumber: { equals: nextNumber, mode: 'insensitive' } }, select: { id: true } });
          if (duplicate) throw new ConflictException(`Ese seguimiento ya está asociado al pedido CRONOX #${duplicate.id}`);
        }
        if (dto.trackingNumber !== undefined || nextNumber !== existing.trackingNumber) data.trackingNumber = nextNumber;
        if (isCorreos && nextNumber) data.shippingCarrier = 'Correos';
        if (numberChanged || carrierChanged) {
          const revision = (existing.trackingRevision ?? 0) + 1;
          const actor = actorId === undefined ? null : await tx.user.findUnique({
            where: { id: actorId }, select: { identityUid: true },
          });
          Object.assign(data, {
            trackingRevision: revision,
            trackingLastSuccessAt: null,
            trackingLastErrorCode: null,
            trackingLastErrorAt: null,
            trackingNextSyncAt: isCorreos && nextNumber ? new Date() : null,
            trackingLeaseUntil: null,
            trackingLeaseToken: null,
            trackingFailures: 0,
            trackingState: null,
            trackingStateCode: null,
            trackingTerminalAt: null,
            trackingBaselineEstablished: false,
            trackingAttachedAt: nextNumber ? new Date() : null,
            trackingAdmissionLocalAt: null,
            trackingDeliveryLocalAt: null,
            trackingNotificationReview: null,
            trackingFlowStartedAt: nextNumber ? new Date() : null,
            trackingCategory: null,
          });
          await tx.orderTrackingAudit.create({ data: {
            orderId: id,
            actorId: actorId ?? null,
            actorIdentityUid: actor?.identityUid ?? null,
            previousNumber: existing.trackingNumber,
            nextNumber,
            revision,
          } });
          const unsentManual = !existing.trackingNumber && nextNumber
            ? await tx.orderTrackingNotification.findMany({ where: {
              orderId: id, revision: existing.trackingRevision, origin: 'MANUAL',
              status: { in: ['PENDING', 'RETRY'] },
              noticeKey: { in: [`ORDER:${id}:SHIPPED`, `ORDER:${id}:DELIVERED`] },
            } }) : [];
          await tx.orderTrackingNotification.updateMany({
            where: { orderId: id, revision: { lt: revision }, status: { in: ['PENDING', 'SENDING', 'RETRY'] } },
            data: { status: 'CANCELLED', leaseToken: null, leaseUntil: null },
          });
          // A first tracking association may follow manual shipment. Move only
          // provably unsent manual work, keeping its old event/job as audit.
          // Replacements and ambiguous/SENT deliveries never reopen a notice.
          if (unsentManual.length) {
            for (const notice of unsentManual) {
              const originalEvent = await tx.orderTrackingEvent.findUniqueOrThrow({ where: { id: notice.eventId } });
              const event = await tx.orderTrackingEvent.create({ data: {
                orderId: id, revision, origin: 'MANUAL', fingerprint: originalEvent.fingerprint,
                code: originalEvent.code, category: originalEvent.category, label: originalEvent.label,
                eventTime: originalEvent.eventTime,
              } });
              await tx.orderTrackingNotification.update({ where: { id: notice.id }, data: {
                noticeKey: `ARCHIVED:${notice.id}`, suppressionReason: 'FIRST_TRACKING_ASSOCIATION',
              } });
              await tx.orderTrackingNotification.create({ data: {
                orderId: id, revision, origin: 'MANUAL', eventId: event.id, category: notice.category,
                noticeKey: notice.noticeKey, transitionFrom: notice.transitionFrom, transitionTo: notice.transitionTo,
                nextAttemptAt: notice.nextAttemptAt, attempts: notice.attempts,
              } });
            }
          }
        }
        if (isCorreos) data.trackingUrl = buildCorreosTrackingUrl(nextNumber);
      }
      if (dto.trackingUrl !== undefined)
        data.trackingUrl = dto.trackingUrl ?? null;
      if (dto.shippingCarrier !== undefined)
        data.shippingCarrier = dto.shippingCarrier ?? null;
      const targetCarrier = (dto.shippingCarrier ?? existing.shippingCarrier ?? 'Correos').trim();
      if (targetCarrier.trim().toLowerCase() === 'correos' || !targetCarrier) {
        const number = typeof data.trackingNumber === 'string' || data.trackingNumber === null
          ? data.trackingNumber : existing.trackingNumber;
        data.trackingUrl = buildCorreosTrackingUrl(number);
        if (number) data.shippingCarrier = 'Correos';
      }
      if (dto.internalNote !== undefined)
        data.internalNote = dto.internalNote ?? null;

      if (hadExplicitStatus && targetStatus !== existing.status) {
        if (['SHIPPED', 'DELIVERED'].includes(targetStatus) && !eligibleFulfillmentOrder(existing))
          throw new BadRequestException('Este pedido no admite cambios logísticos: revisa estado, compra presencial o recogida');
        if (['SHIPPED', 'DELIVERED'].includes(targetStatus)) {
          data.trackingFlowStartedAt = existing.trackingFlowStartedAt || new Date();
          if (!existing.trackingStateCode || data.trackingState === null) Object.assign(data, {
            trackingCategory: targetStatus,
            trackingState: targetStatus === 'SHIPPED' ? 'Enviado (confirmación manual)' : 'Entregado (confirmación manual)',
          });
        }
        const actor = actorId === undefined ? null : await tx.user.findUnique({ where: { id: actorId }, select: { identityUid: true } });
        await tx.orderTrackingAudit.create({ data: { orderId: id, actorId: actorId ?? null,
          actorIdentityUid: actor?.identityUid ?? null, previousNumber: existing.trackingNumber,
          nextNumber: existing.trackingNumber, revision: existing.trackingRevision,
          action: 'MANUAL_STATUS', previousStatus: existing.status, nextStatus: targetStatus } });
      }

      if (
        hadExplicitStatus &&
        targetStatus === OrderStatus.SHIPPED &&
        !existing.shippedAt
      ) {
        data.shippedAt = new Date();
      }
      if (
        hadExplicitStatus &&
        targetStatus === OrderStatus.DELIVERED &&
        !existing.deliveredAt
      ) {
        data.deliveredAt = new Date();
        if (!existing.shippedAt) {
          data.shippedAt = new Date();
        }
      }

      const order = await tx.order.update({
        where: { id },
        data,
        include,
      });

      await this.syncHistorialForStatusChange(existing, order, tx);
      await this.handlePromoUsageOnPaid(tx, existing, order);
      if (hadExplicitStatus) await recordManualFulfillment(tx, order, existing.status);

      return { updated: order, previous: existing };
    }).catch(error => {
      if ((error as { code?: string }).code === 'P2002' && (dto.trackingNumber !== undefined || dto.shippingCarrier !== undefined))
        throw new ConflictException('Ese código de Correos ya está asociado a otro pedido. Recarga y revisa la asociación');
      throw error;
    });

    return this.serializeOrderWithItems(updated);
  }

  async refundOrder(id: number) {
    const include = {
      user: { select: { email: true, memberCode: true } },
      checkoutSnapshot: {
        select: {
          shippingMethodCode: true,
          shippingMethodLabel: true,
        },
      },
      items: {
        include: {
          product: { select: { id: true, name: true } },
        },
      },
    } as const;

    const existing = await this.prisma.order.findUnique({
      where: { id },
      include,
    });
    if (!existing) {
      throw new NotFoundException('Order not found');
    }
    if (existing.provider !== 'stripe' || !existing.providerRef) {
      if (existing.status === OrderStatus.REFUNDED) {
        return this.serializeOrderWithItems(existing);
      }
      throw new BadRequestException('ORDER_NOT_REFUNDABLE_BY_STRIPE');
    }
    if (existing.status === OrderStatus.REFUNDED) {
      // Repair any pre-hardening direct update that marked an order refunded
      // before its consumed checkout reservation was returned to inventory.
      await this.checkoutOrdersService.applyStripePaymentLifecycle(
        existing.providerRef,
        OrderStatus.REFUNDED,
      );
      const repaired = await this.prisma.order.findUnique({
        where: { id },
        include,
      });
      return this.serializeOrderWithItems(repaired ?? existing);
    }
    const refundableStatuses: OrderStatus[] = [
      OrderStatus.PAID,
      OrderStatus.PROCESSING,
      OrderStatus.SHIPPED,
      OrderStatus.DELIVERED,
    ];
    if (!refundableStatuses.includes(existing.status)) {
      throw new BadRequestException('ORDER_NOT_REFUNDABLE_IN_CURRENT_STATE');
    }

    // Stripe receives a deterministic idempotency key. Local state changes only
    // after Stripe confirms the refund, so a failed provider call fails closed.
    await this.stripeService.refundPaymentIntent(
      existing.providerRef,
      `admin-refund:${existing.id}:${existing.providerRef}`,
    );

    await this.checkoutOrdersService.applyStripePaymentLifecycle(
      existing.providerRef,
      OrderStatus.REFUNDED,
    );
    const order = await this.prisma.order.findUnique({
      where: { id },
      include,
    });
    if (!order) throw new NotFoundException('Order not found');

    return this.serializeOrderWithItems(order);
  }

  async exportOrders(query: AdminOrdersQueryDto) {
    const where = this.buildWhere(query);
    const orderBy = this.buildOrderBy(query.sort, query.order);

    const orders = await this.prisma.order.findMany({
      where,
      orderBy,
      take: MAX_EXPORT_ROWS,
      include: { _count: { select: { items: true } } },
    });

    const header = [
      'Order ID',
      'User ID',
      'Status',
      'Carrier',
      'Tracking Number',
      'Tracking URL',
      'Shipped At',
      'Delivered At',
      'Total',
      'Subtotal',
      'Tax Amount',
      'Shipping Cost',
      'Dispute Lost Cents',
      'Currency',
      'Provider',
      'Provider Reference',
      'Created At',
      'Updated At',
      'Items Count',
    ];

    const rows = orders.map((order) => [
      order.id,
      order.userId,
      order.status,
      order.shippingCarrier ?? '',
      order.trackingNumber ?? '',
      order.trackingUrl ?? '',
      order.shippedAt?.toISOString() ?? '',
      order.deliveredAt?.toISOString() ?? '',
      this.formatMoney(order.total),
      this.formatMoney(order.subtotal),
      this.formatMoney(order.taxAmount),
      this.formatMoney(order.shippingCost),
      order.disputeLostCents,
      order.currency,
      order.provider ?? '',
      order.providerRef ?? '',
      order.createdAt.toISOString(),
      order.updatedAt.toISOString(),
      order._count.items,
    ]);

    const csv = this.stringifyCsv([header, ...rows]);
    const timestamp = new Date()
      .toISOString()
      .replace(/[:T]/g, '-')
      .split('.')[0];

    return {
      fileName: `orders-${timestamp}.csv`,
      csv,
    };
  }

  private buildWhere(query: AdminOrdersQueryDto): Prisma.OrderWhereInput {
    const where: Prisma.OrderWhereInput = {};
    if (query.trackingCategory === 'AWAITING_HANDOVER') {
      where.trackingNumber = { not: null }; where.status = { in: ['PAID', 'PROCESSING'] };
      where.source = 'ONLINE';
      where.AND = [{ status: { in: ['PAID', 'PROCESSING'] } }, { OR: [{ trackingCategory: null }, { trackingCategory: 'AWAITING_HANDOVER' }] },
        { OR: [{ shippingMethodCode: null }, { shippingMethodCode: { notIn: ['PICKUP', 'LOCAL_PICKUP'] } }] }];
    } else if (query.trackingCategory) {
      where.trackingCategory = query.trackingCategory === 'SHIPPED' ? { in: ['SHIPPED', 'ADMITTED'] } : query.trackingCategory;
    }

    if (query.status?.length) {
      where.status = { in: query.status };
    }

    const dateFilters: Prisma.DateTimeFilter = {};

    if (query.dateFrom) {
      const date = this.parseDate(query.dateFrom);
      if (date) {
        dateFilters.gte = date;
      }
    }

    if (query.dateTo) {
      const date = this.parseDate(query.dateTo);
      if (date) {
        dateFilters.lte = date;
      }
    }

    if (Object.keys(dateFilters).length) {
      where.createdAt = dateFilters;
    }

    if (query.userId) {
      where.userId = Number(query.userId);
    }

    if (query.email) {
      where.user = {
        email: {
          contains: query.email.trim(),
          mode: 'insensitive',
        },
      };
    }

    const totalFilter: Prisma.DecimalFilter = {};

    if (query.minTotal !== undefined) {
      totalFilter.gte = new Decimal(query.minTotal);
    }

    if (query.maxTotal !== undefined) {
      totalFilter.lte = new Decimal(query.maxTotal);
    }

    if (Object.keys(totalFilter).length) {
      where.total = totalFilter;
    }

    return where;
  }

  private buildOrderBy(
    sort: AdminOrdersQueryDto['sort'],
    direction: AdminOrdersQueryDto['order'],
  ): Prisma.OrderOrderByWithRelationInput {
    const order: Prisma.SortOrder =
      (direction ?? 'desc') === 'asc' ? 'asc' : 'desc';

    switch (sort) {
      case 'total':
        return { total: order };
      case 'status':
        return { status: order };
      case 'createdAt':
      default:
        return { createdAt: order };
    }
  }

  private mapOrderSummary(order: OrderWithCount) {
    return {
      id: order.id,
      userId: order.userId,
      userMemberCode: order.user?.memberCode ?? null,
      userEmail: order.user?.email ?? null,
      status: order.status,
      trackingNumber: order.trackingNumber,
      trackingUrl: order.trackingUrl,
      trackingRevision: order.trackingRevision,
      trackingState: order.trackingState,
      trackingCategory: order.trackingCategory,
      shippingCarrier: order.shippingCarrier,
      shippedAt: order.shippedAt?.toISOString() ?? null,
      deliveredAt: order.deliveredAt?.toISOString() ?? null,
      trackingAdmissionLocalAt: order.trackingAdmissionLocalAt,
      trackingDeliveryLocalAt: order.trackingDeliveryLocalAt,
      trackingNotificationReview: order.trackingNotificationReview,
      internalNote: order.internalNote,
      total: this.formatMoney(order.total),
      subtotal: this.formatMoney(order.subtotal),
      taxAmount: this.formatMoney(order.taxAmount),
      shippingCost: this.formatMoney(order.shippingCost),
      disputeLostCents: order.disputeLostCents,
      currency: order.currency,
      provider: order.provider,
      providerRef: order.providerRef,
      source: order.source,
      excludedFromStatistics: order.excludedFromStatistics,
      paymentMethod: order.paymentMethod,
      purchasedAt: order.purchasedAt?.toISOString() ?? null,
      manualStockHandling: order.manualStockHandling,
      voidedAt: order.voidedAt?.toISOString() ?? null,
      voidReason: order.voidReason,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      itemsCount: order._count.items,
    };
  }

  private serializeOrderWithItems(order: OrderWithItems) {
    const shippingAddress = this.parseShippingAddress(order.shippingAddr);

    return {
      id: order.id,
      userId: order.userId,
      userMemberCode: order.user?.memberCode ?? null,
      userEmail: order.customerEmail || order.user?.email || null,
      customer: {
        name: shippingAddress.recipient,
        email: order.customerEmail || order.user?.email || null,
        phone: shippingAddress.phone,
      },
      shippingAddress,
      shippingMethod: {
        code:
          order.checkoutSnapshot?.shippingMethodCode ??
          order.shippingMethodCode ??
          null,
        label: order.checkoutSnapshot?.shippingMethodLabel ?? null,
      },
      status: order.status,
      paymentStatus: this.getPaymentStatus(order.status),
      fulfillmentStatus: this.getFulfillmentStatus(order),
      trackingState: order.trackingState,
      trackingCategory: order.trackingCategory,
      trackingAdmissionLocalAt: order.trackingAdmissionLocalAt,
      trackingDeliveryLocalAt: order.trackingDeliveryLocalAt,
      trackingNotificationReview: order.trackingNotificationReview,
      trackingNumber: order.trackingNumber,
      trackingUrl: order.trackingUrl,
      trackingRevision: order.trackingRevision,
      shippingCarrier: order.shippingCarrier,
      shippedAt: order.shippedAt?.toISOString() ?? null,
      deliveredAt: order.deliveredAt?.toISOString() ?? null,
      internalNote: order.internalNote,
      subtotal: this.formatMoney(order.subtotal),
      taxRate: order.taxRate.toFixed(4),
      taxAmount: this.formatMoney(order.taxAmount),
      shippingCost: this.formatMoney(order.shippingCost),
      disputeLostCents: order.disputeLostCents,
      total: this.formatMoney(order.total),
      currency: order.currency,
      provider: order.provider,
      providerRef: order.providerRef,
      source: order.source,
      excludedFromStatistics: order.excludedFromStatistics,
      paymentMethod: order.paymentMethod,
      purchasedAt: order.purchasedAt?.toISOString() ?? null,
      manualStockHandling: order.manualStockHandling,
      recordedById: order.recordedById,
      voidedAt: order.voidedAt?.toISOString() ?? null,
      voidedById: order.voidedById,
      voidReason: order.voidReason,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      items: order.items.map((item) => ({
        id: item.id,
        orderId: item.orderId,
        productId: item.productId,
        title: item.title,
        variant: this.extractItemVariant(item.title),
        unitPrice: item.unitPrice.toFixed(2),
        quantity: item.quantity,
        lineTotal: item.lineTotal.toFixed(2),
        product: item.product
          ? {
              id: item.product.id,
              name: item.product.name,
            }
          : undefined,
      })),
    };
  }

  private parseShippingAddress(input: unknown) {
    const source =
      input && typeof input === 'object' && !Array.isArray(input)
        ? (input as Record<string, unknown>)
        : {};
    const firstName = this.pickAddressString(source, [
      'firstName',
      'firstname',
      'first_name',
    ]);
    const lastName = this.pickAddressString(source, [
      'lastName',
      'lastname',
      'last_name',
    ]);
    const recipient =
      this.pickAddressString(source, ['fullName', 'full_name', 'name']) ??
      ([firstName, lastName].filter(Boolean).join(' ').trim() || null);
    const countryValue = this.pickAddressString(source, [
      'country',
      'countryCode',
      'country_code',
    ]);

    return {
      recipient,
      line1: this.pickAddressString(source, [
        'line1',
        'address1',
        'address',
        'street',
      ]),
      line2: this.pickAddressString(source, [
        'line2',
        'address2',
        'addressLine2',
        'additionalAddress',
      ]),
      postalCode: this.pickAddressString(source, [
        'postalCode',
        'postal_code',
        'zip',
        'zipCode',
      ]),
      city: this.pickAddressString(source, ['city', 'town', 'locality']),
      province: this.pickAddressString(source, ['state', 'province', 'region']),
      country: toCountryDisplayName(countryValue) ?? countryValue,
      phone: this.pickAddressString(source, [
        'phone',
        'phoneNumber',
        'telephone',
      ]),
    };
  }

  private pickAddressString(
    source: Record<string, unknown>,
    keys: string[],
  ): string | null {
    const nested =
      source.address &&
      typeof source.address === 'object' &&
      !Array.isArray(source.address)
        ? (source.address as Record<string, unknown>)
        : null;

    for (const key of keys) {
      for (const candidate of [source[key], nested?.[key]]) {
        if (typeof candidate === 'string' && candidate.trim()) {
          return candidate.trim();
        }
      }
    }
    return null;
  }

  private extractItemVariant(title: string): string | null {
    return title.match(/\(([^)]+)\)\s*$/)?.[1]?.trim() || null;
  }

  private getPaymentStatus(status: OrderStatus): string {
    if (
      status === OrderStatus.PAID ||
      status === OrderStatus.PROCESSING ||
      status === OrderStatus.SHIPPED ||
      status === OrderStatus.DELIVERED
    ) {
      return 'PAID';
    }
    return status;
  }

  private getFulfillmentStatus(
    order: Pick<
      OrderWithItems,
      'status' | 'preDisputeStatus' | 'shippedAt' | 'deliveredAt'
    >,
  ): string {
    if (order.deliveredAt || order.status === OrderStatus.DELIVERED) {
      return 'DELIVERED';
    }
    if (order.shippedAt || order.status === OrderStatus.SHIPPED)
      return 'SHIPPED';
    const effectiveStatus = order.preDisputeStatus ?? order.status;
    if (effectiveStatus === OrderStatus.PROCESSING) return 'PROCESSING';
    if (
      effectiveStatus === OrderStatus.CANCELLED ||
      effectiveStatus === OrderStatus.REFUNDED
    ) {
      return effectiveStatus;
    }
    return 'NOT_SHIPPED';
  }

  private formatMoney(value: Prisma.Decimal | number): string {
    if (typeof value === 'number') {
      return (value / 100).toFixed(2);
    }

    return value.toFixed(2);
  }

  private parseDate(value: string): Date | undefined {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  private stringifyCsv(rows: (string | number | null | undefined)[][]): string {
    return rows
      .map((columns) =>
        columns
          .map((column) => {
            if (column === null || column === undefined) {
              return '';
            }

            const rawValue = String(column);
            // Spreadsheet software can evaluate a quoted CSV field as a formula
            // when its first non-whitespace character is a formula operator.
            const formulaSafeValue = /^[\u0000-\u0020\uFEFF]*[=+\-@]/.test(
              rawValue,
            )
              ? `'${rawValue}`
              : rawValue;
            const value = formulaSafeValue.replace(/"/g, '""');
            return `"${value}"`;
          })
          .join(','),
      )
      .join('\n');
  }

  private isCapturedStripeOrder(order: {
    provider: string | null;
    status: OrderStatus;
  }): boolean {
    if (order.provider !== 'stripe') return false;
    const capturedStatuses: OrderStatus[] = [
      OrderStatus.PAID,
      OrderStatus.PROCESSING,
      OrderStatus.SHIPPED,
      OrderStatus.DELIVERED,
      OrderStatus.DISPUTED,
    ];
    return capturedStatuses.includes(order.status);
  }

  private validateStatusTransition(from: OrderStatus, to: OrderStatus) {
    if (from === to) return;

    if (from === OrderStatus.CANCELLED || from === OrderStatus.REFUNDED) {
      throw new BadRequestException(
        `No se puede cambiar de estado desde ${from}. Usa un flujo nuevo para este pedido.`,
      );
    }

    const allowed: Record<OrderStatus, OrderStatus[]> = {
      [OrderStatus.PENDING]: [OrderStatus.CANCELLED],
      [OrderStatus.PAID]: [
        OrderStatus.PROCESSING,
        OrderStatus.SHIPPED,
        OrderStatus.DISPUTED,
        OrderStatus.CANCELLED,
      ],
      [OrderStatus.PROCESSING]: [
        OrderStatus.SHIPPED,
        OrderStatus.DISPUTED,
        OrderStatus.CANCELLED,
      ],
      [OrderStatus.SHIPPED]: [OrderStatus.DELIVERED, OrderStatus.DISPUTED],
      [OrderStatus.DELIVERED]: [OrderStatus.DISPUTED],
      [OrderStatus.DISPUTED]: [],
      [OrderStatus.CANCELLED]: [],
      [OrderStatus.REFUNDED]: [],
    };

    if (!allowed[from].includes(to)) {
      throw new BadRequestException(
        `Transición no permitida: ${from} -> ${to}`,
      );
    }
  }

  private getOrderStatusLabel(status: OrderStatus): string {
    const labels: Record<OrderStatus, string> = {
      [OrderStatus.PENDING]: 'Pendiente',
      [OrderStatus.PAID]: 'Pagado',
      [OrderStatus.DISPUTED]: 'En disputa',
      [OrderStatus.PROCESSING]: 'En preparación',
      [OrderStatus.SHIPPED]: 'Enviado',
      [OrderStatus.DELIVERED]: 'Entregado',
      [OrderStatus.CANCELLED]: 'Cancelado',
      [OrderStatus.REFUNDED]: 'Reembolsado',
    };

    return labels[status] ?? status;
  }

  private async syncHistorialForStatusChange(
    previous: OrderWithItems,
    updated: OrderWithItems,
    tx: Prisma.TransactionClient,
  ) {
    if (!updated.userId || updated.status === previous.status) return;

    // Status is authoritative for accreditation statistics. Rebuild the
    // legacy cache for every transition so cancellations and refunds cannot
    // leave counters that drift from Order/OrderItem.
    await this.historialService.syncFromOrders(updated.userId, tx);
  }

  private async handlePromoUsageOnPaid(
    tx: Prisma.TransactionClient,
    previous: OrderWithItems,
    updated: OrderWithItems,
  ) {
    if (
      updated.status !== OrderStatus.PAID ||
      previous.status === OrderStatus.PAID
    ) {
      return;
    }

    if (!updated.promoCodeId) {
      return;
    }

    const promo = await tx.promoCode.findUnique({
      where: { id: updated.promoCodeId },
      select: {
        id: true,
        code: true,
        startsAt: true,
        expiresAt: true,
        isActive: true,
        singleUsePerUser: true,
        usageLimit: true,
        usageCount: true,
      },
    });

    if (!promo) return;

    const now = new Date();
    if (!promo.isActive) {
      throw new BadRequestException('Código caducado');
    }

    if (promo.startsAt && promo.startsAt > now) {
      throw new BadRequestException('Aún no disponible');
    }

    if (promo.expiresAt && promo.expiresAt < now) {
      throw new BadRequestException('Código caducado');
    }

    if (promo.usageLimit != null && promo.usageCount >= promo.usageLimit) {
      throw new BadRequestException('Límite de usos alcanzado');
    }

    const alreadyRedeemed =
      promo.singleUsePerUser && updated.userId
        ? await tx.promoCodeRedemption.findFirst({
            where: { promoCodeId: promo.id, userId: updated.userId },
            select: { id: true },
          })
        : null;

    if (alreadyRedeemed) {
      throw new BadRequestException(
        'Ya has utilizado este código de descuento.',
      );
    }

    const usageLimitCondition =
      promo.usageLimit != null ? { usageCount: { lt: promo.usageLimit } } : {};

    const incremented = await tx.promoCode.updateMany({
      where: { id: promo.id, ...usageLimitCondition },
      data: { usageCount: { increment: 1 } },
    });

    if (incremented.count === 0) {
      throw new BadRequestException('Límite de usos alcanzado');
    }

    if (updated.userId != null) {
      if (promo.singleUsePerUser) {
        try {
          await tx.promoCodeRedemption.create({
            data: {
              promoCodeId: promo.id,
              userId: updated.userId,
              orderId: updated.id,
            },
          });
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          ) {
            throw new BadRequestException(
              'Ya has utilizado este código de descuento.',
            );
          }
          throw error;
        }
      } else {
        await tx.promoCodeRedemption.upsert({
          where: {
            promoCodeId_userId: {
              promoCodeId: promo.id,
              userId: updated.userId,
            },
          },
          create: {
            promoCodeId: promo.id,
            userId: updated.userId,
            orderId: updated.id,
          },
          update: {},
        });
      }
    }

    if (!updated.promoCodeCode) {
      await tx.order.update({
        where: { id: updated.id },
        data: { promoCodeCode: promo.code },
      });
    }
  }

}
