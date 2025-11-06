import { Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminOrdersQueryDto } from './dto/admin-order-query.dto';

const DEFAULT_PAGE_SIZE = 20;
const MAX_EXPORT_ROWS = 5000;

type OrderWithCount = Prisma.OrderGetPayload<{
  include: { _count: { select: { items: true } } };
}>;

type OrderWithItems = Prisma.OrderGetPayload<{
  include: {
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
  constructor(private readonly prisma: PrismaService) {}

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
        include: { _count: { select: { items: true } } },
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
    const updated = await this.prisma.order.update({
      where: { id },
      data: { status },
      include: {
        items: {
          include: {
            product: { select: { id: true, name: true } },
          },
        },
      },
    }).catch((error) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException('Order not found');
      }

      throw error;
    });

    return this.serializeOrderWithItems(updated);
  }

  async refundOrder(id: number) {
    const order = await this.prisma.order.update({
      where: { id },
      data: { status: OrderStatus.REFUNDED },
      include: {
        items: {
          include: {
            product: { select: { id: true, name: true } },
          },
        },
      },
    }).catch((error) => {
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
      where.userId = String(query.userId);
    }

    const totalFilter: Prisma.DecimalFilter = {};

    if (query.minTotal !== undefined) {
      totalFilter.gte = new Prisma.Decimal(query.minTotal);
    }

    if (query.maxTotal !== undefined) {
      totalFilter.lte = new Prisma.Decimal(query.maxTotal);
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
      status: order.status,
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
      status: order.status,
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

  private formatMoney(value: Prisma.Decimal): string {
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
}
