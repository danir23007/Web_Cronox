import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { EmailType } from '../email/email.types';
import { getFrontendUrl } from '../common/config/environment';

export const LAUNCH_SUBJECT = 'CRONOX ya está abierto. Tu acceso empieza aquí.';
export const launchMessage = (code: string) =>
  `La espera ha terminado. CRONOX ya está abierto. Gracias por estar aquí antes del comienzo: tienes un 15% de descuento con tu código ${code}. Es personal, válido únicamente con tu cuenta y de un solo uso. El enlace de acceso caduca en 72 horas y solo se puede utilizar una vez; después podrás entrar con tu contraseña o restablecerla. No compartas este correo: el enlace da acceso a tu cuenta.`;

@Injectable()
export class LaunchCampaignService {
  constructor(private readonly prisma: PrismaService, private readonly email: EmailService) {}

  async preview() {
    const registrations = await this.prisma.preRegistration.findMany({
      where: { user: { role: { in: ['USER', 'FRIEND'] } } },
      select: { userId: true, launchSentAt: true, launchClaimedAt: true },
    });
    return { subject: LAUNCH_SUBJECT, message: launchMessage('[TU CÓDIGO PERSONAL]'),
      button: 'ENTRAR EN CRONOX', recipients: registrations.length,
      sent: registrations.filter(r => r.launchSentAt).length,
      pending: registrations.filter(r => !r.launchSentAt && !r.launchClaimedAt).length,
      uncertain: registrations.filter(r => !r.launchSentAt && r.launchClaimedAt).length };
  }

  async sendBatch() {
    const gate = await this.prisma.keyScreenSettings.findUnique({ where: { id: 'global' } });
    if (gate?.enabled && (!gate.expiresAt || gate.expiresAt > new Date())) {
      throw new BadRequestException('Abre primero la web desactivando la pantalla clave.');
    }
    if (!this.email.isEnabled()) throw new BadRequestException('El envío de correo está desactivado.');
    const candidates = await this.prisma.preRegistration.findMany({
      where: { launchSentAt: null, launchClaimedAt: null,
        user: { role: { in: ['USER', 'FRIEND'] } } },
      orderBy: { submittedAt: 'asc' }, take: 10, select: { userId: true },
    });
    let sent = 0;
    let uncertain = 0;
    for (const candidate of candidates) {
      const token = randomBytes(32).toString('hex');
      const prepared = await this.prisma.$transaction(async tx => {
        const claimed = await tx.preRegistration.updateMany({
          where: { userId: candidate.userId, launchSentAt: null, launchClaimedAt: null },
          data: { launchClaimedAt: new Date() },
        });
        if (claimed.count !== 1) return null;
        const registration = await tx.preRegistration.findUniqueOrThrow({
          where: { userId: candidate.userId }, include: { user: true },
        });
        const code = registration.launchCode || `CX-${randomBytes(10).toString('hex').toUpperCase()}`;
        if (!registration.launchCode) {
          await tx.promoCode.create({ data: { code, type: 'PERCENT', value: 15,
            ownerUserId: registration.userId, ownerEmail: registration.user.email.toLowerCase().trim(),
            usageLimit: 1, singleUsePerUser: true } });
        }
        await tx.preRegistration.update({ where: { userId: registration.userId }, data: {
          launchCode: code, launchTokenHash: createHash('sha256').update(token).digest('hex'),
          launchTokenExpiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000), launchTokenUsedAt: null,
        } });
        return { email: registration.user.email, code };
      });
      if (!prepared) continue;
      try {
        await this.email.send({ type: EmailType.GENERIC, purpose: 'LAUNCH',
          to: prepared.email, subject: LAUNCH_SUBJECT,
          templateData: { title: 'LA ESPERA HA TERMINADO.', message: launchMessage(prepared.code),
            actionUrl: `${getFrontendUrl().replace(/\/$/, '')}/launch.html#${token}`,
            actionLabel: 'ENTRAR EN CRONOX' } });
        await this.prisma.preRegistration.update({ where: { userId: candidate.userId },
          data: { launchSentAt: new Date() } });
        sent++;
      } catch {
        // SMTP acceptance can be ambiguous. Keep the claim; never automatically
        // resend after a timeout or a crash and never issue a second discount.
        uncertain++;
      }
    }
    return { sent, uncertain, remaining: (await this.preview()).pending };
  }
}
