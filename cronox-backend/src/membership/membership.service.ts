import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { HistorialService } from '../historial/historial.service';
import * as QRCode from 'qrcode';

@Injectable()
export class MembershipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly historialService: HistorialService,
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

    const record = await this.historialService.ensureForUser(userId);

    return {
      circleLevel: user.circleLevel,
      createdAt: user.createdAt,
      pedidosRealizados: record.pedidosRealizados,
      articulosAdquiridos: record.articulosAdquiridos,
    };
  }
}
