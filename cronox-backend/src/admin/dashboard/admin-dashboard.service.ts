import { Injectable } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const PAID_STATUSES: OrderStatus[] = [OrderStatus.PAID, OrderStatus.SHIPPED];
const LOW_STOCK_THRESHOLD = 5;
const OLD_REQUEST_DAYS = 7;

@Injectable()
export class AdminDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview() {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const startOfWeek = new Date(now);
    const day = startOfWeek.getDay();
    const diff = (day + 6) % 7;
    startOfWeek.setDate(startOfWeek.getDate() - diff);
    startOfWeek.setHours(0, 0, 0, 0);

    const oldPendingCutoff = new Date(now);
    oldPendingCutoff.setDate(oldPendingCutoff.getDate() - OLD_REQUEST_DAYS);
    oldPendingCutoff.setHours(0, 0, 0, 0);

    const [
      totalUsers,
      usersByCircle,
      totalOrders,
      ordersToday,
      ordersThisWeek,
      paidToday,
      paidMonth,
      pendingRequests23,
      pendingRequests34,
      lowStockVariants,
      oldPendingRequests,
    ] = await this.prisma.$transaction([
      this.prisma.user.count(),
      this.prisma.user.groupBy({
        by: ['circleLevel'],
        _count: { _all: true },
        orderBy: { circleLevel: 'asc' },
      }),
      this.prisma.order.count(),
      this.prisma.order.count({ where: { createdAt: { gte: startOfToday } } }),
      this.prisma.order.count({ where: { createdAt: { gte: startOfWeek } } }),
      this.prisma.order.aggregate({
        where: {
          status: { in: PAID_STATUSES },
          createdAt: { gte: startOfToday },
        },
        _sum: { total: true },
      }),
      this.prisma.order.aggregate({
        where: {
          status: { in: PAID_STATUSES },
          createdAt: { gte: startOfMonth },
        },
        _sum: { total: true },
      }),
      this.prisma.circleUpgradeRequest.count({
        where: {
          status: 'PENDING',
          fromCircle: 2,
          toCircle: 3,
        },
      }),
      this.prisma.circleUpgradeRequest.count({
        where: {
          status: 'PENDING',
          fromCircle: 3,
          toCircle: 4,
        },
      }),
      this.prisma.productVariant.groupBy({
        by: ['productId'],
        where: {
          stockQty: { lt: LOW_STOCK_THRESHOLD },
          isActive: true,
          product: { isActive: true },
        },
        _count: { _all: true },
      }),
      this.prisma.circleUpgradeRequest.count({
        where: {
          status: 'PENDING',
          createdAt: { lte: oldPendingCutoff },
        },
      }),
    ]);

    const getGroupCount = (row: { _count: unknown }) => {
      if (typeof row._count === 'object' && row._count) {
        return (row._count as { _all?: number })._all ?? 0;
      }
      return 0;
    };

    const circleCounts = new Map<number, number>();
    usersByCircle.forEach((row) => {
      circleCounts.set(row.circleLevel ?? 0, getGroupCount(row));
    });

    const circleLevels = [1, 2, 3, 4, 5].map((level) => ({
      circle: level,
      count: circleCounts.get(level) ?? 0,
    }));

    const totalPendingRequests = pendingRequests23 + pendingRequests34;

    const paidTodayValue = Number(paidToday._sum.total ?? 0);
    const paidMonthValue = Number(paidMonth._sum.total ?? 0);
    const lowStockProducts = lowStockVariants.length;

    return {
      users: {
        total: totalUsers,
        byCircle: circleLevels,
      },
      requests: {
        pendingTotal: totalPendingRequests,
        byType: {
          '2-3': pendingRequests23,
          '3-4': pendingRequests34,
        },
      },
      orders: {
        total: totalOrders,
        today: ordersToday,
        week: ordersThisWeek,
      },
      revenue: {
        today: paidTodayValue,
        month: paidMonthValue,
      },
      alerts: {
        lowStock: lowStockProducts,
        oldPendingRequests,
      },
      metadata: {
        paidStatuses: PAID_STATUSES,
        lowStockThreshold: LOW_STOCK_THRESHOLD,
        oldPendingDays: OLD_REQUEST_DAYS,
      },
    };
  }
}
