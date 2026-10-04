import { BadRequestException, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';

export const LAUNCH_SUBJECT = 'CRONOX ya está abierto. Tu acceso empieza aquí.';
export const launchMessage = (code: string) =>
  `La espera ha terminado. CRONOX ya está abierto. Gracias por estar aquí antes del comienzo: tienes un 15% de descuento con tu código ${code}. Es personal, válido únicamente con tu cuenta y de un solo uso. El enlace de acceso caduca en 72 horas y solo se puede utilizar una vez; después podrás entrar con tu contraseña o restablecerla. No compartas este correo: el enlace da acceso a tu cuenta.`;

const GLOBAL_ID = 'global';
const ELIGIBLE_ROLES = ['USER', 'FRIEND'] as const;

@Injectable()
export class LaunchCampaignService implements OnModuleInit, OnModuleDestroy {

  constructor(private readonly prisma: PrismaService, private readonly email: EmailService) {}

  onModuleInit() {
    // Launch mail retired; do not start its worker.
  }

  onModuleDestroy() {

  }

  async preview() {
    const [gate, registrations] = await Promise.all([
      this.prisma.keyScreenSettings.findUnique({ where: { id: GLOBAL_ID } }),
      this.prisma.preRegistration.findMany({
        where: { user: { role: { in: [...ELIGIBLE_ROLES] } } },
        select: { userId: true, launchSentAt: true, launchClaimedAt: true },
      }),
    ]);
    return { subject: LAUNCH_SUBJECT, message: launchMessage('[TU CÓDIGO PERSONAL]'),
      button: 'ENTRAR EN CRONOX', status: gate?.launchStatus || 'PENDING',
      armedAt: gate?.launchArmedAt || null, startedAt: gate?.launchStartedAt || null,
      completedAt: gate?.launchCompletedAt || null, trigger: gate?.launchTrigger || null,
      errorCode: gate?.launchErrorCode || null, keyScreenEnabled: Boolean(gate?.enabled),
      expiresAt: gate?.expiresAt || null, emailReady: false,
      recipients: registrations.length,
      sent: registrations.filter(r => r.launchSentAt).length,
      pending: registrations.filter(r => !r.launchSentAt && !r.launchClaimedAt).length,
      uncertain: registrations.filter(r => !r.launchSentAt && r.launchClaimedAt).length };
  }

  async arm() {
    throw new BadRequestException('El correo de lanzamiento ha sido retirado.');
  }

  async disarm() {
    const changed = await this.prisma.keyScreenSettings.updateMany({
      where: { id: GLOBAL_ID, enabled: true, launchStatus: 'ARMED',
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      data: { launchStatus: 'PENDING', launchArmedAt: null },
    });
    if (changed.count !== 1) throw new BadRequestException('La apertura ya empezó o la pantalla está desactivada.');
    return this.preview();
  }

  async resume() {
    throw new BadRequestException('El correo de lanzamiento ha sido retirado.');
  }

  async tick() {
    // Retired jobs remain historical and cannot be dispatched.
  }

  // Called only by the durable worker, never by a direct admin send endpoint.
  async sendBatch() {
    return { sent: 0, uncertain: 0 };
  }
}
