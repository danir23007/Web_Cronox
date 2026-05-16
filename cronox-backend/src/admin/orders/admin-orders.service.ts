import {
  BadRequestException,
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
import { EmailType } from '../../email/email.types';

const DEFAULT_PAGE_SIZE = 20;
const MAX_EXPORT_ROWS = 5000;

type OrderWithCount = Prisma.OrderGetPayload<{
  include: {
    user: {
      select: {
        email: true;
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
  };
}>;

@Injectable()
export class AdminOrdersService {
  private readonly logger = new Logger(AdminOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly historialService: HistorialService,
    private readonly emailService: EmailService,
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
          user: { select: { email: true } },
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
        user: { select: { email: true } },
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

  async updateOrderStatus(id: number, status: OrderStatus) {
    return this.updateOrderFulfillment(id, { status });
  }

  async updateOrderFulfillment(id: number, dto: UpdateOrderFulfillmentDto) {
    const include = {
      user: { select: { email: true } },
      items: {
        include: {
          product: { select: { id: true, name: true } },
        },
      },
    } as const;

    const hadExplicitStatus = typeof dto.status !== 'undefined';

    const { updated, previous } = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.order.findUnique({ where: { id }, include });
      if (!existing) {
        throw new NotFoundException('Order not found');
      }

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
      this.validateStatusTransition(existing.status, targetStatus);

      const data: Prisma.OrderUpdateInput = {};
      if (hadExplicitStatus) {
        data.status = targetStatus;
      }
      if (dto.trackingNumber !== undefined) data.trackingNumber = dto.trackingNumber ?? null;
      if (dto.trackingUrl !== undefined) data.trackingUrl = dto.trackingUrl ?? null;
      if (dto.shippingCarrier !== undefined) data.shippingCarrier = dto.shippingCarrier ?? null;
      if (dto.internalNote !== undefined) data.internalNote = dto.internalNote ?? null;

      if (hadExplicitStatus && targetStatus === OrderStatus.SHIPPED && !existing.shippedAt) {
        data.shippedAt = new Date();
      }
      if (hadExplicitStatus && targetStatus === OrderStatus.DELIVERED && !existing.deliveredAt) {
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

      return { updated: order, previous: existing };
    });

    try {
      await this.sendStatusEmails(previous, updated, hadExplicitStatus);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Error desconocido';
      this.logger.error(
        `No se pudo enviar el email transaccional del pedido #${updated.id}. El pedido se actualizó correctamente. reason=${reason}`,
      );
    }

    return this.serializeOrderWithItems(updated);
  }

  async refundOrder(id: number) {
    const include = {
      user: { select: { email: true } },
      items: {
        include: {
          product: { select: { id: true, name: true } },
        },
      },
    } as const;

    const order = await this.prisma
      .$transaction(async (tx) => {
        const existing = await tx.order.findUnique({ where: { id }, include });

        if (!existing) {
          throw new NotFoundException('Order not found');
        }

        const updated = await tx.order.update({
          where: { id },
          data: { status: OrderStatus.REFUNDED },
          include,
        });

        await this.syncHistorialForStatusChange(existing, updated, tx);

        return updated;
      })
      .catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
          throw new NotFoundException('Order not found');
        }

        throw error;
      });

    // TODO: Integrate Stripe refund API when available.
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
      order.currency,
      order.provider ?? '',
      order.providerRef ?? '',
      order.createdAt.toISOString(),
      order.updatedAt.toISOString(),
      order._count.items,
    ]);

    const csv = this.stringifyCsv([header, ...rows]);
    const timestamp = new Date().toISOString().replace(/[:T]/g, '-').split('.')[0];

    return {
      fileName: `orders-${timestamp}.csv`,
      csv,
    };
  }

  private buildWhere(query: AdminOrdersQueryDto): Prisma.OrderWhereInput {
    const where: Prisma.OrderWhereInput = {};

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
    const order: Prisma.SortOrder = (direction ?? 'desc') === 'asc' ? 'asc' : 'desc';

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
      userEmail: order.user?.email ?? null,
      status: order.status,
      trackingNumber: order.trackingNumber,
      trackingUrl: order.trackingUrl,
      shippingCarrier: order.shippingCarrier,
      shippedAt: order.shippedAt?.toISOString() ?? null,
      deliveredAt: order.deliveredAt?.toISOString() ?? null,
      internalNote: order.internalNote,
      total: this.formatMoney(order.total),
      subtotal: this.formatMoney(order.subtotal),
      taxAmount: this.formatMoney(order.taxAmount),
      shippingCost: this.formatMoney(order.shippingCost),
      currency: order.currency,
      provider: order.provider,
      providerRef: order.providerRef,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      itemsCount: order._count.items,
    };
  }

  private serializeOrderWithItems(order: OrderWithItems) {
    return {
      id: order.id,
      userId: order.userId,
      userEmail: order.user?.email ?? null,
      status: order.status,
      trackingNumber: order.trackingNumber,
      trackingUrl: order.trackingUrl,
      shippingCarrier: order.shippingCarrier,
      shippedAt: order.shippedAt?.toISOString() ?? null,
      deliveredAt: order.deliveredAt?.toISOString() ?? null,
      internalNote: order.internalNote,
      subtotal: this.formatMoney(order.subtotal),
      taxRate: order.taxRate.toFixed(4),
      taxAmount: this.formatMoney(order.taxAmount),
      shippingCost: this.formatMoney(order.shippingCost),
      total: this.formatMoney(order.total),
      currency: order.currency,
      provider: order.provider,
      providerRef: order.providerRef,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      items: order.items.map((item) => ({
        id: item.id,
        orderId: item.orderId,
        productId: item.productId,
        title: item.title,
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

            const value = String(column).replace(/"/g, '""');
            return `"${value}"`;
          })
          .join(','),
      )
      .join('\n');
  }

  private validateStatusTransition(from: OrderStatus, to: OrderStatus) {
    if (from === to) return;

    if (from === OrderStatus.CANCELLED || from === OrderStatus.REFUNDED) {
      throw new BadRequestException(
        `No se puede cambiar de estado desde ${from}. Usa un flujo nuevo para este pedido.`,
      );
    }

    const allowed: Record<OrderStatus, OrderStatus[]> = {
      [OrderStatus.PENDING]: [OrderStatus.PAID, OrderStatus.CANCELLED],
      [OrderStatus.PAID]: [
        OrderStatus.PROCESSING,
        OrderStatus.SHIPPED,
        OrderStatus.REFUNDED,
        OrderStatus.CANCELLED,
      ],
      [OrderStatus.PROCESSING]: [
        OrderStatus.SHIPPED,
        OrderStatus.REFUNDED,
        OrderStatus.CANCELLED,
      ],
      [OrderStatus.SHIPPED]: [OrderStatus.DELIVERED, OrderStatus.REFUNDED],
      [OrderStatus.DELIVERED]: [OrderStatus.REFUNDED],
      [OrderStatus.CANCELLED]: [],
      [OrderStatus.REFUNDED]: [],
    };

    if (!allowed[from].includes(to)) {
      throw new BadRequestException(`Transición no permitida: ${from} -> ${to}`);
    }
  }

  private async sendStatusEmails(
    previous: OrderWithItems,
    updated: OrderWithItems,
    statusWasExplicitlyUpdated: boolean,
  ) {
    if (!statusWasExplicitlyUpdated || previous.status === updated.status) {
      return;
    }

    const to = updated.user?.email;
    if (!to) {
      return;
    }

    if (updated.status === OrderStatus.SHIPPED) {
      await this.emailService.send({
        type: EmailType.ORDER_SHIPPED,
        to,
        subject: `CRONOX · Pedido #${updated.id} enviado`,
        templateData: {
          orderId: String(updated.id),
          statusLabel: this.getOrderStatusLabel(updated.status),
          trackingNumber: updated.trackingNumber,
          trackingUrl: updated.trackingUrl,
          shippingCarrier: updated.shippingCarrier,
        },
      });
    }

    if (updated.status === OrderStatus.DELIVERED) {
      await this.emailService.send({
        type: EmailType.ORDER_DELIVERED,
        to,
        subject: `CRONOX · Pedido #${updated.id} entregado`,
        templateData: {
          orderId: String(updated.id),
          statusLabel: this.getOrderStatusLabel(updated.status),
        },
      });
    }
  }

  private getOrderStatusLabel(status: OrderStatus): string {
    const labels: Record<OrderStatus, string> = {
      [OrderStatus.PENDING]: 'Pendiente',
      [OrderStatus.PAID]: 'Pagado',
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
    if (!updated.userId) return;

    const itemsCount = this.computeItemsQuantity(updated.items);
    const movedToCompletion =
      this.isCompletionStatus(updated.status) && !this.isCompletionStatus(previous.status);

    if (movedToCompletion) {
      await this.historialService.incrementOrderProgress(updated.userId, itemsCount, tx);
    }

    if (updated.status === OrderStatus.REFUNDED && previous.status !== OrderStatus.REFUNDED) {
      await this.historialService.registerReturn(updated.userId, itemsCount, tx);
    }
  }

  private async handlePromoUsageOnPaid(
    tx: Prisma.TransactionClient,
    previous: OrderWithItems,
    updated: OrderWithItems,
  ) {
    if (updated.status !== OrderStatus.PAID || previous.status === OrderStatus.PAID) {
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

    const alreadyRedeemed = await tx.promoCodeRedemption.findFirst({
      where: { promoCodeId: promo.id, userId: updated.userId },
      select: { id: true },
    });

    if (alreadyRedeemed) {
      throw new BadRequestException('Este código ya fue usado en tu cuenta');
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
        throw new BadRequestException('Este código ya fue usado en tu cuenta');
      }
      throw error;
    }

    if (!updated.promoCodeCode) {
      await tx.order.update({
        where: { id: updated.id },
        data: { promoCodeCode: promo.code },
      });
    }
  }

  private computeItemsQuantity(items: OrderWithItems['items']): number {
    if (!Array.isArray(items) || !items.length) return 0;
    return items.reduce((total, item) => total + Math.max(0, item.quantity), 0);
  }

  private isCompletionStatus(status: OrderStatus): boolean {
    return (
      status === OrderStatus.PAID ||
      status === OrderStatus.PROCESSING ||
      status === OrderStatus.SHIPPED ||
      status === OrderStatus.DELIVERED
    );
  }
}