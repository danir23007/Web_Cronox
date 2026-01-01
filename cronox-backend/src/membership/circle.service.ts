import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';

const HUNDRED_EUR = new Decimal(100);

@Injectable()
export class CircleService {
  constructor(private readonly prisma: PrismaService) {}

  async getNetSpent(userId: number): Promise<Decimal> {
    const [purchases, refunds] = await Promise.all([
      this.prisma.order.aggregate({
        where: { userId, status: { in: [OrderStatus.PAID, OrderStatus.SHIPPED] } },
        _sum: { total: true },
      }),
      this.prisma.order.aggregate({
        where: { userId, status: OrderStatus.REFUNDED },
        _sum: { total: true },
      }),
    ]);

    const purchasesTotal = purchases._sum.total ?? new Decimal(0);
    const refundsTotal = refunds._sum.total ?? new Decimal(0);

    return purchasesTotal.sub(refundsTotal);
  }

  async ensureCircleByNetSpent(userId: number): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, circleLevel: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.circleLevel >= 3) {
      return;
    }

    const netSpent = await this.getNetSpent(userId);

    if (netSpent.gt(HUNDRED_EUR) && user.circleLevel === 1) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { circleLevel: 2 },
      });
      return;
    }

    if (netSpent.lte(HUNDRED_EUR) && user.circleLevel === 2) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { circleLevel: 1 },
      });
    }
  }

  async maybePromoteRequestedCircle(userId: number): Promise<void> {
    const request = await this.prisma.circlePromotionRequest.findFirst({
      where: { userId, status: 'pending', promoteAt: { lte: new Date() } },
    });

    if (!request) {
      return;
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { circleLevel: 3 },
      }),
      this.prisma.circlePromotionRequest.update({
        where: { userId },
        data: { status: 'completed' },
      }),
    ]);
  }

  async getPromotionStatus(userId: number): Promise<'pending' | 'completed' | 'none'> {
    const request = await this.prisma.circlePromotionRequest.findUnique({
      where: { userId },
      select: { status: true },
    });

    if (!request) return 'none';
    if (request.status === 'pending') return 'pending';
    return 'completed';
  }

  async requestPromotion(userId: number) {
    await this.ensureCircleByNetSpent(userId);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { circleLevel: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.circleLevel >= 3) {
      throw new BadRequestException('El usuario ya está en un círculo superior');
    }

    if (user.circleLevel !== 2) {
      throw new BadRequestException('Solo los usuarios en Círculo II pueden solicitar ascenso');
    }

    const existing = await this.prisma.circlePromotionRequest.findUnique({
      where: { userId },
      select: { status: true },
    });

    if (existing?.status === 'pending') {
      throw new ConflictException('Ya existe una solicitud pendiente');
    }

    const minutesToPromote = Math.floor(Math.random() * 72 * 60);
    const promoteAt = new Date(Date.now() + minutesToPromote * 60_000);
    const requestedAt = new Date();

    const request =
      existing && existing.status === 'completed'
        ? await this.prisma.circlePromotionRequest.update({
            where: { userId },
            data: { status: 'pending', requestedAt, promoteAt },
          })
        : await this.prisma.circlePromotionRequest.create({
            data: { userId, status: 'pending', requestedAt, promoteAt },
          });

    return request;
  }
}
