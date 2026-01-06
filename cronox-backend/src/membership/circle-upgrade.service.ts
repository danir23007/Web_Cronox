import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CircleUpgradeRequest,
  CircleUpgradeRequestStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCircleUpgradeDto, UpdateCircleUpgradeStatusDto } from './dto/circle-upgrade.dto';

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const COOLDOWN_MS = 30 * DAY_IN_MS;
const AUTO_WINDOW_MS = 72 * 60 * 60 * 1000;

@Injectable()
export class CircleUpgradeService {
  constructor(private readonly prisma: PrismaService) {}

  private sanitizeReviewFields(review?: { notes?: string; reviewedBy?: string }) {
    const notes = review?.notes?.trim();
    const reviewedBy = review?.reviewedBy?.trim();

    return {
      notes: notes || undefined,
      reviewedBy: reviewedBy || undefined,
    };
  }

  private assertPending(request: CircleUpgradeRequest) {
    if (request.status !== CircleUpgradeRequestStatus.PENDING) {
      throw new ConflictException('La solicitud ya fue revisada');
    }
  }

  private async findRequestForReview(
    tx: Prisma.TransactionClient,
    id: string,
    options: { fromCircle?: number; toCircle?: number } = {},
  ) {
    const request = await tx.circleUpgradeRequest.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            circleLevel: true,
          },
        },
      },
    });

    const expectedFrom = options.fromCircle ?? 3;
    const expectedTo = options.toCircle ?? 4;

    if (!request || request.fromCircle !== expectedFrom || request.toCircle !== expectedTo) {
      throw new NotFoundException('Solicitud no encontrada');
    }

    return request;
  }

  private normalizeUsername(username: string) {
    return username.trim().toLowerCase();
  }

  private getCooldownMs(latest?: CircleUpgradeRequest | null) {
    if (!latest || latest.status === CircleUpgradeRequestStatus.APPROVED) {
      return 0;
    }

    const elapsed = Date.now() - latest.createdAt.getTime();
    return Math.max(0, COOLDOWN_MS - elapsed);
  }

  private async getNextRequestNumber(userId: number) {
    const aggregate = await this.prisma.circleUpgradeRequest.aggregate({
      where: { userId },
      _max: { requestNumber: true },
    });
    return (aggregate._max.requestNumber ?? 0) + 1;
  }

  async getStatus(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { circleLevel: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const latest = await this.prisma.circleUpgradeRequest.findFirst({
      where: { userId, fromCircle: 3, toCircle: 4 },
      orderBy: { createdAt: 'desc' },
    });

    const cooldownMs = this.getCooldownMs(latest);
    const cooldownDaysRemaining = cooldownMs > 0 ? Math.ceil(cooldownMs / DAY_IN_MS) : 0;
    const hasPending = latest?.status === CircleUpgradeRequestStatus.PENDING;
    const hasApproved =
      latest?.status === CircleUpgradeRequestStatus.APPROVED || user.circleLevel >= 4;
    const canRequest =
      user.circleLevel === 3 && !hasApproved && !hasPending && cooldownDaysRemaining === 0;

    return {
      circleLevel: user.circleLevel,
      latestRequest: latest,
      hasPending,
      hasApproved,
      canRequest,
      cooldownDaysRemaining,
    };
  }

  async createRequest(userId: number, dto: CreateCircleUpgradeDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { circleLevel: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.circleLevel >= 4) {
      throw new BadRequestException('El usuario ya está en un círculo superior');
    }

    if (user.circleLevel !== 3) {
      throw new BadRequestException('Solo los usuarios en Círculo III pueden solicitar ascenso');
    }

    const latest = await this.prisma.circleUpgradeRequest.findFirst({
      where: { userId, fromCircle: 3, toCircle: 4 },
      orderBy: { createdAt: 'desc' },
    });

    if (latest?.status === CircleUpgradeRequestStatus.PENDING) {
      throw new ConflictException('Ya has enviado una solicitud pendiente.');
    }

    const cooldownMs = this.getCooldownMs(latest);
    if (cooldownMs > 0) {
      const daysRemaining = Math.ceil(cooldownMs / DAY_IN_MS);
      throw new BadRequestException(
        `Ya has enviado una solicitud recientemente. Podrás volver a solicitar el ascenso en ${daysRemaining} días.`,
      );
    }

    const usernameNormalized = this.normalizeUsername(dto.username);

    const duplicateApproved = await this.prisma.circleUpgradeRequest.findFirst({
      where: {
        userId: { not: userId },
        status: CircleUpgradeRequestStatus.APPROVED,
        socialNetwork: dto.socialNetwork,
        usernameNormalized,
      },
      select: { id: true },
    });

    if (duplicateApproved) {
      throw new ConflictException(
        'Este nombre de usuario ya ha sido aprobado para otro miembro de CRONOX.',
      );
    }

      const requestNumber = await this.getNextRequestNumber(userId);
      const username = dto.username.trim();

      return this.prisma.circleUpgradeRequest.create({
        data: {
          userId,
          fromCircle: 3,
          toCircle: 4,
        socialNetwork: dto.socialNetwork,
        username,
        usernameNormalized,
        status: CircleUpgradeRequestStatus.PENDING,
        requestNumber,
      },
    });
  }

  async ensureAutoRequestForCircle2To3(userId: number, autoProcessAt?: Date) {
    const pending = await this.prisma.circleUpgradeRequest.findFirst({
      where: { userId, fromCircle: 2, toCircle: 3, status: CircleUpgradeRequestStatus.PENDING },
      orderBy: { createdAt: 'desc' },
    });

    if (pending) {
      if (autoProcessAt && !pending.autoProcessAt) {
        await this.prisma.circleUpgradeRequest.update({
          where: { id: pending.id },
          data: { autoProcessAt },
        });
      }
      return pending;
    }

    const requestNumber = await this.getNextRequestNumber(userId);
    const created = await this.prisma.circleUpgradeRequest.create({
      data: {
        userId,
        fromCircle: 2,
        toCircle: 3,
        socialNetwork: 'INSTAGRAM',
        username: `auto-${Date.now()}`,
        usernameNormalized: `auto-${Date.now()}`,
        status: CircleUpgradeRequestStatus.PENDING,
        requestNumber,
        autoProcessAt,
      },
    });

    return created;
  }

  async listAdminRequests(status?: CircleUpgradeRequestStatus, options?: { from?: number; to?: number }) {
    const effectiveStatus = status ?? CircleUpgradeRequestStatus.PENDING;
    const fromCircle = options?.from ?? 3;
    const toCircle = options?.to ?? 4;

    const whereStatus =
      effectiveStatus === CircleUpgradeRequestStatus.EXPIRED && fromCircle === 2 && toCircle === 3
        ? CircleUpgradeRequestStatus.PENDING
        : effectiveStatus;

    const list = await this.prisma.circleUpgradeRequest.findMany({
      where: {
        fromCircle,
        toCircle,
        status: whereStatus,
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        status: true,
        fromCircle: true,
        toCircle: true,
        socialNetwork: true,
        username: true,
        usernameNormalized: true,
        userId: true,
        autoProcessAt: true,
        requestNumber: true,
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            circleLevel: true,
          },
        },
      },
    });

    return list
      .map((item) => {
        const base = item as unknown as CircleUpgradeRequest & {
          remainingMs?: number;
          autoRemainingMs?: number;
        };

        if (fromCircle === 2 && toCircle === 3) {
          const expiresAt = new Date(item.createdAt.getTime() + AUTO_WINDOW_MS);
          const remainingMs = Math.max(0, expiresAt.getTime() - Date.now());
          base.remainingMs = remainingMs;
          if (item.autoProcessAt) {
            base.autoRemainingMs = Math.max(0, item.autoProcessAt.getTime() - Date.now());
          }
          if (remainingMs <= 0 && base.status === CircleUpgradeRequestStatus.PENDING) {
            base.status = CircleUpgradeRequestStatus.EXPIRED;
          }
        }

        return base;
      })
      .filter((item) => {
        if (effectiveStatus === CircleUpgradeRequestStatus.EXPIRED) {
          return item.status === CircleUpgradeRequestStatus.EXPIRED;
        }
        return true;
      });
  }

  async approveRequest(
    id: string,
    review?: { notes?: string; reviewedBy?: string },
    adminId?: number,
  ) {
    const reviewFields = this.sanitizeReviewFields(review);

    const result = await this.prisma.$transaction(async (tx) => {
      const request = await this.findRequestForReview(tx, id, { fromCircle: 3, toCircle: 4 });
      this.assertPending(request);

      const normalizedUsername = request.usernameNormalized || this.normalizeUsername(request.username);

      const duplicateApproved = await tx.circleUpgradeRequest.findFirst({
        where: {
          id: { not: id },
          status: CircleUpgradeRequestStatus.APPROVED,
          socialNetwork: request.socialNetwork,
          usernameNormalized: normalizedUsername,
          userId: { not: request.userId },
        },
        select: { id: true },
      });

      if (duplicateApproved) {
        throw new ConflictException(
          'Ese nombre de usuario ya está aprobado para otro miembro de CRONOX.',
        );
      }

      await tx.circleUpgradeRequest.update({
        where: { id },
        data: {
          status: CircleUpgradeRequestStatus.APPROVED,
          approvedAt: new Date(),
          reviewedAt: new Date(),
          processedAt: new Date(),
          processedById: adminId,
          ...reviewFields,
        },
      });

      if (request.user.circleLevel < 4) {
        await tx.user.update({
          where: { id: request.userId },
          data: { circleLevel: 4 },
        });
      }

      const refreshed = await tx.circleUpgradeRequest.findUnique({
        where: { id },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              circleLevel: true,
            },
          },
        },
      });

      if (!refreshed) {
        throw new NotFoundException('Solicitud no encontrada tras la actualización');
      }

      return { request: refreshed, user: refreshed.user };
    });

    return result;
  }

  async denyRequest(
    id: string,
    review?: { notes?: string; reviewedBy?: string },
    adminId?: number,
  ) {
    const reviewFields = this.sanitizeReviewFields(review);

    const result = await this.prisma.$transaction(async (tx) => {
      const request = await this.findRequestForReview(tx, id, { fromCircle: 3, toCircle: 4 });
      this.assertPending(request);

      const updated = await tx.circleUpgradeRequest.update({
        where: { id },
        data: {
          status: CircleUpgradeRequestStatus.DENIED,
          reviewedAt: new Date(),
          approvedAt: null,
          processedAt: new Date(),
          processedById: adminId,
          ...reviewFields,
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              circleLevel: true,
            },
          },
        },
      });

      return { request: updated, user: updated.user };
    });

    return result;
  }

  async updateStatus(id: string, dto: UpdateCircleUpgradeStatusDto, adminId?: number) {
    if (dto.status === CircleUpgradeRequestStatus.APPROVED) {
      const result = await this.approveRequest(id, dto, adminId);
      return result.request;
    }

    const result = await this.denyRequest(id, dto, adminId);
    return result.request;
  }
}
