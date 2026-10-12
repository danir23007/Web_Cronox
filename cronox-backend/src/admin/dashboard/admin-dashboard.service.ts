import { Injectable } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { madridDate, madridMidnight, nextDate } from '../finance/financial-calculations';
import { calculatePoints } from '../points/point-calculations';

const PAID_STATUSES: OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.PROCESSING,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
];
const LOW_STOCK_THRESHOLD = 5;
const OLD_REQUEST_DAYS = 7;

@Injectable()
export class AdminDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getPendingCounts() {
    // Sidebar badges do not need the eleven queries of the full dashboard.
    const groups = await this.prisma.circleUpgradeRequest.groupBy({
      by: ['fromCircle', 'toCircle'],
      where: { status: 'PENDING', OR: [
        { fromCircle: 2, toCircle: 3 },
        { fromCircle: 3, toCircle: 4 },
      ] },
      _count: { _all: true },
      orderBy: [{ fromCircle: 'asc' }, { toCircle: 'asc' }],
    });
    const byType = { '2-3': 0, '3-4': 0 };
    for (const group of groups) {
      const key = `${group.fromCircle}-${group.toCircle}` as keyof typeof byType;
      if (key in byType) byType[key] = group._count._all;
    }
    return { requests: { pendingTotal: byType['2-3'] + byType['3-4'], byType } };
  }

  async getOverview() {
    const now = new Date();
    const today = madridDate(now), month = today.slice(0, 8) + '01';
    const startOfToday = madridMidnight(today), startOfMonth = madridMidnight(month);
    const week = new Date(today + 'T12:00:00Z');
    week.setUTCDate(week.getUTCDate() - (week.getUTCDay() + 6) % 7);
    const startOfWeek = madridMidnight(week.toISOString().slice(0, 10));

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
      pointSales, pointSalesToday, pointSalesWeek, pointEntries,
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
        // ✅ Prisma typings require orderBy for groupBy in your version
        orderBy: { productId: 'asc' },
      }),
      this.prisma.circleUpgradeRequest.count({
        where: {
          status: 'PENDING',
          createdAt: { lte: oldPendingCutoff },
        },
      }),
      this.prisma.pointSale.count(),
      this.prisma.pointSale.count({ where: { soldAt: { gte: startOfToday, lt: madridMidnight(nextDate(today)) } } }),
      this.prisma.pointSale.count({ where: { soldAt: { gte: startOfWeek, lt: madridMidnight(nextDate(today)) } } }),
      this.prisma.pointEntry.findMany({ where: { occurredAt: { gte: startOfMonth, lt: madridMidnight(nextDate(today)) } } }),
    ]);

    // Prisma groupBy _count typing can be a union; extract _all safely.
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

    const paidTodayValue = Number(paidToday._sum.total ?? 0) + calculatePoints(pointEntries, today, today).totals.revenueCents! / 100;
    const paidMonthValue = Number(paidMonth._sum.total ?? 0) + calculatePoints(pointEntries, month, today).totals.revenueCents! / 100;

    // lowStockVariants is grouped by productId => number of products with low-stock variants
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
        total: totalOrders + pointSales,
        today: ordersToday + pointSalesToday,
        week: ordersThisWeek + pointSalesWeek,
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
