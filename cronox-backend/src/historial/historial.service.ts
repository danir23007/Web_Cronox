import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HistorialService {
  constructor(private readonly prisma: PrismaService) {}

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
    itemsCount: number,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const safeItems = Math.max(0, itemsCount);

    return client.historial.upsert({
      where: { userId },
      update: {
        pedidosRealizados: { increment: 1 },
        articulosAdquiridos: { increment: safeItems },
      },
      create: {
        userId,
        pedidosRealizados: 1,
        articulosAdquiridos: safeItems,
      },
    });
  }

  async registerReturn(
    userId: number,
    returnedItems: number,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const safeReturns = Math.max(0, returnedItems);

    if (safeReturns === 0) {
      return this.ensureForUser(userId, client);
    }

    const existing = await client.historial.findUnique({ where: { userId } });

    if (!existing) {
      return client.historial.create({
        data: {
          userId,
          devoluciones: safeReturns,
          articulosAdquiridos: 0,
        },
      });
    }

    const netArticles = Math.max(0, existing.articulosAdquiridos - safeReturns);

    return client.historial.update({
      where: { userId },
      data: {
        devoluciones: { increment: safeReturns },
        articulosAdquiridos: netArticles,
      },
    });
  }
}
