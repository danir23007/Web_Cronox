import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { FinanceQuery } from './admin-finance.controller';
import { calculateFinance, madridMidnight, nextDate, sortProducts, validateRange } from './financial-calculations';

@Injectable()
export class AdminFinanceService {
  constructor(private readonly prisma: PrismaService) {}

  async getReport(query: FinanceQuery) {
    validateRange(query.from, query.to);
    const end = madridMidnight(nextDate(query.to));
    // One consistent database snapshot; never aggregate a page of the Orders UI.
    // Read historical events too, to calculate deltas of cumulative refunds.
    const { orders, events, currencies } = await this.prisma.$transaction(async tx => {
      const orders = await tx.order.findMany({
        where: { currency: query.currency, OR: [{ createdAt: { lt: end } }, { purchasedAt: { lt: end } }, { paidAt: { lt: end } }] },
        select: {
          id: true, status: true, currency: true, providerRef: true, source: true,
          paidAt: true, purchasedAt: true, createdAt: true, voidedAt: true,
          total: true, shippingCost: true, discountCents: true, disputeLostCents: true,
          items: { select: { id: true, productId: true, variantId: true, title: true, quantity: true, lineTotal: true, financialSnapshot: true } },
          stockMovements: { where: { delta: { gt: 0 }, reason: { in: ['refund', 'manual_sale_void'] }, createdAt: { lt: end } }, select: { variantId: true, delta: true, reason: true, createdAt: true } },
        },
      });
      const events = await tx.stripeWebhookEvent.findMany({
        where: { status: 'PROCESSED', occurredAt: { lt: end }, type: { in: ['payment_intent.succeeded', 'charge.refunded', 'charge.dispute.closed'] } },
        select: { id: true, type: true, paymentIntentId: true, occurredAt: true, lifecycleStatus: true, refundCumulativeCents: true, amountCents: true },
      });
      const currencies = await tx.order.findMany({ distinct: ['currency'], select: { currency: true } });
      return { orders, events, currencies };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 });
    const result = calculateFinance(orders, events, query.from, query.to, query.aggregation);
    const search = query.search.trim().toLocaleLowerCase('es');
    const filtered = result.products.filter(product => !search || product.name.toLocaleLowerCase('es').includes(search) || String(product.productId) === search);
    const sorted = sortProducts(filtered, query.sort, query.direction);
    const pageSize = 25;
    const page = Math.min(query.page, Math.max(1, Math.ceil(sorted.length / pageSize)));
    return {
      ...result, products: sorted.slice((page - 1) * pageSize, page * pageSize),
      topProducts: sortProducts(result.products.filter(product => product.revenueCents !== null && product.revenueCents > 0), 'revenue', 'desc').slice(0, 5),
      pagination: { page, pageSize, total: sorted.length, pages: Math.max(1, Math.ceil(sorted.length / pageSize)) },
      range: { from: query.from, to: query.to, aggregation: query.aggregation, timeZone: 'Europe/Madrid' },
      currency: query.currency, currencies: [...new Set(['EUR', query.currency, ...currencies.map(row => row.currency)])].sort(),
      basis: 'Facturación de productos después de descuentos, IVA incluido y envío excluido. Beneficio neto = facturación − coste histórico de los productos. No descuenta otros gastos no registrados. Ventas por fecha de cobro; reembolsos por fecha del evento; costes devueltos por fecha de reposición registrada. Unidades vendidas brutas; devoluciones por separado.',
    };
  }
}
