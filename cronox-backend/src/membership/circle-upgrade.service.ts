import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CircleUpgradeRequest, CircleUpgradeRequestStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCircleUpgradeDto, UpdateCircleUpgradeStatusDto } from './dto/circle-upgrade.dto';

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const COOLDOWN_MS = 30 * DAY_IN_MS;

@Injectable()
export class CircleUpgradeService {
  constructor(private readonly prisma: PrismaService) {}

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

  async updateStatus(id: string, dto: UpdateCircleUpgradeStatusDto) {
    const request = await this.prisma.circleUpgradeRequest.findUnique({
      where: { id },
      include: { user: { select: { circleLevel: true } } },
    });

    if (!request) {
      throw new NotFoundException('Solicitud no encontrada');
    }

    if (dto.status === CircleUpgradeRequestStatus.APPROVED) {
      const duplicateApproved = await this.prisma.circleUpgradeRequest.findFirst({
        where: {
          id: { not: id },
          status: CircleUpgradeRequestStatus.APPROVED,
          socialNetwork: request.socialNetwork,
          usernameNormalized: request.usernameNormalized,
          userId: { not: request.userId },
        },
        select: { id: true },
      });

      if (duplicateApproved) {
        throw new ConflictException(
          'Ese nombre de usuario ya está aprobado para otro miembro de CRONOX.',
        );
      }

      const notes = dto.notes?.trim() || undefined;
      const reviewedBy = dto.reviewedBy?.trim() || undefined;

      const [, updated] = await this.prisma.$transaction([
        this.prisma.user.update({
          where: { id: request.userId },
          data: { circleLevel: Math.max(4, request.user.circleLevel ?? 1) },
        }),
        this.prisma.circleUpgradeRequest.update({
          where: { id },
          data: {
            status: CircleUpgradeRequestStatus.APPROVED,
            approvedAt: new Date(),
            reviewedAt: new Date(),
            reviewedBy,
            notes,
          },
        }),
      ]);

      return updated;
    }

    const notes = dto.notes?.trim() || undefined;
    const reviewedBy = dto.reviewedBy?.trim() || undefined;

    return this.prisma.circleUpgradeRequest.update({
      where: { id },
      data: {
        status: dto.status,
        reviewedAt: new Date(),
        reviewedBy,
        notes,
        approvedAt: dto.status === CircleUpgradeRequestStatus.DENIED ? null : undefined,
      },
    });
  }
}
