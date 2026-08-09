import { Injectable, NotFoundException } from '@nestjs/common';
import * as QRCode from 'qrcode';
import { CircleService } from './circle.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { HistorialService } from '../historial/historial.service';
import { getPublicApiUrl } from '../common/config/environment';

@Injectable()
export class MembershipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly historialService: HistorialService,
    private readonly circleService: CircleService,
  ) {}

  async getQrForUser(userId: number): Promise<Buffer> {
    const publicMemberToken = await this.usersService.ensurePublicMemberToken(userId);

    // Point the QR at the actual public validation endpoint. API_PUBLIC_URL
    // permits a separately hosted API while the default works for the
    // same-origin storefront deployment.
    const url = `${getPublicApiUrl()}/api/m/${encodeURIComponent(publicMemberToken)}`;

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

  async getMemberInfo(publicMemberToken: string) {
    const user = await this.prisma.user.findUnique({
      where: { publicMemberToken },
      select: { id: true },
    });

    // This endpoint is deliberately usable by a scanned membership QR code.
    // Do not reveal account metadata or distinguish missing codes by status.
    return { valid: Boolean(user) };
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
