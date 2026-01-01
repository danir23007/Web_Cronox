import { Injectable, NotFoundException } from '@nestjs/common';
import * as QRCode from 'qrcode';
import { CircleService } from './circle.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { HistorialService } from '../historial/historial.service';

@Injectable()
export class MembershipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly historialService: HistorialService,
    private readonly circleService: CircleService,
  ) {}

  async getQrForUser(userId: number): Promise<Buffer> {
    const memberCode = await this.usersService.ensureMemberCode(userId);

    const url = `https://cronox.com/m/${memberCode}`;

    const buffer = await QRCode.toBuffer(url, {
      type: 'png',
      width: 512,
      margin: 1,
      color: {
        dark: '#FFFFFF',
        light: '#000000',
      },
    });

    return buffer;
  }

  async getMemberInfo(memberCode: string) {
    const user = await this.prisma.user.findUnique({ where: { memberCode } });

    if (!user) {
      throw new NotFoundException('Member not found');
    }

    return {
      memberCode: user.memberCode,
      createdAt: user.createdAt,
      valid: true,
    };
  }

  async getMyStats(userId: number) {
    await this.circleService.ensureCircleByNetSpent(userId);
    await this.circleService.maybePromoteRequestedCircle(userId);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        circleLevel: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const [record, netSpent, promotionRequestStatus] = await Promise.all([
      this.historialService.ensureForUser(userId),
      this.circleService.getNetSpent(userId),
      this.circleService.getPromotionStatus(userId),
    ]);

    return {
      circleLevel: user.circleLevel,
      createdAt: user.createdAt,
      pedidosRealizados: record.pedidosRealizados,
      articulosAdquiridos: record.articulosAdquiridos,
      netSpent: Number(netSpent.toString()),
      promotionRequestStatus,
    };
  }
}
