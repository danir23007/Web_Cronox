import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { serializableTransaction } from '../prisma/serializable-transaction';
import { CircleUpgradeService } from './circle-upgrade.service';
import { circle2Eligibility, getNetSpendCents, reconcileCircle2 } from './circle-policy';

@Injectable()
export class CircleService {
  constructor(private readonly prisma: PrismaService, private readonly circleUpgradeService: CircleUpgradeService) {}

  async getNetSpent(userId: number): Promise<Decimal | null> {
    const cents = await getNetSpendCents(this.prisma, userId);
    return cents === null ? null : new Decimal(cents).div(100);
  }

  // Explicit reconciliation API for jobs/repairs. Reads of an accreditation do
  // not invoke this: paid/refund facts enqueue the persistent background job.
  async ensureCircleByNetSpent(userId: number): Promise<void> {
    await serializableTransaction(this.prisma, tx => reconcileCircle2(tx, userId));
  }

  async maybePromoteRequestedCircle(userId: number): Promise<void> {
    await serializableTransaction(this.prisma, async tx => {
      const request = await tx.circlePromotionRequest.findFirst({
        where: { userId, status: 'pending', promoteAt: { lte: new Date() } },
      });
      if (!request) return;
      const user = await tx.user.findUnique({ where: { id: userId }, select: { circleLevel: true } });
      if (!user || user.circleLevel < 2) return;
      // Retain the existing requested-promotion processor without downgrading
      // a member who has since been promoted manually to a higher circle.
      await tx.user.updateMany({ where: { id: userId, circleLevel: 2 }, data: { circleLevel: 3 } });
      await tx.circlePromotionRequest.update({ where: { userId }, data: { status: 'completed' } });
    });
  }

  private async promotionStatus(userId: number, tx: Prisma.TransactionClient) {
    const [request, pending] = await Promise.all([
      tx.circlePromotionRequest.findUnique({ where: { userId }, select: { status: true } }),
      tx.circleUpgradeRequest.findFirst({ where: { userId, fromCircle: 2, toCircle: 3, status: 'PENDING' }, select: { id: true } }),
    ]);
    if (request?.status === 'pending' || (!request && pending)) return 'pending' as const;
    return request ? 'completed' as const : 'none' as const;
  }

  async getPromotionStatus(userId: number) { return this.promotionStatus(userId, this.prisma); }

  async getPromotionEligibility(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { circleLevel: true, circle2PromotedAt: true } });
    if (!user) throw new NotFoundException('User not found');
    const status = await this.getPromotionStatus(userId);
    return circle2Eligibility(user, status === 'pending');
  }

  async requestPromotion(userId: number) {
    return serializableTransaction(this.prisma, async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: userId }, select: { circleLevel: true, circle2PromotedAt: true } });
      if (!user) throw new NotFoundException('User not found');
      const status = await this.promotionStatus(userId, tx);
      const eligibility = circle2Eligibility(user, status === 'pending');
      if (eligibility.hasPending) throw new ConflictException('Ya existe una solicitud pendiente');
      if (!eligibility.canRequest) {
        const message = eligibility.blockedReason === 'cooldown'
          ? 'Debes esperar 30 días completos desde tu ascenso al círculo II.'
          : eligibility.blockedReason === 'promotion_date_unknown'
            ? 'La fecha de ascenso debe verificarse antes de solicitar el círculo III.'
            : 'Solo los usuarios en Círculo II pueden solicitar ascenso';
        throw new BadRequestException({ message, code: eligibility.blockedReason, ...eligibility });
      }
      // Preserve the established 0–72h processing window after an eligible request.
      const requestedAt = new Date();
      const promoteAt = new Date(requestedAt.getTime() + Math.floor(Math.random() * 72 * 60) * 60_000);
      const existing = await tx.circlePromotionRequest.findUnique({ where: { userId }, select: { id: true } });
      const data = { status: 'pending', requestedAt, promoteAt };
      const request = existing
        ? await tx.circlePromotionRequest.update({ where: { userId }, data })
        : await tx.circlePromotionRequest.create({ data: { userId, ...data } });
      await this.circleUpgradeService.ensureAutoRequestForCircle2To3(userId, promoteAt, tx);
      return request;
    }, true);
  }
}
