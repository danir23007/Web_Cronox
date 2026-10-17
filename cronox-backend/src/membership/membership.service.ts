import { Injectable, NotFoundException } from '@nestjs/common';
import * as QRCode from 'qrcode';
import { CircleService } from './circle.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { HistorialService } from '../historial/historial.service';
import { getPublicApiUrl } from '../common/config/environment';
import { accreditationName, accreditationPayload, assertUsableAccreditation, renderAccreditationQr } from './accreditation-identity';
import { circle2Eligibility, CIRCLE_II_THRESHOLD_CENTS } from './circle-policy';

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

  async getMyAccreditation(userId: number) {
    await this.circleService.maybePromoteRequestedCircle(userId);
    const token = await this.usersService.ensurePublicMemberToken(userId);
    const user = await this.prisma.user.findUnique({ where: { id: userId },
      select: { id: true, memberCode: true, identityUid: true, firstName: true, createdAt: true, circleLevel: true,
        accountState: true, publicMemberToken: true } });
    if (!user) throw new NotFoundException('User not found');
    assertUsableAccreditation(user);
    const qrPayload = accreditationPayload(user.publicMemberToken ?? token);
    return { circleLevel: user.circleLevel, name: accreditationName(user.firstName),
      // The stored public member code is the label ID, without reconstruction.
      // Keep the administrative number, internal identity and QR compatible.
      // Missing legacy codes stay missing; reading a card never allocates one.
      createdAt: user.createdAt, memberCode: user.memberCode,
      registrationNumber: user.id, visibleId: user.identityUid, qrPayload,
      qrDataUrl: await renderAccreditationQr(qrPayload) };
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
    await this.circleService.maybePromoteRequestedCircle(userId);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        circleLevel: true,
        circle2PromotedAt: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const [purchaseStats, netSpent, promotionRequestStatus] = await Promise.all([
      this.historialService.calculatePurchaseStats(userId, this.prisma, false),
      this.circleService.getNetSpent(userId),
      this.circleService.getPromotionStatus(userId),
    ]);
    // Derive eligibility from the same user and request state returned here.
    // A worker promotion between independent reads must not mix circle I/II.
    const promotion = circle2Eligibility(user, promotionRequestStatus === 'pending');

    return {
      circleLevel: user.circleLevel,
      createdAt: user.createdAt,
      pedidosRealizados: purchaseStats.pedidosRealizados,
      articulosAdquiridos: purchaseStats.articulosAdquiridos,
      productosDiferentes: purchaseStats.productosDiferentes,
      netSpent: netSpent === null ? null : Number(netSpent.toString()),
      promotionRequestStatus,
      promotion,
      autoPromotionThresholdCents: CIRCLE_II_THRESHOLD_CENTS,
    };
  }
}
