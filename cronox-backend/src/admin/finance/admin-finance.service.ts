import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { FinanceQuery } from './admin-finance.controller';
import { calculateFinance, FinanceEvent, FinanceOrder, sortProducts, validateRange } from './financial-calculations';

@Injectable()
export class AdminFinanceService {
  constructor(private readonly prisma: PrismaService) {}

  async getReport(query: FinanceQuery) {
    validateRange(query.from, query.to);
    // Independent archives survive operational deletes. Keyset batches bound raw
    // memory; only period buckets and product aggregates are retained in memory.
    const { result, currencies } = await this.prisma.$transaction(async tx => {
      const result = calculateFinance([], [], query.from, query.to, query.aggregation);
      const products = new Map<number, typeof result.products[number]>();
      const warnings = new Set<string>();
      const merge = (target: typeof result.totals, value: typeof result.totals) => {
        for (const field of ['revenueCents', 'costCents', 'profitCents'] as const) {
          target[field] = target[field] === null || value[field] === null ? null : target[field]! + value[field]!;
        }
        target.unitsSold += value.unitsSold; target.unitsReturned += value.unitsReturned;
        if (Object.values(target).some(v => typeof v === 'number' && !Number.isSafeInteger(v))) throw new Error('El total supera la precisión admitida.');
      };
      let cursor = 0;
      while (true) {
        const batch = await tx.financeArchive.findMany({
          where: { currency: query.currency, orderId: { gt: cursor }, paidDate: { lte: new Date(query.to) },
            OR: [{ lastDate: { gte: new Date(query.from) } }, { uncertain: true }] },
          orderBy: { orderId: 'asc' }, take: 200,
        });
        if (!batch.length) break;
        cursor = batch[batch.length - 1].orderId;
        const eventRows = await tx.financeEventArchive.findMany({ where: { paymentIntentId: { in: batch.flatMap(row => row.providerRef ? [row.providerRef] : []) } } });
        const stockRows = await tx.financeStockArchive.findMany({ where: { orderId: { in: batch.map(row => row.orderId) } } });
        const orders = batch.map(row => {
          const order = row.snapshot as unknown as FinanceOrder;
          for (const field of ['paidAt', 'purchasedAt', 'createdAt', 'voidedAt'] as const) if (order[field]) order[field] = new Date(order[field]!);
          order.stockMovements = stockRows.filter(stock => stock.orderId === row.orderId).map(stock => {
            const value = stock.snapshot as unknown as FinanceOrder['stockMovements'][number];
            return { ...value, createdAt: new Date(value.createdAt) };
          });
          return order;
        });
        const events = eventRows.map(row => ({ ...(row.snapshot as unknown as FinanceEvent), occurredAt: row.occurredAt }));
        const partial = calculateFinance(orders, events, query.from, query.to, query.aggregation);
        merge(result.totals, partial.totals);
        partial.buckets.forEach((bucket, i) => merge(result.buckets[i], bucket));
        for (const product of partial.products) {
          if (products.has(product.productId)) merge(products.get(product.productId)!, product);
          else products.set(product.productId, product);
        }
        partial.warnings.forEach(warning => warnings.add(warning));
        result.recentOrders = [...result.recentOrders, ...partial.recentOrders].sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime() || b.id - a.id).slice(0, 5);
      }
      result.products = [...products.values()]; result.warnings = [...warnings];
      const currencies = await tx.financeArchive.findMany({ distinct: ['currency'], select: { currency: true } });
      return { result, currencies };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 60000 });
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
