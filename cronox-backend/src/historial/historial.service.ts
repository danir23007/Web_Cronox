import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HistorialService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly recordedPurchaseStatuses: OrderStatus[] = [
    OrderStatus.PAID,
    OrderStatus.PROCESSING,
    OrderStatus.SHIPPED,
    OrderStatus.DELIVERED,
    OrderStatus.DISPUTED,
    OrderStatus.REFUNDED,
  ];

  private readonly retainedItemStatuses: OrderStatus[] = [
    OrderStatus.PAID,
    OrderStatus.PROCESSING,
    OrderStatus.SHIPPED,
    OrderStatus.DELIVERED,
    OrderStatus.DISPUTED,
  ];

  async calculatePurchaseStats(
    userId: number,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const orders = await client.order.findMany({
      where: { userId, status: { in: this.recordedPurchaseStatuses } },
      select: {
        status: true,
        items: { select: { productId: true, quantity: true } },
      },
    });

    let articulosAdquiridos = 0;
    let devoluciones = 0;
    const productIds = new Set<number>();
    for (const order of orders) {
      const isRetained = this.retainedItemStatuses.includes(order.status);
      for (const item of order.items) {
        const quantity = Math.max(0, item.quantity);
        if (isRetained) {
          articulosAdquiridos += quantity;
          if (quantity > 0) productIds.add(item.productId);
        } else if (order.status === OrderStatus.REFUNDED) {
          devoluciones += quantity;
        }
      }
    }

    return {
      pedidosRealizados: orders.length,
      articulosAdquiridos,
      productosDiferentes: productIds.size,
      devoluciones,
    };
  }

  async syncFromOrders(
    userId: number,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const stats = await this.calculatePurchaseStats(userId, client);
    await client.historial.upsert({
      where: { userId },
      update: {
        pedidosRealizados: stats.pedidosRealizados,
        articulosAdquiridos: stats.articulosAdquiridos,
        devoluciones: stats.devoluciones,
      },
      create: {
        userId,
        pedidosRealizados: stats.pedidosRealizados,
        articulosAdquiridos: stats.articulosAdquiridos,
        devoluciones: stats.devoluciones,
      },
    });
    return stats;
  }

  async ensureForUser(
    userId: number,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return client.historial.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
  }

  async incrementOrderProgress(
    userId: number,
    _itemsCount: number,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return this.syncFromOrders(userId, client);
  }

  async registerReturn(
    userId: number,
    returnedItems: number,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    void returnedItems;
    return this.syncFromOrders(userId, client);
  }
}
