import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { generateDiscountCode } from '../common/discount-code';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { EmailType } from '../email/email.types';
import { getFrontendUrl } from '../common/config/environment';

export const LAUNCH_SUBJECT = 'CRONOX ya está abierto. Tu acceso empieza aquí.';
export const launchMessage = (code: string) =>
  `La espera ha terminado. CRONOX ya está abierto. Gracias por estar aquí antes del comienzo: tienes un 15% de descuento con tu código ${code}. Es personal, válido únicamente con tu cuenta y de un solo uso. El enlace de acceso caduca en 72 horas y solo se puede utilizar una vez; después podrás entrar con tu contraseña o restablecerla. No compartas este correo: el enlace da acceso a tu cuenta.`;

const GLOBAL_ID = 'global';
const ELIGIBLE_ROLES = ['USER', 'FRIEND'] as const;
const UNCERTAIN_AFTER_MS = 5 * 60_000;

@Injectable()
export class LaunchCampaignService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LaunchCampaignService.name);
  private timer: NodeJS.Timeout | null = null;
  private processing = false;

  constructor(private readonly prisma: PrismaService, private readonly email: EmailService) {}

  onModuleInit() {
    this.timer = setInterval(() => { void this.tick().catch(error => this.logger.error('Launch worker failed', error)); }, 10_000);
    this.timer.unref();
    void this.tick().catch(error => this.logger.error('Launch worker failed on startup', error));
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
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
      expiresAt: gate?.expiresAt || null, emailReady: this.email.isLaunchSenderConfigured(),
      recipients: registrations.length,
      sent: registrations.filter(r => r.launchSentAt).length,
      pending: registrations.filter(r => !r.launchSentAt && !r.launchClaimedAt).length,
      uncertain: registrations.filter(r => !r.launchSentAt && r.launchClaimedAt).length };
  }

  async arm() {
    if (!this.email.isLaunchSenderConfigured()) {
      throw new BadRequestException('Activa EMAIL_ENABLED y configura el remitente INFO antes de armar. No se ha enviado ningún correo.');
    }
    if ((await this.preview()).uncertain > 0) {
      throw new BadRequestException('Hay envíos anteriores de resultado incierto. Revísalos antes de armar.');
    }
    const now = new Date();
    const gate = await this.prisma.keyScreenSettings.findUnique({
      where: { id: GLOBAL_ID }, include: { activeScreen: true },
    });
    if (!gate?.enabled || !gate.activeScreen?.mediaAssetId ||
        gate.activeScreen.mode !== 'PREREGISTRATION' ||
        (gate.expiresAt && gate.expiresAt <= now)) {
      throw new BadRequestException('La pantalla de prerregistro debe estar activa antes de armar la apertura.');
    }
    if (gate.launchStatus === 'ARMED') return this.preview();
    if (gate.launchStatus !== 'PENDING') {
      throw new BadRequestException('Esta campaña ya comenzó. No se puede armar otra vez.');
    }
    const armed = await this.prisma.keyScreenSettings.updateMany({
      where: { id: GLOBAL_ID, enabled: true, launchStatus: 'PENDING',
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      data: { launchStatus: 'ARMED', launchArmedAt: now, launchErrorCode: null },
    });
    if (armed.count !== 1) throw new BadRequestException('La pantalla cambió. Recarga antes de armar.');
    return this.preview();
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
    if (!this.email.isLaunchSenderConfigured()) throw new BadRequestException('Configura el correo antes de continuar.');
    const state = await this.preview();
    if (state.status !== 'ERROR' ||
        (state.keyScreenEnabled && (!state.expiresAt || state.expiresAt > new Date())) ||
        state.pending === 0) {
      throw new BadRequestException('No hay destinatarios pendientes que se puedan continuar de forma segura.');
    }
    await this.prisma.keyScreenSettings.updateMany({
      where: { id: GLOBAL_ID, launchStatus: 'ERROR' },
      data: { launchStatus: 'SENDING', launchErrorCode: null },
    });
    return this.preview();
  }

  async tick() {
    if (this.processing) return;
    this.processing = true;
    try {
      const gate = await this.prisma.keyScreenSettings.findUnique({ where: { id: GLOBAL_ID } });
      if (!gate) return;
      if (gate.launchStatus === 'ARMED' && gate.enabled && gate.expiresAt && gate.expiresAt <= new Date()) {
        await this.prisma.keyScreenSettings.updateMany({
          where: { id: GLOBAL_ID, enabled: true, launchStatus: 'ARMED', expiresAt: { lte: new Date() } },
          data: { launchStatus: 'SENDING', launchStartedAt: new Date(), launchTrigger: 'SCHEDULED' },
        });
      }
      const current = await this.prisma.keyScreenSettings.findUnique({ where: { id: GLOBAL_ID } });
      if (current?.launchStatus !== 'SENDING') return;
      if (current.enabled && (!current.expiresAt || current.expiresAt > new Date())) return;
      if (!this.email.isLaunchSenderConfigured()) {
        await this.markError('EMAIL_NOT_CONFIGURED');
        return;
      }
      await this.sendBatch();
      const state = await this.preview();
      if (state.status !== 'SENDING') return;
      if (state.pending === 0 && state.uncertain === 0) {
        await this.prisma.keyScreenSettings.updateMany({
          where: { id: GLOBAL_ID, launchStatus: 'SENDING' },
          data: { launchStatus: 'COMPLETED', launchCompletedAt: new Date() },
        });
      } else if (state.uncertain > 0) {
        const oldest = await this.prisma.preRegistration.findFirst({
          where: { launchClaimedAt: { not: null }, launchSentAt: null,
            user: { role: { in: [...ELIGIBLE_ROLES] } } },
          orderBy: { launchClaimedAt: 'asc' }, select: { launchClaimedAt: true },
        });
        if (oldest?.launchClaimedAt && oldest.launchClaimedAt.getTime() < Date.now() - UNCERTAIN_AFTER_MS) {
          await this.markError('UNCERTAIN_DELIVERY');
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private async markError(code: string) {
    await this.prisma.keyScreenSettings.updateMany({
      where: { id: GLOBAL_ID, launchStatus: 'SENDING' },
      data: { launchStatus: 'ERROR', launchErrorCode: code },
    });
  }

  // Called only by the durable worker, never by a direct admin send endpoint.
  async sendBatch() {
    const candidates = await this.prisma.preRegistration.findMany({
      where: { launchSentAt: null, launchClaimedAt: null,
        user: { role: { in: [...ELIGIBLE_ROLES] } } },
      orderBy: { submittedAt: 'asc' }, take: 10, select: { userId: true },
    });
    let sent = 0;
    let uncertain = 0;
    for (const candidate of candidates) {
      const current = await this.prisma.keyScreenSettings.findUnique({ where: { id: GLOBAL_ID } });
      if (current?.launchStatus !== 'SENDING' ||
          (current.enabled && (!current.expiresAt || current.expiresAt > new Date()))) break;
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
        if (!ELIGIBLE_ROLES.includes(registration.user.role as (typeof ELIGIBLE_ROLES)[number])) {
          throw new BadRequestException('El destinatario ya no es elegible.');
        }
        const code = registration.launchCode || await generateDiscountCode(tx);
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
        const recorded = await this.prisma.preRegistration.updateMany({ where: { userId: candidate.userId, launchSentAt: null },
          data: { launchSentAt: new Date(), launchErrorCode: null } });
        if (recorded.count !== 1) throw new Error('LAUNCH_ACCEPTANCE_NOT_RECORDED');
        sent++;
      } catch {
        // SMTP acceptance or the following database update can be ambiguous.
        // Keep the claim; never automatically resend or issue another discount.
        await this.prisma.preRegistration.updateMany({ where: { userId: candidate.userId, launchSentAt: null },
          data: { launchErrorCode: 'UNCERTAIN_DELIVERY' } });
        await this.markError('UNCERTAIN_DELIVERY');
        uncertain++;
        break;
      }
    }
    return { sent, uncertain };
  }
}
