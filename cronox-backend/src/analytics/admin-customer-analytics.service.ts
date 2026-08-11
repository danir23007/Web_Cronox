import { Injectable, NotFoundException } from '@nestjs/common';
import { CustomerActivityEventType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AdminActivityQueryDto } from './dto/admin-activity-query.dto';

@Injectable()
export class AdminCustomerAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        lastLoginAt: true,
        analyticsConsentStatus: true,
        analyticsConsentDecidedAt: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const [totalLogins, recentLogins, visits, sessionTotals, latestSession, latestEvent, eventCounts, purchased] =
      await this.prisma.$transaction([
        this.prisma.userLoginEvent.count({ where: { userId } }),
        this.prisma.userLoginEvent.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 5 }),
        this.prisma.analyticsSession.count({ where: { userId } }),
        this.prisma.analyticsSession.aggregate({ where: { userId }, _sum: { activeSeconds: true } }),
        this.prisma.analyticsSession.findFirst({ where: { userId }, orderBy: { lastActivityAt: 'desc' } }),
        this.prisma.customerActivityEvent.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } }),
        this.prisma.customerActivityEvent.groupBy({
          by: ['eventType'],
          where: { userId },
          orderBy: { eventType: 'asc' },
          _count: { _all: true },
        }),
        this.prisma.orderItem.aggregate({
          where: { order: { userId, status: { in: ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'] } } },
          _sum: { quantity: true },
        }),
      ]);
    const counts = Object.fromEntries(
      eventCounts.map((row) => [
        row.eventType,
        typeof row._count === 'object' ? row._count._all ?? 0 : 0,
      ]),
    );
    const available = user.analyticsConsentStatus === 'ACTIVE' || visits > 0 || Boolean(latestEvent);

    return {
      consent: {
        status: user.analyticsConsentStatus ?? 'NO_DECISION',
        decidedAt: user.analyticsConsentDecidedAt,
      },
      login: { lastLoginAt: user.lastLoginAt, totalLogins, recent: recentLogins },
      analytics: available
        ? {
            available: true,
            visits,
            lastActivityAt: latestEvent?.createdAt ?? latestSession?.lastActivityAt ?? null,
            activeSeconds: sessionTotals._sum.activeSeconds ?? 0,
            productViews: counts[CustomerActivityEventType.PRODUCT_VIEWED] ?? 0,
            cartAdds: counts[CustomerActivityEventType.PRODUCT_ADDED_TO_CART] ?? 0,
            checkoutStarts: counts[CustomerActivityEventType.CHECKOUT_STARTED] ?? 0,
            checkoutAbandoned: counts[CustomerActivityEventType.CHECKOUT_ABANDONED] ?? 0,
            completedOrders: counts[CustomerActivityEventType.CHECKOUT_COMPLETED] ?? 0,
            purchasedUnits: purchased._sum.quantity ?? 0,
          }
        : { available: false, reason: 'TRACKING_UNAVAILABLE' },
    };
  }

  async products(userId: number) {
    await this.assertUser(userId);
    const rows = await this.prisma.customerActivityEvent.groupBy({
      by: ['productId', 'eventType'],
      where: { userId, productId: { not: null } },
      _count: { _all: true },
      _sum: { activeSeconds: true, quantity: true },
    });
    const purchases = await this.prisma.orderItem.groupBy({
      by: ['productId'],
      where: {
        order: {
          userId,
          status: { in: ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'] },
        },
      },
      _sum: { quantity: true },
    });
    const ids = [...new Set([
      ...rows.map((row) => row.productId).filter((id): id is number => id !== null),
      ...purchases.map((row) => row.productId),
    ])];
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, slug: true },
    });
    const byId = new Map(products.map((product) => [product.id, product]));
    const output = new Map<number, Record<string, unknown>>();
    for (const row of rows) {
      if (row.productId === null) continue;
      const item = output.get(row.productId) ?? {
        product: byId.get(row.productId) ?? { id: row.productId, name: 'Producto eliminado', slug: null },
        views: 0,
        cartAdds: 0,
        cartRemovals: 0,
        favourites: 0,
        activeSeconds: 0,
        purchasedUnits: 0,
      };
      if (row.eventType === 'PRODUCT_VIEWED') item.views = row._count._all;
      if (row.eventType === 'PRODUCT_ADDED_TO_CART') item.cartAdds = row._count._all;
      if (row.eventType === 'PRODUCT_REMOVED_FROM_CART') item.cartRemovals = row._count._all;
      if (row.eventType === 'FAVOURITE_ADDED') item.favourites = row._count._all;
      if (row.eventType === 'ACTIVE_TIME') item.activeSeconds = row._sum.activeSeconds ?? 0;
      output.set(row.productId, item);
    }
    for (const row of purchases) {
      const item = output.get(row.productId) ?? {
        product: byId.get(row.productId) ?? { id: row.productId, name: 'Producto eliminado', slug: null },
        views: 0,
        cartAdds: 0,
        cartRemovals: 0,
        favourites: 0,
        activeSeconds: 0,
        purchasedUnits: 0,
      };
      item.purchasedUnits = row._sum.quantity ?? 0;
      output.set(row.productId, item);
    }
    return { items: [...output.values()].sort((a, b) => Number(b.views) - Number(a.views)) };
  }

  async logins(userId: number, query: AdminActivityQueryDto) {
    await this.assertUser(userId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.userLoginEvent.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.userLoginEvent.count({ where: { userId } }),
    ]);
    return { items, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) || 1 } };
  }

  async timeline(userId: number, query: AdminActivityQueryDto) {
    await this.assertUser(userId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const take = page * pageSize;
    const [events, logins, orders, totalEvents, totalLogins, totalOrders] = await this.prisma.$transaction([
      this.prisma.customerActivityEvent.findMany({
        where: { userId }, orderBy: { createdAt: 'desc' }, take,
        include: { product: { select: { id: true, name: true, slug: true } } },
      }),
      this.prisma.userLoginEvent.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take }),
      this.prisma.order.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take, select: { id: true, status: true, total: true, currency: true, createdAt: true } }),
      this.prisma.customerActivityEvent.count({ where: { userId } }),
      this.prisma.userLoginEvent.count({ where: { userId } }),
      this.prisma.order.count({ where: { userId } }),
    ]);
    const merged = [
      ...events.map((event) => ({ kind: 'ACTIVITY', ...event })),
      ...logins.map((login) => ({ kind: 'LOGIN', ...login })),
      ...orders.map((order) => ({ kind: 'ORDER', ...order, total: Number(order.total) })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const total = totalEvents + totalLogins + totalOrders;
    return {
      items: merged.slice((page - 1) * pageSize, page * pageSize),
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) || 1 },
    };
  }

  private async assertUser(userId: number) {
    if (!(await this.prisma.user.count({ where: { id: userId } }))) {
      throw new NotFoundException('User not found');
    }
  }
}
